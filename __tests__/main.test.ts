/**
 * Unit test: GitHub Action input plumbing in main.ts.
 * Physics, network and SVG generation are mocked out; only input wiring is asserted.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../src/main'

let captured: Record<string, unknown> | null = null

mock.module('../src/gensvg.ts', () => ({
  gensvg: async (options: Record<string, unknown>) => {
    captured = options
    return '<svg />'
  }
}))

/** main.ts 读取的全部输入（@actions/core 按 INPUT_<NAME> 大写读取） */
const INPUT_NAMES = [
  'USERNAME',
  'TEXT',
  'OUTPUT_PATH',
  'FONT_SIZE',
  'COMPRESSION-TOLERANCE',
  'COMPRESSION-ALGORITHM',
  'SHAPE',
  'TEXT_TOP',
  'BACKGROUND_COLOR',
  'TEXT_COLOR',
  'WIDTH',
  'HEIGHT',
  'SIZE',
  'INTERVAL',
  'FONT_PATH'
]

function setInputs(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) {
    process.env[`INPUT_${name.toUpperCase()}`] = value
  }
}

let workDir = ''

beforeEach(() => {
  for (const name of INPUT_NAMES) delete process.env[`INPUT_${name}`]
  captured = null
  process.exitCode = 0
  workDir = mkdtempSync(join(tmpdir(), 'github-gravity-'))
  process.env.GITHUB_OUTPUT = join(workDir, 'output.txt')
  writeFileSync(process.env.GITHUB_OUTPUT, '')
  setInputs({
    USERNAME: 'testuser',
    'OUTPUT-PATH': join(workDir, 'out.svg')
  })
})

afterEach(() => {
  for (const name of INPUT_NAMES) delete process.env[`INPUT_${name}`]
  process.exitCode = 0
})

describe('action input plumbing', () => {
  it('passes only the core inputs when advanced ones are omitted', async () => {
    await run()

    expect(captured).toMatchObject({
      username: 'testuser',
      text: 'testuser',
      fontSize: 80,
      shape: 'circle',
      textTop: 50,
      backgroundColor: 'transparent',
      textColor: 'black'
    })
    // 未填写的可选参数不下传，交给库使用默认值
    expect(captured).not.toHaveProperty('compressionTolerance')
    expect(captured).not.toHaveProperty('compressionAlgorithm')
    expect(captured).not.toHaveProperty('width')
    expect(captured).not.toHaveProperty('height')
    expect(captured).not.toHaveProperty('size')
    expect(captured).not.toHaveProperty('interval')
    expect(captured).not.toHaveProperty('font')
  })

  it('forwards compression options and world geometry as numbers', async () => {
    setInputs({
      'COMPRESSION-TOLERANCE': '1.5',
      'COMPRESSION-ALGORITHM': 'DP',
      WIDTH: '400',
      HEIGHT: '200',
      SIZE: '6',
      INTERVAL: '2',
      SHAPE: 'square'
    })

    await run()

    expect(captured).toMatchObject({
      compressionTolerance: 1.5,
      compressionAlgorithm: 'DP',
      width: 400,
      height: 200,
      size: 6,
      interval: 2,
      shape: 'square'
    })
  })

  it('fails without calling the generator when the algorithm is unknown', async () => {
    setInputs({ 'COMPRESSION-ALGORITHM': 'quick' })

    await run()

    expect(captured).toBeNull()
    expect(process.exitCode).toBe(1)
  })

  it('forwards a custom font path', async () => {
    setInputs({ 'FONT-PATH': 'assets/Inter-Bold.ttf' })

    await run()

    expect(captured).toMatchObject({ font: 'assets/Inter-Bold.ttf' })
  })

  it('keeps the bundled font when font-path is empty', async () => {
    setInputs({ 'FONT-PATH': '' })

    await run()

    expect(captured).not.toHaveProperty('font')
  })

  it('fails without calling the generator when a numeric input is invalid', async () => {
    setInputs({ WIDTH: 'wide' })

    await run()

    expect(captured).toBeNull()
    expect(process.exitCode).toBe(1)
  })

  it('writes the generated svg to output-path', async () => {
    await run()

    const outputPath = join(workDir, 'out.svg')
    expect(readFileSync(outputPath, 'utf-8')).toBe('<svg />')
  })
})
