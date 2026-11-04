import { DEFAULT_OPTIONS, SCALE, TIMESTEP } from '../const'
import { ContributionJson, SimulationOptions, startSimulation } from './physics'
import {
  buildKeyTimes,
  buildKeyTimesArray,
  mergePositionChannels
} from './simplifyTrajectory'
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
  /**
   * 自定义 CSS animation 值，仅 css 引擎有效，默认 var(--n) var(--dur) linear both。
   * 生成时按通道复制，其中 var(--n) 分别替换为 x/y/自转通道的动画名变量
   */
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
  // SMIL 的 translate 只能消费绑定的 "x,y" 对，让模拟一并产出联合位置表达；
  // CSS 引擎按通道独立播放，无需联合表达
  const result = await startSimulation({ ...op, jointPosition: !op.css })
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
        const { x, y, rotation } = contribution.trajectory
        // 每个通道独立成动画：活跃通道生成自己的 keyframes，恒定通道折叠为
        // 静态变量并把动画名置为 none——置 none 而非不绑定，是因为未定义的
        // var() 会让浏览器判定整条 animation 声明无效，冻结其余通道的动画
        const channels = [
          {
            frames: x,
            suffix: 'x',
            animVar: 'nx',
            cssVar: '--x',
            fmt: (v: number) => `${toSvgX(v)}px`
          },
          {
            frames: y,
            suffix: 'y',
            animVar: 'ny',
            cssVar: '--y',
            fmt: (v: number) => `${toSvgY(v)}px`
          },
          ...(rotation
            ? [
                {
                  frames: rotation,
                  suffix: 'r',
                  animVar: 'nr',
                  cssVar: '--r',
                  fmt: (v: number) => `${toSvgDeg(v)}deg`
                }
              ]
            : [])
        ]

        const binding: string[] = []
        for (const ch of channels) {
          const name = `g${index}${ch.suffix}`
          const constant = ch.frames.every(
            (f) => f.value === ch.frames[0].value
          )
          if (constant) {
            binding.push(
              `--${ch.animVar}:none`,
              `${ch.cssVar}:${ch.fmt(ch.frames[0].value)}`
            )
            continue
          }
          // 帧节奏：压缩轨迹按 span 前缀和换算（5 位小数避免相邻帧舍入碰撞），
          // 未压缩时为均匀分布
          const times = buildKeyTimesArray(ch.frames)
          const fractions =
            times ??
            Array.from(
              { length: ch.frames.length },
              (_, i) => i / Math.max(ch.frames.length - 1, 1)
            )
          const offsets = fractions.map((t) => `${+(t * 100).toFixed(5)}%`)
          keyframesRules.push(
            `@keyframes ${name}{${ch.frames
              .map((f, i) => `${offsets[i]}{${ch.cssVar}:${ch.fmt(f.value)}}`)
              .join('')}}`
          )
          binding.push(`--${ch.animVar}:${name}`)
        }
        bindingRules.push(`[data-g${index}]{${binding.join(';')}}`)

        return `\
<g data-g${index}="">\
${shapeElement}\
</g>`
      }

      const { x, y, rotation, joint } = contribution.trajectory

      // translate 帧优先用联合位置压缩的结果（帧数最少）；调试或未启用
      // 联合压缩时退回 x/y 通道的时间轴并集重采样，视觉等价
      const merged = joint
        ? { points: joint, keyTimes: buildKeyTimesArray(joint) }
        : mergePositionChannels(x, y)
      const values = merged.points
        .map((p) => `${toSvgX(p.x)},${toSvgY(p.y)}`)
        .join(';')
      const keyTimesAttr = merged.keyTimes
        ? ` keyTimes="${merged.keyTimes.join(';')}"`
        : ''

      // 自转通道按自身 span 换算 keyTimes，与平移动画的时间轴互不牵制
      let rotateAnim = ''
      if (rotation) {
        const rotKeyTimes = buildKeyTimes(rotation)
        const rotKeyTimesAttr = rotKeyTimes ? ` keyTimes="${rotKeyTimes}"` : ''
        rotateAnim = `\
<animateTransform attributeName="transform" attributeType="XML" type="rotate" additive="sum" values="${rotation
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

  // 公共动画逐通道声明：用户模板里的 var(--n) 按通道替换为对应动画名变量，
  // 每个方块的绑定规则保证变量总有值（恒定通道为 none，动画项安全关闭）
  const channelAnim = (v: string) =>
    op.animation.replaceAll('var(--n)', `var(--${v})`)
  const cssAnimation = [
    channelAnim('nx'),
    channelAnim('ny'),
    ...(isCircle ? [] : [channelAnim('nr')])
  ].join(',')

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
