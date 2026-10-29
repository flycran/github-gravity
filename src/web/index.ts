import { gensvg } from '../gensvg'
import type { SimulationOptions } from '../physics'

/** 内置字体：浏览器读不到本地文件，直接从仓库获取 */
const DEFAULT_FONT_URL =
  'https://raw.githubusercontent.com/flycran/github-gravity/main/public/LiberationSerif-Bold.ttf'

const canvas = document.getElementById('canvas') as HTMLDivElement
const form = document.getElementById('options') as HTMLFormElement
const generateBtn = document.getElementById('generate') as HTMLButtonElement
const playBtn = document.getElementById('play') as HTMLButtonElement
const iconPlay = document.getElementById('icon-play') as HTMLElement
const iconPause = document.getElementById('icon-pause') as HTMLElement
const progress = document.getElementById('progress') as HTMLInputElement
const timeLabel = document.getElementById('time') as HTMLSpanElement
const statsLabel = document.getElementById('stats') as HTMLSpanElement
const fontInput = document.getElementById('font') as HTMLInputElement
const fontLabel = document.getElementById('font-label') as HTMLSpanElement
const fontUrlInput = document.getElementById('font-url') as HTMLInputElement
const clearFontBtn = document.getElementById('clear-font') as HTMLButtonElement

/** 当前动画总时长（ms），由模拟结果决定 */
let duration = 0
let playing = false

/** 读取表单选项，空值不传，由 startSimulation 回退到默认值 */
async function readOptions(data: FormData): Promise<SimulationOptions> {
  const str = (key: string): string | undefined => {
    const value = String(data.get(key) ?? '').trim()
    return value === '' ? undefined : value
  }
  const num = (key: string): number | undefined => {
    const raw = str(key)
    if (raw === undefined) return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
  }
  const algorithm = str('compressionAlgorithm')
  const file = data.get('font')
  const fontUrl = str('fontUrl')

  return {
    username: str('username') ?? '',
    text: str('text'),
    shape: data.get('shape') === 'square' ? 'square' : 'circle',
    backgroundColor: str('backgroundColor'),
    textColor: str('textColor'),
    stepTime: num('stepTime'),
    compressionTolerance: num('compressionTolerance'),
    compressionAlgorithm:
      algorithm === 'DP' || algorithm === 'RDP' || algorithm === 'Greedy'
        ? algorithm
        : undefined,
    disableCompression: data.get('disableCompression') === 'on',
    fontSize: num('fontSize'),
    textTop: num('textTop'),
    // 优先级：上传的文件 > 填写的 URL > 仓库里的内置字体
    font:
      file instanceof File && file.size > 0
        ? await file.arrayBuffer()
        : (fontUrl ?? DEFAULT_FONT_URL)
  }
}

function getSvg(): SVGSVGElement | null {
  return canvas.querySelector('svg')
}

function updatePlayIcon() {
  iconPlay.toggleAttribute('hidden', playing)
  iconPause.toggleAttribute('hidden', !playing)
}

function renderProgress(ms: number) {
  progress.value = String(ms)
  timeLabel.textContent = `${(ms / 1000).toFixed(2)}s / ${(duration / 1000).toFixed(2)}s`
}

// SMIL 文档时间是播放状态的唯一来源，进度条只是它的视图
function seek(ms: number) {
  getSvg()?.setCurrentTime(ms / 1000)
  renderProgress(ms)
}

function tick() {
  if (!playing) return
  const svg = getSvg()
  if (!svg) return
  const ms = svg.getCurrentTime() * 1000
  if (ms >= duration) {
    // 冻结 SMIL 时钟并钉在末帧，避免文档时间空转
    svg.pauseAnimations()
    svg.setCurrentTime(duration / 1000)
    playing = false
    updatePlayIcon()
    renderProgress(duration)
    return
  }
  renderProgress(ms)
  requestAnimationFrame(tick)
}

function togglePlay() {
  const svg = getSvg()
  if (!svg || duration === 0) return
  if (playing) {
    svg.pauseAnimations()
    playing = false
  } else {
    // 播放到末尾后再次播放回到起点
    if (svg.getCurrentTime() * 1000 >= duration) svg.setCurrentTime(0)
    svg.unpauseAnimations()
    playing = true
    requestAnimationFrame(tick)
  }
  updatePlayIcon()
}

/** 动画总时长（ms），从 SMIL 动画的 dur 属性读取，如 "7872ms" */
function readDuration(): number {
  const dur = canvas.querySelector('animateTransform')?.getAttribute('dur')
  const ms = dur ? parseFloat(dur) : NaN
  return Number.isFinite(ms) ? ms : 0
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
}

function formatElapsed(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`
}

/** 显示本次生成的 SVG 文件大小与耗时 */
function renderStats(svgText: string, elapsedMs: number) {
  statsLabel.textContent = `文件大小 ${formatBytes(
    new Blob([svgText]).size
  )} · 生成耗时 ${formatElapsed(elapsedMs)}`
  statsLabel.hidden = false
}

async function generate() {
  const data = new FormData(form)

  playing = false
  updatePlayIcon()
  playBtn.disabled = true
  progress.disabled = true
  generateBtn.disabled = true
  generateBtn.textContent = '生成中…'
  canvas.innerHTML = '<p class="placeholder">模拟计算中…</p>'

  try {
    const startedAt = performance.now()
    const svgText = await gensvg(await readOptions(data))
    renderStats(svgText, performance.now() - startedAt)
    canvas.innerHTML = svgText
    duration = readDuration()
    progress.max = String(duration)
    playBtn.disabled = false
    progress.disabled = false
    // SMIL 动画随元素挂载自动开始，这里停在首帧，等用户主动播放
    const svg = getSvg()
    svg?.pauseAnimations()
    svg?.setCurrentTime(0)
    renderProgress(0)
  } catch (err) {
    // 错误对象带堆栈，控制台能定位到具体是字体、网络还是物理模拟出的问题
    console.error('[github-gravity] 生成失败：', err)
    statsLabel.hidden = true
    canvas.innerHTML = ''
    const error = document.createElement('p')
    error.className = 'error'
    error.textContent = `${err instanceof Error ? err.message : String(err)}

打开 DevTools（F12）查看控制台中的详细错误`
    canvas.append(error)
  } finally {
    generateBtn.disabled = false
    generateBtn.textContent = '生成'
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  generate()
})
playBtn.addEventListener('click', togglePlay)
progress.addEventListener('input', () => {
  // 拖动进度条是在手动定位，暂停正在进行的播放
  if (playing) {
    getSvg()?.pauseAnimations()
    playing = false
    updatePlayIcon()
  }
  seek(Number(progress.value))
})

/** 清除已上传字体，标签回退到上传入口 */
function resetFontFile() {
  fontInput.value = ''
  fontLabel.textContent = '选择文件'
}

// 原生 file 控件选过文件后没有取消入口，清空 value 才能回退到默认字体
clearFontBtn.addEventListener('click', resetFontFile)

// 上传与 URL 二选一：后设置的清空前一个，避免搞不清生效的是哪个
fontInput.addEventListener('change', () => {
  const file = fontInput.files?.[0]
  if (!file) return
  fontLabel.textContent = file.name
  fontUrlInput.value = ''
})

fontUrlInput.addEventListener('input', () => {
  if (fontUrlInput.value.trim() !== '') resetFontFile()
})

// 页面加载后先用表单默认参数生成一次
generate()

export {}
