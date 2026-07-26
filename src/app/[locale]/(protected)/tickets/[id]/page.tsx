"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { resolveUsers, type ResolvedUser } from "@/lib/auth-api";
import { getTicket, updateTicket, deleteTicket } from "@/lib/cunav-api";
import { ticketId } from "@/lib/ticket-id";
import { markRead, hasUnreadAiAnalysis, markAiAnalysisRead } from "@/lib/last-read";
import { listQueues } from "@/lib/cunav-api";
import { createNote } from "@/lib/notes-api";
import { useRouter } from "@/i18n/navigation";
import type { Ticket, Queue, Status, TicketType, Priority } from "@/lib/types";
import StatusPill from "@/components/StatusPill";
import PriorityBadge from "@/components/PriorityBadge";
import TicketTypeBadge from "@/components/TicketTypeBadge";
import ConfirmDialog from "@/components/ConfirmDialog";
import MarkdownEditor from "@/components/MarkdownEditor";
import NotesPanel from "@/components/notes/NotesPanel";
import WikipediaExplorer from "@/components/WikipediaExplorer";
import AiChatExplorer from "@/components/AiChatExplorer";
import SendToTograModal from "@/components/SendToTograModal";
import FeedbackReasonModal from "@/components/FeedbackReasonModal";
import { useAppUrls } from "@/contexts/AppUrlsContext";
import { useResize } from "@/hooks/useResize";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const STATUSES: Status[] = ["Not Started", "Ready", "In Progress", "On Hold", "Complete", "Cancelled"];
const TICKET_TYPES: TicketType[] = ["bug", "feature", "question", "improvement", "task"];
const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type MainTab = "details" | "triage";
type ExplorerTab = "notes" | "ai" | "wikipedia";

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, user } = useAuth();
  const router = useRouter();
  const t = useTranslations("ticket");
  const tStatus = useTranslations("status");
  const tType = useTranslations("ticketType");
  const tPri = useTranslations("priority");

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [resolvedReporter, setResolvedReporter] = useState<ResolvedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [editingReporter, setEditingReporter] = useState(false);
  const [reporterFirstDraft, setReporterFirstDraft] = useState("");
  const [reporterLastDraft, setReporterLastDraft] = useState("");
  const [reporterEmailDraft, setReporterEmailDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("details");
  const [explorerTab, setExplorerTab] = useState<ExplorerTab>("notes");
  const [showSendToTogra, setShowSendToTogra] = useState(false);
  const [feedbackDialog, setFeedbackDialog] = useState<"helpful" | "unhelpful" | null>(null);
  const [aiBannerDismissed, setAiBannerDismissed] = useState(false);
  const { tograUrl } = useAppUrls();
  const titleRef = useRef<HTMLInputElement>(null);
  const rightResize = useResize({ initial: 480, min: 320, max: Infinity, axis: "x", reverse: true });

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true); setError(null);
    try {
      const [ticketData, queuesData] = await Promise.all([
        getTicket(token, id),
        listQueues(token).catch(() => [] as Queue[]),
      ]);
      setTicket(ticketData);
      setQueues(queuesData);
      markRead(ticketData.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ticket");
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  // Resolve reporter_id (may be a real user or a service account, e.g. the
  // MCP server) to a display name — but only when there's no external
  // reporter recorded, since that already carries a human-readable name.
  useEffect(() => {
    const hasExternalReporter =
      ticket?.external_reporter_first_name || ticket?.external_reporter_last_name || ticket?.external_reporter_email;
    if (!token || !ticket?.reporter_id || hasExternalReporter) {
      setResolvedReporter(null);
      return;
    }
    let cancelled = false;
    resolveUsers(token, [ticket.reporter_id])
      .then((users) => { if (!cancelled) setResolvedReporter(users[0] ?? null); })
      .catch(() => { if (!cancelled) setResolvedReporter(null); });
    return () => { cancelled = true; };
  }, [token, ticket?.reporter_id, ticket?.external_reporter_first_name, ticket?.external_reporter_last_name, ticket?.external_reporter_email]);

  useEffect(() => {
    if (editingTitle && titleRef.current) titleRef.current.focus();
  }, [editingTitle]);

  function reporterDisplay(tk: Ticket): string {
    const externalName = [tk.external_reporter_first_name, tk.external_reporter_last_name].filter(Boolean).join(" ");
    if (externalName) return tk.external_reporter_email ? `${externalName} (${tk.external_reporter_email})` : externalName;
    if (tk.external_reporter_email) return tk.external_reporter_email;
    if (resolvedReporter) {
      const name = [resolvedReporter.first_name, resolvedReporter.last_name].filter(Boolean).join(" ").trim();
      return name || resolvedReporter.username;
    }
    if (tk.reporter_id) return tk.reporter_id.slice(0, 8) + "…";
    return user?.username ?? "—";
  }

  async function patch(update: Parameters<typeof updateTicket>[2]) {
    if (!token || !ticket) return;
    setSaving(true);
    try {
      const updated = await updateTicket(token, ticket.id, update);
      setTicket(updated);
    } finally {
      setSaving(false);
    }
  }

  async function handleTitleSave() {
    if (!titleDraft.trim() || !ticket) return;
    setEditingTitle(false);
    if (titleDraft.trim() !== ticket.name) await patch({ name: titleDraft.trim() });
  }

  async function handleDescSave() {
    setEditingDesc(false);
    await patch({ description: descDraft || undefined });
  }

  function startEditingReporter() {
    setReporterFirstDraft(ticket?.external_reporter_first_name ?? "");
    setReporterLastDraft(ticket?.external_reporter_last_name ?? "");
    setReporterEmailDraft(ticket?.external_reporter_email ?? "");
    setEditingReporter(true);
  }

  async function handleReporterSave() {
    setEditingReporter(false);
    // "" clears a previously-set field — the backend applies these via
    // COALESCE, so an omitted/undefined field would leave the old value.
    await patch({
      external_reporter_first_name: reporterFirstDraft.trim() || "",
      external_reporter_last_name: reporterLastDraft.trim() || "",
      external_reporter_email: reporterEmailDraft.trim() || "",
    });
  }

  async function handleDelete() {
    if (!token || !ticket) return;
    await deleteTicket(token, ticket.id);
    router.push("/tickets");
  }

  async function handleSaveAsNote(title: string, body: string, isShared = false) {
    if (!token || !ticket) return;
    await createNote(token, { entity_type: "workflow", entity_id: ticket.id, title, body: body || undefined, is_shared: isShared });
  }

  async function handleTograSent(workflowId: string, projectId: string, project: string, job: string, noteCopyWarning?: string) {
    setShowSendToTogra(false);
    if (!token || !ticket) return;
    try {
      await patch({
        togra_workflow_id: workflowId,
        togra_project_id: projectId,
        status: "In Progress",
      });
      const tograStoryUrl = tograUrl ? `${tograUrl}/en/projects/${projectId}/stories/${workflowId}` : null;
      await createNote(token, {
        entity_type: "workflow",
        entity_id: ticket.id,
        title: `Sent to Togra: ${project} › ${job}`,
        body: tograStoryUrl
          ? `Story created in **${project}** › **${job}**.\n\n[View in Togra ↗](${tograStoryUrl})`
          : `Story created in **${project}** › **${job}**. Togra workflow ID: \`${workflowId}\``,
        is_shared: true,
      });
      if (noteCopyWarning) setError(noteCopyWarning);
    } catch (err) {
      console.error("handleTograSent failed:", err);
      setError(`Sent to Togra but failed to update ticket: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );

  if (error || !ticket) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <p className="text-slate-500 text-sm">{error ?? t("notFound")}</p>
        <Link href="/tickets" className="mt-2 block text-sm text-violet-700 hover:underline">{t("breadcrumbTickets")}</Link>
      </div>
    </div>
  );

  const queueName = queues.find((q) => q.id === ticket.job_id)?.name;
  const showAiBanner = !aiBannerDismissed && hasUnreadAiAnalysis(ticket.id, ticket.ai_processed_at);

  const handleViewAiAnalysis = () => {
    markAiAnalysisRead(ticket.id);
    setAiBannerDismissed(true);
    setMainTab("triage");
    setExplorerTab("notes");
  };

  const tabBtn = (tab: MainTab, label: string) => (
    <button
      onClick={() => setMainTab(tab)}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        mainTab === tab
          ? "border-violet-600 text-violet-700"
          : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar with breadcrumb + tabs */}
      <div className="border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center justify-between px-6 pt-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/tickets" className="text-sm text-slate-500 hover:text-violet-700 transition-colors shrink-0">{t("breadcrumbTickets")}</Link>
            <span className="text-slate-300">/</span>
            <span className="text-sm font-mono text-violet-600 font-semibold shrink-0">{ticketId(ticket.ticket_number)}</span>
            <span className="text-slate-300">/</span>
            <span className="text-sm text-slate-700 font-medium truncate">{ticket.name}</span>
            {saving && <span className="text-xs text-slate-400 ml-1 shrink-0">Saving…</span>}
          </div>
          <button onClick={() => setConfirmDelete(true)} className="shrink-0 p-1.5 text-slate-400 hover:text-red-500 transition-colors rounded ml-4" title="Delete ticket">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>
          </button>
        </div>
        {/* Tab bar */}
        <div className="flex px-6 gap-0">
          {tabBtn("details", t("tabDetails"))}
          {tabBtn("triage", t("tabTriage"))}
        </div>
      </div>

      {showAiBanner && (
        <div className="shrink-0 flex items-center justify-between gap-3 bg-violet-50 border-b border-violet-200 px-6 py-2.5">
          <div className="flex items-center gap-2 text-sm text-violet-800">
            <span>🤖</span>
            <span className="font-medium">AI analysis is ready to review</span>
          </div>
          <button onClick={handleViewAiAnalysis} className="text-xs font-semibold text-violet-700 hover:text-violet-900 underline shrink-0">
            View analysis
          </button>
        </div>
      )}

      {ticket.ai_processed_at && (
        <div className="shrink-0 flex items-center justify-between gap-3 bg-slate-50 border-b border-slate-200 px-6 py-1.5">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>🤖 AI triage</span>
            {ticket.ai_confidence != null && <span>{Math.round(ticket.ai_confidence * 100)}% confidence</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400 mr-0.5">Was this helpful?</span>
            <button
              onClick={() => setFeedbackDialog("helpful")}
              title="Helpful"
              className={`text-sm px-1.5 py-0.5 rounded transition-colors ${ticket.ai_outcome_feedback === "helpful" ? "bg-emerald-100" : "hover:bg-white"}`}
            >
              👍
            </button>
            <button
              onClick={() => setFeedbackDialog("unhelpful")}
              title="Unhelpful"
              className={`text-sm px-1.5 py-0.5 rounded transition-colors ${ticket.ai_outcome_feedback === "unhelpful" ? "bg-red-100" : "hover:bg-white"}`}
            >
              👎
            </button>
          </div>
        </div>
      )}

      {/* Tab content */}
      {mainTab === "details" && (
        <div className="flex-1 flex min-h-0">
          {/* Left panel */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Title */}
              {editingTitle ? (
                <form onSubmit={(e) => { e.preventDefault(); handleTitleSave(); }} className="flex gap-2">
                  <input ref={titleRef} value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={handleTitleSave}
                    className="flex-1 text-xl font-bold border border-violet-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400" />
                </form>
              ) : (
                <h1
                  className="text-xl font-bold text-slate-900 cursor-text hover:text-violet-700 transition-colors leading-snug"
                  onClick={() => { setTitleDraft(ticket.name); setEditingTitle(true); }}
                  title="Click to edit"
                >
                  {ticket.name}
                </h1>
              )}

              {/* Metadata pills */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono font-semibold text-violet-600 bg-violet-50 border border-violet-200 rounded px-2 py-0.5">{ticketId(ticket.ticket_number)}</span>
                <TicketTypeBadge type={ticket.ticket_type} />
                <PriorityBadge priority={ticket.priority} />
                <div className="relative">
                  <select
                    value={ticket.status}
                    onChange={(e) => patch({ status: e.target.value as Status })}
                    className="appearance-none pl-2 pr-6 py-0.5 text-xs font-medium rounded-full border border-slate-200 bg-white text-slate-700 focus:border-violet-400 focus:outline-none cursor-pointer hover:border-slate-300 transition-colors"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{tStatus(s)}</option>
                    ))}
                  </select>
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-slate-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    <path d="M4 6l4 4 4-4H4z"/>
                  </svg>
                </div>
              </div>

              {/* Metadata grid */}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border border-slate-200 rounded-xl p-4 bg-slate-50 text-sm">
                <div>
                  <dt className="text-xs text-slate-400 font-medium mb-0.5">{t("queue")}</dt>
                  <dd>
                    <select value={ticket.job_id ?? ""} onChange={(e) => patch({ job_id: e.target.value || undefined })}
                      className="text-sm border-0 bg-transparent text-slate-700 focus:outline-none cursor-pointer hover:text-violet-700 transition-colors -ml-0.5 w-full">
                      <option value="">{t("noQueue")}</option>
                      {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                    </select>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 font-medium mb-0.5">{t("reporter")}</dt>
                  <dd className="text-slate-700 flex items-center gap-1.5 group">
                    <span>{reporterDisplay(ticket)}</span>
                    <button type="button" onClick={startEditingReporter} title="Edit reporter"
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-violet-600 transition-opacity">
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 0 0-.064.108l-.558 1.953 1.953-.558a.253.253 0 0 0 .108-.064Z"/></svg>
                    </button>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 font-medium mb-0.5">{t("created")}</dt>
                  <dd className="text-slate-500 text-xs">{formatDate(ticket.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 font-medium mb-0.5">{t("updated")}</dt>
                  <dd className="text-slate-500 text-xs">{formatDate(ticket.updated_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 font-medium mb-0.5">Type</dt>
                  <dd>
                    <select value={ticket.ticket_type ?? ""}
                      onChange={(e) => patch({ ticket_type: (e.target.value as TicketType) || null })}
                      className="text-sm border-0 bg-transparent text-slate-700 focus:outline-none cursor-pointer hover:text-violet-700 transition-colors -ml-0.5">
                      <option value="">— none —</option>
                      {TICKET_TYPES.map((v) => <option key={v} value={v}>{tType(v)}</option>)}
                    </select>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 font-medium mb-0.5">Priority</dt>
                  <dd>
                    <select value={ticket.priority ?? ""}
                      onChange={(e) => patch({ priority: (e.target.value as Priority) || null })}
                      className="text-sm border-0 bg-transparent text-slate-700 focus:outline-none cursor-pointer hover:text-violet-700 transition-colors -ml-0.5">
                      <option value="">— none —</option>
                      {PRIORITIES.map((v) => <option key={v} value={v}>{tPri(v)}</option>)}
                    </select>
                  </dd>
                </div>
                {editingReporter && (
                  <div className="col-span-2 pt-2 border-t border-slate-200 space-y-2">
                    <dt className="text-xs text-slate-400 font-medium mb-1">External reporter</dt>
                    <dd className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input value={reporterFirstDraft} onChange={(e) => setReporterFirstDraft(e.target.value)} placeholder="First name"
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400" />
                        <input value={reporterLastDraft} onChange={(e) => setReporterLastDraft(e.target.value)} placeholder="Last name"
                          className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400" />
                      </div>
                      <input type="email" value={reporterEmailDraft} onChange={(e) => setReporterEmailDraft(e.target.value)} placeholder="Email address"
                        className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400" />
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => setEditingReporter(false)} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors">Cancel</button>
                        <button type="button" onClick={handleReporterSave} className="text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white px-4 py-1.5 rounded-lg transition-colors">Save</button>
                      </div>
                    </dd>
                  </div>
                )}
                {ticket.togra_workflow_id && (
                  <div className="col-span-2 pt-2 border-t border-slate-200">
                    <dt className="text-xs text-slate-400 font-medium mb-1">Togra Story</dt>
                    <dd>
                      {tograUrl && ticket.togra_project_id ? (
                        <button
                          type="button"
                          onClick={() => window.open(`${tograUrl}/en/projects/${ticket.togra_project_id}/stories/${ticket.togra_workflow_id}`, "togra-app")}
                          className="text-sm text-violet-600 hover:underline text-left"
                        >
                          View story in Togra ↗
                        </button>
                      ) : (
                        <span className="text-xs text-violet-500 font-mono">{ticket.togra_workflow_id}</span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-slate-700">Description</h2>
                  {!editingDesc && (
                    <button onClick={() => { setDescDraft(ticket.description ?? ""); setEditingDesc(true); }}
                      className="text-xs text-slate-400 hover:text-violet-700 transition-colors">
                      {ticket.description ? t("editDescription") : t("addDescription")}
                    </button>
                  )}
                </div>
                {editingDesc ? (
                  <div className="space-y-2">
                    <MarkdownEditor value={descDraft} onChange={setDescDraft} height={240} />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditingDesc(false)} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors">Cancel</button>
                      <button onClick={handleDescSave} className="text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white px-4 py-1.5 rounded-lg transition-colors">Save</button>
                    </div>
                  </div>
                ) : ticket.description ? (
                  <div
                    className="prose prose-sm prose-slate max-w-none cursor-text hover:bg-slate-50 rounded-lg p-2 -ml-2 transition-colors"
                    onClick={() => { setDescDraft(ticket.description ?? ""); setEditingDesc(true); }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{ticket.description}</ReactMarkdown>
                  </div>
                ) : (
                  <button onClick={() => { setDescDraft(""); setEditingDesc(true); }}
                    className="text-sm text-slate-400 italic hover:text-violet-600 transition-colors">
                    {t("addDescription")}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Resize handle */}
          <div onMouseDown={rightResize.onMouseDown} className="w-1.5 shrink-0 bg-slate-100 hover:bg-violet-200 cursor-col-resize transition-colors" />

          {/* Right panel — Notes */}
          <div className="shrink-0 flex flex-col overflow-hidden" style={{ width: rightResize.size }}>
            <div className="border-b border-slate-200 px-4 py-3 shrink-0">
              <h2 className="text-sm font-semibold text-slate-700">{t("notesTitle")}</h2>
            </div>
            <div className="flex-1 overflow-hidden min-h-0 px-4 py-3">
              <NotesPanel entityType="workflow" entityId={ticket.id} isTeam folderOrientation="vertical" />
            </div>
          </div>
        </div>
      )}

      {/* Triage tab — full width */}
      {mainTab === "triage" && (
        <div className="flex-1 flex min-h-0 gap-0">
          {/* Left: ticket quick-actions */}
          <div className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-y-auto p-4 gap-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Quick actions</h3>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-400 mb-1">Status</dt>
                  <dd>
                    <select value={ticket.status} onChange={(e) => patch({ status: e.target.value as Status })}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:border-violet-400 focus:outline-none cursor-pointer">
                      {STATUSES.map((s) => <option key={s} value={s}>{tStatus(s)}</option>)}
                    </select>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 mb-1">Type</dt>
                  <dd>
                    <select value={ticket.ticket_type ?? ""}
                      onChange={(e) => patch({ ticket_type: (e.target.value as TicketType) || null })}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:border-violet-400 focus:outline-none cursor-pointer">
                      <option value="">— none —</option>
                      {TICKET_TYPES.map((v) => <option key={v} value={v}>{tType(v)}</option>)}
                    </select>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 mb-1">Priority</dt>
                  <dd>
                    <select value={ticket.priority ?? ""}
                      onChange={(e) => patch({ priority: (e.target.value as Priority) || null })}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:border-violet-400 focus:outline-none cursor-pointer">
                      <option value="">— none —</option>
                      {PRIORITIES.map((v) => <option key={v} value={v}>{tPri(v)}</option>)}
                    </select>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400 mb-1">Queue</dt>
                  <dd>
                    <select value={ticket.job_id ?? ""} onChange={(e) => patch({ job_id: e.target.value || undefined })}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-700 focus:border-violet-400 focus:outline-none cursor-pointer">
                      <option value="">— none —</option>
                      {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                    </select>
                  </dd>
                </div>
              </dl>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Current state</h3>
              <div className="space-y-1.5">
                {ticket.ticket_type && <TicketTypeBadge type={ticket.ticket_type} />}
                {ticket.priority && <PriorityBadge priority={ticket.priority} />}
                <StatusPill status={ticket.status} />
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 mt-auto">
              {ticket.togra_workflow_id ? (
                <div className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 space-y-1">
                  <p className="text-xs font-medium text-violet-700">Sent to Togra</p>
                  {tograUrl && ticket.togra_project_id ? (
                    <button
                      type="button"
                      onClick={() => window.open(`${tograUrl}/en/projects/${ticket.togra_project_id}/stories/${ticket.togra_workflow_id}`, "togra-app")}
                      className="text-xs text-violet-600 hover:underline text-left"
                    >
                      View story in Togra ↗
                    </button>
                  ) : (
                    <p className="text-xs text-violet-500 font-mono truncate">{ticket.togra_workflow_id}</p>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setShowSendToTogra(true)}
                  className="w-full flex items-center justify-center gap-2 text-sm font-medium border border-slate-200 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 text-slate-600 px-3 py-2 rounded-lg transition-colors"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                    <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/>
                  </svg>
                  Send to Togra
                </button>
              )}
            </div>
          </div>

          {/* Right: explorer tabs */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-slate-50">
            <div className="border-b border-slate-200 bg-white flex px-4 gap-0 shrink-0">
              {([
                { id: "notes", label: "Notes" },
                { id: "ai", label: "AI Assistant" },
                { id: "wikipedia", label: "Wikipedia" },
              ] as { id: ExplorerTab; label: string }[]).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setExplorerTab(id)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    explorerTab === id
                      ? "border-violet-600 text-violet-700"
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-hidden p-4 flex flex-col min-h-0">
              {explorerTab === "notes" && (
                <div className="flex-1 min-h-0">
                  <NotesPanel entityType="workflow" entityId={ticket.id} isTeam twoColumn />
                </div>
              )}
              {explorerTab === "ai" && (
                <AiChatExplorer ticket={ticket} onSaveAsNote={handleSaveAsNote} />
              )}
              {explorerTab === "wikipedia" && (
                <WikipediaExplorer onSaveAsNote={handleSaveAsNote} />
              )}
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t("deleteConfirmTitle")}
          message={t("deleteConfirmMessage")}
          confirmLabel={t("deleteConfirmLabel")}
          onConfirm={() => { setConfirmDelete(false); handleDelete(); }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {showSendToTogra && ticket && (
        <SendToTograModal
          ticket={ticket}
          onClose={() => setShowSendToTogra(false)}
          onSent={handleTograSent}
        />
      )}

      {feedbackDialog && ticket && (
        <FeedbackReasonModal
          ticket={ticket}
          feedback={feedbackDialog}
          onClose={() => setFeedbackDialog(null)}
          onSubmitted={(updated) => setTicket(updated)}
        />
      )}
    </div>
  );
}
