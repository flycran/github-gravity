import { SimulationOptions, startSimulation } from './physics'
import { renderSvg } from './utils/render'

/**
 * 生成贡献方块重力模拟的 SVG 动画字符串。
 * 模拟 GitHub 用户的贡献方块从上方掉落，最终静止在底部。
 *
 * @param options - 包含 GitHub 用户名
 * @returns 完整的 SVG 字符串
 */
export async function gensvg(options: SimulationOptions): Promise<string> {
  return renderSvg(await startSimulation(options))
}
