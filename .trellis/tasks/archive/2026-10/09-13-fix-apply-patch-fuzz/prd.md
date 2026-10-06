# Fix applyPatch failure fuzz reporting

## Goal

Preserve accumulated fuzz from successfully applied hunks in applyPatch failure results and add regression coverage.

## Requirements

- When `applyPatch()` fails after successfully applying earlier file hunks, `ApplyPatchError.result.details.fuzz` must retain the total fuzz contributed by those successful hunks instead of always reporting zero.
- Count only successfully applied hunks, consistent with `applyPatchDetailed()`; a failed hunk must not contribute to the total.
- Preserve fail-fast behavior, the successful `string[]` return shape, already-applied file changes, and recovery instructions.
- Keep parser matching rules, fuzz weights, tool activation, and rendering behavior unchanged.
- Update the extension spec that currently documents the zero-fuzz limitation.

## Acceptance Criteria

- [x] A fuzzy successful hunk followed by a failing hunk reports the earlier hunk's nonzero fuzz in `ApplyPatchError.result.details.fuzz`.
- [x] Multiple successful fuzzy hunks followed by failure report their sum.
- [x] Failure before any successful hunk and exact-match successes followed by failure report zero.
- [x] Tests confirm earlier changes remain applied and subsequent hunks are not executed after the first failure.
- [x] Existing success returns and recovery instructions remain compatible.
- [x] `npm test`, `npm run check`, and `git diff --check` pass.
- [x] Relevant `.trellis/spec/extension/` documentation reflects the corrected behavior.

## Verification

- Check-agent review: successful-hunk-only fuzz accumulation matches `applyPatchDetailed()`; failed chunks do not contribute, fail-fast and recovery contracts remain unchanged.
- `npm test`: 84 tests passed; exit 0.
- `npm run check`: typecheck and lint passed; exit 0. Existing npm environment warning and Biome configuration deprecation info remain outside this task's scope.
- `git diff --check`: exit 0.

## Notes

- This is a lightweight, PRD-only task discovered during the bootstrap spec review.
- The user confirmed this scope and authorized implementation; the task is active.
