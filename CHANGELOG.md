# Changelog

## [Unreleased]

### Added

- Initial standalone `apply_patch` pi extension.
- Support GPT models exposed through custom `openai-responses` and `openai-codex-responses` providers.
- Support DeepSeek models (`deepseek-` id prefix) on any provider/API: native Responses models (official DeepSeek, OpenCode Go Responses) use grammar-constrained sampling, Chat Completion models (e.g. One API) use the plain function tool with an `input` string.
- Tool definition now carries pi's `constrainedSampling` grammar config (previously a custom `freeform` field pi ignored); `compat.supportsOpenAIGrammarTools: true` enables raw patch text output on Responses endpoints.
- Argument normalization strips markdown code fences around the patch envelope.
