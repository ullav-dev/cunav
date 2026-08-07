// Shared types for the pluggable AI-triage outcome system. Each outcome type
// (route_to_togra, and whatever gets added after it) implements
// AiOutcomeDefinition in its own file under this directory and registers it in
// registry.ts — that's the only place a new outcome type needs to be added.
import type { z } from "zod";
import type { Queue, Ticket } from "@/lib/types";

/** Client-safe metadata for one outcome type — kept separate from the full
 *  definition (which may pull in server-only dependencies like the LLM
 *  provider factory) so components like AiQueueSettingsModal can render a
 *  generic settings row per registered type without bundling executor code. */
export interface AiOutcomeMeta {
  type: string;
  label: string;
  defaultConfidenceThreshold: number;
}

export interface AiOutcomeExecutorContext {
  token: string;
  ticket: Ticket;
  queue: Queue;
  /** The confidence the primary triage call reported for this outcome type.
   *  Meaningless for a `deterministic` outcome type (nothing asked the LLM to
   *  guess) — 0 in that case; read `AiOutcomeExecutionResult.confidence`
   *  instead for what actually got persisted. */
  confidence: number;
}

export interface AiOutcomeExecutionResult {
  executed: boolean;
  /** Free-text detail specific to the outcome type (e.g. why a duplicate matched). */
  detail?: string;
  /** e.g. the matched duplicate ticket, or the Togra story created. */
  relatedWorkflowId?: string;
  noteId?: string;
  /** Set by `deterministic` outcome types only — their own real, computed
   *  score, persisted on the ai_ticket_outcomes row in place of an LLM
   *  guess it never made. Ignored for LLM-judged types, whose confidence is
   *  `AiOutcomeExecutorContext.confidence` instead. */
  confidence?: number;
}

export interface AiOutcomeDefinition extends AiOutcomeMeta {
  /** True for an outcome type whose "is this applicable, and how sure are
   *  we" question has a real, computable answer — not something worth
   *  asking an LLM to guess at blind. The model is never asked to propose
   *  this type or report confidence on it (see flag-duplicate.ts, whose
   *  matcher runs a real comparison against other tickets); the triage
   *  route instead runs its executor unconditionally whenever the queue's
   *  rule is enabled, and persists the executor's own returned confidence.
   *  Defaults to false (an LLM judgment call, like route_to_togra) when
   *  omitted. */
  deterministic?: boolean;
  /** Prompt text telling the model what this outcome type means and when to
   *  propose it with what confidence — folded verbatim into the triage system
   *  prompt. Unused when `deterministic` is true. This is where an outcome
   *  type's actual judgment criteria live; `label` is just a display string
   *  for the settings UI and note summaries, never seen by the model. */
  promptGuidance: string;
  /** Merged into the triage call's `outcomes[]` schema union. Most outcome
   *  types have no extra payload beyond confidence — leave as `z.object({})`.
   *  Unused when `deterministic` is true. */
  payloadSchema: z.ZodTypeAny;
  /** LLM-judged types: runs only when the queue has this rule enabled and the
   *  model's confidence clears the configured threshold. Deterministic types:
   *  runs whenever the queue has the rule enabled, unconditionally — its own
   *  logic decides whether it found anything worth acting on (via `executed`
   *  and `confidence` on the result). Side effects are otherwise entirely up
   *  to the implementation — see route-to-togra.ts's contract comment for the
   *  one hard rule every outcome type must follow around human-in-the-loop. */
  run(ctx: AiOutcomeExecutorContext): Promise<AiOutcomeExecutionResult>;
}
