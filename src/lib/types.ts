// ── Team types (ullav-user-management) ────────────────────────────────────────

export interface TeamUserRef {
  id: string;
  username: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

export interface TeamRole {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  user: TeamUserRef;
  status: "invited" | "active" | "inactive";
  role: "owner" | "leader" | "member";
  team_roles: TeamRole[];
  invited_at: string;
  joined_at: string | null;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  purpose: string | null;
  avatar_url: string | null;
  owner: TeamUserRef;
  leader: TeamUserRef;
  members: TeamMember[];
  created_at: string;
  updated_at: string;
}

export interface TeamSummary {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  owner: TeamUserRef;
  leader: TeamUserRef;
  member_count: number;
  created_at: string;
  updated_at: string;
}

// ── Shared AWE status types ───────────────────────────────────────────────────

export type Status = "Not Started" | "Ready" | "In Progress" | "On Hold" | "Complete" | "Cancelled";
export type ScheduleStatus = "N/A" | "On Time" | "At Risk" | "Late";

// ── Jobs ──────────────────────────────────────────────────────────────────────

export interface Job {
  id: string;
  name: string;
  status: Status;
  schedule_status: ScheduleStatus;
  team_id: string | null;
  project_id: string | null;
  job_type: "sprint" | "kanban" | "backlog" | "queue" | null;
  created_at: string;
  updated_at: string;
  archived: boolean;
  start_date: string | null;
  end_date: string | null;
  ai_enabled: boolean;
  ai_togra_project_id: string | null;
  ai_togra_job_id: string | null;
  ai_togra_template_id: string | null;
  ai_route_confidence_threshold: number;
}

// ── Workflows / Tickets ───────────────────────────────────────────────────────

export interface Workflow {
  id: string;
  name: string;
  is_template: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  description: string | null;
  status: Status;
  schedule_status: ScheduleStatus;
  job_id: string | null;
  team_id: string | null;
  is_shared: boolean;
  sort_order: number | null;
  story_points: number | null;
  togra_workflow_id: string | null;
  togra_project_id: string | null;
  ticket_number: number | null;
  ai_processed_at: string | null;
  ai_confidence: number | null;
  ai_should_route: boolean | null;
  ai_outcome_feedback: AiOutcomeFeedback | null;
  ai_outcome_feedback_by: string | null;
  ai_outcome_feedback_at: string | null;
  ai_outcome_feedback_reason: string | null;
  ai_outcome_feedback_note_id: string | null;
}

export type AiOutcomeFeedback = "helpful" | "unhelpful";

// ── Cunav-specific ticket extensions ─────────────────────────────────────────
// These fields are added to the workflows table by cunav's awe-server migration.
// Until the migration is applied, these fields will be null.

export type TicketType = "bug" | "feature" | "question" | "improvement" | "task";
export type Priority = "critical" | "high" | "medium" | "low";

export interface Ticket extends Workflow {
  ticket_type: TicketType | null;
  priority: Priority | null;
  reporter_id: string | null;
  resolved_at: string | null;
}

export interface Queue extends Job {
  job_type: "queue";
}

// ── Notes ─────────────────────────────────────────────────────────────────────

export type NoteEntityType = "task" | "workflow" | "job" | "project";

export interface NoteFolder {
  id: string;
  name: string;
  folder_type: string;
  entity_type: string | null;
  entity_id: string | null;
  created_by: string;
  created_at: string;
}

export interface Note {
  id: string;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string | null;
  is_shared: boolean;
  parent_id: string | null;
  folder_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Notes created by the AI triage service account (src/app/api/ai/triage/route.ts)
// have created_by set to that account's UUID, which isn't a member of any team
// the viewer has loaded — so it can't be resolved to a readable name the normal
// way. Recognize these notes by their fixed titles instead and label them
// directly rather than showing the raw UUID.
export const AI_ANALYSIS_NOTE_TITLE = "AI Analysis";
export const AI_AUTOROUTE_NOTE_TITLE = "Auto-routed to Togra";
export const AI_NOTE_TITLES: readonly string[] = [AI_ANALYSIS_NOTE_TITLE, AI_AUTOROUTE_NOTE_TITLE];
