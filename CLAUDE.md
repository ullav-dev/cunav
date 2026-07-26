# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**cunav** is a customer support and ticketing web app, part of the Ullav ecosystem. It runs on port **3008** and is fully backed by `awe-server` (AWE). It provides bug tracking, feature requests, questions, improvements, and tasks — organised into Queues (AWE jobs) and Tickets (AWE workflows).

## Workspace Context

This repo lives under the `cunav` directory within the broader Ullav monorepo workspace at `~/github/`. Read `~/github/CLAUDE.md` for shared conventions covering:
- Rust backend patterns (`AppState`, `AppError`, JWT auth via `ullav-user-management`)
- Next.js frontend conventions (App Router, next-intl i18n, API proxy rewrites, Docker standalone builds)
- Docker / Colima local setup
- Helm chart deployment pattern

## Stack

- **Frontend:** Next.js 16.1.6, React 19, TypeScript, App Router, Tailwind CSS v4
- **i18n:** next-intl v4, locales: en / de / ga, locale-prefixed routes
- **Auth:** JWT via `ullav-user-management` on port 8081. Product slug: `cunav`
- **Backend:** `awe-server` (Rust/Axum) on port 8085
- **Dev port:** 3008 (`npm run dev`)

## Domain Mapping (AWE → Cunav)

| Cunav concept | AWE entity |
|---|---|
| Queue | `Job` with `job_type = "queue"` |
| Ticket | `Workflow` with extra columns (migration required) |
| Comment | `Note` on entity_type `"workflow"` |

### Required awe-server SQL migration

```sql
ALTER TABLE workflows ADD COLUMN ticket_type TEXT;
ALTER TABLE workflows ADD COLUMN priority TEXT;
ALTER TABLE workflows ADD COLUMN reporter_id UUID; -- no FK: users live in the UUM database, not awe-server's
ALTER TABLE workflows ADD COLUMN resolved_at TIMESTAMPTZ;
-- Reporter with no UUM user row (e.g. a customer emailing in), independent of reporter_id.
ALTER TABLE workflows ADD COLUMN external_reporter_first_name TEXT;
ALTER TABLE workflows ADD COLUMN external_reporter_last_name TEXT;
ALTER TABLE workflows ADD COLUMN external_reporter_email TEXT;
```

Apply this migration to awe-server before running cunav against a real backend.

## Key Files

| File | Purpose |
|---|---|
| `src/proxy.ts` | API rewrites + intl middleware (NOT `middleware.ts`) |
| `src/lib/types.ts` | All domain types incl. Ticket, Queue, TicketType, Priority |
| `src/lib/auth-api.ts` | UUM wrappers, `hasCunavAccess()`, admin API |
| `src/lib/awe-api.ts` | AWE API (jobs, workflows, teams) |
| `src/lib/cunav-api.ts` | Cunav-specific ticket/queue CRUD |
| `src/lib/notes-api.ts` | Notes CRUD, folders, replies |
| `src/contexts/AuthContext.tsx` | Auth state, idle timeout (1h), `STORAGE_KEY = "cunav_auth"` |
| `src/contexts/AppUrlsContext.tsx` | `tograUrl`, `obairUrl`, `damBrowserUrl` |
| `src/components/notes/NotesPanel.tsx` | Full notes panel (port from Togra) |

## Auth Architecture

- `hasCunavAccess(token)` — checks for `"cunav"` product in JWT team claims
- `getCunavTeamIds(token)` — returns team IDs with cunav access
- `isAdmin(token)` — checks top-level `roles` array in JWT payload
- Storage key: `cunav_auth` (localStorage)
- Idle timeout: 1 hour (configurable via `NEXT_PUBLIC_IDLE_TIMEOUT_MS`)

## Environment Variables

```bash
# Server-side (not exposed to browser)
API_URL=http://localhost:8085          # awe-server
AUTH_URL=http://localhost:8081         # ullav-user-management
TOGRA_URL=http://localhost:3007        # Togra app (for SSO cross-link)
OBAIR_URL=http://localhost:3000        # Obair/AWE app
DAM_BROWSER_URL=http://localhost:3004  # DAM browser
REPLY_TO_DOMAIN=                       # optional; if set, "Send as email" (below) sets
                                        # Reply-To: ticket-{number}@REPLY_TO_DOMAIN so a
                                        # future inbound-email poll can route replies back
# Deployment-wide AI provider keys — power ONLY the automated AI Enabled Queues
# triage webhook below (it has no signed-in user, so it can't use a personal key).
# The interactive Triage chat panel (AiChatExplorer) never reads these; each
# agent brings their own key via Settings — see "Personal AI Assistant" below.
ANTHROPIC_API_KEY=                    # any one or more required for the triage webhook
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=
MISTRAL_API_KEY=
OLLAMA_URL=http://localhost:11434     # optional

# AI Enabled Queues (triage webhook — see below)
CUNAV_AI_WEBHOOK_SECRET=              # must match awe-server's CUNAV_AI_WEBHOOK_SECRET
CUNAV_AI_SERVICE_EMAIL=               # dedicated bot account, cunav + obair access
CUNAV_AI_SERVICE_PASSWORD=
AI_TRIAGE_PROVIDER=anthropic          # optional, defaults to anthropic
AI_TRIAGE_MODEL=                      # optional, defaults per-provider (see lib/ai-provider.ts)

# Personal AI Assistant (BYOK, per-user — see below)
SETTINGS_ENCRYPTION_KEY=              # AES-256-GCM key encrypting personal API keys at rest;
                                       # cunav's own value, does NOT need to match Togra's

# Build-time (baked by next.config.ts)
NEXT_PUBLIC_APP_VERSION=              # set by build
NEXT_PUBLIC_GIT_SHA=                  # set by build
NEXT_PUBLIC_IDLE_TIMEOUT_MS=3600000   # optional override
```

## Common Commands

```bash
npm run dev       # start dev server on port 3008
npm run build     # production build
npm run lint      # lint
npm test          # run tests
```

## AI Enabled Queues

A queue (awe-server `jobs.ai_enabled`) can be flagged so that tickets landing in it are
dispatched to an AI triage step. Flow:

1. awe-server (`ai_dispatch::dispatch_ticket_ai_triage`) fires a background, non-blocking
   POST to cunav's `/api/ai/triage` webhook whenever a ticket-shaped workflow is created or
   moved (`job_id` change) into an `ai_enabled` queue — from the REST `/workflows` endpoints
   *and* the cunav MCP `create_ticket` tool, since both paths converge on the same
   workflow-create/update code.
2. cunav's webhook (`src/app/api/ai/triage/route.ts`) authenticates via a shared secret
   (`X-AWE-Webhook-Secret`), logs in as a dedicated AI service account
   (`CUNAV_AI_SERVICE_EMAIL`/`PASSWORD`, see `lib/ai-service-auth.ts`), and runs a single
   structured LLM call (`generateObject` + Zod) producing `{analysis, outcomes: [{type,
   confidence}]}` — the model proposes zero or more candidate outcomes (they aren't
   mutually exclusive), not a single yes/no routing decision.
3. The analysis is always posted as a note. Each proposed outcome is dispatched to its
   registered executor (`src/lib/ai-outcomes/` — one module per outcome type, registered in
   `registry.ts`) if the queue's `ai_rules` config (JSONB array, one `{type, enabled,
   confidence_threshold}` entry per outcome type; edited via `AiQueueSettingsModal`) has
   that rule enabled and the model's confidence clears its threshold. Today the only
   registered outcome type is `route_to_togra`, which creates/links a Togra story the same
   way `SendToTograModal` does it by hand — its destination (project/job/template) stays in
   the dedicated `ai_togra_*` columns rather than `ai_rules`, since those are FK-backed.
   Adding a new outcome type is one new file under `src/lib/ai-outcomes/` plus one line in
   `registry.ts` — no changes to the webhook, schema, or settings UI required.
4. Every proposed outcome (executed or not) is persisted as its own row in awe-server's
   `ai_ticket_outcomes` table — confidence on an outcome that *wasn't* acted on is still
   useful eval signal. `workflows.ai_confidence`/`ai_should_route` are still dual-written
   for back-compat with existing eval queries, tracking the `route_to_togra` outcome
   specifically.
5. `workflows.ai_processed_at` makes redelivered/racing dispatches a no-op.

v1 deliberately uses one structured LLM call + deterministic follow-up calls, not an
autonomous tool-use loop — see the conversation history for the fuller design rationale.
Later phases may move the processing step into an AWE-native `task_scripts` step and/or
widen the AI's tool access once auto-routing is trusted.

## Outbound Email ("Send as email")

Built on AWE's generic work-item/connection primitives, not a cunav-specific email
service. A note can be sent to a ticket's `external_reporter_email` as raw SMTP mail:

1. An awe-server `smtp` connection (host/port/username config, password secret) backs a
   "Send Email" work item (`script_type: python`) — see
   `awe-server/docs/work-items/send_email.py` for the checked-in script source (the work
   item itself is built/edited through Obair's work-items UI, not a migration).
2. A queue nominates its work item via `jobs.email_work_item_id` (queue admin UI,
   `AiQueueSettingsModal`'s "Outbound email work item" section) — same per-queue routing
   pattern as the AI-triage Togra destination above.
3. cunav's `src/app/api/tickets/[id]/send-email/route.ts` looks up the ticket's queue and
   its configured work item, `POST /work-items/{id}/instantiate`s it into the ticket's
   workflow, then `PATCH /tasks/{id}/inputs`es `to`/`subject`/`body`/`reply_to` — setting
   all required inputs auto-transitions the task to `Ready` and it dispatches on its own,
   no separate "start" call needed. The button lives in `NotesPanel` via its
   `renderNoteActions` prop, shown only when the ticket has an `external_reporter_email`.
4. Only `external_reporter_email` is available today — UUM's `/users/resolve` deliberately
   excludes email, so emailing an internal reporter's own address is out of scope until
   that's revisited.

Inbound email (recognizing a reply and routing it back onto its ticket) is a later phase,
built on awe-server's generic scheduler primitive (`scheduled_scripts`) rather than this
task-triggered path, since IMAP polling needs a wall-clock trigger no workflow task has.

## Personal AI Assistant (BYOK)

The interactive Triage chat panel (`AiChatExplorer`) is bring-your-own-key, separate from
the AI Enabled Queues webhook above — an agent can chat with an LLM to help triage/respond
to tickets even when no admin has configured deployment-wide provider keys, and vice versa.

- Settings page (`/settings`) lets each agent pick a provider/model and paste a personal
  API key. There is no fallback to a deployment-wide key: if an agent hasn't added their
  own key (or picked Ollama, which needs none), the chat panel shows a "set up your AI
  assistant" prompt instead of the chat UI.
- Storage: `src/app/api/ai/settings/route.ts` proxies to `ullav-user-management`'s generic
  `/users/me/ai-settings` endpoint (the same one Togra's Research assistant uses), keyed by
  `(username, app)`. Cunav always passes `app=cunav` so its settings can't collide with or
  overwrite a user's Togra settings — the two are fully isolated per app, not shared.
- The key is AES-256-GCM encrypted before being sent to UUM, using `SETTINGS_ENCRYPTION_KEY`
  (see Environment Variables above). This is cunav's own secret — it does not need to match
  Togra's `SETTINGS_ENCRYPTION_KEY`, since the rows are already isolated by `app`.
- `src/lib/ai-provider.ts`'s `getAiModel()` is shared by both the chat route and the triage
  webhook: the webhook calls it with no `apiKey` override (falls back to the env var), the
  chat route always passes the user's decrypted personal key explicitly.

## Phase 2 Notes (Triage)

Phase 2 will add:
- Triage page with Research panel (like Clann's ResearchPage)
- Explorer panels for external resources
- "Send to Togra" action to push resolved tickets into Togra backlogs
- Togra project visibility within cunav

Design the UI to keep Phase 1 routes stable; Triage will be additive.
