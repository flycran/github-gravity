/**
 * Compression benchmark: fetches real contribution data via the GitHub API,
 * simulates with compression disabled to obtain the raw trajectories, then
 * compares the DP / RDP / Greedy algorithms over several tolerances.
 *
 * 文件名不带 .test 后缀，避免被 bun test（CI）收集：真实接口调用 + 物理模拟太慢。
 * 手动运行：bun run compare
 */

import { maxLerpDeviation, sumSpans } from '../__tests__/simplifyHelpers'
import { startSimulation } from '../src/physics'
import {
  CompressedTrajectoryPoint,
  simplifyTrajectoryDP,
  simplifyTrajectoryGreedy,
  simplifyTrajectoryRDP
} from '../src/utils/simplifyTrajectory'

type Point = { x: number; y: number }
type SimplifyFn = (
  trajectory: Point[],
  tolerance: number
) => CompressedTrajectoryPoint[]

const algorithms: [string, SimplifyFn][] = [
  ['DP', simplifyTrajectoryDP],
  ['RDP', simplifyTrajectoryRDP],
  ['Greedy', simplifyTrajectoryGreedy]
]

// 与 physics.ts 相同的换算：容差以 SVG 像素输入，除以 SCALE 转为物理坐标单位
const SCALE = 3
const tolerances = [0.5 / SCALE, 1.5 / SCALE, 3 / SCALE]

// 禁用压缩拿到原始轨迹（不含 span），压缩与计时都在本脚本内进行
const simulation = await startSimulation({
  username: 'Orta',
  disableCompression: true
})

const tracks = simulation.contributions.map((c) => c.trajectory)
const totalPoints = tracks.reduce((sum, t) => sum + t.length, 0)
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

for (const [name, simplify] of algorithms) {
  for (const tolerance of tolerances) {
    let kept = 0
    let maxDeviation = 0
    const start = performance.now()

    for (const track of tracks) {
      const result = simplify(track, tolerance)
      kept += result.length
      if (sumSpans(result) !== track.length - 1) {
        throw new Error(`${name}: span sum mismatch`)
      }
      const deviation = maxLerpDeviation(track, result)
      if (deviation > tolerance + 1e-9) {
        throw new Error(
          `${name}: deviation ${deviation} exceeds tolerance ${tolerance}`
        )
      }
      maxDeviation = Math.max(maxDeviation, deviation)
    }

    rows.push({
      algorithm: name,
      'tolerance(px)': (tolerance * SCALE).toFixed(2),
      'avg keyframes': +(kept / tracks.length).toFixed(1),
      compression: `${(totalPoints / kept).toFixed(1)}x`,
      'max deviation': +maxDeviation.toFixed(4),
      'runtime(ms)': +(performance.now() - start).toFixed(1)
    })
  }
}

console.table(rows)
