"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { Ticket } from "@/lib/types";

interface Props {
  ticket?: Ticket;
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

export default function AiChatExplorer({ ticket }: Props) {
  const { token } = useAuth();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: ticket ? { ticketContext: buildTicketContext(ticket) } : {},
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, ticket?.id],
  );

  const { messages, sendMessage, status, error } = useChat({ transport });

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    sendMessage({ text });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 pb-2">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 opacity-30">
              <path d="M12 3C6.486 3 2 6.691 2 11.25c0 2.444 1.198 4.639 3.107 6.176-.178 1.07-.567 2.09-1.107 3.09.1.003.1.003.2.187a.5.5 0 0 0 .458.297h.042a14.16 14.16 0 0 0 4.4-1.6c.986.267 2.014.4 3 .4 5.514 0 10-3.691 10-8.25S17.514 3 12 3Z"/>
            </svg>
            <p className="text-sm text-center px-4">Ask about this ticket, get investigation steps, or draft a customer response.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === "user"
                ? "bg-violet-600 text-white"
                : "bg-white border border-slate-200 text-slate-800"
            }`}>
              {m.parts?.map((part, i) =>
                part.type === "text" ? <span key={i}>{part.text}</span> : null
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
        {error && (
          <p className="text-xs text-red-500 text-center px-2">
            {error.message ?? "Something went wrong."}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 pt-3 border-t border-slate-200 shrink-0">
        <input
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
            <path d="M.989 8 .064 2.68a1.342 1.342 0 0 1 1.85-1.462l13 5.5a1.343 1.343 0 0 1 0 2.563l-13 5.5a1.342 1.342 0 0 1-1.85-1.463L.988 8Zm.561-5.295.921 4.95H7.5a.75.75 0 0 1 0 1.5H1.47l-.92 4.95L13.5 8 1.55 2.705Z"/>
          </svg>
        </button>
      </form>
    </div>
  );
}
