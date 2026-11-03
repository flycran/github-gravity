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
  FRICTION,
  GRAVITY,
  MAX_STEPS,
  SCALE,
  TIMESTEP,
  VELOCITY_THRESHOLD
} from '../const'
import {
  fetchContributions,
  INTENSITY_COLORS,
  RawContributionDay
} from './githubContributions'
import { FontSource, getTextPaths } from './parseTextPath'
import {
  CompressedTrajectoryPoint,
  simplifyTrajectoryDP,
  simplifyTrajectoryGreedy,
  simplifyTrajectoryRDP
} from './simplifyTrajectory'
import { withDefaults } from './withDefaults'

/** 压缩算法名 → 实现，供 compressionAlgorithm 选项分发 */
const COMPRESSION_ALGORITHMS: Record<
  NonNullable<SimulationOptions['compressionAlgorithm']>,
  (
    trajectory: Point[],
    tolerance: number,
    maxRotationError?: number
  ) => CompressedTrajectoryPoint[]
> = {
  DP: simplifyTrajectoryDP,
  RDP: simplifyTrajectoryRDP,
  Greedy: simplifyTrajectoryGreedy
}

/** 把自转角解缠绕到与上一帧连续（差收敛到 ±π 内），保证轨迹角度可直接线性插值 */
function unwrapRotation(next: number, prev: number): number {
  let rotation = next
  while (rotation - prev > Math.PI) rotation -= Math.PI * 2
  while (prev - rotation > Math.PI) rotation += Math.PI * 2
  return rotation
}

/** 方形自转轨迹的角度插值误差上限，与位置的压缩容差相互独立 */
const MAX_ROTATION_ERROR = (3 * Math.PI) / 180

export interface ContributionJson {
  date: string
  color: string
  trajectory: Point[]
}

export class Contribution implements ContributionJson {
  date: string
  x: number
  y: number
  color: string

  trajectory: Point[]

  /** 方形碰撞体会翻滚，需要记录自转角；圆形旋转不影响外观 */
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
    this.trajectory = []
    this.trajectory.push(this.recordPoint(pos))
  }

  update() {
    const pos = this.collider.translation()
    this.x = pos.x
    this.y = pos.y
    this.trajectory.push(this.recordPoint(pos))
  }

  /** 记录当前时刻的位置；方形再记录自转角（解缠绕保持连续） */
  private recordPoint(pos: { x: number; y: number }): Point {
    if (!this.trackRotation) return { x: pos.x, y: pos.y }
    const last = this.trajectory[this.trajectory.length - 1]
    return {
      x: pos.x,
      y: pos.y,
      rotation: unwrapRotation(this.collider.rotation(), last?.rotation ?? 0)
    }
  }

  getTrajectory() {
    return this.trajectory
  }

  toJSON(): ContributionJson {
    return {
      color: this.color,
      date: this.date,
      trajectory: this.trajectory
    }
  }
}

async function createWord(width: number, height: number) {
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

export interface Point {
  x: number
  y: number
  /**
   * 方块自转角（弧度，已解缠绕保持连续，可直接线性插值）。
   * 方形碰撞体会翻滚才记录；圆形旋转不影响外观，不携带
   */
  rotation?: number
  /**
   * 启用压缩时，该点与前一个保留点的原始索引差，用于还原关键帧的时间位置；
   * 未压缩时不存在，消费端回退到 SMIL 默认的均分时间
   */
  span?: number
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

export interface SimulationResult {
  stepCount: number
  time: number
  textPaths: Pick<TextPathResult, 'rect' | 'pathData'>[]
  contributions: ContributionJson[]
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
   * 轨迹压缩容差，单位 SVG 像素。播放时每个原始时刻的插值位置与真实位置的
   * 偏差不超过该值；0 为完全无损（位置与节奏都精确），仅压缩匀速直线段和静止段。
   */
  compressionTolerance?: number
  /** 禁用轨迹压缩，保留完整轨迹 */
  disableCompression?: boolean
  /**
   * 轨迹压缩算法：Greedy（单遍贪心，快，默认）、DP（动态规划全局最优，长轨迹秒级）、
   * RDP（时空版 Ramer-Douglas-Peucker，最快，关键帧略多）
   */
  compressionAlgorithm?: 'Greedy' | 'DP' | 'RDP'
  /** 贡献方块的形状：circle（圆形）或 square（方形） */
  shape?: 'circle' | 'square'
  /**
   * 物理世界宽度，默认 300。
   * 谨慎修改：方块横向布局、文字居中位置与最终 SVG 宽度都由它推算，改动后请自行核对效果
   */
  width?: number
  /**
   * 物理世界高度，默认 150。
   * 谨慎修改：方块起始高度、文字纵向位置与最终 SVG 高度都由它推算，改动后请自行核对效果
   */
  height?: number
  /**
   * 贡献方块边长，默认 4。
   * 谨慎修改：边长越大越容易相互挤压甚至穿透文字，改动后请自行核对效果
   */
  size?: number
  /**
   * 贡献方块间距，默认 1.5。
   * 谨慎修改：间距过小会互相堆叠，过大会超出世界边界，改动后请自行核对效果
   */
  interval?: number
  /**
   * 最大模拟时间（秒，按动画播放时长计），没有默认值。
   * 模拟时长达到它乘以播放速度后停止模拟，直接返回已模拟出的轨迹，
   * 不再等待全部方块静止；不传则一直模拟到全部静止，
   * 超出 MAX_STEPS 步仍未静止会直接报错
   */
  maxSimulationTime?: number
  /**
   * 自定义字体（.ttf/.otf）：本地路径、远程 URL（字符串或 URL 对象），或
   * 已读取好的 Buffer / ArrayBuffer（如 `files[0].arrayBuffer()` 的结果），
   * 默认使用内置的 Liberation Serif Bold。
   * 谨慎修改：轮廓不规整（未闭合、自相交等）的字体，分解出的碰撞形状可能不可靠；
   * 另有部分字体因 opentype.js 的 GSUB 解析限制无法使用。
   * 字体度量差异也可能导致文字位置和碰撞形态需要重新调整
   */
  font?: FontSource
}

/** 创建完成的世界与其中的物体引用，可交给渲染器预览或自行迭代 */
export interface SimulationWorld {
  world: World
  /** 贡献方块（含轨迹记录器），每步迭代后调用 update 采集轨迹 */
  contributions: Contribution[]
  textPaths: TextPathResult[]
  /** 文字在物理世界中的 X 偏移量 */
  offsetX: number
  /** 文字在物理世界中的 Y 偏移量 */
  centerY: number
}

/**
 * 创建模拟世界并放入全部物体：地面、墙壁、用户名文字碰撞体与贡献方块。
 * 与迭代逻辑分离，便于把 world 交给渲染器（如 web/rapier 调试页）直接预览；
 * startSimulation 在它返回后负责迭代与轨迹收集
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
    height
  } = withDefaults(DEFAULT_OPTIONS, options)
  const world = await createWord(width, height)
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
      const colliderDesc = ColliderDesc.convexHull(flippedVertices)
      if (!colliderDesc) continue
      world.createCollider(colliderDesc.setFriction(FRICTION), textBody)
    }
  }

  const githubContributions = await fetchContributions(username)

  const rowLen = githubContributions.contributions.length
  const rowWidth = size * rowLen + interval * (rowLen - 1)
  // left 是矩阵左边缘，而碰撞体按中心定位，首列中心需再右移半个方块
  const left = (width - rowWidth) / 2 + size / 2
  const top = height * 1

  for (let rowIndex = 0; rowIndex < rowLen; rowIndex++) {
    const col = githubContributions.contributions[rowIndex]
    for (let j = 0; j < col.length; j++) {
      const contributionDay = col[j]

      if (!contributionDay.date) {
        console.log(contributionDay)
      }

      const dayOfWeek = new Date(contributionDay.date).getDay()

      if (contributionDay.count) {
        const x = left + (interval + size) * rowIndex
        const y = top + (interval + size) * dayOfWeek
        const colliderDesc = (
          shape === 'square'
            ? ColliderDesc.cuboid(size / 2, size / 2)
            : ColliderDesc.ball(size / 2)
        )
          .setFriction(FRICTION)
          .setRestitution(0.4)
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

export async function startSimulation(
  options: SimulationOptions
): Promise<SimulationResult> {
  const {
    shape,
    compressionAlgorithm,
    compressionTolerance,
    disableCompression,
    maxSimulationTime,
    speed
  } = withDefaults(DEFAULT_OPTIONS, options)
  const { world, contributions, textPaths, offsetX, centerY } =
    await createSimulationWorld(options)

  // 容差从 SVG 像素换算回物理坐标单位，让压缩函数与渲染缩放解耦；
  // 显式禁用压缩时保留原始轨迹，消费端回退到 SMIL 默认均分时间
  const tolerance = compressionTolerance / SCALE

  /** 判断所有 collider 的刚体是否都已静止（线速度与角速度均低于阈值） */
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
  const startTime = Date.now()
  while (true) {
    world.step()
    stepCount++

    for (const contribution of contributions) {
      contribution.update()
    }

    if (stepCount > 2 && areAllCollidersSleeping()) break
    // 最大模拟时间以播放时长计：模拟时长达到它乘以倍速即停止，返回已模拟出的轨迹
    if (
      maxSimulationTime !== undefined &&
      stepCount * TIMESTEP >= maxSimulationTime * speed
    ) {
      break
    }
    // 方块参数异常时模拟可能永不静止，未设时限时超出保护步数直接报错而不是无限挂起
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
    contributions: contributions.map((contribution) => {
      const json = contribution.toJSON()
      return !disableCompression
        ? {
            ...json,
            trajectory: COMPRESSION_ALGORITHMS[compressionAlgorithm](
              json.trajectory,
              tolerance,
              shape === 'square' ? MAX_ROTATION_ERROR : 0
            )
          }
        : json
    }),
    textPaths: textPaths.map(({ pathData, rect }) => ({
      pathData: pathData,
      rect: rect
    })),
    offsetX,
    centerY
  }
}
