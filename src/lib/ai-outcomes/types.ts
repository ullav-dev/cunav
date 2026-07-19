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
  /** The confidence the primary triage call reported for this outcome type. */
  confidence: number;
}

export interface AiOutcomeExecutionResult {
  executed: boolean;
  /** Free-text detail specific to the outcome type (e.g. why a duplicate matched). */
  detail?: string;
  /** e.g. the matched duplicate ticket, or the Togra story created. */
  relatedWorkflowId?: string;
  noteId?: string;
}

export interface AiOutcomeDefinition extends AiOutcomeMeta {
  /** Prompt text telling the model what this outcome type means and when to
   *  propose it with what confidence — folded verbatim into the triage system
   *  prompt. This is where an outcome type's actual judgment criteria live;
   *  `label` is just a display string for the settings UI and note
   *  summaries, never seen by the model. */
  promptGuidance: string;
  /** Merged into the triage call's `outcomes[]` schema union. Most outcome
   *  types have no extra payload beyond confidence — leave as `z.object({})`. */
  payloadSchema: z.ZodTypeAny;
  /** Runs only when the queue has this rule enabled and the model's confidence
   *  clears the configured threshold. Its side effects are entirely up to the
   *  implementation — see route-to-togra.ts's contract comment for the one
   *  hard rule every outcome type must follow around human-in-the-loop. */
  run(ctx: AiOutcomeExecutorContext): Promise<AiOutcomeExecutionResult>;
}
