/**
 * 通道化轨迹压缩。
 *
 * 轨迹由独立标量通道组成：x、y 与自转角，每个通道按自己的容差独立分段——
 * 垂直下落中几乎恒定的 x 通道收缩为两个关键帧，主导运动的 y 通道不受
 * 影响；旋转剧变也只有旋转通道加密。各通道时间轴互不相同，播放节奏由
 * 各自的 span 描述。
 *
 * 另提供联合位置表达（joint）：x、y 共享时间轴、以欧氏偏差为约束。分轴划分
 * 的折点时刻错开时，联合表达的帧数更少。
 */

/** 标量通道关键帧 */
export interface ChannelKeyframe {
  value: number
  /** 与前一关键帧之间的原始采样点数（首帧为 0）；未压缩轨迹无此字段 */
  span?: number
}

/** 联合位置关键帧：x、y 共享时间轴 */
export interface PositionKeyframe {
  x: number
  y: number
  /** 与前一关键帧之间的原始采样点数（首帧为 0）；未压缩输入无此字段 */
  span?: number
}

/**
 * 原始采样轨迹：每通道按采样顺序的纯数值序列。
 * 模拟逐帧 push 数字，不分配对象——采样量在数十万级，对象包装会成为
 * 记录与压缩的主要开销。
 */
export interface RawTrajectory {
  x: number[]
  y: number[]
  /** 自转角（弧度，已解缠绕）；圆形或不跟踪自转时缺省 */
  rotation?: number[]
}

/** 压缩后的通道化轨迹：每个通道独立的关键帧序列与时间轴 */
export interface Trajectory {
  /** 横坐标通道，物理坐标单位 */
  x: ChannelKeyframe[]
  /** 纵坐标通道，物理坐标单位 */
  y: ChannelKeyframe[]
  /** 自转角通道（弧度，已解缠绕，可直接线性插值）；圆形或不跟踪自转时缺省 */
  rotation?: ChannelKeyframe[]
  /**
   * 联合位置表达，x/y 共享时间轴（欧氏容差）；仅在压缩时按需产出
   */
  joint?: PositionKeyframe[]
}

/** 轨迹压缩算法 */
export type CompressionAlgorithm = 'DP' | 'RDP' | 'Greedy'

/** 段可行性回调：段 (s, e) 内所有中间点的时刻插值偏差都在容差内 */
type SegmentFeasible = (s: number, e: number) => boolean

/** 段分裂点回调：段不可行时返回偏差最大的中间点下标，可行时返回 -1 */
type FindSplit = (s: number, e: number) => number

function assertTolerance(tolerance: number): void {
  if (tolerance < 0) {
    throw new Error(`tolerance must be >= 0, got ${tolerance}`)
  }
}

/**
 * 动态规划最优分段：在可行性约束下求关键帧数全局最少的分段
 * （等价于 Imai–Iri 最优分段问题的 DP 解法）
 */
function keepByDP(n: number, feasible: SegmentFeasible): boolean[] {
  // cost[i]：起点到 i 的最少段数；parent[i]：最优解中 i 的前一个关键帧
  const cost = new Array<number>(n).fill(Infinity)
  const parent = new Array<number>(n).fill(-1)
  cost[0] = 0

  for (let i = 1; i < n; i++) {
    // j 从近到远：短段检查便宜，且尽早建立 cost[i] 上界以激活剪枝
    for (let j = i - 1; j >= 0; j--) {
      // 即使段 (j, i) 可行也不可能给出更优解时，跳过段检查
      if (cost[j] + 1 >= cost[i]) continue
      if (!feasible(j, i)) continue
      cost[i] = cost[j] + 1
      parent[i] = j
    }
  }

  const keep = new Array<boolean>(n).fill(false)
  for (let i = n - 1; i > 0; i = parent[i]) keep[i] = true
  keep[0] = true
  return keep
}

/** 时空版 Ramer-Douglas-Peucker：反复在段内偏差最大点分裂，直到全段可行 */
function keepByRDP(n: number, findSplit: FindSplit): boolean[] {
  const keep = new Array<boolean>(n).fill(false)
  keep[0] = keep[n - 1] = true

  // 显式栈代替递归，栈内为待检查的闭区间 [start, end]
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop()!
    if (end - start < 2) continue
    const split = findSplit(start, end)
    if (split >= 0) {
      keep[split] = true
      stack.push([start, split], [split, end])
    }
  }
  return keep
}

/** 单遍贪心最长段：从当前关键帧扩展段尾，直到加入下一点会破坏可行性 */
function keepByGreedy(n: number, feasible: SegmentFeasible): boolean[] {
  const keep = new Array<boolean>(n).fill(false)
  keep[0] = keep[n - 1] = true

  let s = 0
  while (s < n - 1) {
    // 插值线随段尾变化，段可行性对段尾没有单调性，只能逐步扩展并全段重查
    let e = s + 1
    while (e < n - 1 && feasible(s, e + 1)) e++
    keep[e] = true
    s = e
  }
  return keep
}

function keepByAlgorithm(
  n: number,
  algorithm: CompressionAlgorithm,
  feasible: SegmentFeasible,
  findSplit: FindSplit
): boolean[] {
  switch (algorithm) {
    case 'DP':
      return keepByDP(n, feasible)
    case 'RDP':
      return keepByRDP(n, findSplit)
    case 'Greedy':
      return keepByGreedy(n, feasible)
  }
}

/**
 * 通道的段可行性：任一中间点的时刻插值偏差超限立即返回 false
 * （提前终止，长不可行段的开销为常数级）。
 * 度量含时间维：匀速段可整体并段，变速段会自动保留关键帧。
 */
function channelFeasible(
  values: number[],
  s: number,
  e: number,
  limit: number
): boolean {
  const denom = e - s
  const a = values[s]
  const span = values[e] - a
  for (let i = s + 1; i < e; i++) {
    const t = (i - s) / denom
    if (Math.abs(values[i] - (a + span * t)) > limit) return false
  }
  return true
}

/** 通道的段 (s, e) 内时刻插值偏差最大的中间点；段可行返回 -1 */
function channelSplit(
  values: number[],
  s: number,
  e: number,
  limit: number
): number {
  let max = 0
  let maxIdx = -1
  const denom = e - s
  const a = values[s]
  const span = values[e] - a
  for (let i = s + 1; i < e; i++) {
    const t = (i - s) / denom
    const d = Math.abs(values[i] - (a + span * t))
    if (d > max) {
      max = d
      maxIdx = i
    }
  }
  return max > limit ? maxIdx : -1
}

/** 把保留标记转为关键帧：保序，span 为相邻保留点的原始下标差 */
function collectFrames(values: number[], keep: boolean[]): ChannelKeyframe[] {
  const result: ChannelKeyframe[] = []
  let prevIdx = 0
  for (let i = 0; i < keep.length; i++) {
    if (!keep[i]) continue
    result.push({ value: values[i], span: i - prevIdx })
    prevIdx = i
  }
  return result
}

/**
 * 标量通道压缩：在"每个原始采样时刻的插值值偏差都不超过 tolerance"的
 * 约束下按所选算法分段。
 *
 * 保证：首尾点必保留、输出保序；span >= 1（首点为 0）且总和等于原始采样数 - 1
 */
export function simplifyChannel(
  values: number[],
  tolerance: number,
  algorithm: CompressionAlgorithm
): ChannelKeyframe[] {
  assertTolerance(tolerance)
  const n = values.length
  if (n === 0) return []
  if (n === 1) return [{ value: values[0], span: 0 }]

  const keep = keepByAlgorithm(
    n,
    algorithm,
    (s, e) => channelFeasible(values, s, e, tolerance),
    (s, e) => channelSplit(values, s, e, tolerance)
  )
  return collectFrames(values, keep)
}

/** 联合位置的段可行性：任一中间点的时刻插值欧氏偏差超限立即返回 false */
function positionFeasible(
  xs: number[],
  ys: number[],
  s: number,
  e: number,
  limitSq: number
): boolean {
  const denom = e - s
  const ax = xs[s]
  const ay = ys[s]
  const dxs = xs[e] - ax
  const dys = ys[e] - ay
  for (let i = s + 1; i < e; i++) {
    const t = (i - s) / denom
    const dx = xs[i] - (ax + dxs * t)
    const dy = ys[i] - (ay + dys * t)
    if (dx * dx + dy * dy > limitSq) return false
  }
  return true
}

/** 联合位置的段 (s, e) 内时刻插值偏差平方最大的中间点；段可行返回 -1 */
function positionSplit(
  xs: number[],
  ys: number[],
  s: number,
  e: number,
  limitSq: number
): number {
  let maxSq = 0
  let maxIdx = -1
  const denom = e - s
  const ax = xs[s]
  const ay = ys[s]
  const dxs = xs[e] - ax
  const dys = ys[e] - ay
  for (let i = s + 1; i < e; i++) {
    const t = (i - s) / denom
    const dx = xs[i] - (ax + dxs * t)
    const dy = ys[i] - (ay + dys * t)
    const d = dx * dx + dy * dy
    if (d > maxSq) {
      maxSq = d
      maxIdx = i
    }
  }
  return maxSq > limitSq ? maxIdx : -1
}

/**
 * 联合位置压缩：x、y 共享关键帧，约束为合成位置的时刻插值偏差
 * （欧氏距离）不超过 tolerance。帧数比两个分轴通道的并集更少——
 * 一个关键帧同时承载两轴，单轴的小折点可被另一轴的容差预算吸收。
 * 输入取两条同长数值序列，无需为两轴配对分配对象。
 */
export function simplifyPositions(
  xs: number[],
  ys: number[],
  tolerance: number,
  algorithm: CompressionAlgorithm
): PositionKeyframe[] {
  assertTolerance(tolerance)
  const n = xs.length
  if (n === 0) return []
  if (n === 1) return [{ x: xs[0], y: ys[0], span: 0 }]

  const limitSq = tolerance * tolerance
  const keep = keepByAlgorithm(
    n,
    algorithm,
    (s, e) => positionFeasible(xs, ys, s, e, limitSq),
    (s, e) => positionSplit(xs, ys, s, e, limitSq)
  )
  const result: PositionKeyframe[] = []
  let prevIdx = 0
  for (let i = 0; i < keep.length; i++) {
    if (!keep[i]) continue
    result.push({ x: xs[i], y: ys[i], span: i - prevIdx })
    prevIdx = i
  }
  return result
}

/**
 * 把原始采样包装成无 span 的关键帧轨迹，让未压缩路径与压缩路径共用
 * 同一轨迹接口（仅调试用途，不参与性能关键的记录与压缩）。
 */
export function toKeyframeTrajectory(raw: RawTrajectory): Trajectory {
  return {
    x: raw.x.map((value) => ({ value })),
    y: raw.y.map((value) => ({ value })),
    rotation: raw.rotation?.map((value) => ({ value }))
  }
}

/**
 * 通道化轨迹压缩入口：x、y 与自转各自独立分段，互不拖累。
 * tolerance 为单轴容差：两轴各自与真实坐标的插值偏差都不超过它
 * （合成位移上界为其 √2 倍）。
 *
 * @param trajectory 原始采样轨迹
 * @param tolerance 单轴位置容差，物理坐标单位
 * @param maxRotationError 自转角插值误差上限（弧度）；0 为不压缩旋转通道，
 *   全量保留
 * @param algorithm 分段算法。默认 Greedy：真实轨迹上关键帧数仅比全局最优
 *   （DP）多 1~3%，耗时低一个数量级；追求极致体积可改用 DP
 * @param withJoint 同时产出联合位置表达（欧氏容差）；拆分通道折点错开时
 *   联合帧数更少
 */
export function compressTrajectory(
  trajectory: RawTrajectory,
  tolerance: number,
  maxRotationError: number,
  algorithm: CompressionAlgorithm = 'Greedy',
  withJoint: boolean = false
): Trajectory {
  const rotation = trajectory.rotation
  const result: Trajectory = {
    x: simplifyChannel(trajectory.x, tolerance, algorithm),
    y: simplifyChannel(trajectory.y, tolerance, algorithm),
    rotation:
      rotation && rotation.length > 0
        ? maxRotationError > 0
          ? simplifyChannel(rotation, maxRotationError, algorithm)
          : rotation.map((value) => ({ value }))
        : undefined
  }
  if (withJoint) {
    result.joint = simplifyPositions(
      trajectory.x,
      trajectory.y,
      tolerance,
      algorithm
    )
  }
  return result
}

/** 通道各关键帧的归一化时刻（span 前缀和 / 总采样间隔）；未压缩为均分 */
function channelTimeline(frames: { span?: number }[]): number[] {
  const n = frames.length
  if (frames[0].span === undefined) {
    return Array.from({ length: n }, (_, i) => (n === 1 ? 0 : i / (n - 1)))
  }
  const total = frames.reduce((sum, f) => sum + (f.span ?? 0), 0)
  // frames[k].span 是帧 k 与前一帧的间隔，先累加再取时刻（首帧恒为 0）
  const times: number[] = [0]
  let acc = 0
  for (const f of frames.slice(1)) {
    acc += f.span ?? 0
    times.push(acc / total)
  }
  return times
}

/** 时刻 t 处通道的线性插值值；timeline 为 channelTimeline 的产出 */
function sampleChannel(
  frames: ChannelKeyframe[],
  timeline: number[],
  t: number
): number {
  // k 定位 t 所属的段 [timeline[k], timeline[k + 1]]
  let k = 0
  while (k + 2 < frames.length && timeline[k + 1] <= t) k++
  const span = timeline[k + 1] - timeline[k]
  const frac = span === 0 ? 0 : (t - timeline[k]) / span
  return frames[k].value + (frames[k + 1].value - frames[k].value) * frac
}

/** 时刻序列化为严格递增的 keyTimes：首帧 0、末帧 1，舍入后相邻防碰撞 */
function normalizeKeyTimes(times: number[]): number[] {
  const keyTimes: number[] = [0]
  for (const t of times.slice(1, -1)) {
    // 严格递增：相邻至少差 1e-6，避免长轨迹舍入后相邻值相同
    const prev = keyTimes[keyTimes.length - 1]
    keyTimes.push(Math.min(Math.max(+t.toFixed(6), prev + 1e-6), 0.999999))
  }
  // 末帧强制为 1，消除累计浮点误差
  keyTimes.push(1)
  return keyTimes
}

export interface MergedPositionFrames {
  /** 并集时刻的联合坐标帧（按时间升序） */
  points: { x: number; y: number }[]
  /** 各帧归一化时刻；null 表示输入未启用压缩（无 span） */
  keyTimes: number[] | null
}

/** 并集重采样点的无损合并阈值（物理单位），吸收插值的浮点舍入 */
const MERGE_EPSILON = 1e-9

/**
 * 并集帧中两轴都匀速共线的中间点可以无损丢弃：并集相邻时刻之间两轴
 * 都线性，丢弃后插值在任意时刻的值不变。抵消并集引入的冗余帧——
 * x 与 y 的折点时刻不同时，并集会把这些点两两互插一遍。
 */
function compactUnion(
  points: { x: number; y: number }[],
  times: number[]
): { points: { x: number; y: number }[]; times: number[] } {
  const n = points.length
  if (n < 3) return { points, times }

  const keptPoints = [points[0]]
  const keptTimes = [times[0]]
  let s = 0
  while (s < n - 1) {
    // 逐步扩展段尾：整段内所有中间点都在首尾连线上则整段可合并
    let e = s + 1
    while (e < n - 1) {
      const next = e + 1
      const span = times[next] - times[s]
      let mergeable = true
      for (let i = s + 1; i <= e; i++) {
        const t = span === 0 ? 0 : (times[i] - times[s]) / span
        const px = points[s].x + (points[next].x - points[s].x) * t
        const py = points[s].y + (points[next].y - points[s].y) * t
        if (
          Math.abs(points[i].x - px) > MERGE_EPSILON ||
          Math.abs(points[i].y - py) > MERGE_EPSILON
        ) {
          mergeable = false
          break
        }
      }
      if (!mergeable) break
      e = next
    }
    keptPoints.push(points[e])
    keptTimes.push(times[e])
    s = e
  }
  return { points: keptPoints, times: keptTimes }
}

/**
 * 把拆分的 x/y 通道重联合为共享时间轴的帧序列。
 *
 * 时刻取两通道关键帧时间轴的并集：并集相邻点之间两轴都线性，合成轨迹
 * 仍是精确的匀速直线段，每个并集时刻两轴都精确命中各自通道的插值值，
 * 因此联合表达与拆分表达视觉无损等价。并集中两轴都共线匀速的冗余点
 * 会被无损合并掉。
 */
export function mergePositionChannels(
  x: ChannelKeyframe[],
  y: ChannelKeyframe[]
): MergedPositionFrames {
  const uniform = x[0].span === undefined && y[0].span === undefined
  if (uniform) {
    // 未压缩：两通道帧数相同且均分，逐帧配对即精确值
    const n = Math.min(x.length, y.length)
    return {
      points: Array.from({ length: n }, (_, i) => ({
        x: x[i].value,
        y: y[i].value
      })),
      keyTimes: null
    }
  }

  const xTimes = channelTimeline(x)
  const yTimes = channelTimeline(y)
  // 两通道的同一原始时刻数值精确相等（同一 span 前缀和算式），Set 去重即可
  const times = [...new Set([...xTimes, ...yTimes])].sort((a, b) => a - b)
  if (times.length < 2) {
    return { points: [{ x: x[0].value, y: y[0].value }], keyTimes: null }
  }
  const merged = compactUnion(
    times.map((t) => ({
      x: sampleChannel(x, xTimes, t),
      y: sampleChannel(y, yTimes, t)
    })),
    times
  )
  if (merged.points.length < 2) {
    return { points: merged.points, keyTimes: null }
  }
  return {
    points: merged.points,
    keyTimes: normalizeKeyTimes(merged.times)
  }
}

/**
 * 将关键帧的 span 归一化为时间数组：各时刻 = span 前缀和占总和的比例，
 * 首帧恒为 0、末帧恒为 1。适用于任意通道的关键帧序列；未启用压缩
 * （无 span）时返回 null。
 */
export function buildKeyTimesArray(
  frames: {
    span?: number
  }[]
): number[] | null {
  if (frames.length < 2 || frames[0].span === undefined) return null
  return normalizeKeyTimes(channelTimeline(frames))
}

/** 将关键帧时刻数组序列化为 SMIL animateTransform 的 keyTimes 属性值 */
export function buildKeyTimes(
  frames: {
    value: number
    span?: number
  }[]
): string | null {
  const keyTimes = buildKeyTimesArray(frames)
  return keyTimes ? keyTimes.join(';') : null
}
