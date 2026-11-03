/**
 * Rapier 碰撞箱调试页面入口：把演示世界交给通用渲染器预览。
 *
 * 想预览其他世界（如 src/utils/physics 的 createSimulationWorld 产出的
 * github-gravity 模拟世界），换掉这里的 createWorld 与 bounds 即可，
 * 注意二者的物理步长也要与对应世界一致。
 */

import {
  Contribution,
  createSimulationWorld,
  pruneFallenBlocks
} from '../../utils/physics'
import { DEFAULT_FONT_URL } from '../const'
import { BOUNDS, TIMESTEP } from './demoWorld'
import { runWorldViewer } from './viewer'

/** 调试世界的贡献方块边长，pruneFallenBlocks 的清理深度由它决定 */
const SIZE = 4

let contributions: Contribution[] = []

await runWorldViewer({
  createWorld: async () => {
    const simulation = await createSimulationWorld({
      username: 'Orta',
      shape: 'square',
      font: DEFAULT_FONT_URL,
      width: 100,
      size: SIZE
    })
    contributions = simulation.contributions
    return simulation.world
  },
  bounds: BOUNDS,
  timestep: TIMESTEP,
  playbackSpeed: 1,
  afterStep: (world) => pruneFallenBlocks(world, contributions, SIZE)
})
