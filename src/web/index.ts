import { HEIGHT, SCALE, SIZE, WIDTH } from '../utils'
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
  animateTransform.setAttribute('dur', `${trajectoryRes.stepCount * 16}ms`)
  animateTransform.setAttribute('fill', 'freeze')

  g.appendChild(animateTransform)
}

trajectoryRes.contributions.forEach(createContribution)

export {}
