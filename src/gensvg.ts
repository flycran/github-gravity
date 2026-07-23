import { startSimulation } from './server/physics'
import type { ContributionJson, SimulationResult } from './utils'
import { FONT_SIZE, HEIGHT, SCALE, SIZE, TEXT, TEXT_TOP, WIDTH } from './utils'

export interface GensvgOptions {
  username: string
  text: string
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
  text
}: GensvgOptions): Promise<string> {
  const result: SimulationResult = await startSimulation(username, text)

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

  const textSvg = `
    <text
      x="${(WIDTH / 2) * SCALE}"
      y="${TEXT_TOP * SCALE}"
      font-size="${FONT_SIZE}"
      font-family="ArialCustom, sans-serif"
      text-anchor="middle"
      dominant-baseline="hanging"
      fill="black"
    >
      ${TEXT}
    </text>`

  const svg = `<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${svgWidth}"
  height="${svgHeight}"
  viewBox="0 0 ${svgWidth} ${svgHeight}"
>
  <style>
    @font-face {
      font-family: "ArialCustom";
      src: url("/assets/ARIAL.ttf") format("truetype");
    }
    </style>
${contributionsSvg}
${textSvg}
</svg>`

  return svg
}
