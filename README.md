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
- migrations `051_ai_enabled_queues.sql` and `058_ai_ticket_outcomes.sql` applied

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
  auto-routing above its confidence threshold; without one, tickets are still triaged and the
  analysis posted as a note, but never auto-routed. This is one of possibly several outcome types a
  queue can enable — see "Pluggable outcome types" below.

### Pluggable outcome types

The triage LLM call proposes a set of candidate outcomes (not a single yes/no decision) — each
outcome type is its own module under `src/lib/ai-outcomes/`, registered in `registry.ts`. Whether
an outcome type actually executes for a given queue is controlled by `jobs.ai_rules`, a JSONB array
with one entry per registered type: `[{"type": "route_to_togra", "enabled": true,
"confidence_threshold": 0.7}]`. An outcome type with no entry (or `enabled: false`) never executes,
regardless of confidence — opt-in is per-queue and explicit. `AiQueueSettingsModal` renders a
generic enabled+threshold row for every registered type it doesn't already have bespoke UI for, so
a newly-registered outcome type gets a settings row automatically.

Today `route_to_togra` is the only registered type; its Togra destination (project/job/template)
lives in the dedicated `ai_togra_*` columns rather than in `ai_rules`, since those are FK-backed
references best kept as real columns. A new outcome type is one new file under
`src/lib/ai-outcomes/` implementing `AiOutcomeDefinition` plus one line in `registry.ts` (and
`registry-meta.ts` for its settings-UI label) — no changes needed to the webhook, the LLM schema,
or the settings modal.

Deploying via Helm? See `ullav-helm/README.md`'s "AI Enabled Queues" section for the chart values
that map to the variables above.

## AI Confidence & Evals

Every triage run produces `{analysis, outcomes: [{type, confidence}]}` from a single structured
LLM call (`generateObject` + Zod, `src/app/api/ai/triage/route.ts`) — the model proposes a
confidence per outcome type it has a view on, not a single yes/no decision; outcome types aren't
mutually exclusive (a ticket can plausibly warrant more than one). `confidence` (0.0–1.0) is
entirely self-reported by the model; there's no separate scoring or calibration step. An outcome
executes only when its queue's `ai_rules` entry has `enabled: true` *and* the reported confidence
clears that entry's `confidence_threshold`:

```
rule = queue.ai_rules.find(r => r.type === outcomeType)
eligible = rule?.enabled && confidence >= (rule?.confidence_threshold ?? outcomeType.defaultConfidenceThreshold)
```

Each outcome type's threshold defaults if the queue has no `ai_rules` entry for it yet, but
`enabled` never defaults to true — per-queue opt-in is explicit, not automatic. For
`route_to_togra` specifically, its executor additionally requires a Togra project + job configured
on the queue (`ai_togra_project_id`/`ai_togra_job_id`) regardless of the rule being enabled.

**Where outcomes are surfaced:**
- Human-readable, in the "AI Analysis" note's body (e.g. *"AI confidence — Auto-route to Togra:
  82%"*).
- As one row per proposed outcome in awe-server's `ai_ticket_outcomes` table (migration
  `058_ai_ticket_outcomes.sql`) — `outcome_type`, `confidence`, `executed`, plus
  `related_workflow_id`/`detail` for outcome types that reference another ticket. A row is written
  for every outcome the model proposed, whether or not it cleared the threshold — confidence on an
  outcome that *wasn't* acted on is still useful for tuning thresholds later.
- `workflows.ai_confidence`/`ai_should_route` (awe-server migration `053_ai_outcome_feedback.sql`)
  are still dual-written for the `route_to_togra` outcome specifically, so pre-existing queries
  against those two columns keep working.

**Human outcome feedback:** once a ticket has been triaged (`ai_processed_at` set), the ticket page
shows a 👍/👎 strip — a human marks whether the AI's analysis was actually useful. Today this is
still the ticket-wide `ai_outcome_feedback` (`"helpful"` | `"unhelpful"`, unvalidated TEXT like
`ticket_type`/`priority`) plus `ai_outcome_feedback_by`/`_at` on `workflows`. `ai_ticket_outcomes`
rows also have their own `feedback`/`feedback_by`/`feedback_at`/`feedback_reason` columns
(settable via `PUT /ai-outcomes/:id/feedback`) for when a ticket has more than one proposed
outcome and a human wants to judge them independently (e.g. "the duplicate flag was wrong but the
routing was right") — the ticket page doesn't render per-outcome feedback controls yet; that lands
alongside the second registered outcome type. The `_by`/`_at` fields are always derived
server-side from the authenticated caller — never trusted from the request body, for the same
reason `reporter_id` is (see git history on that fix).

**Why this exists — building eval data:** none of this is graded automatically; it's the minimum
logging needed to later check whether confidence numbers can be trusted, without inferring
correctness from status-history heuristics. With per-outcome confidence + execution + human
feedback all queryable in `ai_ticket_outcomes`, you can:
- Bucket outcomes by confidence decile (per `outcome_type`) and compute `% helpful` per bucket → a
  calibration curve. A well-calibrated model's 80–100% bucket should be right close to 80–100% of
  the time; if it isn't, the threshold doesn't mean what the number implies. Doing this per outcome
  type matters once there's more than one — a model can be well-calibrated on routing and poorly
  calibrated on a newer outcome type at the same time.
- Compare models empirically (`AI_TRIAGE_PROVIDER` / `AI_TRIAGE_MODEL` are plain env vars) by
  re-running historical ticket descriptions offline and comparing their decisions against the
  human feedback already collected, instead of assuming a stronger model gives better confidence.
- Tune each queue's per-outcome-type `confidence_threshold` (in `ai_rules`) from data rather than
  guessing — different queues likely have different ticket quality, so one global default
  threshold is unlikely to be right everywhere.

There's no eval harness built yet — the columns above are what a future offline script (or
dashboard) would query. Nothing here blocks or changes triage behavior at runtime; it's purely
recorded for analysis.

## Outbound & Inbound Email

Lets an agent email a ticket's external reporter (someone with no UUM account, e.g. a customer
who emailed in) and lets that reporter's replies land back on the ticket automatically. Built on
AWE's generic work-item/connection/scheduler primitives, not a cunav-specific mail service — see
`CLAUDE.md`'s "Outbound Email" and "Inbound Email" sections for the full design.

Like AI Enabled Queues above, configuration is split across `awe-server` and this app, and a
missing value on either side is a silent no-op or a 500, not a helpful error.

**awe-server:**
- `smtp` and `imap` connection types (migrations `061_smtp_connection_and_email_work_item.sql`,
  `062_imap_connection.sql`) plus `jobs.email_connection_id` (per-queue outbound `smtp`
  connection, configured in cunav's `AiQueueSettingsModal`)
- The `email` script_type (migration `063_email_script_type.sql`) — the runner sends directly
  via SMTP (lettre), no work item or script body to build; cunav creates the automated task
  itself per send and attaches the queue's connection to it (`PUT /tasks/{id}/script`)
- For inbound: a `scheduled_scripts` row (script_type `python`, an `imap` connection attached,
  e.g. `*/2 * * * *`) using `docs/work-items/imap_poll.py` as the script body — build it in Obair's
  Schedules UI
- `CUNAV_EMAIL_WEBHOOK_URL` / `CUNAV_EMAIL_WEBHOOK_SECRET` env vars on **awe-server** (inherited by
  awe-runner's script subprocess, not stored on the connection) — see its `.env.example`

**cunav** (this app):

| Variable | Required | Description |
|---|---|---|
| `REPLY_TO_DOMAIN` | no | Currently unused by outbound mail — the `email` script_type has no Reply-To support. Reply resolution relies solely on the `[#{number}]` tag stamped onto every outbound subject. Kept for when Reply-To support returns |
| `CUNAV_EMAIL_WEBHOOK_SECRET` | yes (for inbound) | Must match awe-server/awe-runner's `CUNAV_EMAIL_WEBHOOK_SECRET`; authenticates `POST /api/email/inbound` |
| `CUNAV_INBOUND_EMAIL_QUEUE_ID` | yes (for inbound) | Queue a new ticket lands in when an inbound email can't be resolved to an existing ticket |
| `CUNAV_AI_SERVICE_EMAIL` / `CUNAV_AI_SERVICE_PASSWORD` | yes (for inbound) | Reused from AI Enabled Queues above — the inbound webhook has no signed-in user either, so it logs in as the same service account |

A resolved reply is only ever attached to a ticket if the sender's address matches that ticket's
`external_reporter_email` — a forwarded or copied `[#N]` tag can't attach one customer's reply to
another customer's ticket; on a mismatch (or no match at all) the message files as a new ticket
instead of being dropped.

### Local email testing

None of this needs real mail — two local test servers make it fully exercisable. Both run as
native (non-Docker) launchd services managed by `ullav-platform` — see that repo's README for
install/setup; they're already running if you used `scripts/start-all.sh`.

- **[Mailpit](https://mailpit.axllent.org/)** for outbound (MailHog-compatible replacement —
  real MailHog has no Apple Silicon build and is unmaintained upstream; Mailpit is a drop-in
  replacement with the same default ports and API): SMTP on `1025`, a web UI to see delivered
  mail at `http://localhost:8025`. It does **not** speak IMAP, so it can't stand in for inbound.
- **[GreenMail](https://greenmail-mail-test.github.io/greenmail/)** for inbound (SMTP *and* IMAP,
  which a real inbound test needs): SMTP on `3025`, IMAP on `3143`. Log in with the **bare
  username** (`tester`), not the full address — GreenMail's own quirk, not something a real
  mailbox requires. Port `3143` is plain IMAP (no TLS); `imap_poll.py` only uses `IMAP4_SSL` on
  port `993`, so a plain test port works with no extra config.

Setup, once both are running:
1. In Obair, create an `smtp` connection pointed at Mailpit (`host: localhost`, `port: 1025`, any
   `username`/secret — Mailpit doesn't check them), in the same team as the queue/tickets you'll
   test with (connections are team-scoped; a cross-team connection fails at send time).
2. Create an `imap` connection pointed at GreenMail (`host: localhost`, `port: 3143`, `username:
   tester`, secret `testerpass`) and attach it to the inbound scheduled script.
3. In cunav's Queue settings, set "Outbound email connection" to the Mailpit connection; set
   `CUNAV_INBOUND_EMAIL_QUEUE_ID` to a real queue's id.
4. Set a ticket's external reporter email, click the mail icon on a note, then check
   `http://localhost:8025` for the delivered message.
5. Send a message into GreenMail (`smtplib.SMTP("localhost", 3025)`, `To: tester@yourdomain.test`)
   — tag the subject with `[#N]` to test the reply-resolution path, or leave it untagged to test
   new-ticket creation. Either wait for the schedule's own cron tick or trigger it immediately:
   `POST /scheduled-scripts/{id}/trigger`.

The schedule fires on its cron tick regardless of whether GreenMail (or a real mailbox) is up —
pause it when you're not actively testing (`PUT /scheduled-scripts/{id}` with `{"is_active":
false}`) so it doesn't pile up failed runs against a service that's since stopped.

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
