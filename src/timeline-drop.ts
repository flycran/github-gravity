import planck from 'planck'
import decomp from 'poly-decomp'
import { parseSVG } from 'svg-path-parser'

const { World, Vec2, Box, Polygon } = planck

const SCALE = 30

const canvas = document.createElement('canvas')

canvas.width = 800
canvas.height = 400

document.body.appendChild(canvas)

const ctx = canvas.getContext('2d')!

const world = new World({
  gravity: { x: 0, y: 20 }
})

const renderBodies: {
  body: planck.Body
  color: string
  width?: number
  height?: number
}[] = []

// -------------------------
// 创建矩形
// -------------------------

function createBox(
  x: number,
  y: number,
  w: number,
  h: number,
  options: {
    static?: boolean
    color?: string
  } = {}
) {
  const body = world.createBody({
    type: options.static ? 'static' : 'dynamic',
    position: new Vec2(x / SCALE, y / SCALE)
  })

  body.createFixture(new Box(w / SCALE / 2, h / SCALE / 2), {
    density: 20,
    friction: 0.5,
    restitution: 0.2
  })

  if (!options.static) {
    renderBodies.push({
      body,
      color: options.color ?? '#40c463',
      width: w,
      height: h
    })
  }

  return body
}

// -------------------------
// 边界
// -------------------------

createBox(400, 410, 810, 20, {
  static: true
})

createBox(-10, 200, 20, 400, {
  static: true
})

createBox(810, 200, 20, 400, {
  static: true
})

// -------------------------
// contribution 方块
// -------------------------

const colors = ['#40c463', '#216e39', '#30a14e', '#9be9a8', '#ebedf0']

for (let i = 0; i < 52; i++) {
  for (let j = 0; j < 7; j++) {
    createBox(40 + i * 10 + (i - 1) * 4, -80 + j * 10 + (j - 1) * 4, 10, 10, {
      color: colors[Math.floor(Math.random() * colors.length)]
    })
  }
}

// =================================================
// SVG path -> Planck 碰撞体
// =================================================

function svgPathToPoints(d: string) {
  const commands = parseSVG(d)

  const points: {
    x: number
    y: number
  }[] = []

  let x = 0
  let y = 0

  for (const cmd of commands) {
    switch (cmd.code) {
      case 'M':
      case 'L':
        x = cmd.x
        y = cmd.y

        points.push({
          x,
          y
        })

        break

      case 'C': {
        // 贝塞尔采样

        const sx = x
        const sy = y

        for (let t = 0; t <= 1; t += 0.1) {
          const mt = 1 - t

          points.push({
            x:
              mt * mt * mt * sx +
              3 * mt * mt * t * cmd.x1 +
              3 * mt * t * t * cmd.x2 +
              t * t * t * cmd.x,

            y:
              mt * mt * mt * sy +
              3 * mt * mt * t * cmd.y1 +
              3 * mt * t * t * cmd.y2 +
              t * t * t * cmd.y
          })
        }

        x = cmd.x
        y = cmd.y

        break
      }
    }
  }

  return points
}

function addSvgCollider(path: SVGPathElement, x: number, y: number) {
  const d = path.getAttribute('d')

  if (!d) return

  const points = svgPathToPoints(d)

  // 转成二维数组

  const polygon = points.map((p) => [p.x, p.y] as [number, number])

  // SVG坐标 -> 凸多边形

  const _convexes = decomp.quickDecomp(polygon)

  const body = world.createBody({
    type: 'static',
    position: new Vec2(x / SCALE, y / SCALE)
  })

  for (const poly of _convexes) {
    body.createFixture(
      new Polygon(poly.map((p) => new Vec2(p[0] / SCALE, p[1] / SCALE)))
    )
  }
}

// 使用方式:
//
const svg = document.querySelector('#orta')!
svg.querySelectorAll('path').forEach((path) => {
  addSvgCollider(path, 380, 120)
})

// -------------------------
// Canvas 渲染
// -------------------------

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  for (const item of renderBodies) {
    const pos = item.body.getPosition()

    ctx.save()

    ctx.translate(pos.x * SCALE, pos.y * SCALE)

    ctx.rotate(item.body.getAngle())

    ctx.fillStyle = item.color

    ctx.fillRect(
      -(item.width ?? 10) / 2,
      -(item.height ?? 10) / 2,
      item.width ?? 10,
      item.height ?? 10
    )

    ctx.restore()
  }
}

// -------------------------
// Loop
// -------------------------

let last = performance.now()

function loop(now: number) {
  world.step(Math.min((now - last) / 1000, 1 / 30))

  last = now

  render()

  requestAnimationFrame(loop)
}

requestAnimationFrame(loop)
