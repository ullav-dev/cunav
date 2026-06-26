"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { listTickets, listQueues, updateTicket, filterCunavTickets } from "@/lib/cunav-api";
import type { Ticket, Queue, Status, TicketType, Priority } from "@/lib/types";
import PriorityBadge from "@/components/PriorityBadge";
import TicketTypeBadge from "@/components/TicketTypeBadge";

const TICKET_TYPES: TicketType[] = ["bug", "feature", "question", "improvement", "task"];
const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function TriagePage() {
  const { token } = useAuth();
  const t = useTranslations("triage");
  const tType = useTranslations("ticketType");
  const tPri = useTranslations("priority");
  const tStatus = useTranslations("status");

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [all, queues] = await Promise.all([
        listTickets(token),
        listQueues(token).catch(() => [] as Queue[]),
      ]);
      setTickets(filterCunavTickets(all, queues));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function patch(id: string, update: Parameters<typeof updateTicket>[2]) {
    if (!token) return;
    setSaving((s) => new Set(s).add(id));
    try {
      const updated = await updateTicket(token, id, update);
      setTickets((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  const filtered = tickets.filter((t) => {
    if (showResolved) return true;
    return t.status === "Not Started" || t.status === "Ready";
  });

  const newCount = tickets.filter((t) => t.status === "Not Started").length;
  const openCount = tickets.filter((t) => t.status === "Ready").length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{t("title")}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{t("subtitle")}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 text-sm text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                {newCount} {t("statusNew")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                {openCount} {t("statusOpen")}
              </span>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
                className="rounded border-slate-300 text-violet-600 focus:ring-violet-400"
              />
              {t("showResolved")}
            </label>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <p className="text-sm text-red-600">{error}</p>
              <button onClick={load} className="mt-2 text-sm text-violet-700 hover:underline">Retry</button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-slate-200 mb-3">
              <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
            </svg>
            <p className="text-slate-500 font-medium">{t("allClear")}</p>
            <p className="text-sm text-slate-400 mt-1">{t("allClearSubtitle")}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5 w-20">ID</th>
                <th className="text-left text-xs font-medium text-slate-500 px-2 py-2.5">Title</th>
                <th className="text-left text-xs font-medium text-slate-500 px-2 py-2.5 w-32">{t("colType")}</th>
                <th className="text-left text-xs font-medium text-slate-500 px-2 py-2.5 w-32">{t("colPriority")}</th>
                <th className="text-left text-xs font-medium text-slate-500 px-2 py-2.5 w-36">{t("colStatus")}</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5 w-24">{t("colAge")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ticket) => {
                const isSaving = saving.has(ticket.id);
                return (
                  <tr key={ticket.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors group">
                    <td className="px-4 py-3 text-xs font-mono text-slate-400 whitespace-nowrap">
                      {ticket.id.slice(0, 6)}
                    </td>
                    <td className="px-2 py-3 min-w-0">
                      <Link
                        href={`/tickets/${ticket.id}`}
                        className="text-sm font-medium text-slate-800 hover:text-violet-700 transition-colors line-clamp-2"
                      >
                        {ticket.name}
                      </Link>
                    </td>
                    <td className="px-2 py-3">
                      <select
                        value={ticket.ticket_type ?? ""}
                        onChange={(e) => patch(ticket.id, { ticket_type: (e.target.value as TicketType) || null })}
                        disabled={isSaving}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700 focus:border-violet-400 focus:outline-none cursor-pointer hover:border-slate-300 transition-colors disabled:opacity-50 w-full max-w-[120px]"
                      >
                        <option value="">— type —</option>
                        {TICKET_TYPES.map((v) => <option key={v} value={v}>{tType(v)}</option>)}
                      </select>
                      {ticket.ticket_type && (
                        <div className="mt-1"><TicketTypeBadge type={ticket.ticket_type} /></div>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <select
                        value={ticket.priority ?? ""}
                        onChange={(e) => patch(ticket.id, { priority: (e.target.value as Priority) || null })}
                        disabled={isSaving}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700 focus:border-violet-400 focus:outline-none cursor-pointer hover:border-slate-300 transition-colors disabled:opacity-50 w-full max-w-[110px]"
                      >
                        <option value="">— priority —</option>
                        {PRIORITIES.map((v) => <option key={v} value={v}>{tPri(v)}</option>)}
                      </select>
                      {ticket.priority && (
                        <div className="mt-1"><PriorityBadge priority={ticket.priority} /></div>
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <select
                        value={ticket.status}
                        onChange={(e) => patch(ticket.id, { status: e.target.value as Status })}
                        disabled={isSaving}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700 focus:border-violet-400 focus:outline-none cursor-pointer hover:border-slate-300 transition-colors disabled:opacity-50 w-full"
                      >
                        {(["Not Started", "Ready", "In Progress", "On Hold", "Complete", "Cancelled"] as Status[]).map((s) => (
                          <option key={s} value={s}>{tStatus(s)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {isSaving ? (
                        <span className="text-violet-400">Saving…</span>
                      ) : (
                        timeAgo(ticket.created_at)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
