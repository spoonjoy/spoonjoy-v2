# Codex long-running work handoff protocol

Date: 2026-06-08

## Why this exists

This thread repeatedly hit:

```text
Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.
```

Auto-compaction did not reliably recover the thread. The practical fix is not to trust chat context as the durable work record.

The local Codex config at `~/.codex/config.toml` currently has no explicit context-window or auto-compaction tuning keys set. Codex documentation describes auto-compaction as conditional behavior, not a guarantee. Treat compaction as a convenience, not a recovery plan.

## Immediate recovery rule

If this happens again on a Spoonjoy task, start a fresh thread with:

```text
Continue Spoonjoy work from docs/recipe-image-provider-research.md and docs/codex-long-running-work-handoff.md. Do not rely on prior chat context.
```

For the current recipe-image work, the durable task anchor is:

- `docs/recipe-image-provider-research.md`

## Never-again operating rules

- Create a durable file before deep research or implementation begins.
- Update the durable file after each major discovery, implementation merge, production validation, or blocker.
- Keep command output bounded with explicit `max_output_tokens` and do not paste long tails/logs into chat.
- Put exact production evidence in the durable file: request ids, error codes, deployment ids, record ids, and current branch/commit.
- Use sub-agents for unbiased review gates, then summarize their findings into the durable file.
- If context exhaustion happens twice in the same task, stop trying to continue from the same chat and resume from the durable file in a new thread.
- For Spoonjoy data cleanup, record created test data and cleanup status in the durable file before declaring done.
- For local Spoonjoy QA residue, run `pnpm cleanup:qa` before cleanup and `pnpm cleanup:qa -- --apply` only against local D1; record the dry-run/apply output or the remaining counts.

## Recommended durable-file locations

- Planning/doing tasks: `<agent>/tasks/YYYY-MM-DD-HHMM-planning-<slug>.md` and `<agent>/tasks/YYYY-MM-DD-HHMM-doing-<slug>.md`
- Research handoffs: `docs/<topic>-research.md`
- Production incident handoffs: `docs/<topic>-incident-handoff.md`
- UI/product audits: `docs/qa/<ticket-or-topic>-audit.md`

## Current image-work state

The current durable image-work summary is in `docs/recipe-image-provider-research.md`.

Key state at the time this protocol was written:

- upload progress, duplicate spoon prevention, recipe form submit locking, placeholder cleanup, and risotto duplicate cleanup were already merged and deployed before this doc;
- AI variant generation remained blocked by OpenAI `billing_hard_limit_reached`;
- next concrete engineering step is adding a provider registry/fallback, with Gemini 3.1 Flash Image as the recommended immediate secondary provider and BFL FLUX.2 / Gemini 3 Pro Image as visual-quality benchmark candidates.

## Config follow-up

Before changing global Codex config, verify the active desktop build accepts the intended keys. Candidate knobs to check in official/local Codex docs are:

- `model_auto_compact_token_limit`
- `tool_output_token_limit`
- `model_context_window`

Do not make the config the only fix. Even with tuning, long-running Spoonjoy work must be recoverable from repo files.
