"use client";

import { useTranslations } from "next-intl";
import type { TicketType } from "@/lib/types";

const colours: Record<TicketType, string> = {
  bug:         "bg-red-50 text-red-600 border border-red-200",
  feature:     "bg-violet-50 text-violet-700 border border-violet-200",
  question:    "bg-sky-50 text-sky-700 border border-sky-200",
  improvement: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  task:        "bg-slate-50 text-slate-600 border border-slate-200",
};

const icons: Record<TicketType, string> = {
  bug:         "🐛",
  feature:     "✨",
  question:    "❓",
  improvement: "⬆️",
  task:        "✅",
};

export default function TicketTypeBadge({ type }: { type: TicketType | null | undefined }) {
  const t = useTranslations("ticketType");
  if (!type) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${colours[type]}`}>
      <span>{icons[type]}</span>
      {t(type)}
    </span>
  );
}
