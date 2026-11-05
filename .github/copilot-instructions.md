# Copilot Instructions

This GitHub Action is written in TypeScript and bundled to JavaScript with
Rollup. Both the TypeScript sources and the **generated** JavaScript code are
contained in this repository. The TypeScript sources are contained in the `src`
directory and the JavaScript code is contained in the `dist` directory. A
GitHub Actions workflow (`check-dist.yml`) checks that the JavaScript code in
`dist` is up-to-date. Therefore, any change to `src` must be followed by a
rebuild of `dist`, you should not review any manual changes to the contents of
the `dist` folder, and it is expected that the JavaScript code in `dist`
closely mirrors the TypeScript code it is generated from.

The runtime is Bun (pinned in `.mise.toml`), with Node.js >= 24 required by the
action itself (`.node-version`, `package.json` `engines`). Formatting and
linting are handled entirely by Biome — there is no ESLint or Prettier in this
repository. Tests run on `bun test` (Bun's built-in test runner) — there is no
Jest and no coverage tooling.

See `CONTRIBUTING.md` for branch naming, commit conventions, and the release
process.

## Repository Structure

| Path                 | Description                                              |
| -------------------- | -------------------------------------------------------- |
| `__tests__/`         | Unit Tests (Bun test)                                    |
| `.github/`           | GitHub Configuration (workflows, Copilot instructions)   |
| `.vscode/`           | Visual Studio Code Configuration                         |
| `dist/`              | Generated JavaScript Code (bundled, no sourcemap)        |
| `public/`            | Static Assets for the Web Player                         |
| `scripts/`           | Development Scripts (e.g. SVG comparison)                |
| `src/`               | TypeScript Source Code (`src/main.ts` is the Action entry, `src/web/` is the Web Player) |
| `.env.example`       | Environment Variables Example for `@github/local-action` |
| `.markdown-lint.yml` | Markdown Linter Configuration (VS Code markdownlint)     |
| `.mise.toml`         | mise Tool Versions (Bun)                                 |
| `.node-version`      | Node.js Version Configuration                            |
| `.yaml-lint.yml`     | YAML Linter Configuration (VS Code YAML extension)       |
| `action.yml`         | GitHub Action Metadata (inputs/outputs)                  |
| `biome.json`         | Biome Formatter/Linter Configuration                     |
| `bun.lock`           | Bun Lockfile                                             |
| `CONTRIBUTING.md`    | Contribution Guide                                       |
| `LICENSE`            | License File                                             |
| `package.json`       | NPM Package Configuration                                |
| `README.md`          | Project Documentation                                    |
| `README_zh.md`       | Chinese Documentation                                    |
| `rollup.config.ts`   | Rollup Bundler Configuration                             |
| `tsconfig.json`      | TypeScript Configuration                                 |

## Environment Setup

Install dependencies by running:

```bash
bun install
```

## Testing

Ensure all unit tests pass by running:

```bash
npm run ci-test
```

Unit tests live in the `__tests__` directory and are powered by `bun:test`.
They mock the network, the physics engine and file output; keep that separation
when adding tests.

## Linting and Formatting

```bash
bun biome check .            # format + lint check (CI gate)
bun biome check --write .    # auto-fix
```

## Bundling

Any time files in `src` are changed, you must rebuild and commit `dist`:

```bash
npm run bundle
```

This runs a Biome check (with auto-fix) and then bundles `src/index.ts` into
`dist/index.js`. The bundle does not produce sourcemaps — keep it that way.

The Web Player (`src/web/`) is built separately and is not committed:

```bash
bun run build:web   # outputs dist-web/, deployed by pages.yml
```

## General Coding Guidelines

- Follow standard TypeScript and JavaScript coding conventions and best
  practices
- Changes should maintain consistency with existing patterns and style
- Document changes clearly and thoroughly, including updates to existing
  comments when appropriate
- Do not include basic, unnecessary comments that simply restate what the code
  is doing (focus on explaining _why_, not _what_)
- Use consistent error handling patterns throughout the codebase
- Use TypeScript's type system to ensure type safety and clarity
- Keep functions focused and manageable
- Use descriptive variable and function names that clearly convey their purpose
- Use JSDoc comments to document functions, classes, and complex logic
- After doing any refactoring, run `npm run ci-test` to ensure that all tests
  still pass
- Action inputs are validated strictly with `zod` in `src/main.ts`; when adding
  an input, extend `action.yml`, the schema in `src/main.ts` and the plumbing
  tests in `__tests__/main.test.ts` together
- When suggesting code changes, always opt for the most maintainable approach.
  Try your best to keep the code clean and follow "Don't Repeat Yourself" (DRY)
  principles
- Avoid unnecessary complexity and always consider the long-term maintainability
  of the code
- When writing unit tests, try to consider edge cases as well as the main path
  of success. This will help ensure that the code is robust and can handle
  unexpected inputs or situations
- Use the `@actions/core` package for logging over `console` to ensure
  compatibility with GitHub Actions logging features

### Versioning

The `version` field in `package.json` is the single source of truth and must
follow [Semantic Versioning](https://semver.org/) principles. Bump it in the PR
when user-facing behavior changes; the `sync-version-tag.yml` workflow creates
and maintains the `vX.Y.Z` / `vX` tags automatically — never tag manually.

## Pull Request Guidelines

When creating a pull request (PR), please ensure that:

- Keep changes focused and minimal (avoid large changes, or consider breaking
  them into separate, smaller PRs)
- Biome checks pass (`bun biome check .`)
- Unit tests pass (`npm run ci-test`)
- The action has been re-bundled and the `dist` directory is up-to-date with
  the latest changes in the `src` directory (`npm run bundle`)
- If necessary, the `README.md` and `README_zh.md` files are updated to reflect
  any changes in functionality or usage

The body of the PR should include:

- A summary of the changes
- A special note of any changes to dependencies
- A link to any relevant issues or discussions
- Any additional context that may be helpful for reviewers

## Code Review Guidelines

When performing a code review, please follow these guidelines:

- If there are changes that modify the functionality/usage of the action,
  validate that there are changes in the `README.md` and `README_zh.md` files
  that document the new or modified functionality
