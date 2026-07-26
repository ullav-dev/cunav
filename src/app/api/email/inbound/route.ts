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
const REPLY_TO_DOMAIN = process.env.REPLY_TO_DOMAIN;
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

async function aweFetch(path: string, authHeader: string) {
  return fetch(`${API_URL}${path}`, { headers: { Authorization: authHeader } });
}

/** Extracts a ticket-number candidate from a `ticket-{number}@...` reply-to
 *  address, if any of `addresses` match that shape. */
function ticketNumberFromReplyTo(addresses: string[]): string | null {
  for (const addr of addresses) {
    const match = /^ticket-(\d+)@/i.exec(addr.trim());
    if (match) return match[1];
  }
  return null;
}

/** Extracts a ticket-number candidate from a `[#42]` tag cunav's own outbound
 *  route stamps onto the subject (see send-email/route.ts), or a bare
 *  "CUNAV-42"/"#42" mention a reporter's mail client preserved on reply. */
function ticketNumberFromSubject(subject: string): string | null {
  const tagged = /\[#(\d+)\]/.exec(subject);
  if (tagged) return tagged[1];
  const hashed = /#(\d+)\b/.exec(subject);
  if (hashed) return hashed[1];
  return null;
}

async function resolveTicketId(token: string, candidate: string): Promise<string | null> {
  const res = await aweFetch(`/references/resolve?ref=${encodeURIComponent(candidate)}`, token);
  if (!res.ok) return null;
  const resolved = await res.json();
  return resolved.kind === "cunav_ticket" ? resolved.id : null;
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

  // Reply-to address is the primary signal (only reliable if REPLY_TO_DOMAIN
  // is configured and the reply preserved the address); subject tag is the
  // fallback for reply chains that only preserve the subject.
  const candidate =
    (REPLY_TO_DOMAIN ? ticketNumberFromReplyTo(to_emails) : null) ?? ticketNumberFromSubject(subject);
  const ticketId = candidate ? await resolveTicketId(token, candidate) : null;

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

  const [first, ...rest] = (from_name || from_email).split(" ");
  const ticket = await createTicket(token, {
    name: subject.trim() || `Email from ${from_email}`,
    description: noteBody,
    job_id: INBOUND_EMAIL_QUEUE_ID,
    ticket_type: "question",
    priority: "medium",
    is_shared: true,
    external_reporter_first_name: first || undefined,
    external_reporter_last_name: rest.join(" ") || undefined,
    external_reporter_email: from_email,
  });

  return NextResponse.json({ status: "created", ticket_id: ticket.id });
}
