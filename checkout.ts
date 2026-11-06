/**
 * ref 检出与生成执行：git archive 解包到临时目录、安装依赖、运行生成驱动。
 *
 * archive 输出经 tar 文件中转解包，不经 shell，避免 ref 名拼接的注入面；
 * 依赖按 ref 自己的 lockfile 安装，保证跑的是该 ref 的代码与依赖版本。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ExportedRef {
  /** 用户输入的 ref 原样（展示用） */
  ref: string
  /** 解析出的完整 commit sha */
  commit: string
  /** 导出目录（绝对路径） */
  dir: string
}

export interface GeneratedSvg {
  svgPath: string
  /** 文件大小（字节） */
  bytes: number
  /** 生成耗时（ms） */
  elapsedMs: number
}

/** 校验 ref 存在并解析为完整 commit sha */
export async function resolveRef(
  repoRoot: string,
  ref: string
): Promise<string> {
  const output = Bun.spawnSync(
    ['git', 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`],
    { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' }
  )
  if (output.exitCode !== 0) {
    throw new Error(
      `ref "${ref}" 无法解析为 commit：${output.stderr.toString().trim()}`
    )
  }
  return output.stdout.toString().trim()
}

/** 把 ref 的完整源码（git 追踪文件）导出到 destDir 并安装依赖 */
export async function exportRef(
  repoRoot: string,
  ref: string,
  commit: string,
  destDir: string
): Promise<ExportedRef> {
  const tarPath = join(
    mkdtempSync(join(tmpdir(), 'svg-compare-')),
    'archive.tar'
  )
  try {
    await run(
      ['git', 'archive', '--format=tar', '--output', tarPath, commit],
      repoRoot
    )
    await run(['tar', '-xf', tarPath, '-C', destDir])
  } finally {
    rmSync(tarPath, { force: true })
  }
  // 优先按 lockfile 精确安装；老 ref 没有 lockfile 时回退普通安装
  const frozen = Bun.spawnSync(['bun', 'install', '--frozen-lockfile'], {
    cwd: destDir,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  if (frozen.exitCode !== 0) {
    await run(['bun', 'install'], destDir)
  }
  return { ref, commit, dir: destDir }
}

/**
 * 在导出目录内运行生成驱动，把 SVG 写到 outPath。
 * driver 是由工具写入该目录的胶水脚本（见 drivers.ts），import 的是
 * 该 ref 自己的代码；任何字段级失败直接透出 ref 的原始错误。
 */
export async function runDriver(
  dir: string,
  driverFile: string,
  outPath: string
): Promise<GeneratedSvg> {
  const startedAt = performance.now()
  await run(['bun', 'run', driverFile, outPath], dir, 180_000)
  const bytes = Bun.file(outPath).size
  if (bytes === 0) {
    throw new Error(`生成驱动未产出 SVG：${outPath}`)
  }
  return { svgPath: outPath, bytes, elapsedMs: performance.now() - startedAt }
}

async function run(
  cmd: string[],
  cwd = process.cwd(),
  timeoutMs = 300_000
): Promise<void> {
  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: timeoutMs
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr =
      proc.stderr === null ? '' : await new Response(proc.stderr).text()
    throw new Error(`命令失败（${exitCode}）：${cmd.join(' ')}\n${stderr}`)
  }
}
