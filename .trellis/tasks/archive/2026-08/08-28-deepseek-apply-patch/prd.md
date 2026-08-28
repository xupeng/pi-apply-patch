# DeepSeek apply_patch: native Responses + Chat Completion function tool

## Goal

Background: apply_patch currently activates for deepseek- models only when api is openai-responses / openai-codex-responses; xupeng-oneapi (openai-completions) DeepSeek models get no apply_patch. The freeform field attached to the tool is dead code on pi 0.84.3: pi only honors ToolDefinition.constrainedSampling ({ type: "grammar", variants: { openai_lark } }), which enables grammar-constrained sampling only when the model sets compat.supportsOpenAIGrammarTools: true, otherwise the tool silently degrades to a plain function tool (JSON {"input": "..."} arguments).

Goal:
1. Activate apply_patch for every model whose id starts with deepseek- (any provider, any api).
2. Native path (official DeepSeek + OpenCode Go Responses, api=openai-responses): grammar-constrained sampling (Responses custom tool) via constrainedSampling + compat.supportsOpenAIGrammarTools: true in models.json.
3. One API (api=openai-completions): plain function tool path, model calls apply_patch with JSON {"input": "<patch>"}; make DeepSeek JSON output reliable via description / prepareArguments.

Plan:
1. src/index.ts: isApplyPatchCapableModel returns true for any deepseek- id (drop api requirement, keep gpt- logic); replace dead freeform field with constrainedSampling { type: "grammar", variants: { openai_lark } }; neutralize tool description for both call modes; strengthen promptGuidelines; loosen prepareArguments (bare string, {input}, markdown-fenced patch).
2. test/index.test.ts: deepseek- with openai-completions / undefined api / any provider activates; tool carries constrainedSampling with Lark grammar; description + argument normalization cases.
3. models.json (~/.pi/agent/models.json, outside repo): deepseek + xupeng-ocg providers get compat.supportsOpenAIGrammarTools: true; remove xupeng-oneapi-resp (responses endpoint dead); xupeng-oneapi unchanged.
4. Docs: README, CHANGELOG, AGENTS.md.

Acceptance: One API deepseek gets apply_patch as function tool; official + OCG deepseek get grammar-constrained native patch; xupeng-oneapi-resp removed.

## Requirements

- `isApplyPatchCapableModel` returns true for any model id with `deepseek-` prefix, regardless of provider or api. `gpt-` logic unchanged.
- Tool definition carries pi-native `constrainedSampling: { type: "grammar", variants: { openai_lark } }` (replaces the dead `freeform` field) so native-path models get grammar-constrained sampling and others auto-degrade to JSON function calling.
- Tool description supports both call modes: raw patch text when exposed as a freeform/grammar tool, `{"input": "..."}` when exposed as a plain function tool.
- `prepareArguments` accepts bare string, `{input}`, and markdown-fenced patch.
- `~/.pi/agent/models.json`: `deepseek` and `xupeng-ocg` models get `compat.supportsOpenAIGrammarTools: true`; `xupeng-oneapi-resp` provider removed; `xupeng-oneapi` unchanged.

## Acceptance Criteria

- [x] One API (chat completions) deepseek models get `apply_patch` as a plain function tool; successful JSON `{"input": "<patch>"}` calls apply edits.
- [x] Official DeepSeek and OCG responses models get `apply_patch` with grammar-constrained sampling (native patch text output).
- [x] `xupeng-oneapi-resp` removed from models.json.
- [x] Tests cover activation matrix and argument normalization; typecheck + biome + vitest pass.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
