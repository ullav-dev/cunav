// AI triage webhook — called by awe-server (fire-and-forget) whenever a ticket
// lands in an AI-enabled queue. Runs a single structured LLM call to propose a
// set of candidate outcomes (each with its own confidence), then dispatches
// each proposed outcome to its registered executor (src/lib/ai-outcomes/) if
// the queue has that rule enabled and confidence clears its threshold. Every
// proposed outcome — executed or not — is persisted as its own
// ai_ticket_outcomes row so eval queries can see confidence on outcomes that
// weren't acted on too. See CLAUDE.md "AI Enabled Queues" for the full design.
import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getTicket, listTickets, updateTicket, createTicketOutcome } from "@/lib/cunav-api";
import { getJob } from "@/lib/awe-api";
import { createNote } from "@/lib/notes-api";
import { getAiServiceToken } from "@/lib/ai-service-auth";
import { getAiModel, AiProviderNotConfiguredError } from "@/lib/ai-provider";
import type { AiProvider } from "@/lib/ai-settings";
import type { Ticket, Queue, AiOutcomeRuleConfig } from "@/lib/types";
import { AI_ANALYSIS_NOTE_TITLE } from "@/lib/types";
import { AI_OUTCOME_REGISTRY, getOutcomeDefinition } from "@/lib/ai-outcomes/registry";
import { ROUTE_TO_TOGRA_TYPE } from "@/lib/ai-outcomes/route-to-togra";

const TRIAGE_PROVIDER = (process.env.AI_TRIAGE_PROVIDER as AiProvider | undefined) ?? "anthropic";
const TRIAGE_MODEL = process.env.AI_TRIAGE_MODEL;

const TRIAGE_SYSTEM_PROMPT = `You are an AI triage assistant for a customer support ticket queue. For each incoming ticket:

1. Write a short (2-4 sentence) analysis: likely root cause or category, whether it looks like a duplicate or known pattern, and a recommended next step for the support team.
2. For each possible outcome type below, decide how confident you are (0.0-1.0) that it applies to this ticket, following that outcome type's specific guidance. Outcome types are not mutually exclusive — a well-formed ticket can also look like a duplicate of other work, for example.

Outcome types you may propose:
${AI_OUTCOME_REGISTRY.map((o) => `- "${o.type}": ${o.promptGuidance}`).join("\n\n")}

Only include an outcome type in your response if you have a genuine, non-zero view on it. Respond with ONLY a JSON object matching the required schema, no other text.`;

const TriageResultSchema = z.object({
  analysis: z.string(),
  outcomes: z.array(
    z.object({
      type: z.enum(AI_OUTCOME_REGISTRY.map((o) => o.type) as [string, ...string[]]),
      confidence: z.number().min(0).max(1),
    })
  ),
});

type TriageResult = z.infer<typeof TriageResultSchema>;

const FEEDBACK_HISTORY_LIMIT = 10;

/** Pulls the most recent human feedback (with a reason) left on other tickets in the
 *  same queue, so the model can learn from past corrections. Scoped per-queue since
 *  each queue is a different triage domain. Filtered/sorted client-side rather than
 *  via a new server-side query param — queue-sized ticket lists are small enough that
 *  this isn't worth the extra API surface (v1: one structured call, no retrieval infra).
 *  Still reads the ticket-wide ai_outcome_feedback* columns rather than per-outcome
 *  feedback, even now that flag_duplicate is a second registered outcome type —
 *  FeedbackReasonModal's thumbs up/down judges the AI Analysis note's write-up as a
 *  whole, not any one proposed outcome, so ticket-wide columns are still the right
 *  shape for what's actually being rated. Per-outcome feedback (ai_ticket_outcomes
 *  already has the columns) is worth doing once the UI asks a per-outcome question. */
async function buildFeedbackContext(token: string, jobId: string): Promise<string[]> {
  const tickets = await listTickets(token, { job_id: jobId });
  return tickets
    .filter((t) => !!t.ai_outcome_feedback_reason && !!t.ai_outcome_feedback)
    .sort((a, b) => new Date(b.ai_outcome_feedback_at ?? 0).getTime() - new Date(a.ai_outcome_feedback_at ?? 0).getTime())
    .slice(0, FEEDBACK_HISTORY_LIMIT)
    .map((t) => `- [${t.ai_outcome_feedback}] "${t.name}": ${t.ai_outcome_feedback_reason}`);
}

function buildTicketPrompt(ticket: Ticket, feedbackContext: string[]): string {
  const lines = [
    `Ticket: ${ticket.name}`,
    `Type: ${ticket.ticket_type ?? "unspecified"}`,
    `Priority: ${ticket.priority ?? "unspecified"}`,
    "",
    "Description:",
    ticket.description?.trim() || "(no description provided)",
  ];
  if (feedbackContext.length > 0) {
    lines.push(
      "",
      "Prior human feedback on AI triage in this queue (most recent first) — use this to avoid repeating past mistakes:",
      ...feedbackContext
    );
  }
  return lines.join("\n");
}

async function runTriageDecision(ticketPrompt: string): Promise<TriageResult> {
  const model = getAiModel(TRIAGE_PROVIDER, TRIAGE_MODEL);
  try {
    const { object } = await generateObject({
      model,
      schema: TriageResultSchema,
      system: TRIAGE_SYSTEM_PROMPT,
      prompt: ticketPrompt,
    });
    return object;
  } catch (err) {
    // Model didn't return a schema-valid response — still surface that the
    // ticket was looked at rather than dropping it, but propose no outcomes
    // (never act on an unparseable decision).
    console.error("AI triage: generateObject failed:", err);
    return {
      analysis: "AI triage could not produce a structured analysis for this ticket.",
      outcomes: [],
    };
  }
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.CUNAV_AI_WEBHOOK_SECRET;
  const providedSecret = req.headers.get("x-awe-webhook-secret");
  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workflow_id: workflowId } = (await req.json()) as { workflow_id?: string };
  if (!workflowId) {
    return NextResponse.json({ error: "workflow_id required" }, { status: 400 });
  }

  let token: string;
  try {
    token = await getAiServiceToken();
  } catch (err) {
    console.error("AI triage: service account auth failed:", err);
    return NextResponse.json({ error: "AI triage service account not configured" }, { status: 500 });
  }

  try {
    const ticket = await getTicket(token, workflowId);

    // Idempotency: awe-server's dispatch can race or redeliver (create followed
    // immediately by a queue move both dispatching for the same ticket).
    if (ticket.ai_processed_at) {
      return NextResponse.json({ status: "already_processed" });
    }
    if (!ticket.job_id) {
      return NextResponse.json({ status: "skipped", reason: "ticket has no queue" });
    }

    const queue = (await getJob(token, ticket.job_id)) as Queue;
    if (!queue.ai_enabled) {
      return NextResponse.json({ status: "skipped", reason: "queue is not AI-enabled" });
    }

    // Claim the ticket before doing any real work. awe-server's dispatch is
    // fire-and-forget and can fire twice for the same ticket (e.g. create
    // immediately followed by a queue move) — claiming up front, not after the
    // LLM call + outcome dispatch, keeps two racing webhook calls from both
    // acting on the same ticket. Not a fully atomic claim (no compare-and-set
    // on the server), but it shrinks the race window from "the whole triage +
    // dispatch flow" to a single request round-trip.
    await updateTicket(token, ticket.id, { ai_processed_at: new Date().toISOString() });

    const feedbackContext = await buildFeedbackContext(token, ticket.job_id).catch(() => []);
    const decision = await runTriageDecision(buildTicketPrompt(ticket, feedbackContext));

    // Surfacing the model's self-reported confidence per outcome type lets a
    // human glance at past tickets and judge whether this ticket type/
    // description tends to produce trustworthy confidence scores.
    const outcomeSummary = decision.outcomes
      .map((o) => `${getOutcomeDefinition(o.type)?.label ?? o.type}: ${Math.round(o.confidence * 100)}%`)
      .join(" · ");
    const analysisBody = outcomeSummary
      ? `${decision.analysis}\n\n---\n*AI confidence — ${outcomeSummary}*`
      : decision.analysis;

    await createNote(token, {
      entity_type: "workflow",
      entity_id: ticket.id,
      title: AI_ANALYSIS_NOTE_TITLE,
      body: analysisBody,
      is_shared: true,
    });

    const ruleConfigs: AiOutcomeRuleConfig[] = Array.isArray(queue.ai_rules) ? queue.ai_rules : [];
    let routeToTograExecuted = false;
    let routeToTograConfidence: number | null = null;

    for (const proposed of decision.outcomes) {
      const definition = getOutcomeDefinition(proposed.type);
      if (!definition) continue; // model proposed a type we have no module for — ignore

      const rule = ruleConfigs.find((r) => r.type === proposed.type);
      const threshold = rule?.confidence_threshold ?? definition.defaultConfidenceThreshold;
      // Outcome types require explicit per-queue opt-in — an outcome type with
      // no rule entry at all is treated as disabled, not "on by default".
      const eligible = (rule?.enabled ?? false) && proposed.confidence >= threshold;

      let result: { executed: boolean; detail?: string; relatedWorkflowId?: string; noteId?: string } = {
        executed: false,
      };
      let executionError: string | undefined;
      if (eligible) {
        try {
          result = await definition.run({ token, ticket, queue, confidence: proposed.confidence });
        } catch (err) {
          executionError = err instanceof Error ? err.message : String(err);
          console.error(`AI triage: outcome executor "${proposed.type}" failed for ticket ${ticket.id}:`, err);
        }
      }

      await createTicketOutcome(token, ticket.id, {
        outcome_type: proposed.type,
        confidence: proposed.confidence,
        executed: result.executed,
        execution_error: executionError,
        related_workflow_id: result.relatedWorkflowId,
        detail: result.detail,
        note_id: result.noteId,
      }).catch((err) => console.error("AI triage: failed to persist outcome row:", err));

      if (proposed.type === ROUTE_TO_TOGRA_TYPE) {
        routeToTograConfidence = proposed.confidence;
        routeToTograExecuted = result.executed;
      }
    }

    // Back-compat: keep the pre-multi-outcome columns populated so existing
    // eval queries against workflows.ai_confidence/ai_should_route keep
    // working. ai_should_route now reflects whether routing actually executed
    // rather than the model's raw pre-threshold recommendation — a small
    // semantic shift, but the closer of the two to what these columns were
    // used for in practice.
    await updateTicket(token, ticket.id, {
      status: "In Progress",
      ai_confidence: routeToTograConfidence ?? undefined,
      ai_should_route: routeToTograConfidence != null ? routeToTograExecuted : undefined,
    });

    return NextResponse.json({ status: "processed", routed: routeToTograExecuted });
  } catch (err) {
    if (err instanceof AiProviderNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(`AI triage failed for workflow ${workflowId}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI triage failed" },
      { status: 500 }
    );
  }
}
