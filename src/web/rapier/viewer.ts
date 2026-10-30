/**
 * Rapier 碰撞箱调试渲染器。
 *
 * 与具体世界解耦：接收一个世界工厂和它的边界/步长配置，逐帧步进并把
 * 世界内所有 Collider 的实时线框画出来，配合拖拽/滚轮缩放逐个观察
 * 碰撞箱的位移与旋转。传入不同的 createWorld 即可预览任意世界。
 */

import {
  Ball,
  Capsule,
  Collider,
  ConvexPolygon,
  Cuboid,
  HalfSpace,
  init,
  Polyline,
  RoundCuboid,
  RoundTriangle,
  Segment,
  Triangle,
  TriMesh,
  World
} from '@dimforge/rapier2d-compat'
import { Application, Graphics, Text } from 'pixi.js'
import { Viewport } from 'pixi-viewport'

const BACKGROUND_COLOR = 0x0d1117
/** 固定刚体的碰撞箱颜色 */
const STATIC_COLOR = 0x7d8590
/** 动态刚体的碰撞箱颜色 */
const DYNAMIC_COLOR = 0x3fb950

/** 尺子占据的屏幕边缘宽度（px） */
const RULER_SIZE = 30
/** 相邻主刻度的最小屏幕间距（px） */
const MIN_TICK_SPACING = 60
const RULER_BACKGROUND = 0x161b22
const RULER_TICK_COLOR = 0x484f58
const RULER_BORDER_COLOR = 0x30363d
const GUIDE_COLOR = 0x58a6ff

/** 每隔多少步记录一次位姿快照，供进度条时间回溯 */
const SNAPSHOT_INTERVAL = 2
/** 最多保留的快照数，达到后停止记录以控制内存占用 */
const MAX_SNAPSHOTS = 3600

/** 候选刻度步长，从密到疏 */
const RULER_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]

/** 世界的物理边界（y 轴向上），决定坐标映射与相机取景 */
export interface WorldBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface WorldViewerOptions {
  /** 创建要渲染的世界，初始加载与点击重置时各调用一次，可返回 Promise */
  createWorld: () => World | Promise<World>
  /** 世界的物理边界，决定坐标映射与相机取景 */
  bounds: WorldBounds
  /** 固定物理步长（秒），由渲染循环按真实耗时累加后消耗 */
  timestep: number
  /**
   * 播放倍速：1 为实时，2 为两倍速，0.5 为半速，默认 1。
   * 只改变时间流逝速度，物理步长仍是固定的 timestep，模拟结果不受影响
   */
  playbackSpeed?: number
}

/** 选出让相邻主刻度间距不小于 MIN_TICK_SPACING 的最小整步长 */
function chooseRulerStep(pixelsPerUnit: number) {
  return (
    RULER_STEPS.find((step) => step * pixelsPerUnit >= MIN_TICK_SPACING) ??
    RULER_STEPS[RULER_STEPS.length - 1]
  )
}

/** 刻度值按步长决定小数位，避免出现 0.30000000000000004 这类结果 */
function formatTick(value: number, step: number) {
  return value.toFixed(step < 1 ? 1 : 0)
}

/** 把物理坐标换算到 Pixi 坐标的工具集，随世界边界构造 */
interface ScreenMapper {
  /** 世界横向跨度，换算后屏幕坐标落在 0..width */
  width: number
  /** Rapier 的 y 轴向上、Pixi 的 y 轴向下：绘制前统一翻转并平移到正区间 */
  toScreen(x: number, y: number): { x: number; y: number }
}

function createScreenMapper(bounds: WorldBounds): ScreenMapper {
  return {
    width: bounds.maxX - bounds.minX,
    toScreen(x, y) {
      return { x: x - bounds.minX, y: bounds.maxY - y }
    }
  }
}

type ScreenPoint = ReturnType<ScreenMapper['toScreen']>

function tracePolygon(graphics: Graphics, points: ScreenPoint[]) {
  graphics.poly(
    points.flatMap((point) => [point.x, point.y]),
    true
  )
}

/**
 * 按碰撞体自身的实时位置与朝向画出线框。
 * 所有形状都只在局部坐标里展开点，再经 body 的平移/旋转映射到屏幕。
 */
function drawCollider(
  graphics: Graphics,
  collider: Collider,
  lineWidth: number,
  mapper: ScreenMapper,
  /** 回溯查看时的位姿覆盖；不传则读碰撞体的实时位姿 */
  pose?: { x: number; y: number; rotation: number }
) {
  const style = {
    color: collider.parent()?.isFixed() ? STATIC_COLOR : DYNAMIC_COLOR,
    width: lineWidth
  }

  const origin = pose ?? collider.translation()
  const angle = pose ? pose.rotation : collider.rotation()
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const { toScreen } = mapper

  /** 形状局部坐标 → 屏幕坐标 */
  const map = (x: number, y: number) =>
    toScreen(origin.x + x * cos - y * sin, origin.y + x * sin + y * cos)

  const shape = collider.shape

  if (shape instanceof Ball) {
    const center = toScreen(origin.x, origin.y)
    graphics.circle(center.x, center.y, shape.radius)
  } else if (shape instanceof Cuboid || shape instanceof RoundCuboid) {
    // 圆角矩形按直角矩形近似，调试时只关心碰撞范围
    const { x: halfWidth, y: halfHeight } = shape.halfExtents
    tracePolygon(graphics, [
      map(-halfWidth, -halfHeight),
      map(halfWidth, -halfHeight),
      map(halfWidth, halfHeight),
      map(-halfWidth, halfHeight)
    ])
  } else if (shape instanceof Capsule) {
    const { radius, halfHeight } = shape
    const top = map(0, halfHeight)
    const bottom = map(0, -halfHeight)
    graphics.circle(top.x, top.y, radius).circle(bottom.x, bottom.y, radius)

    const leftTop = map(-radius, halfHeight)
    const leftBottom = map(-radius, -halfHeight)
    const rightTop = map(radius, halfHeight)
    const rightBottom = map(radius, -halfHeight)
    graphics
      .moveTo(leftTop.x, leftTop.y)
      .lineTo(leftBottom.x, leftBottom.y)
      .moveTo(rightTop.x, rightTop.y)
      .lineTo(rightBottom.x, rightBottom.y)
  } else if (shape instanceof Segment) {
    const from = map(shape.a.x, shape.a.y)
    const to = map(shape.b.x, shape.b.y)
    graphics.moveTo(from.x, from.y).lineTo(to.x, to.y)
  } else if (shape instanceof Triangle || shape instanceof RoundTriangle) {
    tracePolygon(graphics, [
      map(shape.a.x, shape.a.y),
      map(shape.b.x, shape.b.y),
      map(shape.c.x, shape.c.y)
    ])
  } else if (shape instanceof ConvexPolygon) {
    const points: ScreenPoint[] = []
    for (let i = 0; i < shape.vertices.length; i += 2) {
      points.push(map(shape.vertices[i], shape.vertices[i + 1]))
    }
    tracePolygon(graphics, points)
  } else if (shape instanceof Polyline) {
    const { vertices, indices } = shape
    if (indices.length > 0) {
      for (let i = 0; i < indices.length; i += 2) {
        const from = map(vertices[indices[i] * 2], vertices[indices[i] * 2 + 1])
        const to = map(
          vertices[indices[i + 1] * 2],
          vertices[indices[i + 1] * 2 + 1]
        )
        graphics.moveTo(from.x, from.y).lineTo(to.x, to.y)
      }
    } else {
      for (let i = 0; i < vertices.length; i += 2) {
        const point = map(vertices[i], vertices[i + 1])
        if (i === 0) graphics.moveTo(point.x, point.y)
        else graphics.lineTo(point.x, point.y)
      }
    }
  } else if (shape instanceof TriMesh) {
    const { vertices, indices } = shape
    for (let i = 0; i < indices.length; i += 3) {
      tracePolygon(graphics, [
        map(vertices[indices[i] * 2], vertices[indices[i] * 2 + 1]),
        map(vertices[indices[i + 1] * 2], vertices[indices[i + 1] * 2 + 1]),
        map(vertices[indices[i + 2] * 2], vertices[indices[i + 2] * 2 + 1])
      ])
    }
  } else if (shape instanceof HalfSpace) {
    // 半空间无界，只画穿过原点、与法线垂直的一段线
    const normalX = shape.normal.x * cos - shape.normal.y * sin
    const normalY = shape.normal.x * sin + shape.normal.y * cos
    const tangentX = -normalY * mapper.width
    const tangentY = normalX * mapper.width
    const from = toScreen(origin.x - tangentX, origin.y - tangentY)
    const to = toScreen(origin.x + tangentX, origin.y + tangentY)
    graphics.moveTo(from.x, from.y).lineTo(to.x, to.y)
  }

  graphics.stroke(style)
}

/**
 * 启动渲染器：搭建 Pixi 舞台、步进 world 并绘制所有碰撞箱线框。
 * 页面需提供 #word（画布容器）、#toggle/#step/#reset（按钮）与 #status（状态栏）
 */
export async function runWorldViewer({
  createWorld,
  bounds,
  timestep,
  playbackSpeed = 1
}: WorldViewerOptions) {
  const mapper = createScreenMapper(bounds)
  const worldWidth = mapper.width
  const worldHeight = bounds.maxY - bounds.minY

  await init()

  const app = new Application()
  await app.init({
    antialias: true,
    background: BACKGROUND_COLOR,
    width: window.innerWidth,
    height: window.innerHeight
  })
  document.getElementById('word')?.append(app.canvas)

  const viewport = new Viewport({
    screenWidth: window.innerWidth,
    screenHeight: window.innerHeight,
    worldWidth: worldWidth,
    worldHeight: worldHeight,
    events: app.renderer.events,
    ticker: app.ticker
  })
  viewport.drag().wheel().pinch()
  viewport.fit()
  viewport.moveCenter(worldWidth / 2, worldHeight / 2)
  app.stage.addChild(viewport)

  const graphics = new Graphics()
  viewport.addChild(graphics)

  const toggleButton = document.getElementById('toggle') as HTMLButtonElement
  const stepButton = document.getElementById('step') as HTMLButtonElement
  const resetButton = document.getElementById('reset') as HTMLButtonElement
  const statusLabel = document.getElementById('status') as HTMLSpanElement
  const timeline = document.getElementById('timeline') as HTMLInputElement

  let world = await createWorld()
  let stepCount = 0
  let running = true
  let renderedStep = -1
  /** 累积的未消耗物理时间（秒），攒够一个 timestep 才步进一次 */
  let accumulator = 0
  /** 单帧最多补的步数，避免切回标签页时一次性追帧过多；会按倍速缩放 */
  const MAX_STEPS_PER_FRAME = 5

  /** 固定顺序的碰撞箱列表，世界创建后不再增删，供快照按下标对齐 */
  let colliders: Collider[] = []
  /** 位姿快照 [x, y, rotation] × n，与 historySteps 一一对应 */
  let history: Float32Array[] = []
  let historySteps: number[] = []
  /** 正在回溯查看的快照下标，-1 表示跟随现实最新状态 */
  let viewingIndex = -1

  /** 清空回溯历史，并按当前世界重建碰撞箱下标 */
  function resetHistory() {
    colliders = []
    world.forEachCollider((collider) => colliders.push(collider))
    history = []
    historySteps = []
    viewingIndex = -1
    timeline.max = '0'
    timeline.value = '0'
  }

  function recordSnapshot() {
    const data = new Float32Array(colliders.length * 3)
    for (let i = 0; i < colliders.length; i++) {
      const origin = colliders[i].translation()
      data[i * 3] = origin.x
      data[i * 3 + 1] = origin.y
      data[i * 3 + 2] = colliders[i].rotation()
    }
    history.push(data)
    historySteps.push(stepCount)
  }

  function renderColliders() {
    // 线宽按缩放反向换算，保证屏幕上的描边始终是 1.5px
    const lineWidth = 1.5 / viewport.scale.x
    graphics.clear()
    const snapshot = viewingIndex >= 0 ? history[viewingIndex] : undefined
    if (snapshot) {
      // 回溯查看：按快照位姿绘制，不改动物理世界本身
      for (let i = 0; i < colliders.length; i++) {
        drawCollider(graphics, colliders[i], lineWidth, mapper, {
          x: snapshot[i * 3],
          y: snapshot[i * 3 + 1],
          rotation: snapshot[i * 3 + 2]
        })
      }
    } else {
      world.forEachCollider((collider) =>
        drawCollider(graphics, collider, lineWidth, mapper)
      )
    }
  }

  function renderStatus() {
    const stepLabel =
      viewingIndex >= 0
        ? `查看 ${historySteps[viewingIndex] ?? 0} / ${stepCount} 步`
        : `${stepCount} 步`
    statusLabel.textContent = `${running ? '运行中' : '已暂停'} · ${stepLabel} · ×${playbackSpeed} · ${world.colliders.len()} 个碰撞箱`
  }

  // ---- 屏幕空间的尺子与辅助线：不随 viewport 缩放 ----
  const ruler = new Graphics()
  const guides = new Graphics()
  app.stage.addChild(ruler, guides)

  const rulerLabels: Text[] = []
  const rulerLabelStyle = {
    fontFamily: 'monospace',
    fontSize: 10,
    fill: 0x8b949e
  }

  /** 复用刻度文字对象，避免每帧创建新 Text */
  function showRulerLabel(index: number, text: string) {
    let label = rulerLabels[index]
    if (!label) {
      label = new Text({ text, style: rulerLabelStyle })
      rulerLabels.push(label)
      app.stage.addChild(label)
    }
    label.visible = true
    if (label.text !== text) label.text = text
    return label
  }

  function renderRuler() {
    const { width, height } = app.screen
    ruler.clear()
    for (const label of rulerLabels) label.visible = false

    ruler.rect(0, 0, width, RULER_SIZE).fill(RULER_BACKGROUND)
    ruler.rect(0, 0, RULER_SIZE, height).fill(RULER_BACKGROUND)

    // 屏幕左上/右下角对应的世界坐标，用来决定刻度范围
    const topLeft = viewport.toWorld(0, 0)
    const bottomRight = viewport.toWorld(width, height)
    const step = chooseRulerStep(viewport.scale.x)
    const minorStep = step / 2
    let labelIndex = 0

    // 顶部尺：物理 x 轴
    const minX = topLeft.x + bounds.minX
    const maxX = bottomRight.x + bounds.minX
    const firstX = Math.ceil(minX / minorStep)
    for (let index = firstX; index * minorStep <= maxX; index++) {
      const value = index * minorStep
      const screenX = (value - minX) * viewport.scale.x
      if (screenX < RULER_SIZE) continue

      const major = index % 2 === 0
      const tick = major ? 9 : 4
      ruler.moveTo(screenX, RULER_SIZE).lineTo(screenX, RULER_SIZE - tick)
      if (!major) continue

      const label = showRulerLabel(labelIndex++, formatTick(value, step))
      label.anchor.set(0.5, 0)
      label.position.set(screenX, 3)
    }

    // 左侧尺：物理 y 轴
    const minY = bounds.maxY - bottomRight.y
    const maxY = bounds.maxY - topLeft.y
    const firstY = Math.ceil(minY / minorStep)
    for (let index = firstY; index * minorStep <= maxY; index++) {
      const value = index * minorStep
      const screenY = (bounds.maxY - value - topLeft.y) * viewport.scale.y
      if (screenY < RULER_SIZE) continue

      const major = index % 2 === 0
      const tick = major ? 9 : 4
      ruler.moveTo(RULER_SIZE, screenY).lineTo(RULER_SIZE - tick, screenY)
      if (!major) continue

      const label = showRulerLabel(labelIndex++, formatTick(value, step))
      label.anchor.set(0, 0.5)
      label.position.set(3, screenY)
    }

    ruler.stroke({ color: RULER_TICK_COLOR, width: 1 })
    ruler
      .moveTo(0, RULER_SIZE)
      .lineTo(width, RULER_SIZE)
      .moveTo(RULER_SIZE, 0)
      .lineTo(RULER_SIZE, height)
      .stroke({ color: RULER_BORDER_COLOR, width: 1 })
  }

  const guideStyle = {
    fontFamily: 'monospace',
    fontSize: 11,
    fill: GUIDE_COLOR,
    stroke: { color: BACKGROUND_COLOR, width: 3 }
  }
  const guideXLabel = new Text({ text: '', style: guideStyle })
  const guideYLabel = new Text({ text: '', style: guideStyle })
  app.stage.addChild(guideXLabel, guideYLabel)

  let altPressed = false
  let pointer: { x: number; y: number } | null = null

  app.canvas.addEventListener('pointermove', (event) => {
    const rect = app.canvas.getBoundingClientRect()
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    altPressed = event.altKey
  })
  app.canvas.addEventListener('pointerleave', () => {
    pointer = null
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Alt') altPressed = true
  })
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Alt') altPressed = false
  })
  window.addEventListener('blur', () => {
    altPressed = false
  })

  // 屏蔽浏览器自身的缩放：Ctrl/Cmd + 滚轮（含触控板捏合）与 Ctrl/Cmd + 加减号
  window.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault()
    },
    { passive: false }
  )
  window.addEventListener('keydown', (event) => {
    if (!event.ctrlKey && !event.metaKey) return
    if (['+', '-', '=', '_', '0'].includes(event.key)) {
      event.preventDefault()
    }
  })

  /** 按住 Alt 时画穿过鼠标的两条辅助线，并在旁边标出世界坐标 */
  function renderGuides() {
    guides.clear()
    const show = altPressed && pointer !== null
    guideXLabel.visible = show
    guideYLabel.visible = show
    if (!show || !pointer) return

    const { width, height } = app.screen
    guides
      .moveTo(pointer.x, 0)
      .lineTo(pointer.x, height)
      .moveTo(0, pointer.y)
      .lineTo(width, pointer.y)
      .stroke({ color: GUIDE_COLOR, width: 1 })

    const cursor = viewport.toWorld(pointer.x, pointer.y)
    const physicsX = cursor.x + bounds.minX
    const physicsY = bounds.maxY - cursor.y

    // 读数贴在尺子一侧，远离鼠标指针，避免被挡住
    const textX = `x ${physicsX.toFixed(1)}`
    if (guideXLabel.text !== textX) guideXLabel.text = textX
    const flip = pointer.x > width - 80
    guideXLabel.anchor.set(flip ? 1 : 0, 0)
    guideXLabel.position.set(
      flip ? pointer.x - 6 : pointer.x + 6,
      RULER_SIZE + 4
    )

    const textY = `y ${physicsY.toFixed(1)}`
    if (guideYLabel.text !== textY) guideYLabel.text = textY
    const above = pointer.y > RULER_SIZE + 16
    guideYLabel.anchor.set(0, above ? 1 : 0)
    guideYLabel.position.set(
      RULER_SIZE + 6,
      above ? pointer.y - 6 : pointer.y + 6
    )
  }

  app.ticker.add((ticker) => {
    if (running) {
      // 按真实耗时 × 倍速累积，固定步长推进：物理速度与刷新率、倍速都无关
      accumulator = Math.min(
        accumulator + (ticker.deltaMS / 1000) * playbackSpeed,
        timestep * MAX_STEPS_PER_FRAME * playbackSpeed
      )
      while (accumulator >= timestep) {
        world.step()
        stepCount++
        if (
          history.length < MAX_SNAPSHOTS &&
          stepCount % SNAPSHOT_INTERVAL === 0
        ) {
          recordSnapshot()
        }
        accumulator -= timestep
      }
      if (history.length > 0) {
        timeline.max = String(history.length - 1)
        // 跟随现实时进度条钉在最右；回溯查看时保持用户拖的位置
        if (viewingIndex === -1) timeline.value = timeline.max
      }
    }
    renderColliders()
    renderRuler()
    renderGuides()
    if (stepCount !== renderedStep) {
      renderedStep = stepCount
      renderStatus()
    }
  })

  toggleButton.addEventListener('click', () => {
    running = !running
    // 继续播放时从现实最新状态出发，退出回溯查看
    if (running) viewingIndex = -1
    toggleButton.textContent = running ? '暂停' : '继续'
    renderStatus()
  })

  stepButton.addEventListener('click', () => {
    viewingIndex = -1
    world.step()
    stepCount++
    // 手动单步后清掉累积量，避免继续播放时立刻补一步
    accumulator = 0
    renderColliders()
    renderStatus()
  })

  timeline.addEventListener('input', () => {
    // 拖动回溯时自动暂停，物理世界停在现实最新状态不受影响
    if (running) {
      running = false
      toggleButton.textContent = '继续'
    }
    viewingIndex = Number(timeline.value)
    renderColliders()
    renderStatus()
  })

  resetButton.addEventListener('click', async () => {
    resetButton.disabled = true
    try {
      // 新世界就绪后再交换引用并释放旧的：await 期间 ticker 仍会步进
      // world，绝不能让它指向已 free 的世界
      const next = await createWorld()
      const previous = world
      world = next
      previous.free()
      stepCount = 0
      accumulator = 0
      resetHistory()
      renderColliders()
      renderStatus()
    } finally {
      resetButton.disabled = false
    }
  })

  window.addEventListener('resize', () => {
    app.renderer.resize(window.innerWidth, window.innerHeight)
    viewport.resize(
      window.innerWidth,
      window.innerHeight,
      worldWidth,
      worldHeight
    )
  })

  resetHistory()
  renderColliders()
  renderRuler()
  renderGuides()
  renderStatus()
}
