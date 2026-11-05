import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import * as core from '@actions/core'
import { z } from 'zod'
import { gensvg } from './utils/gensvg.js'

/**
 * 可选数字输入：空白视为未填写（undefined，由库使用默认值），
 * 其余必须整体解析为有限数字（拒绝 NaN / Infinity / 带杂质的字符串）。
 */
const optionalNumber = z
  .string()
  .transform((raw) => raw.trim())
  .transform((raw) => (raw === '' ? undefined : Number(raw)))
  .refine((value) => value === undefined || Number.isFinite(value), {
    message: 'must be a finite number'
  })

/** 可选正数：物理尺寸、缩放与倍速等必须大于 0 的输入 */
const positiveNumber = optionalNumber.refine(
  (value) => value === undefined || value > 0,
  { message: 'must be greater than 0' }
)

/** 可选非负数：摩擦、弹性、压缩容差等允许 0 的输入 */
const nonNegativeNumber = optionalNumber.refine(
  (value) => value === undefined || value >= 0,
  { message: 'must be zero or greater' }
)

/** 开关输入：只接受 true/false，空白视为 false */
const booleanInput = z
  .string()
  .transform((raw) => raw.trim() || 'false')
  .pipe(z.enum(['true', 'false']))
  .transform((raw) => raw === 'true')

/** 可选枚举输入的公共链路：空白视为未填写，其余整体参与枚举校验 */
const optionalEnumString = z
  .string()
  .transform((raw) => (raw.trim() === '' ? undefined : raw.trim()))

/** action.yml 全部输入的严格校验 schema，key 与输入名保持一致 */
const inputSchema = z.object({
  username: z.string().trim().min(1, { message: 'is required' }),
  text: z.string(),
  'output-path': z.string(),
  'font-size': positiveNumber,
  'compression-tolerance': nonNegativeNumber,
  'compression-algorithm': optionalEnumString.pipe(
    z.enum(['Greedy', 'DP', 'RDP']).optional()
  ),
  'max-simulation-time': nonNegativeNumber,
  shape: optionalEnumString.pipe(z.enum(['circle', 'square']).optional()),
  'text-top': nonNegativeNumber,
  'background-color': z.string(),
  'text-color': z.string(),
  scale: positiveNumber,
  speed: positiveNumber,
  css: booleanInput,
  animation: z.string(),
  width: positiveNumber,
  height: positiveNumber,
  size: positiveNumber,
  interval: nonNegativeNumber,
  friction: nonNegativeNumber,
  restitution: nonNegativeNumber,
  'font-path': z.string()
})

/** 把 zod 校验失败整理成逐行可读的错误信息 */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `- "${issue.path.join('.')}" ${issue.message}`)
    .join('\n')
}

/**
 * GitHub Action 入口：生成 GitHub 贡献图重力跌落动画 SVG。
 *
 * 输出：
 * - svg-path: 生成的 SVG 文件路径
 */
export async function run(): Promise<void> {
  try {
    const parsed = inputSchema.safeParse({
      username: core.getInput('username'),
      text: core.getInput('text'),
      'output-path': core.getInput('output-path'),
      'font-size': core.getInput('font-size'),
      'compression-tolerance': core.getInput('compression-tolerance'),
      'compression-algorithm': core.getInput('compression-algorithm'),
      'max-simulation-time': core.getInput('max-simulation-time'),
      shape: core.getInput('shape'),
      'text-top': core.getInput('text-top'),
      'background-color': core.getInput('background-color'),
      'text-color': core.getInput('text-color'),
      scale: core.getInput('scale'),
      speed: core.getInput('speed'),
      css: core.getInput('css'),
      animation: core.getInput('animation'),
      width: core.getInput('width'),
      height: core.getInput('height'),
      size: core.getInput('size'),
      interval: core.getInput('interval'),
      friction: core.getInput('friction'),
      restitution: core.getInput('restitution'),
      'font-path': core.getInput('font-path')
    })

    if (!parsed.success) {
      core.setFailed(`Invalid action input(s):\n${formatIssues(parsed.error)}`)
      return
    }

    const input = parsed.data
    const username = input.username
    const text = input.text || username
    const outputPath = input['output-path'] || 'gravity.svg'
    const backgroundColor = input['background-color'] || 'transparent'
    const textColor = input['text-color'] || 'black'
    const animation = input.animation || undefined
    const fontPath = input['font-path']

    core.info(`Generating gravity SVG for user: ${username}`)
    core.info(
      `Text: "${text}", Font size: ${input['font-size'] ?? 48}, Shape: ${input.shape ?? 'circle'}, Text top: ${input['text-top'] ?? 50}, Background: ${backgroundColor}, Text color: ${textColor}`
    )

    const svg = await gensvg({
      username,
      text,
      fontSize: input['font-size'] ?? 48,
      shape: input.shape ?? 'circle',
      textTop: input['text-top'] ?? 50,
      backgroundColor,
      textColor,
      css: input.css,
      animation,
      compressionTolerance: input['compression-tolerance'],
      compressionAlgorithm: input['compression-algorithm'],
      maxSimulationTime: input['max-simulation-time'],
      scale: input.scale,
      speed: input.speed,
      width: input.width,
      height: input.height,
      size: input.size,
      interval: input.interval,
      friction: input.friction,
      restitution: input.restitution,
      font: fontPath || undefined
    })

    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, svg, 'utf-8')
    core.info(`SVG written to: ${outputPath}`)

    core.setOutput('svg-path', outputPath)
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
    if (error instanceof Error) core.debug(error.stack ?? '')
  }
}
