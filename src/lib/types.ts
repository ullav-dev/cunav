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
  /** Generic per-outcome-type enable/threshold config, one entry per registered
   *  AI outcome type (see src/lib/ai-outcomes/). route_to_togra's destination
   *  config stays in the ai_togra_* columns above — this only carries
   *  enabled/threshold (plus any non-relational per-type settings). */
  ai_rules: AiOutcomeRuleConfig[];
  /** SMTP connection attached to the automated email task cunav creates when an
   *  agent sends a ticket note as email from this queue. */
  email_connection_id: string | null;
}

export interface Connection {
  id: string;
  name: string;
  description: string | null;
  connection_type: "bearer_token" | "oauth2_client_credentials" | "api_key_header" | "basic_auth" | "smtp" | "imap";
  team_id: string;
  has_secret: boolean;
}

export interface AiOutcomeRuleConfig {
  type: string;
  enabled: boolean;
  confidence_threshold: number;
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

// ── AI ticket outcomes (one row per proposed outcome per ticket) ─────────────
// Generalizes the ai_confidence/ai_should_route pair above, which only fit a
// single outcome type, into one row per outcome type the triage webhook
// proposed for a ticket — see src/lib/ai-outcomes/.

export interface AiTicketOutcome {
  id: string;
  workflow_id: string;
  outcome_type: string;
  confidence: number;
  executed: boolean;
  execution_error: string | null;
  related_workflow_id: string | null;
  detail: string | null;
  note_id: string | null;
  feedback: AiOutcomeFeedback | null;
  feedback_by: string | null;
  feedback_at: string | null;
  feedback_reason: string | null;
  created_at: string;
}

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
  // Set when the reporter is someone with no UUM user row (e.g. a customer
  // emailing in), as distinct from reporter_id. Independent of it — a ticket
  // may have either, both, or neither.
  external_reporter_first_name: string | null;
  external_reporter_last_name: string | null;
  external_reporter_email: string | null;
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
export const AI_DUPLICATE_NOTE_TITLE = "Possible duplicate flagged";
export const AI_NOTE_TITLES: readonly string[] = [
  AI_ANALYSIS_NOTE_TITLE,
  AI_AUTOROUTE_NOTE_TITLE,
  AI_DUPLICATE_NOTE_TITLE,
];

/** Fixed title for notes posted by the inbound-email webhook (src/app/api/email/inbound/route.ts)
 *  from a reporter's reply — not an AI-authored note, so deliberately not in AI_NOTE_TITLES. */
export const INBOUND_EMAIL_NOTE_TITLE = "Reply from reporter";
