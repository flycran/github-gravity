/**
 * fetchContributions 失败时错误沿管道向上传播，且错误信息可读。
 *
 * 独立于 integration.test.ts：错误路径无法经 calendarList 注入，
 * 是整个测试套件中唯一需要 mock 贡献模块的地方。
 */
import { describe, expect, it, mock } from 'bun:test'

const mockFetchContributions = mock(async () => {
  throw new Error(
    'Failed to fetch contributions for "nonexistent": 404 Not Found'
  )
})
mock.module('../src/utils/githubContributions.ts', () => ({
  fetchContributions: mockFetchContributions,
  INTENSITY_COLORS: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39']
}))

const { gensvg } = await import('../src/utils/gensvg.js')

describe('fetchContributions error propagation', () => {
  it('propagates the API error with a readable message', async () => {
    await expect(
      gensvg({ username: 'nonexistent', text: 'Test' })
    ).rejects.toThrow('Failed to fetch contributions')
  })
})
