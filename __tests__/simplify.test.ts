/**
 * 单元测试：通道化轨迹压缩（DP / RDP / Greedy）。
 * x、y 与自转各自按容差独立分段，使用时间插值偏差度量。
 */
import { describe, expect, it } from 'bun:test'
import {
  buildKeyTimes,
  CompressionAlgorithm,
  compressTrajectory,
  mergePositionChannels,
  RawTrajectory,
  simplifyChannel,
  simplifyPositions
} from '../src/utils/simplifyTrajectory'
import {
  maxChannelDeviation,
  maxLerpDeviation,
  sumSpans
} from './simplifyHelpers'

const algorithms: CompressionAlgorithm[] = ['DP', 'RDP', 'Greedy']

describe('simplifyChannel', () => {
  for (const algorithm of algorithms) {
    describe(algorithm, () => {
      const simplify = (values: number[], tolerance: number) =>
        simplifyChannel(values, tolerance, algorithm)

      it('handles trivial inputs: empty, single point, two points', () => {
        expect(simplifyChannel([], 1, algorithm)).toEqual([])
        expect(simplifyChannel([2], 1, algorithm)).toEqual([
          { value: 2, span: 0 }
        ])
        expect(simplifyChannel([0, 3], 1, algorithm)).toEqual([
          { value: 0, span: 0 },
          { value: 3, span: 1 }
        ])
      })

      it('keeps the speed-change midpoint of a collinear trajectory at tolerance 0', () => {
        // 回归用例：三点共线但速度突变（一步 1，一步 2），
        // 丢掉中点会让播放端线性插值变成匀速运动
        expect(simplify([0, 1, 3], 0)).toEqual([
          { value: 0, span: 0 },
          { value: 1, span: 1 },
          { value: 3, span: 1 }
        ])
      })

      it('collapses a uniform linear trajectory to endpoints at tolerance 0', () => {
        // 匀速段的插值精确命中每个时刻，压缩不影响保真度
        expect(simplify([0, 1, 2], 0)).toEqual([
          { value: 0, span: 0 },
          { value: 2, span: 2 }
        ])
      })

      it('keeps a keyframe where motion stops at tolerance 0', () => {
        // 匀速走 2 步后停 2 步：停顿起点必须保留为关键帧，
        // 否则插值会提前滑向终点
        expect(simplify([0, 1, 2, 2, 2], 0)).toEqual([
          { value: 0, span: 0 },
          { value: 2, span: 2 },
          { value: 2, span: 2 }
        ])
      })

      it('keeps every point at tolerance 0 on a curved trajectory', () => {
        // 曲率恒非零的曲线上不存在可无损并段的相邻点
        const curve = Array.from({ length: 50 }, (_, i) => i * i)
        const result = simplifyChannel(curve, 0, algorithm)
        expect(result).toHaveLength(curve.length)
        expect(result.every((p, i) => p.span === (i === 0 ? 0 : 1))).toBe(true)
      })

      it('drops points whose temporal deviation is within tolerance', () => {
        expect(simplify([0, 0.5, 0], 1)).toEqual([
          { value: 0, span: 0 },
          { value: 0, span: 2 }
        ])
      })

      it('bounds deviation, compresses and preserves total time on a curve', () => {
        const curve = Array.from({ length: 50 }, (_, i) => i * i)
        const tolerance = 4
        const result = simplifyChannel(curve, tolerance, algorithm)
        expect(result.length).toBeLessThan(curve.length)
        expect(sumSpans(result)).toBe(curve.length - 1)
        expect(maxChannelDeviation(curve, result)).toBeLessThanOrEqual(
          tolerance + 1e-9
        )
      })

      it('does not mutate the input trajectory', () => {
        const values = [0, 1, 0]
        simplifyChannel(values, 0.1, algorithm)
        expect(values).toEqual([0, 1, 0])
      })

      it('throws on negative tolerance', () => {
        expect(() => simplifyChannel([0], -0.1, algorithm)).toThrow(
          'tolerance must be >= 0, got -0.1'
        )
      })
    })
  }
})

describe('simplifyPositions', () => {
  for (const algorithm of algorithms) {
    describe(algorithm, () => {
      it('bounds the combined (euclidean) deviation, not per-axis', () => {
        // 两轴各偏 0.4：单轴都在容差内，但合成偏差 0.57 > 0.5，必须保留折点
        expect(
          simplifyPositions([0, 0.4, 0], [0, 0.4, 0], 0.5, algorithm)
        ).toEqual([
          { x: 0, y: 0, span: 0 },
          { x: 0.4, y: 0.4, span: 1 },
          { x: 0, y: 0, span: 1 }
        ])
      })

      it('absorbs a single-axis bump within the combined budget', () => {
        // 只有 y 偏 0.4：合成偏差 0.4 <= 0.5，可并段
        expect(
          simplifyPositions([0, 0, 0], [0, 0.4, 0], 0.5, algorithm)
        ).toEqual([
          { x: 0, y: 0, span: 0 },
          { x: 0, y: 0, span: 2 }
        ])
      })

      it('preserves total time and bounds deviation on a parabola', () => {
        const track = makeParabola(50)
        const tolerance = 1
        const result = simplifyPositions(
          track.map((p) => p.x),
          track.map((p) => p.y),
          tolerance,
          algorithm
        )
        expect(result.length).toBeLessThan(track.length)
        expect(sumSpans(result)).toBe(track.length - 1)
        expect(maxLerpDeviation(track, result)).toBeLessThanOrEqual(
          tolerance + 1e-9
        )
      })
    })
  }
})

describe('compressTrajectory', () => {
  // 位置匀速右移 + 自转匀速：三个通道的插值都精确命中，各自收缩为两帧
  const uniformTrajectory: RawTrajectory = {
    x: Array.from({ length: 5 }, (_, i) => i),
    y: Array.from({ length: 5 }, () => 0),
    rotation: Array.from({ length: 5 }, (_, i) => i * 0.5)
  }

  it('compresses x, y and rotation channels independently', () => {
    const result = compressTrajectory(uniformTrajectory, 0, 0.1)
    expect(result.x).toEqual([
      { value: 0, span: 0 },
      { value: 4, span: 4 }
    ])
    // y 全程恒定：收缩为两帧等值
    expect(result.y).toEqual([
      { value: 0, span: 0 },
      { value: 0, span: 4 }
    ])
    expect(result.rotation).toEqual([
      { value: 0, span: 0 },
      { value: 2, span: 4 }
    ])
  })

  it('does not let a fast-spinning channel densify the position channels', () => {
    // 位置匀速但自转角在中点跳变：旧联合压缩会因角度约束加密位置通道，
    // 通道分离后跳变只加密旋转通道
    const trajectory: RawTrajectory = {
      x: [0, 1, 2],
      y: [0, 0, 0],
      rotation: [0, 10, 0]
    }
    const result = compressTrajectory(trajectory, 0, 0.1)
    expect(result.x).toEqual([
      { value: 0, span: 0 },
      { value: 2, span: 2 }
    ])
    expect(result.rotation).toEqual([
      { value: 0, span: 0 },
      { value: 10, span: 1 },
      { value: 0, span: 1 }
    ])
  })

  it('keeps independent time conservation and per-axis bounds', () => {
    const trajectory: RawTrajectory = {
      x: Array.from({ length: 40 }, (_, i) => i * 0.5),
      y: Array.from(
        { length: 40 },
        (_, i) => 100 * (1 - (2 * (i / 39) - 1) ** 2)
      ),
      rotation: Array.from({ length: 40 }, (_, i) => i * 0.3)
    }
    const tolerance = 4
    const result = compressTrajectory(trajectory, tolerance, 0.4)
    expect(sumSpans(result.x)).toBe(39)
    expect(sumSpans(result.y)).toBe(39)
    expect(sumSpans(result.rotation!)).toBe(39)
    expect(maxChannelDeviation(trajectory.x, result.x)).toBeLessThanOrEqual(
      tolerance + 1e-9
    )
    expect(maxChannelDeviation(trajectory.y, result.y)).toBeLessThanOrEqual(
      tolerance + 1e-9
    )
    expect(
      maxChannelDeviation(trajectory.rotation!, result.rotation!)
    ).toBeLessThanOrEqual(0.4 + 1e-9)
  })

  it('omits the rotation channel when the trajectory has none', () => {
    const { x, y } = uniformTrajectory
    const result = compressTrajectory({ x, y }, 0, 0)
    expect(result.x).toHaveLength(2)
    expect(result.y).toHaveLength(2)
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

  it('emits the joint position representation on request', () => {
    // joint 供 SMIL 消费：x/y 共享时间轴，欧氏偏差约束
    const result = compressTrajectory(uniformTrajectory, 0, 0.1, 'Greedy', true)
    expect(result.joint).toEqual([
      { x: 0, y: 0, span: 0 },
      { x: 4, y: 0, span: 4 }
    ])
    expect(sumSpans(result.joint!)).toBe(4)
  })

  it('omits the joint representation by default', () => {
    expect(compressTrajectory(uniformTrajectory, 0, 0.1).joint).toBeUndefined()
  })
})

describe('mergePositionChannels', () => {
  it('pairs frames directly for uncompressed channels', () => {
    const merged = mergePositionChannels(
      [{ value: 1 }, { value: 2 }, { value: 4 }],
      [{ value: 10 }, { value: 20 }, { value: 30 }]
    )
    expect(merged.points).toEqual([
      { x: 1, y: 10 },
      { x: 2, y: 20 },
      { x: 4, y: 30 }
    ])
    expect(merged.keyTimes).toBeNull()
  })

  it('unions the channel timelines and drops redundant collinear insertions', () => {
    // x 两帧（span 0,2）、y 三帧（span 0,1,1）：并集时刻 [0, 0.5, 1]，
    // 但中间点在两轴上都与首尾共线，丢掉后插值不变，故整段合并
    const merged = mergePositionChannels(
      [
        { value: 0, span: 0 },
        { value: 2, span: 2 }
      ],
      [
        { value: 0, span: 0 },
        { value: 10, span: 1 },
        { value: 20, span: 1 }
      ]
    )
    expect(merged.points).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 20 }
    ])
    expect(merged.keyTimes).toEqual([0, 1])
  })

  it('keeps non-collinear union frames', () => {
    // y 中途折返（速度突变）：该点不在首尾连线上，必须保留
    const merged = mergePositionChannels(
      [
        { value: 0, span: 0 },
        { value: 2, span: 2 }
      ],
      [
        { value: 0, span: 0 },
        { value: 10, span: 1 },
        { value: 0, span: 1 }
      ]
    )
    expect(merged.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 10 },
      { x: 2, y: 0 }
    ])
    expect(merged.keyTimes).toEqual([0, 0.5, 1])
  })

  it('interpolates identically to the split channels at every original moment', () => {
    // 无损性断言：对每个原始时刻，合并表达的线性插值必须等于拆分表达
    // 两通道各自的线性插值（SMIL 消费合并帧与 CSS 消费拆分通道视觉一致）
    const y = Array.from({ length: 30 }, (_, i) => i * i * 0.2)
    const x = Array.from({ length: 30 }, (_, i) => (i === 15 ? 99 : i * 0.1))
    const compressed = compressTrajectory({ x, y }, 3, 0)
    const merged = mergePositionChannels(compressed.x, compressed.y)
    expect(merged.keyTimes).not.toBeNull()
    expect(merged.keyTimes![0]).toBe(0)
    expect(merged.keyTimes![merged.keyTimes!.length - 1]).toBe(1)

    /** 关键帧序列在归一化时刻 t 处的线性插值 */
    const sample = (
      frames: typeof compressed.x,
      keyTimes: number[],
      t: number
    ) => {
      let k = 0
      while (k + 2 < frames.length && keyTimes[k + 1] <= t) k++
      const span = keyTimes[k + 1] - keyTimes[k]
      const frac = span === 0 ? 0 : (t - keyTimes[k]) / span
      return frames[k].value + (frames[k + 1].value - frames[k].value) * frac
    }

    // 通道自身的精确 timeline（span 前缀和 / 总和），与源码同一累加顺序
    const timeline = (frames: typeof compressed.x) => {
      const total = frames.reduce((s, f) => s + (f.span ?? 0), 0)
      const times: number[] = [0]
      let acc = 0
      for (const f of frames.slice(1)) {
        acc += f.span ?? 0
        times.push(acc / total)
      }
      return times
    }
    const xTimeline = timeline(compressed.x)
    const yTimeline = timeline(compressed.y)
    const samples = 120
    for (let s = 0; s <= samples; s++) {
      const t = s / samples
      // 合并插值：定位 t 所属段后线性插值
      let k = 0
      while (k + 2 < merged.points.length && merged.keyTimes![k + 1] <= t) k++
      const span = merged.keyTimes![k + 1] - merged.keyTimes![k]
      const frac = span === 0 ? 0 : (t - merged.keyTimes![k]) / span
      const mx =
        merged.points[k].x +
        (merged.points[k + 1].x - merged.points[k].x) * frac
      const my =
        merged.points[k].y +
        (merged.points[k + 1].y - merged.points[k].y) * frac
      // 合并 keyTimes 经 6 位舍入，帧间插值的时刻差被段值跨度放大，
      // 大跨度段（值突变帧附近）可达 1e-3 物理单位（< 0.01px @SCALE 3）；
      // 两边的消费端（SMIL/CSS）本身就以各自舍入后的时间轴播放，
      // 关键帧时刻精确命中，视觉等价
      expect(mx).toBeCloseTo(sample(compressed.x, xTimeline, t), 2)
      expect(my).toBeCloseTo(sample(compressed.y, yTimeline, t), 2)
    }
  })

  it('degrades to a single point when both channels have one frame', () => {
    const merged = mergePositionChannels(
      [{ value: 3, span: 0 }],
      [{ value: 7, span: 0 }]
    )
    expect(merged.points).toEqual([{ x: 3, y: 7 }])
    expect(merged.keyTimes).toBeNull()
  })
})

describe('buildKeyTimes', () => {
  it('stays strictly increasing for very long trajectories', () => {
    // 2000 段等长 span：小数舍入可能把相邻值舍成相同（SMIL 要求严格递增）
    const frames = Array.from({ length: 2001 }, (_, i) => ({
      value: i,
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
