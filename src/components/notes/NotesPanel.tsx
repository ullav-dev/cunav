"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useResize } from "@/hooks/useResize";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MarkdownEditor from "@/components/MarkdownEditor";
import { useAuth } from "@/contexts/AuthContext";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  listNotes, createNote, updateNote, deleteNote,
  listNoteReplies, createNoteReply,
  moveNote,
  listNoteFolders, createNoteFolder, updateNoteFolder, deleteNoteFolder,
} from "@/lib/notes-api";
import type { Note, NoteFolder, NoteEntityType } from "@/lib/types";
import { markNoteRead, isNoteUnread } from "@/lib/last-read";

function formatRelative(iso: string, t: (key: string, params?: Record<string, string | number | Date>) => string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("justNow");
    if (mins < 60) return t("mAgo", { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("hAgo", { count: hours });
    const days = Math.floor(hours / 24);
    return days < 7 ? t("dAgo", { count: days }) : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return iso; }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

interface EditorProps {
  initial?: Pick<Note, "title" | "body" | "is_shared">;
  onSubmit: (title: string, body: string, isShared: boolean) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
  showShareToggle: boolean;
}

function NoteEditor({ initial, onSubmit, onCancel, saving, showShareToggle }: EditorProps) {
  const t = useTranslations("notes");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [isShared, setIsShared] = useState(initial?.is_shared ?? false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    try { await onSubmit(title.trim(), body, isShared); }
    catch (err) { setError(err instanceof Error ? err.message : t("saveFailed")); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input
        required autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder={t("titlePlaceholder")}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
      />
      <MarkdownEditor value={body} onChange={setBody} placeholder={t("bodyPlaceholder")} height={200} />
      {showShareToggle && (
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <button type="button" role="switch" aria-checked={isShared} onClick={() => setIsShared((v) => !v)}
            className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${isShared ? "bg-violet-500" : "bg-slate-300"}`}>
            <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${isShared ? "translate-x-4" : "translate-x-0"}`} />
          </button>
          <span className="text-xs text-slate-600">{isShared ? t("sharedWithTeam") : t("private")}</span>
        </label>
      )}
      <div className="flex gap-2 justify-end pt-1">
        <button type="button" onClick={onCancel} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 transition-colors">{t("cancel")}</button>
        <button type="submit" disabled={saving || !title.trim()} className="text-sm font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg transition-colors">
          {saving ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}

function NoteThread({ note, token, resolveCreator }: { note: Note; token: string; resolveCreator: (id: string) => string }) {
  const t = useTranslations("notes");
  const [replies, setReplies] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listNoteReplies(token, note.id)
      .then((d) => { if (!cancelled) setReplies(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, note.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      const reply = await createNoteReply(token, note.id, draft.trim());
      setReplies((prev) => [...prev, reply]);
      setDraft(""); setShowForm(false);
    } catch { /* ignore */ } finally { setSubmitting(false); }
  }

  return (
    <div className="border-t border-slate-100 pt-3 mt-2 space-y-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {t("repliesTitle")}{replies.length > 0 && <span className="ml-1 font-normal normal-case">({replies.length})</span>}
      </h4>
      {loading ? <p className="text-xs text-slate-400">{t("loadingReplies")}</p> : (
        <div className="space-y-3">
          {replies.map((reply) => (
            <div key={reply.id} className="flex gap-2">
              <div className="w-5 h-5 rounded-full bg-violet-100 flex items-center justify-center shrink-0 text-[9px] font-bold text-violet-600 uppercase mt-0.5">
                {resolveCreator(reply.created_by).charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs font-medium text-slate-700">{resolveCreator(reply.created_by)}</span>
                  <span className="text-[10px] text-slate-400">{formatRelative(reply.created_at, t)}</span>
                </div>
                {reply.body ? (
                  <div className="prose prose-xs prose-slate max-w-none text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{reply.body}</ReactMarkdown>
                  </div>
                ) : <p className="text-sm text-slate-400 italic">—</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {note.is_shared && !showForm && (
        <button onClick={() => setShowForm(true)} className="text-xs font-medium text-violet-700 hover:text-violet-900 transition-colors">{t("reply")}</button>
      )}
      {note.is_shared && showForm && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("replyPlaceholder")} rows={3}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none" />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setShowForm(false); setDraft(""); }} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded transition-colors">{t("cancel")}</button>
            <button type="submit" disabled={submitting || !draft.trim()} className="text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg transition-colors">
              {submitting ? t("sending") : t("reply")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function NoteView({ note, folders, currentUserId, token, resolveCreator, onEdit, onDelete, onMove, deleting }: {
  note: Note; folders: NoteFolder[]; currentUserId: string; token: string;
  resolveCreator: (id: string) => string;
  onEdit: () => void; onDelete: () => void; onMove: (folderId: string | null) => void; deleting: boolean;
}) {
  const t = useTranslations("notes");
  const isOwner = note.created_by === currentUserId;
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-800 leading-snug">{note.title}</h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-slate-500">{resolveCreator(note.created_by)}</span>
            <span className="text-xs text-slate-400">{formatDate(note.updated_at)}</span>
            {note.is_shared
              ? <span className="text-xs text-violet-600 font-medium">{t("shared")}</span>
              : <span className="text-xs text-slate-400">{t("private")}</span>}
          </div>
        </div>
        {isOwner && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onEdit} className="p-1.5 text-slate-400 hover:text-slate-700 transition-colors rounded" title="Edit">
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM11.189 6.25 9.75 4.81l-6.286 6.287a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.25.25 0 0 0 .108-.064L11.19 6.25Z"/></svg>
            </button>
            <button onClick={onDelete} disabled={deleting} className="p-1.5 text-slate-400 hover:text-red-500 disabled:opacity-40 transition-colors rounded" title="Delete">
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5 fill-current"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z"/></svg>
            </button>
          </div>
        )}
      </div>
      {isOwner && folders.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400">{t("folder")}</span>
          <select value={note.folder_id ?? ""} onChange={(e) => onMove(e.target.value || null)} className="text-xs border border-slate-200 rounded px-2 py-1 focus:border-violet-400 focus:outline-none bg-white text-slate-600">
            <option value="">{t("unfiled")}</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      )}
      {note.body ? (
        <div className="prose prose-sm prose-slate max-w-none border-t border-slate-100 pt-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
            {note.body}
          </ReactMarkdown>
        </div>
      ) : <p className="text-sm text-slate-400 italic border-t border-slate-100 pt-3">{t("noBody")}</p>}
      <NoteThread note={note} token={token} resolveCreator={resolveCreator} />
    </div>
  );
}

interface NoteAuthor {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string;
}

interface NotesPanelProps {
  members?: NoteAuthor[];
  folderOrientation?: "horizontal" | "vertical";
  autoSelectFirst?: boolean;
  entityType: NoteEntityType;
  entityId: string;
  isTeam: boolean;
  compact?: boolean;
  twoColumn?: boolean;
}

export default function NotesPanel({ entityType, entityId, isTeam, compact = false, twoColumn = false, members = [], folderOrientation = "horizontal", autoSelectFirst = false }: NotesPanelProps) {
  const { user, token } = useAuth();
  const t = useTranslations("notes");
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"list" | "view" | "create" | "edit">("list");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<Note | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<NoteFolder | null>(null);
  const [activeFolder, setActiveFolder] = useState<"all" | "mine" | "shared" | string>("all");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const listResize = useResize({ initial: 220, min: 140, max: 400, axis: "x" });
  const [foldersVisible, setFoldersVisible] = useState(true);

  const currentUserId = user?.id ?? "";
  const resolveCreator = (id: string | null): string => {
    if (!id) return t("unknown");
    if (id === currentUserId) {
      const me = members.find((m) => m.id === id);
      if (me) return `${me.first_name ?? ""} ${me.last_name ?? ""}`.trim() || me.username;
      return user?.username ?? t("you");
    }
    const member = members.find((m) => m.id === id);
    if (member) return `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() || member.username;
    return id.slice(0, 8) + "…";
  };

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    const [notesResult, foldersData] = await Promise.all([
      listNotes(token, entityType, entityId).then(
        (d) => ({ ok: true as const, data: d }),
        (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Failed to load notes" }),
      ),
      listNoteFolders(token).catch(() => [] as NoteFolder[]),
    ]);
    setLoading(false);
    if (!notesResult.ok) { setError(notesResult.error); return; }
    setNotes(notesResult.data);
    setFolders(foldersData);
    if (autoSelectFirst && notesResult.data.length > 0) {
      const first = notesResult.data.find((n) => !n.parent_id) ?? notesResult.data[0];
      setSelectedId(first.id);
      setMode("view");
    }
  }, [token, entityType, entityId, autoSelectFirst]);

  useEffect(() => { load(); }, [load]);

  const topLevel = notes.filter((n) => !n.parent_id);
  const selectedNote = topLevel.find((n) => n.id === selectedId) ?? null;

  function handleSelect(id: string) {
    if (selectedId === id && mode === "view") { setSelectedId(null); setMode("list"); }
    else { setSelectedId(id); setMode("view"); markNoteRead(id); }
  }

  async function handleCreate(title: string, body: string, isShared: boolean) {
    if (!token) return;
    setSaving(true);
    try {
      const virtualFolders = ["all", "mine", "shared"];
      const folderId = !compact && !virtualFolders.includes(activeFolder) ? activeFolder : null;
      const note = await createNote(token, { entity_type: entityType, entity_id: entityId, title, body: body || undefined, is_shared: isShared });
      const finalNote = folderId ? await moveNote(token, note.id, folderId) : note;
      setNotes((prev) => [finalNote, ...prev]);
      markNoteRead(finalNote.id); // own notes are always read
      setSelectedId(finalNote.id); setMode("view");
    } finally { setSaving(false); }
  }

  async function handleUpdate(title: string, body: string, isShared: boolean) {
    if (!token || !selectedNote) return;
    setSaving(true);
    try {
      const updated = await updateNote(token, selectedNote.id, { title, body: body || undefined, is_shared: isShared });
      setNotes((prev) => prev.map((n) => n.id === updated.id ? updated : n)); setMode("view");
    } finally { setSaving(false); }
  }

  async function doDeleteNote(note: Note) {
    if (!token) return;
    setDeletingId(note.id);
    try {
      await deleteNote(token, note.id);
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      if (selectedId === note.id) { setSelectedId(null); setMode("list"); }
    } finally { setDeletingId(null); }
  }

  async function handleMove(noteId: string, folderId: string | null) {
    if (!token) return;
    try {
      const updated = await moveNote(token, noteId, folderId);
      setNotes((prev) => prev.map((n) => n.id === updated.id ? updated : n));
    } catch { /* ignore */ }
  }

  async function handleCreateFolder() {
    if (!token || !newFolderName.trim()) return;
    try {
      const folder = await createNoteFolder(token, newFolderName.trim());
      setFolders((prev) => [...prev, folder].sort((a, b) => a.name.localeCompare(b.name)));
      setNewFolderName(""); setCreatingFolder(false);
    } catch { /* ignore */ }
  }

  async function handleRenameFolder(id: string, name: string) {
    if (!token || !name.trim()) { setRenamingFolderId(null); return; }
    try {
      const updated = await updateNoteFolder(token, id, name.trim());
      setFolders((prev) => prev.map((f) => f.id === updated.id ? updated : f).sort((a, b) => a.name.localeCompare(b.name)));
    } catch { /* ignore */ }
    finally { setRenamingFolderId(null); }
  }

  async function doDeleteFolder(folder: NoteFolder) {
    if (!token) return;
    try {
      await deleteNoteFolder(token, folder.id);
      setFolders((prev) => prev.filter((f) => f.id !== folder.id));
      setNotes((prev) => prev.map((n) => n.folder_id === folder.id ? { ...n, folder_id: null } : n));
      if (activeFolder === folder.id) setActiveFolder("all");
    } catch { /* ignore */ }
  }

  const filterNotes = (all: Note[]) => {
    if (compact) return all;
    if (activeFolder === "mine") return all.filter((n) => n.created_by === currentUserId);
    if (activeFolder === "shared") return all.filter((n) => n.is_shared);
    if (activeFolder !== "all") return all.filter((n) => n.folder_id === activeFolder);
    return all;
  };
  const visibleNotes = filterNotes(topLevel)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  if (loading) return <div className="text-sm text-slate-400 py-6 text-center">{t("loading")}</div>;
  if (error) return (
    <div className="text-sm text-red-600 py-4 text-center">
      {error}
      <button onClick={load} className="block mx-auto mt-2 text-xs text-violet-700 hover:underline">{t("retry")}</button>
    </div>
  );

  const mainContent = () => {
    if (mode === "create") return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">{t("newNoteTitle")}</h3>
        <NoteEditor saving={saving} showShareToggle={isTeam} onSubmit={handleCreate} onCancel={() => setMode("list")} />
      </div>
    );
    if (mode === "edit" && selectedNote) return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">{t("editNoteTitle")}</h3>
        <NoteEditor initial={selectedNote} saving={saving} showShareToggle={isTeam} onSubmit={handleUpdate} onCancel={() => setMode("view")} />
      </div>
    );
    if (mode === "view" && selectedNote) return (
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <NoteView note={selectedNote} folders={folders} currentUserId={currentUserId} resolveCreator={resolveCreator}
          token={token ?? ""} onEdit={() => setMode("edit")} onDelete={() => setConfirmDeleteNote(selectedNote)}
          onMove={(folderId) => handleMove(selectedNote.id, folderId)} deleting={deletingId === selectedNote.id} />
      </div>
    );
    return null;
  };

  const noteList = (
    <div className="space-y-2">
      {visibleNotes.length === 0 ? (
        <div className="text-center py-8 text-slate-400">
          <p className="text-sm">{t("noNotes")}</p>
          <button onClick={() => { setSelectedId(null); setMode("create"); }} className="mt-2 text-sm text-violet-700 hover:text-violet-800 font-medium transition-colors">
            {t("addFirstNote")}
          </button>
        </div>
      ) : (
        visibleNotes.map((note) => {
          const folderName = !compact ? folders.find((f) => f.id === note.folder_id)?.name : undefined;
          const unread = isNoteUnread(note.id);
          return (
            <button key={note.id} onClick={() => handleSelect(note.id)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${selectedId === note.id ? "border-violet-300 bg-violet-50" : unread ? "border-amber-200 bg-amber-50 hover:border-amber-300" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {unread && <span className="flex-shrink-0 w-2 h-2 rounded-full bg-amber-400 mt-0.5" title="Unread" />}
                  <span className={`text-sm truncate ${unread ? "font-semibold text-slate-900" : "font-medium text-slate-800"}`}>{note.title}</span>
                </div>
                <span className="text-[10px] shrink-0">{note.is_shared ? "👥" : "🔒"}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-slate-400">{resolveCreator(note.created_by)}</span>
                <span className="text-[10px] text-slate-300">·</span>
                <span className={`text-[10px] ${unread ? "text-amber-600 font-medium" : "text-slate-400"}`}>{formatRelative(note.updated_at, t)}</span>
                {folderName && <><span className="text-[10px] text-slate-300">·</span><span className="text-[10px] text-slate-400">📁 {folderName}</span></>}
              </div>
            </button>
          );
        })
      )}
    </div>
  );

  const confirmDialogs = (
    <>
      {confirmDeleteNote && (
        <ConfirmDialog
          title={t("deleteNoteTitle", { title: confirmDeleteNote.title })}
          message={t("deleteNoteMessage")}
          confirmLabel={t("deleteNoteLabel")}
          onConfirm={() => { const n = confirmDeleteNote; setConfirmDeleteNote(null); doDeleteNote(n); }}
          onCancel={() => setConfirmDeleteNote(null)}
        />
      )}
      {confirmDeleteFolder && (
        <ConfirmDialog
          title={t("deleteFolderTitle", { name: confirmDeleteFolder.name })}
          message={t("deleteFolderMessage")}
          confirmLabel={t("deleteFolderLabel")}
          onConfirm={() => { const f = confirmDeleteFolder; setConfirmDeleteFolder(null); doDeleteFolder(f); }}
          onCancel={() => setConfirmDeleteFolder(null)}
        />
      )}
    </>
  );

  const noteCount = visibleNotes.length === 1 ? t("noteCountSingle") : t("noteCountPlural", { count: visibleNotes.length });

  if (compact) return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t("compactTitle", { count: topLevel.length })}</span>
          <button onClick={() => { setSelectedId(null); setMode("create"); }} className="text-xs font-medium text-violet-700 hover:text-violet-800 transition-colors">+ {t("newNote")}</button>
        </div>
        {mainContent() ?? noteList}
        {mode !== "list" && (
          <button onClick={() => { setMode("list"); setSelectedId(null); }} className="text-xs text-slate-500 hover:text-slate-700 transition-colors">{t("allNotes")}</button>
        )}
      </div>
      {confirmDialogs}
    </>
  );

  const folderSidebar = (
    <div className="w-44 shrink-0 space-y-0.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t("foldersLabel")}</span>
        <button onClick={() => { setCreatingFolder(true); setNewFolderName(""); }} className="text-slate-400 hover:text-violet-700 transition-colors text-base leading-none" title={t("newNote")}>+</button>
      </div>
      {(["all", "mine", "shared"] as const).map((key) => (
        <button key={key} onClick={() => { setActiveFolder(key); setSelectedId(null); setMode("list"); }}
          className={`w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors ${activeFolder === key ? "bg-violet-50 text-violet-700 font-medium" : "text-slate-600 hover:bg-slate-100"}`}>
          {key === "all" ? t("allNotesFilter") : key === "mine" ? t("myNotes") : t("sharedFilter")}
        </button>
      ))}
      <hr className="border-slate-200 my-1" />
      {folders.map((folder) =>
        renamingFolderId === folder.id ? (
          <form key={folder.id} onSubmit={(e) => { e.preventDefault(); handleRenameFolder(folder.id, renameFolderName); }} className="px-1 py-0.5">
            <input autoFocus value={renameFolderName} onChange={(e) => setRenameFolderName(e.target.value)}
              onBlur={() => handleRenameFolder(folder.id, renameFolderName)}
              className="w-full text-xs border border-violet-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400" />
          </form>
        ) : (
          <div key={folder.id} className={`group flex items-center gap-1 rounded-md transition-colors ${activeFolder === folder.id ? "bg-violet-50" : "hover:bg-slate-100"}`}>
            <button onClick={() => { setActiveFolder(folder.id); setSelectedId(null); setMode("list"); }}
              className={`flex-1 text-left text-xs px-2 py-1.5 truncate ${activeFolder === folder.id ? "text-violet-700 font-medium" : "text-slate-600"}`}>
              📁 {folder.name}
            </button>
            <div className="hidden group-hover:flex items-center pr-1 gap-0.5">
              <button onClick={() => { setRenamingFolderId(folder.id); setRenameFolderName(folder.name); }} className="p-0.5 text-slate-300 hover:text-slate-600 transition-colors text-xs" title="Rename">✏️</button>
              <button onClick={() => setConfirmDeleteFolder(folder)} className="p-0.5 text-slate-300 hover:text-red-500 transition-colors text-xs" title="Delete folder">🗑️</button>
            </div>
          </div>
        )
      )}
      {creatingFolder && (
        <form onSubmit={(e) => { e.preventDefault(); handleCreateFolder(); }} className="px-1 py-0.5">
          <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
            onBlur={() => { if (!newFolderName.trim()) setCreatingFolder(false); }}
            placeholder={t("folderNamePlaceholder")}
            className="w-full text-xs border border-violet-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400" />
        </form>
      )}
    </div>
  );

  if (twoColumn) {
    const rightPanel = () => {
      if (mode === "create") return (
        <div className="flex flex-col h-full">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 shrink-0">{t("newNoteTitle")}</h3>
          <div className="flex-1 overflow-y-auto">
            <NoteEditor saving={saving} showShareToggle={isTeam} onSubmit={handleCreate} onCancel={() => setMode("list")} />
          </div>
        </div>
      );
      if (mode === "edit" && selectedNote) return (
        <div className="flex flex-col h-full">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 shrink-0">{t("editNoteTitle")}</h3>
          <div className="flex-1 overflow-y-auto">
            <NoteEditor initial={selectedNote} saving={saving} showShareToggle={isTeam} onSubmit={handleUpdate} onCancel={() => setMode("view")} />
          </div>
        </div>
      );
      if (mode === "view" && selectedNote) return (
        <div className="overflow-y-auto h-full">
          <NoteView note={selectedNote} folders={folders} currentUserId={currentUserId} resolveCreator={resolveCreator}
            token={token ?? ""} onEdit={() => setMode("edit")} onDelete={() => setConfirmDeleteNote(selectedNote)}
            onMove={(folderId) => handleMove(selectedNote.id, folderId)} deleting={deletingId === selectedNote.id} />
        </div>
      );
      return (
        <div className="flex items-center justify-center h-full text-slate-400 text-sm">{t("selectNote")}</div>
      );
    };

    return (
      <>
        <div className="flex h-full min-h-0">
          <div className="w-40 shrink-0 flex flex-col gap-0.5 pr-3 border-r border-slate-200 overflow-y-auto">{folderSidebar}</div>
          <div className="shrink-0 flex flex-col overflow-hidden border-r border-slate-200" style={{ width: listResize.size }}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 shrink-0">
              <span className="text-xs font-medium text-slate-500">{noteCount}</span>
              <button onClick={() => { setSelectedId(null); setMode("create"); }} className="text-xs font-medium text-violet-700 hover:text-violet-800 transition-colors">+ {t("newNote")}</button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">{noteList}</div>
          </div>
          <div onMouseDown={listResize.onMouseDown} className="w-1.5 shrink-0 bg-slate-100 hover:bg-violet-200 cursor-col-resize transition-colors" />
          <div className="flex-1 min-w-0 overflow-hidden pl-3">{rightPanel()}</div>
        </div>
        {confirmDialogs}
      </>
    );
  }

  const folderBar = (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 shrink-0 scrollbar-none">
      {(["all", "mine", "shared"] as const).map((key) => (
        <button key={key} onClick={() => { setActiveFolder(key); setSelectedId(null); setMode("list"); }}
          className={`shrink-0 text-xs px-2.5 py-1 rounded-full transition-colors whitespace-nowrap ${activeFolder === key ? "bg-violet-100 text-violet-700 font-medium" : "text-slate-500 hover:bg-slate-100"}`}>
          {key === "all" ? t("allNotesFilter") : key === "mine" ? t("myNotes") : t("sharedFilter")}
        </button>
      ))}
      {folders.length > 0 && <span className="text-slate-200 shrink-0">|</span>}
      {folders.map((folder) =>
        renamingFolderId === folder.id ? (
          <form key={folder.id} onSubmit={(e) => { e.preventDefault(); handleRenameFolder(folder.id, renameFolderName); }} className="shrink-0">
            <input autoFocus value={renameFolderName} onChange={(e) => setRenameFolderName(e.target.value)}
              onBlur={() => handleRenameFolder(folder.id, renameFolderName)}
              className="text-xs border border-violet-300 rounded-full px-2.5 py-1 focus:outline-none w-28" />
          </form>
        ) : (
          <div key={folder.id} className="group shrink-0 flex items-center gap-0.5">
            <button onClick={() => { setActiveFolder(folder.id); setSelectedId(null); setMode("list"); }}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors whitespace-nowrap ${activeFolder === folder.id ? "bg-violet-100 text-violet-700 font-medium" : "text-slate-500 hover:bg-slate-100"}`}>
              📁 {folder.name}
            </button>
            <div className="hidden group-hover:flex items-center gap-0.5">
              <button onClick={() => { setRenamingFolderId(folder.id); setRenameFolderName(folder.name); }} className="text-slate-300 hover:text-slate-500 text-xs p-0.5" title="Rename">✏️</button>
              <button onClick={() => setConfirmDeleteFolder(folder)} className="text-slate-300 hover:text-red-500 text-xs p-0.5" title="Delete">🗑️</button>
            </div>
          </div>
        )
      )}
      {creatingFolder ? (
        <form onSubmit={(e) => { e.preventDefault(); handleCreateFolder(); }} className="shrink-0">
          <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
            onBlur={() => { if (!newFolderName.trim()) setCreatingFolder(false); }}
            placeholder={t("folderNamePlaceholder")}
            className="text-xs border border-violet-300 rounded-full px-2.5 py-1 focus:outline-none w-28" />
        </form>
      ) : (
        <button onClick={() => { setCreatingFolder(true); setNewFolderName(""); }} className="shrink-0 text-xs px-2 py-1 text-slate-400 hover:text-violet-700 transition-colors" title={t("foldersLabel")}>+ folder</button>
      )}
    </div>
  );

  const newNoteBtn = (
    <button onClick={() => { setSelectedId(null); setMode("create"); }} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:text-violet-900 transition-colors">
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2Z"/></svg>
      {t("newNote")}
    </button>
  );

  const folderToggle = (
    <button onClick={() => setFoldersVisible((v) => !v)}
      className={`shrink-0 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${foldersVisible ? "bg-violet-50 text-violet-700 border-violet-200" : "text-slate-400 border-slate-200 hover:border-violet-300 hover:text-violet-600"}`}
      title={foldersVisible ? "Hide folders" : "Show folders"}>
      📁
    </button>
  );

  const notesContent = (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {mode !== "list" ? (
        <div className="space-y-3">
          <button onClick={() => { setMode("list"); setSelectedId(null); }} className="text-xs text-slate-500 hover:text-slate-700 transition-colors">{t("backToList")}</button>
          {mainContent()}
        </div>
      ) : noteList}
    </div>
  );

  if (folderOrientation === "vertical") {
    return (
      <>
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2">{folderToggle}<span className="text-xs font-medium text-slate-500">{noteCount}</span></div>
            {newNoteBtn}
          </div>
          <div className="flex gap-4 flex-1 min-h-0">
            {foldersVisible && <div className="w-44 shrink-0 overflow-y-auto">{folderSidebar}</div>}
            <div className="flex-1 min-w-0">{notesContent}</div>
          </div>
        </div>
        {confirmDialogs}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col min-h-0">
        <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-100 shrink-0">
          {folderToggle}
          {foldersVisible && <div className="flex-1 min-w-0">{folderBar}</div>}
          {!foldersVisible && <span className="flex-1 text-xs text-slate-400">{noteCount}</span>}
          {newNoteBtn}
        </div>
        {notesContent}
      </div>
      {confirmDialogs}
    </>
  );
}
