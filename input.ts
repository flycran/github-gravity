/**
 * 对比输入加载：JSON 直通语义。
 *
 * 输入内容原样透传给被测 ref 的 gensvg，不做字段白名单、跨版本兼容映射
 * 与默认值合并——不同 ref 的选项字段差异由调用方自行判断，
 * 字段不被某 ref 支持时透传该 ref 的原始报错。
 *
 * 支持 .json 与 .ts/.js（bun 原生导入）两种格式；TS 输入必须 default export
 * 一个对象。目录模式下以 `_` 开头的 .ts 文件视为共享模块（如多个 fixture
 * 复用的 calendarList），不作为组合，避免同一份数据在多个文件里重复定义。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'

export interface CompareInput {
  /** 组合名（文件名去扩展名），用于产物子目录与报告展示 */
  name: string
  /** 直通给 gensvg 的完整选项（含 calendarList） */
  options: Record<string, unknown>
}

const INPUT_EXTENSIONS = ['.json', '.ts', '.js', '.mjs']

/**
 * 加载对比输入组合：文件为单组合，目录则扫描其中全部输入文件
 * （按文件名排序）为多组合。共享数据（如 calendarList）放在目录外层，
 * 组合文件放子目录 import '../xxx.ts' 引用，天然不会进入扫描范围。
 */
export async function loadInputs(inputPath: string): Promise<CompareInput[]> {
  const absolute = resolve(inputPath)
  if (!statSync(absolute).isDirectory()) {
    return [{ name: comboName(absolute), options: await readInput(absolute) }]
  }
  const files = readdirSync(absolute)
    .filter((file) => INPUT_EXTENSIONS.includes(extname(file)))
    .sort()
  if (files.length === 0) {
    throw new Error(
      `输入目录中没有 ${INPUT_EXTENSIONS.join('/')} 文件：${absolute}`
    )
  }
  return Promise.all(
    files.map(async (file) => ({
      name: comboName(file),
      options: await readInput(join(absolute, file))
    }))
  )
}

function comboName(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? 'combo'
  return base.replace(/\.(json|ts|js|mjs)$/i, '')
}

/** JSON 走文本解析；TS/JS 走 bun 的动态导入（模块可共享引用，如 calendarList） */
async function readInput(filePath: string): Promise<Record<string, unknown>> {
  if (extname(filePath) === '.json') {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  }
  const module = (await import(resolve(filePath))) as {
    default?: Record<string, unknown>
  }
  if (!module.default || typeof module.default !== 'object') {
    throw new Error(`TS/JS 输入必须 default export 一个对象：${filePath}`)
  }
  return module.default
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
