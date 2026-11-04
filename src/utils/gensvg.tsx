import {
  type Children,
  contentsToString,
  type PropsWithChildren
} from '@kitajs/html'
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

/** 引擎输出：方块树与自包含 style 片段（SMIL 引擎没有 style） */
interface EngineOutput {
  style: Children
  blocks: JSX.Element
}

/**
 * 包裹含空元素的 SVG 片段，把空元素折回自闭合形式：
 * @kitajs/html 只为 HTML void 标签输出 <tag/>，SVG 空元素会被展开成
 * <circle></circle>。本文件渲染出的这几种元素恒无子节点。
 */
async function SelfClosed({ children }: PropsWithChildren): Promise<string> {
  const markup = await contentsToString([children])
  return markup.replace(/><\/(circle|rect|path|animateTransform)>/g, '/>')
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
  const { style, blocks } = op.css
    ? renderCssBlocks(result.contributions, ctx, op.animation)
    : renderSmilBlocks(result.contributions, ctx)

  // 含空元素的片段各自经 SelfClosed 折叠，根节点只做装配
  return await (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={svgWidth * op.scale}
      height={svgHeight * op.scale}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
      {style}
      <SelfClosed>
        <rect width={svgWidth} height={svgHeight} fill={op.backgroundColor} />
      </SelfClosed>
      <SelfClosed>{blocks}</SelfClosed>
      {/* 文字路径用 path 渲染，与物理碰撞体坐标对齐 */}
      <SelfClosed>
        <g
          transform={`translate(${result.offsetX * SCALE}, ${(op.height - result.centerY) * SCALE}) scale(${SCALE})`}>
          {result.textPaths.map(({ pathData }) => (
            <path d={pathData} fill={op.textColor} />
          ))}
        </g>
      </SelfClosed>
    </svg>
  )
}

/**
 * SMIL 引擎：每个方块自带 animateTransform，轨迹写进 values，
 * 不依赖 CSS，兼容最广的 SVG 渲染环境。
 *
 * translate 消费联合位置表达（帧数最少），rotate 走自转通道自己的
 * keyTimes，旋转剧变不会迫使平移加密。
 */
function renderSmilBlocks(
  contributions: ContributionJson[],
  ctx: EngineContext
): EngineOutput {
  const blocks = contributions.map((contribution) => {
    const shape = ctx.isCircle ? (
      <circle r={ctx.halfSizePx} fill={contribution.color} />
    ) : (
      <rect
        x={-ctx.halfSizePx}
        y={-ctx.halfSizePx}
        width={ctx.sizePx}
        height={ctx.sizePx}
        fill={contribution.color}
      />
    )

    const { x, y, rotation, joint } = contribution.trajectory

    // translate 帧优先用联合位置压缩（欧氏容差，帧数最少）；未启用时退回
    // x/y 通道时间轴的并集重采样，视觉等价
    const merged = joint
      ? { points: joint, keyTimes: buildKeyTimesArray(joint) }
      : mergePositionChannels(x, y)
    const values = merged.points
      .map((p) => `${ctx.toSvgX(p.x)},${ctx.toSvgY(p.y)}`)
      .join(';')

    // 开启压缩后各段时间跨度不同，需要 keyTimes 还原真实节奏；未压缩时为
    // null，走 SMIL 默认均分
    const keyTimes = merged.keyTimes ? merged.keyTimes.join(';') : undefined

    // 方形轨迹携带自转角：叠加在平移之后，绕方块中心旋转，按自身跨度换算节奏
    const rotations = rotation?.map((r) => ctx.toSvgDeg(r.value)).join(';')
    const rotateKeyTimes = rotation ? buildKeyTimes(rotation) : null

    return (
      <g data-date={contribution.date}>
        {shape}
        <animateTransform
          attributeName="transform"
          attributeType="XML"
          type="translate"
          values={values}
          keyTimes={keyTimes}
          dur={ctx.dur}
          fill="freeze"
        />
        {rotations && (
          <animateTransform
            attributeName="transform"
            attributeType="XML"
            type="rotate"
            additive="sum"
            values={rotations}
            keyTimes={rotateKeyTimes ?? undefined}
            dur={ctx.dur}
            fill="freeze"
          />
        )}
      </g>
    )
  })

  return { style: '', blocks: <>{blocks}</> }
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

  const blocks = contributions.map((contribution, index) => {
    const cls = `${fillClass(contribution.color)} g${index}`
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
        fmt: (v: number) => `${ctx.toSvgX(v)}px`
      },
      {
        frames: y,
        suffix: 'y',
        animVar: 'ny',
        cssVar: '--y',
        fmt: (v: number) => `${ctx.toSvgY(v)}px`
      },
      ...(rotation
        ? [
            {
              frames: rotation,
              suffix: 'r',
              animVar: 'nr',
              cssVar: '--r',
              fmt: (v: number) => `${ctx.toSvgDeg(v)}deg`
            }
          ]
        : [])
    ]

    const binding: string[] = []
    for (const ch of channels) {
      const name = `g${index}${ch.suffix}`
      if (ch.frames.every((f) => f.value === ch.frames[0].value)) {
        binding.push(
          `--${ch.animVar}:none`,
          `${ch.cssVar}:${ch.fmt(ch.frames[0].value)}`
        )
        continue
      }
      // 帧偏移：压缩后按真实节奏换算（5 位小数避免相邻帧舍入碰撞），
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
    bindingRules.push(`.g${index}{${binding.join(';')}}`)

    return ctx.isCircle ? <circle class={cls} /> : <rect class={cls} />
  })

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

  // 公共动画逐通道声明：用户模板里的 var(--n) 按通道替换为对应动画名变量。
  // 绑定规则保证变量总有值（恒定通道为 none，动画项安全关闭）
  const channelAnim = (v: string) =>
    animation.replaceAll('var(--n)', `var(--${v})`)
  const cssAnimation = [
    channelAnim('nx'),
    channelAnim('ny'),
    ...(ctx.isCircle ? [] : [channelAnim('nr')])
  ].join(',')

  // CDATA（style 处于 XML 解析上下文，<length> 会被当标签解析）；
  // animation 默认值 = 变量注入的动画名与时长 + linear + 末帧冻结与首帧前的位置兜底
  const cssRules = `<![CDATA[${cssPropertyRules}:root{--dur:${ctx.dur}}#b>*{transform:translate(var(--x),var(--y))${cssRotateTemplate};transform-origin:0 0;animation:${cssAnimation}}${cssGeometryRule}${fillRules.join('')}${keyframesRules.join('')}${bindingRules.join('')}]]>`

  const style = <style>{cssRules}</style>

  // 方块收进 #b 组，供公共规则命中
  return { style, blocks: <g id="b">{blocks}</g> }
}
