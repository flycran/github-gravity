export const WIDTH = 200
export const HEIGHT = 100
export const SIZE = 2
export const SCALE = 6
export const INTERVAL = SIZE / 2

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
}
