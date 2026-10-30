import { GensvgOptions } from './utils/gensvg'

export const SCALE = 1

/** 固定物理步长（秒） */
export const TIMESTEP = 1 / 30

/** 速度小于此阈值视为静止 */
export const VELOCITY_THRESHOLD = 1e-3

/** 模拟最大步数，超出视为无法收敛，直接抛错终止模拟 */
export const MAX_STEPS = 36000

// 先取值再构造 URL，避免打包器把「new URL(字面量, import.meta.url)」识别为资源声明
// 而重排内置字体的输出位置
const BUNDLED_FONT_HREF = '../public/LiberationSerif-Bold.ttf'

/** 内置字体：轮廓闭合规整，能稳定三角化 */
export const DEFAULT_FONT = new URL(BUNDLED_FONT_HREF, import.meta.url)

export const DEFAULT_OPTIONS: Required<
  Omit<GensvgOptions, 'username' | 'text'>
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
  compressionAlgorithm: 'Greedy',
  disableCompression: false,
  compressionTolerance: 0.5,
  font: DEFAULT_FONT,
  interval: 1.5
}
