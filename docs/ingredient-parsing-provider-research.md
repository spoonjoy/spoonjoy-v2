# Ingredient Parsing Provider Research

Last refreshed: 2026-05-10
Scope: Provider/model choice for Spoonjoy ingredient parsing on Cloudflare Workers.

## Operating Decision

Spoonjoy keeps **OpenAI `gpt-4o-mini`** as the safe default provider/model for ingredient parsing, while exposing runtime env controls so agents can evaluate newer model/provider choices without code changes.

Why this remains the default:

- The workload is focused structured extraction, not complex reasoning or long-running agent orchestration.
- OpenAI still documents `gpt-4o-mini` as a fast, affordable small model for focused tasks with text outputs including Structured Outputs.
- OpenAI Structured Outputs remain the right reliability primitive for this task because schema adherence is enforced by the model response format, then validated again by Spoonjoy's Zod schema.
- The latest OpenAI model guidance points complex GPT-5.5 workflows toward the Responses API and reasoning controls, but this parser is intentionally a low-latency, single-turn extractor. Evaluate GPT-5.5 later with real parse-quality/latency data before changing the default.

## Runtime Controls

These env values are supported by `app/lib/ingredient-parse.server.ts`:

| Env | Default | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | unset | Required for AI parsing; missing keys keep manual/deterministic fallback flows available. |
| `INGREDIENT_PARSE_PROVIDER` | `openai` | Only `openai` is implemented. Unsupported values fail closed. |
| `INGREDIENT_PARSE_MODEL` | `gpt-4o-mini` | Override for evals or controlled rollout. |
| `INGREDIENT_PARSE_TIMEOUT_MS` | `8000` | Invalid or blank values fall back to the default. |
| `INGREDIENT_PARSE_MAX_RETRIES` | `1` | Invalid or blank values fall back to the default. |

## Provider Notes

| Provider | Current read | Implementation status |
| --- | --- | --- |
| OpenAI | `gpt-4o-mini` remains suitable for focused structured extraction. Structured Outputs are available via `json_schema` response format on `gpt-4o-mini` and later models. | Implemented and default. |
| Anthropic | Current Claude docs list Claude Haiku 4.5 as the fastest model with near-frontier intelligence. Claude tool schemas use JSON Schema `input_schema`, and strict tool use exists for tighter schema behavior. | Not implemented. Treat as a fallback-provider spike, not a silent env switch. |
| Gemini | Gemini docs now list Gemini 3.1 Flash-Lite and Gemini 2.5 Flash-Lite as structured-output-capable low-cost/fast options. Gemini structured output uses response format/schema config and still requires app-side validation. | Not implemented. Treat as a fallback-provider spike, especially if cost/throughput becomes the driver. |

## Implementation Guidance

- Keep schema and Zod validation paired. Structured Outputs reduce format drift, but application-level validation still protects business rules like positive quantities and non-empty unit/name values.
- Fail closed on unsupported providers. A typo in `INGREDIENT_PARSE_PROVIDER` should surface as an actionable parse error instead of silently sending recipe text to a different vendor.
- Keep shopping-list manual fallback deterministic when API keys are missing or parsing is unavailable.
- Before changing the default model, run a small eval set covering fractions, unicode fractions, ambiguous one-line items, multi-line items, prep notes, ranges, and pantry staples.

## Sources

- OpenAI latest model guidance: https://developers.openai.com/api/docs/guides/latest-model
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI `gpt-4o-mini` model page: https://developers.openai.com/api/docs/models/gpt-4o-mini
- Anthropic models overview: https://platform.claude.com/docs/en/about-claude/models/overview
- Anthropic tool definitions / JSON Schema `input_schema`: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- Gemini models: https://ai.google.dev/gemini-api/docs/models
- Gemini structured outputs: https://ai.google.dev/gemini-api/docs/structured-output
