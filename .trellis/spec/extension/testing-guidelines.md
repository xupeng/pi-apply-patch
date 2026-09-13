# Testing Guidelines

> vitest conventions, test naming, real-filesystem fixtures, the shared test harnesses, and which test file covers which change.

---

## Runner and Environment

- `vitest.config.ts` sets `include: ["test/**/*.test.ts"]`, `environment: "node"`, and `pool: "threads"`. New tests must live under `test/` and end in `.test.ts` or they will not run.
- `npm test` runs `vitest --run` (`package.json` script `test`). `npm run test:watch` runs `vitest` in watch mode.
- Tests import the extension through source paths with the `.js` suffix: `from "../src/index.js"` and `from "../src/write-file-atomic.js"`.
- The suite runs on plain Node 22 in CI (`ubuntu-latest` and `macos-latest`, per `.github/workflows/ci.yml`). Do not add browser or JSDOM-dependent tests.

---

## Test Naming and Structure

Test names follow the `#given .. #when .. #then` convention used across `test/index.test.ts` and `test/render.test.ts`, for example:

- `#given extension #when registered #then exposes apply_patch tool with grammar constrained sampling`
- `#given partial patch failure #when applying detailed #then accumulates applied and failed files`
- `#given eexist on rename #when writing atomically #then retries after unlink`

Bodies use `// given`, `// when`, `// then` comments to mark the three phases (the repository `AGENTS.md` allows either the description style or the body comments; the suite uses both together). Keep the given/when/then boundaries aligned with the actual setup, call, and assertion blocks so a failing test points at one phase.

Use `describe` to group by area. `test/index.test.ts` uses one `describe("pi-apply-patch", ...)`; `test/render.test.ts` uses `describe("render helpers", ...)`.

---

## Real Filesystems, Not Mocks

Application tests use real temporary directories created by `createTempDirectory()` in `test/index.test.ts`:

```ts
async function createTempDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(process.cwd(), "test-temp-"));
	tempDirectories.push(directory);
	return directory;
}
```

A module-level `afterEach` removes every pushed directory with `rm(directory, { recursive: true, force: true })`. Follow this pattern:

- Create files with `writeFile`/`chmod` and assert with `readFile`/`stat`/`readdir` instead of mocking `node:fs`.
- When a test needs a missing file, do not create it and assert `rejects.toMatchObject({ code: "ENOENT" })`.
- Use `symlink` for path-resolution cases (`#given symlink escaping cwd #when executed #then applies patch`) and `chmod 0o755`/`0o640` for mode-preservation cases.
- Pass `{ cwd: directory } as never` as the tool context to `execute`, and pass the directory directly to `applyPatch`/`applyPatchDetailed`.

Only `writeFileAtomic`'s internals are faked, and only through its `AtomicWriteOperations` seam (`#given eexist on rename #when writing atomically #then retries after unlink`). Prefer the injectable-operations seam over module mocking when you need to force a filesystem error.

---

## Test Harnesses

### `createToolsetTestApi` (`test/index.test.ts`)

Builds a fake `ApplyPatchExtensionAPI` to test toolset swapping without a live pi session. It:

- Records registered tools through a no-op `registerTool`.
- Collects `on(eventName, handler)` subscriptions into a `Map`, filtering out non-function handlers with the local `isToolsetHandler` guard.
- Tracks active tools through `getActiveTools`/`setActiveTools` and records every `setActiveTools` call for inspection via `getSetActiveToolsCalls`.
- Exposes `trigger(eventName, model)` which invokes each handler for that event with `{ model }` (or `{}` when no model) and `{ model }` as the context — this mirrors the `event.model` vs `ctx.model` split described in [Tool Contract](./tool-contract.md).

Use it for any change to `syncToolset`, `isApplyPatchCapableModel`, or the `session_start` / `model_select` / `before_agent_start` subscriptions. `harness.setActiveTools([...])` simulates an external tool change before `before_agent_start` is triggered.

### Theme fakes (`test/index.test.ts` and `test/render.test.ts`)

The render tests never use a real TUI theme. Three fakes cover different assertions:

- `identityTheme` — `fg`/`bg`/`bold`/`inverse` return their text unchanged. Use it when asserting plain preview text and structure (`formatPatchPreview`, `renderCall`, collapsed `renderResult`). Defined in both test files.
- `markerTheme` — wraps each call as `<fg:name>text</fg:name>`, `<bg:name>text</bg:name>`, `<bold>text</bold>`, `<inverse>text</inverse>`. Use it to assert the exact color roles applied to each token, e.g. `renderResult` producing `<bg:toolErrorBg><fg:toolDiffRemoved>-</fg:toolDiffRemoved>...` and `<fg:toolDiffAdded>alpha <inverse>new</inverse></fg:toolDiffAdded>`. Defined in `test/render.test.ts`.
- `ansiTheme` — emits real background ANSI codes (`successBg = "\x1b[48;2;40;50;40m"`, `bgReset = "\x1b[49m"`). Use it to assert escape-sequence ordering, e.g. `#given highlighted diff row #when rendering result in success box #then outer background resumes after row reset` checks that `${bgReset}${successBg}` appears after a nested reset. Defined in `test/render.test.ts`.

Render results are asserted by rendering the component: `component?.render(width).join("\n") ?? ""`, then `expect(rendered).toContain(...)`. Pass the context object as `as never` in the documented shape, e.g. `{ argsComplete: true, cwd, toolCallId }` for `renderCall` and `{ expanded, isPartial }` plus `{ cwd, toolCallId, args: { input: "" } }` for `renderResult`.

### `it.each` tables

Parameterized cases are preferred over copy-pasted `it` blocks:

- `it.each(["session_start", "model_select", "before_agent_start"])` drives the toolset-swap test across all three events.
- The activation table starting at `#given model %j #when checking CLIProxyAPI support #then activation is %s` pairs `{ provider, api?, id }` objects with an expected boolean and asserts both `isApplyPatchCapableModel` and the `isOpenAIGptModel` alias.

When you add a provider, API, or event to the extension, add a row to the relevant table instead of writing a new standalone test.

---

## Change-to-Test Map

| Change | Update this test file / case |
|--------|------------------------------|
| `APPLY_PATCH_PARAMS`, `APPLY_PATCH_FREEFORM_DESCRIPTION`, `APPLY_PATCH_LARK_GRAMMAR`, `constrainedSampling` | `test/index.test.ts` → `#given extension #when registered #then exposes apply_patch tool with grammar constrained sampling` |
| `normalizeApplyPatchArguments`, `stripPatchFence`, heredoc/CRLF normalization | `test/index.test.ts` → `#given markdown-fenced patch argument #when preparing arguments #then strips the fence`, `#given codex patch with heredoc wrapper #when executed #then strips wrapper` |
| `isApplyPatchCapableModel`, `GPT_APPLY_PATCH_PROVIDERS`, `GPT_APPLY_PATCH_APIS`, `APPLY_PATCH_MODEL_ID_PREFIXES` | `test/index.test.ts` → the activation `it.each` table and `#given model metadata #when checking apply_patch activation #then matches GPT and any DeepSeek model` |
| `syncToolset`, `withoutExtensionManagedEditTools`, `replaceEditToolsWithApplyPatch`, `replaceApplyPatchWithEditTools`, event subscriptions | `test/index.test.ts` → the `createToolsetTestApi` cases, including the three-event `it.each` |
| `parsePatch`, `parseNonEmptyPatch` | `test/index.test.ts` → the empty-patch, invalid-header, contextual-chunk, stacked-context, and multi-operation cases |
| `seekSequence`, `normalizeSeekLine`, fuzz levels | `test/index.test.ts` → `#given codex patch with fuzzy context #when executed #then matches like codex`, the end-of-file case, `#given fuzzy matches across hunks #when applying detailed #then aggregates fuzz score` |
| `replaceChunks`, `splitFileLines` | `test/index.test.ts` → `#given missing codex context #when executed #then reports expected lines`, partial-failure cases |
| `applySingleHunk`, `applyPatchDetailed`, `applyPatch` | `test/index.test.ts` → multi-operation, rename-only, path-escape, symlink, and partial-failure/progress cases |
| `createRecoveryInstructions`, `isRereadCandidate` | `test/index.test.ts` → partial-failure, missing-file, and context-mismatch tool-execution cases |
| `writeFileAtomic`, `hasErrorCode`, `AtomicWriteOperations` | `test/index.test.ts` → the atomic-cleanup, `EEXIST`-retry, and mode-preservation cases |
| `withPatchFileMutationQueues`, `canonicalMutationPath` | `test/index.test.ts` → `#given concurrent patches to different lines in one file #when applied #then preserves both updates` and `#given concurrent update and move of one file #when applied #then produces a serialized outcome` |
| `truncatePreview`, `PATCH_PREVIEW_MAX_LINES`, `PATCH_PREVIEW_MAX_CHARS` | `test/render.test.ts` → the three `truncatePreview` cases; large-preview render case |
| `displayPath`, `formatPatchPreview`, `formatInFlightCallText`, `clearApplyPatchRenderState` | `test/render.test.ts` → the formatting/caching cases |
| `renderCall`, `renderResult`, `renderPatchPreview`, `applyLayeredBackground` | `test/render.test.ts` → the component-output cases (plain via `identityTheme`, roles via `markerTheme`, escape order via `ansiTheme`) |

If a change spans several rows, update every mapped case. Do not weaken an assertion to make a change pass; adjust the asserted value only after confirming the new behavior is intended.

---

## Anti-Patterns

- Mocking `node:fs/promises` instead of using `createTempDirectory`.
- Adding tests that pass without exercising the changed behavior (for example, asserting only that a function does not throw when the behavior is a return value).
- Adding a standalone `it` for a new provider/event when an existing `it.each` table is the established pattern.
- Snapshot-testing TUI output; the suite asserts specific strings and escape sequences instead.
- Leaving temp directories behind by creating them without registering them in `tempDirectories`, or by skipping the module-level `afterEach`.
