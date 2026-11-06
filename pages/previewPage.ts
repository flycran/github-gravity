/**
 * 预览页逻辑：双 SVG 同步播放、进度定位、叠加/difference 对比与页内报告。
 *
 * 播放用页面主时钟 rAF 驱动双 seek，两份 SVG 的原生时钟全程冻结
 * （见 compareClock.ts），进度条拖动与帧步进都是显式 seek；
 * 自动报告（report.ts）通过 window.__compare 驱动同一套 seek 通道。
 */

import { type AnimationClock, buildClock } from './compareClock.ts'
import { type ReportData, renderReport } from './reportView.ts'

interface CompareData {
  combo: string
  inputName: string
  refA: string
  refB: string
  svgA: string
  svgB: string
  durationA: number
  durationB: number
}

interface CompareWindow {
  ready: Promise<void>
  seek(ms: number): void
  now(): number
  duration: number
}

declare global {
  interface Window {
    __compare?: CompareWindow
  }
}

const paneA = document.getElementById('pane-a') as HTMLDivElement
const paneB = document.getElementById('pane-b') as HTMLDivElement
const playBtn = document.getElementById('play') as HTMLButtonElement
const stepBackBtn = document.getElementById('step-back') as HTMLButtonElement
const stepForwardBtn = document.getElementById(
  'step-forward'
) as HTMLButtonElement
const progress = document.getElementById('progress') as HTMLInputElement
const timeLabel = document.getElementById('time-label') as HTMLSpanElement
const viewGroup = document.getElementById('view') as HTMLFieldSetElement
const opacityInput = document.getElementById('opacity') as HTMLInputElement
const opacityLabel = document.getElementById('opacity-label') as HTMLSpanElement
const refBadgeA = document.getElementById('ref-a') as HTMLElement
const refBadgeB = document.getElementById('ref-b') as HTMLElement
const comboLabel = document.getElementById('combo-label') as HTMLElement
const reportBtn = document.getElementById('report-btn') as HTMLButtonElement
const reportPanel = document.getElementById('report-panel') as HTMLDivElement

/** 播放时长取较长一方；短的一方超出后动画停在末帧 */
let duration = 0
let clockA: AnimationClock | null = null
let clockB: AnimationClock | null = null
let playing = false
let playFrom = 0
let playStartedAt = 0

const params = new URLSearchParams(location.search)
const combo = params.get('combo') ?? ''

ready().then(() => {
  playBtn.disabled = false
  progress.disabled = false
})

async function ready(): Promise<void> {
  const query = combo === '' ? '' : `?combo=${encodeURIComponent(combo)}`
  const response = await fetch(`/api/compare-data${query}`)
  if (!response.ok) {
    fail(new Error(`加载数据失败：${response.status} ${await response.text()}`))
    return
  }
  const data = (await response.json()) as CompareData
  bind(data)
}

function fail(error: unknown): void {
  console.error('[svg-compare]', error)
  comboLabel.textContent = `加载失败：${error instanceof Error ? error.message : String(error)}`
  reportBtn.disabled = true
}

function bind(data: CompareData): void {
  paneA.insertAdjacentHTML('beforeend', data.svgA)
  paneB.insertAdjacentHTML('beforeend', data.svgB)
  const svgA = paneA.querySelector('svg') as SVGSVGElement
  const svgB = paneB.querySelector('svg') as SVGSVGElement
  clockA = buildClock(svgA)
  clockB = buildClock(svgB)
  duration = Math.max(clockA.totalDuration(), clockB.totalDuration(), 1)

  refBadgeA.textContent = `A = ${data.refA}`
  refBadgeB.textContent = `B = ${data.refB}`
  comboLabel.textContent = data.inputName
  progress.max = String(duration)

  // 主时钟：播放/步进/拖动与自动报告共用这一个 seek 通道
  const compare: CompareWindow = {
    ready: Promise.resolve(),
    duration,
    seek: (ms) => seekAll(ms),
    now: () => clockA?.now() ?? 0
  }
  window.__compare = compare

  seekAll(0)
  playBtn.addEventListener('click', togglePlay)
  stepBackBtn.addEventListener('click', () => stepBy(-1))
  stepForwardBtn.addEventListener('click', () => stepBy(1))
  progress.addEventListener('input', () => {
    pause()
    seekAll(Number(progress.value))
  })
  // radio 的 change 事件冒泡到 fieldset，一组监听即可
  viewGroup.addEventListener('change', () => {
    const checked = viewGroup.querySelector(
      'input[name="view"]:checked'
    ) as HTMLInputElement
    document.body.dataset.view = checked.value
    applyViewOpacity()
  })
  opacityInput.addEventListener('input', applyViewOpacity)
  document.addEventListener('keydown', (event) => {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    )
      return
    if (event.code === 'Space') {
      event.preventDefault()
      togglePlay()
    } else if (event.code === 'ArrowLeft') stepBy(-1)
    else if (event.code === 'ArrowRight') stepBy(1)
  })
  reportBtn.addEventListener('click', generateReport)
}

function seekAll(ms: number): void {
  const clamped = Math.min(Math.max(0, ms), duration)
  clockA?.seek(clamped)
  clockB?.seek(clamped)
  progress.value = String(clamped)
  timeLabel.textContent = `${(clamped / 1000).toFixed(2)}s / ${(duration / 1000).toFixed(2)}s`
}

/** B 的不透明度只在叠加 / difference 视图有意义；并排必须清除内联值，
 * 否则上次滑动的半透明会残留到并排视图 */
function applyViewOpacity(): void {
  const view = document.body.dataset.view
  paneB.style.opacity = view === 'side' ? '' : opacityInput.value
  opacityLabel.textContent = Number(opacityInput.value).toFixed(2)
}

function stepBy(frames: number): void {
  pause()
  seekAll((clockA?.now() ?? 0) + frames * (1000 / 30))
}

function togglePlay(): void {
  if (playing) {
    pause()
    return
  }
  // 播放到末尾后再次播放回到起点
  const from = (clockA?.now() ?? 0) >= duration ? 0 : (clockA?.now() ?? 0)
  playing = true
  playFrom = from
  playStartedAt = performance.now()
  playBtn.textContent = '暂停'
  requestAnimationFrame(tick)
}

function pause(): void {
  playing = false
  playBtn.textContent = '播放'
}

function tick(): void {
  if (!playing) return
  const ms = playFrom + (performance.now() - playStartedAt)
  if (ms >= duration) {
    seekAll(duration)
    pause()
    return
  }
  seekAll(ms)
  requestAnimationFrame(tick)
}

let reportInFlight = false

async function generateReport(): Promise<void> {
  if (reportInFlight) return
  reportInFlight = true
  reportBtn.disabled = true
  reportBtn.textContent = '报告中…'
  try {
    const query = combo === '' ? '' : `?combo=${encodeURIComponent(combo)}`
    const response = await fetch(`/api/report${query}`, { method: 'POST' })
    if (!response.ok)
      throw new Error(`${response.status} ${await response.text()}`)
    const data = (await response.json()) as ReportData
    renderReport(reportPanel, data)
    reportPanel.scrollIntoView({ behavior: 'smooth' })
  } catch (error) {
    console.error('[svg-compare] 报告生成失败：', error)
    alert(
      `报告生成失败：${error instanceof Error ? error.message : String(error)}`
    )
  } finally {
    reportInFlight = false
    reportBtn.disabled = false
    reportBtn.textContent = '生成一致性报告'
  }
}
