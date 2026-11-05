import {
  Collider,
  ColliderDesc,
  init,
  RigidBodyDesc,
  World
} from '@dimforge/rapier2d-compat'
import type { Polygon } from 'poly-decomp-es'
import {
  DEFAULT_OPTIONS,
  GRAVITY,
  MAX_STEPS,
  SCALE,
  SETTLE_CONFIRM_FRAMES,
  TIMESTEP,
  VELOCITY_THRESHOLD
} from '../const'
import {
  CalendarResponse,
  fetchContributions,
  INTENSITY_COLORS,
  RawContributionDay
} from './githubContributions'
import { FontSource, getTextPaths } from './parseTextPath'
import {
  CompressionAlgorithm,
  compressTrajectory,
  RawTrajectory,
  Trajectory,
  toKeyframeTrajectory
} from './simplifyTrajectory'
import { withDefaults } from './withDefaults'

/** 把自转角解缠绕到与上一帧连续（差收敛到 ±π 内），保证轨迹角度可直接线性插值 */
function unwrapRotation(next: number, prev: number): number {
  let rotation = next
  while (rotation - prev > Math.PI) rotation -= Math.PI * 2
  while (prev - rotation > Math.PI) rotation += Math.PI * 2
  return rotation
}

/** 方形自转轨迹的角度插值误差上限 */
const MAX_ROTATION_ERROR = (3 * Math.PI) / 180

/** 模拟产出的贡献方块：轨迹为原始采样序列 */
export interface ContributionJson {
  date: string
  color: string
  trajectory: RawTrajectory
}

export class Contribution implements ContributionJson {
  date: string
  x: number
  y: number
  color: string

  /** 原始采样轨迹：x/y 通道每帧记录，自转角通道仅方形记录 */
  trajectory: RawTrajectory

  /** 自转角 */
  trackRotation: boolean

  collider: Collider

  constructor(
    contributionDay: RawContributionDay,
    collider: Collider,
    trackRotation: boolean
  ) {
    this.collider = collider
    this.trackRotation = trackRotation
    this.date = contributionDay.date
    this.color = INTENSITY_COLORS[contributionDay.intensity]
    const pos = collider.translation()
    this.x = pos.x
    this.y = pos.y
    this.trajectory = trackRotation
      ? { x: [], y: [], rotation: [] }
      : { x: [], y: [] }
    this.recordSample(pos)
  }

  update() {
    this.recordSample(this.collider.translation())
  }

  /** 记录当前时刻的位姿采样：坐标入各自通道，解缠绕后的自转角入旋转通道 */
  private recordSample(pos: { x: number; y: number }): void {
    this.x = pos.x
    this.y = pos.y
    this.trajectory.x.push(pos.x)
    this.trajectory.y.push(pos.y)
    if (!this.trackRotation) return
    const rotations = this.trajectory.rotation!
    const prev = rotations[rotations.length - 1] ?? 0
    rotations.push(unwrapRotation(this.collider.rotation(), prev))
  }

  getTrajectory() {
    return this.trajectory
  }

  /** 移除各通道轨迹末尾 count 个采样 */
  truncateTail(count: number) {
    const kept = Math.max(1, this.trajectory.x.length - count)
    this.trajectory.x.length = kept
    this.trajectory.y.length = kept
    if (this.trajectory.rotation) {
      this.trajectory.rotation.length = kept
    }
  }

  toJSON(): ContributionJson {
    return {
      color: this.color,
      date: this.date,
      trajectory: this.trajectory
    }
  }
}

/**
 * 移除掉出画面底部两倍块深的贡献块（连同刚体）。
 */
export function pruneFallenBlocks(
  world: World,
  contributions: Contribution[],
  size: number
): void {
  for (let i = contributions.length - 1; i >= 0; i--) {
    const body = contributions[i].collider.parent()
    if (body && body.translation().y < -2 * size) {
      world.removeRigidBody(body)
      contributions.splice(i, 1)
    }
  }
}

async function createWorld(width: number, height: number) {
  await init()
  // 重力
  const world = new World({ x: 0.0, y: -9.81 })
  world.timestep = TIMESTEP

  // 地面
  world.createCollider(
    ColliderDesc.cuboid(width / 2, 1),
    world.createRigidBody(RigidBodyDesc.fixed().setTranslation(width / 2, -1))
  )
  // 墙壁
  world.createCollider(
    ColliderDesc.cuboid(1, height),
    world.createRigidBody(
      RigidBodyDesc.fixed().setTranslation(width + 1, height)
    )
  )
  world.createCollider(
    ColliderDesc.cuboid(1, height),
    world.createRigidBody(RigidBodyDesc.fixed().setTranslation(-1, height))
  )

  return world
}

export interface TextPathResult {
  paths: {
    /** 字形子轮廓凹分解出的凸多边形集合（字形局部坐标，y 轴向下） */
    polygons: Polygon[]
  }
  pathData: string
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
}

/**
 * 计算所有字形的整体包围盒
 * @param textPaths
 * @param param1
 * @returns
 */
export function getTextBoundBox(
  textPaths: TextPathResult[],
  {
    width,
    height,
    textTop
  }: Required<Pick<SimulationOptions, 'width' | 'height' | 'textTop'>>
) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const { rect } of textPaths) {
    if (rect.x < minX) minX = rect.x
    if (rect.x + rect.width > maxX) maxX = rect.x + rect.width
    // 翻转 Y：opentype 字形在基线下方（y 为负），碰撞体需要正向
    const top = -rect.y
    const bottom = -(rect.y + rect.height)
    if (bottom < minY) minY = bottom
    if (top > maxY) maxY = top
  }
  const bboxCenterX = (minX + maxX) / 2
  const offsetX = width / 2 - bboxCenterX
  // 文字顶部距离世界顶部的距离
  const centerY = height - textTop - maxY

  return {
    offsetX,
    centerY
  }
}

/** 渲染用贡献方块：轨迹已统一为关键帧形态（未压缩时为无 span 的全量关键帧） */
export interface RenderedContribution {
  date: string
  color: string
  trajectory: Trajectory
}

export interface SimulationResult {
  stepCount: number
  time: number
  textPaths: Pick<TextPathResult, 'rect' | 'pathData'>[]
  contributions: RenderedContribution[]
  /** 文字在物理世界中的 X 偏移量 */
  offsetX: number
  /** 文字在物理世界中的 Y 偏移量 */
  centerY: number
}

export interface SimulationOptions {
  username: string
  text?: string
  /** 文字到顶部的距离 */
  textTop?: number
  /** 字体大小 */
  fontSize?: number
  /**
   * 轨迹压缩容差，单位 SVG 像素。播放时每个原始时刻的插值坐标与真实坐标
   * 在横向、纵向上各自的偏差不超过该值
   */
  compressionTolerance?: number
  /** 禁用轨迹压缩，保留完整轨迹。调试用途，action无法禁用压缩 */
  disableCompression?: boolean
  /**
   * 同时产出联合位置表达（x/y 共享时间轴），供 SMIL 这类无法单轴插值的
   * 引擎使用。拆分通道折点错开时联合帧数更少，体积更省
   */
  jointPosition?: boolean
  /**
   * 轨迹压缩算法：Greedy（单遍贪心，快，默认）、DP（动态规划全局最优，长轨迹秒级）、
   * RDP（时空版 Ramer-Douglas-Peucker，最快，关键帧略多）
   */
  compressionAlgorithm?: CompressionAlgorithm
  /**
   * 贡献方块的形状：
   * - circle 圆形
   * - square 方形
   */
  shape?: 'circle' | 'square'
  /** 贡献方块的摩擦系数 */
  friction?: number
  /** 贡献方块的弹性（碰撞恢复系数） */
  restitution?: number
  /**
   * 物理世界宽度。
   * 谨慎修改：方块横向布局、文字居中位置与最终 SVG 宽度都由它推算，改动后请自行核对效果
   */
  width?: number
  /**
   * 物理世界高度。
   * 谨慎修改：方块起始高度、文字纵向位置与最终 SVG 高度都由它推算，改动后请自行核对效果
   */
  height?: number
  /**
   * 贡献方块边长。
   * 谨慎修改：边长过大会让方块矩阵超出世界边界，改动后请自行核对效果
   */
  size?: number
  /**
   * 贡献方块间距。
   * 谨慎修改：间距过大会让方块矩阵超出世界边界，改动后请自行核对效果
   */
  interval?: number
  /**
   * 最大模拟时间（秒，按动画播放时长计）。
   * 模拟时长达到它乘以播放速度后停止模拟，直接返回已模拟出的轨迹，
   */
  maxSimulationTime?: number
  /**
   * 自定义字体（.ttf/.otf）：本地路径、远程 URL（字符串或 URL 对象），或
   * Buffer / ArrayBuffer，
   * 默认使用内置的 Liberation Serif Bold。
   * 谨慎修改：轮廓不规整（未闭合、自相交等）的字体，分解出的碰撞形状可能不可靠；
   * 另有部分字体因 opentype.js 的 GSUB 解析限制无法使用
   */
  font?: FontSource
  /** 内部调试用：提供贡献图数据时跳过 fetchContributions 网络请求，直接以该数据模拟 */
  calendarList?: CalendarResponse
}

/** 创建完成的世界与其中的物体引用，可交给渲染器预览或自行迭代 */
export interface SimulationWorld {
  world: World
  /** 贡献方块 */
  contributions: Contribution[]
  textPaths: TextPathResult[]
  /** 文字在物理世界中的 X 偏移量 */
  offsetX: number
  /** 文字在物理世界中的 Y 偏移量 */
  centerY: number
}

/**
 * 创建模拟世界并放入全部物体：地面、墙壁、用户名文字碰撞体与贡献方块。
 */
export async function createSimulationWorld(
  options: SimulationOptions
): Promise<SimulationWorld> {
  const {
    username,
    text = username,
    textTop,
    shape,
    font,
    size,
    interval,
    fontSize,
    width,
    height,
    friction,
    restitution,
    calendarList
  } = withDefaults(DEFAULT_OPTIONS, options)
  const world = await createWorld(width, height)
  const contributions: Contribution[] = []

  // 创建用户名文字静止碰撞体（居中对齐）
  const textPaths = await getTextPaths(text, fontSize, font)

  const { centerY, offsetX } = getTextBoundBox(textPaths, {
    width,
    height,
    textTop
  })

  for (const { paths } of textPaths) {
    const { polygons } = paths
    if (!polygons.length) continue
    // 同一字形的全部凸块挂在共享的静止刚体上，作为 compound collider 参与碰撞
    const textBody = world.createRigidBody(
      RigidBodyDesc.fixed().setTranslation(offsetX, centerY)
    )
    for (const polygon of polygons) {
      // 翻转 Y 轴：opentype 字形在基线下方（y 为负），物理世界需要正向
      const flippedVertices = new Float32Array(polygon.length * 2)
      for (let i = 0; i < polygon.length; i++) {
        flippedVertices[i * 2] = polygon[i][0]
        flippedVertices[i * 2 + 1] = -polygon[i][1]
      }
      // 顶点近乎共线的退化凸块求不出凸包，跳过
      // 文字摩擦为固定值，不随贡献块的 friction 选项调整
      const colliderDesc = ColliderDesc.convexHull(flippedVertices)
      if (!colliderDesc) continue
      world.createCollider(colliderDesc.setFriction(0.3), textBody)
    }
  }

  const githubContributions =
    calendarList ?? (await fetchContributions(username))

  const rowLen = githubContributions.contributions.length
  const rowWidth = size * rowLen + interval * (rowLen - 1)
  // left 是矩阵左边缘，而碰撞体按中心定位，首列中心需再右移半个方块
  const left = (width - rowWidth) / 2 + size / 2
  const top = height * 1

  for (let rowIndex = 0; rowIndex < rowLen; rowIndex++) {
    const col = githubContributions.contributions[rowIndex]
    for (let j = 0; j < col.length; j++) {
      const contributionDay = col[j]

      const dayOfWeek = new Date(contributionDay.date).getDay()

      if (contributionDay.count) {
        const x = left + (interval + size) * rowIndex
        const y = top + (interval + size) * dayOfWeek
        const colliderDesc = (
          shape === 'square'
            ? ColliderDesc.cuboid(size / 2, size / 2)
            : ColliderDesc.ball(size / 2)
        )
          .setFriction(friction)
          .setRestitution(restitution)
        const boxCollider = world.createCollider(
          colliderDesc,
          world.createRigidBody(
            RigidBodyDesc.dynamic()
              .setGravityScale(GRAVITY)
              .setTranslation(x, y)
              .setLinearDamping(0.05)
          )
        )

        contributions.push(
          new Contribution(contributionDay, boxCollider, shape === 'square')
        )
      }
    }
  }

  return {
    world,
    contributions,
    textPaths,
    offsetX,
    centerY
  }
}

/**
 * 开始模拟
 */
export async function startSimulation(
  options: SimulationOptions
): Promise<SimulationResult> {
  const {
    shape,
    size,
    compressionAlgorithm,
    compressionTolerance,
    disableCompression,
    jointPosition,
    maxSimulationTime,
    speed
  } = withDefaults(DEFAULT_OPTIONS, options)
  const { world, contributions, textPaths, offsetX, centerY } =
    await createSimulationWorld(options)

  // 容差从 SVG 坐标单位换算回物理坐标单位，让压缩函数与渲染缩放解耦
  const tolerance = compressionTolerance / SCALE

  /** 判断所有贡献块的刚体是否都已静止（线速度与角速度均低于阈值） */
  function areAllCollidersSleeping(): boolean {
    for (const contribution of contributions) {
      const body = contribution.collider.parent()
      if (body) {
        const linvel = body.linvel()
        const angvel = body.angvel()
        if (
          Math.abs(linvel.x) > VELOCITY_THRESHOLD ||
          Math.abs(linvel.y) > VELOCITY_THRESHOLD ||
          Math.abs(angvel) > VELOCITY_THRESHOLD
        ) {
          return false
        }
      }
    }
    return true
  }

  let stepCount = 0
  /** 连续静止帧计数，任何一帧仍有物体在运动即清零 */
  let stillFrames = 0
  const startTime = Date.now()
  while (true) {
    world.step()
    stepCount++

    for (const contribution of contributions) {
      contribution.update()
    }

    pruneFallenBlocks(world, contributions, size)

    // 连续多帧静止才判定完成：弹跳顶点的瞬时零速凑不满确认帧数，不会误停
    stillFrames = areAllCollidersSleeping() ? stillFrames + 1 : 0
    if (stillFrames >= SETTLE_CONFIRM_FRAMES) {
      // 确认静止多记录了 SETTLE_CONFIRM_FRAMES 帧，其间所有物体均已不再移动，
      stepCount -= SETTLE_CONFIRM_FRAMES
      for (const contribution of contributions) {
        contribution.truncateTail(SETTLE_CONFIRM_FRAMES)
      }
      break
    }
    // 最大模拟时间以播放时长计：模拟时长达到它乘以倍速即停止，返回已模拟出的轨迹
    if (
      maxSimulationTime !== undefined &&
      stepCount * TIMESTEP >= maxSimulationTime * speed
    ) {
      break
    }
    // 方块参数异常时模拟可能永不静止，未设时限时超出保护步数直接报错
    if (maxSimulationTime === undefined && stepCount >= MAX_STEPS) {
      throw new Error(
        `Simulation failed to settle within ${MAX_STEPS} steps (${MAX_STEPS * TIMESTEP} simulated seconds)`
      )
    }
  }

  const endTime = Date.now()

  return {
    stepCount,
    time: endTime - startTime,
    contributions: contributions.map((contribution): RenderedContribution => {
      const json = contribution.toJSON()
      // 位置与自转按各自容差独立分段，旋转剧变不会迫使位置加密
      return {
        date: json.date,
        color: json.color,
        trajectory: disableCompression
          ? toKeyframeTrajectory(json.trajectory)
          : compressTrajectory(
              json.trajectory,
              tolerance,
              shape === 'square' ? MAX_ROTATION_ERROR : 0,
              compressionAlgorithm,
              jointPosition
            )
      }
    }),
    textPaths: textPaths.map(({ pathData, rect }) => ({
      pathData: pathData,
      rect: rect
    })),
    offsetX,
    centerY
  }
}
