import { flagDuplicate } from "../flag-duplicate";
import { listTickets } from "../../cunav-api";
import { createNote } from "../../notes-api";
import type { Ticket } from "../../types";

jest.mock("../../cunav-api");
jest.mock("../../notes-api");

const mockListTickets = listTickets as jest.Mock;
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
    job_id: "job-1",
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe("flagDuplicate.run", () => {
  it("does not execute when the ticket has no queue", async () => {
    const result = await flagDuplicate.run({
      token: "tok",
      ticket: makeTicket({ job_id: null }),
      queue: {} as never,
      confidence: 0.8,
    });
    expect(result).toEqual({ executed: false });
    expect(mockListTickets).not.toHaveBeenCalled();
  });

  it("does not execute when there are no other tickets in the queue", async () => {
    mockListTickets.mockResolvedValue([makeTicket()]);
    const result = await flagDuplicate.run({
      token: "tok",
      ticket: makeTicket(),
      queue: {} as never,
      confidence: 0.8,
    });
    expect(result).toEqual({ executed: false });
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  it("does not execute when no candidate clears the minimum overlap score", async () => {
    mockListTickets.mockResolvedValue([
      makeTicket(),
      makeTicket({ id: "ticket-2", name: "Completely unrelated request", description: "Please add dark mode" }),
    ]);
    const result = await flagDuplicate.run({
      token: "tok",
      ticket: makeTicket({ name: "Login button is broken", description: "Clicking login does nothing" }),
      queue: {} as never,
      confidence: 0.8,
    });
    expect(result).toEqual({ executed: false });
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  it("flags the best-overlapping ticket and posts a note without mutating the ticket", async () => {
    const match = makeTicket({
      id: "ticket-2",
      ticket_number: 7,
      name: "Login button broken on checkout page",
      description: "Clicking the login button does nothing on the checkout page",
    });
    mockListTickets.mockResolvedValue([
      makeTicket(),
      match,
      makeTicket({ id: "ticket-3", name: "Add dark mode", description: "Please add a dark theme option" }),
    ]);
    mockCreateNote.mockResolvedValue({ id: "note-1" });

    const ticket = makeTicket({
      name: "Login button is broken",
      description: "Clicking the login button does nothing",
    });

    const result = await flagDuplicate.run({ token: "tok", ticket, queue: {} as never, confidence: 0.8 });

    expect(mockCreateNote).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({
        entity_type: "workflow",
        entity_id: ticket.id,
        title: "Possible duplicate flagged",
        body: expect.stringContaining("#7"),
      })
    );
    expect(result.executed).toBe(true);
    expect(result.relatedWorkflowId).toBe("ticket-2");
    expect(result.noteId).toBe("note-1");
  });
});
