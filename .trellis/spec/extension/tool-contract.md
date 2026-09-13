# Tool Contract

> The `apply_patch` tool definition, its Codex compatibility guarantees, argument normalization, the two exposure modes, and model gating.

---

## What Must Stay Codex-Compatible

`AGENTS.md` requires the tool schema, grammar, and descriptions to stay byte-for-byte compatible with Codex unless the change is an intentional divergence. The three constants at the top of `src/index.ts` are that contract:

| Symbol | Location | Role |
|--------|----------|------|
| `APPLY_PATCH_PARAMS` | `src/index.ts` | TypeBox object `{ input: string }` used as the function-tool parameters |
| `APPLY_PATCH_FREEFORM_DESCRIPTION` | `src/index.ts` (exported) | Tool description shown to the model |
| `APPLY_PATCH_LARK_GRAMMAR` | `src/index.ts` (exported) | Codex patch Lark grammar used for grammar-constrained sampling |

`APPLY_PATCH_LARK_GRAMMAR` defines the accepted envelope and hunk grammar:

```text
start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?
hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
...
change_move: "*** Move to: " filename LF
change_context: ("@@" | "@@ " /(.+)/) LF
eof_line: "*** End of File" LF
```

The golden source for these strings is the upstream Codex `apply_patch` tool, mirrored from `packages/coding-agent/src/core/extensions/builtin/gpt-apply-patch.ts` in `code-yeongyu/senpi-mono` (see the `Origin` section of `README.md`).

Rule: before editing any of the three constants or the grammar, read the golden source, update the copy here, and update the tests in `test/index.test.ts` that pin them — at minimum `#given extension #when registered #then exposes apply_patch tool with grammar constrained sampling`, which asserts `capturedDescription` equals `APPLY_PATCH_FREEFORM_DESCRIPTION` and `capturedSampling` equals `{ type: "grammar", variants: { openai_lark: APPLY_PATCH_LARK_GRAMMAR } }`. Never change the strings and leave the tests asserting the old values, and never change the tests to match a string you did not verify against the golden source.

---

## Tool Registration

`createApplyPatchTool()` builds the tool with `defineTool` from `@earendil-works/pi-coding-agent` and then attaches grammar sampling with `Object.assign`:

- `name: "apply_patch"`, `label: "ApplyPatch"`.
- `description: APPLY_PATCH_FREEFORM_DESCRIPTION`.
- `parameters: APPLY_PATCH_PARAMS`.
- `prepareArguments: normalizeApplyPatchArguments` (pi calls this before `execute`).
- `constrainedSampling: { type: "grammar", variants: { openai_lark: APPLY_PATCH_LARK_GRAMMAR } }` — typed as `ConstrainedSamplingConfig` from `@earendil-works/pi-ai` and required by the local `ApplyPatchToolDefinition` type.
- `promptSnippet: "Apply Codex-format file patches with apply_patch"`.
- `promptGuidelines` — five strings instructing the model to prefer `apply_patch` over bash/heredoc edits, to send one call per patch, to pass the patch through the `input` parameter when exposed as a function tool, not to re-read files after success, and to re-read only the files named in the recovery instructions after a failure.

`registerApplyPatchExtension(pi)` is the extension entry and default export. It calls `pi.registerTool(createApplyPatchTool())` and then subscribes to the three toolset events described below.

The extension imports only the public `pi-coding-agent` API: `defineTool`, `getLanguageFromPath`, `highlightCode`, `withFileMutationQueue`, and the `ExtensionAPI` / `ToolDefinition` types. Do not reach into pi-coding-agent internals.

---

## Two Exposure Modes

Pi decides how the model sees `apply_patch` based on the model's `compat.supportsOpenAIGrammarTools` setting. The extension always supplies both the grammar config and the function parameters; pi selects one:

1. **Grammar tool (native Responses endpoints).** When `compat.supportsOpenAIGrammarTools: true` is set on the model (for example official DeepSeek or OpenCode Go Responses models in `models.json`), pi exposes `apply_patch` as an OpenAI custom grammar tool. The model is constrained to emit the raw Codex patch text (`*** Begin Patch` … `*** End Patch`) with no JSON wrapping and no escaping. `prepareArguments` still runs and accepts a raw string argument.
2. **Function tool (Chat Completions and other endpoints).** When grammar tools are disabled or absent, pi falls back to a plain function tool built from `APPLY_PATCH_PARAMS`. The model calls it with `{ "input": "<patch>" }`.

How this is documented for users: the "How the tool is exposed" and "Tool" sections of `README.md`. Keep `README.md` in sync when the exposure behavior changes.

---

## Argument Normalization

`normalizeApplyPatchArguments(args)` is the single entry point and is used both as `prepareArguments` and again inside `execute` (defensive re-normalization of the already-prepared params). It accepts:

- A raw string → `{ input: stripPatchFence(args) }`.
- An object with a string `input` → `{ input: stripPatchFence(input) }`.
- Anything else (including `{ input: <non-string> }`) → `{ input: "" }`, which `execute` converts into a thrown `Error("input is required")`.

Supporting helpers, all in `src/index.ts`:

- `stripPatchFence(input)` — removes a wrapping markdown fence matching `/^```(?:patch|diff)?\s*\n([\s\S]*?)```\s*$/`. Covered by `#given markdown-fenced patch argument #when preparing arguments #then strips the fence` in `test/index.test.ts`.
- `stripHeredoc(input)` — removes a `cat <<'EOF' … EOF` / `<<'EOF' … EOF` wrapper matching `/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/`. Applied in `extractPatchedPaths` and `parsePatch`, not in `normalizeApplyPatchArguments`. Covered by `#given codex patch with heredoc wrapper #when executed #then strips wrapper`.
- `normalizePatchText(patchText)` — rewrites `\r\n` and lone `\r` to `\n`; called by `parsePatch`, `parseNonEmptyPatch`, and `splitFileLines`.

Order matters: fencing is stripped at the argument boundary, heredoc and CRLF normalization happen at the parsing boundary. When adding another accepted wrapper, add a helper next to these and test it through `applyPatch` or `prepareArguments`; do not inline ad-hoc regexes in `execute`.

---

## Model Gating

Constants in `src/index.ts` define who gets `apply_patch`:

- `APPLY_PATCH_MODEL_ID_PREFIXES = ["gpt-", "deepseek-"]` — the model `id` must start with one of these.
- `GPT_APPLY_PATCH_PROVIDERS = new Set(["openai", "openai-codex", "azure-openai-responses", "github-copilot"])`.
- `GPT_APPLY_PATCH_APIS = new Set(["openai-responses", "openai-codex-responses", "cliproxyapi-codex-responses"])`.

`isApplyPatchCapableModel(model)` returns:

- `false` when `model` is undefined or `model.id` starts with neither prefix.
- `true` for any `deepseek-` id, unconditionally, regardless of provider or API.
- For `gpt-` ids, `true` when `model.provider` is in `GPT_APPLY_PATCH_PROVIDERS` **or** `model.api` is defined and in `GPT_APPLY_PATCH_APIS`.

`isOpenAIGptModel` is an exported deprecated alias that simply calls `isApplyPatchCapableModel`; keep both returning the same result.

The activation matrix is pinned by `test/index.test.ts`:

- The `it.each` table starting at `#given model %j #when checking CLIProxyAPI support #then activation is %s` covers renamed providers, missing `api`, non-allowlisted custom APIs, DeepSeek on every API, and unrelated ids.
- `#given model metadata #when checking apply_patch activation #then matches GPT and any DeepSeek model` covers allowlisted providers, Responses/Codex APIs, `openai-completions` DeepSeek, and the legacy `isOpenAIGptModel` alias.

When adding a provider or API to a set, add a row to the `it.each` table and a case to the metadata test.

---

## Toolset Swapping

`syncToolset(pi, model)` reconciles the active tool list on every relevant model/session event:

- Capable model → `pi.setActiveTools(replaceEditToolsWithApplyPatch(currentToolNames))`.
- Not capable → `pi.setActiveTools(replaceApplyPatchWithEditTools(currentToolNames))`.

Both helpers first run `withoutExtensionManagedEditTools`, which removes `apply_patch` plus the names in `STANDARD_EDIT_TOOL_NAMES = ["edit", "write"]` while preserving the order of all other tools. `replaceEditToolsWithApplyPatch` then appends `"apply_patch"`; `replaceApplyPatchWithEditTools` appends `"edit"` then `"write"`. The net effect on a list like `["read", "bash", "edit", "write", "custom_tool"]` is `["read", "bash", "custom_tool", "apply_patch"]` for capable models and `["read", "bash", "custom_tool", "edit", "write"]` otherwise.

`registerApplyPatchExtension` subscribes to exactly three events because the active model can change in three ways:

- `session_start` → `syncToolset(pi, ctx.model)` (initial activation, including after `/reload`).
- `model_select` → `syncToolset(pi, event.model)` (the model is on the event payload).
- `before_agent_start` → `syncToolset(pi, ctx.model)` (reconciles external tool changes before each request).

Note the payload asymmetry: `model_select` reads `event.model`, while `session_start` and `before_agent_start` read `ctx.model`. Preserve that when editing.

Test coverage for this lives in `test/index.test.ts` via `createToolsetTestApi`: `#given CLIProxyAPI GPT model #when %s fires and model switches away #then swaps and restores edit tools` runs as an `it.each` over all three event names, and the surrounding `it` cases cover stale tools, external changes reconciled in `before_agent_start`, and non-capable restoration.
