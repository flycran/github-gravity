/**
 * 获取 GitHub 用户贡献图数据。
 *
 * 两个驱动返回完全相同的结构：
 * - GraphQL：GitHub 官方 contributionsCollection，需要 token；
 * - gh-calendar：第三方公共 API，无需认证，作为兜底。
 *
 * 官方日历最多覆盖最近一年，两个驱动都按同一窗口返回并按周（周日→周六）
 * 分组，保证结果可以直接比较。
 */

/** 单日贡献数据（统一格式） */
export interface RawContributionDay {
  date: string
  intensity: number
  count: number
}

/** 按周分组的贡献图数据 */
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

export interface FetchContributionsOptions {
  /**
   * GraphQL 渠道使用的 token，默认取 GITHUB_TOKEN 环境变量。
   * 未提供时回落到无需认证的 gh-calendar 渠道。
   */
  token?: string
  /** 限制返回的周数，不传则返回整个窗口 */
  limit?: number
}

const GRAPHQL_ENDPOINT = 'https://api.github.com/graphql'
const CALENDAR_ENDPOINT = 'https://gh-calendar.rschristian.dev/user'

const CONTRIBUTION_QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }
}`

const LEVEL_TO_INTENSITY: Record<string, number> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4
}

interface GraphqlContributionDay {
  date: string
  contributionCount: number
  contributionLevel: string
}

interface GraphqlResponse {
  data?: {
    user?: {
      contributionsCollection?: {
        contributionCalendar: {
          totalContributions: number
          weeks: { contributionDays: GraphqlContributionDay[] }[]
        }
      }
    }
  }
  errors?: { message: string }[]
}

/** 官方贡献日历的窗口上限为一年，两个驱动共用同一窗口 */
function contributionWindow(now = new Date()) {
  const to = new Date(now)
  const from = new Date(now)
  from.setUTCFullYear(from.getUTCFullYear() - 1)
  return { from, to }
}

/** 只保留窗口内的日期；gh-calendar 会把首周补满到周日 */
function clipToWindow(
  contributions: RawContributionDay[][],
  from: string,
  to: string
) {
  return contributions
    .map((week) => week.filter((day) => day.date >= from && day.date <= to))
    .filter((week) => week.length > 0)
}

/** 按周数截断，保留最近的 N 周 */
function limitWeeks(contributions: RawContributionDay[][], limit?: number) {
  return limit ? contributions.slice(-limit) : contributions
}

/**
 * 通过 GitHub GraphQL 官方接口获取贡献图数据。
 *
 * @param username - GitHub 用户名
 * @param token - 具备读取公开用户数据的 GitHub token
 * @param limit - 限制返回的周数
 * @throws 请求失败、GraphQL 返回 errors 或用户不存在
 */
export async function fetchContributionsFromGraphql(
  username: string,
  token: string,
  limit?: number
): Promise<CalendarResponse> {
  const { from, to } = contributionWindow()

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: CONTRIBUTION_QUERY,
      variables: {
        login: username,
        from: from.toISOString(),
        to: to.toISOString()
      }
    })
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch contributions for "${username}": ${response.status} ${response.statusText}`
    )
  }

  const payload: GraphqlResponse = await response.json()

  // GraphQL 的失败通常是 200 加 errors 数组，不能只看 HTTP 状态
  if (payload.errors?.length) {
    throw new Error(
      `Failed to fetch contributions for "${username}": ${payload.errors
        .map((error) => error.message)
        .join('; ')}`
    )
  }

  const calendar =
    payload.data?.user?.contributionsCollection?.contributionCalendar

  if (!calendar) {
    throw new Error(
      `Failed to fetch contributions for "${username}": user not found`
    )
  }

  const contributions = calendar.weeks.map((week) =>
    week.contributionDays.map((day) => ({
      date: day.date,
      intensity: LEVEL_TO_INTENSITY[day.contributionLevel] ?? 0,
      count: day.contributionCount
    }))
  )

  return {
    total: calendar.totalContributions,
    contributions: limitWeeks(contributions, limit)
  }
}

/**
 * 通过无需认证的 gh-calendar API 获取贡献图数据。
 *
 * @param username - GitHub 用户名
 * @param limit - 限制返回的周数
 * @throws 如果请求失败或用户名不存在
 */
export async function fetchContributionsFromCalendar(
  username: string,
  limit?: number
): Promise<CalendarResponse> {
  const url = `${CALENDAR_ENDPOINT}/${username}`

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch contributions for "${username}": ${response.status} ${response.statusText}`
    )
  }

  const data: CalendarResponse = await response.json()
  const { from, to } = contributionWindow()
  const contributions = clipToWindow(
    data.contributions.map((week) =>
      week.map((day) => ({
        date: day.date,
        intensity: Number(day.intensity),
        count: Number(day.count)
      }))
    ),
    from.toISOString().slice(0, 10),
    to.toISOString().slice(0, 10)
  )

  return {
    // 首周可能被裁掉几天，total 按窗口内数据重新累计
    total: contributions.flat().reduce((sum, day) => sum + day.count, 0),
    contributions: limitWeeks(contributions, limit)
  }
}

/**
 * 根据是否提供 token 选择驱动：有 token 时优先官方 GraphQL，
 * 否则回落到无需认证的 gh-calendar。
 */
export async function fetchContributions(
  username: string,
  options: FetchContributionsOptions = {}
): Promise<CalendarResponse> {
  const token = options.token?.trim() || process.env.GITHUB_TOKEN?.trim()

  if (token) {
    return fetchContributionsFromGraphql(username, token, options.limit)
  }

  return fetchContributionsFromCalendar(username, options.limit)
}
