"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { listQueues, createQueue, updateQueue, deleteQueue, listTickets, filterCunavTickets } from "@/lib/cunav-api";
import { getAweTeamIds } from "@/lib/auth-api";
import type { Queue, Ticket } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

interface CreateQueueModalProps {
  teamIds: string[];
  token: string;
  onClose: () => void;
  onCreated: (q: Queue) => void;
}

function CreateQueueModal({ teamIds, token, onClose, onCreated }: CreateQueueModalProps) {
  const t = useTranslations("queues");
  const tm = useTranslations("queues.modal");
  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState(teamIds[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      const queue = await createQueue(token, { name: name.trim(), team_id: teamId || undefined });
      onCreated(queue);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : tm("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">{tm("title")}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{tm("nameLabel")}</label>
            <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={tm("namePlaceholder")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400" />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">{tm("cancel")}</button>
            <button type="submit" disabled={saving || !name.trim()}
              className="px-4 py-2 text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg transition-colors">
              {saving ? tm("creating") : tm("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type ViewMode = "cards" | "list";

export default function QueuesPage() {
  const { token } = useAuth();
  const t = useTranslations("queues");
  const router = useRouter();

  const [queues, setQueues] = useState<Queue[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Queue | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  const teamIds = getAweTeamIds(token ?? null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [queuesData, ticketsData] = await Promise.all([
        listQueues(token),
        listTickets(token).catch(() => [] as Ticket[]),
      ]);
      setQueues(queuesData);
      setTickets(filterCunavTickets(ticketsData, queuesData));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load queues");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Per-queue derived stats
  function queueStats(queue: Queue): { count: number; lastTicketAt: string | null } {
    const qTickets = tickets.filter((t) => t.job_id === queue.id);
    if (qTickets.length === 0) return { count: 0, lastTicketAt: null };
    const sorted = [...qTickets].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return { count: qTickets.length, lastTicketAt: sorted[0].created_at };
  }

  async function handleRename(id: string, name: string) {
    if (!token || !name.trim()) { setRenamingId(null); return; }
    try {
      const updated = await updateQueue(token, id, { name: name.trim() });
      setQueues((prev) => prev.map((q) => q.id === updated.id ? updated : q));
    } finally {
      setRenamingId(null);
    }
  }

  async function handleDelete(queue: Queue) {
    if (!token) return;
    try {
      await deleteQueue(token, queue.id);
      setQueues((prev) => prev.filter((q) => q.id !== queue.id));
    } catch { /* ignore */ }
  }

  function openQueue(id: string) {
    router.push(`/tickets?queue=${id}`);
  }

  const QueueName = ({ queue }: { queue: Queue }) => (
    renamingId === queue.id ? (
      <form onSubmit={(e) => { e.preventDefault(); handleRename(queue.id, renameDraft); }}
        onClick={(e) => e.stopPropagation()}>
        <input autoFocus value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
          onBlur={() => handleRename(queue.id, renameDraft)}
          className="text-sm font-semibold border border-violet-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-400 w-full" />
      </form>
    ) : (
      <span
        className="font-semibold text-slate-800 cursor-text hover:text-violet-700 transition-colors"
        onClick={(e) => { e.stopPropagation(); setRenamingId(queue.id); setRenameDraft(queue.name); }}
        title="Click to rename"
      >
        {queue.name}
      </span>
    )
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-slate-200 bg-white px-6 py-4 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{t("title")}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{t("subtitle")}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Card / list toggle */}
            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode("cards")}
                title="Card view"
                className={`px-2.5 py-1.5 transition-colors ${viewMode === "cards" ? "bg-violet-100 text-violet-700" : "text-slate-400 hover:bg-slate-50"}`}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5Zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5Zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5Zm8 0A1.5 1.5 0 0 1 10.5 9h3A1.5 1.5 0 0 1 15 10.5v3A1.5 1.5 0 0 1 13.5 15h-3A1.5 1.5 0 0 1 9 13.5Z"/>
                </svg>
              </button>
              <button
                onClick={() => setViewMode("list")}
                title="List view"
                className={`px-2.5 py-1.5 transition-colors ${viewMode === "list" ? "bg-violet-100 text-violet-700" : "text-slate-400 hover:bg-slate-50"}`}
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M2 4h12v1.5H2Zm0 3.5h12V9H2Zm0 3.5h12V13H2Z" stroke="currentColor" strokeWidth="0.5"/>
                  <path d="M1.5 3.5h13a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z" fill="none" stroke="currentColor" strokeWidth="1"/>
                  <path d="M2 6.5h12M2 9.5h12" stroke="currentColor" strokeWidth="1"/>
                </svg>
              </button>
            </div>
            <button onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"/></svg>
              {t("newQueue")}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={load} className="mt-2 text-sm text-violet-700 hover:underline">Retry</button>
          </div>
        ) : queues.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-6 h-6 text-slate-400">
                <path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v2.5A1.75 1.75 0 0 1 14.25 6H1.75A1.75 1.75 0 0 1 0 4.25Zm1.75-.25a.25.25 0 0 0-.25.25v2.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-2.5a.25.25 0 0 0-.25-.25ZM0 9.75C0 8.784.784 8 1.75 8h12.5c.966 0 1.75.784 1.75 1.75v2.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25Zm1.75-.25a.25.25 0 0 0-.25.25v2.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-2.5a.25.25 0 0 0-.25-.25Z"/>
              </svg>
            </div>
            <p className="text-slate-500 font-medium">{t("empty")}</p>
            <p className="text-slate-400 text-sm mt-1">{t("emptySubtitle")}</p>
            <button onClick={() => setShowCreate(true)} className="mt-4 text-sm font-medium text-violet-700 hover:text-violet-800 transition-colors">
              {t("createQueue")}
            </button>
          </div>
        ) : viewMode === "cards" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {queues.map((queue) => {
              const { count, lastTicketAt } = queueStats(queue);
              return (
                <div
                  key={queue.id}
                  onClick={() => openQueue(queue.id)}
                  className="bg-white rounded-xl border border-slate-200 p-4 hover:border-violet-400 hover:shadow-sm transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <QueueName queue={queue} />
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(queue); }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-colors rounded shrink-0"
                      title="Delete queue"
                    >
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>
                    </button>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-2xl font-bold text-slate-800">{count}</span>
                      <span className="text-xs text-slate-400 leading-tight">ticket{count !== 1 ? "s" : ""}</span>
                    </div>
                    <p className="text-xs text-slate-400 text-right">
                      {lastTicketAt ? `Last: ${formatDateTime(lastTicketAt)}` : `Created ${formatDate(queue.created_at)}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List view */
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500">Queue</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 w-24">Tickets</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 w-48">Last ticket</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 w-36">Created</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {queues.map((queue) => {
                  const { count, lastTicketAt } = queueStats(queue);
                  return (
                    <tr
                      key={queue.id}
                      onClick={() => openQueue(queue.id)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer group"
                    >
                      <td className="px-4 py-3">
                        <QueueName queue={queue} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-semibold text-slate-700">{count}</span>
                        <span className="text-xs text-slate-400 ml-1">ticket{count !== 1 ? "s" : ""}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {lastTicketAt ? formatDateTime(lastTicketAt) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">{formatDate(queue.created_at)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDelete(queue); }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-colors rounded"
                          title="Delete queue"
                        >
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateQueueModal
          teamIds={teamIds}
          token={token!}
          onClose={() => setShowCreate(false)}
          onCreated={(queue) => setQueues((prev) => [queue, ...prev])}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t("deleteConfirmTitle", { name: confirmDelete.name })}
          message={t("deleteConfirmMessage")}
          confirmLabel={t("deleteConfirmLabel")}
          onConfirm={() => { const q = confirmDelete; setConfirmDelete(null); handleDelete(q); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
