/**
 * Rapier 碰撞箱调试页面入口：把演示世界交给通用渲染器预览。
 *
 * 想预览其他世界（如 src/utils/physics 的 createSimulationWorld 产出的
 * github-gravity 模拟世界），换掉这里的 createWorld 与 bounds 即可，
 * 注意二者的物理步长也要与对应世界一致。
 */

import { createSimulationWorld } from '../../utils/physics'
import { DEFAULT_FONT_URL } from '../const'
import { BOUNDS, createDemoWorld, TIMESTEP } from './demoWorld'
import { runWorldViewer } from './viewer'

await runWorldViewer({
  createWorld: () =>
    createSimulationWorld({
      username: 'Orta',
      shape: 'square',
      font: DEFAULT_FONT_URL
    }).then((e) => e.world),
  bounds: BOUNDS,
  timestep: TIMESTEP,
  playbackSpeed: 1
})
