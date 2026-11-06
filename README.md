# svg-compare

SVG 分支视觉对比工具：对**任意两个 ref**（分支 / tag / commit）用**同一份输入**各自生成 github-gravity 的动画 SVG，预览页同步播放对比，并输出像素级一致性报告。用于确认算法调整（轨迹压缩、物理参数等）不会破坏视觉效果，以及作为 PR 合入 main 前的视觉回归门禁。

本分支是**孤儿分支（orphan）**，与 gensvg 项目代码完全解耦：工具自身不 import 项目代码，对比时把生成驱动注入 `git archive` 导出的临时目录，运行该 ref 自己的实现。主仓库零改动，本分支不合并回 main。

## 调用方式

在被测仓库根目录运行（工具依赖 `git` 与 `bun`）：

```sh
TOOL=/path/to/svg-compare   # 本分支的工作树/检出目录
```

### 1. 手动预览（默认）

生成产物 → 起本地 serve → 自动打开浏览器。预览页支持同步播放/暂停、进度条拖动定位、±1 帧步进（空格 / ←→）、并排 / 叠加（透明度滑块）/ difference 混合三种视图，页内"生成一致性报告"按钮可触发像素级对比并就地渲染报告。

```sh
bun $TOOL/cli.ts -- main feature-x
```

### 2. 手动 CLI（无头报告）

本地跑完输出报告文件（report.html 同款数据渲染在预览页 / report.json 机器可读），不打开浏览器不预览；判定失败时退出码为 1。

```sh
bun $TOOL/cli.ts -- main feature-x --report --no-open
```

### 3. CI 门禁

无头跑完输出 report.json + summary.json + GitHub Step Summary，按三维度判定设退出码。

```sh
bun $TOOL/cli.ts -- "$BASE_SHA" "$HEAD_SHA" --ci
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
          bun svg-compare-tool/cli.ts -- "$base" HEAD \
            --input svg-compare-tool/fixtures --via dist --ci
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
bun cli.ts <refA> <refB> [flags]

  --input <file|dir>        对比输入 JSON（目录下全部 .json 视为多组合；默认工具自带 fixtures/）
  --via <src|dist>          生成模式：src 源码直连（默认）/ dist 生产 bundle
  --engine <smil|css>       覆盖输入中的动画引擎开关
  --frames <n>              报告采样帧数（默认 12）
  --out <dir>               产物根目录（默认 <仓库>/.svg-compare，自带忽略文件不污染 git status）
  --report                  生成后自动跑一致性报告
  --no-open                 不自动打开浏览器（预览 serve 仍保留）
  --ci                      CI 门禁模式（隐含 --report --no-open）
  --pixel-threshold <n>     pixelmatch YIQ 感知容差（默认 0.1）
  --max-duration-delta <n>  时长偏差阈值（默认 0.005）
  --max-avg-diff <n>        平均差异阈值（默认 0.002）
  --max-max-diff <n>        最大差异阈值（默认 0.01）
  --keep                    保留临时导出目录（调试用）
```

产物结构（每个输入组合一个子目录）：

```
.svg-compare/<组合>/
├── a.svg / b.svg     # 两 ref 各自生成的动画 SVG
├── meta.json         # ref/commit/引擎/时长/文件大小
├── report.json       # 一致性报告（--report 时）
└── frames/           # 逐帧 A/B/diff 截图（--report 时）
```

## 输入约定（直通语义）

输入 JSON 原样透传给被测 ref 的 `gensvg`（`calendarList` 注入贡献数据保证离线确定性）。工具**不做**字段白名单、跨版本兼容映射与默认值合并——不同 ref 的选项字段差异由调用方自行判断，字段不被某 ref 支持时透出该 ref 的原始报错。`--engine` 是唯一例外（轻量覆盖引擎开关，其余字段不动）。

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
