"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isTextUIPart } from "ai";
import type { UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "@/contexts/AuthContext";
import { loadPreference, type AiPreference } from "@/lib/ai-settings";
import { Link } from "@/i18n/navigation";
import type { Ticket } from "@/lib/types";

const MarkdownEditor = dynamic(() => import("@/components/MarkdownEditor"), { ssr: false });

// ─── template prompts ─────────────────────────────────────────────────────────

interface TemplateCategory {
  key: string;
  icon: string;
  prompts: string[];
}

const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  {
    key: "Triage",
    icon: "🔍",
    prompts: [
      "Summarise this ticket and suggest a priority level with reasoning",
      "What additional information should we ask the reporter to better diagnose this issue?",
      "Suggest steps to reproduce and investigate this bug",
      "Are there likely duplicate or related tickets I should check?",
    ],
  },
  {
    key: "Response",
    icon: "✉️",
    prompts: [
      "Draft a professional response to the reporter acknowledging the issue",
      "Draft an update to the reporter explaining we are investigating",
      "Draft a resolution message to send once this ticket is fixed",
      "Write an empathetic response for a frustrated customer",
    ],
  },
  {
    key: "Analysis",
    icon: "📊",
    prompts: [
      "What is the likely root cause of this issue?",
      "What is the potential impact on users if this is not resolved quickly?",
      "Suggest what team or component should own this ticket",
      "List the risks of not addressing this ticket soon",
    ],
  },
  {
    key: "Planning",
    icon: "📋",
    prompts: [
      "Break this ticket into actionable resolution steps",
      "What acceptance criteria would confirm this ticket is resolved?",
      "Estimate the complexity of this fix and suggest a time frame",
      "What testing should be done to verify the fix?",
    ],
  },
];

function getTextFromMessage(msg: UIMessage): string {
  return msg.parts.filter(isTextUIPart).map((p) => p.text).join("");
}

// ─── note editor modal ────────────────────────────────────────────────────────

interface NoteEditorModalProps {
  initialTitle: string;
  initialBody: string;
  onConfirm: (title: string, body: string, isShared: boolean) => Promise<void>;
  onCancel: () => void;
}

function NoteEditorModal({ initialTitle, initialBody, onConfirm, onCancel }: NoteEditorModalProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [isShared, setIsShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setSaving(true);
    try {
      await onConfirm(title.trim(), body, isShared);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Save as note</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div>
            <label className="block text-xs text-slate-500 mb-1">Title *</label>
            <input
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Content</label>
            <MarkdownEditor
              value={body}
              onChange={(val) => setBody(val ?? "")}
              height={280}
            />
          </div>

          {/* Share toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              role="checkbox"
              aria-checked={isShared}
              tabIndex={0}
              onClick={() => setIsShared((v) => !v)}
              onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") setIsShared((v) => !v); }}
              className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${isShared ? "bg-violet-600" : "bg-slate-300"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${isShared ? "translate-x-4" : "translate-x-0"}`} />
            </div>
            <span className="text-xs text-slate-600">
              {isShared ? "👥 Shared with team" : "🔒 Private note"}
            </span>
            <span className={`text-xs font-medium ${isShared ? "text-violet-500" : "text-slate-400"}`}>
              {isShared ? "Click to make private" : "Click to share"}
            </span>
          </label>

          <div className="flex gap-2 justify-end pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm px-4 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {saving ? "Saving…" : "Save note"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── component ────────────────────────────────────────────────────────────────

interface Props {
  ticket?: Ticket;
  onSaveAsNote?: (title: string, body: string, isShared: boolean) => Promise<void>;
}

function buildTicketContext(ticket: Ticket): string {
  return [
    `Title: ${ticket.name}`,
    ticket.ticket_type ? `Type: ${ticket.ticket_type}` : null,
    ticket.priority ? `Priority: ${ticket.priority}` : null,
    `Status: ${ticket.status}`,
    ticket.description ? `\nDescription:\n${ticket.description}` : null,
  ].filter(Boolean).join("\n");
}

export default function AiChatExplorer({ ticket, onSaveAsNote }: Props) {
  const { token } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [pref, setPref] = useState<AiPreference>({ provider: "anthropic", model: "claude-haiku-4-5-20251001" });
  const [notConfigured, setNotConfigured] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [pendingNote, setPendingNote] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => { setPref(loadPreference()); }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: {
          ...(ticket ? { ticketContext: buildTicketContext(ticket) } : {}),
          provider: pref.provider,
          model: pref.model,
          ...(pref.ollamaUrl ? { ollamaUrl: pref.ollamaUrl } : {}),
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, ticket?.id, pref.provider, pref.model, pref.ollamaUrl],
  );

  const { messages, sendMessage, setMessages, status, error } = useChat({ transport });
  const isLoading = status === "streaming" || status === "submitted";
  const visibleMessages = messages.filter((m) => m.role !== "system");

  useEffect(() => {
    if (error?.message?.includes("not configured")) setNotConfigured(true);
  }, [error]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setNotConfigured(false);
    setInput("");
    sendMessage({ text });
  }

  function handleTemplateClick(prompt: string) {
    setInput(prompt);
    setTemplatesOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleSaveMessage(msg: UIMessage) {
    if (!onSaveAsNote) return;
    const date = new Date().toLocaleDateString();
    setPendingNote({ title: `AI response — ${date}`, body: getTextFromMessage(msg) });
  }

  function handleSaveConversation() {
    if (!onSaveAsNote) return;
    const date = new Date().toLocaleDateString();
    const body = visibleMessages
      .map((m) =>
        m.role === "user"
          ? `**You:** ${getTextFromMessage(m)}`
          : `**AI:** ${getTextFromMessage(m)}`,
      )
      .join("\n\n---\n\n");
    setPendingNote({ title: `AI conversation — ${date}`, body });
  }

  if (notConfigured) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12 gap-3">
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-10 h-10 text-slate-300">
          <path d="M12 3C6.486 3 2 6.691 2 11.25c0 2.444 1.198 4.639 3.107 6.176-.178 1.07-.567 2.09-1.107 3.09.1.003.1.003.2.187a.5.5 0 0 0 .458.297h.042a14.16 14.16 0 0 0 4.4-1.6c.986.267 2.014.4 3 .4 5.514 0 10-3.691 10-8.25S17.514 3 12 3Z" />
        </svg>
        <p className="text-sm font-medium text-slate-700">AI provider not configured</p>
        <p className="text-xs text-slate-400">Check Settings or ask your administrator.</p>
        <Link href="/settings" className="text-sm font-medium text-violet-700 hover:text-violet-800 transition-colors">
          Go to Settings →
        </Link>
      </div>
    );
  }

  return (
    <>
      {pendingNote && onSaveAsNote && (
        <NoteEditorModal
          initialTitle={pendingNote.title}
          initialBody={pendingNote.body}
          onConfirm={async (title, body, isShared) => {
            await onSaveAsNote(title, body, isShared);
            setPendingNote(null);
          }}
          onCancel={() => setPendingNote(null)}
        />
      )}

      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between shrink-0 pb-2 mb-2 border-b border-slate-100">
          <span className="text-xs text-slate-400 capitalize">{pref.provider} · {pref.model}</span>
          <div className="flex items-center gap-3">
            {visibleMessages.length > 0 && (
              <>
                {onSaveAsNote && (
                  <button
                    onClick={handleSaveConversation}
                    className="text-xs text-violet-700 hover:text-violet-900 font-medium transition-colors"
                  >
                    Save conversation
                  </button>
                )}
                <button
                  onClick={() => setMessages([])}
                  className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Clear
                </button>
              </>
            )}
            <Link href="/settings" className="text-xs text-slate-400 hover:text-violet-700 transition-colors">
              Settings
            </Link>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 pb-2">
          {visibleMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2 py-8">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 opacity-30">
                <path d="M12 3C6.486 3 2 6.691 2 11.25c0 2.444 1.198 4.639 3.107 6.176-.178 1.07-.567 2.09-1.107 3.09.1.003.1.003.2.187a.5.5 0 0 0 .458.297h.042a14.16 14.16 0 0 0 4.4-1.6c.986.267 2.014.4 3 .4 5.514 0 10-3.691 10-8.25S17.514 3 12 3Z" />
              </svg>
              <p className="text-sm text-center px-4">Ask about this ticket, get investigation steps, or draft a customer response.</p>
            </div>
          )}

          {visibleMessages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-violet-600 text-white whitespace-pre-wrap"
                  : "bg-white border border-slate-200 text-slate-800"
              }`}>
                {m.role === "user" ? (
                  getTextFromMessage(m)
                ) : (
                  <>
                    <div className="prose prose-sm prose-slate max-w-none prose-p:my-1 prose-headings:mb-1 prose-headings:mt-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-1 prose-code:text-violet-700 prose-code:bg-violet-50 prose-code:px-1 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {getTextFromMessage(m)}
                      </ReactMarkdown>
                    </div>
                    {onSaveAsNote && (
                      <button
                        onClick={() => handleSaveMessage(m)}
                        className="mt-2 text-xs text-slate-400 hover:text-violet-700 transition-colors flex items-center gap-1"
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                          <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5V2Z" />
                        </svg>
                        Save as note
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5">
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </span>
              </div>
            </div>
          )}

          {error && !notConfigured && (
            <p className="text-xs text-red-500 text-center px-2">{error.message ?? "Something went wrong."}</p>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Template panel */}
        {templatesOpen && (
          <div className="shrink-0 mb-2 max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50">
            <div className="p-2 space-y-3">
              {TEMPLATE_CATEGORIES.map((cat) => (
                <div key={cat.key}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 px-1 mb-1">
                    {cat.icon} {cat.key}
                  </p>
                  <div className="space-y-0.5">
                    {cat.prompts.map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => handleTemplateClick(prompt)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-slate-200 text-slate-700 transition-colors"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="flex gap-2 pt-3 border-t border-slate-200 shrink-0">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            placeholder="Ask about this ticket…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="shrink-0 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg px-3 py-2 transition-colors"
            title="Send"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M.989 8 .064 2.68a1.342 1.342 0 0 1 1.85-1.462l13 5.5a1.343 1.343 0 0 1 0 2.563l-13 5.5a1.342 1.342 0 0 1-1.85-1.463L.988 8Zm.561-5.295.921 4.95H7.5a.75.75 0 0 1 0 1.5H1.47l-.92 4.95L13.5 8 1.55 2.705Z" />
            </svg>
          </button>
        </form>
        <div className="mt-1.5 shrink-0">
          <button
            onClick={() => setTemplatesOpen((o) => !o)}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
              <path d="M2.5 3A1.5 1.5 0 0 0 1 4.5v.793c.026.009.051.02.076.032L7.674 8.51c.206.1.446.1.652 0l6.598-3.185A.755.755 0 0 1 15 5.293V4.5A1.5 1.5 0 0 0 13.5 3h-11Z" />
              <path d="M15 6.954 8.978 9.86a2.25 2.25 0 0 1-1.956 0L1 6.954V11.5A1.5 1.5 0 0 0 2.5 13h11a1.5 1.5 0 0 0 1.5-1.5V6.954Z" />
            </svg>
            {templatesOpen ? "Hide templates" : "Templates"}
          </button>
        </div>
      </div>
    </>
  );
}
