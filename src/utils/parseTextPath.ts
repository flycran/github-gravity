import * as opentype from 'opentype.js'
import { pointsOnPath } from 'points-on-path'
import type { Point, Polygon } from 'poly-decomp-es'
import {
  makeCCW,
  quickDecomp,
  removeCollinearPoints,
  removeDuplicatePoints
} from 'poly-decomp-es'
import { SCALE } from '../const'
import type { TextPathResult } from './physics'

/**
 * 把 SVG path 的每个子轮廓独立凹分解为凸多边形集合（顶点已按 scale 缩放）。
 * 子轮廓之间互相独立处理：孔洞轮廓同样参与分解，即孔洞区域被视为实心
 */
function svgPathToConvexPolygons(
  path: string,
  scale = 1,
  tolerance = 1
): Polygon[] {
  const subPaths = pointsOnPath(path, tolerance)

  const polygons: Polygon[] = []
  for (const subPath of subPaths) {
    // 采样点可能含重复点与共线点，会让分解产生退化凸块，先清理
    const polygon: Point[] = subPath.map(
      ([x, y]) => [x * scale, y * scale] as Point
    )
    removeDuplicatePoints(polygon, 0.01)
    removeCollinearPoints(polygon, 0.01)
    // 清理后不足 3 点的轮廓构不成多边形
    if (polygon.length < 3) continue
    makeCCW(polygon)
    polygons.push(...quickDecomp(polygon))
  }
  return polygons
}

/**
 * 把 opentype 路径序列化为 SVG path data（保留 2 位小数）。
 *
 * 不用 Path#toPathData：它以原始值的正负决定是否补数字间的空格，而坐标四舍五入到
 * -0 时负号会被丢掉，导致相邻数字粘连成畸形数据（opentypejs/opentype.js#881）。
 * 这里改为按序列化结果是否以负号开头来补空格。
 */
export function serializePathData(path: opentype.Path): string {
  // Number.isInteger 同时覆盖 round 到 0 与 -0 的情况：String(-0) 为 "0"，负号省略
  const fmt = (v: number): string => {
    const rounded = Math.round(v * 100) / 100
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
  }
  const pack = (values: number[]): string => {
    let s = ''
    values.forEach((v, i) => {
      const str = fmt(v)
      // 负数靠负号与前面的数字分隔，其余情况必须补空格
      if (i > 0 && str[0] !== '-') s += ' '
      s += str
    })
    return s
  }

  let d = ''
  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
      case 'L':
        d += `${cmd.type}${pack([cmd.x, cmd.y])}`
        break
      case 'C':
        d += `C${pack([cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y])}`
        break
      case 'Q':
        d += `Q${pack([cmd.x1, cmd.y1, cmd.x, cmd.y])}`
        break
      case 'Z':
        d += 'Z'
        break
    }
  }
  return d
}

/** 字体数据来源：本地路径、远程 URL（字符串或 URL 对象），或已读取好的字体数据 */
export type FontSource = string | URL | Buffer | ArrayBuffer

/** Buffer / Uint8Array 可能是共享 ArrayBuffer 的一段视图，必须按实际偏移截取副本 */
function viewToArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength
  ) as ArrayBuffer
}

/** 从本地路径读取字体文件（相对路径按当前工作目录解析） */
export async function loadFontFromPath(fontPath: string): Promise<ArrayBuffer> {
  // node 模块按需加载：只有真正读取本地文件时才需要，浏览器环境不会引入它们
  const [{ readFileSync }, { resolve }] = await Promise.all([
    import('node:fs'),
    import('node:path')
  ])
  // 相对路径按当前工作目录解析：模块自身路径在打包后会被压平，不能作为参照基准
  const resolvedPath = resolve(fontPath)

  try {
    return viewToArrayBuffer(readFileSync(resolvedPath))
  } catch (error) {
    // 带上底层原因：读取失败可能是文件不存在，解析失败可能是不支持的文件格式
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to load font "${resolvedPath}" (only .ttf/.otf are supported): ${reason}`,
      { cause: error }
    )
  }
}

/** 从 URL 下载字体文件，支持 file: 与 http(s): 协议 */
export async function loadFontFromUrl(
  fontUrl: string | URL
): Promise<ArrayBuffer> {
  let url: URL
  try {
    url = new URL(fontUrl)
  } catch (error) {
    throw new Error(`Invalid font URL: ${fontUrl}`, { cause: error })
  }

  // Node 的 fetch 不支持 file: 协议，本地文件改用 fs 读取；浏览器走标准 fetch
  if (url.protocol === 'file:') {
    const { fileURLToPath } = await import('node:url')
    return loadFontFromPath(fileURLToPath(url))
  }

  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to load font from "${url.href}": ${reason}`, {
      cause: error
    })
  }
  if (!response.ok) {
    throw new Error(
      `Failed to load font from "${url.href}": ${response.status} ${response.statusText}`
    )
  }
  return response.arrayBuffer()
}

/** 把用户传入的字体来源归一化为 opentype.js 可解析的 ArrayBuffer */
async function resolveFontData(font: FontSource): Promise<ArrayBuffer> {
  if (font instanceof ArrayBuffer) return font
  // isView 同时覆盖 Buffer（Node）与 Uint8Array（浏览器），保持对运行环境无假设
  if (ArrayBuffer.isView(font)) return viewToArrayBuffer(font)
  // http(s) 开头的字符串视为远程 URL，其余字符串视为本地路径
  if (font instanceof URL || /^https?:\/\//i.test(font)) {
    return loadFontFromUrl(font)
  }
  return loadFontFromPath(font)
}

/**
 * 解析文字为可渲染的轮廓路径，同时产出 SVG 用的 pathData 与物理用的凸多边形网格。
 *
 * @param font 字体来源（.ttf/.otf）：本地路径、URL、URL 字符串，或
 * Buffer / ArrayBuffer（如 `files[0].arrayBuffer()` 的结果）；省略时用内置字体
 */
export async function getTextPaths(
  text: string,
  fontSize: number,
  font: FontSource
): Promise<TextPathResult[]> {
  // 加载失败的原样冒泡：loadFontFromPath / loadFontFromUrl 已给出带来源的消息
  const fontData = await resolveFontData(font)

  let opentypeFont: opentype.Font
  try {
    opentypeFont = opentype.parse(fontData)
  } catch (error) {
    // 带上底层原因：解析失败可能是不支持的文件格式，也可能是 opentype.js 无法处理该字体的 GSUB 表
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to load font "${describeFont(font)}" (only .ttf/.otf are supported): ${reason}`,
      { cause: error }
    )
  }

  // opentype.js 的表结构是懒解析的，GSUB 等高级表的问题要等到取字形时才暴露
  let paths: opentype.Path[]
  try {
    paths = opentypeFont.getPaths(text, 0, 0, fontSize / SCALE)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Failed to read glyphs from font "${describeFont(font)}": ${reason}`,
      { cause: error }
    )
  }

  return paths.map((path) => {
    const bbox = path.getBoundingBox()
    const pathData = serializePathData(path)

    let decomposed: Polygon[]
    try {
      decomposed = svgPathToConvexPolygons(pathData)
    } catch (error) {
      // 防御性包装：上游分解几乎不抛错，抛出时也带上字体来源便于定位
      throw new Error(
        `Failed to decompose a glyph from font "${describeFont(font)}"`,
        { cause: error }
      )
    }

    return {
      paths: { polygons: decomposed },
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

/** 生成字体来源的展示名：URL 用 href，路径与二进制数据截取开头 */
function describeFont(font: FontSource): string {
  if (font instanceof URL) return font.href
  if (typeof font === 'string') return font
  return 'custom font data'
}
