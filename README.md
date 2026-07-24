# GitHub Gravity

![CI](https://github.com/actions/typescript-action/actions/workflows/ci.yml/badge.svg)
![Coverage](./badges/coverage.svg)

Make your GitHub contribution graph fall under gravity, colliding with custom text to produce a beautiful animated SVG.

> [中文文档](./README_zh.md)

## Preview

![Gravity Animation](https://raw.githubusercontent.com/flycran/github-gravity/output/gravity.svg)

## Inspiration

Inspired by [Orta Therox](https://github.com/Orta). Thanks Orta for your outstanding contributions to the open-source community!

## Usage

```yaml
- name: Generate Gravity SVG
  uses: flycran/github-gravity@v1
  with:
    username: Orta
    text: Orta Therox
    output-path: gravity.svg
```

### Inputs

| Parameter | Required | Default | Description |
|---|---|---|---|
| `username` | ✅ | - | GitHub username to fetch contributions for |
| `text` | ❌ | `username` value | Text to display as collision obstacles |
| `output-path` | ❌ | `gravity.svg` | Path to write the generated SVG file |
| `font-size` | ❌ | `80` | Font size of the collision text |
| `sample-rate` | ❌ | `4` | Trajectory sample rate (higher = smaller SVG, less smooth animation) |
| `shape` | ❌ | `circle` | Shape of contribution blocks: `circle` or `square` |
| `text-top` | ❌ | `50` | Distance from the top of the world to the text |
| `background-color` | ❌ | `transparent` | Background color of the SVG (CSS color value) |
| `text-color` | ❌ | `black` | Color of the collision text (CSS color value) |

### Outputs

| Output | Description |
|---|---|
| `svg-path` | Path to the generated SVG file |

### Full Example

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

## Development

### Environment Setup

```bash
bun install
```

### Testing

```bash
npm run test
```

### Bundling

After modifying code under `src/`, re-bundle:

```bash
npm run bundle
```

### Local Testing

```bash
npx @github/local-action . src/main.ts .env
```
