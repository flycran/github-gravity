/**
 * 单元测试：轨迹压缩算法 (DP / RDP / Greedy)
 * 使用时间插值偏差度量。
 */
import { describe, expect, it } from 'bun:test'
import { Point } from '../src/utils/physics'
import {
  buildKeyTimes,
  CompressedTrajectoryPoint,
  simplifyTrajectoryDP,
  simplifyTrajectoryGreedy,
  simplifyTrajectoryRDP
} from '../src/utils/simplifyTrajectory'
import { maxLerpDeviation, maxSpinDeviation, sumSpans } from './simplifyHelpers'

type SimplifyFn = (
  trajectory: Point[],
  tolerance: number,
  rotationRadius?: number
) => CompressedTrajectoryPoint[]

const algorithms: [string, SimplifyFn][] = [
  ['DP', simplifyTrajectoryDP],
  ['RDP', simplifyTrajectoryRDP],
  ['Greedy', simplifyTrajectoryGreedy]
]

describe('simplifyTrajectory algorithms', () => {
  for (const [name, simplify] of algorithms) {
    describe(name, () => {
      it('handles trivial inputs: empty, single point, two points', () => {
        expect(simplify([], 1)).toEqual([])
        expect(simplify([{ x: 1, y: 2 }], 1)).toEqual([{ x: 1, y: 2, span: 0 }])
        expect(
          simplify(
            [
              { x: 0, y: 0 },
              { x: 3, y: 4 }
            ],
            1
          )
        ).toEqual([
          { x: 0, y: 0, span: 0 },
          { x: 3, y: 4, span: 1 }
        ])
      })

      it('keeps the speed-change midpoint of a collinear trajectory at tolerance 0', () => {
        // 回归用例：三点共线但速度突变（一步 √2，一步 2√2），
        // 丢掉中点会让播放端线性插值变成匀速运动
        expect(
          simplify(
            [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
              { x: 3, y: 3 }
            ],
            0
          )
        ).toEqual([
          { x: 0, y: 0, span: 0 },
          { x: 1, y: 1, span: 1 },
          { x: 3, y: 3, span: 1 }
        ])
      })

      it('collapses a uniform collinear trajectory to endpoints at tolerance 0', () => {
        // 匀速直线段的插值精确命中每个时刻，压缩不影响保真度
        expect(
          simplify(
            [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
              { x: 2, y: 2 }
            ],
            0
          )
        ).toEqual([
          { x: 0, y: 0, span: 0 },
          { x: 2, y: 2, span: 2 }
        ])
      })

      it('keeps a constant-position keyframe where motion stops at tolerance 0', () => {
        // 走到 (2,2) 后静止 2 步：停顿起点必须保留为关键帧，
        // 否则插值会提前滑向终点
        expect(
          simplify(
            [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 2, y: 2 },
              { x: 2, y: 2 },
              { x: 2, y: 2 }
            ],
            0
          )
        ).toEqual([
          { x: 0, y: 0, span: 0 },
          { x: 1, y: 0, span: 1 },
          { x: 2, y: 2, span: 1 },
          { x: 2, y: 2, span: 2 }
        ])
      })

      it('keeps every point at tolerance 0 on a curved trajectory', () => {
        // 曲率恒非零的抛物线上不存在可无损并段的相邻点
        const parabola = makeParabola(50)
        const result = simplify(parabola, 0)
        expect(result).toHaveLength(parabola.length)
        expect(result.every((p, i) => p.span === (i === 0 ? 0 : 1))).toBe(true)
      })

      it('drops points whose temporal deviation is within tolerance', () => {
        expect(
          simplify(
            [
              { x: 0, y: 0 },
              { x: 1, y: 0.5 },
              { x: 2, y: 0 }
            ],
            1
          )
        ).toEqual([
          { x: 0, y: 0, span: 0 },
          { x: 2, y: 0, span: 2 }
        ])
      })

      it('keeps the segment end where velocity jumps exactly at tolerance', () => {
        // (2,2)→(3,0) 与 (3,0)→(4,0) 速度突变：几何垂距为 0 但时刻插值偏差为 1，
        // 恰好压在容差边界上，允许并段；换成 tolerance < 1 则必须保留 (3,0)
        expect(
          simplify(
            [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 2, y: 2 },
              { x: 3, y: 0 },
              { x: 4, y: 0 }
            ],
            1
          )
        ).toEqual([
          { x: 0, y: 0, span: 0 },
          { x: 2, y: 2, span: 2 },
          { x: 4, y: 0, span: 2 }
        ])
      })

      it('bounds deviation, compresses and preserves total time on a parabola', () => {
        const parabola = makeParabola(50)
        const tolerance = 1
        const result = simplify(parabola, tolerance)
        expect(result.length).toBeLessThan(parabola.length)
        expect(sumSpans(result)).toBe(parabola.length - 1)
        expect(maxLerpDeviation(parabola, result)).toBeLessThanOrEqual(
          tolerance + 1e-9
        )
      })

      it('bounds deviation and preserves total time on a zigzag trajectory', () => {
        const zigzag: Point[] = Array.from({ length: 40 }, (_, i) => ({
          x: i,
          y: i % 2 === 0 ? 0 : 1.5
        }))
        const tolerance = 0.5
        const result = simplify(zigzag, tolerance)
        expect(sumSpans(result)).toBe(zigzag.length - 1)
        expect(maxLerpDeviation(zigzag, result)).toBeLessThanOrEqual(
          tolerance + 1e-9
        )
      })

      it('does not mutate the input trajectory', () => {
        const track: Point[] = [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 0 }
        ]
        const snapshot = track.map((p) => ({ ...p }))
        simplify(track, 0.1)
        expect(track).toEqual(snapshot)
      })

      it('throws on negative tolerance', () => {
        expect(() => simplify([{ x: 0, y: 0 }], -0.1)).toThrow(
          'tolerance must be >= 0, got -0.1'
        )
      })
    })
  }
})

describe('rotation-aware trajectories', () => {
  // 位置匀速右移 + 自转匀速：位置与角度的插值都精确命中
  const linearSpin: Point[] = Array.from({ length: 5 }, (_, i) => ({
    x: i,
    y: 0,
    rotation: i * 0.5
  }))

  for (const [name, simplify] of algorithms) {
    describe(name, () => {
      it('collapses uniform spin and drift to endpoints at tolerance 0', () => {
        expect(simplify(linearSpin, 0, 0.1)).toEqual([
          { x: 0, y: 0, rotation: 0, span: 0 },
          { x: 4, y: 0, rotation: 2, span: 4 }
        ])
      })

      it('keeps a keyframe where spin jumps far beyond the rotation error', () => {
        // 位置匀速但自转角在中点大跳变：丢弃中点的任何分段在该处的
        // 角度插值误差都是跳变幅度本身，远超上限，违反误差上界承诺，
        // 因此中点必须保留为关键帧——结论只依赖承诺，与算法实现无关
        const track: Point[] = [
          { x: 0, y: 0, rotation: 0 },
          { x: 1, y: 0, rotation: 10 },
          { x: 2, y: 0, rotation: 0 }
        ]
        expect(simplify(track, 0, 0.1)).toEqual([
          { x: 0, y: 0, rotation: 0, span: 0 },
          { x: 1, y: 0, rotation: 10, span: 1 },
          { x: 2, y: 0, rotation: 0, span: 1 }
        ])
      })

      it('ignores rotation when maxRotationError is 0', () => {
        // 上限 0 表示消费端不渲染旋转：只按位置度量，轨迹仍可并段
        expect(simplify(linearSpin, 0)).toEqual([
          { x: 0, y: 0, rotation: 0, span: 0 },
          { x: 4, y: 0, rotation: 2, span: 4 }
        ])
      })

      it('bounds spin deviation on an accelerating spin', () => {
        const track: Point[] = Array.from({ length: 30 }, (_, i) => ({
          x: 0,
          y: 0,
          rotation: 0.1 * i * i
        }))
        const maxRotationError = 0.4
        const result = simplify(track, 0.4, maxRotationError)
        expect(sumSpans(result)).toBe(track.length - 1)
        expect(maxSpinDeviation(track, result)).toBeLessThanOrEqual(
          maxRotationError + 1e-9
        )
      })
    })
  }
})

describe('buildKeyTimes', () => {
  it('stays strictly increasing for very long trajectories', () => {
    // 2000 段等长 span：小数舍入可能把相邻值舍成相同（SMIL 要求严格递增）
    const trajectory = Array.from({ length: 2001 }, (_, i) => ({
      x: i,
      y: 0,
      span: i === 0 ? 0 : 1
    }))
    const keyTimes = buildKeyTimes(trajectory)!.split(';').map(Number)
    expect(keyTimes).toHaveLength(2001)
    for (let i = 1; i < keyTimes.length; i++) {
      expect(keyTimes[i]).toBeGreaterThan(keyTimes[i - 1])
    }
    expect(keyTimes[0]).toBe(0)
    expect(keyTimes[keyTimes.length - 1]).toBe(1)
  })
})

function makeParabola(length: number): Point[] {
  return Array.from({ length }, (_, i) => {
    const t = i / (length - 1)
    return { x: t * 100, y: 100 * (1 - (2 * t - 1) ** 2) }
  })
}
