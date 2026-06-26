"use client";

import { useTranslations } from "next-intl";

interface Props {
  isShared: boolean;
  onChange: (value: boolean) => void;
}

export default function VisibilityToggle({ isShared, onChange }: Props) {
  const t = useTranslations("visibility");
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={isShared}
        onClick={() => onChange(!isShared)}
        className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${isShared ? "bg-violet-500" : "bg-slate-300"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${isShared ? "translate-x-4" : "translate-x-0"}`} />
      </button>
      <span className="text-sm text-slate-600">
        {isShared ? (
          <span className="text-violet-700 font-medium">{t("shared")}</span>
        ) : (
          <span className="text-slate-500">{t("private")}</span>
        )}
      </span>
    </label>
  );
}
