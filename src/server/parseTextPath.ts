import earcut from 'earcut'
import opentype from 'opentype.js'
import { pointsOnPath } from 'points-on-path'
import { FONT_SIZE, SCALE } from '../utils'

function svgPathToRapierTrimesh(path: string, scale = 1, tolerance = 1) {
  // pointsOnPath returns Point[][] — one array per sub-path, flatten them
  const subPaths = pointsOnPath(path, tolerance)
  const points = subPaths.flat()

  // Point is [number, number], scale each coordinate
  const vertices = points.map(
    ([x, y]) => [x * scale, y * scale] as [number, number]
  )

  const flatVertices = vertices.flat()

  const indices = earcut(flatVertices)

  return {
    vertices: new Float32Array(flatVertices),
    indices: new Uint32Array(indices)
  }
}

const font = opentype.parse(
  await Bun.file('src/assets/ARIAL.ttf').arrayBuffer()
)

export interface TextPathResult {
  paths: {
    vertices: Float32Array
    indices: Uint32Array
  }
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
}

export function getTextPaths(text: string): TextPathResult[] {
  const paths = font.getPaths(text, 0, 0, FONT_SIZE / SCALE)

  return paths.map((path) => {
    const bbox = path.getBoundingBox()
    return {
      paths: svgPathToRapierTrimesh(path.toPathData(2)),
      rect: {
        x: bbox.x1,
        y: bbox.y1,
        width: bbox.x2 - bbox.x1,
        height: bbox.y2 - bbox.y1
      }
    }
  })
}
