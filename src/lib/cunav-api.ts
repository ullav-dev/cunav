// Cunav-specific API calls — ticket CRUD wrapping workflow endpoints,
// plus queue (job) management.

import type { Ticket, Queue, Job, TicketType, Priority, AiOutcomeFeedback, AiOutcomeRuleConfig, AiTicketOutcome, Connection } from "./types";

const BASE =
  typeof window === "undefined"
    ? (process.env.API_URL ?? "http://localhost:8085")
    : "/api";

async function apiRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
    ...init,
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 204 || !contentType.includes("application/json")) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return undefined as T;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? data.message ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Tickets (workflows with cunav fields) ──────────────────────────────────────

/** Keep only workflows that are cunav tickets — those with ticket_type set,
 *  or whose job_id belongs to a cunav queue. */
export function filterCunavTickets(tickets: Ticket[], queues: Queue[]): Ticket[] {
  const queueIds = new Set(queues.map((q) => q.id));
  return tickets.filter(
    (t) => t.ticket_type != null || (t.job_id != null && queueIds.has(t.job_id)),
  );
}

export const listTickets = (
  token: string,
  params?: { job_id?: string; team_id?: string }
): Promise<Ticket[]> => {
  const qs = new URLSearchParams();
  if (params?.job_id) qs.set("job_id", params.job_id);
  else if (params?.team_id) qs.set("team_id", params.team_id);
  const query = qs.toString() ? `?${qs}` : "";
  return apiRequest(`/workflows${query}`, token);
};

export const getTicket = (token: string, id: string): Promise<Ticket> =>
  apiRequest(`/workflows/${id}`, token);

export interface CreateTicketPayload {
  name: string;
  description?: string;
  job_id?: string;
  team_id?: string;
  ticket_type?: TicketType;
  priority?: Priority;
  is_shared?: boolean;
  // Reporter with no UUM user row (e.g. a customer emailing in) — independent
  // of reporter_id, which points at a real UUM user.
  external_reporter_first_name?: string;
  external_reporter_last_name?: string;
  external_reporter_email?: string;
}

export const createTicket = (token: string, payload: CreateTicketPayload): Promise<Ticket> =>
  apiRequest("/workflows", token, { method: "POST", body: JSON.stringify(payload) });

export interface UpdateTicketPayload {
  name?: string;
  description?: string;
  status?: string;
  ticket_type?: TicketType | null;
  priority?: Priority | null;
  assigned_to?: string | null;
  job_id?: string;
  is_shared?: boolean;
  togra_workflow_id?: string;
  togra_project_id?: string;
  ai_processed_at?: string;
  ai_confidence?: number;
  ai_should_route?: boolean;
  ai_outcome_feedback?: AiOutcomeFeedback;
  ai_outcome_feedback_reason?: string;
  ai_outcome_feedback_note_id?: string;
  // Reporter with no UUM user row. Omit to leave unchanged; send "" (empty
  // string, not undefined) to clear a previously-set field — the backend
  // applies these via COALESCE, so undefined/null both mean "leave as-is".
  external_reporter_first_name?: string;
  external_reporter_last_name?: string;
  external_reporter_email?: string;
}

export const updateTicket = (token: string, id: string, patch: UpdateTicketPayload): Promise<Ticket> =>
  apiRequest(`/workflows/${id}`, token, { method: "PUT", body: JSON.stringify(patch) });

export const deleteTicket = (token: string, id: string): Promise<void> =>
  apiRequest(`/workflows/${id}`, token, { method: "DELETE" });

// ── AI ticket outcomes ─────────────────────────────────────────────────────

export const listTicketOutcomes = (token: string, ticketId: string): Promise<AiTicketOutcome[]> =>
  apiRequest(`/workflows/${ticketId}/ai-outcomes`, token);

export interface CreateTicketOutcomePayload {
  outcome_type: string;
  confidence: number;
  executed?: boolean;
  execution_error?: string;
  related_workflow_id?: string;
  detail?: string;
  note_id?: string;
}

export const createTicketOutcome = (
  token: string,
  ticketId: string,
  payload: CreateTicketOutcomePayload
): Promise<AiTicketOutcome> =>
  apiRequest(`/workflows/${ticketId}/ai-outcomes`, token, {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateTicketOutcomeFeedback = (
  token: string,
  outcomeId: string,
  payload: { feedback: AiOutcomeFeedback; feedback_reason?: string }
): Promise<AiTicketOutcome> =>
  apiRequest(`/ai-outcomes/${outcomeId}/feedback`, token, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

// ── Queues (jobs with job_type = "queue") ─────────────────────────────────────

export const listQueues = async (token: string, params?: { team_id?: string }): Promise<Queue[]> => {
  const qs = new URLSearchParams();
  if (params?.team_id) qs.set("team_id", params.team_id);
  const jobs = await apiRequest<Job[]>(`/jobs?${qs}`, token);
  return jobs.filter((j): j is Queue => j.job_type === "queue");
};

export const createQueue = (
  token: string,
  payload: { name: string; team_id?: string }
): Promise<Queue> =>
  apiRequest("/jobs", token, {
    method: "POST",
    body: JSON.stringify({ ...payload, job_type: "queue" }),
  });

export interface UpdateQueuePayload {
  name?: string;
  archived?: boolean;
  ai_enabled?: boolean;
  ai_togra_project_id?: string | null;
  ai_togra_job_id?: string | null;
  ai_togra_template_id?: string | null;
  ai_route_confidence_threshold?: number;
  ai_rules?: AiOutcomeRuleConfig[];
  email_connection_id?: string | null;
}

export const updateQueue = (
  token: string,
  id: string,
  patch: UpdateQueuePayload
): Promise<Queue> =>
  apiRequest(`/jobs/${id}`, token, { method: "PUT", body: JSON.stringify(patch) });

export const deleteQueue = (token: string, id: string): Promise<void> =>
  apiRequest(`/jobs/${id}`, token, { method: "DELETE" });

// ── Connections (AWE-level, e.g. smtp) ────────────────────────────────────────

export const listConnections = (token: string, params?: { team_id?: string }): Promise<Connection[]> => {
  const qs = new URLSearchParams();
  if (params?.team_id) qs.set("team_id", params.team_id);
  const query = qs.toString() ? `?${qs}` : "";
  return apiRequest(`/connections${query}`, token);
};
