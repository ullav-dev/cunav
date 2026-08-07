// Inbound email webhook — called by an awe-server scheduled_scripts IMAP poll
// (docs/work-items/imap_poll.py in awe-server) once per new message it finds.
// Resolves the message to an existing ticket (reply-to address, then subject
// tag) and posts it as a note, or — if unresolved — files a new ticket with
// external_reporter_* parsed from the From header. See CLAUDE.md "Inbound
// Email" for the full design.
import { NextRequest, NextResponse } from "next/server";
import { getAiServiceToken } from "@/lib/ai-service-auth";
import { listNotes, createNote } from "@/lib/notes-api";
import { createTicket } from "@/lib/cunav-api";
import { INBOUND_EMAIL_NOTE_TITLE } from "@/lib/types";

const API_URL = process.env.API_URL ?? "http://localhost:8085";
const AUTH_URL = process.env.AUTH_URL ?? "http://localhost:8081";
// Queue a brand-new ticket lands in when an inbound email can't be resolved
// to an existing one. Required for the "create ticket" path; the "reply on
// an existing ticket" path works without it.
const INBOUND_EMAIL_QUEUE_ID = process.env.CUNAV_INBOUND_EMAIL_QUEUE_ID;

interface InboundEmailPayload {
  message_id?: string;
  from_email?: string;
  from_name?: string;
  to_emails?: string[];
  subject?: string;
  body?: string;
}

// Per-instance, in-memory rate guard against a spam flood creating unbounded
// tickets — resets on redeploy/restart, which is an acceptable gap for v1.
// A real multi-instance deployment would need this in Redis/Postgres instead.
const MAX_NEW_TICKETS_PER_WINDOW = 20;
const WINDOW_MS = 10 * 60_000;
let recentTicketCreations: number[] = [];

function newTicketRateLimited(): boolean {
  const now = Date.now();
  recentTicketCreations = recentTicketCreations.filter((t) => now - t < WINDOW_MS);
  if (recentTicketCreations.length >= MAX_NEW_TICKETS_PER_WINDOW) return true;
  recentTicketCreations.push(now);
  return false;
}

async function aweFetch(path: string, token: string) {
  return fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

/** Extracts a ticket-reference candidate from a plus-addressed reply-to
 *  address (`local+TAG@domain`), if any of `addresses` match that shape.
 *  Deliberately not tied to one known domain or mailbox — a queue's Reply-To
 *  is derived from whatever inbound connection it's configured with (see
 *  send-email/route.ts's replyToFromMailbox), which can differ per queue, so
 *  this just extracts the tag and lets /references/resolve (cunav::parse_ref
 *  in awe-server, which already accepts both a bare number and a
 *  PREFIX-NNN display id) sort out whether it's a real ticket. */
function ticketRefFromReplyTo(addresses: string[]): string | null {
  for (const addr of addresses) {
    const match = /^[^+@]+\+([^@]+)@/.exec(addr.trim());
    if (match) return match[1];
  }
  return null;
}

/** Extracts a ticket-number candidate from the subject tag cunav's own
 *  outbound route stamps on (see send-email/route.ts): either the current
 *  `[TKT-0009]`-style display id, or the legacy bare `[#42]` form still
 *  present in the tail of older reply chains. Only these exact bracketed
 *  tags, never a loose "#42" or "TKT-0009" in prose — a bare number is too
 *  easy for one customer to reference and land on another customer's
 *  ticket; the sender check below is the real guard, but there's no reason
 *  to widen the surface it has to catch. */
function ticketNumberFromSubject(subject: string): string | null {
  const tagged = /\[(?:#(\d+)|[A-Za-z]{1,10}-(\d{1,9}))\]/.exec(subject);
  if (!tagged) return null;
  return tagged[1] ?? tagged[2];
}

async function resolveTicket(
  token: string,
  candidate: string
): Promise<{ id: string; external_reporter_email: string | null; reporter_id: string | null } | null> {
  const res = await aweFetch(`/references/resolve?ref=${encodeURIComponent(candidate)}`, token);
  if (!res.ok) return null;
  const resolved = await res.json();
  if (resolved.kind !== "cunav_ticket") return null;
  const ticketRes = await aweFetch(`/workflows/${resolved.id}`, token);
  if (!ticketRes.ok) return null;
  const ticket = await ticketRes.json();
  return {
    id: resolved.id,
    external_reporter_email: ticket.external_reporter_email ?? null,
    reporter_id: ticket.reporter_id ?? null,
  };
}

/** The email a reply must come from to be attached to this ticket —
 *  external_reporter_email if set, otherwise the internal reporter's own
 *  email resolved via UUM (see send-email/route.ts's resolveRecipientEmail,
 *  same fallback). Keeping these two in sync matters: a ticket now sent to
 *  its internal reporter (no external_reporter_email at all) would
 *  otherwise never pass verification here — checking only
 *  external_reporter_email silently rejected every reply from an internal
 *  reporter and fell through to filing a spurious new ticket instead. */
async function resolveExpectedSenderEmail(
  token: string,
  ticket: { external_reporter_email: string | null; reporter_id: string | null }
): Promise<string | null> {
  if (ticket.external_reporter_email) return ticket.external_reporter_email;
  if (!ticket.reporter_id) return null;
  const res = await fetch(`${AUTH_URL}/users/${ticket.reporter_id}/email`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data: { email: string } = await res.json();
  return data.email || null;
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.CUNAV_EMAIL_WEBHOOK_SECRET;
  const providedSecret = req.headers.get("x-email-webhook-secret");
  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => null)) as InboundEmailPayload | null;
  if (!payload?.message_id || !payload.from_email) {
    return NextResponse.json({ error: "message_id and from_email are required" }, { status: 400 });
  }
  const { message_id, from_email, from_name, to_emails = [], subject = "", body = "" } = payload;

  let token: string;
  try {
    token = await getAiServiceToken();
  } catch (err) {
    console.error("Inbound email: service account auth failed:", err);
    return NextResponse.json({ error: "Email service account not configured" }, { status: 500 });
  }

  // Reply-to address is the primary signal (only reliable if the reply
  // preserved the plus-addressed address); subject tag is the fallback for
  // reply chains that only preserve the subject.
  const candidate = ticketRefFromReplyTo(to_emails) ?? ticketNumberFromSubject(subject);
  const resolved = candidate ? await resolveTicket(token, candidate) : null;
  const expectedSenderEmail = resolved ? await resolveExpectedSenderEmail(token, resolved) : null;

  // Require the sender to actually be this ticket's own reporter (external
  // or internal — see resolveExpectedSenderEmail) before attaching their
  // message to it — a forwarded or misquoted subject tag must not let one
  // customer's reply land on another customer's ticket. A mismatch (or a
  // ticket with no reporter email resolvable at all) falls through to
  // filing a new ticket instead of silently dropping the message.
  const ticketId =
    resolved && expectedSenderEmail?.toLowerCase() === from_email.toLowerCase()
      ? resolved.id
      : null;

  const noteBody = `${body.trim()}\n\n---\n*From: ${from_name ? `${from_name} ` : ""}<${from_email}>*\n*Message-ID: ${message_id}*`;

  if (ticketId) {
    // Dedup against redelivery (the poll script's own state should already
    // prevent this, but a retried webhook call after a partial failure
    // shouldn't create a duplicate note).
    const existing = await listNotes(token, "workflow", ticketId).catch(() => []);
    if (existing.some((n) => n.body?.includes(`Message-ID: ${message_id}`))) {
      return NextResponse.json({ status: "duplicate" });
    }
    await createNote(token, {
      entity_type: "workflow",
      entity_id: ticketId,
      title: INBOUND_EMAIL_NOTE_TITLE,
      body: noteBody,
      is_shared: true,
    });
    return NextResponse.json({ status: "noted", ticket_id: ticketId });
  }

  if (!INBOUND_EMAIL_QUEUE_ID) {
    return NextResponse.json(
      { error: "Could not resolve a ticket and CUNAV_INBOUND_EMAIL_QUEUE_ID is not set" },
      { status: 400 }
    );
  }
  if (newTicketRateLimited()) {
    return NextResponse.json({ error: "New-ticket rate limit exceeded, dropping message" }, { status: 429 });
  }

  // create_workflow does not derive team_id from job_id — it must be passed
  // explicitly (same as CreateTicketModal does), or the ticket lands with
  // team_id: null and its connection-scoped work items (e.g. "Send Email")
  // 403 later since they can never match a null team.
  const queueRes = await aweFetch(`/jobs/${INBOUND_EMAIL_QUEUE_ID}`, token);
  if (!queueRes.ok) {
    return NextResponse.json({ error: "CUNAV_INBOUND_EMAIL_QUEUE_ID does not resolve to a queue" }, { status: 500 });
  }
  const queue = await queueRes.json();

  const [first, ...rest] = (from_name || from_email).split(" ");
  const ticket = await createTicket(token, {
    name: subject.trim() || `Email from ${from_email}`,
    description: noteBody,
    job_id: INBOUND_EMAIL_QUEUE_ID,
    team_id: queue.team_id ?? undefined,
    ticket_type: "question",
    priority: "medium",
    is_shared: true,
    external_reporter_first_name: first || undefined,
    external_reporter_last_name: rest.join(" ") || undefined,
    external_reporter_email: from_email,
  });

  return NextResponse.json({ status: "created", ticket_id: ticket.id });
}
