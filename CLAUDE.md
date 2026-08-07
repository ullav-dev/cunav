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

## Organizations (Multi-Tenancy)

An `Organization` (`ullav-user-management`, `031_organizations.sql`) is an optional tenant
boundary that owns Teams — most teams have none yet, since no app besides Tack has adopted
organizations. awe-server denormalizes `organization_id` alongside `team_id` on every table
that already carries one (`jobs`, `workflows`, `projects`, `connections`, `work_items`,
`scheduled_scripts` — see its `065_organization_scoping.sql`), the same reasoning as
`team_id` itself: teams (and organizations) live in UUM with no local FK. `GET /jobs` and
`GET /workflows` accept an `organization_id` query param that returns everything across
*every team* within that organization, not just the caller's own team — this is what lets
cunav search across queues that belong to different teams but the same organization (e.g.
duplicate-ticket detection spanning Business + Catch-All, even if an admin ever splits them
across teams again).

- **Support team**: `teams.is_support_team` (UUM, `032_team_support_flag.sql`) flags the one
  team per organization that owns every cunav ticket queue — set via ullav-portal's admin
  Teams panel, resolved via `GET /teams/support` (`src/lib/auth-api.ts`'s `getSupportTeam`).
  No team id/name is ever hardcoded in cunav. `CreateQueueModal` blocks queue creation with a
  clear message if none is configured yet, rather than falling back to something arbitrary
  (the old bug this replaced: queue creation silently defaulted to the creating agent's own
  first team).
- **`NEXT_PUBLIC_CUNAV_ORGANIZATION_ID`** (optional): cunav is single-tenant per deployment
  today — there's no per-request "which organization is this for" to derive, so the
  deployment's own organization (if any) is a build-time constant, not resolved per user.
  Omitted, `GET /teams/support` still resolves unambiguously as long as only one organization
  has a Support team flagged anywhere; once a second one does, callers get a `400` telling
  them to pass `organization_id` explicitly rather than the lookup guessing — see UUM's
  `SupportTeamLookup::Ambiguous`. Set this once cunav's deployment maps to a specific
  organization. Public (not server-only) because an organization id isn't sensitive — the
  browser already sees team ids in its own JWT.
- `listQueues`/`listTickets` (`src/lib/cunav-api.ts`) both accept `organization_id` as an
  alternative to `team_id`, for the same org-wide scanning use case.

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
CUNAV_APP_URL=http://localhost:3008    # cunav's own base URL — used server-side to build links back
                                        # into itself (e.g. flag_duplicate's note links to the matched
                                        # ticket). Not request-scoped (the triage webhook has no browser
                                        # request to infer an origin from), so it must be configured
                                        # rather than derived. Defaults to the local dev port.
CUNAV_EMAIL_WEBHOOK_SECRET=            # must match awe-runner's env var of the same name;
                                        # authenticates the inbound-email poll's webhook call
CUNAV_INBOUND_EMAIL_QUEUE_ID=          # queue a new ticket lands in when an inbound email
                                        # can't be resolved to an existing ticket
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
NEXT_PUBLIC_CUNAV_ORGANIZATION_ID=    # optional — see "Organizations" below
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
   that rule enabled and the model's confidence clears its threshold. Two outcome types are
   registered: `route_to_togra`, which creates/links a Togra story the same way
   `SendToTograModal` does it by hand — its destination (project/job/template) stays in the
   dedicated `ai_togra_*` columns rather than `ai_rules`, since those are FK-backed — and
   `flag_duplicate`, which posts a note naming the most lexically similar other ticket in the
   same queue for a human to review (it never mutates the ticket itself; only `route_to_togra`
   is allowed to change ticket status/assignment). Adding another outcome type is one new file
   under `src/lib/ai-outcomes/` plus one line each in `registry.ts` and `registry-meta.ts` — no
   changes to the webhook, schema, or settings UI required.
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

## Duplicate Ticket Linking

Lets an agent (or a confirmed AI suggestion) mark one ticket as a duplicate of another —
`workflows.duplicate_of_workflow_id` (nullable, self-referencing FK, awe-server migration
`067_workflow_duplicate_links.sql`). A ticket can be "a duplicate of" at most one other
ticket at a time (plain column, not a join table); any number of tickets may point at the
same target, so "what's marked as a duplicate of this ticket" is just
`GET /workflows/{id}/duplicates`. Set/unset via `PUT`/`DELETE /workflows/{id}/duplicate-of`
(`src/lib/cunav-api.ts`'s `setTicketDuplicateOf`/`clearTicketDuplicateOf`).

`flag_duplicate` deliberately does **not** set this column itself — same "AI never mutates
a ticket unattended" principle as everywhere else in this doc (`route_to_togra` is the sole
exception). It only ever suggests a match via `ai_ticket_outcomes.related_workflow_id`
(unchanged). `src/components/DuplicateLinkPanel.tsx` (rendered on the ticket detail page)
is what turns a suggestion into a real link: it reads the ticket's own `flag_duplicate`
outcome row and shows a Confirm/Dismiss banner when no link is set yet, plus a manual
"Mark as duplicate of…" picker (searches tickets in the same queue) for agent-initiated
links independent of any AI suggestion. It also renders the reverse list (duplicates *of*
this ticket) and an unlink action for a confirmed link.

## Outbound Email ("Send as email")

Built on AWE's generic `email` script_type + connection primitives (see awe-server
migration `063_email_script_type.sql`), not a cunav-specific email service or a
scripted work item — the runner sends directly via SMTP (lettre), no Python
subprocess involved. A note can be sent to a ticket's reporter (external or internal —
see point 5 below) as raw SMTP mail:

1. An awe-server `smtp` connection (host/port/username config, password secret) is
   created once in Obair (Connections) and picked directly by the queue admin — no
   work item to build/edit for this anymore.
2. A queue nominates its connection via `jobs.email_connection_id` (queue admin UI,
   `AiQueueSettingsModal`'s "Outbound email connection" section, listing `smtp`
   connections scoped to the queue's own team) — same per-queue routing pattern as
   the AI-triage Togra destination above. The connection must belong to the same
   team as the queue/ticket — connections are team-scoped, and a cross-team
   connection_id fails at send time with "could not be resolved ... team mismatch"
   (see `GET /tasks/{id}/connection` on awe-server).
3. cunav's `src/app/api/tickets/[id]/send-email/route.ts` looks up the ticket's queue
   and its configured connection, then creates the automated task itself each send:
   `POST /tasks` (`task_type: "automated"`), `PUT /tasks/{id}/script`
   (`script_type: "email"`, the queue's `connection_id`), `POST /tasks/{id}/ports`
   to register `to`/`subject`/`body_text` as required inputs, then
   `PATCH /tasks/{id}/inputs`es those three values — setting all required inputs
   auto-transitions the task to `Ready` and it dispatches on its own, no separate
   "start" call needed. The button lives in `NotesPanel` via its
   `renderNoteActions` prop, shown only when the ticket has an
   `external_reporter_email`.
4. `From` is deliberately always the outbound connection's own authenticated account —
   most SMTP providers reject or silently rewrite a `From` that isn't the authenticated
   identity or an approved alias (SPF/DKIM alignment), so there's no per-ticket "from"
   address. `Reply-To` is where a per-ticket address belongs instead — derived from the
   queue's own **inbound** connection (`jobs.inbound_email_connection_id`, an `imap`
   connection, set via `AiQueueSettingsModal`'s "Inbound email connection" section), not
   a deployment-wide env var: `replyToFromMailbox()` in `send-email/route.ts` reads that
   connection's `config.username` (its mailbox address, e.g. `support@ullav.com`) and
   plus-addresses it as `{local}+{TKT-0020}@{domain}` — the ticket's display id, not the
   bare number (see "why the display id, not the bare number" below). This lands the
   reply in exactly the mailbox this queue is already configured to poll, with no
   separate catch-all domain/DNS to set up. `run_email` in awe-runner
   (`awe-server/src/bin/awe_runner.rs`) reads the resulting `reply_to` input and sets the
   message's Reply-To header via lettre. See Inbound Email below for the poll side.
5. Recipient resolution: `external_reporter_email` if set, otherwise `reporter_id`'s own
   email resolved via UUM's `GET /users/{id}/email` — a dedicated, auth-gated endpoint
   (any caller with `cunav` product access, not restricted to a shared team with the
   target user), separate from `GET /users/resolve` which deliberately never returns
   email at all. An internal reporter has a real email too; there was never a good
   reason to only support the external case. `reporter_id` defaults to the ticket's
   creator when unset (see `create_workflow`), so this is available on nearly every
   ticket now, not just ones with an explicit external reporter. The ticket detail page
   also labels the reporter field "External"/"Internal" — previously implicit, inferred
   only from which fields happened to be populated.
6. `src/app/api/tickets/[id]/send-email/status/route.ts` lets the frontend poll the
   created task's real outcome (`GET /tasks/{id}` + `/tasks/{id}/runs` for the error
   detail on failure) instead of treating "queued successfully" as "delivered" — the
   task dispatch is async, out of process on awe-runner.

**Why the display id, not the bare number:** `workflows.ticket_number` is already
globally unique across every queue (assigned from one Postgres sequence,
`cunav_ticket_seq` — see `handlers/workflows.rs`), so `ticket-20@...` was never actually
ambiguous between queues. The switch to the display id (`TKT-0020`) is about the address
reading unambiguously as a ticket reference on its own — a bare number after a `+` looks
like it could be anyone's own plus-tag — and matching the same id already stamped on the
subject tag, not about resolving a collision that doesn't exist today.

## Inbound Email

Recognizes a reporter's reply and routes it back onto its ticket (or files a new one).
Built on awe-server's generic scheduler primitive (`scheduled_scripts`), since IMAP
polling needs a wall-clock trigger no workflow task has — the outbound flow above didn't
need this because it's triggered by a human action, not a clock.

1. An awe-server `imap` connection (host/port/username config, mailbox password secret)
   backs a `scheduled_scripts` row (script_type `python`, cron e.g. every 2 minutes) —
   see `awe-server/docs/work-items/imap_poll.py` for the checked-in script source (the
   schedule itself is configured through Obair's Schedules UI, not a migration). The same
   connection is also the one a queue nominates as `jobs.inbound_email_connection_id` (see
   Outbound Email above) — one connection, one mailbox, used by both directions: the poll
   reads from it, outbound Reply-To addresses are built from its `config.username`. A
   queue with no inbound connection configured simply gets no Reply-To on its outbound
   mail (falls back to subject-tag resolution only, point 4 below). **Polls `INBOX` plus
   any top-level folder whose name looks like a ticket reference** (e.g. `TKT-0020`) —
   some providers (confirmed on Migadu) file plus-addressed mail
   (`local+TKT-0020@domain`) into a folder named after the tag instead of leaving it in
   `INBOX`; a provider that doesn't do this just never has any matching folders, so
   `INBOX`-only delivery keeps working unchanged. Each folder gets its own independently
   persisted `{last_uid, uidvalidity}` in the schedule's `state` (now `{folders: {...},
   seen_message_ids: [...]}`, migrated automatically from the older flat shape on first
   run under this version). A newly-discovered ticket folder has everything in it
   processed immediately (no backlog to skip — its existence means a reply just
   arrived); `INBOX` keeps its original first-run baseline-skip behavior.
2. The script's only privileged action is one HTTP POST per new message to cunav's
   `src/app/api/email/inbound/route.ts`, authenticated via a shared secret
   (`X-Email-Webhook-Secret` / `CUNAV_EMAIL_WEBHOOK_SECRET`) — it does **not** carry an
   AWE service token, deliberately: a token capable of resolving connection secrets would
   let any team member who can edit a script body escalate across teams. The webhook URL
   and secret come from `CUNAV_EMAIL_WEBHOOK_URL`/`CUNAV_EMAIL_WEBHOOK_SECRET`, env vars on
   awe-runner's own process (inherited by the script subprocess, not stored on the
   connection — the connection is scoped to mailbox credentials only).
3. The script persists `{last_uid, uidvalidity, seen_message_ids}` in the schedule's
   `state` (round-tripped automatically by the scheduler) so it only ever processes a
   message once — `seen_message_ids` (not just the UID) survives a `UIDVALIDITY` change
   (mailbox rebuild), which resets UID numbering but not Message-IDs.
4. cunav's webhook resolves the ticket two ways, in order: the reply-to address
   (plus-addressed, `{local}+TKT-0020@{domain}` — see Outbound Email above for how
   that's built; `ticketRefFromReplyTo()` extracts whatever's between `+` and `@` with
   no assumption about which domain or mailbox, since that's now per-queue rather than
   one deployment-wide value) then a `[TKT-0009]`-style (`ticketId()`) tag the outbound
   route stamps onto every subject — the fallback for clients that drop/mangle Reply-To.
   The legacy bare `[#{number}]` form (stamped by older sends) still resolves too. Both
   paths resolve through the existing `GET /references/resolve` endpoint
   (`cunav::parse_ref`, which already accepts both a bare number and a `PREFIX-NNN`
   display id), not a reimplemented regex.
5. Resolved → posts a note (fixed title `INBOUND_EMAIL_NOTE_TITLE`, dedup on a
   `Message-ID: ...` line in the note body in case of a redelivered webhook call).
   Unresolved → creates a new ticket in `CUNAV_INBOUND_EMAIL_QUEUE_ID` with
   `external_reporter_*` parsed from the `From` header — required env var; without it,
   unresolved messages are dropped with an error rather than silently discarded.
6. A per-instance in-memory rate guard (`MAX_NEW_TICKETS_PER_WINDOW` in the route) caps
   new-ticket creation so a spam flood into the mailbox can't create unbounded tickets.
   Lives server-side (not in the script) so it can't be bypassed by editing script_body.

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
