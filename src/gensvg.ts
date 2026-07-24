import { SimulationOptions, startSimulation } from './physics'
import type { ContributionJson, SimulationResult } from './utils'
import { HEIGHT, SCALE, SIZE, WIDTH } from './utils'

/**
 * 生成贡献方块重力模拟的 SVG 动画字符串。
 * 模拟 GitHub 用户的贡献方块从上方掉落，最终静止在底部。
 *
 * @param options - 包含 GitHub 用户名
 * @returns 完整的 SVG 字符串
 */
export async function gensvg(options: SimulationOptions): Promise<string> {
  const backgroundColor = options.backgroundColor || 'transparent'
  const textColor = options.textColor || 'black'
  const result: SimulationResult = await startSimulation(options)

  const svgWidth = WIDTH * SCALE
  const svgHeight = HEIGHT * SCALE

  // 生成每个贡献方块的 SVG 元素
  const isCircle = result.shape === 'circle'
  const contributionsSvg = result.contributions
    .map((contribution: ContributionJson) => {
      // 轨迹坐标转换：物理坐标 → SVG 坐标（Y 轴翻转）
      const values = contribution.trajectory
        .map(
          ({ x, y }) =>
            `${+(x * SCALE).toFixed(2)},${+((HEIGHT - y) * SCALE).toFixed(2)}`
        )
        .join(';')

      const shapeElement = isCircle
        ? `<circle
      r="${(SIZE / 2) * SCALE}"
      fill="${contribution.color}"
    />`
        : `<rect
      x="${-(SIZE / 2) * SCALE}"
      y="${-(SIZE / 2) * SCALE}"
      width="${SIZE * SCALE}"
      height="${SIZE * SCALE}"
      fill="${contribution.color}"
    />`

      return `  <g data-date="${contribution.date}">
    ${shapeElement}
    <animateTransform
      attributeName="transform"
      attributeType="XML"
      type="translate"
      values="${values}"
      dur="${result.stepCount * result.stepTime}ms"
      fill="freeze"
    />
  </g>`
    })
    .join('\n')

  // 用 path 渲染文字路径，与物理碰撞体坐标对齐
  // opentype 坐标 → SVG 坐标: svgX = (opentypeX + offsetX) * SCALE, svgY = (HEIGHT - centerY + opentypeY) * SCALE
  const textPathsSvg = result.textPaths
    .map(({ pathData }) => `    <path d="${pathData}" fill="${textColor}" />`)
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
  <rect width="${svgWidth}" height="${svgHeight}" fill="${backgroundColor}" />
${contributionsSvg}
${textGroupSvg}
</svg>`
  return svg
}
