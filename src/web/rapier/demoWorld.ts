/* ---- 演示场景参数：改这里就能调整布局 ---- */

import { ColliderDesc, RigidBodyDesc, World } from '@dimforge/rapier2d-compat'

/** 固定物理步长（秒），由渲染循环按真实耗时累加后消耗 */
export const TIMESTEP = 1 / 60

/** 正方形矩阵中心的 y 坐标 */
const MATRIX_Y = 80
/** 矩阵列数（横向） */
const MATRIX_COLUMNS = 52
/** 矩阵行数（纵向） */
const MATRIX_ROWS = 7
/** 正方形边长 */
const SQUARE_SIZE = 2.5
/** 相邻正方形之间的间隙 */
const SQUARE_GAP = 1
/** 圆形直径 */
const CIRCLE_SIZE = 12
/** 圆形与矩阵底部的间隙 */
const CIRCLE_GAP = 12

/** 演示世界的物理边界（y 轴向上），同时决定坐标映射与相机取景 */
export const BOUNDS = { minX: 0, maxX: 200, minY: 0, maxY: 100 }

export const width = BOUNDS.maxX - BOUNDS.minX
export const height = BOUNDS.maxY - BOUNDS.minY

/** 演示场景：地面 + 下落的正方形矩阵 + 下方的圆形障碍 */
export function createDemoWorld(): World {
  const world = new World({ x: 0, y: -9.81 })
  world.timestep = TIMESTEP
  const centerX = (BOUNDS.minX + BOUNDS.maxX) / 2

  // 地面
  world.createCollider(
    ColliderDesc.cuboid(width / 2, 1).setFriction(0.2),
    world.createRigidBody(RigidBodyDesc.fixed().setTranslation(width / 2, -1))
  )
  // 墙壁
  world.createCollider(
    ColliderDesc.cuboid(1, height).setFriction(0.2),
    world.createRigidBody(
      RigidBodyDesc.fixed().setTranslation(width + 1, height)
    )
  )
  world.createCollider(
    ColliderDesc.cuboid(1, height).setFriction(0.2),
    world.createRigidBody(RigidBodyDesc.fixed().setTranslation(-1, height))
  )

  // 正方形按尺寸 + 间隙排布，矩阵整体以 (centerX, MATRIX_Y) 为中心
  const step = SQUARE_SIZE + SQUARE_GAP
  const halfSize = SQUARE_SIZE / 2

  for (let row = 0; row < MATRIX_ROWS; row++) {
    for (let column = 0; column < MATRIX_COLUMNS; column++) {
      const x = centerX + (column - (MATRIX_COLUMNS - 1) / 2) * step
      const y = MATRIX_Y + ((MATRIX_ROWS - 1) / 2 - row) * step

      world.createCollider(
        ColliderDesc.cuboid(halfSize, halfSize).setFriction(0.2),
        world.createRigidBody(RigidBodyDesc.dynamic().setTranslation(x, y))
      )
    }
  }

  // 圆形固定在矩阵正下方，让下落的方块撞上去
  const matrixBottom = MATRIX_Y - ((MATRIX_ROWS - 1) / 2) * step - halfSize
  const circleY = matrixBottom - CIRCLE_GAP - CIRCLE_SIZE / 2

  world.createCollider(
    ColliderDesc.ball(CIRCLE_SIZE / 2).setRestitution(0.2),
    world.createRigidBody(
      RigidBodyDesc.fixed().setTranslation(centerX, circleY)
    )
  )

  return world
}
