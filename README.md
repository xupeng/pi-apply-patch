# pi-apply-patch

Codex-style `apply_patch` tool extension for the [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent). It registers the `apply_patch` patch tool for OpenAI GPT-family and DeepSeek models, and swaps out `write` / `edit` while those models are active.

## Behavior

The extension registers one LLM-callable tool: `apply_patch`. The tool accepts Codex patch envelopes and applies file additions, updates, deletions, and moves after resolving file paths against the current workspace.

| Case | Result |
|------|--------|
| OpenAI GPT provider active | replaces `write` and `edit` with `apply_patch` |
| Custom `openai-responses` GPT provider active | replaces `write` and `edit` with `apply_patch` |
| Any DeepSeek model (id prefix `deepseek-`, any provider/API) | replaces `write` and `edit` with `apply_patch` |
| Non-GPT / non-DeepSeek model active | restores the original `write` and `edit` toolset |
| Raw freeform patch input | accepted and applied |
| JSON `{ "input": "..." }` patch input | accepted and applied |
| Absolute or parent-escaping path | accepted and resolved by Node path semantics |

## How the tool is exposed

The tool carries pi's `constrainedSampling` grammar config (the Codex patch Lark grammar). How the model sees it depends on the model's `compat.supportsOpenAIGrammarTools` setting:

- **Enabled** (native Responses endpoints such as official DeepSeek or OpenCode Go Responses, with `compat.supportsOpenAIGrammarTools: true` in `models.json`): pi exposes `apply_patch` as a custom grammar tool. The model is constrained to output the raw Codex patch text directly (`*** Begin Patch ... *** End Patch`), no JSON wrapping, no escaping errors.
- **Disabled / absent** (e.g. One API Chat Completions): pi falls back to a plain function tool with a single `input` string parameter. The model calls it with `{ "input": "<patch>" }`.

Custom provider names are supported when the model id starts with `gpt-` or `deepseek-`. For `gpt-` ids, the provider must be allowlisted or the Pi API must be `openai-responses` / `openai-codex-responses`. For `deepseek-` ids, activation is unconditional: native Responses models use grammar-constrained sampling, Chat Completion models use the function tool. For example, `my-proxy/gpt-5`, `opencode-go-responses/deepseek-v4-flash`, or `xupeng-oneapi/deepseek-v4-flash-0731` (Chat Completions) all activate `apply_patch`.

## Tool

### `apply_patch`

Use this tool to edit files with the Codex patch format.

```text
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch
```

Pi exposes this as a grammar-constrained tool. Models with `compat.supportsOpenAIGrammarTools` enabled receive an OpenAI custom grammar tool (raw patch text output); other models fall back to a function tool with an `input` string parameter.

Custom provider names are supported when the model id starts with `gpt-` or `deepseek-` and its Pi API is `openai-responses` or `openai-codex-responses`. For example, a model registered as `my-proxy/gpt-5` or `opencode-go-responses/deepseek-v4-flash` with `api: "openai-responses"` activates `apply_patch` without adding the provider name to a hard-coded allowlist.

## Installation

The package targets the [`pi`](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) coding agent. Pi loads extensions from `~/.pi/agent/extensions/`, project `.pi/extensions/`, or via the `--extension` / `-e` CLI flag.

```bash
# 1. From npm (once published)
pi install npm:pi-apply-patch

# 2. From git
pi install git:github.com/xupeng/pi-apply-patch

# 3. Manual placement
git clone https://github.com/xupeng/pi-apply-patch ~/.pi/agent/extensions/pi-apply-patch
cd ~/.pi/agent/extensions/pi-apply-patch && npm install

# 4. Dev / one-shot test
pi -e /path/to/pi-apply-patch/src/index.ts
```

After installation, restart pi or run `/reload` inside an interactive session.

## Development

```bash
npm install
npm test
npm run typecheck
npm run check
npm pack --dry-run
pi -e ./src/index.ts
```

The test suite uses vitest. TypeScript is strict, Node-only, and uses ESM imports with `.js` suffixes.

## Origin

Ported from `packages/coding-agent/src/core/extensions/builtin/gpt-apply-patch.ts` in `code-yeongyu/senpi-mono`. The patch grammar and tool descriptions mirror Codex.

This repository is a fork of [`code-yeongyu/pi-apply-patch`](https://github.com/code-yeongyu/pi-apply-patch) with DeepSeek model support added (`deepseek-` id prefix): native Responses models (official DeepSeek, OpenCode Go Responses) get grammar-constrained sampling, Chat Completion models (e.g. One API) use the plain function tool.

## License

[MIT](LICENSE).

## Related

- [senpi](https://github.com/code-yeongyu/senpi) — the fork/runtime these extensions are extracted from.
- [Ultraworkers Discord](https://discord.gg/PUwSMR9XNk) — community link from the senpi README.
- [Dori](https://sisyphuslabs.ai) — the product powered by senpi under the hood.

## Acknowledgements

- **Mario Zechner** ([@badlogic](https://github.com/badlogic)) — author of [pi-mono](https://github.com/badlogic/pi-mono) and the pi-coding-agent extension API this package targets.
- **OpenAI Codex** — reference `apply_patch` tool grammar and patch language.
