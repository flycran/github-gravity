/** svgMeta：双引擎产物元数据解析（时长单位、引擎判定、viewBox） */

import { describe, expect, it } from 'bun:test'
import { parseSvgMeta } from '../svgMeta'

/** gensvg SMIL 产物的最小形态（dur 恒为毫秒带 ms 后缀） */
const SMIL_SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 450">
  <g id="b"><rect><animateTransform attributeName="transform" type="translate" dur="4800ms"/></rect></g>
</svg>`

/** gensvg CSS 产物的最小形态（:root{--dur} + @keyframes，无 animateTransform） */
const CSS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 450">
  <style>:root{--dur:3600ms}@keyframes x0{}</style>
  <g id="b"><rect/></g>
</svg>`

describe('parseSvgMeta', () => {
  it('SMIL 引擎：从 animateTransform 的 dur 解析毫秒时长', () => {
    const meta = parseSvgMeta(SMIL_SVG)
    expect(meta.engine).toBe('smil')
    expect(meta.durationMs).toBe(4800)
    expect(meta.viewBox).toBe('0 0 900 450')
  })

  it('CSS 引擎：从 --dur 变量解析毫秒时长', () => {
    const meta = parseSvgMeta(CSS_SVG)
    expect(meta.engine).toBe('css')
    expect(meta.durationMs).toBe(3600)
    expect(meta.viewBox).toBe('0 0 900 450')
  })

  it('兼容秒为单位的 dur', () => {
    const svg = SMIL_SVG.replace('dur="4800ms"', 'dur="4.8s"')
    expect(parseSvgMeta(svg).durationMs).toBe(4800)
  })

  it('viewBox 缺失时返回 null，不视为错误', () => {
    const svg = SMIL_SVG.replace(' viewBox="0 0 900 450"', '')
    expect(parseSvgMeta(svg).viewBox).toBeNull()
  })

  it('没有 dur 声明的产物直接报错（不是 gensvg 动画）', () => {
    expect(() => parseSvgMeta('<svg><rect/></svg>')).toThrow(/动画时长/)
  })
})
