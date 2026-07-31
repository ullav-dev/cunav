import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8085";

interface TaskRow {
  status: string;
  end_time: string | null;
}

interface TaskRunRow {
  outcome: string | null;
  error_message: string | null;
  output_json: unknown;
  created_at: string;
}

async function aweFetch(path: string, authHeader: string) {
  return fetch(`${API_URL}${path}`, { headers: { "Content-Type": "application/json", Authorization: authHeader } });
}

// The email task runs on awe-runner, out of process from this request —
// creating/dispatching it only enqueues the send, it doesn't happen
// synchronously. The frontend polls this endpoint to learn whether the task
// actually completed (and how), instead of treating "queued successfully" as
// "delivered".
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await params;
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });

  const taskRes = await aweFetch(`/tasks/${taskId}`, authHeader);
  if (!taskRes.ok) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const task: TaskRow = await taskRes.json();

  if (task.status === "Complete") {
    return NextResponse.json({ status: "sent", at: task.end_time });
  }

  if (task.status === "On Hold") {
    // Retries exhausted — look up the most recent run for the failure detail.
    const runsRes = await aweFetch(`/tasks/${taskId}/runs`, authHeader);
    const runs: TaskRunRow[] = runsRes.ok ? await runsRes.json() : [];
    const lastRun = runs[0];
    return NextResponse.json({ status: "failed", error: lastRun?.error_message ?? "Send Email task did not complete" });
  }

  if (task.status === "Cancelled") {
    return NextResponse.json({ status: "failed", error: "Send Email task was cancelled" });
  }

  return NextResponse.json({ status: "pending" });
}
