/**
 * SVG 分支视觉对比工具入口（bun cli.ts <refA> <refB>）。
 *
 * 与 gensvg 项目完全解耦：工具自身不 import 被测代码，对比时把生成驱动
 * 注入 `git archive` 导出的临时目录，运行该 ref 自己的实现；
 * 产物（SVG/meta/报告）落在被测仓库的 .svg-compare/ 下并自带忽略文件。
 *
 * 三种调用方式：
 * - CI：--ci 无头跑报告，按三维度判定设退出码
 * - 手动预览：默认模式，起 serve 并打开浏览器，页内可触发生成报告
 * - 手动 CLI：--report --no-open 本地跑完输出报告文件
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Command } from 'commander'
import { exportRef, resolveRef, runDriver } from './checkout'
import {
  aggregateVerdicts,
  type ComboResult,
  DEFAULT_THRESHOLDS,
  dimensionLabel,
  type Thresholds
} from './consistency'
import {
  DRIVER_FILE,
  INPUT_FILE,
  renderDriverDist,
  renderDriverSrc,
  type ViaMode
} from './drivers'
import { type CompareInput, loadInputs } from './input'
import { runReport } from './report'
import { type ComboMeta, listCombos, openBrowser, startServe } from './serve'
import { parseSvgMeta } from './svgMeta'

const TOOL_ROOT = import.meta.dir
const DEFAULT_OUT_DIR = '.svg-compare'

/** 字段名与 commander 由 flag 名生成的属性一一对应（--input → input） */
interface CliOptions {
  input: string
  inputA?: string
  inputB?: string
  via: ViaMode
  engine?: 'smil' | 'css'
  frames: number
  out: string
  report: boolean
  open: boolean
  ci: boolean
  keep: boolean
  maxDurationDelta: number
  maxAvgDiff: number
  maxMaxDiff: number
  pixelThreshold: number
}

/** 一轮对比的完整配置：A/B 侧可以各用各的输入（如 SMIL vs CSS） */
interface ComboPlan {
  name: string
  inputA: CompareInput
  inputB: CompareInput
}

/** 阈值在 CLI 层平铺，报告侧收敛为三维度结构 */
function thresholdsOf(options: CliOptions): Thresholds {
  return {
    maxDurationDelta: options.maxDurationDelta,
    maxAvgDiff: options.maxAvgDiff,
    maxMaxDiff: options.maxMaxDiff
  }
}

const program = new Command()

program
  .name('svg-compare')
  .description(
    '任意两个 ref（分支/tag/commit）在同一份输入下生成动画 SVG，' +
      '预览页同步播放对比，并输出像素级一致性报告'
  )
  .argument('<refA>', '对比侧 A：分支 / tag / commit')
  .argument('<refB>', '对比侧 B：分支 / tag / commit')
  .option(
    '--input <path>',
    '共用对比输入 JSON 文件或目录（目录下全部 .json 视为多组合）',
    join(TOOL_ROOT, 'fixtures')
  )
  .option(
    '--input-a <path>',
    'A 侧专用输入 JSON（如 SMIL 引擎参数），覆盖 --input；单文件'
  )
  .option(
    '--input-b <path>',
    'B 侧专用输入 JSON（如 CSS 引擎参数），覆盖 --input；单文件'
  )
  .option('--via <mode>', '生成模式：src 源码直连 / dist 生产 bundle', 'src')
  .option('--engine <engine>', '覆盖输入中的动画引擎开关（smil|css）')
  .option(
    '--frames <n>',
    '报告采样帧数',
    (value: string) => parseNumber(value, '--frames'),
    12
  )
  .option('--out <dir>', '产物根目录（相对被测仓库）', DEFAULT_OUT_DIR)
  .option('--report', '生成后自动跑一致性报告', false)
  .option('--no-open', '不打开浏览器（无 --report 时 = 纯生成）')
  .option('--ci', 'CI 门禁模式：无头报告 + summary + 按判定设退出码', false)
  .option(
    '--pixel-threshold <n>',
    'pixelmatch YIQ 感知容差（0 严格 - 1 宽松）',
    (value: string) => parseNumber(value, '--pixel-threshold'),
    0.1
  )
  .option(
    '--max-duration-delta <n>',
    '时长偏差阈值',
    (value: string) => parseNumber(value, '--max-duration-delta'),
    DEFAULT_THRESHOLDS.maxDurationDelta
  )
  .option(
    '--max-avg-diff <n>',
    '平均差异阈值',
    (value: string) => parseNumber(value, '--max-avg-diff'),
    DEFAULT_THRESHOLDS.maxAvgDiff
  )
  .option(
    '--max-max-diff <n>',
    '最大差异阈值',
    (value: string) => parseNumber(value, '--max-max-diff'),
    DEFAULT_THRESHOLDS.maxMaxDiff
  )
  .option('--keep', '保留临时导出目录（调试用）', false)

function parseNumber(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} 需要非负数字，收到 "${value}"`)
  }
  return parsed
}

async function main(
  refA: string,
  refB: string,
  options: CliOptions
): Promise<void> {
  if (options.via !== 'src' && options.via !== 'dist') {
    throw new Error(`--via 只支持 src|dist，收到 "${options.via}"`)
  }
  if (
    options.engine !== undefined &&
    options.engine !== 'smil' &&
    options.engine !== 'css'
  ) {
    throw new Error(`--engine 只支持 smil|css，收到 "${options.engine}"`)
  }
  const repoRoot = process.cwd()
  if (
    statSync(join(repoRoot, '.git'), { throwIfNoEntry: false }) === undefined
  ) {
    throw new Error(
      `当前目录不是 git 仓库：${repoRoot}（请在被测仓库根目录运行）`
    )
  }

  // --input-a/--input-b 指定后进入单组合模式：两侧各用各的输入（对比引擎/算法差异）；
  // 未指定的一侧回退到 --input 的第一个组合
  let plans: ComboPlan[]
  if (options.inputA !== undefined || options.inputB !== undefined) {
    const shared = loadInputs(options.input)[0]
    const inputA = options.inputA ? loadInputs(options.inputA)[0] : shared
    const inputB = options.inputB ? loadInputs(options.inputB)[0] : shared
    const name =
      inputA.name === inputB.name
        ? inputA.name
        : `${inputA.name}__${inputB.name}`
    plans = [{ name, inputA, inputB }]
  } else {
    plans = loadInputs(options.input).map((input) => ({
      name: input.name,
      inputA: input,
      inputB: input
    }))
  }

  const outRoot = join(repoRoot, options.out)
  mkdirSync(outRoot, { recursive: true })
  // 产物目录自带忽略文件，不污染被测仓库的 git status（工具分支与主仓库解耦，不改其 .gitignore）
  writeFileSync(join(outRoot, '.gitignore'), '*\n', 'utf-8')

  const commitA = await resolveRef(repoRoot, refA)
  const commitB = await resolveRef(repoRoot, refB)
  console.log(
    `对比 ${refA} (${commitA.slice(0, 7)}) ↔ ${refB} (${commitB.slice(0, 7)})，via ${options.via}` +
      (options.inputA !== undefined || options.inputB !== undefined
        ? `，输入 ${inputLabel(plans[0].inputA)} ↔ ${inputLabel(plans[0].inputB)}`
        : '')
  )

  const combos: string[] = []
  for (const plan of plans) {
    combos.push(plan.name)
    console.log(`\n[${plan.name}] 生成中…`)
    await generateCombo(
      repoRoot,
      outRoot,
      refA,
      refB,
      options,
      commitA,
      commitB,
      plan
    )
  }

  if (!options.report) {
    // --no-open 保留 serve（不自动开浏览器），产物生成后可随时手动打开预览
    await previewServe(
      options,
      outRoot,
      combos[0],
      '/previewPage.html',
      options.open
    )
    return
  }

  const results: ComboResult[] = []
  for (const combo of combos) {
    console.log(`\n[${combo}] 报告生成中…`)
    const report = await runReport({
      outRoot,
      toolRoot: TOOL_ROOT,
      combo,
      frames: options.frames,
      pixelThreshold: options.pixelThreshold,
      thresholds: thresholdsOf(options)
    })
    results.push({ name: combo, verdict: report.verdict })
    console.log(`  报告：${join(outRoot, combo, 'report.json')}`)
  }

  const aggregated = aggregateVerdicts(results)
  writeSummary(
    outRoot,
    options,
    refA,
    refB,
    commitA,
    commitB,
    results,
    aggregated
  )
  printVerdict(results, aggregated)

  // 判定失败 → 非零退出码：--ci 供门禁阻止合并，--report 供脚本按码分支
  if (!aggregated.pass) process.exitCode = 1
  if (options.ci || !options.open) return
  await previewServe(options, outRoot, combos[0], '/reportPage.html')
}

/** 导出两个 ref 并各自跑生成驱动，落 a.svg/b.svg/meta.json；同 commit 复用同一份导出 */
async function generateCombo(
  repoRoot: string,
  outRoot: string,
  refA: string,
  refB: string,
  options: CliOptions,
  commitA: string,
  commitB: string,
  plan: ComboPlan
): Promise<void> {
  const comboDir = join(outRoot, plan.name)
  rmSync(comboDir, { recursive: true, force: true })
  mkdirSync(comboDir, { recursive: true })

  const driverSource =
    options.via === 'dist' ? renderDriverDist() : renderDriverSrc()

  const sameCommit = commitA === commitB
  let sharedExportDir: string | null = null
  const sides: {
    side: 'a' | 'b'
    commit: string
    ref: string
    input: CompareInput
  }[] = [
    { side: 'a', commit: commitA, ref: refA, input: plan.inputA },
    { side: 'b', commit: commitB, ref: refB, input: plan.inputB }
  ]
  const meta: ComboMeta = {
    combo: plan.name,
    inputName: plan.name,
    refA,
    commitA,
    refB,
    commitB,
    via: options.via,
    durationA: 0,
    durationB: 0,
    bytesA: 0,
    bytesB: 0,
    elapsedMsA: 0,
    elapsedMsB: 0,
    createdAt: new Date().toISOString()
  }

  for (const side of sides) {
    // 同 commit 时复用导出与依赖（典型场景：同 ref 对比 SMIL vs CSS）
    let exportDir: string
    let reused = false
    if (sameCommit && sharedExportDir !== null) {
      exportDir = sharedExportDir
      reused = true
    } else {
      exportDir = join(
        mkdtempSync(join(tmpdir(), `svg-compare-${side.side}-`)),
        'src'
      )
      mkdirSync(exportDir, { recursive: true })
      await exportRef(repoRoot, side.ref, side.commit, exportDir)
      if (sameCommit) sharedExportDir = exportDir
    }
    try {
      if (!reused) {
        writeFileSync(join(exportDir, DRIVER_FILE), driverSource, 'utf-8')
      }
      // 两种模式注入的都是原始选项 JSON：src 模式直通 gensvg；
      // dist 模式由 driver 自行映射 INPUT_* 环境变量并拦截贡献数据请求
      const injectedInput = applyEngineOverride(
        side.input.options,
        options.engine
      )
      writeFileSync(
        join(exportDir, INPUT_FILE),
        JSON.stringify(injectedInput),
        'utf-8'
      )
      const svgPath = join(comboDir, `${side.side}.svg`)
      const generated = await runDriver(exportDir, DRIVER_FILE, svgPath)
      const parsed = parseSvgMeta(await Bun.file(svgPath).text())
      // 引擎不写入 meta：播放控制器由页面按产物 DOM 自行判定，
      // 这里的判定只用于日志展示与选择 dur 的解析来源
      if (side.side === 'a') {
        meta.durationA = parsed.durationMs
        meta.bytesA = generated.bytes
        meta.elapsedMsA = generated.elapsedMs
      } else {
        meta.durationB = parsed.durationMs
        meta.bytesB = generated.bytes
        meta.elapsedMsB = generated.elapsedMs
      }
      console.log(
        `  ${side.ref}（${side.input.name}）→ ${basename(svgPath)}（${(generated.bytes / 1024).toFixed(0)} KB，${(generated.elapsedMs / 1000).toFixed(1)}s，${parsed.engine}）`
      )
    } finally {
      // 共享导出目录留给下一侧使用，循环外统一清理
      if (!options.keep && !(sameCommit && sharedExportDir === exportDir)) {
        rmSync(exportDir, { recursive: true, force: true })
      } else if (options.keep) {
        console.log(`  保留临时导出目录：${exportDir}`)
      }
    }
  }
  if (!options.keep && sharedExportDir !== null) {
    rmSync(sharedExportDir, { recursive: true, force: true })
  }
  writeFileSync(
    join(comboDir, 'meta.json'),
    JSON.stringify(meta, null, 2),
    'utf-8'
  )
}

/** --engine 是轻量覆盖：只改引擎开关，其余字段保持直通 */
function applyEngineOverride(
  options: Record<string, unknown>,
  engine: 'smil' | 'css' | undefined
): Record<string, unknown> {
  if (engine === undefined) return options
  return { ...options, css: engine === 'css' }
}

function inputLabel(input: CompareInput): string {
  return input.name
}

async function previewServe(
  options: CliOptions,
  outRoot: string,
  combo: string,
  page = '/previewPage.html',
  open = true
): Promise<void> {
  const serve = startServe(TOOL_ROOT, {
    outRoot,
    listCombos: () => listCombos(outRoot),
    runReport: async (name) =>
      runReport({
        outRoot,
        toolRoot: TOOL_ROOT,
        combo: name,
        frames: options.frames,
        pixelThreshold: options.pixelThreshold,
        thresholds: thresholdsOf(options)
      })
  })
  const url = `${serve.url}${page}?combo=${encodeURIComponent(combo)}`
  console.log(`\n预览服务：${url}（Ctrl+C 退出）`)
  if (open) await openBrowser(url)
  await new Promise(() => {})
}

function printVerdict(
  results: ComboResult[],
  aggregated: ReturnType<typeof aggregateVerdicts>
): void {
  const rows = results.map((result) => ({
    组合: result.name,
    [dimensionLabel('duration')]: percent(result.verdict.durationDelta),
    [dimensionLabel('avg')]: percent(result.verdict.avgDiff),
    [dimensionLabel('max')]: percent(result.verdict.maxDiff),
    结果: result.verdict.pass ? '✅ 通过' : '❌ 未通过'
  }))
  console.log()
  console.table(rows)
  console.log(
    aggregated.pass
      ? '总体判定：✅ 通过'
      : `总体判定：❌ 未通过（最差组合：${aggregated.dimensions
          .map(
            (dimension) =>
              `${dimensionLabel(dimension.name)} ${percent(dimension.value)} @ ${dimension.combo}`
          )
          .join('，')}）`
  )
}

/** --ci 时把判定表写进 GitHub Step Summary（存在该环境变量时） */
function writeSummary(
  outRoot: string,
  options: CliOptions,
  refA: string,
  refB: string,
  commitA: string,
  commitB: string,
  results: ComboResult[],
  aggregated: ReturnType<typeof aggregateVerdicts>
): void {
  const summary = {
    refA,
    refB,
    commitA,
    commitB,
    via: options.via,
    thresholds: thresholdsOf(options),
    pass: aggregated.pass,
    combos: results.map((result) => ({
      name: result.name,
      verdict: result.verdict
    })),
    createdAt: new Date().toISOString()
  }
  writeFileSync(
    join(outRoot, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8'
  )

  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!stepSummaryPath) return
  const lines = [
    `## SVG 视觉对比（${refA} ↔ ${refB}，via ${options.via}）`,
    '',
    '| 组合 | 总时长偏差 | 平均差异 | 最大差异 | 结果 |',
    '|---|---|---|---|---|',
    ...results.map(
      (result) =>
        `| ${result.name} | ${percent(result.verdict.durationDelta)} | ${percent(result.verdict.avgDiff)} | ${percent(result.verdict.maxDiff)} | ${result.verdict.pass ? '✅' : '❌'} |`
    ),
    '',
    `**总体判定：${aggregated.pass ? '通过' : '未通过'}**（阈值：时长 ≤ ${percent(options.maxDurationDelta)}，平均 ≤ ${percent(options.maxAvgDiff)}，最大 ≤ ${percent(options.maxMaxDiff)}）`
  ]
  writeFileSync(stepSummaryPath, `${lines.join('\n')}\n`, { flag: 'a' })
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

program
  .action(async (refA: string, refB: string, options: CliOptions) => {
    await main(refA, refB, options)
  })
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    console.error(
      `[svg-compare] ${error instanceof Error ? error.stack : String(error)}`
    )
    process.exitCode = 1
  })
