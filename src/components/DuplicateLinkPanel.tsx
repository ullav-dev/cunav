"use client";

import { useEffect, useState } from "react";
import {
  getTicket,
  listTickets,
  listTicketOutcomes,
  setTicketDuplicateOf,
  clearTicketDuplicateOf,
  listTicketDuplicates,
} from "@/lib/cunav-api";
import { ticketId as formatTicketId } from "@/lib/ticket-id";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/AuthContext";
import type { Ticket } from "@/lib/types";

// Matches flag-duplicate.ts's FLAG_DUPLICATE_TYPE — not imported from there,
// same reasoning as AiQueueSettingsModal's own ROUTE_TO_TOGRA_TYPE literal:
// that module may pull in server-only dependencies this client component
// shouldn't bundle.
const FLAG_DUPLICATE_TYPE = "flag_duplicate";

interface Props {
  ticket: Ticket;
  onTicketUpdated: (ticket: Ticket) => void;
}

/** Confirmed duplicate-of link (workflows.duplicate_of_workflow_id) plus the
 *  AI's own unconfirmed suggestion (an ai_ticket_outcomes row) — flag_duplicate
 *  never sets the link itself (see its own doc comment), so this is the only
 *  place that turns a suggestion into a real link, or lets an agent pick one
 *  by hand. */
export default function DuplicateLinkPanel({ ticket, onTicketUpdated }: Props) {
  const { token } = useAuth();
  const [duplicateOfTicket, setDuplicateOfTicket] = useState<Ticket | null>(null);
  const [duplicates, setDuplicates] = useState<Ticket[]>([]);
  const [aiSuggestion, setAiSuggestion] = useState<{ ticketId: string; label: string } | null>(null);
  const [dismissedSuggestion, setDismissedSuggestion] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<Ticket[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setDismissedSuggestion(false);
    if (ticket.duplicate_of_workflow_id) {
      getTicket(token, ticket.duplicate_of_workflow_id).then(setDuplicateOfTicket).catch(() => setDuplicateOfTicket(null));
    } else {
      setDuplicateOfTicket(null);
    }
    listTicketDuplicates(token, ticket.id).then(setDuplicates).catch(() => setDuplicates([]));

    // Only worth asking for outcomes (and only worth showing a banner) when
    // no confirmed link exists yet — once one does, the AI's original
    // suggestion is no longer actionable either way.
    if (!ticket.duplicate_of_workflow_id) {
      listTicketOutcomes(token, ticket.id)
        .then((outcomes) => {
          const match = outcomes.find((o) => o.outcome_type === FLAG_DUPLICATE_TYPE && o.executed && o.related_workflow_id);
          setAiSuggestion(match ? { ticketId: match.related_workflow_id!, label: match.detail ?? "a possible duplicate" } : null);
        })
        .catch(() => setAiSuggestion(null));
    } else {
      setAiSuggestion(null);
    }
  }, [token, ticket.id, ticket.duplicate_of_workflow_id]);

  useEffect(() => {
    if (!token || !picking || !ticket.job_id) { setPickerResults([]); return; }
    let cancelled = false;
    listTickets(token, { job_id: ticket.job_id })
      .then((tickets) => {
        if (cancelled) return;
        const q = pickerQuery.trim().toLowerCase();
        setPickerResults(
          tickets
            .filter((t) => t.id !== ticket.id)
            .filter((t) => !q || t.name.toLowerCase().includes(q))
            .slice(0, 20)
        );
      })
      .catch(() => { if (!cancelled) setPickerResults([]); });
    return () => { cancelled = true; };
  }, [picking, pickerQuery, ticket.job_id, ticket.id, token]);

  async function confirmDuplicateOf(targetId: string) {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const updated = await setTicketDuplicateOf(token, ticket.id, targetId);
      onTicketUpdated(updated);
      setPicking(false);
      setPickerQuery("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link duplicate");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlink() {
    if (!token) return;
    setBusy(true); setError(null);
    try {
      const updated = await clearTicketDuplicateOf(token, ticket.id);
      onTicketUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlink duplicate");
    } finally {
      setBusy(false);
    }
  }

  const showAiBanner = aiSuggestion && !dismissedSuggestion && !ticket.duplicate_of_workflow_id;

  return (
    <div className="space-y-2">
      {showAiBanner && (
        <div className="flex items-center justify-between gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 text-xs">
          <span className="text-violet-800">🤖 AI flagged this as {aiSuggestion.label}.</span>
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => confirmDuplicateOf(aiSuggestion.ticketId)}
              className="px-2 py-1 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setDismissedSuggestion(true)}
              className="px-2 py-1 rounded text-violet-700 hover:bg-violet-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {ticket.duplicate_of_workflow_id && (
        <div className="flex items-center justify-between gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
          <span className="text-amber-800">
            Duplicate of{" "}
            <Link href={`/tickets/${ticket.duplicate_of_workflow_id}`} className="font-medium underline hover:no-underline">
              {duplicateOfTicket ? `${formatTicketId(duplicateOfTicket.ticket_number)} — ${duplicateOfTicket.name}` : "…"}
            </Link>
          </span>
          <button type="button" disabled={busy} onClick={handleUnlink} className="px-2 py-1 rounded text-amber-700 hover:bg-amber-100 disabled:opacity-50 shrink-0">
            Unlink
          </button>
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs">
          <div className="text-slate-500 font-medium mb-1">{duplicates.length} ticket{duplicates.length === 1 ? "" : "s"} marked as duplicates of this one:</div>
          <ul className="space-y-0.5">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/tickets/${d.id}`} className="text-slate-700 hover:text-violet-700 hover:underline">
                  {formatTicketId(d.ticket_number)} — {d.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!ticket.duplicate_of_workflow_id && (
        <div>
          {!picking ? (
            <button type="button" onClick={() => setPicking(true)} className="text-xs text-slate-500 hover:text-violet-700 hover:underline">
              Mark as duplicate of…
            </button>
          ) : (
            <div className="border border-slate-200 rounded-lg p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search tickets in this queue…"
                  className="flex-1 text-xs rounded border border-slate-300 px-2 py-1 focus:border-violet-400 focus:outline-none"
                />
                <button type="button" onClick={() => { setPicking(false); setPickerQuery(""); }} className="text-xs text-slate-400 hover:text-slate-600">
                  Cancel
                </button>
              </div>
              <ul className="max-h-40 overflow-y-auto divide-y divide-slate-100">
                {pickerResults.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => confirmDuplicateOf(t.id)}
                      className="w-full text-left text-xs px-1.5 py-1 hover:bg-violet-50 rounded disabled:opacity-50"
                    >
                      {formatTicketId(t.ticket_number)} — {t.name}
                    </button>
                  </li>
                ))}
                {pickerResults.length === 0 && (
                  <li className="text-xs text-slate-400 px-1.5 py-1">No matching tickets</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
