import { DEFAULT_OPTIONS, SCALE, TIMESTEP } from '../const'
import { ContributionJson, SimulationOptions, startSimulation } from './physics'
import { buildKeyTimes } from './simplifyTrajectory'
import { withDefaults } from './withDefaults'

export interface GensvgOptions extends SimulationOptions {
  /** 缩放系数，默认为3 */
  scale?: number
  /** 播放倍速，默认为3*/
  speed?: number
  /** 背景颜色，默认透明 */
  backgroundColor?: string
  /** 文字颜色，默认黑色 */
  textColor?: string
}

/**
 * 生成贡献方块重力模拟的 SVG 动画字符串。
 * 模拟 GitHub 用户的贡献方块从上方掉落，最终静止在底部。
 *
 * @param options - 包含 GitHub 用户名
 * @returns 完整的 SVG 字符串
 */
export async function gensvg(options: GensvgOptions): Promise<string> {
  const op = withDefaults(DEFAULT_OPTIONS, options)
  const result = await startSimulation(op)
  const svgWidth = op.width * SCALE
  const svgHeight = op.height * SCALE

  // 生成每个贡献方块的 SVG 元素
  const isCircle = op.shape === 'circle'
  const contributionsSvg = result.contributions
    .map((contribution: ContributionJson) => {
      // 轨迹坐标转换：物理坐标 → SVG 坐标（Y 轴翻转）
      const values = contribution.trajectory
        .map(
          ({ x, y }) =>
            `${+(x * SCALE).toFixed(2)},${+((op.height - y) * SCALE).toFixed(2)}`
        )
        .join(';')

      // 开启压缩后各段时间跨度不同，需要 keyTimes 还原真实节奏；未压缩时为 null，走 SMIL 默认均分
      const keyTimes = buildKeyTimes(contribution.trajectory)
      const keyTimesAttr = keyTimes
        ? `
        keyTimes="${keyTimes}"`
        : ''

      const dur = `${Math.round((result.stepCount * TIMESTEP * 1000) / op.speed)}ms`

      const shapeElement = isCircle
        ? `<circle
        r="${(op.size / 2) * SCALE}"
        fill="${contribution.color}"
      />`
        : `<rect
        x="${-(op.size / 2) * SCALE}"
        y="${-(op.size / 2) * SCALE}"
        width="${op.size * SCALE}"
        height="${op.size * SCALE}"
        fill="${contribution.color}"
      />`

      // 方形轨迹携带自转角（弧度，已解缠绕）：Y 轴翻转后旋转方向取反，
      // 叠加在平移之后，绕方块中心旋转
      const rotations = isCircle
        ? ''
        : contribution.trajectory
            .map(
              ({ rotation }) => +((-(rotation ?? 0) * 180) / Math.PI).toFixed(2)
            )
            .join(';')
      const rotateAnim = rotations
        ? `
      <animateTransform
        attributeName="transform"
        attributeType="XML"
        type="rotate"
        additive="sum"
        values="${rotations}"${keyTimesAttr}
        dur="${dur}"
        fill="freeze"
      />`
        : ''

      return `  <g data-date="${contribution.date}">
      ${shapeElement}
      <animateTransform
        attributeName="transform"
        attributeType="XML"
        type="translate"
        values="${values}"${keyTimesAttr}
        dur="${dur}"
        fill="freeze"
      />${rotateAnim}
    </g>`
    })
    .join('\n')

  // 用 path 渲染文字路径，与物理碰撞体坐标对齐
  // opentype 坐标 → SVG 坐标: svgX = (opentypeX + offsetX) * SCALE, svgY = (height - centerY + opentypeY) * SCALE
  const textPathsSvg = result.textPaths
    .map(
      ({ pathData }) => `    <path d="${pathData}" fill="${op.textColor}" />`
    )
    .join('\n')

  const textGroupSvg = `
    <g transform="translate(${result.offsetX * SCALE}, ${(op.height - result.centerY) * SCALE}) scale(${SCALE})">
  ${textPathsSvg}
    </g>`

  return `<svg
    xmlns="http://www.w3.org/2000/svg"
    width="${svgWidth * op.scale}"
    height="${svgHeight * op.scale}"
    viewBox="0 0 ${svgWidth} ${svgHeight}"
  >
    <rect width="${svgWidth}" height="${svgHeight}" fill="${op.backgroundColor}" />
  ${contributionsSvg}
  ${textGroupSvg}
  </svg>`
}
