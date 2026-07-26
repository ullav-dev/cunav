import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8085";
// The domain cunav's ticket-{number}@... Reply-To addresses use, so a later
// inbound-email poll can route a reply back onto its ticket. Distinct from
// any product's own mail domain — this is purely the routing address.
const REPLY_TO_DOMAIN = process.env.REPLY_TO_DOMAIN;

interface TicketRow {
  job_id: string | null;
  ticket_number: number | null;
  external_reporter_email: string | null;
}

interface JobRow {
  email_work_item_id: string | null;
}

async function aweFetch(path: string, authHeader: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: authHeader, ...init?.headers },
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

  if (!ticket.external_reporter_email) {
    return NextResponse.json({ error: "Ticket has no external reporter email set" }, { status: 400 });
  }
  if (!ticket.job_id) {
    return NextResponse.json({ error: "Ticket has no queue" }, { status: 400 });
  }

  const jobRes = await aweFetch(`/jobs/${ticket.job_id}`, authHeader);
  if (!jobRes.ok) return NextResponse.json({ error: "Queue not found" }, { status: 404 });
  const job: JobRow = await jobRes.json();

  if (!job.email_work_item_id) {
    return NextResponse.json(
      { error: "This queue has no outbound-email work item configured (Queue settings → Outbound email work item)" },
      { status: 400 }
    );
  }

  const instRes = await aweFetch(`/work-items/${job.email_work_item_id}/instantiate`, authHeader, {
    method: "POST",
    body: JSON.stringify({ workflow_id: ticketId }),
  });
  if (!instRes.ok) {
    const err = await instRes.json().catch(() => ({}));
    return NextResponse.json({ error: err.error ?? "Failed to instantiate Send Email work item" }, { status: 502 });
  }
  const { primary_task: task } = await instRes.json();

  const values: Record<string, string> = {
    to: ticket.external_reporter_email,
    subject,
    body,
  };
  if (REPLY_TO_DOMAIN && ticket.ticket_number) {
    values.reply_to = `ticket-${ticket.ticket_number}@${REPLY_TO_DOMAIN}`;
  }

  const inputsRes = await aweFetch(`/tasks/${task.id}/inputs`, authHeader, {
    method: "PATCH",
    body: JSON.stringify({ values }),
  });
  if (!inputsRes.ok) {
    const err = await inputsRes.json().catch(() => ({}));
    return NextResponse.json({ error: err.error ?? "Failed to queue email" }, { status: 502 });
  }
  const updatedTask = await inputsRes.json();

  return NextResponse.json({ task_id: task.id, status: updatedTask.status });
}
