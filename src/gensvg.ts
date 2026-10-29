import { SimulationOptions, startSimulation } from './physics'
import { ContributionJson, SCALE } from './utils'
import { buildKeyTimes } from './utils/simplifyTrajectory'

/**
 * 生成贡献方块重力模拟的 SVG 动画字符串。
 * 模拟 GitHub 用户的贡献方块从上方掉落，最终静止在底部。
 *
 * @param options - 包含 GitHub 用户名
 * @returns 完整的 SVG 字符串
 */
export async function gensvg(options: SimulationOptions): Promise<string> {
  const result = await startSimulation(options)
  const svgWidth = result.width * SCALE
  const svgHeight = result.height * SCALE

  // 生成每个贡献方块的 SVG 元素
  const isCircle = result.shape === 'circle'
  const contributionsSvg = result.contributions
    .map((contribution: ContributionJson) => {
      // 轨迹坐标转换：物理坐标 → SVG 坐标（Y 轴翻转）
      const values = contribution.trajectory
        .map(
          ({ x, y }) =>
            `${+(x * SCALE).toFixed(2)},${+((result.height - y) * SCALE).toFixed(2)}`
        )
        .join(';')

      // 开启压缩后各段时间跨度不同，需要 keyTimes 还原真实节奏；未压缩时为 null，走 SMIL 默认均分
      const keyTimes = buildKeyTimes(contribution.trajectory)
      const keyTimesAttr = keyTimes
        ? `
        keyTimes="${keyTimes}"`
        : ''

      const shapeElement = isCircle
        ? `<circle
        r="${(result.size / 2) * SCALE}"
        fill="${contribution.color}"
      />`
        : `<rect
        x="${-(result.size / 2) * SCALE}"
        y="${-(result.size / 2) * SCALE}"
        width="${result.size * SCALE}"
        height="${result.size * SCALE}"
        fill="${contribution.color}"
      />`

      return `  <g data-date="${contribution.date}">
      ${shapeElement}
      <animateTransform
        attributeName="transform"
        attributeType="XML"
        type="translate"
        values="${values}"${keyTimesAttr}
        dur="${result.stepCount * result.stepTime}ms"
        fill="freeze"
      />
    </g>`
    })
    .join('\n')

  // 用 path 渲染文字路径，与物理碰撞体坐标对齐
  // opentype 坐标 → SVG 坐标: svgX = (opentypeX + offsetX) * SCALE, svgY = (height - centerY + opentypeY) * SCALE
  const textPathsSvg = result.textPaths
    .map(
      ({ pathData }) =>
        `    <path d="${pathData}" fill="${result.textColor}" />`
    )
    .join('\n')

  const textGroupSvg = `
    <g transform="translate(${result.offsetX * SCALE}, ${(result.height - result.centerY) * SCALE}) scale(${SCALE})">
  ${textPathsSvg}
    </g>`

  return `<svg
    xmlns="http://www.w3.org/2000/svg"
    width="${svgWidth}"
    height="${svgHeight}"
    viewBox="0 0 ${svgWidth} ${svgHeight}"
  >
    <rect width="${svgWidth}" height="${svgHeight}" fill="${result.backgroundColor}" />
  ${contributionsSvg}
  ${textGroupSvg}
  </svg>`
}
