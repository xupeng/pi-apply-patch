# Patch Application

> How the Codex envelope is parsed, how lines are matched, how files are written atomically, how concurrent writes are serialized, and how partial failures produce recovery instructions.

---

## Envelope Parsing

`parsePatch(patchText)` in `src/index.ts` is the parser. It normalizes first with `stripHeredoc(normalizePatchText(patchText).trim()).trim()`, splits on `\n`, then requires the first line to trim to `*** Begin Patch` and the last line to trim to `*** End Patch`. Missing or inverted markers throw `PatchParseError("Invalid patch format: expected *** Begin Patch ... *** End Patch envelope")`.

Inside the envelope it recognizes exactly three hunk headers plus the optional move marker:

- `*** Add File: <path>` — every following line up to the next `*** ` header must start with `+`; a non-`+` line throws ``PatchParseError(`Invalid patch format: Add File lines must start with '+'`)``. Content is the joined lines plus a trailing `\n`, or `""` for an empty add.
- `*** Delete File: <path>` — single-line hunk.
- `*** Update File: <path>` — followed by an optional `*** Move to: <path>`, then one or more change chunks.
- Any other `*** ` header throws ``PatchParseError(`'<line>' is not a valid hunk header. Valid hunk headers: ...`)``.

Update-chunk rules:

- Blank lines between chunks are skipped.
- The first chunk of a file may omit the `@@` marker (`allowMissingContext = chunks.length === 0`); later chunks that start a body without `@@` throw ``PatchParseError(`Expected update hunk to start with a @@ context marker, got: '<line>'`)``.
- `@@` lines are skipped; `@@ <text>` lines push onto the chunk's `changeContexts`.
- Body lines are classified by their first character: `" "` context (pushed to both `oldLines` and `newLines`), `"-"` removal (old only), `"+"` addition (new only), an empty line is treated as context, and any other character throws ``PatchParseError(`Unexpected line found in update hunk: '<line>'. ...`)``. A malformed character after at least one parsed line just ends the chunk so the outer loop can report the real header problem.
- `*** End of File` sets `isEndOfFile`; it is an error before any body line (`"Update hunk does not contain any lines"`).
- A chunk with zero body lines throws `"Update hunk does not contain any lines"`.
- An update with no chunks and no move throws ``PatchParseError(`Update file hunk for path '<path>' is empty`)``.

`parseNonEmptyPatch(patchText)` wraps `parsePatch` and rejects envelopes that contain no hunks:

- `*** Begin Patch\n*** End Patch` → `PatchParseError("patch rejected: empty patch")`.
- Any other no-hunk result → `PatchParseError("apply_patch verification failed: no hunks found")`.

`applyPatch`, `applyPatchDetailed`, and the `execute` path all go through `parseNonEmptyPatch`, so an empty envelope fails before any filesystem work.

Test coverage: `#given empty codex patch #when applying #then throws typed parse error`, `#given invalid codex hunk header #when executed #then reports parser diagnostic`, `#given codex multi operation freeform patch #when executed #then applies all operations`, `#given codex patch with contextual chunks #when executed #then applies chunks in order`, `#given codex patch with stacked contexts #when executed #then narrows before replacing`, `#given codex patch with heredoc wrapper #when executed #then strips wrapper`.

---

## Line Matching and Fuzz Levels

`seekSequence(lines, pattern, start, eof)` finds a contiguous run of `pattern` lines in `lines`. It returns `{ index, fuzz }` for the first match in the lowest fuzz tier, or `undefined`.

- Empty pattern → `{ index: start, fuzz: 0 }` (pure insertion point).
- Pattern longer than the file → `undefined`.
- Search window: `start` normally, but when `eof` is set and the file is long enough it searches from `lines.length - pattern.length`, so `*** End of File` matches only at the file ending.
- Four fuzz tiers, each a full pass over the window:
  - `0` — exact line equality (`line === expected`).
  - `1` — both sides `trimEnd()`.
  - `100` — both sides `trim()`.
  - `10000` — both sides `normalizeSeekLine()`.

`normalizeSeekLine(line)` trims and folds typographic variants: dashes (`‐‑‒–—―−` → `-`), single quotes (`‘’‚‛` → `'`), double quotes (`“”„‟` → `"`), and unicode spaces (`\u00A0\u2002-\u200A\u202F\u205F\u3000` → `" "`).

The loop tries tier `0` for every position before tier `1`, and so on, so an exact match late in the file beats a fuzzy match early in the file. The fuzz value is the tier that produced the match; `replaceChunks` sums it into `ApplyPatchResult.details.fuzz`.

Tests: `#given codex patch with fuzzy context #when executed #then matches like codex` (typographic quotes), `#given codex patch with end-of-file marker #when executed #then only matches file ending`, `#given fuzzy matches across hunks #when applying detailed #then aggregates fuzz score` (asserts `details.fuzz === 10001`, i.e. `1` + `10000` from the two hunks).

---

## Chunk Replacement

`replaceChunks(content, filePath, chunks)` returns `{ content, fuzz }`:

1. `splitFileLines` normalizes line endings and drops a single trailing empty line, so the internal line array never has a synthetic final blank.
2. For each `changeContext`, it runs `seekSequence(originalLines, [changeContext], lineIndex, false)`. A miss throws ``PatchApplicationError(`Failed to find context '<context>' in <filePath>`)``; a hit advances `lineIndex` past the context.
3. If the chunk has no `oldLines`, it is a pure insertion appended at the end of the file (before the preserved trailing newline) and does not consume lines.
4. Otherwise it searches for `oldLines` from `lineIndex` using `chunk.isEndOfFile`. If that fails and the pattern ends with an empty string, it retries after dropping the trailing empty element from both `pattern` and `newLines`. A second miss throws ``PatchApplicationError(`Failed to find expected lines in <filePath>:\n<oldLines>`)``.
5. Matches are collected into `replacements` and applied in descending `start` order so earlier indices remain valid; a final `""` element restores the trailing newline.

Because `oldLines`/`newLines` are matched as a block, apply hunks in the order they appear in the file; the extension does not reorder chunks. Ranges are not validated for overlap, matching Codex behavior.

Tests: `#given missing codex context #when executed #then reports expected lines`, `#given partial patch failure #when applying detailed #then accumulates applied and failed files`.

---

## Applying a Single Hunk

`applySingleHunk(cwd, hunk)` resolves `hunk.filePath` (and `hunk.movePath` when present) against `cwd` with `resolvePatchPath` (`path.resolve(cwd, filePath)`), then runs the filesystem work inside `withPatchFileMutationQueues`:

- **add** — `mkdir(path.dirname(absolutePath), { recursive: true })` then `writeFileAtomic(absolutePath, hunk.content)`. Summary `add: <path>`, fuzz `0`.
- **delete** — `stat(absolutePath)` first so a missing target surfaces as `ENOENT`, then `rm(absolutePath)`. Summary `delete: <path>`, fuzz `0`.
- **update without move** — `readFile(absolutePath, "utf-8")`, then `replaceChunks` (or identity when there are no chunks), then `writeFileAtomic(absolutePath, nextContent)`. Summary `update: <path>`.
- **update with move** — computes the new content, `mkdir`s the destination directory, `writeFileAtomic`s the destination, removes the source when the destination differs, and reports `move: <source> -> <dest>` with `appliedFile` set to the destination.

`applyParsedPatchDetailed(cwd, hunks, onProgress)` loops over hunks, catches per-hunk errors into `ApplyPatchFailure` records, accumulates `details.fuzz`, and calls `notifyApplyPatchProgress` after each hunk. `applyPatch(cwd, patchText)` is the fail-fast compatibility API: the first hunk failure throws `ApplyPatchError` with the partial `ApplyPatchResult` attached, and files already written before the failure stay written. The attached `details.fuzz` sums only successfully applied hunks, just like `applyPatchDetailed`; a failed hunk contributes nothing even if some of its chunks matched fuzzily. Later hunks are not executed, and successful calls still return `string[]` summaries.

Regression coverage: `#given $name before failure #when applying compat api #then preserves successful fuzz` checks zero, one, and multiple successful hunks, excludes fuzz from the failed hunk, and asserts persisted changes, fail-fast behavior, and unchanged recovery instructions.

Tests: `#given codex multi operation freeform patch #when executed #then applies all operations`, `#given rename-only codex patch #when executed #then moves file without changing content`, `#given parent traversal path #when applying patch #then applies outside cwd`, `#given absolute path outside cwd #when applying patch #then applies outside cwd`, `#given symlink escaping cwd #when executed #then applies patch`.

---

## Atomic Writes

All content writes go through `writeFileAtomic` in `src/write-file-atomic.ts`. It takes an optional `AtomicWriteOperations` object so tests can inject failures. The default is `ATOMIC_WRITE_OPERATIONS` (`writeFile`, `rename`, `unlink`, `stat`, `chmod` from `node:fs/promises`).

Sequence:

1. Build a sibling temp path `${absPath}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`.
2. `writeFile(tempPath, content, "utf-8")`. On failure, best-effort `unlink` the temp file and rethrow.
3. `stat(absPath)` to read `mode & 0o7777`. `ENOENT` (checked with `hasErrorCode`) means a new file, so no mode is inherited and umask defaults apply. Any other `stat` error cleans up the temp file and rethrows.
4. When a target mode was read, `chmod(tempPath, targetMode)`. This is what preserves the executable bit across `rename`, which otherwise replaces the inode and drops the original mode.
5. `rename(tempPath, absPath)`. If rename throws `EEXIST`, `unlink(absPath)` and rename again. Any other error cleans up the temp file and rethrows.

`cleanupTempFile` intentionally swallows `unlink` errors; a leftover temp file is preferable to masking the original failure.

Tests: `#given successful patch write #when applying patch #then atomic temp files are cleaned`, `#given eexist on rename #when writing atomically #then retries after unlink` (asserts the exact call order `["writeFile", "stat", "chmod", "rename:1", "unlink", "rename:2"]`), `#given existing executable file #when updating atomically #then keeps the executable bit`, `#given existing regular file #when updating atomically #then keeps the original mode`, `#given executable file #when applying update patch #then keeps the executable bit`.

---

## Concurrency and Mutation Queues

`withPatchFileMutationQueues(filePaths, operation)` serializes concurrent mutations that touch the same file:

- `canonicalMutationPath` resolves each path with `realpath`, falling back to `path.resolve(filePath)` on `ENOENT` (checked with `hasErrorCode`), so queued writes to the same target share a key.
- Results are deduplicated and sorted with `localeCompare`, giving a deterministic lock order and preventing deadlocks when two operations lock the same pair of paths in different order (relevant for update-with-move, which locks both source and destination).
- `runQueued(index)` nests `withFileMutationQueue(filePath, () => runQueued(index + 1))` from `@earendil-works/pi-coding-agent`, so all canonical paths are locked before `operation()` runs. The innermost call is the actual filesystem work.

Tests: `#given concurrent patches to different lines in one file #when applied #then preserves both updates` (must observe `FIRST\nSECOND\n`, not a lost update), `#given concurrent update and move of one file #when applied #then produces a serialized outcome` (accepts either ordering but requires a consistent final file).

Use `withPatchFileMutationQueues` for any new filesystem mutation that touches resolved absolute paths. `withFileMutationQueue` alone is the pi primitive and only locks one path; do not call it directly from extension code.

---

## Partial Success and Recovery Instructions

`applyParsedPatchDetailed` sets `hasPartialSuccess` to `appliedFiles.length > 0 && failures.length > 0`. Each `ApplyPatchFailure` is `{ filePath, operation, message, code? }`; `code` is lifted from the error object by an inline `"code" in error` check (not `hasErrorCode`) so filesystem codes like `ENOENT` survive into the result.

`createRecoveryInstructions(result)` builds `ApplyPatchRecoveryInstructions`:

- `mustReadFiles` — unique failed paths where `isRereadCandidate` is true.
- `mustNotReadFiles` — unique applied paths that are not in `mustReadFiles`.
- `failedFiles` — unique failed paths.

`isRereadCandidate(failure)` returns `failure.code === undefined`. The reasoning is encoded in the code comment: `ENOENT` (missing file), `EACCES`/`EPERM` (permissions), and `ENOTDIR`/`EISDIR` (path shape) are not context mismatches, so rereading will not fix them. Only context-line failures thrown by `replaceChunks` have no `code`, and those are exactly the cases where rereading the file gives the model the current content it needs to rewrite the `@@` context.

`execute` renders this into the failure text: `"apply_patch partially failed."` or `"apply_patch failed."`, a `Failed:` list of `- <path> (<operation>): <message>`, an optional `"Recovery: MUST read <paths> before retrying."`, an `"Earlier file actions in this patch were already applied."` or `"No file actions were applied."` line, and an optional `"Recovery: MUST NOT reread other files from this patch unless a specific dependency requires it."`.

Tests: `#given partial patch failure #when applying detailed #then accumulates applied and failed files` (asserts `mustReadFiles`/`mustNotReadFiles`), `#given partial patch failure #when applying compat api #then fails fast after first error`, `#given apply patch tool partial failure #when executed #then returns recovery instructions text`, `#given apply patch tool complete failure #when executed #then does not report partial failure`, `#given update of missing file #when executed #then discloses ENOENT reason without reread advice`, `#given context mismatch on existing file #when executed #then discloses reason with reread advice`.

---

## Patch Previews and Truncation

`createPatchPreview(cwd, hunks)` resolves each hunk and builds per-file diffs with `createPatchDiff` (using the `diff` package's `diffLines`), reporting `added`/`removed` counts and an `operation` of `add`/`update`/`delete`. An `*** Add File` over an existing file is reported as `update`, which is why the pending preview for overwriting an add shows removed content.

`truncatePreview(text)` keeps previews bounded for the TUI:

- `PATCH_PREVIEW_MAX_LINES = 16` and `PATCH_PREVIEW_MAX_CHARS = 4000` are exported and used by `test/render.test.ts`.
- `PATCH_PREVIEW_HEAD_LINES = 8`, `PATCH_PREVIEW_TAIL_LINES = 16 - 8 - 1 = 7`, and `PATCH_PREVIEW_TRUNCATION_MARKER = "…"`.
- `createChangedHunkPreview` centers the window on the first run of changed lines (`isChangedPreviewLine` matches `^[+-]\s*\d+\s`), then grows the window symmetrically until it reaches the line budget, so a changed hunk stays visible.
- When no changed hunk is found, it falls back to the first 8 and last 7 lines joined by `…`.
- `enforcePreviewCharLimit` clamps the result to `PATCH_PREVIEW_MAX_CHARS` including the marker.

Tests: `#given large patch preview #when truncating #then keeps changed hunk visible`, `#given large generated diff #when truncating #then centers preview around first changed line`, plus `truncatePreview` cases in `test/render.test.ts` (`#given plain text diff #when truncating #then falls back to head and tail`, `#given huge payload #when truncating #then enforces max chars`, `#given oversized changed hunk #when truncating #then keeps max chars strict`).
