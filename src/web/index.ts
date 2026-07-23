import { FONT_SIZE, HEIGHT, SCALE, SIZE, TEXT, TEXT_TOP, WIDTH } from '../utils'
import type { ContributionJson, SimulationResult } from '../utils/index'

const trajectoryRes: SimulationResult = await fetch('/trajectory').then((res) =>
  res.json()
)

const svg = document.getElementById('canvas') as unknown as SVGSVGElement

svg.style.width = WIDTH * SCALE + 'px'
svg.style.height = HEIGHT * SCALE + 'px'
svg.setAttribute('viewBox', `0 0 ${svg.style.width} ${svg.style.height}`)

function createContribution(contribution: ContributionJson) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  svg.appendChild(g)
  g.setAttribute('data-date', contribution.date)

  const rect = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'rect'
  ) as SVGRectElement

  rect.setAttribute('width', `${SIZE * SCALE}`)
  rect.setAttribute('height', `${SIZE * SCALE}`)
  rect.setAttribute('x', `-${(SIZE / 2) * SCALE}`)
  rect.setAttribute('y', `-${(SIZE / 2) * SCALE}`)
  rect.setAttribute('fill', contribution.color)

  g.appendChild(rect)

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
  animateTransform.setAttribute('dur', `${trajectoryRes.stepCount * 8}ms`)
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

// 参考文字：用 SVG <text> 居中渲染，方便对比碰撞体轮廓是否对齐
const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
textEl.textContent = TEXT
textEl.setAttribute('x', `${(WIDTH / 2) * SCALE}`)
textEl.setAttribute('y', `${TEXT_TOP * SCALE}`)
textEl.setAttribute('font-size', `${FONT_SIZE}`)
textEl.setAttribute('font-family', 'ArialCustom, sans-serif')
textEl.setAttribute('text-anchor', 'middle')
textEl.setAttribute('dominant-baseline', 'hanging')
textEl.setAttribute('fill', 'black')
svg.appendChild(textEl)

const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
svg.appendChild(g)
g.style.transform = `scale(${SCALE}) translate(0, ${TEXT_TOP}px)`

trajectoryRes.textPaths.forEach(({ pathData, rect }) => {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', pathData)
  path.setAttribute('fill', 'black')
  g.appendChild(path)
})

svg.appendChild(g)

export {}
