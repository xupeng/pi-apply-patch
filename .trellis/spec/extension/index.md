# Extension Development Guidelines

> Coding conventions for `pi-apply-patch`, a single-package pi extension that registers the `apply_patch` tool.

---

## Overview

`pi-apply-patch` is one npm package with one extension entry (`src/index.ts`) and one helper module (`src/write-file-atomic.ts`). There is no backend/frontend split, no build step, and no runtime framework. These specs document how the code in `src/` and `test/` actually behaves so future edits stay compatible with the Codex patch contract and with the `pi-coding-agent` extension API.

Start with `README.md` for user-facing behavior, then read the files below before changing code.

---

## Guidelines Index

| Guide | Description | Read it when |
|-------|-------------|--------------|
| [Directory Structure](./directory-structure.md) | File layout, ESM import rules, when to add files | Adding, moving, or splitting a source or test file |
| [Tool Contract](./tool-contract.md) | Codex-compatible schema/grammar/description, argument normalization, `constrainedSampling`, model gating and toolset swapping | Touching the tool definition, prompt text, grammar, argument handling, or `isApplyPatchCapableModel` / `syncToolset` |
| [Patch Application](./patch-application.md) | Envelope parsing, `seekSequence` fuzz levels, `replaceChunks`, atomic writes, mutation queues, partial-success recovery | Changing parsing, matching, file writes, concurrency, or recovery instructions |
| [Error Handling](./error-handling.md) | Error classes, `ApplyPatchResult` shape, `hasErrorCode`, throw-vs-return boundaries, render degradation | Adding failure paths or deciding whether to throw, return, or log |
| [Testing Guidelines](./testing-guidelines.md) | vitest setup, test naming, temp directories, test harnesses, `it.each` tables, which test file covers what | Writing or updating any test |
| [Quality Guidelines](./quality-guidelines.md) | `npm test` / `npm run check` gates, CI matrix, strict tsconfig, biome rules, forbidden patterns, release/commit rules | Before opening a PR or changing tooling/config |

General thinking guides live in [`../guides/`](../guides/index.md); they are repository-agnostic and are not repeated here.

---

## Pre-Development Checklist

Run through this before writing code in this repository:

- [ ] Read `AGENTS.md` and `README.md`. `AGENTS.md` holds the hard repository rules (no `any`, no enums, no Bun APIs, stage only your own files).
- [ ] Identify the area you are changing and read the matching guide from the table above.
- [ ] For tool definition work (schema, grammar, description, prompts, model gating), read [Tool Contract](./tool-contract.md) and keep `APPLY_PATCH_PARAMS`, `APPLY_PATCH_FREEFORM_DESCRIPTION`, and `APPLY_PATCH_LARK_GRAMMAR` byte-for-byte compatible with the Codex golden source unless the change is an intentional divergence.
- [ ] For filesystem work, read [Patch Application](./patch-application.md); all writes go through `writeFileAtomic` from `src/write-file-atomic.ts`.
- [ ] For new failure paths, read [Error Handling](./error-handling.md) and decide between throwing and returning a structured `ApplyPatchResult`.
- [ ] For every behavior change, read [Testing Guidelines](./testing-guidelines.md) and add or update the test named in its change-to-test map.
- [ ] Plan the verification commands: `npm test` and `npm run check` must pass; `npm pack --dry-run` is part of CI.
- [ ] If user-visible behavior changed, update `README.md` and add a `CHANGELOG.md` entry under `## [Unreleased]`.
- [ ] Stage only the files you edited. Do not run `git add -A` or `git add .`.
