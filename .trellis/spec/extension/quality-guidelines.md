# Quality Guidelines

> Local gates, CI, TypeScript and biome configuration, forbidden patterns, dependency policy, and release/commit rules.

---

## Local Commands

From `package.json`:

| Command | Runs | When |
|---------|------|------|
| `npm install` | install dependencies | first setup |
| `npm test` | `vitest --run` | before every commit touching `src/` or `test/` |
| `npm run typecheck` | `tsgo --noEmit` | type-only checks |
| `npm run lint` | `biome check .` | lint + format check |
| `npm run lint:fix` | `biome check --write .` | auto-fix formatting and safe lints |
| `npm run check` | `tsgo --noEmit && biome check .` | the gate to run before pushing |
| `npm pack --dry-run` | package contents check | before release and in CI |
| `pi -e ./src/index.ts` | load the extension into a local pi session | manual smoke test only |

`npm run check` must pass with zero findings. `npm run typecheck` uses `tsgo` from `@typescript/native-preview` (TypeScript 7 native preview), not `tsc`; do not swap the script or add a `tsc` fallback without updating `.github/workflows/ci.yml`.

Manual smoke testing with `pi -e ./src/index.ts` is encouraged for TUI rendering changes, but it never replaces the automated suite.

---

## CI

`.github/workflows/ci.yml` runs a `test` job on a `fail-fast: false` matrix of `ubuntu-latest` and `macos-latest` with Node `"22"`, with a 15-minute timeout. Steps, in order:

1. `actions/checkout@v6`
2. `actions/setup-node@v6` with `cache: npm`
3. `npm ci`
4. `npm run check`
5. `npm test`
6. `npm pack --dry-run`

The workflow triggers on pushes and pull requests to `main` plus `workflow_dispatch`, and cancels in-progress runs for the same ref. Any new required tool must be added to this job; do not introduce a step that only works on one OS unless the matrix is updated intentionally.

`package.json` sets `"engines": { "node": ">=22.0.0" }`. Do not use APIs newer than Node 22 or Bun-specific APIs (`AGENTS.md`: "No Bun APIs. Runtime is Node only.").

---

## TypeScript Configuration

`tsconfig.json` is strict and `noEmit`. The flags with day-to-day consequences:

- `strict`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `allowUnreachableCode: false`, `allowUnusedLabels: false`, `noUnusedLocals`, `noUnusedParameters` — dead code and implicit behavior are errors.
- `noUncheckedIndexedAccess` — indexed access returns `T | undefined`. This is why the code guards every lookup, for example in `seekSequence` (`const line = lines[index + patternIndex]; ... if (line === undefined ...)`) and in `formatPatchPreview` (`const file = preview.files[0]; if (file)`). Prefer `?? ""`, `?.`, and explicit `undefined` checks over assertions.
- `exactOptionalPropertyTypes` — an optional property cannot be assigned `undefined` implicitly. The code uses conditional spread instead: `hunk.movePath !== undefined ? { ...file, movePath: hunk.movePath } : file` in `applySingleHunk`/`createPatchPreview`, and `const nextState: ApplyPatchRenderState = { cwd, patchText, callText, collapsed, expanded };`. Do not write `{ movePath: maybeUndefined }` for an optional field.
- `noPropertyAccessFromIndexSignature` — index-signature access must use brackets.
- `verbatimModuleSyntax` — type-only imports must be written as `import type` (see [Directory Structure](./directory-structure.md)).
- `isolatedModules`, `noUncheckedSideEffectImports` — every module must be independently transpilable and side-effect imports must resolve.
- `module`/`moduleResolution: "Node16"`, `target: "ES2022"`, `types: ["node"]`, `skipLibCheck: true`, `forceConsistentCasingInFileNames: true`.

`include` covers `src/**/*` and `test/**/*`. Add new source directories to this list only if you also justify a new top-level directory in [Directory Structure](./directory-structure.md).

---

## Biome

`biome.json` enables the recommended lint set plus targeted rules and the formatter. The rules that matter in review:

- `suspicious.noExplicitAny: "error"` — no `any` (mirrors `AGENTS.md`).
- `style.noNonNullAssertion: "error"` — no `!` non-null assertions; use guards, `??`, or optional chaining.
- `style.useImportType: "error"` — type-only imports must use `import type`.
- `style.useConst: "error"` — prefer `const`.
- `style.useNodejsImportProtocol` is `"off"` (the code still uses `node:` prefixes by convention, but biome does not enforce it).
- `complexity.useLiteralKeys` is `"off"` — bracket access for index-signature keys is expected and not flagged.
- `suspicious.noControlCharactersInRegex` is `"off"` — the parser's regexes rely on control/whitespace character classes.
- `suspicious.noEmptyInterface` is `"off"`.

Formatter settings: `indentStyle: "tab"`, `indentWidth: 3`, `lineWidth: 120`, `enabled: true`, `formatWithErrors: false`. `files.includes` is `["src/**/*.ts", "test/**/*.ts", "!**/node_modules/**/*", "!**/dist/**/*"]`. Run `npm run lint:fix` before committing so formatting never shows up as review noise.

The repository also standardizes on tabs for indentation and double quotes for strings (`AGENTS.md` "Style"). Use `import type` for all type-only imports and `node:` protocol for built-ins.

---

## Forbidden Patterns

From `AGENTS.md` and enforced by the configs above:

- No `any`, no avoidable `unknown` casts, no `@ts-ignore`, no `@ts-expect-error`, no `enum`. Use `as` only through the existing local patterns (`as never` in tests, `satisfies` for object literals like `ATOMIC_WRITE_OPERATIONS` and `{ ... } satisfies ConstrainedSamplingConfig`). Use string-literal unions such as `ApplyPatchOperation = "add" | "delete" | "update"` instead of enums.
- No Bun APIs; Node only.
- No imports from `@earendil-works/pi-coding-agent` internals. Only the documented public extension API is allowed: `defineTool`, `getLanguageFromPath`, `highlightCode`, `withFileMutationQueue`, `ExtensionAPI`, `ToolDefinition` in `src/index.ts`.
- No new hard-coded edit-tool names outside `STANDARD_EDIT_TOOL_NAMES`; that constant is the single source of truth for the tools `apply_patch` replaces.
- No second atomic-write path; all content writes go through `writeFileAtomic`.
- No `git add -A` or `git add .`; stage only the files you changed.
- No `git commit --no-verify`, no force pushes, no history rewriting on shared branches.

---

## Dependency Policy

`package.json` separates runtime peers from development pins:

- `peerDependencies` (with `"*"`): `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`. Pi provides these at runtime, so they must not move to `dependencies`.
- `devDependencies` pin the versions used for typecheck and tests: `@earendil-works/*` at `^0.84.3`, `@biomejs/biome` `2.5.5`, `@types/node` `^26.1.1`, `@typescript/native-preview` `^7.0.0-dev.20260707.2`, `typescript` `7.0.2`, `vitest` `^4.1.10`.
- The only runtime `dependency` is `diff` (`^9.0.0`), used by `createPatchDiff` and `renderInlineDiff`.

Adding a runtime dependency requires a strong reason: it ships to every user of the extension. Prefer a small local helper or a Node built-in. When bumping a peer version, also bump the matching `devDependencies` pin so `npm run typecheck` checks against the version you claim to support.

---

## Documentation and Release Sync

User-visible changes must be reflected in two places:

- `README.md` — the `Behavior` table, the "How the tool is exposed" section, and the `Tool` section describe activation rules and the two exposure modes. Update them when `isApplyPatchCapableModel`, the grammar, or the exposure behavior changes.
- `CHANGELOG.md` — add bullets under `## [Unreleased]` (`### Added` / `### Changed` / `### Fixed`) describing the change. Existing entries document activation rules and the `constrainedSampling` switch, so follow that level of specificity.
- `AGENTS.md` — update it when a repository-wide rule changes (for example, if the peer-dependency policy or the Codex compatibility rule changes).

The package version lives in `package.json` (`0.1.2` as of the current `[Unreleased]` cycle) and is not edited by ordinary feature PRs.

---

## Commit and Staging Conventions

- Terse technical commit messages; no emojis in commits, issues, PR comments, or code (`AGENTS.md` "Style").
- Stage only the files you changed. Do not use `git add -A` or `git add .`.
- No `git commit --no-verify`, no force pushes, and no history rewriting on shared branches.
- Keep generated `node_modules/`, lockfile churn, and unrelated formatting out of the commit.
- Before committing, run `npm run check` and `npm test` locally; CI runs the same commands plus `npm pack --dry-run`.
