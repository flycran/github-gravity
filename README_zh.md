# GitHub Gravity

![CI](https://github.com/actions/typescript-action/actions/workflows/ci.yml/badge.svg)
![Coverage](./badges/coverage.svg)

让你的 GitHub 贡献图在重力作用下掉落，与自定义文字碰撞，生成精美的 SVG 动画。

> [English](./README.md)

## 预览

![Gravity Animation](https://raw.githubusercontent.com/flycran/github-gravity/output/gravity.svg)

## 灵感来源

本项目灵感来自 [Orta Therox](https://github.com/Orta) 的创意。感谢 Orta 为开源社区做出的杰出贡献！

## 使用方法

```yaml
- name: Generate Gravity SVG
  uses: flycran/github-gravity@v1
  with:
    username: Orta
    text: Orta Therox
    output-path: gravity.svg
```

### 输入参数

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `username` | ✅ | - | GitHub 用户名，用于获取贡献数据 |
| `text` | ❌ | `username` 的值 | 作为碰撞障碍物的文字 |
| `output-path` | ❌ | `gravity.svg` | SVG 输出路径 |
| `font-size` | ❌ | `80` | 碰撞文字大小 |
| `sample-rate` | ❌ | `4` | 轨迹采样率（越大文件越小，动画越不流畅） |
| `shape` | ❌ | `circle` | 贡献方块的形状（`circle` 或 `square`） |
| `text-top` | ❌ | `50` | 文字距离世界顶部的距离，控制文字垂直位置 |
| `background-color` | ❌ | `transparent` | SVG 背景颜色（CSS 颜色值） |
| `text-color` | ❌ | `black` | 碰撞文字颜色（CSS 颜色值） |

### 输出

| 输出 | 说明 |
|---|---|
| `svg-path` | 生成的 SVG 文件路径 |

### 完整示例

```yaml
name: Generate Contribution Gravity

on:
  push:
    branches:
      - main

jobs:
  gravity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: flycran/github-gravity@v1
        with:
          username: Orta
          text: Orta Therox
          output-path: gravity.svg
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: .
          publish_branch: output
          keep_files: false
          force_orphan: true
```

## 开发

### 环境设置

```bash
bun install
```

### 测试

```bash
npm run test
```

### 打包

修改 `src/` 下的代码后，需要重新打包：

```bash
npm run bundle
```

### 本地测试

```bash
npx @github/local-action . src/main.ts .env
```

## 发布新版本

查看 [Versioning](https://github.com/actions/toolkit/blob/main/docs/action-versioning.md) 了解 GitHub Actions 版本管理。

