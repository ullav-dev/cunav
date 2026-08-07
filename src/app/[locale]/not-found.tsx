"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** Rendered inside the locale layout (nav/footer already wrap it) for any
 *  path with a valid locale prefix that doesn't match a page — a typo'd
 *  URL, stale bookmark, or dead cross-app link. Without this, Next falls
 *  back to the root not-found (see ../not-found.tsx), which bypasses this
 *  layout entirely and throws "Missing <html> and <body> tags". */
export default function LocaleNotFound() {
  const t = useTranslations("notFoundPage");

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
      <p className="text-slate-500">{t("message")}</p>
      <Link href="/tickets" className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700">
        {t("backHome")}
      </Link>
    </div>
  );
}
