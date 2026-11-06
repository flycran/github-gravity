/**
 * Compression benchmark: fetches real contribution data via the GitHub API,
 * simulates with compression disabled to obtain the raw trajectories, then
 * compares the DP / RDP / Greedy algorithms over several tolerances.
 *
 * 文件名不带 .test 后缀，避免被 bun test（CI）收集：真实接口调用 + 物理模拟太慢。
 * 手动运行：bun run compare
 */

import { maxChannelDeviation, sumSpans } from '../__tests__/simplifyHelpers'
import { SCALE } from '../src/const'
import { simulateRaw } from '../src/utils/physics'
import {
  CompressionAlgorithm,
  compressTrajectory
} from '../src/utils/simplifyTrajectory'

const algorithms: CompressionAlgorithm[] = ['DP', 'RDP', 'Greedy']

// 与 physics.ts 相同的换算：容差以 SVG 坐标单位输入，除以 SCALE 转为物理坐标单位
const tolerances = [0.5 / SCALE, 1.5 / SCALE, 3 / SCALE]

// 纯物理模拟拿原始采样轨迹（不经过压缩），压缩与计时都在本脚本内进行
const simulation = await simulateRaw({ username: 'Orta' })

const tracks = simulation.contributions.map((c) => c.trajectory)
const totalPoints = tracks.reduce((sum, t) => sum + t.x.length + t.y.length, 0)
console.log(
  `${tracks.length} trajectories, ${totalPoints} channel values total, ` +
    `avg ${Math.round(totalPoints / tracks.length / 2)} samples/track, ` +
    `${Math.round(simulation.stepCount)} steps`
)

interface Row {
  algorithm: string
  'tolerance(units)': string
  'avg keyframes': number
  compression: string
  'max deviation': number
  'runtime(ms)': number
}

const rows: Row[] = []

for (const algorithm of algorithms) {
  for (const tolerance of tolerances) {
    let kept = 0
    let maxDeviation = 0
    const start = performance.now()

    for (const track of tracks) {
      // 对比只关心坐标通道指标：旋转上限传 0，旋转通道无损全量保留
      const result = compressTrajectory(track, tolerance, 0, algorithm)
      kept += result.x.length + result.y.length
      if (
        sumSpans(result.x) !== track.x.length - 1 ||
        sumSpans(result.y) !== track.y.length - 1
      ) {
        throw new Error(`${algorithm}: span sum mismatch`)
      }
      // 单轴校验：每轴的插值偏差都不超过 tolerance（压缩承诺的误差上界）
      const deviation = Math.max(
        maxChannelDeviation(track.x, result.x),
        maxChannelDeviation(track.y, result.y)
      )
      if (deviation > tolerance + 1e-9) {
        throw new Error(
          `${algorithm}: deviation ${deviation} exceeds tolerance ${tolerance}`
        )
      }
      maxDeviation = Math.max(maxDeviation, deviation)
    }

    rows.push({
      algorithm,
      'tolerance(units)': (tolerance * SCALE).toFixed(2),
      // 每方块 x/y 两通道的关键帧总数
      'avg keyframes': +(kept / tracks.length).toFixed(1),
      compression: `${(totalPoints / kept).toFixed(1)}x`,
      'max deviation': +maxDeviation.toFixed(4),
      'runtime(ms)': +(performance.now() - start).toFixed(1)
    })
  }
}

console.table(rows)
