/**
 * 对比输入加载：JSON 直通语义。
 *
 * 输入内容原样透传给被测 ref 的 gensvg，不做字段白名单、跨版本兼容映射
 * 与默认值合并——不同 ref 的选项字段差异由调用方自行判断，
 * 字段不被某 ref 支持时透传该 ref 的原始报错。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

export interface CompareInput {
  /** 组合名（文件名去扩展名），用于产物子目录与报告展示 */
  name: string
  /** 直通给 gensvg 的完整选项（含 calendarList） */
  options: Record<string, unknown>
}

/**
 * 加载对比输入组合：文件为单组合，目录则扫描其中全部 .json
 * （按文件名排序）为多组合。
 */
export function loadInputs(inputPath: string): CompareInput[] {
  const absolute = resolve(inputPath)
  if (!statSync(absolute).isDirectory()) {
    return [{ name: comboName(absolute), options: readInputFile(absolute) }]
  }
  const files = readdirSync(absolute)
    .filter((file) => extname(file) === '.json')
    .sort()
  if (files.length === 0) {
    throw new Error(`输入目录中没有 .json 文件：${absolute}`)
  }
  return files.map((file) => ({
    name: comboName(file),
    options: readInputFile(join(absolute, file))
  }))
}

function comboName(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? 'combo'
  return base.replace(/\.json$/i, '')
}

function readInputFile(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

/**
 * 生成选项 → @actions/core 的 getInput 环境变量（dist 模式专用）。
 * getInput 读 process.env['INPUT_KEBAB-CASE']，因此 camelCase 键映射为
 * INPUT_ 前缀 + kebab-case 大写（fontSize → INPUT_FONT-SIZE）；
 * calendarList 没有 Action input 通道，由 driver 的 fetch 拦截注入，此处排除。
 */
export function toActionInputEnv(
  options: Record<string, unknown>
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(options)) {
    if (key === 'calendarList' || value === undefined || value === null) {
      continue
    }
    const kebab = key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
    env[`INPUT_${kebab.toUpperCase()}`] =
      typeof value === 'boolean' ? String(value) : String(value)
  }
  return env
}
