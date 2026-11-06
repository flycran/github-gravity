/**
 * SVG 分支视觉对比工具入口。
 *
 * 与 gensvg 项目完全解耦：工具自身不 import 被测代码，对比时把生成驱动
 * 注入 `git archive` 导出的临时目录，运行该 ref 自己的实现；
 * 产物（SVG/meta/报告）落在被测仓库的 .svg-compare/ 下并自带忽略文件。
 *
 * 三个子命令（操作为主命令，分支是参数且可省略——A 默认 main，B 默认当前 HEAD）：
 * - preview：生成产物并起预览服务，页内可触发生成一致性报告
 * - report：无头跑一致性报告，未通过退出码 1
 * - ci：CI 门禁，报告 + summary.json + GitHub Step Summary
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
  type AggregatedVerdict,
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
const DEFAULT_BASE_REF = 'main'

/** 三个子命令共享的生成 flags（字段名与 commander 生成的属性一一对应） */
interface SharedOptions {
  input: string
  inputA?: string
  inputB?: string
  via: ViaMode
  engine?: 'smil' | 'css'
  frames: number
  out: string
  keep: boolean
  maxDurationDelta: number
  maxAvgDiff: number
  maxMaxDiff: number
  pixelThreshold: number
}

interface PreviewOptions extends SharedOptions {
  open: boolean
}

/** 一轮对比的完整配置：A/B 侧可以各用各的输入（如 SMIL vs CSS） */
interface ComboPlan {
  name: string
  inputA: CompareInput
  inputB: CompareInput
}

/** 一次对比的准备结果（生成与报告都基于它） */
interface Prepared {
  repoRoot: string
  outRoot: string
  refA: string
  refB: string
  commitA: string
  commitB: string
  plans: ComboPlan[]
}

/** 阈值在 CLI 层平铺，报告侧收敛为三维度结构 */
function thresholdsOf(shared: SharedOptions): Thresholds {
  return {
    maxDurationDelta: shared.maxDurationDelta,
    maxAvgDiff: shared.maxAvgDiff,
    maxMaxDiff: shared.maxMaxDiff
  }
}

function parseNumber(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} 需要非负数字，收到 "${value}"`)
  }
  return parsed
}

/** commander 子命令的 options 相互独立，共享 flags 需要逐个挂载；
 * --input 的默认目录按子命令区分：手动跑 manual/，CI 门禁跑 ci/ */
function addSharedFlags(cmd: Command, defaultInput: string): Command {
  return cmd
    .option(
      '--input <path>',
      '共用对比输入 JSON 文件或目录（目录下全部输入文件视为多组合）',
      defaultInput
    )
    .option('--input-a <path>', 'A 侧专用输入 JSON（单文件），覆盖 --input')
    .option('--input-b <path>', 'B 侧专用输入 JSON（单文件），覆盖 --input')
    .option('--via <mode>', '生成模式：src 源码直连 / dist 生产 bundle', 'src')
    .option('--engine <engine>', '覆盖输入中的动画引擎开关（smil|css）')
    .option(
      '--frames <n>',
      '报告采样帧数',
      (value: string) => parseNumber(value, '--frames'),
      12
    )
    .option('--out <dir>', '产物根目录（相对被测仓库）', DEFAULT_OUT_DIR)
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
}

/** 公共准备：仓库校验、产物目录、ref 解析、组合计划 */
async function prepare(
  refA: string,
  refB: string,
  shared: SharedOptions
): Promise<Prepared> {
  if (shared.via !== 'src' && shared.via !== 'dist') {
    throw new Error(`--via 只支持 src|dist，收到 "${shared.via}"`)
  }
  if (
    shared.engine !== undefined &&
    shared.engine !== 'smil' &&
    shared.engine !== 'css'
  ) {
    throw new Error(`--engine 只支持 smil|css，收到 "${shared.engine}"`)
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
  if (shared.inputA !== undefined || shared.inputB !== undefined) {
    const sharedInput = (await loadInputs(shared.input))[0]
    const inputA = shared.inputA
      ? (await loadInputs(shared.inputA))[0]
      : sharedInput
    const inputB = shared.inputB
      ? (await loadInputs(shared.inputB))[0]
      : sharedInput
    const name =
      inputA.name === inputB.name
        ? inputA.name
        : `${inputA.name}__${inputB.name}`
    plans = [{ name, inputA, inputB }]
  } else {
    plans = (await loadInputs(shared.input)).map((input) => ({
      name: input.name,
      inputA: input,
      inputB: input
    }))
  }

  const outRoot = join(repoRoot, shared.out)
  mkdirSync(outRoot, { recursive: true })
  // 产物目录自带忽略文件，不污染被测仓库的 git status（工具分支与主仓库解耦，不改其 .gitignore）
  writeFileSync(join(outRoot, '.gitignore'), '*\n', 'utf-8')

  const commitA = await resolveRef(repoRoot, refA)
  const commitB = await resolveRef(repoRoot, refB)
  console.log(
    `对比 ${refA} (${commitA.slice(0, 7)}) ↔ ${refB} (${commitB.slice(0, 7)})，via ${shared.via}` +
      (shared.inputA !== undefined || shared.inputB !== undefined
        ? `，输入 ${plans[0].inputA.name} ↔ ${plans[0].inputB.name}`
        : '')
  )

  return { repoRoot, outRoot, refA, refB, commitA, commitB, plans }
}

/** 逐组合生成产物，返回组合名列表（预览与报告共用其顺序） */
async function generateAll(
  prepared: Prepared,
  shared: SharedOptions
): Promise<string[]> {
  const combos: string[] = []
  for (const plan of prepared.plans) {
    combos.push(plan.name)
    console.log(`\n[${plan.name}] 生成中…`)
    await generateCombo(prepared, shared, plan)
  }
  return combos
}

/** 导出两个 ref 并各自跑生成驱动，落 a.svg/b.svg/meta.json；同 commit 复用同一份导出 */
async function generateCombo(
  prepared: Prepared,
  shared: SharedOptions,
  plan: ComboPlan
): Promise<void> {
  const { repoRoot, outRoot, refA, refB, commitA, commitB } = prepared
  const comboDir = join(outRoot, plan.name)
  rmSync(comboDir, { recursive: true, force: true })
  mkdirSync(comboDir, { recursive: true })

  const driverSource =
    shared.via === 'dist' ? renderDriverDist() : renderDriverSrc()

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
    via: shared.via,
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
        shared.engine
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
      if (!shared.keep && !(sameCommit && sharedExportDir === exportDir)) {
        rmSync(exportDir, { recursive: true, force: true })
      } else if (shared.keep) {
        console.log(`  保留临时导出目录：${exportDir}`)
      }
    }
  }
  if (!shared.keep && sharedExportDir !== null) {
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

async function previewServe(
  shared: SharedOptions,
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
        frames: shared.frames,
        pixelThreshold: shared.pixelThreshold,
        thresholds: thresholdsOf(shared)
      })
  })
  const url = `${serve.url}${page}?combo=${encodeURIComponent(combo)}`
  console.log(`\n预览服务：${url}（Ctrl+C 退出）`)
  if (open) await openBrowser(url)
  await new Promise(() => {})
}

/** report/ci 共用：逐组合跑报告，汇总判定，写 summary 与 Step Summary */
async function reportAll(
  prepared: Prepared,
  shared: SharedOptions,
  combos: string[]
): Promise<AggregatedVerdict> {
  const results: ComboResult[] = []
  for (const combo of combos) {
    console.log(`\n[${combo}] 报告生成中…`)
    const report = await runReport({
      outRoot: prepared.outRoot,
      toolRoot: TOOL_ROOT,
      combo,
      frames: shared.frames,
      pixelThreshold: shared.pixelThreshold,
      thresholds: thresholdsOf(shared)
    })
    results.push({ name: combo, verdict: report.verdict })
    console.log(`  报告：${join(prepared.outRoot, combo, 'report.json')}`)
  }

  const aggregated = aggregateVerdicts(results)
  writeSummary(prepared, shared, results, aggregated)
  printVerdict(results, aggregated)
  return aggregated
}

function printVerdict(
  results: ComboResult[],
  aggregated: AggregatedVerdict
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

/** 写 summary.json（机器可读）；存在 GITHUB_STEP_SUMMARY 时追加判定表 */
function writeSummary(
  prepared: Prepared,
  shared: SharedOptions,
  results: ComboResult[],
  aggregated: AggregatedVerdict
): void {
  const summary = {
    refA: prepared.refA,
    refB: prepared.refB,
    commitA: prepared.commitA,
    commitB: prepared.commitB,
    via: shared.via,
    thresholds: thresholdsOf(shared),
    pass: aggregated.pass,
    combos: results.map((result) => ({
      name: result.name,
      verdict: result.verdict
    })),
    createdAt: new Date().toISOString()
  }
  writeFileSync(
    join(prepared.outRoot, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8'
  )

  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!stepSummaryPath) return
  const lines = [
    `## SVG 视觉对比（${prepared.refA} ↔ ${prepared.refB}，via ${shared.via}）`,
    '',
    '| 组合 | 总时长偏差 | 平均差异 | 最大差异 | 结果 |',
    '|---|---|---|---|---|',
    ...results.map(
      (result) =>
        `| ${result.name} | ${percent(result.verdict.durationDelta)} | ${percent(result.verdict.avgDiff)} | ${percent(result.verdict.maxDiff)} | ${result.verdict.pass ? '✅' : '❌'} |`
    ),
    '',
    `**总体判定：${aggregated.pass ? '通过' : '未通过'}**（阈值：时长 ≤ ${percent(shared.maxDurationDelta)}，平均 ≤ ${percent(shared.maxAvgDiff)}，最大 ≤ ${percent(shared.maxMaxDiff)}）`
  ]
  writeFileSync(stepSummaryPath, `${lines.join('\n')}\n`, { flag: 'a' })
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

const program = new Command()

program
  .name('svg-compare')
  .description(
    '任意两个 ref 在同一份输入下生成动画 SVG，预览页同步播放对比，' +
      '并输出像素级一致性报告。分支可省略：A 默认 main，B 默认当前 HEAD'
  )

const preview = program
  .command('preview')
  .description('生成产物并起预览服务（页内可触发生成一致性报告）')
  .argument('[refA]', '对比侧 A：分支 / tag / commit', DEFAULT_BASE_REF)
  .argument('[refB]', '对比侧 B：分支 / tag / commit', 'HEAD')
  .option('--no-open', '不自动打开浏览器（预览 serve 仍保留）')
addSharedFlags(preview, join(TOOL_ROOT, 'configs/preview/default.ts')).action(
  async (refA: string, refB: string, options: PreviewOptions) => {
    const prepared = await prepare(refA, refB, options)
    const combos = await generateAll(prepared, options)
    await previewServe(
      options,
      prepared.outRoot,
      combos[0],
      '/previewPage.html',
      options.open
    )
  }
)

const report = program
  .command('report')
  .description('无头生成一致性报告并输出判定（未通过退出码 1）')
  .argument('[refA]', '对比侧 A：分支 / tag / commit', DEFAULT_BASE_REF)
  .argument('[refB]', '对比侧 B：分支 / tag / commit', 'HEAD')
addSharedFlags(report, join(TOOL_ROOT, 'configs/batch')).action(
  async (refA: string, refB: string, options: SharedOptions) => {
    const prepared = await prepare(refA, refB, options)
    const combos = await generateAll(prepared, options)
    const aggregated = await reportAll(prepared, options, combos)
    if (!aggregated.pass) process.exitCode = 1
  }
)

const ci = program
  .command('ci')
  .description(
    'CI 门禁：报告 + summary.json + GitHub Step Summary（未通过退出码 1）'
  )
  .argument('[refA]', '对比侧 A：分支 / tag / commit', DEFAULT_BASE_REF)
  .argument('[refB]', '对比侧 B：分支 / tag / commit', 'HEAD')
addSharedFlags(ci, join(TOOL_ROOT, 'configs/batch')).action(
  async (refA: string, refB: string, options: SharedOptions) => {
    const prepared = await prepare(refA, refB, options)
    const combos = await generateAll(prepared, options)
    const aggregated = await reportAll(prepared, options, combos)
    if (!aggregated.pass) process.exitCode = 1
  }
)

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(
    `[svg-compare] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
