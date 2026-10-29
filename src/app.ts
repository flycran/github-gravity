import { gensvg } from './gensvg'
import type { SimulationOptions } from './physics'
import { GITHUB_ID } from './utils'
import pageApp from './web/index.html'

/** 把 /svg 的查询参数解析为模拟选项，缺失或非法值回退到 startSimulation 的默认值 */
function parseOptions(url: URL): SimulationOptions {
  const params = url.searchParams
  const str = (key: string): string | undefined => {
    const raw = params.get(key)?.trim()
    return raw ? raw : undefined
  }
  const num = (key: string): number | undefined => {
    const raw = str(key)
    if (!raw) return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
  }
  return {
    username: str('username') ?? GITHUB_ID,
    text: str('text'),
    shape: params.get('shape') === 'square' ? 'square' : 'circle',
    backgroundColor: str('backgroundColor'),
    textColor: str('textColor'),
    stepTime: num('stepTime'),
    compressionTolerance: num('compressionTolerance'),
    compressionAlgorithm: ['DP', 'RDP', 'Greedy'].includes(
      params.get('compressionAlgorithm') ?? ''
    )
      ? (params.get('compressionAlgorithm') as 'DP' | 'RDP' | 'Greedy')
      : undefined,
    disableCompression: ['1', 'true'].includes(
      params.get('disableCompression') ?? ''
    ),
    fontSize: num('fontSize'),
    textTop: num('textTop')
  }
}

Bun.serve({
  port: 3000,
  development: {
    hmr: true,
    console: true
  },
  routes: {
    '/': pageApp,
    '/svg': async (req) => {
      try {
        const svg = await gensvg(parseOptions(new URL(req.url)))
        return new Response(svg, {
          headers: { 'Content-Type': 'image/svg+xml' }
        })
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 500 }
        )
      }
    }
  }
})

console.log('http://localhost:3000/')
