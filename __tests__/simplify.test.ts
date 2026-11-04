/**
 * 单元测试：通道化轨迹压缩（DP / RDP / Greedy）。
 * 位置与自转按各自容差独立分段，使用时间插值偏差度量。
 */
import { describe, expect, it } from 'bun:test'
import {
  buildKeyTimes,
  CompressionAlgorithm,
  compressTrajectory,
  simplifyPositions,
  simplifyRotations,
  Trajectory
} from '../src/utils/simplifyTrajectory'
import { maxLerpDeviation, maxSpinDeviation, sumSpans } from './simplifyHelpers'

const algorithms: CompressionAlgorithm[] = ['DP', 'RDP', 'Greedy']

describe('simplifyPositions', () => {
  for (const algorithm of algorithms) {
    describe(algorithm, () => {
      it('handles trivial inputs: empty, single point, two points', () => {
        expect(simplifyPositions([], 1, algorithm)).toEqual([])
        expect(simplifyPositions([{ x: 1, y: 2 }], 1, algorithm)).toEqual([
          { x: 1, y: 2, span: 0 }
        ])
        expect(
          simplifyPositions(
            [
              { x: 0, y: 0 },
              { x: 3, y: 4 }
            ],
            1,
            algorithm
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
          simplifyPositions(
            [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
              { x: 3, y: 3 }
            ],
            0,
            algorithm
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
          simplifyPositions(
            [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
              { x: 2, y: 2 }
            ],
            0,
            algorithm
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
          simplifyPositions(
            [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 2, y: 2 },
              { x: 2, y: 2 },
              { x: 2, y: 2 }
            ],
            0,
            algorithm
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
        const result = simplifyPositions(parabola, 0, algorithm)
        expect(result).toHaveLength(parabola.length)
        expect(result.every((p, i) => p.span === (i === 0 ? 0 : 1))).toBe(true)
      })

      it('drops points whose temporal deviation is within tolerance', () => {
        expect(
          simplifyPositions(
            [
              { x: 0, y: 0 },
              { x: 1, y: 0.5 },
              { x: 2, y: 0 }
            ],
            1,
            algorithm
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
          simplifyPositions(
            [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 2, y: 2 },
              { x: 3, y: 0 },
              { x: 4, y: 0 }
            ],
            1,
            algorithm
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
        const result = simplifyPositions(parabola, tolerance, algorithm)
        expect(result.length).toBeLessThan(parabola.length)
        expect(sumSpans(result)).toBe(parabola.length - 1)
        expect(maxLerpDeviation(parabola, result)).toBeLessThanOrEqual(
          tolerance + 1e-9
        )
      })

      it('bounds deviation and preserves total time on a zigzag trajectory', () => {
        const zigzag = Array.from({ length: 40 }, (_, i) => ({
          x: i,
          y: i % 2 === 0 ? 0 : 1.5
        }))
        const tolerance = 0.5
        const result = simplifyPositions(zigzag, tolerance, algorithm)
        expect(sumSpans(result)).toBe(zigzag.length - 1)
        expect(maxLerpDeviation(zigzag, result)).toBeLessThanOrEqual(
          tolerance + 1e-9
        )
      })

      it('does not mutate the input trajectory', () => {
        const track = [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 0 }
        ]
        const snapshot = track.map((p) => ({ ...p }))
        simplifyPositions(track, 0.1, algorithm)
        expect(track).toEqual(snapshot)
      })

      it('throws on negative tolerance', () => {
        expect(() =>
          simplifyPositions([{ x: 0, y: 0 }], -0.1, algorithm)
        ).toThrow('tolerance must be >= 0, got -0.1')
      })
    })
  }
})

describe('simplifyRotations', () => {
  for (const algorithm of algorithms) {
    describe(algorithm, () => {
      it('handles trivial inputs: empty, single point, two points', () => {
        expect(simplifyRotations([], 0.1, algorithm)).toEqual([])
        expect(simplifyRotations([0.5], 0.1, algorithm)).toEqual([
          { value: 0.5, span: 0 }
        ])
        expect(simplifyRotations([0, 1], 0.1, algorithm)).toEqual([
          { value: 0, span: 0 },
          { value: 1, span: 1 }
        ])
      })

      it('collapses a uniform spin to endpoints at tolerance 0', () => {
        // 匀速自转的线性插值精确命中每个时刻
        expect(simplifyRotations([0, 0.5, 1, 1.5, 2], 0, algorithm)).toEqual([
          { value: 0, span: 0 },
          { value: 2, span: 4 }
        ])
      })

      it('keeps a keyframe where the angle jumps far beyond the error bound', () => {
        // 角度在中点大跳变：丢弃中点的任何分段在该处的插值误差都是
        // 跳变幅度本身，远超上限，因此中点必须保留——结论只依赖承诺
        expect(simplifyRotations([0, 10, 0], 0.1, algorithm)).toEqual([
          { value: 0, span: 0 },
          { value: 10, span: 1 },
          { value: 0, span: 1 }
        ])
      })

      it('bounds deviation on an accelerating spin', () => {
        const spin = Array.from({ length: 30 }, (_, i) => 0.1 * i * i)
        const tolerance = 0.4
        const result = simplifyRotations(spin, tolerance, algorithm)
        expect(sumSpans(result)).toBe(spin.length - 1)
        expect(maxSpinDeviation(spin, result)).toBeLessThanOrEqual(
          tolerance + 1e-9
        )
      })

      it('throws on negative tolerance', () => {
        expect(() => simplifyRotations([0], -0.1, algorithm)).toThrow(
          'tolerance must be >= 0, got -0.1'
        )
      })
    })
  }
})

describe('compressTrajectory', () => {
  // 位置匀速右移 + 自转匀速：两通道的插值都精确命中，各自收缩为两帧
  const uniformTrajectory: Trajectory = {
    position: Array.from({ length: 5 }, (_, i) => ({ x: i, y: 0 })),
    rotation: Array.from({ length: 5 }, (_, i) => ({ value: i * 0.5 }))
  }

  it('compresses position and rotation channels independently', () => {
    const result = compressTrajectory(uniformTrajectory, 0, 0.1)
    expect(result.position).toEqual([
      { x: 0, y: 0, span: 0 },
      { x: 4, y: 0, span: 4 }
    ])
    expect(result.rotation).toEqual([
      { value: 0, span: 0 },
      { value: 2, span: 4 }
    ])
  })

  it('shrinks a constant rotation channel without affecting position', () => {
    // 旋转恒定、位置运动：旋转通道收缩为两帧等值，位置按自身节奏压缩
    const trajectory: Trajectory = {
      position: uniformTrajectory.position,
      rotation: Array.from({ length: 5 }, () => ({ value: 0.7 }))
    }
    const result = compressTrajectory(trajectory, 0, 0.1)
    expect(result.position).toHaveLength(2)
    expect(result.rotation).toEqual([
      { value: 0.7, span: 0 },
      { value: 0.7, span: 4 }
    ])
  })

  it('does not let a fast-spinning channel densify the position channel', () => {
    // 位置匀速但自转角在中点跳变：旧联合压缩会因角度约束保留 3 个位置帧，
    // 通道分离后位置通道保持 2 帧，跳变只加密旋转通道
    const trajectory: Trajectory = {
      position: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 }
      ],
      rotation: [{ value: 0 }, { value: 10 }, { value: 0 }]
    }
    const result = compressTrajectory(trajectory, 0, 0.1)
    expect(result.position).toEqual([
      { x: 0, y: 0, span: 0 },
      { x: 2, y: 0, span: 2 }
    ])
    expect(result.rotation).toEqual([
      { value: 0, span: 0 },
      { value: 10, span: 1 },
      { value: 0, span: 1 }
    ])
  })

  it('keeps independent time conservation per channel', () => {
    const parabola = makeParabola(40)
    const trajectory: Trajectory = {
      position: parabola,
      rotation: parabola.map((_, i) => ({ value: i * 0.3 }))
    }
    const tolerance = 1
    const result = compressTrajectory(trajectory, tolerance, 0.4)
    expect(sumSpans(result.position)).toBe(parabola.length - 1)
    expect(sumSpans(result.rotation!)).toBe(parabola.length - 1)
    expect(maxLerpDeviation(parabola, result.position)).toBeLessThanOrEqual(
      tolerance + 1e-9
    )
    const spins = trajectory.rotation!.map((r) => r.value)
    expect(maxSpinDeviation(spins, result.rotation!)).toBeLessThanOrEqual(
      0.4 + 1e-9
    )
  })

  it('omits the rotation channel when the trajectory has none', () => {
    const result = compressTrajectory(
      { position: uniformTrajectory.position },
      0,
      0
    )
    expect(result.position).toHaveLength(2)
    expect(result.rotation).toBeUndefined()
  })

  it('keeps the rotation channel lossless when maxRotationError is 0', () => {
    // 上限 0 表示不压缩旋转通道：全量保留，按帧序均分时间（无 span）
    const result = compressTrajectory(uniformTrajectory, 0, 0)
    expect(result.rotation).toHaveLength(uniformTrajectory.rotation!.length)
    expect(result.rotation![0].span).toBeUndefined()
  })

  it('defaults to the Greedy algorithm', () => {
    const explicit = compressTrajectory(uniformTrajectory, 1, 0.1, 'Greedy')
    const defaulted = compressTrajectory(uniformTrajectory, 1, 0.1)
    expect(defaulted).toEqual(explicit)
  })
})

describe('buildKeyTimes', () => {
  it('stays strictly increasing for very long trajectories', () => {
    // 2000 段等长 span：小数舍入可能把相邻值舍成相同（SMIL 要求严格递增）
    const frames = Array.from({ length: 2001 }, (_, i) => ({
      x: i,
      y: 0,
      span: i === 0 ? 0 : 1
    }))
    const keyTimes = buildKeyTimes(frames)!.split(';').map(Number)
    expect(keyTimes).toHaveLength(2001)
    for (let i = 1; i < keyTimes.length; i++) {
      expect(keyTimes[i]).toBeGreaterThan(keyTimes[i - 1])
    }
    expect(keyTimes[0]).toBe(0)
    expect(keyTimes[keyTimes.length - 1]).toBe(1)
  })
})

function makeParabola(length: number): { x: number; y: number }[] {
  return Array.from({ length }, (_, i) => {
    const t = i / (length - 1)
    return { x: t * 100, y: 100 * (1 - (2 * t - 1) ** 2) }
  })
}
