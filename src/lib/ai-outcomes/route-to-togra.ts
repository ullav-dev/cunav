import { z } from "zod";
import { createWorkflow, createWorkflowFromTemplate, updateWorkflow } from "@/lib/awe-api";
import { updateTicket } from "@/lib/cunav-api";
import { createNote } from "@/lib/notes-api";
import { AI_AUTOROUTE_NOTE_TITLE } from "@/lib/types";
import type { AiOutcomeDefinition } from "./types";

export const ROUTE_TO_TOGRA_TYPE = "route_to_togra";

/** Creates the Togra story for the ticket in the queue's configured
 *  project/job(/template), links it back onto the ticket, and posts a note
 *  recording the auto-route. Mirrors the manual flow in SendToTograModal.
 *
 *  This is the only outcome type allowed to change ticket status/assignment —
 *  that's a property of this specific outcome, not something every outcome
 *  type gets. Contrast with flag_duplicate-style outcomes, whose only
 *  permitted side effect is posting a note for a human to act on. */
export const routeToTogra: AiOutcomeDefinition = {
  type: ROUTE_TO_TOGRA_TYPE,
  label: "Auto-route to Togra",
  defaultConfidenceThreshold: 0.7,
  promptGuidance:
    "Decide whether the ticket is clear and well-formed enough to auto-route into the team's " +
    "project tracker without a human triaging it first, and how confident you are in that " +
    "decision. Only propose this with meaningful confidence when the report has enough detail " +
    "to act on — vague, ambiguous, or incomplete reports should score low here.",
  payloadSchema: z.object({}),

  async run({ token, ticket, queue }) {
    // Project/job are required destination config beyond the generic
    // enabled+threshold gate the dispatch loop already checked — a queue can
    // have this rule "enabled" before an admin finishes picking a destination.
    if (!queue.ai_togra_project_id || !queue.ai_togra_job_id) {
      return { executed: false };
    }
    const projectId = queue.ai_togra_project_id;
    const jobId = queue.ai_togra_job_id;
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
      // Must NOT send ticket_type on the initial create: awe-server's create_workflow
      // treats any ticket_type-bearing request as a cunav ticket that has to land in
      // a queue-type job, and 400s when job_id (here, a Togra backlog/sprint) isn't
      // one. Create the plain Togra story first, then set ticket_type/priority via
      // a follow-up PATCH — same two-step shape the template branch above already uses.
      created = await createWorkflow(token, {
        name: ticket.name,
        description,
        job_id: jobId,
        is_shared: true,
      });
      created = await updateWorkflow(token, created.id, {
        ticket_type: ticket.ticket_type ?? undefined,
        priority: ticket.priority ?? undefined,
      });
    }

    await updateTicket(token, ticket.id, {
      togra_workflow_id: created.id,
      togra_project_id: projectId,
      status: "In Progress",
    });

    const note = await createNote(token, {
      entity_type: "workflow",
      entity_id: ticket.id,
      title: AI_AUTOROUTE_NOTE_TITLE,
      body: `Story created automatically by AI triage. Togra workflow ID: \`${created.id}\``,
      is_shared: true,
    });

    return { executed: true, relatedWorkflowId: created.id, noteId: note.id };
  },
};
