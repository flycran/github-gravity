import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import earcut from 'earcut'
import * as opentype from 'opentype.js'
import { pointsOnPath } from 'points-on-path'
import { SCALE, TextPathResult } from '../utils'

function svgPathToRapierTrimesh(path: string, scale = 1, tolerance = 1) {
  const subPaths = pointsOnPath(path, tolerance)
  const points = subPaths.flat()

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
  readFileSync(
    fileURLToPath(
      new URL('../assets/LiberationSerif-Bold.ttf', import.meta.url)
    )
  ).buffer as ArrayBuffer
)

export function getTextPaths(text: string, fontSize: number): TextPathResult[] {
  const paths = font.getPaths(text, 0, 0, fontSize / SCALE)

  return paths.map((path) => {
    const bbox = path.getBoundingBox()
    const pathData = path.toPathData(2)
    return {
      paths: svgPathToRapierTrimesh(pathData),
      pathData: pathData,
      rect: {
        x: bbox.x1,
        y: bbox.y1,
        width: bbox.x2 - bbox.x1,
        height: bbox.y2 - bbox.y1
      }
    }
  })
}
