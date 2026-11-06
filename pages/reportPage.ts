/** 独立报告页：读取已生成的报告数据并渲染（与预览页共用 reportView） */

import { type ReportData, renderReport } from './reportView.ts'

const container = document.getElementById('report') as HTMLDivElement
const errorBox = document.getElementById('error') as HTMLPreElement

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search)
  const combo = params.get('combo') ?? ''
  const query = combo === '' ? '' : `?combo=${encodeURIComponent(combo)}`
  const response = await fetch(`/api/report-data${query}`)
  if (!response.ok) {
    throw new Error(
      `报告不存在（${response.status}）：${await response.text()}。先用 --report 生成，或在预览页点击"生成一致性报告"`
    )
  }
  renderReport(container, (await response.json()) as ReportData)
}

main().catch((error: unknown) => {
  container.hidden = true
  errorBox.hidden = false
  errorBox.textContent = error instanceof Error ? error.message : String(error)
})
