/**
 * 报告渲染模块：预览页内嵌渲染与独立报告页共用。
 *
 * 只做纯 DOM 组装（无框架）：三维度判定卡片、逐帧差异曲线、
 * 帧明细表格与 A/B/diff 三图查看。
 */

import type {
  CombinationVerdict,
  FrameMetric,
  Thresholds
} from '../consistency'

export interface ReportData {
  combo: string
  refA: string
  refB: string
  inputName: string
  via: string
  thresholds: Thresholds
  /** 采样时刻表（ms），与 frames 一一对应 */
  times: number[]
  frames: FrameMetric[]
  verdict: CombinationVerdict
  /** 帧图片 URL 前缀（如 /frames/<combo>/，img 引用 a-NN/b-NN/diff-NN.png） */
  assetsBase: string
  createdAt: string
}

const PERCENT = (value: number) => `${(value * 100).toFixed(2)}%`

export function renderReport(container: HTMLElement, data: ReportData): void {
  container.innerHTML = ''
  container.append(
    verdictSection(data),
    curveSection(data),
    framesSection(data)
  )
}

function verdictSection(data: ReportData): HTMLElement {
  const section = document.createElement('section')
  section.className = 'verdict'
  const title = document.createElement('h2')
  title.textContent = data.verdict.pass
    ? `✔ 一致性通过：${data.refA} vs ${data.refB}（${data.inputName}）`
    : `✘ 一致性未通过：${data.refA} vs ${data.refB}（${data.inputName}）`
  section.append(title)
  const grid = document.createElement('div')
  grid.className = 'dim-grid'
  for (const dimension of data.verdict.dimensions) {
    const card = document.createElement('div')
    card.className = `dim-card ${dimension.pass ? 'pass' : 'fail'}`
    const name = document.createElement('span')
    name.className = 'dim-name'
    name.textContent =
      dimension.name === 'duration'
        ? '总时长偏差'
        : dimension.name === 'avg'
          ? '平均差异'
          : '最大差异'
    const value = document.createElement('strong')
    value.textContent = PERCENT(dimension.value)
    const threshold = document.createElement('small')
    threshold.textContent = `阈值 ≤ ${PERCENT(dimension.threshold)}`
    card.append(name, value, threshold)
    grid.append(card)
  }
  const peak = document.createElement('p')
  peak.className = 'peak'
  peak.textContent = `峰值差异帧 @ ${(data.verdict.peakTimeMs / 1000).toFixed(2)}s`
  section.append(grid, peak)
  return section
}

function curveSection(data: ReportData): HTMLElement {
  const section = document.createElement('section')
  const title = document.createElement('h3')
  title.textContent = '逐帧差异曲线'
  const canvas = document.createElement('canvas')
  section.append(title, canvas)
  requestAnimationFrame(() => drawCurve(canvas, data))
  return section
}

function drawCurve(canvas: HTMLCanvasElement, data: ReportData): void {
  const width = canvas.clientWidth || 600
  const height = 160
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context || data.frames.length === 0) return
  const maxRatio = Math.max(
    data.thresholds.maxMaxDiff,
    ...data.frames.map((frame) => frame.diffRatio)
  )
  const pad = 24
  const x = (index: number) =>
    pad + (index / Math.max(1, data.frames.length - 1)) * (width - pad * 2)
  const y = (ratio: number) =>
    height - pad - (ratio / maxRatio) * (height - pad * 2)

  context.strokeStyle = '#ddd'
  context.beginPath()
  context.moveTo(pad, y(data.thresholds.maxMaxDiff))
  context.lineTo(width - pad, y(data.thresholds.maxMaxDiff))
  context.stroke()
  context.fillStyle = '#999'
  context.fillText(
    `阈值 ${PERCENT(data.thresholds.maxMaxDiff)}`,
    pad,
    y(data.thresholds.maxMaxDiff) - 4
  )

  context.strokeStyle = '#d9480f'
  context.lineWidth = 2
  context.beginPath()
  data.frames.forEach((frame, index) => {
    if (index === 0) context.moveTo(x(index), y(frame.diffRatio))
    else context.lineTo(x(index), y(frame.diffRatio))
  })
  context.stroke()

  context.fillStyle = '#d9480f'
  data.frames.forEach((frame, index) => {
    context.beginPath()
    context.arc(x(index), y(frame.diffRatio), 3, 0, Math.PI * 2)
    context.fill()
  })
}

function framesSection(data: ReportData): HTMLElement {
  const section = document.createElement('section')
  const title = document.createElement('h3')
  title.textContent = '帧明细'
  const table = document.createElement('table')
  table.innerHTML =
    '<thead><tr><th>#</th><th>时刻</th><th>差异率</th><th>最大通道差</th><th>差异像素</th></tr></thead>'
  const tbody = document.createElement('tbody')
  const viewer = document.createElement('div')
  viewer.className = 'frame-viewer'

  data.frames.forEach((frame, index) => {
    const row = document.createElement('tr')
    row.innerHTML =
      `<td>${index}</td>` +
      `<td>${(frame.timeMs / 1000).toFixed(2)}s</td>` +
      `<td>${PERCENT(frame.diffRatio)}</td>` +
      `<td>${frame.maxDelta.toFixed(0)}</td>` +
      `<td>${frame.diffPixels} / ${frame.totalPixels}</td>`
    row.addEventListener('click', () => showFrame(viewer, data, index, row))
    tbody.append(row)
  })
  table.append(tbody)
  section.append(title, table, viewer)
  if (data.frames.length > 0)
    showFrame(
      viewer,
      data,
      peakIndex(data),
      tbody.children[peakIndex(data)] as HTMLElement
    )
  return section
}

function peakIndex(data: ReportData): number {
  let index = 0
  for (let i = 1; i < data.frames.length; i++) {
    if (data.frames[i].diffRatio > data.frames[index].diffRatio) index = i
  }
  return index
}

function showFrame(
  viewer: HTMLElement,
  data: ReportData,
  index: number,
  row: HTMLElement
): void {
  for (const sibling of viewer.parentElement?.querySelectorAll('tr') ?? []) {
    sibling.classList.remove('active')
  }
  row.classList.add('active')
  const number = String(index).padStart(2, '0')
  viewer.innerHTML = ''
  for (const [label, file] of [
    ['A', `a-${number}.png`],
    ['B', `b-${number}.png`],
    ['diff', `diff-${number}.png`]
  ] as const) {
    const figure = document.createElement('figure')
    const caption = document.createElement('figcaption')
    caption.textContent = `${label} @ ${(data.frames[index].timeMs / 1000).toFixed(2)}s`
    const img = document.createElement('img')
    img.src = `${data.assetsBase}${file}`
    img.alt = `${label} 帧截图`
    figure.append(img, caption)
    viewer.append(figure)
  }
}
