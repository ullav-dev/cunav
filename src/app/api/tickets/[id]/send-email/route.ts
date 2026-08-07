import { NextRequest, NextResponse } from "next/server";
import { ticketId as formatTicketId } from "@/lib/ticket-id";

const API_URL = process.env.API_URL ?? "http://localhost:8085";
const AUTH_URL = process.env.AUTH_URL ?? "http://localhost:8081";

interface TicketRow {
  job_id: string | null;
  ticket_number: number | null;
  external_reporter_email: string | null;
  /** A real UUM user, distinct from external_reporter_*. Only used to look
   *  up an email to send to when there's no external_reporter_email — see
   *  resolveRecipientEmail. */
  reporter_id: string | null;
}

/** external_reporter_email always wins when set (a ticket may have both
 *  fields for edge cases like a UUM user who filed via a channel that also
 *  captured a raw email, but the explicit external field is the more
 *  deliberate one). Otherwise falls back to resolving reporter_id's own
 *  email via UUM — internal reporters have real accounts and a real email
 *  just like an external one, there was never a good reason to only support
 *  one of the two. Returns null (not an error) if neither is available, so
 *  the caller can produce one clear "no recipient" message either way. */
async function resolveRecipientEmail(ticket: TicketRow, authHeader: string): Promise<string | null> {
  if (ticket.external_reporter_email) return ticket.external_reporter_email;
  if (!ticket.reporter_id) return null;
  const res = await fetch(`${AUTH_URL}/users/${ticket.reporter_id}/email`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) return null;
  const data: { email: string } = await res.json();
  return data.email || null;
}

interface JobRow {
  email_connection_id: string | null;
  inbound_email_connection_id: string | null;
}

interface ConnectionRow {
  config: Record<string, string> | null;
}

interface TaskRow {
  id: string;
}

/** Derives a per-ticket Reply-To address from the queue's own inbound IMAP
 *  connection — not a deployment-wide env var. Plus-addressing
 *  (`local+TAG@domain`) off that connection's own mailbox (config.username)
 *  means the reply lands in exactly the mailbox this queue is already
 *  configured to poll, with no separate catch-all domain/DNS to set up —
 *  see AiQueueSettingsModal's "Inbound email connection" section and
 *  CLAUDE.md "Inbound Email". Returns null if the connection isn't imap, has
 *  no username configured, or the username isn't a plain address — any of
 *  which means Reply-To can't be built, not something to guess at. */
function replyToFromMailbox(config: Record<string, string> | null, ticketNumber: number): string | null {
  const mailbox = config?.username;
  if (!mailbox) return null;
  const at = mailbox.indexOf("@");
  if (at <= 0) return null;
  const local = mailbox.slice(0, at);
  const domain = mailbox.slice(at + 1);
  return `${local}+${formatTicketId(ticketNumber)}@${domain}`;
}

async function aweFetch(path: string, authHeader: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: authHeader, ...init?.headers },
  });
}

// Registers a required input port spec on the task — these are what gate its
// auto-unlock from "Not Started" to "Ready" once all three are patched (see
// apply_input_values in awe-server). Without them the task would unlock (and
// dispatch) the moment any single input lands, before the message is complete.
async function requirePort(taskId: string, name: string, authHeader: string) {
  return aweFetch(`/tasks/${taskId}/ports`, authHeader, {
    method: "POST",
    body: JSON.stringify({ direction: "input", name, value_type: "string", required: true }),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: ticketId } = await params;
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let subject: string, body: string;
  try {
    const payload = await req.json();
    subject = String(payload.subject ?? "");
    body = String(payload.body ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (!subject.trim() || !body.trim()) {
    return NextResponse.json({ error: "subject and body are required" }, { status: 400 });
  }

  const ticketRes = await aweFetch(`/workflows/${ticketId}`, authHeader);
  if (!ticketRes.ok) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  const ticket: TicketRow = await ticketRes.json();

  const recipientEmail = await resolveRecipientEmail(ticket, authHeader);
  if (!recipientEmail) {
    return NextResponse.json(
      { error: "Ticket has no reporter email available — set an external reporter email, or assign an internal reporter" },
      { status: 400 }
    );
  }
  if (!ticket.job_id) {
    return NextResponse.json({ error: "Ticket has no queue" }, { status: 400 });
  }

  const jobRes = await aweFetch(`/jobs/${ticket.job_id}`, authHeader);
  if (!jobRes.ok) return NextResponse.json({ error: "Queue not found" }, { status: 404 });
  const job: JobRow = await jobRes.json();

  if (!job.email_connection_id) {
    return NextResponse.json(
      { error: "This queue has no outbound-email connection configured (Queue settings → Outbound email connection)" },
      { status: 400 }
    );
  }

  const taskRes = await aweFetch("/tasks", authHeader, {
    method: "POST",
    body: JSON.stringify({ name: "Send Email", workflow_id: ticketId, task_type: "automated" }),
  });
  if (!taskRes.ok) {
    const err = await taskRes.json().catch(() => ({}));
    return NextResponse.json({ error: err.error ?? "Failed to create Send Email task" }, { status: 502 });
  }
  const task: TaskRow = await taskRes.json();

  const scriptRes = await aweFetch(`/tasks/${task.id}/script`, authHeader, {
    method: "PUT",
    body: JSON.stringify({ script_type: "email", connection_id: job.email_connection_id }),
  });
  if (!scriptRes.ok) {
    const err = await scriptRes.json().catch(() => ({}));
    return NextResponse.json({ error: err.error ?? "Failed to attach email script to task" }, { status: 502 });
  }

  for (const port of ["to", "subject", "body_text"]) {
    const portRes = await requirePort(task.id, port, authHeader);
    if (!portRes.ok) {
      const err = await portRes.json().catch(() => ({}));
      return NextResponse.json({ error: err.error ?? `Failed to register '${port}' input port` }, { status: 502 });
    }
  }

  // Tag the subject with the ticket's display id (e.g. "[TKT-0009]") so a
  // reply can still be resolved back to its ticket even when the mail client
  // drops/mangles Reply-To (forwarded messages, some webmail "reply" flows) —
  // see src/app/api/email/inbound/route.ts's subject-fallback resolution,
  // which also still accepts the legacy bare "[#N]" form for older chains.
  const taggedSubject = ticket.ticket_number ? `${subject} [${formatTicketId(ticket.ticket_number)}]` : subject;

  // Reply-To is the primary resolution path when the queue has an inbound
  // connection configured — `from` deliberately stays the outbound
  // connection's own account (see run_email's comment in awe-server: an
  // unaligned From gets rejected or rewritten by most providers), but
  // Reply-To can be anything, so a per-ticket address goes here instead,
  // derived from the queue's own inbound mailbox rather than a
  // deployment-wide domain.
  let replyTo: string | null = null;
  if (job.inbound_email_connection_id && ticket.ticket_number) {
    const inboundConnRes = await aweFetch(`/connections/${job.inbound_email_connection_id}`, authHeader);
    if (inboundConnRes.ok) {
      const inboundConn: ConnectionRow = await inboundConnRes.json();
      replyTo = replyToFromMailbox(inboundConn.config, ticket.ticket_number);
    }
    // A configured-but-unresolvable inbound connection isn't fatal to the
    // send itself (unlike the outbound connection check above) — the email
    // still goes out, just without Reply-To, same as if none were configured.
  }

  const inputsRes = await aweFetch(`/tasks/${task.id}/inputs`, authHeader, {
    method: "PATCH",
    body: JSON.stringify({
      values: {
        to: recipientEmail,
        subject: taggedSubject,
        body_text: body,
        ...(replyTo ? { reply_to: replyTo } : {}),
      },
    }),
  });
  if (!inputsRes.ok) {
    const err = await inputsRes.json().catch(() => ({}));
    return NextResponse.json({ error: err.error ?? "Failed to queue email" }, { status: 502 });
  }
  const updatedTask = await inputsRes.json();

  // recipient_email echoed back so the client can log an audit note without
  // needing to separately resolve an internal reporter's address itself.
  return NextResponse.json({ task_id: task.id, status: updatedTask.status, recipient_email: recipientEmail });
}
