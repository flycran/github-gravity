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
        const positions = contribution.trajectory.position
        const rotations = contribution.trajectory.rotation
        // 位置帧节奏：压缩轨迹按 span 前缀和换算（5 位小数避免相邻帧舍入碰撞），
        // 未压缩时为均匀分布
        const times = buildKeyTimesArray(positions)
        const fractions =
          times ??
          Array.from(
            { length: positions.length },
            (_, i) => i / Math.max(positions.length - 1, 1)
          )
        const offsets = fractions.map((t) => `${+(t * 100).toFixed(5)}%`)

        // 自转恒定时折叠为静态变量：无动画帧、无插值，播放端零开销
        const constantDeg =
          rotations &&
          rotations.length <= 2 &&
          rotations.every((r) => r.value === rotations[0].value)
            ? toSvgDeg(rotations[0].value)
            : null

        const binding = [`--n:g${index}`]
        let frames = positions
          .map(
            (p, i) => `${offsets[i]}{--x:${toSvgX(p.x)}px;--y:${toSvgY(p.y)}px}`
          )
          .join('')

        if (constantDeg !== null) {
          binding.push(`--r:${constantDeg}deg`)
        } else if (
          rotations &&
          rotations.length === positions.length &&
          rotations[0].span === undefined
        ) {
          // 未压缩旋转与位置同帧同节奏：并入同一 keyframes，省一套动画开销
          frames = positions
            .map(
              (p, i) =>
                `${offsets[i]}{--x:${toSvgX(p.x)}px;--y:${toSvgY(p.y)}px;--r:${toSvgDeg(rotations[i].value)}deg}`
            )
            .join('')
        } else if (rotations) {
          // 压缩旋转走独立时间轴：单独 keyframes 挂到第二个动画名上，
          // 帧数与节奏都不再随位置通道牵制
          const rotFractions =
            buildKeyTimesArray(rotations) ??
            Array.from(
              { length: rotations.length },
              (_, i) => i / Math.max(rotations.length - 1, 1)
            )
          const rotOffsets = rotFractions.map(
            (t) => `${+(t * 100).toFixed(5)}%`
          )
          keyframesRules.push(
            `@keyframes g${index}r{${rotations
              .map((r, i) => `${rotOffsets[i]}{--r:${toSvgDeg(r.value)}deg}`)
              .join('')}}`
          )
          binding.push(`--nr:g${index}r`)
        }

        keyframesRules.push(`@keyframes g${index}{${frames}}`)
        bindingRules.push(`[data-g${index}]{${binding.join(';')}}`)

        return `\
<g data-g${index}="">\
${shapeElement}\
</g>`
      }

      const positions = contribution.trajectory.position
      const rotations = contribution.trajectory.rotation
      const values = positions
        .map(({ x, y }) => `${toSvgX(x)},${toSvgY(y)}`)
        .join(';')

      // 开启压缩后各段时间跨度不同，需要 keyTimes 还原真实节奏；未压缩时为 null，走 SMIL 默认均分
      const keyTimes = buildKeyTimes(positions)
      const keyTimesAttr = keyTimes ? ` keyTimes="${keyTimes}"` : ''

      // 自转通道按自身 span 换算 keyTimes，与平移动画的时间轴互不牵制
      let rotateAnim = ''
      if (rotations) {
        const rotKeyTimes = buildKeyTimes(rotations)
        const rotKeyTimesAttr = rotKeyTimes ? ` keyTimes="${rotKeyTimes}"` : ''
        rotateAnim = `\
<animateTransform attributeName="transform" attributeType="XML" type="rotate" additive="sum" values="${rotations
          .map((r) => toSvgDeg(r.value))
          .join(';')}"${rotKeyTimesAttr} dur="${dur}" fill="freeze"/>`
      }

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

  // 方形公共动画追加自转动画项；自转并入位置 keyframes 或已折叠为静态时
  // --nr 悬空，浏览器忽略无 keyframes 的动画项，不影响其余动画
  const cssAnimation = isCircle
    ? op.animation
    : `${op.animation},var(--nr) var(--dur) linear both`

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
#b>g{transform:translate(var(--x),var(--y))${cssRotateTemplate};transform-origin:0 0;animation:${cssAnimation}}\
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
