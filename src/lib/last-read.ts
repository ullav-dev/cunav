// Ticket-level read tracking (used in ticket list)
const TICKET_KEY = "cunav_last_read";

function getTicketMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TICKET_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function markRead(ticketId: string): void {
  const map = getTicketMap();
  map[ticketId] = new Date().toISOString();
  localStorage.setItem(TICKET_KEY, JSON.stringify(map));
}

export function hasUnread(ticketId: string, updatedAt: string): boolean {
  const map = getTicketMap();
  const lastRead = map[ticketId];
  if (!lastRead) return true;
  return new Date(updatedAt) > new Date(lastRead);
}

// Note-level read tracking (used in NotesPanel)
const NOTE_KEY = "cunav_notes_read";

function getNoteSet(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTE_KEY) ?? "[]");
    return new Set<string>(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveNoteSet(set: Set<string>): void {
  localStorage.setItem(NOTE_KEY, JSON.stringify([...set]));
}

export function markNoteRead(noteId: string): void {
  const set = getNoteSet();
  set.add(noteId);
  saveNoteSet(set);
}

export function isNoteUnread(noteId: string): boolean {
  return !getNoteSet().has(noteId);
}

// AI-analysis read tracking (used in ticket list + ticket detail banner).
// Deliberately separate from the generic ticket-level tracking above — that
// gets cleared just by opening the ticket page (see load() in the ticket
// detail page), which would hide the "AI analysis ready" signal before the
// user has actually looked at it.
const AI_ANALYSIS_KEY = "cunav_ai_analysis_read";

function getAiAnalysisMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(AI_ANALYSIS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function markAiAnalysisRead(ticketId: string): void {
  const map = getAiAnalysisMap();
  map[ticketId] = new Date().toISOString();
  localStorage.setItem(AI_ANALYSIS_KEY, JSON.stringify(map));
}

export function hasUnreadAiAnalysis(ticketId: string, aiProcessedAt: string | null): boolean {
  if (!aiProcessedAt) return false;
  const lastRead = getAiAnalysisMap()[ticketId];
  if (!lastRead) return true;
  return new Date(aiProcessedAt) > new Date(lastRead);
}
