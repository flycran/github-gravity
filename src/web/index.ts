import { HEIGHT, SCALE, SIZE, WIDTH } from '../utils'
import type { ContributionJson, SimulationResult } from '../utils/index'

const trajectoryRes: SimulationResult = await fetch('/trajectory').then((res) =>
  res.json()
)

const svg = document.getElementById('canvas') as unknown as SVGSVGElement

svg.style.width = WIDTH * SCALE + 'px'
svg.style.height = HEIGHT * SCALE + 'px'
svg.setAttribute('viewBox', `0 0 ${svg.style.width} ${svg.style.height}`)

// 背景
const background = document.createElementNS(
  'http://www.w3.org/2000/svg',
  'rect'
)
background.setAttribute('width', `${WIDTH * SCALE}`)
background.setAttribute('height', `${HEIGHT * SCALE}`)
background.setAttribute('fill', trajectoryRes.backgroundColor)
svg.appendChild(background)

function createContribution(contribution: ContributionJson) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  svg.appendChild(g)
  g.setAttribute('data-date', contribution.date)

  const isCircle = trajectoryRes.shape === 'circle'

  if (isCircle) {
    const circle = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'circle'
    ) as SVGCircleElement
    circle.setAttribute('r', `${(SIZE / 2) * SCALE}`)
    circle.setAttribute('fill', contribution.color)
    g.appendChild(circle)
  } else {
    const rect = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'rect'
    ) as SVGRectElement
    rect.setAttribute('x', `${-(SIZE / 2) * SCALE}`)
    rect.setAttribute('y', `${-(SIZE / 2) * SCALE}`)
    rect.setAttribute('width', `${SIZE * SCALE}`)
    rect.setAttribute('height', `${SIZE * SCALE}`)
    rect.setAttribute('fill', contribution.color)
    g.appendChild(rect)
  }

  const animateTransform = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'animateTransform'
  )

  animateTransform.setAttribute('attributeName', 'transform')
  animateTransform.setAttribute('attributeType', 'XML')
  animateTransform.setAttribute('type', 'translate')
  animateTransform.setAttribute(
    'values',
    contribution.trajectory
      .map(({ x, y }) => `${x * SCALE},${(HEIGHT - y) * SCALE}`)
      .join(';')
  )
  animateTransform.setAttribute(
    'dur',
    `${trajectoryRes.stepCount * trajectoryRes.stepTime}ms`
  )
  animateTransform.setAttribute('fill', 'freeze')

  g.appendChild(animateTransform)
}

trajectoryRes.contributions.forEach(createContribution)

// 用三角网格渲染用户名文字（与物理碰撞体完全一致）
// for (const tri of trajectoryRes.textTriangles) {
//   const [x0, y0, x1, y1, x2, y2] = tri
//   const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
//   poly.setAttribute(
//     'points',
//     `${(x0 * SCALE).toFixed(1)},${((HEIGHT - y0) * SCALE).toFixed(1)} ${(x1 * SCALE).toFixed(1)},${((HEIGHT - y1) * SCALE).toFixed(1)} ${(x2 * SCALE).toFixed(1)},${((HEIGHT - y2) * SCALE).toFixed(1)}`
//   )
//   poly.setAttribute('fill', '#000')
//   svg.appendChild(poly)
// }

const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
// 将 opentype 坐标（Y 轴向上）变换到 SVG 坐标（Y 轴向下），与物理体世界坐标对齐
// 物理世界: worldX = opentypeX + offsetX, worldY = -opentypeY + centerY
// SVG: svgX = worldX * SCALE, svgY = (HEIGHT - worldY) * SCALE
// 合并: svgX = (opentypeX + offsetX) * SCALE, svgY = (HEIGHT - centerY + opentypeY) * SCALE
g.setAttribute(
  'transform',
  `translate(${trajectoryRes.offsetX * SCALE}, ${(HEIGHT - trajectoryRes.centerY) * SCALE}) scale(${SCALE})`
)
svg.appendChild(g)

trajectoryRes.textPaths.forEach(({ pathData }) => {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', pathData)
  path.setAttribute('fill', trajectoryRes.textColor)
  g.appendChild(path)
})

svg.appendChild(g)

export {}
