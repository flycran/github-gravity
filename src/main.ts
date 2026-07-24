import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import * as core from '@actions/core'
import { gensvg } from './gensvg.js'

/**
 * GitHub Action 入口：生成 GitHub 贡献图重力跌落动画 SVG。
 *
 * 输入参数：
 * - username: GitHub 用户名（必填）
 * - text: 显示的文字，默认为 username
 * - output-path: SVG 输出路径，默认为 gravity.svg
 * - font-size: 文字大小，默认为 80
 * - sample-rate: 轨迹采样率，默认为 4
 *
 * 输出：
 * - svg-path: 生成的 SVG 文件路径
 */
export async function run(): Promise<void> {
  try {
    const username: string = core.getInput('username', { required: true })
    const text: string = core.getInput('text') || username
    const outputPath: string = core.getInput('output-path') || 'gravity.svg'
    const fontSize: number = parseInt(core.getInput('font-size') || '80', 10)
    const sampleRate: number = parseInt(core.getInput('sample-rate') || '4', 10)
    const shape: string = core.getInput('shape') || 'circle'
    const textTop: number = parseInt(core.getInput('text-top') || '50', 10)
    const backgroundColor: string =
      core.getInput('background-color') || 'transparent'
    const textColor: string = core.getInput('text-color') || 'black'

    core.info(`Generating gravity SVG for user: ${username}`)
    core.info(
      `Text: "${text}", Font size: ${fontSize}, Sample rate: ${sampleRate}, Shape: ${shape}, Text top: ${textTop}, Background: ${backgroundColor}, Text color: ${textColor}`
    )

    const svg = await gensvg({
      username,
      text,
      fontSize,
      sampleRate,
      shape,
      textTop,
      backgroundColor,
      textColor
    })

    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, svg, 'utf-8')
    core.info(`SVG written to: ${outputPath}`)

    core.setOutput('svg-path', outputPath)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}
