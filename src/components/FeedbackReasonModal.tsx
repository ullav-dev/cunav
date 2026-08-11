"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { Ticket } from "@/lib/types";
import { AI_ANALYSIS_NOTE_TITLE } from "@/lib/types";
import { createTackNotesApi } from "@ullav-dev/tack-notes";
import { updateTicket } from "@/lib/cunav-api";

// Matches NotesPanel.tsx's OWNING_SERVICE — every ticket note lives under
// this scope in tack-server.
const OWNING_SERVICE = "awe";

interface Props {
  ticket: Ticket;
  feedback: "helpful" | "unhelpful";
  onClose: () => void;
  onSubmitted: (updated: Ticket) => void;
}

export default function FeedbackReasonModal({ ticket, feedback, onClose, onSubmitted }: Props) {
  const { token } = useAuth();

  const [noteId, setNoteId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tackApi = useMemo(() => (token ? createTackNotesApi("/api/tack", token) : null), [token]);

  // Find the AI Analysis note this feedback judges, so it can be linked for reference.
  useEffect(() => {
    if (!tackApi) return;
    tackApi
      .listNotesByAttachment(OWNING_SERVICE, "workflow", ticket.id)
      .then((notes) => {
        const aiNotes = notes
          .filter((n) => n.title === AI_ANALYSIS_NOTE_TITLE)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setNoteId(aiNotes[0]?.id ?? null);
      })
      .catch(() => setNoteId(null));
  }, [tackApi, ticket.id]);

  async function handleSubmit() {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await updateTicket(token, ticket.id, {
        ai_outcome_feedback: feedback,
        ai_outcome_feedback_reason: reason.trim() || undefined,
        ai_outcome_feedback_note_id: noteId ?? undefined,
      });
      onSubmitted(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save feedback");
    } finally {
      setSubmitting(false);
    }
  }

  const label = feedback === "helpful" ? "helpful" : "unhelpful";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {feedback === "helpful" ? "👍 Mark as helpful" : "👎 Mark as unhelpful"}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-xs">{ticket.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-3">
          <label className="block text-xs font-medium text-slate-600">
            What made this analysis {label}? <span className="font-normal text-slate-400">(optional, but helps improve future AI triage)</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            autoFocus
            placeholder="e.g. wrong ticket type, missed the priority, good root-cause analysis…"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="text-sm text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 px-4 py-2 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {submitting ? "Saving…" : "Submit feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}
