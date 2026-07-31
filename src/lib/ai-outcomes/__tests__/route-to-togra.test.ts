import { routeToTogra } from "../route-to-togra";
import { createWorkflow, createWorkflowFromTemplate, updateWorkflow } from "../../awe-api";
import { updateTicket } from "../../cunav-api";
import { createNote } from "../../notes-api";
import type { Ticket, Queue } from "../../types";

jest.mock("../../awe-api");
jest.mock("../../cunav-api");
jest.mock("../../notes-api");

const mockCreateWorkflow = createWorkflow as jest.Mock;
const mockCreateWorkflowFromTemplate = createWorkflowFromTemplate as jest.Mock;
const mockUpdateWorkflow = updateWorkflow as jest.Mock;
const mockUpdateTicket = updateTicket as jest.Mock;
const mockCreateNote = createNote as jest.Mock;

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: "ticket-1",
    name: "Test ticket",
    is_template: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: null,
    description: "Something is broken",
    status: "Not Started",
    schedule_status: "N/A",
    job_id: null,
    team_id: null,
    is_shared: true,
    sort_order: null,
    story_points: null,
    togra_workflow_id: null,
    togra_project_id: null,
    ticket_number: 42,
    ticket_type: "bug",
    priority: "high",
    reporter_id: null,
    resolved_at: null,
    ai_processed_at: null,
    ai_confidence: null,
    ai_should_route: null,
    ai_outcome_feedback: null,
    ai_outcome_feedback_by: null,
    ai_outcome_feedback_at: null,
    ai_outcome_feedback_reason: null,
    ai_outcome_feedback_note_id: null,
    external_reporter_first_name: null,
    external_reporter_last_name: null,
    external_reporter_email: null,
    ...overrides,
  };
}

function makeQueue(overrides: Partial<Queue> = {}): Queue {
  return {
    id: "queue-1",
    name: "Queue",
    status: "Not Started",
    schedule_status: "N/A",
    team_id: null,
    project_id: null,
    job_type: "queue",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    archived: false,
    start_date: null,
    end_date: null,
    ai_enabled: true,
    ai_togra_project_id: null,
    ai_togra_job_id: null,
    ai_togra_template_id: null,
    ai_route_confidence_threshold: 0.7,
    ai_rules: [],
    email_connection_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("routeToTogra.run", () => {
  it("does not execute when the queue has no Togra project configured", async () => {
    const result = await routeToTogra.run({
      token: "tok",
      ticket: makeTicket(),
      queue: makeQueue({ ai_togra_project_id: null, ai_togra_job_id: "job-1" }),
      confidence: 0.9,
    });
    expect(result).toEqual({ executed: false });
    expect(mockCreateWorkflow).not.toHaveBeenCalled();
  });

  it("does not execute when the queue has no Togra job configured", async () => {
    const result = await routeToTogra.run({
      token: "tok",
      ticket: makeTicket(),
      queue: makeQueue({ ai_togra_project_id: "proj-1", ai_togra_job_id: null }),
      confidence: 0.9,
    });
    expect(result).toEqual({ executed: false });
    expect(mockCreateWorkflow).not.toHaveBeenCalled();
  });

  it("creates a plain workflow, back-links the ticket, and posts a note when no template is configured", async () => {
    mockCreateWorkflow.mockResolvedValue({ id: "story-1" });
    mockUpdateWorkflow.mockResolvedValue({ id: "story-1" });
    mockUpdateTicket.mockResolvedValue(makeTicket());
    mockCreateNote.mockResolvedValue({ id: "note-1" });

    const queue = makeQueue({ ai_togra_project_id: "proj-1", ai_togra_job_id: "job-1", ai_togra_template_id: null });
    const ticket = makeTicket();

    const result = await routeToTogra.run({ token: "tok", ticket, queue, confidence: 0.85 });

    expect(mockCreateWorkflowFromTemplate).not.toHaveBeenCalled();
    expect(mockCreateWorkflow).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({ name: ticket.name, job_id: "job-1", is_shared: true })
    );
    // ticket_type/priority must NOT be sent on the initial create (see comment in route-to-togra.ts)
    expect(mockCreateWorkflow.mock.calls[0][1]).not.toHaveProperty("ticket_type");
    expect(mockUpdateWorkflow).toHaveBeenCalledWith(
      "tok",
      "story-1",
      expect.objectContaining({ ticket_type: "bug", priority: "high" })
    );
    expect(mockUpdateTicket).toHaveBeenCalledWith(
      "tok",
      ticket.id,
      expect.objectContaining({ togra_workflow_id: "story-1", togra_project_id: "proj-1", status: "In Progress" })
    );
    expect(mockCreateNote).toHaveBeenCalled();
    expect(result).toEqual({ executed: true, relatedWorkflowId: "story-1", noteId: "note-1" });
  });

  it("creates from a template when the queue has one configured", async () => {
    mockCreateWorkflowFromTemplate.mockResolvedValue({ id: "story-2" });
    mockUpdateWorkflow.mockResolvedValue({ id: "story-2" });
    mockUpdateTicket.mockResolvedValue(makeTicket());
    mockCreateNote.mockResolvedValue({ id: "note-2" });

    const queue = makeQueue({ ai_togra_project_id: "proj-1", ai_togra_job_id: "job-1", ai_togra_template_id: "tmpl-1" });
    const ticket = makeTicket();

    const result = await routeToTogra.run({ token: "tok", ticket, queue, confidence: 0.85 });

    expect(mockCreateWorkflow).not.toHaveBeenCalled();
    expect(mockCreateWorkflowFromTemplate).toHaveBeenCalledWith("tok", "job-1", "tmpl-1");
    expect(mockUpdateWorkflow).toHaveBeenCalledWith(
      "tok",
      "story-2",
      expect.objectContaining({ name: ticket.name, ticket_type: "bug", priority: "high" })
    );
    expect(result).toEqual({ executed: true, relatedWorkflowId: "story-2", noteId: "note-2" });
  });
});
