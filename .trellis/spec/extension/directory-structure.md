# Directory Structure

> How source, tests, and config are laid out in `pi-apply-patch`, and when to add a file.

---

## Repository Layout

```text
src/
  index.ts              extension entry, tool definition, parsing, application, rendering, model gating
  write-file-atomic.ts  atomic file write helper with an injectable operations seam
test/
  index.test.ts         tool registration, toolset swapping, patch application, errors, atomic writes
  render.test.ts        render helpers and TUI component output
```

Top-level config that constrains this layout:

- `package.json` → `"pi": { "extensions": ["./src/index.ts"] }`. Pi loads the TypeScript entry directly; there is no compile step and no `dist/`.
- `tsconfig.json` → `"noEmit": true`, `"include": ["src/**/*", "test/**/*"]`. Type checking never emits JavaScript.
- `biome.json` → `"files": { "includes": ["src/**/*.ts", "test/**/*.ts", ...] }`. Formatting and linting cover only `src/` and `test/` TypeScript files.
- `vitest.config.ts` → `"include": ["test/**/*.test.ts"]`, `environment: "node"`. Tests live under `test/` and end in `.test.ts`.

There is no `dist/`, `build/`, `lib/`, or generated output to keep in sync.

---

## Responsibilities of Each Source File

### `src/index.ts`

Single module that owns the whole extension. It contains, in order, these concerns:

- The public tool contract: `APPLY_PATCH_PARAMS`, `APPLY_PATCH_FREEFORM_DESCRIPTION`, `APPLY_PATCH_LARK_GRAMMAR`.
- Input normalization: `normalizeApplyPatchArguments`, `stripPatchFence`, `stripHeredoc`, `normalizePatchText`.
- Model gating and toolset swapping: `isApplyPatchCapableModel`, `isOpenAIGptModel` (deprecated alias), `syncToolset`, `replaceEditToolsWithApplyPatch`, `replaceApplyPatchWithEditTools`, `withoutExtensionManagedEditTools`.
- Envelope parsing: `parsePatch`, `parseNonEmptyPatch`.
- Application: `seekSequence`, `replaceChunks`, `applySingleHunk`, `applyParsedPatchDetailed`, `applyPatchDetailed`, `applyPatch`.
- Recovery: `isRereadCandidate`, `createRecoveryInstructions`.
- Concurrency: `canonicalMutationPath`, `withPatchFileMutationQueues`.
- Rendering and previews: `truncatePreview`, `createPatchDiff`, `formatPatchPreview`, `renderPatchPreview`, `renderOpenCodeLikeDiff`, `getApplyPatchRenderState`, `clearApplyPatchRenderState`, plus the `renderCall` / `renderResult` implementations inside `createApplyPatchTool`.
- Extension wiring: `createApplyPatchTool`, `registerApplyPatchExtension`, and the default export `registerApplyPatchExtension`.

Why it stays one file: the package ships one extension and is loaded as a single entry. Splitting parsing, application, and rendering into separate modules would add import churn and `.js` suffix coordination without a build step to validate it, and the test suite already exercises these internals through the single `../src/index.js` import in `test/index.test.ts`. Keep new logic in `src/index.ts` unless it meets the file-creation bar below.

### `src/write-file-atomic.ts`

Separate because it is a self-contained filesystem primitive with a testable seam. It exports:

- `writeFileAtomic(absPath, content, operations?)` — temp file + rename with mode inheritance and `EEXIST` retry.
- `AtomicWriteOperations` — the injectable operations type used by the `EEXIST` test.
- `hasErrorCode(error, code)` — shared Node error-code predicate.

`src/index.ts` imports it as `import { hasErrorCode, writeFileAtomic } from "./write-file-atomic.js";`. Do not duplicate the temp-file/rename logic in `src/index.ts`; route every content write through `writeFileAtomic`.

---

## ESM Import Rules

`tsconfig.json` sets `"module": "Node16"`, `"moduleResolution": "Node16"`, and `"verbatimModuleSyntax": true`. Consequences enforced by `npm run check`:

- Relative imports must carry the `.js` extension even though the source is `.ts`:
  - `import { hasErrorCode, writeFileAtomic } from "./write-file-atomic.js";` (in `src/index.ts`)
  - `import { ... } from "../src/index.js";` and `import { writeFileAtomic } from "../src/write-file-atomic.js";` (in `test/index.test.ts`)
- Type-only imports must use `import type` because of `verbatimModuleSyntax`:
  - `import type { AgentToolResult } from "@earendil-works/pi-agent-core";`
  - `import type { ConstrainedSamplingConfig, Model } from "@earendil-works/pi-ai";`
  - `import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";`
  - biome's `style.useImportType` is set to `"error"`, so a value import used only as a type fails `npm run check`.
- Node built-ins are imported with the `node:` protocol: `import { mkdir, readFile, realpath, rm, stat } from "node:fs/promises";`, `import * as path from "node:path";`.

---

## Test Placement

- `test/index.test.ts` — tool registration, toolset swapping per model, argument normalization, patch application on real temp directories, parse/application errors, partial success and recovery, concurrency, and `writeFileAtomic` mode/`EEXIST` behavior.
- `test/render.test.ts` — pure render helpers (`truncatePreview`, `displayPath`, `formatPatchPreview`, `formatInFlightCallText`, `clearApplyPatchRenderState`) and `renderCall` / `renderResult` component output.

Shared test helpers are defined at the top of each test file rather than in a shared module: `createToolsetTestApi` and `createTempDirectory` in `test/index.test.ts`, and the `identityTheme` / `markerTheme` / `ansiTheme` fakes in both files. If you need a new helper used by only one file, keep it in that file.

---

## When to Add a New File

Adding a source file is justified only when the new code is a self-contained primitive with a stable public shape and its own tests, like `write-file-atomic.ts`. The practical bar:

- It has no dependency on the tool contract, parsing, or rendering internals.
- It can be tested through an injected seam (as `AtomicWriteOperations` is) instead of the whole extension.
- It exports names that make sense without knowing `apply_patch`.

Otherwise, extend `src/index.ts`. Avoid `utils.ts`, `helpers.ts`, or `types.ts` catch-alls; the existing types (`ParsedPatch`, `ApplyPatchResult`, `ApplyPatchPreview`, `ApplyPatchTheme`) are declared next to the code that uses them.

---

## Anti-Patterns

- Adding a `dist/` or compiled output directory. Pi loads `./src/index.ts` directly and `tsconfig.json` is `noEmit`.
- Relative imports without `.js`, or `import` instead of `import type` for type-only symbols.
- Creating a second atomic-write implementation instead of calling `writeFileAtomic`.
- Placing new tests outside `test/**/*.test.ts`; `vitest.config.ts` will not pick them up.
