import { startSimulation } from './server/physics'
import type { ContributionJson, SimulationResult } from './utils'
import { HEIGHT, SCALE, SIZE, WIDTH } from './utils'

export interface GensvgOptions {
  username: string
  text: string
  fontSize?: number
  /** 轨迹采样率，每隔 N 步记录一个轨迹点。默认为 1（不采样）。值越大，SVG 越小 */
  sampleRate?: number
}

/**
 * 生成贡献方块重力模拟的 SVG 动画字符串。
 * 模拟 GitHub 用户的贡献方块从上方掉落，最终静止在底部。
 *
 * @param options - 包含 GitHub 用户名
 * @returns 完整的 SVG 字符串
 */
export async function gensvg({
  username,
  text,
  fontSize,
  sampleRate
}: GensvgOptions): Promise<string> {
  const result: SimulationResult = await startSimulation({
    username,
    text,
    fontSize,
    sampleRate
  })

  const svgWidth = WIDTH * SCALE
  const svgHeight = HEIGHT * SCALE

  // 生成每个贡献方块的 SVG 元素
  const contributionsSvg = result.contributions
    .map((contribution: ContributionJson) => {
      // 轨迹坐标转换：物理坐标 → SVG 坐标（Y 轴翻转）
      const values = contribution.trajectory
        .map(
          ({ x, y }) =>
            `${+(x * SCALE).toFixed(2)},${+((HEIGHT - y) * SCALE).toFixed(2)}`
        )
        .join(';')

      return `  <g data-date="${contribution.date}">
    <rect
      width="${SIZE * SCALE}"
      height="${SIZE * SCALE}"
      x="-${(SIZE / 2) * SCALE}"
      y="-${(SIZE / 2) * SCALE}"
      fill="${contribution.color}"
    />
    <animateTransform
      attributeName="transform"
      attributeType="XML"
      type="translate"
      values="${values}"
      dur="${result.stepCount * 8}ms"
      fill="freeze"
    />
  </g>`
    })
    .join('\n')

  // 用 path 渲染文字路径，与物理碰撞体坐标对齐
  // opentype 坐标 → SVG 坐标: svgX = (opentypeX + offsetX) * SCALE, svgY = (HEIGHT - centerY + opentypeY) * SCALE
  const textPathsSvg = result.textPaths
    .map(({ pathData }) => `    <path d="${pathData}" fill="black" />`)
    .join('\n')

  const textGroupSvg = `
  <g transform="translate(${result.offsetX * SCALE}, ${(HEIGHT - result.centerY) * SCALE}) scale(${SCALE})">
${textPathsSvg}
  </g>`

  const svg = `<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${svgWidth}"
  height="${svgHeight}"
  viewBox="0 0 ${svgWidth} ${svgHeight}"
>
${contributionsSvg}
${textGroupSvg}
</svg>`
  return svg
}
