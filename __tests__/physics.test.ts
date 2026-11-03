/**
 * Unit test: the lazy world boundary that prunes blocks fallen below the view.
 */
import { describe, expect, it } from 'bun:test'
import {
  ColliderDesc,
  init,
  RigidBodyDesc,
  World
} from '@dimforge/rapier2d-compat'
import { Contribution, pruneFallenBlocks } from '../src/utils/physics'

/** 在指定高度直接摆放一个贡献方块，不经过物理演化 */
function placeBlock(world: World, y: number): Contribution {
  const collider = world.createCollider(
    ColliderDesc.ball(2),
    world.createRigidBody(RigidBodyDesc.dynamic().setTranslation(10, y))
  )
  return new Contribution(
    { date: '2026-11-03', intensity: 2, count: 1 },
    collider,
    false
  )
}

describe('pruneFallenBlocks', () => {
  it('removes blocks fallen below the world bottom and keeps the rest', async () => {
    await init()
    const world = new World({ x: 0, y: -9.81 })
    const size = 4
    // 一个已掉出两倍块深、一个仍在画面内：清理必须只作用于前者
    const fallen = placeBlock(world, -2 * size - 1)
    const resting = placeBlock(world, 75)
    const contributions = [fallen, resting]

    pruneFallenBlocks(world, contributions, size)

    expect(contributions.length).toBe(1)
    expect(contributions[0]).toBe(resting)
  })

  it('keeps a block resting exactly at the removal depth', async () => {
    await init()
    const world = new World({ x: 0, y: -9.81 })
    const size = 4
    // 恰好在两倍块深处不算掉出：边界语义是严格小于
    const boundary = placeBlock(world, -2 * size)
    const contributions = [boundary]

    pruneFallenBlocks(world, contributions, size)

    expect(contributions[0]).toBe(boundary)
  })
})
