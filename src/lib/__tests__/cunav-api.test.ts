import { filterCunavTickets } from "../cunav-api";
import type { Ticket, Queue } from "../types";

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-1",
    name: "Test ticket",
    is_template: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    description: null,
    status: "Not Started",
    schedule_status: "N/A",
    job_id: null,
    team_id: null,
    organization_id: null,
    is_shared: true,
    sort_order: null,
    story_points: null,
    togra_workflow_id: null,
    togra_project_id: null,
    ticket_number: null,
    ticket_type: null,
    priority: null,
    reporter_id: null,
    resolved_at: null,
    external_reporter_first_name: null,
    external_reporter_last_name: null,
    external_reporter_email: null,
    ai_processed_at: null,
    ai_confidence: null,
    ai_should_route: null,
    ai_outcome_feedback: null,
    ai_outcome_feedback_by: null,
    ai_outcome_feedback_at: null,
    ai_outcome_feedback_reason: null,
    ai_outcome_feedback_note_id: null,
    duplicate_of_workflow_id: null,
    ...overrides,
  };
}

function makeQueue(id: string, name = "Queue"): Queue {
  return {
    id,
    name,
    status: "Not Started",
    schedule_status: "N/A",
    team_id: null,
    organization_id: null,
    project_id: null,
    job_type: "queue",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    archived: false,
    start_date: null,
    end_date: null,
    ai_enabled: false,
    ai_togra_project_id: null,
    ai_togra_job_id: null,
    ai_togra_template_id: null,
    ai_route_confidence_threshold: 0.7,
    ai_rules: [],
    email_connection_id: null,
    inbound_email_connection_id: null,
  };
}

describe("filterCunavTickets", () => {
  it("keeps tickets that have a ticket_type set", () => {
    const tickets = [
      makeTicket({ id: "t1", ticket_type: "bug" }),
      makeTicket({ id: "t2", ticket_type: null }),
    ];
    const result = filterCunavTickets(tickets, []);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("keeps tickets whose job_id belongs to a cunav queue", () => {
    const queue = makeQueue("queue-1");
    const tickets = [
      makeTicket({ id: "t1", job_id: "queue-1" }),
      makeTicket({ id: "t2", job_id: "other-job" }),
      makeTicket({ id: "t3", job_id: null }),
    ];
    const result = filterCunavTickets(tickets, [queue]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("t1");
  });

  it("keeps tickets matching either condition", () => {
    const queue = makeQueue("queue-1");
    const tickets = [
      makeTicket({ id: "t1", ticket_type: "feature", job_id: null }),
      makeTicket({ id: "t2", ticket_type: null, job_id: "queue-1" }),
      makeTicket({ id: "t3", ticket_type: "bug", job_id: "queue-1" }),
      makeTicket({ id: "t4", ticket_type: null, job_id: null }),
    ];
    const result = filterCunavTickets(tickets, [queue]);
    expect(result.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("returns empty array when no tickets match", () => {
    const tickets = [makeTicket({ ticket_type: null, job_id: null })];
    expect(filterCunavTickets(tickets, [])).toHaveLength(0);
  });

  it("handles empty inputs", () => {
    expect(filterCunavTickets([], [])).toEqual([]);
  });
});
