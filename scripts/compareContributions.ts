/**
 * 对比两个贡献数据驱动的返回值是否严格相等。
 *
 * 需要 GITHUB_TOKEN 才能走官方 GraphQL 渠道：
 *   GITHUB_TOKEN=$(gh auth token) bun scripts/compareContributions.ts [username]
 *
 * 不做断言库封装：逐字段用 === 比较，便于在差异来自上游缓存时看出具体日期。
 */
import {
  fetchContributionsFromCalendar,
  fetchContributionsFromGraphql
} from '../src/utils/githubContributions'

const username = process.argv[2] ?? 'flycran'
const token = process.env.GITHUB_TOKEN?.trim()

if (!token) {
  console.error('GITHUB_TOKEN is required to compare both drivers')
  process.exit(1)
}

const [calendar, graphql] = await Promise.all([
  fetchContributionsFromCalendar(username),
  fetchContributionsFromGraphql(username, token)
])

const differences: string[] = []

if (calendar.total !== graphql.total) {
  differences.push(`total: ${calendar.total} !== ${graphql.total}`)
}

if (calendar.contributions.length !== graphql.contributions.length) {
  differences.push(
    `weeks: ${calendar.contributions.length} !== ${graphql.contributions.length}`
  )
}

const weekCount = Math.min(
  calendar.contributions.length,
  graphql.contributions.length
)

for (let week = 0; week < weekCount; week++) {
  const left = calendar.contributions[week]
  const right = graphql.contributions[week]

  if (left.length !== right.length) {
    differences.push(`week ${week} days: ${left.length} !== ${right.length}`)
    continue
  }

  for (let day = 0; day < left.length; day++) {
    const a = left[day]
    const b = right[day]

    if (a.date !== b.date) {
      differences.push(`week ${week} day ${day} date: ${a.date} !== ${b.date}`)
    }

    if (a.intensity !== b.intensity) {
      differences.push(`${a.date} intensity: ${a.intensity} !== ${b.intensity}`)
    }

    if (a.count !== b.count) {
      differences.push(`${a.date} count: ${a.count} !== ${b.count}`)
    }
  }
}

const calendarDays = calendar.contributions.flat().length
const graphqlDays = graphql.contributions.flat().length

console.log(`total: ${calendar.total} / ${graphql.total}`)
console.log(
  `weeks: ${calendar.contributions.length} / ${graphql.contributions.length}`
)
console.log(`days: ${calendarDays} / ${graphqlDays}`)

if (differences.length) {
  console.error(`\nnot equal: ${differences.length} difference(s)`)
  for (const difference of differences.slice(0, 20)) {
    console.error(`- ${difference}`)
  }
  process.exit(1)
}

console.log('\nstrictly equal')
