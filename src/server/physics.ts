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
  WIDTH
} from '../utils'
import {
  fetchContributions,
  INTENSITY_COLORS,
  RawContributionDay
} from './github-contributions'

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
  const world = new World({ x: 0.0, y: -16 })
  world.lengthUnit = 10

  // 地面
  world.createCollider(
    ColliderDesc.cuboid(WIDTH, 1),
    world.createRigidBody(
      RigidBodyDesc.fixed().setCcdEnabled(true).setTranslation(0, -1)
    )
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
  username: string
): Promise<SimulationResult> {
  const world = await createWord()
  const contributionsSet = new Set<Contribution>()

  function createContribution(
    contributionDay: RawContributionDay,
    x: number,
    y: number
  ) {
    // 动态刚体
    const boxCollider = world.createCollider(
      ColliderDesc.cuboid(SIZE / 2, SIZE / 2),
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
  const top = HEIGHT * 0.9

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
    )
  }
}
