// AWE API calls (jobs, workflows, tasks, teams) used by Cunav.
// All browser requests go via /api/* rewrite; server-side uses API_URL directly.

import type { Job, Workflow, TeamSummary, Team, TeamRole } from "./types";

const BASE =
  typeof window === "undefined"
    ? (process.env.API_URL ?? "http://localhost:8085")
    : "/api";

const AUTH_BASE =
  typeof window === "undefined"
    ? (process.env.AUTH_URL ?? "http://localhost:8081")
    : "/auth-api";

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

async function authApiRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${AUTH_BASE}${path}`, {
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

// ── Jobs / Queues ─────────────────────────────────────────────────────────────

export const listJobs = (token: string, params?: { team_id?: string; job_type?: string }): Promise<Job[]> => {
  const qs = new URLSearchParams();
  if (params?.team_id) qs.set("team_id", params.team_id);
  if (params?.job_type) qs.set("job_type", params.job_type);
  const query = qs.toString() ? `?${qs}` : "";
  return apiRequest(`/jobs${query}`, token);
};

export const createJob = (
  token: string,
  payload: {
    name: string;
    team_id?: string;
    job_type?: string;
  }
): Promise<Job> =>
  apiRequest("/jobs", token, { method: "POST", body: JSON.stringify(payload) });

export const getJob = (token: string, id: string): Promise<Job> =>
  apiRequest(`/jobs/${id}`, token);

export const updateJob = (
  token: string,
  id: string,
  patch: { name?: string; status?: string; archived?: boolean }
): Promise<Job> =>
  apiRequest(`/jobs/${id}`, token, { method: "PUT", body: JSON.stringify(patch) });

export const deleteJob = (token: string, id: string): Promise<void> =>
  apiRequest(`/jobs/${id}`, token, { method: "DELETE" });

// ── Workflows ─────────────────────────────────────────────────────────────────

export const listWorkflows = (token: string, params?: { job_id?: string; team_id?: string }): Promise<Workflow[]> => {
  const qs = new URLSearchParams();
  if (params?.job_id) qs.set("job_id", params.job_id);
  else if (params?.team_id) qs.set("team_id", params.team_id);
  const query = qs.toString() ? `?${qs}` : "";
  return apiRequest(`/workflows${query}`, token);
};

export const getWorkflow = (token: string, id: string): Promise<Workflow> =>
  apiRequest(`/workflows/${id}`, token);

export const createWorkflow = (
  token: string,
  payload: {
    name: string;
    job_id?: string;
    description?: string;
    is_shared?: boolean;
    team_id?: string;
    ticket_type?: string;
    priority?: string;
  }
): Promise<Workflow> =>
  apiRequest("/workflows", token, { method: "POST", body: JSON.stringify(payload) });

/** Duplicates a template workflow into `jobId` (e.g. a Togra backlog/sprint). */
export const createWorkflowFromTemplate = (
  token: string,
  jobId: string,
  templateWorkflowId: string
): Promise<Workflow> =>
  apiRequest(`/jobs/${jobId}/workflows/from-template/${templateWorkflowId}`, token, { method: "POST" });

export const updateWorkflow = (
  token: string,
  id: string,
  patch: {
    name?: string;
    description?: string;
    status?: string;
    job_id?: string;
    is_shared?: boolean;
    ticket_type?: string;
    priority?: string;
  }
): Promise<Workflow> =>
  apiRequest(`/workflows/${id}`, token, { method: "PUT", body: JSON.stringify(patch) });

export const deleteWorkflow = (token: string, id: string): Promise<void> =>
  apiRequest(`/workflows/${id}`, token, { method: "DELETE" });

// ── Work items (outbound email) ────────────────────────────────────────────────

export interface WorkItemSummary {
  id: string;
  name: string;
  description: string | null;
}

interface TaskSummary {
  id: string;
  status: string;
}

/** Work items visible to the caller (shared, own team, or own) — used to populate
 *  the "Send Email" work item picker in queue settings. */
export const listWorkItems = (token: string): Promise<WorkItemSummary[]> =>
  apiRequest("/work-items", token);

/** Instantiates a work item (e.g. the queue's configured "Send Email" template)
 *  into `workflowId`, returning the new task. */
export const instantiateWorkItem = (
  token: string,
  workItemId: string,
  workflowId: string
): Promise<{ primary_task: TaskSummary }> =>
  apiRequest(`/work-items/${workItemId}/instantiate`, token, {
    method: "POST",
    body: JSON.stringify({ workflow_id: workflowId }),
  });

/** Sets a task's input port values. For an automated task with no predecessors,
 *  setting all required inputs auto-transitions it to Ready and it dispatches
 *  to the runner on its own — no separate "start" call needed. */
export const setTaskInputs = (
  token: string,
  taskId: string,
  values: Record<string, string>
): Promise<TaskSummary> =>
  apiRequest(`/tasks/${taskId}/inputs`, token, {
    method: "PATCH",
    body: JSON.stringify({ values }),
  });

// ── Teams (UUM) ───────────────────────────────────────────────────────────────

export const getMyTeams = (token: string): Promise<TeamSummary[]> =>
  authApiRequest("/teams", token);

export const getTeam = (token: string, id: string): Promise<Team> =>
  authApiRequest(`/teams/${id}`, token);

export const listTeamRoles = (token: string, teamId: string): Promise<TeamRole[]> =>
  authApiRequest(`/teams/${teamId}/roles`, token);
