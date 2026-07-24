/**
 * Integration test: full pipeline from gensvg → physics → font loading → SVG output.
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
mock.module('../src/github-contributions.ts', () => ({
  fetchContributions: mockFetchContributions,
  INTENSITY_COLORS: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']
}))

const { gensvg } = await import('../src/gensvg.js')

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
      sampleRate: 4,
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
})
