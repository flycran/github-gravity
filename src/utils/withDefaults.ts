/**
 * 合并默认值与用户选项，跳过值为 undefined 的属性。
 * Object.assign / spread 会用 undefined 覆盖已有值，调用端"未填写"的字段
 * 会抹掉默认值；这里保证键携带 undefined 与键不存在等效，调用端无需逐字段过滤
 */
export function withDefaults<T extends object, U extends object>(
  defaults: T,
  overrides: U | undefined
): T & U {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value !== undefined) filtered[key] = value
  }
  // Object.entries 把键弱化成 string，类型系统无法跟踪过滤结果的具体形状
  return Object.assign({ ...defaults }, filtered) as T & U
}
