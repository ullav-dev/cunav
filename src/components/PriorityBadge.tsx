"use client";

import { useTranslations } from "next-intl";
import type { Priority } from "@/lib/types";

const colours: Record<Priority, string> = {
  critical: "bg-red-100 text-red-700 border border-red-200",
  high:     "bg-orange-100 text-orange-700 border border-orange-200",
  medium:   "bg-amber-100 text-amber-700 border border-amber-200",
  low:      "bg-slate-100 text-slate-500 border border-slate-200",
};

export default function PriorityBadge({ priority }: { priority: Priority | null | undefined }) {
  const t = useTranslations("priority");
  if (!priority) return null;
  return (
    <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${colours[priority]}`}>
      {t(priority)}
    </span>
  );
}
