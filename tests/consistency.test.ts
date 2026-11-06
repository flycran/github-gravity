/** consistency：三维度独立阈值判定与多组合聚合 */

import { describe, expect, it } from 'bun:test'
import type { FrameMetric } from '../consistency'
import {
  aggregateVerdicts,
  DEFAULT_THRESHOLDS,
  evaluateConsistency
} from '../consistency'

/** 固定测试阈值：判定语义测试不随 DEFAULT_THRESHOLDS 的调参漂移 */
const THRESHOLDS = {
  maxDurationDelta: 0.01,
  maxAvgDiff: 0.01,
  maxMaxDiff: 0.05
}

/** 构造指定差异率的帧序列 */
function frames(ratios: number[]): FrameMetric[] {
  return ratios.map((ratio, index) => ({
    timeMs: index * 100,
    diffPixels: Math.round(ratio * 1000),
    totalPixels: 1000,
    diffRatio: ratio,
    maxDelta: 0
  }))
}

describe('evaluateConsistency', () => {
  it('同 ref 零差异 + 同时长：全维度通过', () => {
    const verdict = evaluateConsistency(
      4800,
      4800,
      frames([0, 0, 0]),
      THRESHOLDS
    )
    expect(verdict.pass).toBe(true)
    expect(verdict.durationDelta).toBe(0)
    expect(verdict.avgDiff).toBe(0)
    expect(verdict.maxDiff).toBe(0)
  })

  it('时长偏差单独超阈值即不通过（结构性差异兜底）', () => {
    const verdict = evaluateConsistency(
      4800,
      5000,
      frames([0, 0, 0]),
      THRESHOLDS
    )
    // 偏差 200/5000 = 4% > 1%
    expect(verdict.durationDelta).toBeCloseTo(0.04)
    expect(verdict.pass).toBe(false)
    expect(verdict.dimensions.find((d) => d.name === 'duration')?.pass).toBe(
      false
    )
  })

  it('平均差异超阈值、最大差异在阈值内：不通过', () => {
    // 平均 1.4% > 1%，峰值 2% ≤ 5%
    const verdict = evaluateConsistency(
      4800,
      4800,
      frames([0.01, 0.02]),
      THRESHOLDS
    )
    expect(verdict.avgDiff).toBeCloseTo(0.015)
    expect(verdict.pass).toBe(false)
    expect(verdict.dimensions.find((d) => d.name === 'avg')?.pass).toBe(false)
    expect(verdict.dimensions.find((d) => d.name === 'max')?.pass).toBe(true)
  })

  it('峰值差异单独超阈值即不通过（瞬时结构差异不可被平均稀释）', () => {
    const verdict = evaluateConsistency(
      4800,
      4800,
      frames([0, 0, 0.06]),
      THRESHOLDS
    )
    expect(verdict.maxDiff).toBeCloseTo(0.06)
    expect(verdict.pass).toBe(false)
    expect(verdict.peakTimeMs).toBe(200)
  })

  it('等于阈值视为通过（≤ 语义）', () => {
    // 10 帧中 1 帧峰值 5%：max 精确等于阈值且 avg（0.5%）低于阈值，只有 ≤ 边界本身参与判定
    const verdict = evaluateConsistency(
      4800,
      4800,
      frames([0, 0, 0, 0, 0, 0, 0, 0, 0, 0.05]),
      THRESHOLDS
    )
    expect(verdict.maxDiff).toBeCloseTo(0.05)
    expect(verdict.pass).toBe(true)
  })

  it('默认阈值能拦住重力翻倍量级的破坏（端到端实测：avg≈0.53% max≈0.64% 时长偏差≈0.07%）', () => {
    const verdict = evaluateConsistency(
      31722,
      31944,
      frames([0, 0.0062, 0.0064, 0.0055, 0.006, 0.0058]),
      DEFAULT_THRESHOLDS
    )
    expect(verdict.pass).toBe(false)
  })
})

describe('aggregateVerdicts', () => {
  it('全部组合通过才整体通过', () => {
    const pass = evaluateConsistency(4800, 4800, frames([0]), THRESHOLDS)
    const fail = evaluateConsistency(4800, 4800, frames([0.5]), THRESHOLDS)
    const aggregated = aggregateVerdicts([
      { name: 'a', verdict: pass },
      { name: 'b', verdict: fail }
    ])
    expect(aggregated.pass).toBe(false)
  })

  it('各维度取最差组合的值并记录来源', () => {
    const quiet = evaluateConsistency(4800, 4800, frames([0.001]), THRESHOLDS)
    const loud = evaluateConsistency(4800, 4800, frames([0.03]), THRESHOLDS)
    const long = evaluateConsistency(4800, 5000, frames([0.001]), THRESHOLDS)
    const aggregated = aggregateVerdicts([
      { name: 'quiet', verdict: quiet },
      { name: 'loud', verdict: loud },
      { name: 'long', verdict: long }
    ])
    expect(aggregated.pass).toBe(false)
    expect(aggregated.dimensions.find((d) => d.name === 'max')?.combo).toBe(
      'loud'
    )
    expect(
      aggregated.dimensions.find((d) => d.name === 'duration')?.combo
    ).toBe('long')
  })
})
