import { z } from "zod";
import { listTickets } from "@/lib/cunav-api";
import { tackNotesApi, resolveAiPrincipalId, workflowAttachment } from "@/lib/tack-notes-server";
import { AI_DUPLICATE_NOTE_TITLE } from "@/lib/types";
import type { AiOutcomeDefinition } from "./types";

export const FLAG_DUPLICATE_TYPE = "flag_duplicate";

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "this", "that",
  "have", "has", "was", "were", "from", "when", "what", "then", "than", "into",
  "can", "cant", "wont", "doesnt", "does", "did", "will", "would", "should",
  "there", "their", "about", "again", "some", "just", "also", "please", "issue",
  "ticket", "problem",
]);

/** Word set used for a cheap lexical-overlap similarity score — deliberately
 *  not another LLM call (see CLAUDE.md: "v1 deliberately uses one structured
 *  LLM call + deterministic follow-up calls, not an autonomous tool-use
 *  loop"). Only the model's confidence that this ticket *resembles* known
 *  territory comes from the triage call; which existing ticket it resembles
 *  is resolved deterministically here. */
function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

/** Overlap coefficient (intersection / smaller set), not Jaccard — Jaccard's
 *  union-sized denominator unfairly punishes a short new ticket matched
 *  against a long, detailed existing one even when every word in the short
 *  one appears in the long one. Overlap coefficient asks "how much of the
 *  smaller ticket's vocabulary shows up in the other one" instead. */
function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  return intersection / Math.min(a.size, b.size);
}

/** Minimum lexical-overlap score before a candidate is worth naming in the
 *  note — independent of the AI's own confidence threshold (which gates
 *  whether this outcome runs at all), this avoids naming a "best match" that
 *  only shares a couple of common words in a small queue. */
const MIN_MATCH_SCORE = 0.35;

/** cunav's own base URL, for linking back to the matched ticket from the
 *  note — same server-only-env-var pattern as TOGRA_URL/OBAIR_URL (see
 *  AppUrlsContext), just pointed at this app instead of another one. Not
 *  request-scoped (this runs from the triage webhook, with no browser
 *  request to read an Origin/Host header from), so it has to be configured
 *  rather than inferred. Locale is hardcoded to the default (`routing.
 *  defaultLocale` — "en") for the same reason: no request to resolve a
 *  locale from. next-intl's middleware will still route correctly for a
 *  reader on a different locale, just via one redirect. */
const CUNAV_APP_URL = process.env.CUNAV_APP_URL ?? "http://localhost:3008";

function ticketUrl(ticketId: string): string {
  return `${CUNAV_APP_URL}/en/tickets/${ticketId}`;
}

/** Flags a ticket that lexically resembles another ticket anywhere in the
 *  organization (regardless of queue, or that ticket's status — a match
 *  against a resolved ticket is still useful, since it may point straight at
 *  the fix) by posting a note naming the likely match — it never merges,
 *  relinks, or changes ticket status/assignment itself. Contrast with
 *  route-to-togra.ts, the only outcome type allowed to mutate the ticket:
 *  a duplicate match is a judgment call for a human to confirm, not
 *  something safe to act on unattended.
 *
 *  `deterministic: true` — this used to be dispatched like route_to_togra:
 *  the triage LLM call guessed a confidence for "is this a duplicate" with
 *  no other tickets in front of it, and that blind guess gated whether this
 *  matcher ever ran at all. It was consistently near-zero (an LLM has no
 *  real basis to answer a search question from a single ticket's text) and
 *  silently suppressed real matches, including verbatim copies. "Is this a
 *  duplicate" isn't a judgment call to guess at — it's a search problem with
 *  a computable answer, so it's no longer put to the model at all: the
 *  triage route runs this unconditionally whenever the queue's rule is
 *  enabled, and this function's own overlap score is what stands as its
 *  confidence. What's still genuinely AI here is the analysis note and
 *  route_to_togra's routing judgment — this one just searches. */
export const flagDuplicate: AiOutcomeDefinition = {
  type: FLAG_DUPLICATE_TYPE,
  label: "Flag possible duplicate",
  defaultConfidenceThreshold: 0.6,
  deterministic: true,
  promptGuidance: "", // unused — see deterministic: true above.
  payloadSchema: z.object({}),

  async run({ token, ticket, queue }) {
    if (!ticket.job_id) return { executed: false };

    // Organization-wide, not queue-scoped: the same underlying issue is
    // commonly reported into different queues (e.g. Business vs Catch-All),
    // so a search confined to ticket.job_id would miss exactly the
    // cross-queue duplicates that are hardest for a human to spot. Falls
    // back to job_id scope for a ticket/queue with no organization_id yet
    // (e.g. a deployment that hasn't adopted organizations).
    const candidates = (
      ticket.organization_id
        ? await listTickets(token, { organization_id: ticket.organization_id })
        : await listTickets(token, { job_id: ticket.job_id })
    ).filter((t) => t.id !== ticket.id);
    if (candidates.length === 0) return { executed: false };

    const ticketWords = significantWords(`${ticket.name} ${ticket.description ?? ""}`);
    let best: { candidate: (typeof candidates)[number]; score: number } | null = null;
    for (const candidate of candidates) {
      const score = overlapCoefficient(
        ticketWords,
        significantWords(`${candidate.name} ${candidate.description ?? ""}`)
      );
      if (!best || score > best.score) best = { candidate, score };
    }
    if (!best) return { executed: false };
    if (best.score < MIN_MATCH_SCORE) return { executed: false, confidence: best.score };

    const label = best.candidate.ticket_number ? `#${best.candidate.ticket_number}` : best.candidate.id;
    const matchPct = Math.round(best.score * 100);
    // Notes render as markdown (see NotesPanel's ReactMarkdown), so a real
    // link — not just the ticket's display id as plain text — takes a
    // reviewer straight to the matched ticket instead of leaving them to
    // find it by hand.
    const link = `[${label} — "${best.candidate.name}"](${ticketUrl(best.candidate.id)})`;

    const teamId = ticket.team_id ?? queue.team_id;
    let noteId: string | undefined;
    if (teamId) {
      const api = tackNotesApi(token);
      const createdBy = await resolveAiPrincipalId(api, ticket.organization_id);
      const note = await api.createNote({
        team_id: teamId,
        visibility: "team",
        title: AI_DUPLICATE_NOTE_TITLE,
        body_markdown:
          `This ticket may duplicate ${link} (${matchPct}% word overlap). ` +
          "Please review and merge or close if confirmed.",
        attach: workflowAttachment(ticket.id),
        ...(createdBy ? { created_by: createdBy } : {}),
      });
      noteId = note.id;
    } else {
      console.error(`flag-duplicate: ticket ${ticket.id} has no team_id (queue ${queue.id} either) -- skipping note`);
    }

    return {
      executed: true,
      detail: `Possible duplicate of ${label} (${matchPct}% word overlap)`,
      relatedWorkflowId: best.candidate.id,
      noteId,
      confidence: best.score,
    };
  },
};
