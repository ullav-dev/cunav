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
ALTER TABLE workflows ADD COLUMN reporter_id UUID REFERENCES users(id);
ALTER TABLE workflows ADD COLUMN resolved_at TIMESTAMPTZ;
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
ANTHROPIC_API_KEY=                    # AI provider: Anthropic (any one or more required)
OPENAI_API_KEY=                       # AI provider: OpenAI
GOOGLE_AI_API_KEY=                    # AI provider: Google
MISTRAL_API_KEY=                      # AI provider: Mistral
OLLAMA_URL=http://localhost:11434     # AI provider: Ollama (default, optional)

# AI Enabled Queues (triage webhook — see below)
CUNAV_AI_WEBHOOK_SECRET=              # must match awe-server's CUNAV_AI_WEBHOOK_SECRET
CUNAV_AI_SERVICE_EMAIL=               # dedicated bot account, cunav + obair access
CUNAV_AI_SERVICE_PASSWORD=
AI_TRIAGE_PROVIDER=anthropic          # optional, defaults to anthropic
AI_TRIAGE_MODEL=                      # optional, defaults per-provider (see lib/ai-provider.ts)

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
   structured LLM call producing `{analysis, should_route, confidence}`.
3. The analysis is always posted as a note. Above the queue's configured
   `ai_route_confidence_threshold`, and only if the queue has a Togra
   project/job/template configured (queue admin UI, `AiQueueSettingsModal`), the ticket is
   auto-routed to Togra the same way `SendToTograModal` does it by hand.
4. `workflows.ai_processed_at` makes redelivered/racing dispatches a no-op.

v1 deliberately uses one structured LLM call + deterministic follow-up calls, not an
autonomous tool-use loop — see the conversation history for the fuller design rationale.
Later phases may move the processing step into an AWE-native `task_scripts` step and/or
widen the AI's tool access once auto-routing is trusted.

## Phase 2 Notes (Triage)

Phase 2 will add:
- Triage page with Research panel (like Clann's ResearchPage)
- Explorer panels for external resources
- "Send to Togra" action to push resolved tickets into Togra backlogs
- Togra project visibility within cunav

Design the UI to keep Phase 1 routes stable; Triage will be additive.
