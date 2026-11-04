import { DEFAULT_OPTIONS, SCALE, TIMESTEP } from '../const'
import { ContributionJson, SimulationOptions, startSimulation } from './physics'
import { buildKeyTimes, buildKeyTimesArray } from './simplifyTrajectory'
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
  /** 启用 CSS @keyframes 动画引擎（动画声明收敛进自包含 style），默认 false 使用 SMIL animateTransform */
  css?: boolean
  /** 自定义 CSS animation 值，仅 css 引擎有效，默认 var(--n) var(--dur) linear both */
  animation?: string
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
  const dur = `${Math.round((result.stepCount * TIMESTEP * 1000) / op.speed)}ms`

  // 轨迹坐标转换：物理坐标 → SVG 坐标（Y 轴翻转），保留 2 位小数；
  // 方形自转角（弧度，已解缠绕）Y 翻转后旋转方向取反
  const toSvgX = (x: number) => +(x * SCALE).toFixed(2)
  const toSvgY = (y: number) => +((op.height - y) * SCALE).toFixed(2)
  const toSvgDeg = (rotation: number) =>
    +((-(rotation ?? 0) * 180) / Math.PI).toFixed(2)

  // CSS 引擎：keyframes 与 data-g{index} 绑定规则逐方块收集，最后收敛进单个 style
  const keyframesRules: string[] = []
  const bindingRules: string[] = []

  const contributionsSvg = result.contributions
    .map((contribution: ContributionJson, index: number) => {
      const shapeElement = isCircle
        ? `<circle r="${(op.size / 2) * SCALE}" fill="${contribution.color}"/>`
        : `<rect x="${-(op.size / 2) * SCALE}" y="${-(op.size / 2) * SCALE}" width="${op.size * SCALE}" height="${op.size * SCALE}" fill="${contribution.color}"/>`

      if (op.css) {
        // 帧偏移：压缩后按真实节奏换算（5 位小数避免相邻帧舍入碰撞），
        // 未压缩时为均匀分布
        const times = buildKeyTimesArray(contribution.trajectory)
        const frameCount = contribution.trajectory.length
        const fractions =
          times ??
          Array.from(
            { length: frameCount },
            (_, i) => i / Math.max(frameCount - 1, 1)
          )
        const offsets = fractions.map((t) => `${+(t * 100).toFixed(5)}%`)

        // 每帧只写坐标变量，transform 的合成模板在公共规则；
        // rotate 叠加在 translate 之后，绕方块中心旋转
        keyframesRules.push(
          `@keyframes g${index}{${contribution.trajectory
            .map((p, i) => {
              const rotation = isCircle
                ? ''
                : `;--r:${toSvgDeg(p.rotation ?? 0)}deg`
              return `${offsets[i]}{--x:${toSvgX(p.x)}px;--y:${toSvgY(p.y)}px${rotation}}`
            })
            .join('')}}`
        )
        bindingRules.push(`[data-g${index}]{--n:g${index}}`)

        return `\
<g data-g${index}="">\
${shapeElement}\
</g>`
      }

      const values = contribution.trajectory
        .map(({ x, y }) => `${toSvgX(x)},${toSvgY(y)}`)
        .join(';')

      // 开启压缩后各段时间跨度不同，需要 keyTimes 还原真实节奏；未压缩时为 null，走 SMIL 默认均分
      const keyTimes = buildKeyTimes(contribution.trajectory)
      const keyTimesAttr = keyTimes ? ` keyTimes="${keyTimes}"` : ''

      // 方形轨迹携带自转角：叠加在平移之后，绕方块中心旋转
      const rotations = isCircle
        ? ''
        : contribution.trajectory
            .map(({ rotation }) => toSvgDeg(rotation ?? 0))
            .join(';')
      const rotateAnim = rotations
        ? `\
<animateTransform attributeName="transform" attributeType="XML" type="rotate" additive="sum" values="${rotations}"${keyTimesAttr} dur="${dur}" fill="freeze"/>`
        : ''

      return `\
<g data-date="${contribution.date}">\
${shapeElement}\
<animateTransform attributeName="transform" attributeType="XML" type="translate" values="${values}"${keyTimesAttr} dur="${dur}" fill="freeze"/>\
${rotateAnim}\
</g>`
    })
    .join('')

  // 坐标变量须注册为带类型的自定义属性才能在帧间平滑插值；方形额外注册自转角
  const cssPropertyRules = [
    `@property --x{syntax:"<length>";inherits:false;initial-value:0px}`,
    `@property --y{syntax:"<length>";inherits:false;initial-value:0px}`,
    ...(isCircle
      ? []
      : [`@property --r{syntax:"<angle>";inherits:false;initial-value:0deg}`])
  ].join('')
  const cssRotateTemplate = isCircle ? '' : ' rotate(var(--r))'

  // animation 值拼进 CDATA 内的规则体，花括号、分号或 CDATA 结束符都会提前
  // 退出声明作用域、撕碎整个 style 块
  if (op.css && (/[{};]/.test(op.animation) || op.animation.includes(']]>'))) {
    throw new Error(
      `Invalid animation "${op.animation}": must not contain braces, semicolons or "]]>"`
    )
  }

  // CDATA（style 处于 XML 解析上下文，<length> 会被当标签解析）；
  // animation 默认值 = 变量注入的动画名与时长 + linear + 末帧冻结与首帧前的位置兜底
  const styleSvg = op.css
    ? `\
<style><![CDATA[\
${cssPropertyRules}\
:root{--dur:${dur}}\
#b>g{transform:translate(var(--x),var(--y))${cssRotateTemplate};transform-origin:0 0;animation:${op.animation}}\
${keyframesRules.join('')}\
${bindingRules.join('')}\
]]></style>`
    : ''

  // 方块收进 #b 组，供公共规则 #b>g 命中
  const blocksSvg = op.css
    ? `<g id="b">${contributionsSvg}</g>`
    : contributionsSvg

  // 用 path 渲染文字路径，与物理碰撞体坐标对齐
  // opentype 坐标 → SVG 坐标: svgX = (opentypeX + offsetX) * SCALE, svgY = (height - centerY + opentypeY) * SCALE
  const textPathsSvg = result.textPaths
    .map(({ pathData }) => `<path d="${pathData}" fill="${op.textColor}"/>`)
    .join('')

  const textGroupSvg = `\
<g transform="translate(${result.offsetX * SCALE}, ${(op.height - result.centerY) * SCALE}) scale(${SCALE})">\
${textPathsSvg}\
</g>`

  return `\
<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth * op.scale}" height="${svgHeight * op.scale}" viewBox="0 0 ${svgWidth} ${svgHeight}">\
${styleSvg}\
<rect width="${svgWidth}" height="${svgHeight}" fill="${op.backgroundColor}"/>\
${blocksSvg}\
${textGroupSvg}\
</svg>`
}
