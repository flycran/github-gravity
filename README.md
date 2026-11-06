# svg-compare

SVG 分支视觉对比工具：对**任意两个 ref**（分支 / tag / commit）用**同一份输入**各自生成 github-gravity 的动画 SVG，预览页同步播放对比，并输出像素级一致性报告。

## 调用方式

在被测仓库根目录运行（工具依赖 `git` 与 `bun`）：

```sh
TOOL=/path/to/svg-compare   # 本分支的工作树/检出目录
```

### 1. 手动预览（preview）

生成产物 → 起本地 serve → 自动打开浏览器。预览页支持同步播放/暂停、进度条拖动定位、±1 帧步进（空格 / ←→）、并排 / 叠加（透明度滑块）/ difference 混合三种视图，页内"生成一致性报告"按钮可触发像素级对比并就地渲染报告。

```sh
bun $TOOL/cli.ts preview                       # main vs 当前 HEAD（分支可省略）
bun $TOOL/cli.ts preview main feature-x        # 显式指定两侧
bun $TOOL/cli.ts preview main --no-open        # 只生成并挂起 serve，不自动开浏览器
```

### 2. 手动报告（report）

无头跑完输出报告（report.json 机器可读 / 预览页与报告页可视化渲染），不打开浏览器；判定失败时退出码为 1。

```sh
bun $TOOL/cli.ts report main feature-x
```

### 3. CI 门禁（ci）

无头跑完输出 report.json + summary.json + GitHub Step Summary，按三维度判定设退出码。每个子命令只声明自己需要的 flags（如 ci 下没有 --no-open），参数写错会直接报未知选项。

```sh
bun $TOOL/cli.ts ci "$BASE_SHA" "$HEAD_SHA"
```

完整 workflow 集成模板（放主仓库 `.github/workflows/visual-compare.yml`，并在仓库设置里把该 check 配为 required 才能真正阻止合并）：

```yaml
name: Visual Compare

on:
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  visual-compare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: jdx/mise-action@v2
      - run: bun install --frozen-lockfile
      # major 版本 gate：大版本不一致说明是有意的破坏性变更，仍执行对比但仅报告不阻止合并
      - id: major-gate
        run: |
          base_major=$(git show origin/${{ github.base_ref }}:package.json | jq -r '.version | split(".")[0]')
          head_major=$(jq -r '.version | split(".")[0]' package.json)
          echo "enforce=$([ "$base_major" = "$head_major" ] && echo true || echo false)" >> "$GITHUB_OUTPUT"
      - uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('bun.lock') }}
      - run: bunx playwright install chromium --with-deps
      # 工具分支 checkout 到子目录，与主仓库代码互不干扰
      - uses: actions/checkout@v6
        with:
          ref: tools/svg-compare
          path: svg-compare-tool
      - id: compare
        continue-on-error: ${{ steps.major-gate.outputs.enforce == 'false' }}
        run: |
          base=$(git merge-base origin/${{ github.base_ref }} HEAD)
          bun svg-compare-tool/cli.ts ci "$base" HEAD \
            --input svg-compare-tool/fixtures --via dist
      - if: always() && steps.compare.outcome == 'failure'
        run: |
          if [ "${{ steps.major-gate.outputs.enforce }}" = "true" ]; then
            exit 1
          fi
          echo "::warning::major 版本不一致，视觉差异仅报告不阻止合并"
      - if: always()
        uses: actions/upload-artifact@v7
        with:
          name: svg-compare-report
          path: .svg-compare/
```

## 参数

```sh
bun cli.ts <子命令> [refA] [refB] [flags]

子命令：
  preview                   生成产物并起预览服务（页内可触发一致性报告）；--no-open 不自动开浏览器
  report                    无头跑一致性报告，未通过退出码 1
  ci                        CI 门禁：报告 + summary.json + Step Summary

参数：
  [refA]                    对比侧 A（默认 main）
  [refB]                    对比侧 B（默认当前 HEAD）

三个子命令共享的 flags：
  --input <file|dir>        共用对比输入 JSON 或目录（目录下全部输入文件视为多组合；默认工具自带 fixtures/）
  --input-a <file>          A 侧专用输入 JSON，覆盖 --input；未提供的一侧回退 --input 的第一个组合
  --input-b <file>          B 侧专用输入 JSON，覆盖 --input
  --via <src|dist>          生成模式：src 源码直连（默认）/ dist 生产 bundle
  --engine <smil|css>       覆盖输入中的动画引擎开关
  --frames <n>              报告采样帧数（默认 12）
  --out <dir>               产物根目录（默认 <仓库>/.svg-compare，自带忽略文件不污染 git status）
  --pixel-threshold <n>     pixelmatch YIQ 感知容差（默认 0.1）
  --max-duration-delta <n>  时长偏差阈值（默认 0.005）
  --max-avg-diff <n>        平均差异阈值（默认 0.002）
  --max-max-diff <n>        最大差异阈值（默认 0.01）
  --keep                    保留临时导出目录（调试用）
```

### 对比不同输入（引擎 / 算法差异）

`--input-a`/`--input-b` 让两侧各用各的参数，用于对比同一份代码在不同引擎、不同压缩算法下的视觉差异（此时通常两侧传同一个 ref）：

```sh
# SMIL vs CSS 两种引擎（同 ref，输入只差 css 开关与相关参数）
bun cli.ts main main --input-a fixtures/default-smil.json --input-b fixtures/css-square-color.json

# Greedy vs DP 两种压缩算法
bun cli.ts main main --input-a fixtures/default-smil.json --input-b fixtures/dp-compression.json
```

`--input-a`/`--input-b` 未提供的一侧回退到 `--input` 的第一个组合；组合名按两侧输入名拼接（如 `default-smil__css-square-color`）。两侧时长不同时以较长一方为采样范围，短的一方末帧停驻。注意：输入不同的对比**不代表回归差异**，仅用于分析参数间的行为差异——CI 门禁场景仍应共用一份输入。

产物结构（每个输入组合一个子目录）：

```
.svg-compare/<组合>/
├── a.svg / b.svg     # 两 ref 各自生成的动画 SVG
├── meta.json         # ref/commit/时长/文件大小
├── report.json       # 一致性报告（report/ci 子命令或页内触发时）
└── frames/           # 逐帧 A/B/diff 截图（report/ci 子命令或页内触发时）
```

## 输入约定（直通语义）

输入支持 `.json` 与 `.ts`/`.js`（bun 原生导入；TS 输入须 default export 一个对象）两种格式，内容原样透传给被测 ref 的 `gensvg`（`calendarList` 注入贡献数据保证离线确定性）。工具**不做**字段白名单、跨版本兼容映射与默认值合并——不同 ref 的选项字段差异由调用方自行判断，字段不被某 ref 支持时透出该 ref 的原始报错。`--engine` 是唯一例外（轻量覆盖引擎开关，其余字段不动）。

目录模式扫描全部输入文件为多组合；**以 `_` 开头的 TS 文件视为共享模块**，不作为组合——自带的 `fixtures/_calendar.ts` 就是这样被三个 fixture 共用同一份贡献数据，修改只改一处。

## 生成模式

- **src（默认）**：driver 注入导出目录，import 该 ref 的 `src/utils/gensvg.js`，输入直通。快，适合日常调算法。
- **dist**：driver 设置 `INPUT_*` 环境变量（@actions/core 的 getInput 读取）并拦截贡献数据请求（固定注入同一份 `calendarList`——外部数据源会随时间变化，不拦截则两 ref 输入不同，对比不成立），然后 import 该 ref 的 `dist/index.js` 跑完整生产路径 `run()`。生产一致，CI 门禁用此模式。

## 一致性判定

三维度**各自独立阈值、全部 ≤ 阈值才通过**（不做加权合成；多组合须全部通过）：

| 维度       | 计算                             | 默认阈值 | 捕捉什么                            |
| ---------- | -------------------------------- | -------- | ----------------------------------- |
| 总时长偏差 | `\|durA−durB\| / max(durA,durB)` | ≤ 0.5%   | 模拟步数/收敛行为变化（结构性兜底） |
| 平均差异   | 所有采样帧差异率的平均           | ≤ 0.2%   | 整体视觉偏移水平                    |
| 最大差异   | 峰值帧差异率                     | ≤ 1%     | 瞬时结构性差异（峰值帧可跳看三图）  |

阈值依据：同 ref 基线为**精确 0%**（同浏览器同字体，无渲染噪声），实测重力翻倍这类明显行为破坏约 avg 0.53% / max 0.64%，默认值必须拦得住；判据不适配时可按场景用 CLI 参数放宽。

## 时间确定性

全工具不存在"让动画自己跑"的路径：

1. 时长从 SVG 产物自身声明解析（SMIL `dur` / CSS `--dur`），采样时刻表由 Node 侧计算，页面只被动接受 seek 指令；
2. SMIL 挂载后立即 `pauseAnimations()` 冻结文档时钟，定位一律 `setCurrentTime(t)`；CSS 引擎 `getAnimations()` 全部 `pause()`，定位一律 `currentTime = t`；
3. 人工播放 = 页面主时钟 rAF 驱动双 seek，进度条/帧步进 = 显式 seek；
4. 自动报告每帧 seek → 双 rAF 屏障（等样式计算与合成）→ 读回时钟校验（偏差 >1ms 重试）→ 截图。

因此同 ref 基线是精确 0.000%，重复运行报告结果逐帧一致。

## 开发

```sh
bun install
bun test        # 单元测试
bun run lint    # biome check
bunx playwright install chromium   # 自动报告的浏览器（一次性）
```
