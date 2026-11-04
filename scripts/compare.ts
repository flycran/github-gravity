/**
 * Compression benchmark: fetches real contribution data via the GitHub API,
 * simulates with compression disabled to obtain the raw trajectories, then
 * compares the DP / RDP / Greedy algorithms over several tolerances.
 *
 * 文件名不带 .test 后缀，避免被 bun test（CI）收集：真实接口调用 + 物理模拟太慢。
 * 手动运行：bun run compare
 */

import { maxLerpDeviation, sumSpans } from '../__tests__/simplifyHelpers'
import { startSimulation } from '../src/utils/physics'
import {
  CompressionAlgorithm,
  compressTrajectory,
  Trajectory
} from '../src/utils/simplifyTrajectory'

const algorithms: CompressionAlgorithm[] = ['DP', 'RDP', 'Greedy']

// 与 physics.ts 相同的换算：容差以 SVG 像素输入，除以 SCALE 转为物理坐标单位
const SCALE = 3
const tolerances = [0.5 / SCALE, 1.5 / SCALE, 3 / SCALE]

// 禁用压缩拿到原始轨迹（不含 span），压缩与计时都在本脚本内进行
const simulation = await startSimulation({
  username: 'Orta',
  disableCompression: true
})

const tracks = simulation.contributions.map((c) => c.trajectory)
const totalPoints = tracks.reduce((sum, t) => sum + t.position.length, 0)
console.log(
  `${tracks.length} trajectories, ${totalPoints} points total, ` +
    `avg ${Math.round(totalPoints / tracks.length)} points/track, ` +
    `${Math.round(simulation.stepCount)} steps`
)

interface Row {
  algorithm: string
  'tolerance(px)': string
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
      // 对比只关心位置通道指标：旋转上限传 0，旋转通道无损全量保留
      const result: Trajectory = compressTrajectory(
        track,
        tolerance,
        0,
        algorithm
      )
      const position = result.position
      kept += position.length
      if (sumSpans(position) !== track.position.length - 1) {
        throw new Error(`${algorithm}: span sum mismatch`)
      }
      const deviation = maxLerpDeviation(track.position, position)
      if (deviation > tolerance + 1e-9) {
        throw new Error(
          `${algorithm}: deviation ${deviation} exceeds tolerance ${tolerance}`
        )
      }
      maxDeviation = Math.max(maxDeviation, deviation)
    }

    rows.push({
      algorithm,
      'tolerance(px)': (tolerance * SCALE).toFixed(2),
      'avg keyframes': +(kept / tracks.length).toFixed(1),
      compression: `${(totalPoints / kept).toFixed(1)}x`,
      'max deviation': +maxDeviation.toFixed(4),
      'runtime(ms)': +(performance.now() - start).toFixed(1)
    })
  }
}

console.table(rows)
