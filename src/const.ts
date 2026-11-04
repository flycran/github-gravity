import { GensvgOptions } from './utils/gensvg'

export const SCALE = 1

/** 固定物理步长（秒） */
export const TIMESTEP = 1 / 30

/** 重力倍数 */
export const GRAVITY = 1.5

/** 速度小于此阈值视为静止 */
export const VELOCITY_THRESHOLD = 0.1

/** 连续静止帧数达到该值才判定全部静止（约 0.5 秒）；确认期记录的帧在返回前截掉 */
export const SETTLE_CONFIRM_FRAMES = 15

/** 未设置最大模拟时间时的模拟步数上限，超出视为无法收敛，直接抛错终止模拟 */
export const MAX_STEPS = 9000

const BUNDLED_FONT_HREF = '../public/LiberationSerif-Bold.ttf'

/** 内置字体 */
export const DEFAULT_FONT = new URL(BUNDLED_FONT_HREF, import.meta.url)

export const DEFAULT_OPTIONS: Required<
  Omit<
    GensvgOptions,
    'username' | 'text' | 'maxSimulationTime' | 'jointPosition'
  >
> = {
  width: 300,
  height: 150,
  shape: 'circle',
  speed: 3,
  scale: 3,
  size: 4,
  textTop: 50,
  fontSize: 48,
  backgroundColor: 'transparent',
  textColor: 'black',
  css: false,
  animation: 'var(--n) var(--dur) linear both',
  compressionAlgorithm: 'Greedy',
  disableCompression: false,
  compressionTolerance: 0.5,
  font: DEFAULT_FONT,
  interval: 1.5,
  friction: 0.3,
  restitution: 0
}
