# Error Handling

> Error classes, the structured result shape, Node error-code checks, and the boundary between throwing and returning a result.

---

## Error Classes

Three exported classes live in `src/index.ts` and each has a single owner:

| Class | Thrown by | Meaning | Carries |
|-------|-----------|---------|---------|
| `PatchParseError` | `parsePatch`, `parseNonEmptyPatch` | The envelope or hunks are malformed or empty | Message only |
| `PatchApplicationError` | `replaceChunks` | A `@@` context or expected line block was not found | Message only |
| `ApplyPatchError` | `applyPatch` (fail-fast API) | A hunk failed during the compatibility API | `failures: ApplyPatchFailure[]` and `result: ApplyPatchResult` |

`ApplyPatchError` is the only error that carries state. Its constructor takes `(message, result)`, copies `result.failures` and `result` onto the instance, sets `this.name = "ApplyPatchError"`, and exposes `hasPartialSuccess()` which delegates to `result.hasPartialSuccess`. `PatchParseError` and `PatchApplicationError` only set their `name`.

Use these classes rather than generic `Error`:

- Parse-shape problems → `PatchParseError`.
- Match/context problems during replacement → `PatchApplicationError`.
- Fail-fast application wrappers → `ApplyPatchError`.

Raw filesystem errors from `node:fs/promises` (`ENOENT`, `EACCES`, `EEXIST`, …) are not wrapped; they propagate with their `code` property intact, which is what the recovery logic keys on.

---

## Structured Result Shape

`ApplyPatchResult` is the application contract returned by `applyPatchDetailed` and embedded in tool details:

```ts
type ApplyPatchResult = {
	summaries: string[];
	appliedFiles: string[];
	failures: ApplyPatchFailure[];
	hasPartialSuccess: boolean;
	recoveryInstructions: ApplyPatchRecoveryInstructions;
	details: { fuzz: number };
};
```

`ApplyPatchFailure` is `{ filePath: string; operation: "add" | "delete" | "update"; message: string; code?: string | undefined }`. `ApplyPatchRecoveryInstructions` is `{ mustReadFiles: string[]; mustNotReadFiles: string[]; failedFiles: string[] }`. The semantics of these fields are documented in [Patch Application](./patch-application.md).

`applyParsedPatchDetailed` initializes `recoveryInstructions` to empty arrays and then overwrites it with `createRecoveryInstructions(result)` before returning. Do not return an `ApplyPatchResult` with a missing recovery block; downstream text generation in `execute` reads `result.recoveryInstructions.mustReadFiles` and `.mustNotReadFiles` unconditionally.

`ApplyPatchToolDetails` is `{ preview?: ApplyPatchPreview; progress?: ApplyPatchProgress; result?: ApplyPatchResult }` and is the `details` payload of every tool update and final result.

---

## Node Error-Code Checks

`hasErrorCode(error, code)` is exported from `src/write-file-atomic.ts` and re-exported nowhere else. It returns true only when the error is an object with a matching `code` string. Use it for control-flow decisions on filesystem errors:

- `readExistingFileForPreview` in `src/index.ts` returns `""` on `hasErrorCode(error, "ENOENT")` and rethrows anything else.
- `canonicalMutationPath` falls back to `path.resolve` on `hasErrorCode(error, "ENOENT")` and rethrows anything else.
- `writeFileAtomic` uses it for the mode-inheritance `stat` (`ENOENT` means new file) and for the rename retry (`EEXIST` triggers unlink + retry).

Note one deliberate exception: `applyParsedPatchDetailed` and `applyPatch` extract `failure.code` with an inline `"code" in error && typeof error.code === "string"` check instead of `hasErrorCode`, because they want to preserve any code (not test for a specific one). Keep that inline form when adding failure bookkeeping; use `hasErrorCode` when branching on a specific code.

---

## Throw vs Return in `execute`

`createApplyPatchTool().execute` is the tool boundary. The rule is: **syntax and preconditions throw; per-file application problems return a structured result.**

It throws in exactly two places:

1. `throw new Error("input is required")` when `normalizeApplyPatchArguments(params)` yields an empty `input`.
2. `parseNonEmptyPatch` propagated out of `execute` when the patch text is malformed or empty. The code parses once into `parsedHunks` inside a `try`/`catch` (so `createPendingPatchUpdate` can still render partial text), but the application call uses `parsedHunks ?? parseNonEmptyPatch(normalizedParams.input)`, so a parse failure is re-raised and reaches the caller as `PatchParseError`.

It does **not** throw when hunks fail during application. `applyParsedPatchDetailed` catches each hunk error, records it in `failures`, and `execute` returns a normal `AgentToolResult` whose text starts with `"apply_patch failed."` or `"apply_patch partially failed."` and whose `details.result` holds the full `ApplyPatchResult`. This is intentional: the model must see the failure and the recovery instructions as tool output, not as a transport error.

The compatibility API `applyPatch(cwd, patchText)` behaves differently on purpose: it throws `ApplyPatchError` on the first hunk failure, attaching the partial result, and it reports `details.fuzz` as `0` because it does not aggregate fuzz. Use `applyPatchDetailed` when you need per-hunk outcomes.

Tests: `#given empty codex patch #when applying #then throws typed parse error`, `#given invalid codex hunk header #when executed #then reports parser diagnostic`, `#given missing codex context #when executed #then reports expected lines`, `#given apply patch tool partial failure #when executed #then returns recovery instructions text`, `#given apply patch tool complete failure #when executed #then does not report partial failure`.

---

## Degradation in the Render Layer

Rendering must never change the outcome of a patch or hide its recovery details. Three places swallow errors and degrade instead of throwing:

- `getApplyPatchRenderState` wraps `parsePatch` in `try`/`catch` and leaves `collapsed`/`expanded` empty for incomplete or invalid patch text; `renderCall` then falls back to the `formatInFlightCallText` label.
- `renderPatchPreview` wraps the OpenCode-style highlighted rendering in `try`/`catch` and falls back to `formatPatchPreview` with manual `theme.fg` coloring.
- `highlightDiffContent` catches `highlightCode` failures and returns the plain (tab-expanded) content.
- `notifyApplyPatchProgress` catches progress-callback errors so a failing TUI update cannot abort application; this is asserted by `#given progress callback throws #when applying detailed patch #then still applies all operations`.

Add new render-time fallbacks in the same shape: `try` the rich path, `catch` and continue with a simpler representation. Never let a render helper write files or re-run application logic.

---

## Anti-Patterns

- Throwing a raw `Error` for a parse or match failure instead of `PatchParseError`/`PatchApplicationError`.
- Throwing out of `execute` for a per-file failure; the model needs the structured failure text.
- Wrapping `ENOENT`/`EACCES` in a custom error and losing `code`; recovery classification depends on it.
- Using string matching on `error.message` to detect `ENOENT`/`EEXIST` instead of `hasErrorCode`.
- Adding a `catch` that returns an empty success result; failures must remain visible in `ApplyPatchResult.failures`.
