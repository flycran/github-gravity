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

/** 双引擎共享的渲染上下文：几何常量与轨迹坐标转换 */
interface EngineContext {
  /** 方块形状是否为圆形 */
  isCircle: boolean
  /** 方块边长（SVG 用户单位） */
  sizePx: number
  /** 方块边长的一半（SVG 用户单位） */
  halfSizePx: number
  /** 总时长，SMIL 的 dur 属性与 CSS 的 --dur 变量共用 */
  dur: string
  toSvgX: (x: number) => number
  toSvgY: (y: number) => number
  toSvgDeg: (rotation: number) => number
}

/** 引擎输出：方块组与自包含 style 片段（SMIL 引擎没有 style） */
interface EngineOutput {
  styleSvg: string
  blocksSvg: string
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

  const dur = `${Math.round((result.stepCount * TIMESTEP * 1000) / op.speed)}ms`

  // 轨迹坐标转换：物理坐标 → SVG 坐标（Y 轴翻转），保留 2 位小数；
  // 方形自转角（弧度，已解缠绕）Y 翻转后旋转方向取反
  const ctx: EngineContext = {
    isCircle: op.shape === 'circle',
    sizePx: op.size * SCALE,
    halfSizePx: (op.size / 2) * SCALE,
    dur,
    toSvgX: (x) => +(x * SCALE).toFixed(2),
    toSvgY: (y) => +((op.height - y) * SCALE).toFixed(2),
    toSvgDeg: (rotation) => +((-(rotation ?? 0) * 180) / Math.PI).toFixed(2)
  }

  // 双引擎派发：各自生成方块组与 style 片段
  const { styleSvg, blocksSvg } = op.css
    ? renderCssBlocks(result.contributions, ctx, op.animation)
    : renderSmilBlocks(result.contributions, ctx)

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

/**
 * SMIL 引擎：每个方块自带 animateTransform，轨迹写进 values，
 * 不依赖 CSS，兼容最广的 SVG 渲染环境。
 */
function renderSmilBlocks(
  contributions: ContributionJson[],
  ctx: EngineContext
): EngineOutput {
  const blocksSvg = contributions
    .map((contribution) => {
      const shapeElement = ctx.isCircle
        ? `<circle r="${ctx.halfSizePx}" fill="${contribution.color}"/>`
        : `<rect x="${-ctx.halfSizePx}" y="${-ctx.halfSizePx}" width="${ctx.sizePx}" height="${ctx.sizePx}" fill="${contribution.color}"/>`

      const values = contribution.trajectory
        .map(({ x, y }) => `${ctx.toSvgX(x)},${ctx.toSvgY(y)}`)
        .join(';')

      // 开启压缩后各段时间跨度不同，需要 keyTimes 还原真实节奏；未压缩时为 null，走 SMIL 默认均分
      const keyTimes = buildKeyTimes(contribution.trajectory)
      const keyTimesAttr = keyTimes ? ` keyTimes="${keyTimes}"` : ''

      // 方形轨迹携带自转角：叠加在平移之后，绕方块中心旋转
      const rotations = ctx.isCircle
        ? ''
        : contribution.trajectory
            .map(({ rotation }) => ctx.toSvgDeg(rotation ?? 0))
            .join(';')
      const rotateAnim = rotations
        ? `\
<animateTransform attributeName="transform" attributeType="XML" type="rotate" additive="sum" values="${rotations}"${keyTimesAttr} dur="${ctx.dur}" fill="freeze"/>`
        : ''

      return `\
<g data-date="${contribution.date}">\
${shapeElement}\
<animateTransform attributeName="transform" attributeType="XML" type="translate" values="${values}"${keyTimesAttr} dur="${ctx.dur}" fill="freeze"/>\
${rotateAnim}\
</g>`
    })
    .join('')

  return { styleSvg: '', blocksSvg }
}

/**
 * CSS 引擎：方块只携带「颜色 + 动画名」两个 class，轨迹写进 @keyframes 帧变量，
 * transform 合成、几何与 fill 全部收敛进自包含 style 的公共规则，逐方块输出最小化。
 */
function renderCssBlocks(
  contributions: ContributionJson[],
  ctx: EngineContext,
  animation: string
): EngineOutput {
  // animation 值拼进 CDATA 内的规则体，花括号、分号或 CDATA 结束符都会提前
  // 退出声明作用域、撕碎整个 style 块
  if (/[{};]/.test(animation) || animation.includes(']]>')) {
    throw new Error(
      `Invalid animation "${animation}": must not contain braces, semicolons or "]]>"`
    )
  }

  // fill 按颜色去重分组为 class 规则（贡献色阶取值极少）
  const fillRules: string[] = []
  const fillClassByColor = new Map<string, string>()
  const fillClass = (color: string) => {
    let cls = fillClassByColor.get(color)
    if (!cls) {
      cls = `f${fillClassByColor.size}`
      fillClassByColor.set(color, cls)
      fillRules.push(`.${cls}{fill:${color}}`)
    }
    return cls
  }

  const keyframesRules: string[] = []
  const bindingRules: string[] = []

  const blocksSvg = contributions
    .map((contribution, index) => {
      const cls = `${fillClass(contribution.color)} g${index}`

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
            const rotation = ctx.isCircle
              ? ''
              : `;--r:${ctx.toSvgDeg(p.rotation ?? 0)}deg`
            return `${offsets[i]}{--x:${ctx.toSvgX(p.x)}px;--y:${ctx.toSvgY(p.y)}px${rotation}}`
          })
          .join('')}}`
      )
      bindingRules.push(`.g${index}{--n:g${index}}`)

      return ctx.isCircle
        ? `<circle class="${cls}"/>`
        : `<rect class="${cls}"/>`
    })
    .join('')

  // 坐标变量须注册为带类型的自定义属性才能在帧间平滑插值；方形额外注册自转角
  const cssPropertyRules = [
    `@property --x{syntax:"<length>";inherits:false;initial-value:0px}`,
    `@property --y{syntax:"<length>";inherits:false;initial-value:0px}`,
    ...(ctx.isCircle
      ? []
      : [`@property --r{syntax:"<angle>";inherits:false;initial-value:0deg}`])
  ].join('')
  const cssRotateTemplate = ctx.isCircle ? '' : ' rotate(var(--r))'

  // 方块几何全部相同，收进 SVG2 geometry properties 公共规则，不再逐方块写属性
  const cssGeometryRule = ctx.isCircle
    ? `#b>circle{r:${ctx.halfSizePx}px}`
    : `#b>rect{x:${-ctx.halfSizePx}px;y:${-ctx.halfSizePx}px;width:${ctx.sizePx}px;height:${ctx.sizePx}px}`

  // CDATA（style 处于 XML 解析上下文，<length> 会被当标签解析）；
  // animation 默认值 = 变量注入的动画名与时长 + linear + 末帧冻结与首帧前的位置兜底
  const styleSvg = `\
<style><![CDATA[\
${cssPropertyRules}\
:root{--dur:${ctx.dur}}\
#b>*{transform:translate(var(--x),var(--y))${cssRotateTemplate};transform-origin:0 0;animation:${animation}}\
${cssGeometryRule}\
${fillRules.join('')}\
${keyframesRules.join('')}\
${bindingRules.join('')}\
]]></style>`

  // 方块收进 #b 组，供公共规则命中
  return { styleSvg, blocksSvg: `<g id="b">${blocksSvg}</g>` }
}
