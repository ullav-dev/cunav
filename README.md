# cunav
Help and Support system, built n AWE

## AI Enabled Queues

Queues can be flagged (`jobs.ai_enabled` on awe-server) so tickets landing in them are triaged by
an LLM and, above a confidence threshold, auto-routed to Togra. See `CLAUDE.md` for the full
design; this section covers what's needed to turn it on.

Configuration is split across two services — both sides are required, and a missing value on
either one makes dispatch a silent no-op (no error, no log line) rather than failing loudly:

**awe-server** (see its README's Environment Variables section):
- `CUNAV_AI_WEBHOOK_URL` — pointed at this app's `/api/ai/triage`
- `CUNAV_AI_WEBHOOK_SECRET` — shared secret, must match the value below
- migration `051_ai_enabled_queues.sql` applied

**cunav** (this app):

| Variable | Required | Description |
|---|---|---|
| `CUNAV_AI_WEBHOOK_SECRET` | yes | Must match awe-server's `CUNAV_AI_WEBHOOK_SECRET` |
| `CUNAV_AI_SERVICE_EMAIL` | yes | Dedicated bot account email — needs cunav + obair access |
| `CUNAV_AI_SERVICE_PASSWORD` | yes | Bot account password |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_AI_API_KEY` / `MISTRAL_API_KEY` | one required | AI provider credentials |
| `AI_TRIAGE_PROVIDER` | no | Defaults to `anthropic` |
| `AI_TRIAGE_MODEL` | no | Defaults per-provider, see `src/lib/ai-provider.ts` |

Plus, per queue you want to enable:
- Toggle `ai_enabled` on the queue in the admin UI (this is a DB flag, independent of the env vars
  above, and also gates dispatch silently if left off).
- Optionally configure a Togra project/job/template on the queue (`AiQueueSettingsModal`) to allow
  auto-routing above `ai_route_confidence_threshold`; without one, tickets are still triaged and
  the analysis posted as a note, but never auto-routed.

Deploying via Helm? See `ullav-helm/README.md`'s "AI Enabled Queues" section for the chart values
that map to the variables above.

## AI Confidence & Evals

Every triage run produces a structured decision — `{analysis, should_route, confidence}` — from a
single LLM call (`src/app/api/ai/triage/route.ts`). `confidence` (0.0–1.0) and `should_route` are
entirely self-reported by the model; there's no separate scoring or calibration step. Both are
required, alongside `should_route === true`, for auto-routing:

```
canRoute = should_route && confidence >= queue.ai_route_confidence_threshold
                        && queue has a Togra project + job configured
```

`ai_route_confidence_threshold` (default `0.7`) is a per-queue setting, editable via
`AiQueueSettingsModal`'s slider — different queues can require different confidence to auto-route,
or set it to `0` to auto-route on `should_route` alone regardless of confidence.

**Where confidence is surfaced:**
- Human-readable, in the "AI Analysis" note's body (e.g. *"AI confidence: 82% — recommended
  routing"*).
- As queryable columns on the ticket, set at the same time as the note (awe-server migration
  `053_ai_outcome_feedback.sql`): `ai_confidence` (REAL) and `ai_should_route` (BOOLEAN) — so
  confidence trends can be queried directly instead of parsed out of note text.

**Human outcome feedback:** once a ticket has been triaged (`ai_processed_at` set), the ticket page
shows a 👍/👎 strip next to the confidence — a human marks whether the AI's analysis was actually
useful. This is stored as `ai_outcome_feedback` (`"helpful"` | `"unhelpful"`, unvalidated TEXT like
`ticket_type`/`priority`) plus `ai_outcome_feedback_by`/`_at`. The `_by`/`_at` fields are always
derived server-side from the authenticated caller in `update_workflow` — never trusted from the
request body, for the same reason `reporter_id` is (see git history on that fix).

**Why this exists — building eval data:** none of this is graded automatically; it's the minimum
logging needed to later check whether confidence numbers can be trusted, without inferring
correctness from status-history heuristics. With confidence + should_route + human feedback all
queryable per ticket, you can:
- Bucket tickets by confidence decile and compute `% helpful` per bucket → a calibration curve. A
  well-calibrated model's 80–100% bucket should be right close to 80–100% of the time; if it isn't,
  the threshold doesn't mean what the number implies.
- Compare models empirically (`AI_TRIAGE_PROVIDER` / `AI_TRIAGE_MODEL` are plain env vars) by
  re-running historical ticket descriptions offline and comparing their decisions against the
  human feedback already collected, instead of assuming a stronger model gives better confidence.
- Tune `ai_route_confidence_threshold` per queue from data rather than guessing — different queues
  likely have different ticket quality, so one global default threshold is unlikely to be right
  everywhere.

There's no eval harness built yet — the columns above are what a future offline script (or
dashboard) would query. Nothing here blocks or changes triage behavior at runtime; it's purely
recorded for analysis.

## Personal AI Assistant (BYOK)

Separate from the automated triage webhook above: the interactive Triage chat panel
(`AiChatExplorer`) lets each agent bring their own AI provider API key, like Togra's Research
assistant — it works independently of whether an admin has configured the deployment-wide
keys above, and vice versa. There is no fallback between the two: if an agent hasn't set a
personal key (or picked Ollama, which needs none), the chat panel prompts them to add one in
`/settings` rather than silently using the triage webhook's key.

| Variable | Required | Description |
|---|---|---|
| `SETTINGS_ENCRYPTION_KEY` | yes (for BYOK) | AES-256-GCM key encrypting personal API keys at rest. Generate with `openssl rand -base64 32`. Falls back to an insecure dev default if unset — always set this in production |

Personal settings are stored in `ullav-user-management`'s `user_ai_settings` table via
`/users/me/ai-settings`, the same endpoint Togra's Research assistant uses — but scoped with
`?app=cunav` (added by migration `024_user_ai_settings_app.sql`) so a user's cunav settings
are a separate row from their Togra settings; saving a key in one app can't overwrite or break
decryption in the other. `SETTINGS_ENCRYPTION_KEY` is therefore cunav's own secret and does not
need to match Togra's.
