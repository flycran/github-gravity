/**
 * 预览服务：页面托管 + 产物数据 API，零构建。
 *
 * - 页面（pages/ 的 html 与 .ts）按原样伺服，.ts 用 Bun.Transpiler 现转，
 *   浏览器端 import 链原生解析，没有任何打包步骤
 * - SVG 文本经动态 import + import attributes 读取（路径是运行时变量，
 *   天然适配任意产物目录与多组合），经 /api/compare-data 一次性供页面加载
 * - 报告的生成函数由调用方注入（report.ts ↔ serve.ts 避免循环依赖）；
 *   独立报告数据走 /api/report-data，帧图片走 /frames 静态路由
 */

import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import open from 'open'
import type { ReportData } from './pages/reportView'

/** 组合级元数据：cli 生成 SVG 后写入 meta.json，serve/report 读取。
 * 不记录引擎——播放控制器由页面按产物 DOM 内容自行判定（buildClock） */
export interface ComboMeta {
  combo: string
  inputName: string
  refA: string
  commitA: string
  refB: string
  commitB: string
  via: 'src' | 'dist'
  durationA: number
  durationB: number
  bytesA: number
  bytesB: number
  elapsedMsA: number
  elapsedMsB: number
  createdAt: string
}

export interface ServeDeps {
  /** 被测仓库根（产物目录所在） */
  outRoot: string
  /** 列出产物目录下可用组合（无 combo 参数时取第一个） */
  listCombos(): string[]
  /** 生成组合报告并返回写盘后的数据；独立报告模式可为空 */
  runReport?(combo: string): Promise<ReportData>
}

const COMBO_PATTERN = /^[\w.-]+$/
const JS_MIME = 'text/javascript; charset=utf-8'

export interface ServeHandle {
  url: string
  stop(): void
}

export function startServe(toolRoot: string, deps: ServeDeps): ServeHandle {
  const pagesDir = join(toolRoot, 'pages')
  const transpiler = new Bun.Transpiler({ loader: 'ts' })

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const { pathname } = url
      try {
        return await route(request, pathname, url, {
          pagesDir,
          deps,
          transpiler
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[svg-compare serve] ${pathname}:`, message)
        return new Response(message, { status: 500 })
      }
    }
  })

  return {
    url: server.url.origin,
    stop: () => server.stop(true)
  }
}

async function route(
  request: Request,
  pathname: string,
  url: URL,
  ctx: {
    pagesDir: string
    deps: ServeDeps
    transpiler: Bun.Transpiler
  }
): Promise<Response> {
  if (pathname === '/' || pathname === '/index.html') {
    return Response.redirect(new URL('/previewPage.html', url).href, 302)
  }

  // API 路由优先于页面兜底（/api/* 不含点号，避免被无后缀页面匹配吞掉）
  if (pathname === '/api/compare-data') {
    return await compareData(ctx.deps, url.searchParams)
  }

  if (pathname === '/api/report-data') {
    return await reportData(ctx.deps.outRoot, url.searchParams)
  }

  if (pathname === '/api/report' && request.method === 'POST') {
    if (!ctx.deps.runReport) {
      return new Response('报告端点不可用（独立报告模式下未注入生成函数）', {
        status: 501
      })
    }
    const combo = resolveCombo(ctx.deps, url.searchParams)
    const data = await ctx.deps.runReport(combo)
    return Response.json(data)
  }

  // 帧截图（报告页/预览页内嵌 <img> 引用）
  const frames = /^\/frames\/([\w.-]+)\/([\w.-]+\.png)$/.exec(pathname)
  if (frames) {
    const [, combo, file] = frames
    return serveFile(join(ctx.deps.outRoot, combo, 'frames', file), 'image/png')
  }

  // 页面文件：html 原样，.ts 现转
  if (
    pathname.endsWith('.html') ||
    pathname.endsWith('.ts') ||
    !pathname.includes('.')
  ) {
    return await servePage(ctx.pagesDir, pathname, ctx.transpiler)
  }

  return new Response('not found', { status: 404 })
}

async function servePage(
  pagesDir: string,
  pathname: string,
  transpiler: Bun.Transpiler
): Promise<Response> {
  // 浏览器端模块 import 可能省略 .ts 后缀，对无后缀请求回退补全
  const candidates = pathname.endsWith('.ts')
    ? [pathname.slice(1)]
    : [pathname.slice(1), `${pathname.slice(1)}.ts`]
  for (const candidate of candidates) {
    const file = safeJoin(pagesDir, candidate)
    if (!file || !statSync(file, { throwIfNoEntry: false })) continue
    if (file.endsWith('.ts')) {
      const code = transpiler.transformSync(await Bun.file(file).text())
      return new Response(code, { headers: { 'content-type': JS_MIME } })
    }
    return new Response(await Bun.file(file).arrayBuffer(), {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  }
  return new Response('not found', { status: 404 })
}

async function serveFile(path: string, contentType: string): Promise<Response> {
  const file = Bun.file(path)
  if (!(await file.exists())) return new Response('not found', { status: 404 })
  return new Response(await file.arrayBuffer(), {
    headers: { 'content-type': contentType }
  })
}

/** 组合数据：SVG 文本 + 时长 + ref 信息，页面一次取全 */
async function compareData(
  deps: ServeDeps,
  params: URLSearchParams
): Promise<Response> {
  const combo = resolveCombo(deps, params)
  const dir = join(deps.outRoot, combo)
  const meta = (await Bun.file(join(dir, 'meta.json')).json()) as ComboMeta
  const [svgA, svgB] = await Promise.all([
    importText(join(dir, 'a.svg')),
    importText(join(dir, 'b.svg'))
  ])
  return Response.json({
    combo,
    /** 产物目录下全部可用组合，供页面切换 */
    combos: deps.listCombos(),
    inputName: meta.inputName,
    refA: refLabel(meta.refA, meta.commitA),
    refB: refLabel(meta.refB, meta.commitB),
    svgA,
    svgB,
    durationA: meta.durationA,
    durationB: meta.durationB
  })
}

async function reportData(
  outRoot: string,
  params: URLSearchParams
): Promise<Response> {
  const combo = params.get('combo') ?? ''
  if (!COMBO_PATTERN.test(combo)) {
    return new Response('缺少或非法的 combo 参数', { status: 400 })
  }
  return serveFile(join(outRoot, combo, 'report.json'), 'application/json')
}

function resolveCombo(deps: ServeDeps, params: URLSearchParams): string {
  const combo = params.get('combo') ?? ''
  if (combo !== '') {
    if (!COMBO_PATTERN.test(combo)) {
      throw new Error(`非法的 combo 参数：${combo}`)
    }
    return combo
  }
  const combos = deps.listCombos()
  if (combos.length === 0) throw new Error('产物目录中没有组合')
  return combos[0]
}

/** 动态 import + import attributes：bun 以 text loader 读任意路径的文本产物 */
async function importText(path: string): Promise<string> {
  const module = (await import(path, {
    with: { type: 'text' }
  })) as { default: string }
  return module.default
}

function refLabel(ref: string, commit: string): string {
  return `${ref} (${commit.slice(0, 7)})`
}

function safeJoin(root: string, relative: string): string | null {
  const resolved = resolve(join(root, relative))
  const base = resolve(root)
  return resolved.startsWith(`${base}/`) ? resolved : null
}

/** 用系统默认浏览器打开（open 包内置 WSL 的 cmd.exe start 处理），失败打印 URL 兜底 */
export async function openBrowser(url: string): Promise<void> {
  try {
    await open(url)
  } catch {
    console.log(`请手动打开预览页：${url}`)
  }
}

/** 列出产物根下的组合目录（按名字排序） */
export function listCombos(outRoot: string): string[] {
  try {
    return readdirSync(outRoot)
      .filter((name) =>
        statSync(join(outRoot, name), { throwIfNoEntry: false })?.isDirectory()
      )
      .sort()
  } catch {
    return []
  }
}
