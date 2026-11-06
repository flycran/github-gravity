/**
 * 生成驱动模板：由工具写入被测 ref 的导出目录后以 `bun run` 执行。
 *
 * 两种模式注入同一份固定输入，保证对比前提；驱动 import 的都是该 ref
 * 自己的代码，字段级失败直接透出 ref 的原始错误，工具不做兼容处理。
 * 模板用普通 JS 语法（无 TS 类型标注），以实际 argv[2] 接产物路径。
 */

export type ViaMode = 'src' | 'dist'

/** 生成驱动的文件名（写入导出目录根） */
export const DRIVER_FILE = '__svg_compare_driver.ts'
/** 注入输入的文件名（与驱动同目录） */
export const INPUT_FILE = '__svg_compare_input.json'

/** src 模式：import 该 ref 的源码 gensvg，输入直通（含 calendarList 注入） */
export function renderDriverSrc(): string {
  return `// SVG 视觉对比工具注入的生成驱动（src 模式）：以该 ref 的源码直接生成
import { readFileSync, writeFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(${JSON.stringify(INPUT_FILE)}, 'utf-8'))

// 参数注入的兼容边界：老版本 gensvg 没有 calendarList 参数时会忽略它并
// 回退到网络取数——外部数据源随时间变化，两 ref 可能拿到不同输入，对比不成立。
// 这里把任何网络访问变成显式失败，指引改用注入点更稳定的 dist 模式
globalThis.fetch = () => {
  throw new Error(
    '该 ref 的 gensvg 未接受 calendarList 注入而回退到网络取数：' +
      'src 模式要求 gensvg 支持 calendarList 参数，对比该版本请改用 --via dist'
  )
}

const { gensvg } = await import('./src/utils/gensvg.js')
const svg = await gensvg(input)
writeFileSync(process.argv[2], svg, 'utf-8')
`
}

/**
 * dist 模式：走该 ref 的 dist 生产路径 run()。
 * 选项经 @actions/core 的 getInput 进入（读 INPUT_* 环境变量）；
 * 贡献数据请求被拦截为固定 calendarList——外部数据源会随时间变化，
 * 不拦截的话两个 ref 拿到的输入可能不同，对比不成立。
 */
export function renderDriverDist(): string {
  return `// SVG 视觉对比工具注入的生成驱动（dist 模式）：走该 ref 的生产 bundle
import { existsSync, readFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(${JSON.stringify(INPUT_FILE)}, 'utf-8'))
const outPath = process.argv[2]

const kebab = (key) => key.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase())
for (const [key, value] of Object.entries(input)) {
  if (key === 'calendarList' || value === undefined || value === null) continue
  process.env['INPUT_' + kebab(key).toUpperCase()] = String(value)
}
process.env['INPUT_OUTPUT-PATH'] = outPath

const realFetch = globalThis.fetch
if (input.calendarList !== undefined) {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('gh-calendar.rschristian.dev/user/')) {
      return new Response(JSON.stringify(input.calendarList), {
        headers: { 'content-type': 'application/json' }
      })
    }
    return realFetch(url, init)
  }
}

await import('./dist/index.js')

// run() 是 dist 顶层的 fire-and-forget async 调用：await import 只等到它启动，
// 不等它完成。轮询产物与退出码，直到 SVG 写盘或 run() 走 setFailed 失败
const deadline = Date.now() + 120_000
while (!existsSync(outPath)) {
  if (Date.now() > deadline) {
    throw new Error(
      'dist run() 超时未产出 SVG（模拟时间过长？stderr 有原始输出）'
    )
  }
  if (process.exitCode !== undefined) {
    throw new Error(
      'dist run() 失败：检查输入是否含 username、字段是否被该版本支持（stderr 有原始错误）'
    )
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
}
`
}
