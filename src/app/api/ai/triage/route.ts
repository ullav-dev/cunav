// AI triage webhook — called by awe-server (fire-and-forget) whenever a ticket
// lands in an AI-enabled queue. Runs a single structured LLM call to produce an
// analysis + routing recommendation, posts the analysis as a note, and — above
// the queue's configured confidence threshold — auto-creates the matching Togra
// story, the same three choices (project/job/template) a human picks by hand in
// SendToTograModal. See CLAUDE.md "AI Enabled Queues" for the full design.
import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getTicket, updateTicket } from "@/lib/cunav-api";
import { getJob, createWorkflow, createWorkflowFromTemplate, updateWorkflow } from "@/lib/awe-api";
import { createNote } from "@/lib/notes-api";
import { getAiServiceToken } from "@/lib/ai-service-auth";
import { getAiModel, AiProviderNotConfiguredError } from "@/lib/ai-provider";
import type { AiProvider } from "@/lib/ai-settings";
import type { Ticket, Job } from "@/lib/types";

const TRIAGE_PROVIDER = (process.env.AI_TRIAGE_PROVIDER as AiProvider | undefined) ?? "anthropic";
const TRIAGE_MODEL = process.env.AI_TRIAGE_MODEL;

const TRIAGE_SYSTEM_PROMPT = `You are an AI triage assistant for a customer support ticket queue. For each incoming ticket:

1. Write a short (2-4 sentence) analysis: likely root cause or category, whether it looks like a duplicate or known pattern, and a recommended next step for the support team.
2. Decide whether the ticket is clear and well-formed enough to auto-route into the team's project tracker without a human triaging it first, and how confident you are in that decision (0.0-1.0). Only recommend routing when the report has enough detail to act on — vague, ambiguous, or incomplete reports should not be routed.

Respond with ONLY a JSON object, no other text, in exactly this shape:
{"analysis": string, "should_route": boolean, "confidence": number}`;

interface TriageDecision {
  analysis: string;
  should_route: boolean;
  confidence: number;
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

function buildTicketPrompt(ticket: Ticket): string {
  return [
    `Ticket: ${ticket.name}`,
    `Type: ${ticket.ticket_type ?? "unspecified"}`,
    `Priority: ${ticket.priority ?? "unspecified"}`,
    "",
    "Description:",
    ticket.description?.trim() || "(no description provided)",
  ].join("\n");
}

async function runTriageDecision(ticketPrompt: string): Promise<TriageDecision> {
  const model = getAiModel(TRIAGE_PROVIDER, TRIAGE_MODEL);
  const { text } = await generateText({
    model,
    system: TRIAGE_SYSTEM_PROMPT,
    prompt: ticketPrompt,
  });

  try {
    const parsed = JSON.parse(extractJson(text));
    return {
      analysis: typeof parsed.analysis === "string" ? parsed.analysis : text,
      should_route: parsed.should_route === true,
      confidence: typeof parsed.confidence === "number" ? Math.min(1, Math.max(0, parsed.confidence)) : 0,
    };
  } catch {
    // Model didn't return parseable JSON — still surface its text as the analysis
    // rather than dropping it, but never auto-route on an unparseable decision.
    return { analysis: text, should_route: false, confidence: 0 };
  }
}

/** Creates the Togra story for `ticket` in the queue's configured project/job(/template),
 *  links it back onto the ticket, and posts a note recording the auto-route. Mirrors
 *  the manual flow in SendToTograModal + the ticket page's handleTograSent. */
async function routeToTogra(token: string, ticket: Ticket, queue: Job): Promise<string> {
  const projectId = queue.ai_togra_project_id!;
  const jobId = queue.ai_togra_job_id!;
  const templateId = queue.ai_togra_template_id;

  const backlink = `\n\n---\n*Cunav ticket: ${ticket.ticket_number ? `#${ticket.ticket_number}` : ticket.id}*`;
  const description = (ticket.description ?? "").trim() + backlink;

  let created;
  if (templateId) {
    created = await createWorkflowFromTemplate(token, jobId, templateId);
    created = await updateWorkflow(token, created.id, {
      name: ticket.name,
      description,
      ticket_type: ticket.ticket_type ?? undefined,
      priority: ticket.priority ?? undefined,
      is_shared: true,
    });
  } else {
    created = await createWorkflow(token, {
      name: ticket.name,
      description,
      job_id: jobId,
      is_shared: true,
      ticket_type: ticket.ticket_type ?? undefined,
      priority: ticket.priority ?? undefined,
    });
  }

  await updateTicket(token, ticket.id, {
    togra_workflow_id: created.id,
    togra_project_id: projectId,
    status: "In Progress",
  });

  await createNote(token, {
    entity_type: "workflow",
    entity_id: ticket.id,
    title: "Auto-routed to Togra",
    body: `Story created automatically by AI triage. Togra workflow ID: \`${created.id}\``,
    is_shared: true,
  });

  return created.id;
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

    const queue = await getJob(token, ticket.job_id);
    if (!queue.ai_enabled) {
      return NextResponse.json({ status: "skipped", reason: "queue is not AI-enabled" });
    }

    // Claim the ticket before doing any real work. awe-server's dispatch is
    // fire-and-forget and can fire twice for the same ticket (e.g. create
    // immediately followed by a queue move) — claiming up front, not after the
    // LLM call + routing, keeps two racing webhook calls from both deciding to
    // route and creating duplicate Togra stories. Not a fully atomic claim
    // (no compare-and-set on the server), but it shrinks the race window from
    // "the whole triage + routing flow" to a single request round-trip.
    await updateTicket(token, ticket.id, { ai_processed_at: new Date().toISOString() });

    const decision = await runTriageDecision(buildTicketPrompt(ticket));

    await createNote(token, {
      entity_type: "workflow",
      entity_id: ticket.id,
      title: "AI Analysis",
      body: decision.analysis,
      is_shared: true,
    });

    let routed = false;
    const canRoute =
      decision.should_route &&
      decision.confidence >= queue.ai_route_confidence_threshold &&
      !!queue.ai_togra_project_id &&
      !!queue.ai_togra_job_id;
    if (canRoute) {
      await routeToTogra(token, ticket, queue);
      routed = true;
    }

    return NextResponse.json({ status: "processed", routed, confidence: decision.confidence });
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
