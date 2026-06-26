"use client";

import { useTranslations } from "next-intl";
import type { Status } from "@/lib/types";

const colours: Record<string, string> = {
  "Not Started": "bg-slate-100 text-slate-500",
  "Ready":       "bg-cyan-100 text-cyan-700",
  "In Progress": "bg-blue-100 text-blue-700",
  "On Hold":     "bg-amber-100 text-amber-700",
  "Complete":    "bg-emerald-100 text-emerald-700",
  "Cancelled":   "bg-red-100 text-red-600",
};

export default function StatusPill({ status }: { status: Status | string }) {
  const t = useTranslations("status");
  const label = t.has(status as never) ? t(status as never) : status;
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${colours[status] ?? "bg-slate-100 text-slate-500"}`}>
      {label}
    </span>
  );
}
