const canvas = document.getElementById('canvas') as HTMLDivElement
const form = document.getElementById('options') as HTMLFormElement
const generateBtn = document.getElementById('generate') as HTMLButtonElement
const playBtn = document.getElementById('play') as HTMLButtonElement
const iconPlay = document.getElementById('icon-play') as HTMLElement
const iconPause = document.getElementById('icon-pause') as HTMLElement
const progress = document.getElementById('progress') as HTMLInputElement
const timeLabel = document.getElementById('time') as HTMLSpanElement
const statsLabel = document.getElementById('stats') as HTMLSpanElement

/** 当前动画总时长（ms），由模拟结果决定 */
let duration = 0
let playing = false

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

/** 显示本次生成的 SVG 文件大小与耗时（含网络往返） */
function renderStats(svgText: string, elapsedMs: number) {
  statsLabel.textContent = `文件大小 ${formatBytes(
    new Blob([svgText]).size
  )} · 生成耗时 ${formatElapsed(elapsedMs)}`
  statsLabel.hidden = false
}

async function generate() {
  const data = new FormData(form)
  // 值为空的参数不携带，由后端回退到默认值
  const params = new URLSearchParams()
  for (const key of [
    'username',
    'text',
    'shape',
    'backgroundColor',
    'textColor',
    'stepTime',
    'compressionTolerance',
    'compressionAlgorithm',
    'fontSize',
    'textTop'
  ]) {
    const value = String(data.get(key) ?? '').trim()
    if (value !== '') params.set(key, value)
  }
  if (data.get('disableCompression') === 'on')
    params.set('disableCompression', '1')

  playing = false
  updatePlayIcon()
  playBtn.disabled = true
  progress.disabled = true
  generateBtn.disabled = true
  generateBtn.textContent = '生成中…'
  canvas.innerHTML = '<p class="placeholder">模拟计算中…</p>'

  try {
    const startedAt = performance.now()
    const res = await fetch(`/svg?${params}`)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(
        body?.error ?? `生成失败：${res.status} ${res.statusText}`
      )
    }
    const svgText = await res.text()
    renderStats(svgText, performance.now() - startedAt)
    canvas.innerHTML = svgText
    duration = readDuration()
    progress.max = String(duration)
    renderProgress(0)
    playBtn.disabled = false
    progress.disabled = false
    // 生成完成自动播放
    togglePlay()
  } catch (err) {
    statsLabel.hidden = true
    canvas.innerHTML = ''
    const error = document.createElement('p')
    error.className = 'error'
    error.textContent = err instanceof Error ? err.message : String(err)
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
progress.addEventListener('input', () => seek(Number(progress.value)))

// 页面加载后先用表单默认参数生成一次
generate()

export {}
