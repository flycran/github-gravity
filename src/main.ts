import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import * as core from '@actions/core'
import { gensvg } from './utils/gensvg.js'

/** 读取可选数字输入，未填写时返回 undefined，由库使用默认值 */
function getOptionalNumber(name: string): number | undefined {
  const raw = core.getInput(name)
  if (!raw) return undefined
  const value = Number(raw)
  if (Number.isNaN(value)) {
    throw new Error(`Input "${name}" must be a number, got "${raw}"`)
  }
  return value
}

/** 读取压缩算法输入，未填写时返回 undefined；非法值直接报错 */
function getAlgorithm(name: string): 'Greedy' | 'DP' | 'RDP' | undefined {
  const raw = core.getInput(name)
  if (!raw) return undefined
  if (raw !== 'Greedy' && raw !== 'DP' && raw !== 'RDP') {
    throw new Error(`Input "${name}" must be Greedy, DP or RDP, got "${raw}"`)
  }
  return raw
}

/**
 * GitHub Action 入口：生成 GitHub 贡献图重力跌落动画 SVG。
 *
 * 输出：
 * - svg-path: 生成的 SVG 文件路径
 */
export async function run(): Promise<void> {
  try {
    const username: string = core.getInput('username', { required: true })
    const text: string = core.getInput('text') || username
    const outputPath: string = core.getInput('output-path') || 'gravity.svg'
    const fontSize: number = parseInt(core.getInput('font-size') || '48', 10)
    const shape = (core.getInput('shape') as 'square' | 'circle') || 'circle'
    const textTop: number = parseInt(core.getInput('text-top') || '50', 10)
    const backgroundColor: string =
      core.getInput('background-color') || 'transparent'
    const textColor: string = core.getInput('text-color') || 'black'
    const css = core.getInput('css') === 'true'
    const animation = core.getInput('animation') || undefined
    const compressionTolerance = getOptionalNumber('compression-tolerance')
    const compressionAlgorithm = getAlgorithm('compression-algorithm')
    const maxSimulationTime = getOptionalNumber('max-simulation-time')
    const scale = getOptionalNumber('scale')
    const speed = getOptionalNumber('speed')
    const width = getOptionalNumber('width')
    const height = getOptionalNumber('height')
    const size = getOptionalNumber('size')
    const interval = getOptionalNumber('interval')
    const friction = getOptionalNumber('friction')
    const restitution = getOptionalNumber('restitution')
    const fontPath = core.getInput('font-path')

    core.info(`Generating gravity SVG for user: ${username}`)
    core.info(
      `Text: "${text}", Font size: ${fontSize}, Shape: ${shape}, Text top: ${textTop}, Background: ${backgroundColor}, Text color: ${textColor}`
    )

    const svg = await gensvg({
      username,
      text,
      fontSize,
      shape,
      textTop,
      backgroundColor,
      textColor,
      css,
      animation,
      compressionTolerance,
      compressionAlgorithm,
      maxSimulationTime,
      scale,
      speed,
      width,
      height,
      size,
      interval,
      friction,
      restitution,
      font: fontPath || undefined
    })

    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, svg, 'utf-8')
    core.info(`SVG written to: ${outputPath}`)

    core.setOutput('svg-path', outputPath)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
