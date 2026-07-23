export const WIDTH = 300
export const HEIGHT = 150
export const SCALE = 3
export const SIZE = 4
export const INTERVAL = 1.5
export const FONT_SIZE = 80
export const TEXT_TOP = 50
export const GITHUB_ID = 'Orta'
export const TEXT = 'Orta Therox'

export interface TextPathResult {
  paths: {
    vertices: Float32Array
    indices: Uint32Array
  }
  pathData: string
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface ContributionJson {
  date: string
  color: string
  trajectory: {
    x: number
    y: number
  }[]
}

export interface SimulationResult {
  stepCount: number
  time: number
  textPaths: Pick<TextPathResult, 'rect' | 'pathData'>[]
  contributions: ContributionJson[]
  /** 用户名文字碰撞体的三角网格（世界坐标），用于 web 端渲染 */
  textTriangles: number[][]
  /** 文字在物理世界中的 X 偏移量 */
  offsetX: number
  /** 文字在物理世界中的 Y 偏移量 */
  centerY: number
}
