/** input：直通加载语义与 dist 模式的 INPUT_* 环境变量映射 */

import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadInputs, toActionInputEnv } from '../input'

describe('loadInputs', () => {
  it('单文件 → 单组合，选项原样透传不加工', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-compare-input-'))
    const file = join(dir, 'alpha.json')
    writeFileSync(
      file,
      JSON.stringify({ username: 'u', customField: { nested: 1 } })
    )

    const inputs = await loadInputs(file)
    expect(inputs).toHaveLength(1)
    expect(inputs[0].name).toBe('alpha')
    // 直通：工具不认识、也不该动调用方的任何字段
    expect(inputs[0].options).toEqual({
      username: 'u',
      customField: { nested: 1 }
    })
  })

  it('目录 → 全部输入文件按文件名排序为多组合', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-compare-input-'))
    writeFileSync(join(dir, 'b-second.json'), '{"username":"u"}')
    writeFileSync(join(dir, 'a-first.json'), '{"username":"u"}')
    writeFileSync(join(dir, 'ignore.txt'), 'not-json')

    const inputs = await loadInputs(dir)
    expect(inputs.map((input) => input.name)).toEqual(['a-first', 'b-second'])
  })

  it('TS 输入走动态导入，_ 前缀的共享模块不作为组合', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-compare-input-'))
    writeFileSync(
      join(dir, '_shared.ts'),
      `export const calendar = { total: 1 }\n`
    )
    writeFileSync(
      join(dir, 'combo.ts'),
      `import { calendar } from './_shared.ts'\nexport default { username: 'u', calendarList: calendar }\n`
    )

    const inputs = await loadInputs(dir)
    expect(inputs.map((input) => input.name)).toEqual(['combo'])
    // TS 模块里的共享引用在加载结果中保持直通对象语义
    expect(inputs[0].options).toEqual({
      username: 'u',
      calendarList: { total: 1 }
    })
  })

  it('TS 输入缺少 default export 时报错', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-compare-input-'))
    const file = join(dir, 'no-default.ts')
    writeFileSync(file, 'export const notDefault = {}\n')
    const error = await rejectionOf(loadInputs(file))
    expect(error.message).toMatch(/default export/)
  })

  it('目录中没有输入文件时报错', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'svg-compare-input-'))
    const error = await rejectionOf(loadInputs(dir))
    expect(error.message).toMatch(/没有/)
  })
})

/** 捕获 Promise 的 rejection 返回 Error（bun:test 的 expect 不支持异步 toThrow） */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  throw new Error('预期应被拒绝的 Promise 正常完成')
}

describe('toActionInputEnv', () => {
  it('camelCase 键映射为 INPUT_ + kebab 大写', () => {
    const env = toActionInputEnv({
      username: 'u',
      fontSize: 32,
      textTop: 40,
      css: true,
      restitution: 0.3
    })
    expect(env).toEqual({
      INPUT_USERNAME: 'u',
      'INPUT_FONT-SIZE': '32',
      'INPUT_TEXT-TOP': '40',
      INPUT_CSS: 'true',
      INPUT_RESTITUTION: '0.3'
    })
  })

  it('calendarList 无 Action 通道，走 driver 的 fetch 拦截，不进环境变量', () => {
    const env = toActionInputEnv({ username: 'u', calendarList: { total: 0 } })
    expect(env).toEqual({ INPUT_USERNAME: 'u' })
  })

  it('undefined/null 字段跳过', () => {
    const env = toActionInputEnv({ username: 'u', text: undefined, css: null })
    expect(env).toEqual({ INPUT_USERNAME: 'u' })
  })
})
