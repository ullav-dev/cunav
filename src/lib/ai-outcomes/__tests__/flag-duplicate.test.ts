import { flagDuplicate } from "../flag-duplicate";
import { listTickets } from "../../cunav-api";
import { tackNotesApi, resolveAiPrincipalId } from "../../tack-notes-server";
import type { Ticket, Queue } from "../../types";

jest.mock("../../cunav-api");
jest.mock("../../tack-notes-server", () => ({
  ...jest.requireActual("../../tack-notes-server"),
  tackNotesApi: jest.fn(),
  resolveAiPrincipalId: jest.fn(),
}));

const mockListTickets = listTickets as jest.Mock;
const mockTackNotesApi = tackNotesApi as jest.Mock;
const mockResolveAiPrincipalId = resolveAiPrincipalId as jest.Mock;
const mockCreateNote = jest.fn();

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
    team_id: "team-1",
    organization_id: null,
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
    duplicate_of_workflow_id: null,
    external_reporter_first_name: null,
    external_reporter_last_name: null,
    external_reporter_email: null,
    ...overrides,
  };
}

const emptyQueue = {} as Queue;

beforeEach(() => {
  jest.clearAllMocks();
  mockTackNotesApi.mockReturnValue({ createNote: mockCreateNote });
  mockResolveAiPrincipalId.mockResolvedValue(undefined);
});

describe("flagDuplicate.run", () => {
  it("does not execute when the ticket has no queue", async () => {
    const result = await flagDuplicate.run({
      token: "tok",
      ticket: makeTicket({ job_id: null }),
      queue: emptyQueue,
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
      queue: emptyQueue,
      confidence: 0.8,
    });
    expect(result).toEqual({ executed: false });
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  it("does not execute when no candidate clears the minimum overlap score, but still reports its real score", async () => {
    mockListTickets.mockResolvedValue([
      makeTicket(),
      makeTicket({ id: "ticket-2", name: "Completely unrelated request", description: "Please add dark mode" }),
    ]);
    const result = await flagDuplicate.run({
      token: "tok",
      ticket: makeTicket({ name: "Login button is broken", description: "Clicking login does nothing" }),
      queue: emptyQueue,
      confidence: 0.8,
    });
    // executed: false, but confidence is still the real overlap score (not
    // omitted/zeroed) — this outcome type never asks the LLM to guess, so its
    // own score, even a low one, is the only confidence there is to persist.
    expect(result.executed).toBe(false);
    expect(result.confidence).toBeLessThan(0.35);
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

    const result = await flagDuplicate.run({ token: "tok", ticket, queue: emptyQueue, confidence: 0.8 });

    expect(mockCreateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        team_id: "team-1",
        visibility: "team",
        title: "Possible duplicate flagged",
        attach: { owning_service: "awe", entity_type: "workflow", entity_id: ticket.id },
        // A markdown link, not just the ticket id as plain text — the note
        // renders through NoteMarkdown, so this becomes a real clickable
        // link straight to the matched ticket.
        body_markdown: expect.stringMatching(/\[#7 — "Login button broken on checkout page"\]\(.*\/tickets\/ticket-2\)/),
      })
    );
    expect(result.executed).toBe(true);
    expect(result.relatedWorkflowId).toBe("ticket-2");
    expect(result.noteId).toBe("note-1");
    expect(result.confidence).toBeGreaterThanOrEqual(0.35);
  });

  it("attributes the note to a resolved system principal when one exists", async () => {
    const match = makeTicket({
      id: "ticket-2",
      ticket_number: 7,
      name: "Login button broken on checkout page",
      description: "Clicking the login button does nothing on the checkout page",
    });
    mockListTickets.mockResolvedValue([makeTicket(), match]);
    mockCreateNote.mockResolvedValue({ id: "note-1" });
    mockResolveAiPrincipalId.mockResolvedValue("principal-1");

    await flagDuplicate.run({
      token: "tok",
      ticket: makeTicket({ name: "Login button is broken", description: "Clicking the login button does nothing" }),
      queue: emptyQueue,
      confidence: 0.8,
    });

    expect(mockCreateNote).toHaveBeenCalledWith(expect.objectContaining({ created_by: "principal-1" }));
  });

  it("skips the note (but still reports the match) when the ticket has no team_id at all", async () => {
    const match = makeTicket({
      id: "ticket-2",
      ticket_number: 7,
      name: "Login button broken on checkout page",
      description: "Clicking the login button does nothing on the checkout page",
    });
    mockListTickets.mockResolvedValue([makeTicket({ team_id: null }), match]);

    const result = await flagDuplicate.run({
      token: "tok",
      ticket: makeTicket({ team_id: null, name: "Login button is broken", description: "Clicking the login button does nothing" }),
      queue: emptyQueue,
      confidence: 0.8,
    });

    expect(mockCreateNote).not.toHaveBeenCalled();
    expect(result.executed).toBe(true);
    expect(result.noteId).toBeUndefined();
  });

  it("searches organization-wide when the ticket has an organization_id, not just its own queue", async () => {
    mockListTickets.mockResolvedValue([makeTicket({ id: "ticket-2" })]);
    await flagDuplicate.run({
      token: "tok",
      ticket: makeTicket({ organization_id: "org-1" }),
      queue: emptyQueue,
      confidence: 0.8,
    });
    expect(mockListTickets).toHaveBeenCalledWith("tok", { organization_id: "org-1" });
  });
});
