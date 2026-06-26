"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { updateProfile, gravatarUrl } from "@/lib/auth-api";
import type { AuthUser } from "@/lib/auth-api";

interface Props {
  onClose: () => void;
}

function AvatarPreview({ url, initials }: { url: string; initials: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  if (!url || broken) {
    return (
      <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 text-lg font-semibold select-none">
        {initials}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt="Avatar preview"
      className="w-16 h-16 rounded-full object-cover"
      onError={() => setBroken(true)}
    />
  );
}

function userInitials(user: AuthUser): string {
  const first = user.first_name?.charAt(0) ?? "";
  const last = user.last_name?.charAt(0) ?? "";
  return (first + last).toUpperCase() || user.username.charAt(0).toUpperCase();
}

export default function MyDetailsModal({ onClose }: Props) {
  const { user, token, updateUser } = useAuth();
  const t = useTranslations("myDetails");

  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gravatarLoading, setGravatarLoading] = useState(false);

  if (!user || !token) return null;

  const initials = userInitials({
    ...user,
    first_name: firstName || null,
    last_name: lastName || null,
  });

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload: { first_name?: string | null; last_name?: string | null; avatar_url?: string | null } = {};
      if (firstName !== (user!.first_name ?? "")) payload.first_name = firstName || null;
      if (lastName !== (user!.last_name ?? "")) payload.last_name = lastName || null;
      const newAvatar = avatarUrl.trim() || null;
      if (newAvatar !== (user!.avatar_url ?? null)) payload.avatar_url = newAvatar;
      const updated = await updateProfile(token!, payload);
      updateUser(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleUseGravatar() {
    setGravatarLoading(true);
    try {
      const url = await gravatarUrl(user!.email);
      setAvatarUrl(url);
    } finally {
      setGravatarLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">{t("title")}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="flex items-center gap-4">
            <AvatarPreview url={avatarUrl.trim()} initials={initials} />
            <div className="flex-1 min-w-0">
              <label className="block text-xs font-medium text-slate-500 mb-1">{t("avatarUrl")}</label>
              <input
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://…"
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
              <div className="flex gap-2 mt-1.5">
                <button type="button" onClick={handleUseGravatar} disabled={gravatarLoading} className="text-xs text-violet-600 hover:text-violet-800 transition-colors disabled:opacity-50">
                  {gravatarLoading ? t("generating") : t("useGravatar")}
                </button>
                {avatarUrl && (
                  <button type="button" onClick={() => setAvatarUrl("")} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
                    {t("clear")}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t("firstName")}</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t("lastName")}</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("email")}</label>
            <input type="email" value={user.email} readOnly className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-slate-50 text-slate-500 cursor-default" />
            <p className="text-xs text-slate-400 mt-1">{t("emailNote")}</p>
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            {t("cancel")}
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-60">
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
