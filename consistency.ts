/**
 * 三维度一致性判定：总时长偏差、平均像素差异、最大像素差异。
 *
 * 各维度独立阈值，全部 ≤ 阈值才算通过（用户要求，不做加权合成）；
 * 多组合聚合时各维度取最差组合的值，全部组合通过才整体通过。
 */

export interface FrameMetric {
  /** 采样时刻（ms） */
  timeMs: number
  diffPixels: number
  totalPixels: number
  /** 该帧差异率 = diffPixels / totalPixels */
  diffRatio: number
  /** 该帧 RGB 最大通道偏差（0-255），报告参考信息 */
  maxDelta: number
}

export interface Thresholds {
  /** 时长相对偏差上限，如 0.01 表示 1% */
  maxDurationDelta: number
  /** 平均帧差异率上限 */
  maxAvgDiff: number
  /** 峰值帧差异率上限 */
  maxMaxDiff: number
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  // 同 ref 基线为精确 0%（同浏览器同字体，无渲染噪声），阈值可以设得紧；
  // 实测重力翻倍这类明显行为破坏约 avg 0.5% / max 0.6%，默认值必须能拦住它
  maxDurationDelta: 0.005,
  maxAvgDiff: 0.002,
  maxMaxDiff: 0.01
}

export type DimensionName = 'duration' | 'avg' | 'max'

export interface Dimension {
  name: DimensionName
  /** 实际值（相对偏差或差异率） */
  value: number
  threshold: number
  pass: boolean
}

export interface CombinationVerdict {
  /** 时长偏差 = |durA - durB| / max(durA, durB) */
  durationDelta: number
  avgDiff: number
  maxDiff: number
  /** 峰值差异帧的采样时刻（ms） */
  peakTimeMs: number
  dimensions: Dimension[]
  pass: boolean
}

const DIMENSION_LABELS: Record<DimensionName, string> = {
  duration: '总时长偏差',
  avg: '平均差异',
  max: '最大差异'
}

export function dimensionLabel(name: DimensionName): string {
  return DIMENSION_LABELS[name]
}

export function evaluateConsistency(
  durationA: number,
  durationB: number,
  frames: FrameMetric[],
  thresholds: Thresholds
): CombinationVerdict {
  const slowest = Math.max(durationA, durationB)
  const durationDelta =
    slowest === 0 ? 0 : Math.abs(durationA - durationB) / slowest
  const avgDiff =
    frames.length === 0
      ? 0
      : frames.reduce((sum, frame) => sum + frame.diffRatio, 0) / frames.length
  const peak =
    frames.length === 0
      ? { diffRatio: 0, timeMs: 0 }
      : frames.reduce((worst, frame) =>
          frame.diffRatio > worst.diffRatio ? frame : worst
        )
  const maxDiff = peak.diffRatio

  const dimensions: Dimension[] = (
    [
      ['duration', durationDelta, thresholds.maxDurationDelta],
      ['avg', avgDiff, thresholds.maxAvgDiff],
      ['max', maxDiff, thresholds.maxMaxDiff]
    ] as const
  ).map(([name, value, threshold]) => ({
    name,
    value,
    threshold,
    pass: value <= threshold
  }))

  return {
    durationDelta,
    avgDiff,
    maxDiff,
    peakTimeMs: peak.timeMs,
    dimensions,
    pass: dimensions.every((dimension) => dimension.pass)
  }
}

export interface ComboResult {
  name: string
  verdict: CombinationVerdict
}

export interface AggregatedVerdict {
  /** 各维度最差值（含来源组合名） */
  dimensions: (Dimension & { combo: string })[]
  pass: boolean
}

/** 多组合聚合：各维度取最差组合的值；全部组合通过才通过 */
export function aggregateVerdicts(results: ComboResult[]): AggregatedVerdict {
  if (results.length === 0) return { dimensions: [], pass: true }
  const dimensions = (['duration', 'avg', 'max'] as const)
    .map((name) => {
      let worst: (Dimension & { combo: string }) | undefined
      for (const result of results) {
        const dimension = result.verdict.dimensions.find(
          (candidate) => candidate.name === name
        )
        if (!dimension) continue
        if (!worst || dimension.value > worst.value) {
          worst = { ...dimension, combo: result.name }
        }
      }
      return worst
    })
    .filter(
      (dimension): dimension is Dimension & { combo: string } =>
        dimension !== undefined
    )
  return {
    dimensions,
    pass: results.every((result) => result.verdict.pass)
  }
}
