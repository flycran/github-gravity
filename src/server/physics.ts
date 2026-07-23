import {
  Collider,
  ColliderDesc,
  init,
  RigidBodyDesc,
  World
} from '@dimforge/rapier2d-compat'
import {
  ContributionJson,
  HEIGHT,
  INTERVAL,
  SIZE,
  SimulationResult,
  TEXT_TOP,
  WIDTH
} from '../utils'
import {
  fetchContributions,
  INTENSITY_COLORS,
  RawContributionDay
} from './github-contributions'
import { getTextPaths } from './parseTextPath'

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

async function createWord() {
  await init()
  // 重力
  const world = new World({ x: 0.0, y: -30 })
  world.lengthUnit = 16

  // 地面
  world.createCollider(
    ColliderDesc.cuboid(WIDTH, 1),
    world.createRigidBody(RigidBodyDesc.fixed().setTranslation(0, -1))
  )
  // 墙壁
  world.createCollider(
    ColliderDesc.cuboid(1, HEIGHT),
    world.createRigidBody(RigidBodyDesc.fixed().setTranslation(WIDTH, 0))
  )
  world.createCollider(
    ColliderDesc.cuboid(1, HEIGHT),
    world.createRigidBody(RigidBodyDesc.fixed().setTranslation(-1, 0))
  )

  return world
}

/** 速度小于此阈值视为静止 */
const VELOCITY_THRESHOLD = 1e-3

export async function startSimulation(
  username: string,
  text: string = username
): Promise<SimulationResult> {
  const world = await createWord()
  const contributionsSet = new Set<Contribution>()

  // 创建用户名文字静止刚体（居中对齐），同时收集三角网格数据
  const textPaths = getTextPaths(text)

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
  const offsetX = WIDTH / 2 - bboxCenterX
  // 文字顶部距离世界顶部的距离
  const centerY = HEIGHT - TEXT_TOP - maxY
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
        RigidBodyDesc.fixed().setTranslation(offsetX, centerY)
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

  function createContribution(
    contributionDay: RawContributionDay,
    x: number,
    y: number
  ) {
    // 动态刚体
    const boxCollider = world.createCollider(
      ColliderDesc.cuboid(SIZE / 2, SIZE / 2).setFriction(0.2),
      world.createRigidBody(
        RigidBodyDesc.dynamic().setCcdEnabled(true).setTranslation(x, y)
      )
    )

    contributionsSet.add(new Contribution(contributionDay, boxCollider))
  }

  const githubContributions = await fetchContributions(username)

  const rowLen = githubContributions.contributions.length
  const rowWidth = SIZE * rowLen + INTERVAL * (rowLen - 1)
  const left = (WIDTH - rowWidth) / 2
  const top = HEIGHT * 1

  for (let rowIndex = 0; rowIndex < rowLen; rowIndex++) {
    const col = githubContributions.contributions[rowIndex]
    for (let j = 0; j < col.length; j++) {
      const contributionDay = col[j]

      if (!contributionDay.date) {
        console.log(contributionDay)
      }

      const dayOfWeek = new Date(contributionDay.date).getDay()

      if (contributionDay.count) {
        createContribution(
          contributionDay,
          left + (INTERVAL + SIZE) * rowIndex,
          top + (INTERVAL + SIZE) * dayOfWeek
        )
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
    contributions: Array.from(contributionsSet).map((contribution) =>
      contribution.toJSON()
    ),
    textPaths: textPaths.map(({ pathData, rect }) => ({
      pathData: pathData,
      rect: rect
    })),
    textTriangles
  }
}
