"use client";

import { useTranslations } from "next-intl";
import CunavIcon from "@/components/CunavIcon";
import type { AuthUser } from "@/lib/auth-api";

interface Props {
  user: AuthUser | null;
  onClose: () => void;
}

export default function AboutModal({ user, onClose }: Props) {
  const t = useTranslations("about");

  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
  const gitSha = process.env.NEXT_PUBLIC_GIT_SHA ?? "dev";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="bg-violet-700 px-6 py-5 flex items-center gap-4">
          <CunavIcon className="w-10 h-10 shrink-0" />
          <div>
            <p className="font-bold text-xl text-white leading-tight">Cunav</p>
            <p className="text-violet-200 text-sm">{t("tagline")}</p>
          </div>
        </div>

        <div className="px-6 py-5">
          <dl className="divide-y divide-slate-100">
            <Row label={t("version")} value={`v${version}`} mono={false} />
            <Row label={t("build")} value={gitSha} mono />
            {user && <Row label={t("user")} value={user.username} mono={false} />}
            <EmailRow label={t("support")} email="support@ullav.com" />
            <EmailRow label={t("contact")} email="info@ullav.com" />
          </dl>
        </div>

        <div className="px-6 pb-5">
          <button type="button" onClick={onClose} className="w-full py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-medium text-slate-700 transition-colors">
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 gap-4">
      <dt className="text-sm text-slate-500 shrink-0">{label}</dt>
      <dd className={`text-sm font-medium text-slate-800 truncate text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}

function EmailRow({ label, email }: { label: string; email: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 gap-4">
      <dt className="text-sm text-slate-500 shrink-0">{label}</dt>
      <dd className="text-sm text-right">
        <a href={`mailto:${email}`} className="font-medium text-violet-700 hover:underline">{email}</a>
      </dd>
    </div>
  );
}
