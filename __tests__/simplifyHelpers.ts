import type { ChannelKeyframe } from '../src/utils/simplifyTrajectory'

/** 用 span 还原每个保留点的原始索引 */
function restoreIndices(frames: { span?: number }[]): number[] {
  const indices = [0]
  for (let k = 1; k < frames.length; k++) {
    indices.push(indices[k - 1] + (frames[k].span ?? 0))
  }
  return indices
}

/**
 * 原始轨迹相对简化结果的最大时刻插值偏差：
 * 对每个原始点，按其所属关键帧段的线性插值求该时刻的位置误差。
 * 这正是播放时观众可见的最大位移误差。
 */
export function maxLerpDeviation(
  track: { x: number; y: number }[],
  simplified: { x: number; y: number; span?: number }[]
): number {
  const indices = restoreIndices(simplified)

  let max = 0
  // k 定位 i 所属的关键帧段 [indices[k], indices[k + 1]]
  let k = 0
  for (let i = 0; i < track.length; i++) {
    while (k + 2 < indices.length && indices[k + 1] <= i) k++
    const a = track[indices[k]]
    const b = track[indices[k + 1]]
    const t = (i - indices[k]) / (indices[k + 1] - indices[k])
    const deviation = Math.hypot(
      track[i].x - (a.x + (b.x - a.x) * t),
      track[i].y - (a.y + (b.y - a.y) * t)
    )
    max = Math.max(max, deviation)
  }
  return max
}

/**
 * 原始采样序列相对简化结果的最大时刻插值偏差，
 * 与 maxLerpDeviation 同口径的单轴版本，用于校验通道压缩的误差上界。
 */
export function maxChannelDeviation(
  track: number[],
  simplified: ChannelKeyframe[]
): number {
  const indices = restoreIndices(simplified)

  let max = 0
  // k 定位 i 所属的关键帧段 [indices[k], indices[k + 1]]
  let k = 0
  for (let i = 0; i < track.length; i++) {
    while (k + 2 < indices.length && indices[k + 1] <= i) k++
    const a = track[indices[k]]
    const b = track[indices[k + 1]]
    const t = (i - indices[k]) / (indices[k + 1] - indices[k])
    const deviation = Math.abs(track[i] - (a + (b - a) * t))
    max = Math.max(max, deviation)
  }
  return max
}

/** 时间守恒：span 总和必须等于原始间隔数，播放总时长不变 */
export function sumSpans(frames: { span?: number }[]): number {
  return frames.reduce((sum, f) => sum + (f.span ?? 0), 0)
}
