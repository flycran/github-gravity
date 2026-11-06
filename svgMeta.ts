/**
 * SVG 产物元数据解析：动画时长、画布、引擎类型。
 *
 * 时长是"总时长偏差"维度的数据源头，也是采样时刻表的依据，
 * 从产物自身的声明（SMIL dur 属性 / CSS --dur 变量）解析，不依赖任何运行时计时。
 * gensvg 生成的 dur 恒为毫秒带 ms 后缀（gensvg.tsx 的 `${Math.round(...)}ms`），
 * 单位解析仍兼容 s，防御历史版本的产物格式。
 */

export type SvgEngine = 'smil' | 'css'

export interface SvgMeta {
  engine: SvgEngine
  /** 动画总时长（ms） */
  durationMs: number
  viewBox: string | null
}

/** 解析 "4800ms"/"4.8s" 形式的时间字面量为毫秒；无法解析时返回 NaN */
function parseDurMs(raw: string): number {
  const match = /^\s*([\d.]+)(ms|s)?\s*$/.exec(raw)
  if (!match) return Number.NaN
  const value = Number.parseFloat(match[1])
  return match[2] === 's' ? value * 1000 : value
}

export function parseSvgMeta(svg: string): SvgMeta {
  // SMIL 引擎有 animateTransform 元素，CSS 引擎的动画声明收敛在 style 块里
  const isSmil = /<animateTransform[\s>]/.test(svg)
  const durSource = isSmil
    ? /<animateTransform[^>]*\sdur="([^"]+)"/.exec(svg)?.[1]
    : /--dur:\s*([\d.]+m?s)/.exec(svg)?.[1]
  const durationMs =
    durSource === undefined ? Number.NaN : parseDurMs(durSource)
  if (!Number.isFinite(durationMs)) {
    throw new Error(
      `无法从 SVG 解析动画时长（${isSmil ? 'animateTransform dur' : '--dur'}），` +
        '产物可能不是 gensvg 生成的动画 SVG'
    )
  }
  return {
    engine: isSmil ? 'smil' : 'css',
    durationMs,
    viewBox: /viewBox="([^"]+)"/.exec(svg)?.[1] ?? null
  }
}
