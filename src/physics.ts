import {
  Collider,
  ColliderDesc,
  init,
  RigidBodyDesc,
  World
} from '@dimforge/rapier2d-compat'
import { FontSource, getTextPaths } from './parseTextPath'
import {
  ContributionJson,
  HEIGHT,
  INTERVAL,
  SCALE,
  SIZE,
  SimulationResult,
  WIDTH
} from './utils'
import {
  fetchContributions,
  INTENSITY_COLORS,
  RawContributionDay
} from './utils/githubContributions'
import {
  CompressedTrajectoryPoint,
  simplifyTrajectoryDP,
  simplifyTrajectoryGreedy,
  simplifyTrajectoryRDP
} from './utils/simplifyTrajectory'

/** 压缩算法名 → 实现，供 compressionAlgorithm 选项分发 */
const COMPRESSION_ALGORITHMS: Record<
  NonNullable<SimulationOptions['compressionAlgorithm']>,
  (
    trajectory: { x: number; y: number }[],
    tolerance: number
  ) => CompressedTrajectoryPoint[]
> = {
  DP: simplifyTrajectoryDP,
  RDP: simplifyTrajectoryRDP,
  Greedy: simplifyTrajectoryGreedy
}

export class Contribution implements ContributionJson {
  date: string
  x: number
  y: number
  color: string

  trajectory: {
    x: number
    y: number
  }[]

  collider: Collider

  constructor(contributionDay: RawContributionDay, collider: Collider) {
    this.collider = collider
    this.date = contributionDay.date
    this.color = INTENSITY_COLORS[contributionDay.intensity]
    const pos = collider.translation()
    this.x = pos.x
    this.y = pos.y
    this.trajectory = [{ x: pos.x, y: pos.y }]
  }

  update() {
    const pos = this.collider.translation()
    this.x = pos.x
    this.y = pos.y
    this.trajectory.push({ x: pos.x, y: pos.y })
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
  const world = new World({ x: 0.0, y: -30 })
  world.lengthUnit = 32

  // 地面
  world.createCollider(
    ColliderDesc.cuboid(width, 1),
    world.createRigidBody(RigidBodyDesc.fixed().setTranslation(0, -1))
  )
  // 墙壁
  world.createCollider(
    ColliderDesc.cuboid(1, height),
    world.createRigidBody(RigidBodyDesc.fixed().setTranslation(width, 0))
  )
  world.createCollider(
    ColliderDesc.cuboid(1, height),
    world.createRigidBody(RigidBodyDesc.fixed().setTranslation(-1, 0))
  )

  return world
}

/** 速度小于此阈值视为静止 */
const VELOCITY_THRESHOLD = 1e-3

export interface SimulationOptions {
  username: string
  text?: string
  /** 文字到顶部的距离 */
  textTop?: number
  /** 字体大小 */
  fontSize?: number
  /** 一步的时间，单位为ms，越小速度越快 */
  stepTime?: number
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
  /** 贡献方块的形状：circle（圆形）或 square（方形）。圆形物理模拟更丝滑，不容易穿模。 */
  shape?: 'circle' | 'square'
  /** 背景颜色，默认透明 */
  backgroundColor?: string
  /** 文字颜色，默认黑色 */
  textColor?: string
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
   * 自定义字体（.ttf/.otf）：本地路径、远程 URL（字符串或 URL 对象），或
   * 已读取好的 Buffer / ArrayBuffer（如 `files[0].arrayBuffer()` 的结果），
   * 默认使用内置的 Liberation Serif Bold。
   * 谨慎修改：部分字体存在未闭合或自相交的轮廓，操作系统渲染时会自动忽略这些瑕疵，
   * 但本项目的轮廓三角化算法会直接报错；另有部分字体因 opentype.js 的 GSUB 解析限制无法使用。
   * 字体度量差异也可能导致文字位置和碰撞形态需要重新调整
   */
  font?: FontSource
}

export async function startSimulation({
  username,
  text = username,
  textTop = 50,
  fontSize = 80,
  stepTime = 8,
  shape = 'circle',
  backgroundColor = 'transparent',
  textColor = 'black',
  compressionTolerance = 0.5,
  disableCompression = false,
  compressionAlgorithm = 'Greedy',
  width = WIDTH,
  height = HEIGHT,
  size = SIZE,
  interval = INTERVAL,
  font
}: SimulationOptions): Promise<SimulationResult> {
  const world = await createWord(width, height)
  const contributionsSet = new Set<Contribution>()

  // 容差从 SVG 像素换算回物理坐标单位，让压缩函数与渲染缩放解耦；
  // 显式禁用压缩时保留原始轨迹，消费端回退到 SMIL 默认均分时间
  const tolerance = compressionTolerance / SCALE

  // 创建用户名文字静止刚体（居中对齐），同时收集三角网格数据
  const textPaths = await getTextPaths(text, fontSize, font)

  // 计算所有字形的整体包围盒（翻转 Y 轴后）
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
  const textTriangles: number[][] = []

  for (const { paths } of textPaths) {
    const { vertices, indices } = paths
    if (!vertices.length && !indices.length) continue
    // 翻转 Y 轴：opentype 字形在基线下方（y 为负），物理世界需要正向
    const flippedVertices = new Float32Array(vertices.length)
    for (let i = 0; i < vertices.length; i += 2) {
      flippedVertices[i] = vertices[i]
      flippedVertices[i + 1] = -vertices[i + 1]
    }
    world.createCollider(
      ColliderDesc.trimesh(flippedVertices, indices),
      world.createRigidBody(
        RigidBodyDesc.fixed()
          .setCcdEnabled(true)
          .setTranslation(offsetX, centerY)
      )
    )
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 2,
        i1 = indices[i + 1] * 2,
        i2 = indices[i + 2] * 2
      textTriangles.push([
        offsetX + flippedVertices[i0],
        centerY + flippedVertices[i0 + 1],
        offsetX + flippedVertices[i1],
        centerY + flippedVertices[i1 + 1],
        offsetX + flippedVertices[i2],
        centerY + flippedVertices[i2 + 1]
      ])
    }
  }

  const githubContributions = await fetchContributions(username)

  const rowLen = githubContributions.contributions.length
  const rowWidth = size * rowLen + interval * (rowLen - 1)
  const left = (width - rowWidth) / 2
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
        // 动态刚体：圆形物理模拟更丝滑，不容易穿模
        const colliderDesc =
          shape === 'square'
            ? ColliderDesc.cuboid(size / 2, size / 2).setFriction(0.2)
            : ColliderDesc.ball(size / 2).setFriction(0.2)
        const boxCollider = world.createCollider(
          colliderDesc,
          world.createRigidBody(
            RigidBodyDesc.dynamic().setCcdEnabled(true).setTranslation(x, y)
          )
        )

        contributionsSet.add(new Contribution(contributionDay, boxCollider))
      }
    }
  }

  /** 判断所有 collider 的刚体是否都已静止（线速度与角速度均低于阈值） */
  function areAllCollidersSleeping(): boolean {
    for (const contribution of contributionsSet) {
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

    for (const contribution of contributionsSet) {
      contribution.update()
    }

    if (areAllCollidersSleeping()) break
  }

  const endTime = Date.now()

  return {
    stepCount,
    time: endTime - startTime,
    shape,
    contributions: Array.from(contributionsSet).map((contribution) => {
      const json = contribution.toJSON()
      return !disableCompression
        ? {
            ...json,
            trajectory: COMPRESSION_ALGORITHMS[compressionAlgorithm](
              json.trajectory,
              tolerance
            )
          }
        : json
    }),
    textPaths: textPaths.map(({ pathData, rect }) => ({
      pathData: pathData,
      rect: rect
    })),
    textTriangles,
    offsetX,
    centerY,
    stepTime,
    backgroundColor,
    textColor,
    width,
    height,
    size
  }
}
