import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8085";

interface TicketRow {
  job_id: string | null;
  ticket_number: number | null;
  external_reporter_email: string | null;
}

interface JobRow {
  email_connection_id: string | null;
}

interface TaskRow {
  id: string;
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

  if (!ticket.external_reporter_email) {
    return NextResponse.json({ error: "Ticket has no external reporter email set" }, { status: 400 });
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

  // Tag the subject with the ticket number so a reply can be resolved back to
  // its ticket — see src/app/api/email/inbound/route.ts's subject-fallback
  // resolution. (The email script_type has no Reply-To support, unlike the
  // old work-item script, so this tag is the only resolution path for now.)
  const taggedSubject = ticket.ticket_number ? `${subject} [#${ticket.ticket_number}]` : subject;

  const inputsRes = await aweFetch(`/tasks/${task.id}/inputs`, authHeader, {
    method: "PATCH",
    body: JSON.stringify({
      values: { to: ticket.external_reporter_email, subject: taggedSubject, body_text: body },
    }),
  });
  if (!inputsRes.ok) {
    const err = await inputsRes.json().catch(() => ({}));
    return NextResponse.json({ error: err.error ?? "Failed to queue email" }, { status: 502 });
  }
  const updatedTask = await inputsRes.json();

  return NextResponse.json({ task_id: task.id, status: updatedTask.status });
}
