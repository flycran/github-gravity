/**
 * Unit test: font loading and text path extraction, including custom font paths.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  getTextPaths,
  loadFontFromPath,
  loadFontFromUrl
} from '../src/parseTextPath'

const RELATIVE_FONT = 'public/LiberationSerif-Bold.ttf'
const ABSOLUTE_FONT = resolve(RELATIVE_FONT)
const BUNDLED_FONT_URL = new URL(
  '../public/LiberationSerif-Bold.ttf',
  import.meta.url
)

describe('getTextPaths', () => {
  it('uses the bundled font when no source is provided', async () => {
    const implicit = await getTextPaths('Hi', 40)
    const explicit = await getTextPaths('Hi', 40, ABSOLUTE_FONT)

    expect(implicit.length).toBe(2)
    expect(implicit.map((p) => p.pathData)).toEqual(
      explicit.map((p) => p.pathData)
    )
  })

  it('resolves a relative path against the working directory', async () => {
    const fromCwd = await getTextPaths('Hi', 40, RELATIVE_FONT)
    const fromAbsolute = await getTextPaths('Hi', 40, ABSOLUTE_FONT)

    expect(fromCwd.map((p) => p.pathData)).toEqual(
      fromAbsolute.map((p) => p.pathData)
    )
  })

  it('accepts a Buffer as font data', async () => {
    const fromBuffer = await getTextPaths('Hi', 40, readFileSync(ABSOLUTE_FONT))
    const fromPath = await getTextPaths('Hi', 40, ABSOLUTE_FONT)

    expect(fromBuffer.map((p) => p.pathData)).toEqual(
      fromPath.map((p) => p.pathData)
    )
  })

  it('accepts an ArrayBuffer as font data', async () => {
    // Buffer 是共享 ArrayBuffer 的视图，slice 模拟 files[0].arrayBuffer() 的完整副本
    const arrayBuffer = readFileSync(ABSOLUTE_FONT).buffer.slice(
      0
    ) as ArrayBuffer
    const fromData = await getTextPaths('Hi', 40, arrayBuffer)
    const fromPath = await getTextPaths('Hi', 40, ABSOLUTE_FONT)

    expect(fromData.map((p) => p.pathData)).toEqual(
      fromPath.map((p) => p.pathData)
    )
  })

  it('accepts a file: URL object', async () => {
    const fromUrl = await getTextPaths('Hi', 40, BUNDLED_FONT_URL)
    const fromPath = await getTextPaths('Hi', 40, ABSOLUTE_FONT)

    expect(fromUrl.map((p) => p.pathData)).toEqual(
      fromPath.map((p) => p.pathData)
    )
  })

  it('emits path data, a bounding box and a triangulated mesh per glyph', async () => {
    const [glyph] = await getTextPaths('H', 40)

    expect(glyph.pathData.startsWith('M')).toBe(true)
    expect(glyph.rect.width).toBeGreaterThan(0)
    expect(glyph.rect.height).toBeGreaterThan(0)

    // 三角网格与同一份轮廓一一对应：索引按三元组组织，且不越界
    const vertexCount = glyph.paths.vertices.length / 2
    const indices = Array.from(glyph.paths.indices)
    expect(vertexCount).toBeGreaterThan(0)
    expect(indices.length % 3).toBe(0)
    expect(Math.max(...indices)).toBeLessThan(vertexCount)
  })

  it('returns one entry per glyph and scales with font size', async () => {
    expect((await getTextPaths('Hi', 40)).length).toBe(2)

    const [small] = await getTextPaths('H', 20)
    const [large] = await getTextPaths('H', 40)
    expect(large.rect.height / small.rect.height).toBeCloseTo(2, 5)
  })

  it('reports the resolved absolute path when the font file is missing', async () => {
    const missing = 'missing-font.ttf'
    expect(getTextPaths('Hi', 40, missing)).rejects.toThrow(
      `Failed to load font "${resolve(missing)}"`
    )
  })

  it('rejects a file that is not a font', () => {
    expect(getTextPaths('Hi', 40, 'package.json')).rejects.toThrow(
      'Failed to load font'
    )
  })

  it('tolerates text without glyphs', async () => {
    expect(await getTextPaths('', 40)).toEqual([])
  })
})

describe('loadFontFromPath', () => {
  it('reads a font file into an ArrayBuffer', async () => {
    const data = await loadFontFromPath(RELATIVE_FONT)

    expect(data).toBeInstanceOf(ArrayBuffer)
    expect(data.byteLength).toBeGreaterThan(0)
  })

  it('reports the resolved path when the file is missing', async () => {
    expect(loadFontFromPath('missing-font.ttf')).rejects.toThrow(
      `Failed to load font "${resolve('missing-font.ttf')}"`
    )
  })
})

describe('loadFontFromUrl', () => {
  it('reads a file: URL through the fs fallback', async () => {
    const data = await loadFontFromUrl(BUNDLED_FONT_URL)
    const fromPath = await loadFontFromPath(RELATIVE_FONT)

    expect(data.byteLength).toBe(fromPath.byteLength)
  })

  it('accepts a URL string', async () => {
    const data = await loadFontFromUrl(BUNDLED_FONT_URL.href)

    expect(data.byteLength).toBe(
      (await loadFontFromPath(RELATIVE_FONT)).byteLength
    )
  })

  it('rejects an invalid URL string', async () => {
    expect(loadFontFromUrl('http://[invalid')).rejects.toThrow(
      'Invalid font URL'
    )
  })

  it('reports the URL when the remote font is unreachable', async () => {
    const url = new URL('http://localhost:1/missing.ttf')
    expect(loadFontFromUrl(url)).rejects.toThrow(
      `Failed to load font from "${url.href}"`
    )
  })
})
