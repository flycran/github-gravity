# 贡献指南

## 分支规范

新增代码前，先从以下两种方式之一创建工作分支，不要直接在 main 上改动：

- **Fork 仓库**：在你自己的 fork 上创建分支；已有 fork 需先同步上游 main 的最新代码；
- **本仓库分支**：pull 最新的 main 后，从 main 创建新分支。

分支命名参考：`feat/xxx`、`fix/xxx`、`ci/xxx`。

## 开发与验证

```bash
bun install                # 安装依赖
npm run ci-test            # 测试（bun test）
bun biome check .          # 格式与 Lint，加 --write 自动修复
npm run bundle             # 修改 src/ 后重新构建 Action 产物 dist/
bun run build:web          # 网页版构建，输出 dist-web/（不入库）
```

修改 `src/` 后必须重新构建并提交 `dist/`：CI 会删除 dist 重新构建并与提交内容做 diff，不一致即失败。

## 提交

- Commit message 使用 Conventional Commits（`feat:` / `fix:` / `chore:` / `ci:`），中文描述；
- `dist/` 的重建单独作为一个 `chore: 重新构建 dist` 提交；
- 从分支向 main 发起 PR，CI 全绿后合并。

## 发布

`package.json` 的 `version` 是版本号唯一事实源，遵循语义化版本：

1. 在 PR 中 bump `version` 并合入 main；
2. `sync-version-tag.yml` 检测 main 上的 `version` 缺少对应 tag 时自动打 `vX.Y.Z`；
3. `update-major-tag.yml` 将 `vX` 大版本 tag 移动到新版本指向的提交。

无需手动打 tag。
