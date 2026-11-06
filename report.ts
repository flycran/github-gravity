/**
 * 自动视觉对比：playwright(chromium) 逐帧采样截图 + pixelmatch 像素比较。
 *
 * 时间确定性：页面只被动接受 seek（见 previewPage/compareClock 的约定），
 * 每帧流程为 seek → 双 rAF 屏障（等样式计算与合成）→ 读回时钟校验 → 截图，
 * 全程不播放，没有浏览器计时器流逝参与。
 * 独立起一个临时 serve 供 playwright 访问（页面经 http 加载数据 API）。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pixelmatch from 'pixelmatch'
import type { Browser, Page } from 'playwright'
import { PNG } from 'pngjs'
import {
  type CombinationVerdict,
  evaluateConsistency,
  type FrameMetric,
  type Thresholds
} from './consistency'
import type { ReportData } from './pages/reportView'
import type { ComboMeta } from './serve'
import { startServe } from './serve'

export interface ReportOptions {
  /** 产物根目录 */
  outRoot: string
  /** 本工具的根目录（页面文件所在，serve 需要） */
  toolRoot: string
  combo: string
  frames: number
  /** pixelmatch 的 YIQ 感知容差（0 严格 - 1 宽松） */
  pixelThreshold: number
  thresholds: Thresholds
}

const SEEK_TOLERANCE_MS = 1

export async function runReport(options: ReportOptions): Promise<ReportData> {
  const comboDir = join(options.outRoot, options.combo)
  const meta = (await Bun.file(join(comboDir, 'meta.json')).json()) as ComboMeta

  // 采样以较长一方为准覆盖全程；短的一方超出后动画停在自己的末帧
  const totalMs = Math.max(meta.durationA, meta.durationB)
  const times = Array.from({ length: options.frames }, (_, index) =>
    Math.round((index * totalMs) / Math.max(1, options.frames - 1))
  )

  const serve = startServe(options.toolRoot, {
    outRoot: options.outRoot,
    listCombos: () => [options.combo]
  })

  let browser: Browser | undefined
  try {
    const { chromium } = await import('playwright')
    browser = await chromium.launch()
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 }
    })
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[页面] ${message.text()}`)
    })
    await page.goto(
      `${serve.url}/previewPage.html?combo=${encodeURIComponent(options.combo)}`,
      {
        waitUntil: 'load',
        timeout: 120_000
      }
    )
    await page.waitForFunction('window.__compare !== undefined', undefined, {
      timeout: 120_000
    })
    // 角标（A/B 徽章）颜色不同会污染像素对比，报告截图前移除
    await page.evaluate(() => {
      for (const label of document.querySelectorAll('.pane-label')) {
        label.remove()
      }
    })

    const framesDir = join(comboDir, 'frames')
    mkdirSync(framesDir, { recursive: true })
    const paneA = page.locator('#pane-a')
    const paneB = page.locator('#pane-b')

    const metrics: FrameMetric[] = []
    for (const [index, timeMs] of times.entries()) {
      await seekAndVerify(page, timeMs)
      const [shotA, shotB] = await Promise.all([
        paneA.screenshot(),
        paneB.screenshot()
      ])
      const number = String(index).padStart(2, '0')
      writeFileSync(join(framesDir, `a-${number}.png`), shotA)
      writeFileSync(join(framesDir, `b-${number}.png`), shotB)

      const imgA = PNG.sync.read(shotA)
      const imgB = PNG.sync.read(shotB)
      if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
        throw new Error(
          `第 ${index} 帧截图尺寸不一致：${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`
        )
      }
      const diff = new PNG({ width: imgA.width, height: imgA.height })
      const diffPixels = pixelmatch(
        imgA.data,
        imgB.data,
        diff.data,
        imgA.width,
        imgA.height,
        { threshold: options.pixelThreshold }
      )
      writeFileSync(join(framesDir, `diff-${number}.png`), PNG.sync.write(diff))

      metrics.push({
        timeMs,
        diffPixels,
        totalPixels: imgA.width * imgA.height,
        diffRatio: diffPixels / (imgA.width * imgA.height),
        maxDelta: maxChannelDelta(imgA.data, imgB.data)
      })
      console.log(
        `[report] ${index + 1}/${times.length} @ ${(timeMs / 1000).toFixed(2)}s diff=${(metrics[metrics.length - 1].diffRatio * 100).toFixed(3)}%`
      )
    }

    const verdict: CombinationVerdict = evaluateConsistency(
      meta.durationA,
      meta.durationB,
      metrics,
      options.thresholds
    )
    const report: ReportData = {
      combo: options.combo,
      refA: `${meta.refA} (${meta.commitA.slice(0, 7)})`,
      refB: `${meta.refB} (${meta.commitB.slice(0, 7)})`,
      inputName: meta.inputName,
      via: meta.via,
      thresholds: options.thresholds,
      times,
      frames: metrics,
      verdict,
      assetsBase: `/frames/${options.combo}/`,
      createdAt: new Date().toISOString()
    }
    writeFileSync(
      join(comboDir, 'report.json'),
      JSON.stringify(report, null, 2),
      'utf-8'
    )
    return report
  } catch (error) {
    throw wrapPlaywrightError(error)
  } finally {
    await browser?.close()
    serve.stop()
  }
}

async function seekAndVerify(page: Page, timeMs: number): Promise<void> {
  // seek ≠ 渲染完成：双 rAF 等待样式计算与合成，再读回时钟校验定位精度。
  // evaluate 的回调会被序列化到浏览器执行，必须写纯 JS（不能用 TS 语法）
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate('(ms) => window.__compare.seek(ms)', timeMs)
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
    )
    const now = (await page.evaluate(
      '() => window.__compare ? window.__compare.now() : Number.NaN'
    )) as number
    if (Math.abs(now - timeMs) <= SEEK_TOLERANCE_MS) return
  }
  console.warn(`[report] seek 校验未达标：目标 ${timeMs}ms`)
}

function maxChannelDelta(a: Buffer, b: Buffer): number {
  let max = 0
  // RGBA 步进，比较 RGB 三通道；截图白底均为不透明，alpha 不参与
  for (let index = 0; index < a.length; index += 4) {
    const delta = Math.max(
      Math.abs(a[index] - b[index]),
      Math.abs(a[index + 1] - b[index + 1]),
      Math.abs(a[index + 2] - b[index + 2])
    )
    if (delta > max) max = delta
  }
  return max
}

function wrapPlaywrightError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (
    message.includes("Cannot find module 'playwright'") ||
    message.includes('Executable doesn’t exist') ||
    message.includes('Executable does not exist')
  ) {
    return new Error(
      `${message}\n自动报告依赖 playwright：先在本工具目录执行 bun install，再执行 bunx playwright install chromium`
    )
  }
  return error instanceof Error ? error : new Error(message)
}
