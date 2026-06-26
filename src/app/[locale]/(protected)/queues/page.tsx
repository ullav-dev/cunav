"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { listQueues, createQueue, updateQueue, deleteQueue } from "@/lib/cunav-api";
import { getTeamClaims } from "@/lib/auth-api";
import type { Queue } from "@/lib/types";
import ConfirmDialog from "@/components/ConfirmDialog";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

export default function QueuesPage() {
  const { token } = useAuth();
  const t = useTranslations("queues");

  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Queue | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const teamIds = Object.keys(getTeamClaims(token ?? null));

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      setQueues(await listQueues(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load queues");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

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

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-slate-200 bg-white px-6 py-4 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{t("title")}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{t("subtitle")}</p>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="shrink-0 inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"/></svg>
            {t("newQueue")}
          </button>
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
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {queues.map((queue) => (
              <div key={queue.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:border-violet-300 transition-colors group">
                <div className="flex items-start justify-between gap-2">
                  {renamingId === queue.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); handleRename(queue.id, renameDraft); }} className="flex-1">
                      <input autoFocus value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => handleRename(queue.id, renameDraft)}
                        className="w-full text-sm font-semibold border border-violet-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400" />
                    </form>
                  ) : (
                    <h3
                      className="font-semibold text-slate-800 leading-snug cursor-text hover:text-violet-700 transition-colors"
                      onClick={() => { setRenamingId(queue.id); setRenameDraft(queue.name); }}
                    >
                      {queue.name}
                    </h3>
                  )}
                  <button onClick={() => setConfirmDelete(queue)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-colors rounded shrink-0" title="Delete queue">
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-2">{formatDate(queue.created_at)}</p>
              </div>
            ))}
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
