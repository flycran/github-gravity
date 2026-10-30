/**
 * Unit test: GitHub Action input plumbing in main.ts.
 * Physics, network and SVG generation are mocked out; only input wiring is asserted.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn
} from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../src/main'
import * as gensvgModule from '../src/utils/gensvg'
import { GensvgOptions } from '../src/utils/gensvg'

let captured: GensvgOptions | null

/** main.ts 读取的全部输入（@actions/core 按 INPUT_<NAME> 大写读取，短横线原样保留） */
const INPUT_NAMES = [
  'USERNAME',
  'TEXT',
  'OUTPUT-PATH',
  'FONT-SIZE',
  'COMPRESSION-TOLERANCE',
  'COMPRESSION-ALGORITHM',
  'SHAPE',
  'TEXT-TOP',
  'BACKGROUND-COLOR',
  'TEXT-COLOR',
  'WIDTH',
  'HEIGHT',
  'SIZE',
  'INTERVAL',
  'FONT-PATH',
  'MAX-SIMULATION-TIME',
  'SCALE',
  'SPEED'
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
  spyOn(gensvgModule, 'gensvg').mockImplementation(async (options) => {
    captured = options
    return '<svg />'
  })
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
  mock.restore()
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
    // 未填写的可选输入以 undefined 下传
    expect(captured?.compressionTolerance).toBeUndefined()
    expect(captured?.compressionAlgorithm).toBeUndefined()
    expect(captured?.maxSimulationTime).toBeUndefined()
    expect(captured?.scale).toBeUndefined()
    expect(captured?.speed).toBeUndefined()
    expect(captured?.width).toBeUndefined()
    expect(captured?.height).toBeUndefined()
    expect(captured?.size).toBeUndefined()
    expect(captured?.interval).toBeUndefined()
    expect(captured?.font).toBeUndefined()
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

  it('forwards max-simulation-time as a number', async () => {
    setInputs({ 'MAX-SIMULATION-TIME': '5000' })

    await run()

    expect(captured).toMatchObject({ maxSimulationTime: 5000 })
  })

  it('leaves max-simulation-time undefined when the input is empty', async () => {
    setInputs({ 'MAX-SIMULATION-TIME': '' })

    await run()

    expect(captured?.maxSimulationTime).toBeUndefined()
  })

  it('forwards scale and speed as numbers', async () => {
    setInputs({ SCALE: '2', SPEED: '4' })

    await run()

    expect(captured).toMatchObject({ scale: 2, speed: 4 })
  })

  it('forwards a custom font path', async () => {
    setInputs({ 'FONT-PATH': 'assets/Inter-Bold.ttf' })

    await run()

    expect(captured).toMatchObject({ font: 'assets/Inter-Bold.ttf' })
  })

  it('keeps the bundled font when font-path is empty', async () => {
    setInputs({ 'FONT-PATH': '' })

    await run()

    expect(captured?.font).toBeUndefined()
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
