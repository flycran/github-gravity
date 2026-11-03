import { GensvgOptions, gensvg } from '../utils/gensvg'
import { DEFAULT_FONT_URL } from './const'

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

/** 播放控制的统一时钟：SMIL 引擎走文档时钟，CSS 引擎走 Web Animations API */
interface AnimationClock {
  /** 当前时间（ms） */
  now(): number
  /** 动画总时长（ms） */
  totalDuration(): number
  pause(): void
  play(): void
  seek(ms: number): void
}

function smilClock(svg: SVGSVGElement): AnimationClock {
  return {
    now: () => Math.round(svg.getCurrentTime() * 1000),
    totalDuration: () => {
      const raw = svg.querySelector('animateTransform')?.getAttribute('dur')
      const ms = raw ? parseFloat(raw) : NaN
      return Number.isFinite(ms) ? ms : 0
    },
    pause: () => svg.pauseAnimations(),
    play: () => svg.unpauseAnimations(),
    seek: (ms) => svg.setCurrentTime(ms / 1000)
  }
}

function cssClock(container: SVGSVGElement): AnimationClock {
  // 依赖 getAnimations 调用时 flush 样式的规范行为：innerHTML 插入后同步即可取到全部动画
  const animations = [...container.querySelectorAll('#b>g')].flatMap((g) =>
    g.getAnimations()
  )
  return {
    now: () => Math.max(0, ...animations.map((a) => a.currentTime ?? 0)),
    // 从动画对象读实际时长：自定义 animation 写死独立时长时依然准确
    totalDuration: () =>
      Math.max(
        0,
        ...animations.map((a) => +(a.effect?.getComputedTiming().duration ?? 0))
      ),
    pause: () => animations.forEach((a) => a.pause()),
    play: () => animations.forEach((a) => a.play()),
    seek: (ms) => animations.forEach((a) => (a.currentTime = ms))
  }
}

/** 按生成结果选择时钟：CSS 引擎没有 animateTransform 元素，动画声明在 style 块里 */
function buildClock(): AnimationClock | null {
  const svg = getSvg()
  if (!svg) return null
  return svg.querySelector('animateTransform') ? smilClock(svg) : cssClock(svg)
}

let clock: AnimationClock | null = null

/** 读取表单选项，未填写的字段值为 undefined */
async function readOptions(data: FormData): Promise<GensvgOptions> {
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
    css: data.get('css') === 'on',
    animation: str('animation'),
    maxSimulationTime: num('maxSimulationTime'),
    compressionTolerance: num('compressionTolerance'),
    compressionAlgorithm:
      algorithm === 'DP' || algorithm === 'RDP' || algorithm === 'Greedy'
        ? algorithm
        : undefined,
    disableCompression: data.get('disableCompression') === 'on',
    fontSize: num('fontSize'),
    textTop: num('textTop'),
    scale: num('scale'),
    speed: num('speed'),
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

function seek(ms: number) {
  clock?.seek(ms)
  renderProgress(ms)
}

function tick() {
  if (!playing) return
  const ms = clock?.now() ?? 0
  if (ms >= duration) {
    // 钉在末帧，避免时钟空转
    clock?.pause()
    clock?.seek(duration)
    playing = false
    updatePlayIcon()
    renderProgress(duration)
    return
  }
  renderProgress(ms)
  requestAnimationFrame(tick)
}

function togglePlay() {
  if (!clock || duration === 0) return
  if (playing) {
    clock.pause()
    playing = false
  } else {
    // 播放到末尾后再次播放回到起点
    if (clock.now() >= duration) clock.seek(0)
    clock.play()
    playing = true
    requestAnimationFrame(tick)
  }
  updatePlayIcon()
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
    // 时长从时钟读：CSS 引擎取动画对象实际 timing，自定义 animation 写死时长时依然准确
    clock = buildClock()
    duration = clock?.totalDuration() ?? 0
    progress.max = String(duration)
    playBtn.disabled = false
    progress.disabled = false
    // 动画随元素挂载自动开始，停在首帧等用户主动播放
    clock?.pause()
    clock?.seek(0)
    renderProgress(0)
  } catch (err) {
    // 错误对象带堆栈，控制台能定位到具体是字体、网络还是物理模拟出的问题
    console.error('[github-gravity] 生成失败：', err)
    statsLabel.hidden = true
    clock = null
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
    clock?.pause()
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
