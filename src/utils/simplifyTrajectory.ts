/**
 * 通道化轨迹压缩。
 *
 * 轨迹由独立通道组成：位置通道（x、y 共享时间轴）与自转角通道，每个通道
 * 按自己的容差独立分段——旋转恒定时旋转通道收缩为两个关键帧，位置通道
 * 不受影响；旋转剧变时也只有旋转通道加密。各通道时间轴互不相同，消费端
 * 按各自的 span 还原节奏。
 */

/** 位置通道关键帧。x、y 共享同一时间轴 */
export interface PositionKeyframe {
  x: number
  y: number
  /**
   * 与前一关键帧之间的原始采样点数（首帧为 0），全部 span 之和等于原始
   * 采样数 - 1；未压缩轨迹无此字段，消费端按帧序均分时间
   */
  span?: number
}

/** 自转角通道关键帧。值为弧度，已解缠绕，可直接线性插值 */
export interface RotationKeyframe {
  value: number
  /** 含义同 PositionKeyframe.span */
  span?: number
}

/** 通道化轨迹：每个通道独立的关键帧序列与时间轴 */
export interface Trajectory {
  position: PositionKeyframe[]
  /** 自转角通道；圆形或不跟踪自转时缺省 */
  rotation?: RotationKeyframe[]
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
 * 位置通道的段可行性：任一中间点的时刻插值偏差平方超限立即返回 false
 * （提前终止，长不可行段的开销为常数级）。
 * 度量含时间维：匀速直线段可整体并段，变速段会自动保留关键帧。
 */
function positionFeasible(
  samples: PositionKeyframe[],
  s: number,
  e: number,
  limitSq: number
): boolean {
  const denom = e - s
  const ax = samples[s].x
  const ay = samples[s].y
  const dxs = samples[e].x - ax
  const dys = samples[e].y - ay
  for (let i = s + 1; i < e; i++) {
    const t = (i - s) / denom
    const dx = samples[i].x - (ax + dxs * t)
    const dy = samples[i].y - (ay + dys * t)
    if (dx * dx + dy * dy > limitSq) return false
  }
  return true
}

/** 位置通道的段 (s, e) 内时刻插值偏差平方最大的中间点；段可行返回 -1 */
function positionSplit(
  samples: PositionKeyframe[],
  s: number,
  e: number,
  limitSq: number
): number {
  let maxSq = 0
  let maxIdx = -1
  const denom = e - s
  const ax = samples[s].x
  const ay = samples[s].y
  const dxs = samples[e].x - ax
  const dys = samples[e].y - ay
  for (let i = s + 1; i < e; i++) {
    const t = (i - s) / denom
    const dx = samples[i].x - (ax + dxs * t)
    const dy = samples[i].y - (ay + dys * t)
    const d = dx * dx + dy * dy
    if (d > maxSq) {
      maxSq = d
      maxIdx = i
    }
  }
  return maxSq > limitSq ? maxIdx : -1
}

/** 标量通道的段可行性：任一中间点的时刻插值偏差超限立即返回 false */
function scalarFeasible(
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

/** 标量通道的段 (s, e) 内时刻插值偏差最大的中间点；段可行返回 -1 */
function scalarSplit(
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

/** 把保留标记转为位置关键帧：保序，span 为相邻保留点的原始下标差 */
function collectPosition(
  samples: PositionKeyframe[],
  keep: boolean[]
): PositionKeyframe[] {
  const result: PositionKeyframe[] = []
  let prevIdx = 0
  for (let i = 0; i < keep.length; i++) {
    if (!keep[i]) continue
    result.push({ ...samples[i], span: i - prevIdx })
    prevIdx = i
  }
  return result
}

/** 把保留标记转为标量关键帧：保序，span 为相邻保留点的原始下标差 */
function collectScalar(values: number[], keep: boolean[]): RotationKeyframe[] {
  const result: RotationKeyframe[] = []
  let prevIdx = 0
  for (let i = 0; i < keep.length; i++) {
    if (!keep[i]) continue
    result.push({ value: values[i], span: i - prevIdx })
    prevIdx = i
  }
  return result
}

/**
 * 位置通道压缩：在"每个原始采样时刻的插值位置偏差都不超过 tolerance"的
 * 约束下按所选算法分段。
 *
 * 保证：首尾点必保留、输出保序；span >= 1（首点为 0）且总和等于原始采样数 - 1
 */
export function simplifyPositions(
  samples: PositionKeyframe[],
  tolerance: number,
  algorithm: CompressionAlgorithm
): PositionKeyframe[] {
  assertTolerance(tolerance)
  const n = samples.length
  if (n === 0) return []
  if (n === 1) return [{ ...samples[0], span: 0 }]

  const limitSq = tolerance * tolerance
  const keep = keepByAlgorithm(
    n,
    algorithm,
    (s, e) => positionFeasible(samples, s, e, limitSq),
    (s, e) => positionSplit(samples, s, e, limitSq)
  )
  return collectPosition(samples, keep)
}

/**
 * 标量通道压缩：约束与保证同 simplifyPositions，度量换成单值插值偏差。
 * 用于自转角等按弧度直接线性插值的通道
 */
export function simplifyRotations(
  values: number[],
  tolerance: number,
  algorithm: CompressionAlgorithm
): RotationKeyframe[] {
  assertTolerance(tolerance)
  const n = values.length
  if (n === 0) return []
  if (n === 1) return [{ value: values[0], span: 0 }]

  const keep = keepByAlgorithm(
    n,
    algorithm,
    (s, e) => scalarFeasible(values, s, e, tolerance),
    (s, e) => scalarSplit(values, s, e, tolerance)
  )
  return collectScalar(values, keep)
}

/**
 * 通道化轨迹压缩入口：位置与自转各自独立分段，互不拖累。
 *
 * @param trajectory 原始轨迹（无 span），重复压缩不支持
 * @param tolerance 位置容差，任意线性度量单位
 * @param maxRotationError 自转角插值误差上限（弧度）；0 为不压缩旋转通道，
 *   全量保留并按帧序均分时间
 * @param algorithm 分段算法。默认 Greedy：真实轨迹上关键帧数仅比全局最优
 *   （DP）多 1~3%，耗时低一个数量级；追求极致体积可改用 DP
 */
export function compressTrajectory(
  trajectory: Trajectory,
  tolerance: number,
  maxRotationError: number,
  algorithm: CompressionAlgorithm = 'Greedy'
): Trajectory {
  const rotation = trajectory.rotation
  return {
    position: simplifyPositions(trajectory.position, tolerance, algorithm),
    rotation:
      rotation && rotation.length > 0
        ? maxRotationError > 0
          ? simplifyRotations(
              rotation.map((r) => r.value),
              maxRotationError,
              algorithm
            )
          : rotation.map((r) => ({ value: r.value }))
        : undefined
  }
}

/**
 * 将关键帧的 span 归一化为时间数组：各时刻 = span 前缀和占总和的比例，
 * 首帧恒为 0、末帧恒为 1。适用于任意通道的关键帧序列；未启用压缩
 * （无 span）时返回 null，消费端按帧序均分时间处理。
 */
export function buildKeyTimesArray(
  frames: { span?: number }[]
): number[] | null {
  if (frames.length < 2 || frames[0].span === undefined) return null

  const total = frames.reduce((sum, p) => sum + (p.span ?? 0), 0)
  const keyTimes: number[] = [0]
  let acc = 0
  for (const p of frames.slice(1)) {
    acc += p.span ?? 0
    // 严格递增：相邻至少差 1e-6，避免长轨迹舍入后相邻值相同
    const prev = keyTimes[keyTimes.length - 1]
    const t = +(acc / total).toFixed(6)
    keyTimes.push(Math.min(Math.max(t, prev + 1e-6), 0.999999))
  }
  // 末帧强制为 1，消除累计浮点误差
  keyTimes[keyTimes.length - 1] = 1
  return keyTimes
}

/** 将关键帧时刻数组序列化为 SMIL animateTransform 的 keyTimes 属性值 */
export function buildKeyTimes(frames: { span?: number }[]): string | null {
  const keyTimes = buildKeyTimesArray(frames)
  return keyTimes ? keyTimes.join(';') : null
}
