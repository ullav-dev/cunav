// Cunav-specific API calls — ticket CRUD wrapping workflow endpoints,
// plus queue (job) management.

import type { Ticket, Queue, Job, TicketType, Priority } from "./types";

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
}

export const updateTicket = (token: string, id: string, patch: UpdateTicketPayload): Promise<Ticket> =>
  apiRequest(`/workflows/${id}`, token, { method: "PUT", body: JSON.stringify(patch) });

export const deleteTicket = (token: string, id: string): Promise<void> =>
  apiRequest(`/workflows/${id}`, token, { method: "DELETE" });

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

export const updateQueue = (
  token: string,
  id: string,
  patch: { name?: string; archived?: boolean }
): Promise<Queue> =>
  apiRequest(`/jobs/${id}`, token, { method: "PUT", body: JSON.stringify(patch) });

export const deleteQueue = (token: string, id: string): Promise<void> =>
  apiRequest(`/jobs/${id}`, token, { method: "DELETE" });
