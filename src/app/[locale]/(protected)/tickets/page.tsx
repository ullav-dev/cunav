"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { listTickets, createTicket, deleteTicket, filterCunavTickets, listQueues } from "@/lib/cunav-api";
import { getAweTeamIds } from "@/lib/auth-api";
import { useInterval } from "@/hooks/useInterval";
import type { Ticket, Queue, Status, TicketType, Priority } from "@/lib/types";
import StatusPill from "@/components/StatusPill";
import PriorityBadge from "@/components/PriorityBadge";
import TicketTypeBadge from "@/components/TicketTypeBadge";
import ConfirmDialog from "@/components/ConfirmDialog";
import MarkdownEditor from "@/components/MarkdownEditor";

const PAGE_SIZE = 25;

function Avatar({ name, url }: { name: string; url?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (url && !broken) return <img src={url} alt={name} title={name} className="w-6 h-6 rounded-full object-cover" onError={() => setBroken(true)} />;
  return (
    <span title={name} className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold flex items-center justify-center select-none">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

type StatusFilter = "all" | "open" | "inProgress" | "resolved" | "myTickets";
type SortField = "type" | "priority" | "status" | "created";
type SortDir = "asc" | "desc";

const STATUS_FILTER_MAP: Record<StatusFilter, Status[] | null> = {
  all: null,
  open: ["Not Started", "Ready"],
  inProgress: ["In Progress"],
  resolved: ["Complete", "Cancelled"],
  myTickets: null,
};

const PRIORITY_WEIGHT: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const TICKET_TYPES: TicketType[] = ["bug", "feature", "question", "improvement", "task"];
const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

const REFRESH_OPTIONS: { label: string; ms: number | null }[] = [
  { label: "Manual", ms: null },
  { label: "1 min", ms: 60_000 },
  { label: "5 min", ms: 300_000 },
  { label: "10 min", ms: 600_000 },
  { label: "30 min", ms: 1_800_000 },
  { label: "1 hr", ms: 3_600_000 },
];

interface CreateTicketModalProps {
  queues: Queue[];
  defaultQueueId?: string;
  teamIds: string[];
  onClose: () => void;
  onCreated: (t: Ticket) => void;
  token: string;
}

function CreateTicketModal({ queues, defaultQueueId, teamIds, onClose, onCreated, token }: CreateTicketModalProps) {
  const t = useTranslations("tickets");
  const tType = useTranslations("ticketType");
  const tPri = useTranslations("priority");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ticketType, setTicketType] = useState<TicketType>("bug");
  const [priority, setPriority] = useState<Priority>("medium");
  const [queueId, setQueueId] = useState(defaultQueueId ?? queues[0]?.id ?? "");
  const [teamId] = useState(teamIds[0] ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError(null);
    try {
      const ticket = await createTicket(token, {
        name: name.trim(),
        description: description || undefined,
        ticket_type: ticketType,
        priority,
        job_id: queueId || undefined,
        team_id: teamId || undefined,
        is_shared: true,
      });
      onCreated(ticket);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create ticket");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">{t("createTicket")}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{t("col.title")}</label>
            <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Briefly describe the issue…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("col.type")}</label>
              <select value={ticketType} onChange={(e) => setTicketType(e.target.value as TicketType)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none bg-white">
                {TICKET_TYPES.map((v) => <option key={v} value={v}>{tType(v)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("col.priority")}</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none bg-white">
                {PRIORITIES.map((v) => <option key={v} value={v}>{tPri(v)}</option>)}
              </select>
            </div>
          </div>
          {queues.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{t("col.queue")}</label>
              <select value={queueId} onChange={(e) => setQueueId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none bg-white">
                <option value="">— No queue —</option>
                {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <MarkdownEditor value={description} onChange={setDescription} placeholder="Describe the issue in detail…" height={160} />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
            <button type="submit" disabled={saving || !name.trim()}
              className="px-4 py-2 text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white rounded-lg transition-colors">
              {saving ? "Creating…" : t("createTicket")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-slate-300 ml-1"><path d="M4 5h8M4 8h6M4 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>;
  return sortDir === "asc"
    ? <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-violet-600 ml-1"><path d="M8 3L4 9h8L8 3z"/></svg>
    : <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-violet-600 ml-1"><path d="M8 13L4 7h8L8 13z"/></svg>;
}

export default function TicketsPage() {
  const { token, user } = useAuth();
  const t = useTranslations("tickets");
  const tf = useTranslations("tickets.filters");
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedQueueId = searchParams.get("queue") ?? "";

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [typeFilter, setTypeFilter] = useState<TicketType | "">("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "">("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [autoRefreshMs, setAutoRefreshMs] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Ticket | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const cunavTeamIds = getAweTeamIds(token ?? null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [ticketsData, queuesData] = await Promise.all([
        listTickets(token),
        listQueues(token).catch(() => [] as Queue[]),
      ]);
      setTickets(filterCunavTickets(ticketsData, queuesData));
      setQueues(queuesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useInterval(load, autoRefreshMs);

  // Reset to page 1 when filters/queue/search change
  useEffect(() => { setPage(1); }, [selectedQueueId, statusFilter, typeFilter, priorityFilter, search, sortField, sortDir]);

  function handleSortClick(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "created" ? "desc" : "asc");
    }
  }

  function selectQueue(id: string) {
    if (id) {
      router.push(`/tickets?queue=${id}`);
    } else {
      router.push("/tickets");
    }
  }

  // Per-queue ticket counts for sidebar
  const queueCounts = queues.reduce<Record<string, number>>((acc, q) => {
    acc[q.id] = tickets.filter((t) => t.job_id === q.id).length;
    return acc;
  }, {});

  const q = search.toLowerCase();
  const filteredTickets = tickets
    .filter((ticket) => {
      if (selectedQueueId && ticket.job_id !== selectedQueueId) return false;
      const statusMatch = (() => {
        if (statusFilter === "myTickets") return ticket.created_by === user?.id;
        const allowed = STATUS_FILTER_MAP[statusFilter];
        if (!allowed) return true;
        return allowed.includes(ticket.status);
      })();
      const typeMatch = !typeFilter || ticket.ticket_type === typeFilter;
      const priorityMatch = !priorityFilter || ticket.priority === priorityFilter;
      const searchMatch = !q || ticket.name.toLowerCase().includes(q) || (ticket.description ?? "").toLowerCase().includes(q);
      return statusMatch && typeMatch && priorityMatch && searchMatch;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortField === "type") cmp = (a.ticket_type ?? "").localeCompare(b.ticket_type ?? "");
      else if (sortField === "priority") cmp = (PRIORITY_WEIGHT[a.priority ?? ""] ?? 99) - (PRIORITY_WEIGHT[b.priority ?? ""] ?? 99);
      else if (sortField === "status") cmp = a.status.localeCompare(b.status);
      else cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / PAGE_SIZE));
  const pagedTickets = filteredTickets.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function handleDelete(ticket: Ticket) {
    if (!token) return;
    setDeleting(ticket.id);
    try {
      await deleteTicket(token, ticket.id);
      setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
    } finally {
      setDeleting(null);
    }
  }

  const activeQueue = queues.find((q) => q.id === selectedQueueId);
  const statusFilters: StatusFilter[] = ["all", "open", "inProgress", "resolved", "myTickets"];

  const SortableTh = ({ field, label, className }: { field: SortField; label: string; className?: string }) => (
    <th
      className={`text-left px-2 py-3 text-xs font-semibold text-slate-500 cursor-pointer hover:text-slate-800 select-none whitespace-nowrap ${className ?? ""}`}
      onClick={() => handleSortClick(field)}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
      </span>
    </th>
  );

  return (
    <div className="flex-1 flex min-h-0">
      {/* Queue sidebar */}
      <aside className="w-52 shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-y-auto">
        <div className="px-3 pt-4 pb-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-1">Queues</p>
        </div>
        <nav className="flex-1 px-2 pb-4 space-y-0.5">
          <button
            onClick={() => selectQueue("")}
            className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-sm transition-colors ${
              !selectedQueueId
                ? "bg-violet-100 text-violet-800 font-medium"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <span>All Tickets</span>
            <span className={`text-xs rounded-full px-1.5 ${!selectedQueueId ? "bg-violet-200 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
              {tickets.length}
            </span>
          </button>
          {queues.map((queue) => (
            <button
              key={queue.id}
              onClick={() => selectQueue(queue.id)}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-sm transition-colors ${
                selectedQueueId === queue.id
                  ? "bg-violet-100 text-violet-800 font-medium"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <span className="truncate text-left">{queue.name}</span>
              <span className={`text-xs rounded-full px-1.5 shrink-0 ml-1 ${selectedQueueId === queue.id ? "bg-violet-200 text-violet-700" : "bg-slate-100 text-slate-500"}`}>
                {queueCounts[queue.id] ?? 0}
              </span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Header */}
        <div className="border-b border-slate-200 bg-white px-6 py-4 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-sm text-slate-500 mb-0.5">
                <span>{t("title")}</span>
                {activeQueue && (
                  <>
                    <span className="text-slate-300">/</span>
                    <span className="text-slate-800 font-medium">{activeQueue.name}</span>
                  </>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {filteredTickets.length} ticket{filteredTickets.length !== 1 ? "s" : ""}
                {activeQueue ? ` in ${activeQueue.name}` : ""}
              </p>
            </div>
            <button onClick={() => setShowCreate(true)}
              className="shrink-0 inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"/></svg>
              {t("newTicket")}
            </button>
          </div>

          {/* Status filters */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {statusFilters.map((sf) => (
              <button key={sf} onClick={() => setStatusFilter(sf)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors whitespace-nowrap ${statusFilter === sf ? "bg-violet-100 text-violet-700" : "text-slate-500 hover:bg-slate-100"}`}>
                {tf(sf)}
              </button>
            ))}
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TicketType | "")}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:border-violet-400 focus:outline-none bg-white text-slate-600">
                <option value="">All types</option>
                {TICKET_TYPES.map((v) => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
              </select>
              <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as Priority | "")}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:border-violet-400 focus:outline-none bg-white text-slate-600">
                <option value="">All priorities</option>
                {PRIORITIES.map((v) => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {/* Search + refresh */}
          <div className="flex items-center gap-2 mt-2">
            <div className="relative flex-1 max-w-xs">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215ZM11.5 7a4.499 4.499 0 1 0-8.997 0A4.499 4.499 0 0 0 11.5 7Z"/>
              </svg>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets…"
                className="w-full text-xs border border-slate-200 rounded-lg pl-7 pr-3 py-1.5 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400" />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/></svg>
                </button>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={load} title="Refresh now" className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z"/>
                </svg>
              </button>
              <select value={autoRefreshMs ?? ""} onChange={(e) => setAutoRefreshMs(e.target.value ? Number(e.target.value) : null)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:border-violet-400 focus:outline-none bg-white text-slate-600" title="Auto-refresh">
                {REFRESH_OPTIONS.map((o) => <option key={o.label} value={o.ms ?? ""}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-sm text-red-600">{error}</p>
              <button onClick={load} className="mt-2 text-sm text-violet-700 hover:underline">Retry</button>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-6 h-6 text-slate-400">
                  <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 14H1.75A1.75 1.75 0 0 1 0 12.25v-8.5C0 2.784.784 2 1.75 2ZM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V5.809L8.38 9.397a.75.75 0 0 1-.76 0L1.5 5.808v6.443Zm13-8.181v-.32a.25.25 0 0 0-.25-.25H1.75a.25.25 0 0 0-.25.25v.32L8 7.88l6.5-3.809Z"/>
                </svg>
              </div>
              <p className="text-slate-500 font-medium">{t("empty")}</p>
              <p className="text-slate-400 text-sm mt-1">{search ? "Try a different search term." : t("emptySubtitle")}</p>
              {!search && (
                <button onClick={() => setShowCreate(true)} className="mt-4 text-sm font-medium text-violet-700 hover:text-violet-800 transition-colors">
                  {t("createTicket")}
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto flex-1">
                <table className="w-full min-w-[780px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 sticky top-0">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 w-12">{t("col.id")}</th>
                      <SortableTh field="type" label={t("col.type")} className="w-24" />
                      <SortableTh field="priority" label={t("col.priority")} className="w-24" />
                      <th className="text-left px-2 py-3 text-xs font-semibold text-slate-500">{t("col.title")}</th>
                      <SortableTh field="status" label={t("col.status")} className="w-28" />
                      <SortableTh field="created" label={t("col.created")} className="w-36" />
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagedTickets.map((ticket) => (
                      <tr key={ticket.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="px-4 py-3 text-xs font-mono text-slate-400">{ticket.id.slice(0, 6)}</td>
                        <td className="px-2 py-3"><TicketTypeBadge type={ticket.ticket_type} /></td>
                        <td className="px-2 py-3"><PriorityBadge priority={ticket.priority} /></td>
                        <td className="px-2 py-3">
                          <Link href={`/tickets/${ticket.id}`} className="font-medium text-slate-800 hover:text-violet-700 transition-colors text-sm leading-snug line-clamp-2">
                            {ticket.name}
                          </Link>
                        </td>
                        <td className="px-2 py-3"><StatusPill status={ticket.status} /></td>
                        <td className="px-2 py-3 text-xs text-slate-400 whitespace-nowrap">{formatDateTime(ticket.created_at)}</td>
                        <td className="px-2 py-3">
                          <button onClick={() => setConfirmDelete(ticket)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-colors rounded"
                            title="Delete ticket">
                            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                              <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/>
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-3 flex items-center justify-between">
                  <p className="text-xs text-slate-500">
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredTickets.length)} of {filteredTickets.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Previous
                    </button>
                    <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateTicketModal
          queues={queues}
          defaultQueueId={selectedQueueId || undefined}
          teamIds={cunavTeamIds}
          token={token!}
          onClose={() => setShowCreate(false)}
          onCreated={(ticket) => setTickets((prev) => [ticket, ...prev])}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t("deleteConfirmTitle", { name: confirmDelete.name })}
          message={t("deleteConfirmMessage")}
          confirmLabel={t("deleteConfirmLabel")}
          onConfirm={() => { const ticket = confirmDelete; setConfirmDelete(null); handleDelete(ticket); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
