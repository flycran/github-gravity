export const WIDTH = 200
export const HEIGHT = 100
export const SIZE = 2
export const SCALE = 6
export const INTERVAL = SIZE / 2
export const FONT_SIZE = 120
export const TEXT = 'Flycran'

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
  contributions: ContributionJson[]
  /** 用户名文字碰撞体的三角网格（世界坐标），用于 web 端渲染 */
  textTriangles: number[][]
}
