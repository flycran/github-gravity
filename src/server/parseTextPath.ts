import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import earcut from 'earcut'
import * as opentype from 'opentype.js'
import { pointsOnPath } from 'points-on-path'
import { SCALE, TextPathResult } from '../utils'

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

// 字体文件路径：优先使用环境变量，否则使用默认路径
const FONT_PATH =
  process.env.GRAVITY_FONT_PATH ||
  fileURLToPath(new URL('../assets/ARIAL.ttf', import.meta.url))

const font = opentype.parse(readFileSync(FONT_PATH).buffer as ArrayBuffer)

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
