/**
 * 集成测试：来自gensvg的完整管道→ 物理学→ 字体加载→ SVG输出。
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

function mockContributionsResponse() {
  return {
    total: 7,
    contributions: [
      [
        { date: '2026-07-19', intensity: 1, count: 1 },
        { date: '2026-07-20', intensity: 2, count: 5 },
        { date: '2026-07-21', intensity: 3, count: 10 },
        { date: '2026-07-22', intensity: 0, count: 0 },
        { date: '2026-07-23', intensity: 4, count: 20 },
        { date: '2026-07-24', intensity: 1, count: 3 },
        { date: '2026-07-25', intensity: 2, count: 7 }
      ]
    ]
  }
}

const mockFetchContributions = mock(async () => mockContributionsResponse())
mock.module('../src/utils/githubContributions.ts', () => ({
  fetchContributions: mockFetchContributions,
  INTENSITY_COLORS: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']
}))

const { gensvg } = await import('../src/utils/gensvg.js')

describe('full pipeline integration', () => {
  beforeEach(() => {
    mockFetchContributions.mockImplementation(async () =>
      mockContributionsResponse()
    )
  })

  afterEach(() => {
    mockFetchContributions.mockReset()
  })

  it('generates a valid SVG with contributions and text paths', async () => {
    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      shape: 'circle'
    })

    expect(typeof svg).toBe('string')
    expect(svg).toContain('<svg')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('<circle')
    expect(svg).toContain('animateTransform')
    expect(svg).toContain('<path d="')
    // Default background is transparent
    expect(svg).toContain('fill="transparent"')
    // Default text color is black
    expect(svg).toContain('fill="black"')
  })

  it('generates square-shaped contributions when shape is square', async () => {
    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      shape: 'square'
    })

    expect(svg).toContain('<rect')
    expect(svg).not.toContain('<circle')
  })

  it('adds rotation animation for square shapes only', async () => {
    const square = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      shape: 'square'
    })
    // 方形会翻滚：平移之外再叠加绕方块中心的自转
    expect(square).toContain('type="rotate"')
    expect(square).toContain('additive="sum"')

    const circle = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40
    })
    expect(circle).not.toContain('type="rotate"')
  })

  it('handles empty text gracefully', async () => {
    const svg = await gensvg({
      username: 'testuser',
      text: '',
      fontSize: 40
    })

    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg')
  })

  it('throws on invalid username (API error)', async () => {
    mockFetchContributions.mockImplementation(async () => {
      throw new Error(
        'Failed to fetch contributions for "nonexistent": 404 Not Found'
      )
    })

    await expect(
      gensvg({ username: 'nonexistent', text: 'Test' })
    ).rejects.toThrow('Failed to fetch contributions')
  })

  it('skips fetchContributions when calendarList is provided', async () => {
    mockFetchContributions.mockImplementation(async () => {
      throw new Error('fetchContributions should not be called')
    })

    const calendarList = {
      total: 11,
      contributions: [
        [
          { date: '2026-07-19', intensity: 1, count: 1 },
          { date: '2026-07-20', intensity: 0, count: 0 },
          { date: '2026-07-21', intensity: 3, count: 10 }
        ]
      ]
    }
    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      calendarList
    })

    // 数据完全来自 calendarList：count 非零的天数即方块数
    expect(svg.match(/<circle/g)?.length).toBe(2)
    expect(mockFetchContributions).not.toHaveBeenCalled()
  })

  it('produces deterministic SVG for same inputs', async () => {
    const svg1 = await gensvg({
      username: 'testuser',
      text: 'OK',
      fontSize: 30,
      shape: 'circle'
    })

    mockFetchContributions.mockImplementation(async () =>
      mockContributionsResponse()
    )

    const svg2 = await gensvg({
      username: 'testuser',
      text: 'OK',
      fontSize: 30,
      shape: 'circle'
    })

    expect(svg1).toBe(svg2)
  })

  it('uses custom background color', async () => {
    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      backgroundColor: '#1a1a2e'
    })

    expect(svg).toContain('fill="#1a1a2e"')
  })

  it('uses custom text color', async () => {
    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      textColor: '#ff0000'
    })

    expect(svg).toContain('fill="#ff0000"')
  })

  it('enables compression by default (tolerance 0.5, Greedy)', async () => {
    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40
    })

    // 默认开启压缩，轨迹携带 span 并输出 keyTimes
    expect(svg).toMatch(/keyTimes="0;[^"]*;1"/)
  })

  it('keeps lossless output when compression tolerance is 0', async () => {
    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      compressionTolerance: 0
    })

    // 容差 0 为无损压缩：匀速直线/静止段被并段，keyTimes 还原真实节奏
    expect(svg).toMatch(/keyTimes="0;[^"]*;1"/)
  })

  it('emits keyTimes and shrinks SVG with a larger tolerance', async () => {
    const plain = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40
    })
    const compressed = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      compressionTolerance: 1.5
    })

    // keyTimes 首帧 0、末帧 1
    expect(compressed).toMatch(/keyTimes="0;[^"]*;1"/)
    expect(compressed.length).toBeLessThan(plain.length)
  })

  it('disableCompression overrides compressionTolerance', async () => {
    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      compressionTolerance: 1.5,
      disableCompression: true
    })

    expect(svg).not.toContain('keyTimes')
  })

  it('honors custom width, height, size and interval', async () => {
    const dflt = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40
    })
    // viewBox 使用物理坐标（SCALE=1），显示尺寸再乘 scale 选项放大
    expect(dflt).toContain('width="900"')
    expect(dflt).toContain('viewBox="0 0 300 150"')
    expect(dflt).toContain(`r="${4 / 2}"`)

    const custom = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      width: 400,
      height: 200,
      size: 6,
      interval: 2
    })

    expect(custom).toContain('width="1200"')
    expect(custom).toContain('height="600"')
    expect(custom).toContain(`r="${6 / 2}"`)
    expect(custom).toContain('viewBox="0 0 400 200"')
  })

  it('treats explicitly undefined options as unset', async () => {
    const omitted = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40
    })
    const explicitUndefined = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      compressionTolerance: undefined,
      maxSimulationTime: undefined
    })

    // 键携带 undefined 与键不存在等效
    expect(explicitUndefined).toBe(omitted)
  })

  it('stops the simulation once maxSimulationTime is reached', async () => {
    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      maxSimulationTime: 0.2
    })

    // dur = 播放时长 = 模拟时长 / speed：0.2s × 3 倍速 = 0.6s 模拟时长 ≈ 18 步，
    // dur ≈ 200ms（浮点边界可能多走 1 步）；未截断时为数千毫秒
    const dur = parseFloat(svg.match(/dur="(\d+(?:\.\d+)?)ms"/)?.[1] ?? '0')
    expect(dur).toBeGreaterThanOrEqual(200)
    expect(dur).toBeLessThan(250)
  })

  it('renders with an explicitly provided font path', async () => {
    const font = new URL('../public/LiberationSerif-Bold.ttf', import.meta.url)
      .pathname

    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      font
    })

    expect(svg).toContain('<path d="')
    expect(svg).toContain('<circle')
  })

  it('throws a readable error for a missing font file', async () => {
    await expect(
      gensvg({
        username: 'testuser',
        text: 'Hi',
        fontSize: 40,
        font: '/nonexistent/font.ttf'
      })
    ).rejects.toThrow('Failed to load font "/nonexistent/font.ttf"')
  })
})

describe('css animation engine', () => {
  beforeEach(() => {
    mockFetchContributions.mockImplementation(async () =>
      mockContributionsResponse()
    )
  })

  afterEach(() => {
    mockFetchContributions.mockReset()
  })

  // 只冒烟引擎切换本身；动画的具体声明失效会直接表现为不动/走样，浏览器里肉眼可见
  it('renders with a self-contained style block instead of animateTransform', async () => {
    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      css: true
    })

    expect(svg).toContain('<style>')
    expect(svg).not.toContain('animateTransform')
  })

  it('applies a custom animation value', async () => {
    const svg = await gensvg({
      username: 'testuser',
      text: 'Hi',
      fontSize: 40,
      css: true,
      animation: 'none'
    })

    expect(svg).toContain('animation:none')
  })

  it('rejects animation values that would break the style block', async () => {
    await expect(
      gensvg({
        username: 'testuser',
        text: 'Hi',
        fontSize: 40,
        css: true,
        animation: '2s;color:red'
      })
    ).rejects.toThrow('Invalid animation')
  })
})
