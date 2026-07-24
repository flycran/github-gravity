/**
 * 通过 gh-calendar API 获取 GitHub 用户贡献图数据。
 *
 * API: https://gh-calendar.rschristian.dev/user/{username}
 * 返回按周分组的贡献数据，支持 ?limit=N 参数限制返回周数。
 */

/** 单日贡献数据（API 原始格式） */
export interface RawContributionDay {
  date: string
  intensity: number
  count: number
}

/** gh-calendar API 响应格式 */
export interface CalendarResponse {
  total: number
  contributions: RawContributionDay[][]
}

/** 贡献颜色分级 */
export const INTENSITY_COLORS = [
  '#ebedf0',
  '#9be9a8',
  '#40c463',
  '#30a14e',
  '#216e39'
]

/**
 * 根据 GitHub 用户名获取贡献图数据。
 *
 * @param username - GitHub 用户名
 * @param limit - 限制返回的周数，不传则返回所有可用数据
 * @returns 贡献图数据，包含每日贡献次数和等级
 * @throws 如果请求失败或用户名不存在
 */
export async function fetchContributions(username: string, limit?: number) {
  const params = limit ? `?limit=${limit}` : ''
  const url = `https://gh-calendar.rschristian.dev/user/${username}${params}`

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch contributions for "${username}": ${response.status} ${response.statusText}`
    )
  }

  const data: CalendarResponse = await response.json()

  return data
}
