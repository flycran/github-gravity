export const WIDTH = 300
export const HEIGHT = 150
export const SCALE = 3
export const SIZE = 4
export const INTERVAL = 1.5
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

export interface Point {
  x: number
  y: number
  /**
   * 启用压缩时，该点与前一个保留点的原始索引差，用于还原关键帧的时间位置；
   * 未压缩时不存在，消费端回退到 SMIL 默认的均分时间
   */
  span?: number
}

export interface ContributionJson {
  date: string
  color: string
  trajectory: Point[]
}

export interface SimulationResult {
  stepCount: number
  time: number
  /** 贡献方块的形状：circle 或 square */
  shape: string
  textPaths: Pick<TextPathResult, 'rect' | 'pathData'>[]
  contributions: ContributionJson[]
  /** 用户名文字碰撞体的三角网格（世界坐标），用于 web 端渲染 */
  textTriangles: number[][]
  /** 文字在物理世界中的 X 偏移量 */
  offsetX: number
  /** 文字在物理世界中的 Y 偏移量 */
  centerY: number
  /** 一步的时间（ms） */
  stepTime: number
  /** 背景颜色 */
  backgroundColor: string
  /** 文字颜色 */
  textColor: string
  /** 物理世界宽度，渲染时换算成 SVG 宽度 */
  width: number
  /** 物理世界高度，同时用于坐标 Y 轴翻转 */
  height: number
  /** 贡献方块边长，决定渲染出的方块尺寸 */
  size: number
}
