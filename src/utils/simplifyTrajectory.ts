export interface CompressedTrajectoryPoint {
  x: number
  y: number
  /**
   * 与前一个保留点之间的原始轨迹点数（首点为 0）。
   * 全部 span 之和等于原始点数 - 1，消费端可累计 span 还原每个关键帧的时间位置
   */
  span: number
}

type Point = { x: number; y: number }

/**
 * 点 i 相对段 (s, e) 的时刻插值偏差平方。
 * 播放时相邻关键帧按时间比例线性插值，该值即 i 时刻的插值位置与真实位置的距离平方。
 * 度量含时间维：匀速直线段可整体并段，变速段会自动保留关键帧，速度随位置一同保真。
 */
function deviationSq(p: Point, s: Point, e: Point, t: number): number {
  const dx = p.x - (s.x + (e.x - s.x) * t)
  const dy = p.y - (s.y + (e.y - s.y) * t)
  return dx * dx + dy * dy
}

/**
 * 段 (s, e) 内各点的最大时刻插值偏差平方，与 limitSq 比较可全程避免开方。
 * 任一点超限立即返回 Infinity（提前终止，长不可行段的开销为常数级）。
 */
function segmentMaxDeviationSq(
  trajectory: Point[],
  s: number,
  e: number,
  limitSq: number
): number {
  let max = 0
  const denom = e - s
  for (let i = s + 1; i < e; i++) {
    const d = deviationSq(
      trajectory[i],
      trajectory[s],
      trajectory[e],
      (i - s) / denom
    )
    if (d > limitSq) return Infinity
    if (d > max) max = d
  }
  return max
}

function assertTolerance(tolerance: number): void {
  if (tolerance < 0) {
    throw new Error(`tolerance must be >= 0, got ${tolerance}`)
  }
}

/** 把保留标记转为输出：保序，span 为相邻保留点的原始索引差 */
function collectResult(
  trajectory: Point[],
  keep: boolean[]
): CompressedTrajectoryPoint[] {
  const result: CompressedTrajectoryPoint[] = []
  let prevIdx = 0
  for (let i = 0; i < keep.length; i++) {
    if (!keep[i]) continue
    result.push({ ...trajectory[i], span: i - prevIdx })
    prevIdx = i
  }
  return result
}

/**
 * 轨迹压缩——动态规划最优分段：
 * 在"每个原始点的时刻插值偏差都不超过 tolerance"的约束下，
 * 求关键帧数全局最少的分段（等价于 Imai–Iri 最优分段问题的 DP 解法）。
 *
 * 保证：
 * - 首尾点必保留，返回点按原始顺序排列；
 * - 任意被丢弃点在其原始时刻与相邻关键帧插值位置的偏差不超过 tolerance；
 * - 相同容差下关键帧数不多于其他策略（全局最优），输出体积最小；
 * - span >= 1（首点为 0），span 总和等于原始点数 - 1。
 */
export function simplifyTrajectoryDP(
  trajectory: Point[],
  tolerance: number = 0
): CompressedTrajectoryPoint[] {
  assertTolerance(tolerance)
  const n = trajectory.length
  if (n === 0) return []
  if (n === 1) return [{ ...trajectory[0], span: 0 }]

  const limitSq = tolerance * tolerance
  // cost[i]：起点到 i 的最少段数；parent[i]：最优解中 i 的前一个关键帧
  const cost = new Array<number>(n).fill(Infinity)
  const parent = new Array<number>(n).fill(-1)
  cost[0] = 0

  for (let i = 1; i < n; i++) {
    // j 从近到远：短段检查便宜，且尽早建立 cost[i] 上界以激活剪枝
    for (let j = i - 1; j >= 0; j--) {
      // 即使段 (j, i) 可行也不可能给出更优解时，跳过段检查
      if (cost[j] + 1 >= cost[i]) continue
      if (segmentMaxDeviationSq(trajectory, j, i, limitSq) > limitSq) continue
      cost[i] = cost[j] + 1
      parent[i] = j
    }
  }

  const keep = new Array<boolean>(n).fill(false)
  for (let i = n - 1; i > 0; i = parent[i]) keep[i] = true
  keep[0] = true
  return collectResult(trajectory, keep)
}

/**
 * 轨迹压缩——时空版 Ramer-Douglas-Peucker：
 * 递归分裂，每次在当前段内找时刻插值偏差最大的点作为新关键帧，
 * 直到所有被丢弃点的偏差都落入容差。
 *
 * 保证：
 * - 首尾点必保留，返回点按原始顺序排列；
 * - 任意被丢弃点在其原始时刻与相邻关键帧插值位置的偏差不超过 tolerance；
 * - 贪心分裂非全局最优，关键帧数一般多于动态规划；
 * - span >= 1（首点为 0），span 总和等于原始点数 - 1。
 */
export function simplifyTrajectoryRDP(
  trajectory: Point[],
  tolerance: number = 0
): CompressedTrajectoryPoint[] {
  assertTolerance(tolerance)
  const n = trajectory.length
  if (n === 0) return []
  if (n === 1) return [{ ...trajectory[0], span: 0 }]

  const keep = new Array<boolean>(n).fill(false)
  keep[0] = keep[n - 1] = true
  const limitSq = tolerance * tolerance

  // 显式栈代替递归，栈内为待检查的闭区间 [start, end]
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop()!
    if (end - start < 2) continue

    // 找开区间内时刻插值偏差最大的点
    let maxSq = 0
    let maxIdx = -1
    for (let i = start + 1; i < end; i++) {
      const d = deviationSq(
        trajectory[i],
        trajectory[start],
        trajectory[end],
        (i - start) / (end - start)
      )
      if (d > maxSq) {
        maxSq = d
        maxIdx = i
      }
    }

    // 最大偏差仍在容差内则整段并为一个插值段，否则在最差点处分段
    if (maxSq > limitSq) {
      keep[maxIdx] = true
      stack.push([start, maxIdx], [maxIdx, end])
    }
  }

  return collectResult(trajectory, keep)
}

/**
 * 轨迹压缩——单遍贪心最长段：
 * 从当前关键帧出发不断扩展段尾，直到加入下一点会使段内某点的
 * 时刻插值偏差超出容差，此时该段尾即为下一个关键帧。
 *
 * 保证：
 * - 首尾点必保留，返回点按原始顺序排列；
 * - 任意被丢弃点在其原始时刻与相邻关键帧插值位置的偏差不超过 tolerance；
 * - 单遍、不回溯，关键帧数通常介于 RDP 与动态规划之间；
 * - span >= 1（首点为 0），span 总和等于原始点数 - 1。
 */
export function simplifyTrajectoryGreedy(
  trajectory: Point[],
  tolerance: number = 0
): CompressedTrajectoryPoint[] {
  assertTolerance(tolerance)
  const n = trajectory.length
  if (n === 0) return []
  if (n === 1) return [{ ...trajectory[0], span: 0 }]

  const keep = new Array<boolean>(n).fill(false)
  keep[0] = keep[n - 1] = true
  const limitSq = tolerance * tolerance

  let s = 0
  while (s < n - 1) {
    // 插值线随段尾变化，段可行性对段尾没有单调性，只能逐步扩展并全段重查
    let e = s + 1
    while (
      e < n - 1 &&
      segmentMaxDeviationSq(trajectory, s, e + 1, limitSq) <= limitSq
    ) {
      e++
    }
    keep[e] = true
    s = e
  }

  return collectResult(trajectory, keep)
}

/**
 * 轨迹压缩默认入口——单遍贪心最长段。
 * 真实轨迹上其关键帧数仅比全局最优（simplifyTrajectoryDP）多 1~3%，
 * 耗时却低一个数量级：DP 的端点对 × 段检查随轨迹长度超线性膨胀，
 * 长轨迹（数千步）会到秒级，Greedy 稳定在毫秒级。
 * 追求极致体积且能接受秒级耗时时可显式改用 simplifyTrajectoryDP。
 *
 * tolerance=0 为完全无损：只有插值精确命中的匀速直线段/静止段被合并，
 * 位置与播放节奏（速度）都不失真；tolerance>0 时保证播放中
 * 每个原始时刻的插值位置误差不超过 tolerance。
 */
export function simplifyTrajectory(
  trajectory: Point[],
  tolerance: number = 0
): CompressedTrajectoryPoint[] {
  return simplifyTrajectoryGreedy(trajectory, tolerance)
}

/**
 * 将简化轨迹的 span 转为 SMIL animateTransform 的 keyTimes 属性值：
 * 各关键帧时刻 = span 前缀和占总和的比例，首帧恒为 0、末帧恒为 1。
 * 轨迹未携带 span（未启用压缩）时返回 null，消费端回退到 SMIL 默认均分时间。
 */
export function buildKeyTimes(
  trajectory: {
    span?: number
  }[]
): string | null {
  if (trajectory.length < 2 || trajectory[0].span === undefined) return null

  const total = trajectory.reduce((sum, p) => sum + (p.span ?? 0), 0)
  const keyTimes: number[] = [0]
  let acc = 0
  for (const p of trajectory.slice(1)) {
    acc += p.span ?? 0
    // SMIL 要求 keyTimes 严格递增：归一化后夹到 [prev + 1e-6, 0.999999]，
    // 避免极长轨迹下小数舍入把相邻值舍成相同
    const prev = keyTimes[keyTimes.length - 1]
    const t = +(acc / total).toFixed(6)
    keyTimes.push(Math.min(Math.max(t, prev + 1e-6), 0.999999))
  }
  // 末帧强制为 1，消除累计浮点误差
  keyTimes[keyTimes.length - 1] = 1
  return keyTimes.join(';')
}
