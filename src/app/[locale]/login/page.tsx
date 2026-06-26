"use client";

import { useState } from "react";
import { useRouter, Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { requestPasswordReset } from "@/lib/auth-api";
import CunavIcon from "@/components/CunavIcon";
import LocaleSwitcher from "@/components/LocaleSwitcher";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const t = useTranslations("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotMode, setForgotMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      router.push("/tickets");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "error";
      if (msg === "no_cunav_access") setError(t("errors.noAccess"));
      else setError(t("errors.loginFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const appUrl = typeof window !== "undefined" ? window.location.origin : "";
      await requestPasswordReset(email, appUrl);
      setResetSent(true);
    } catch {
      setError(t("errors.resetFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-slate-50 flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <CunavIcon className="w-14 h-14" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Cunav</h1>
            <p className="text-slate-500 text-sm mt-1">{t("appTagline")}</p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            {!forgotMode ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t("emailLabel")}</label>
                  <input
                    type="email" required autoComplete="email" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t("passwordLabel")}</label>
                  <input
                    type="password" required autoComplete="current-password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                  />
                </div>
                {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                <button
                  type="submit" disabled={loading}
                  className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  {loading ? t("pleaseWait") : t("signIn")}
                </button>
                <button
                  type="button" onClick={() => { setForgotMode(true); setError(null); }}
                  className="w-full text-sm text-slate-500 hover:text-violet-700 text-center transition-colors"
                >
                  {t("forgotPassword")}
                </button>
              </form>
            ) : resetSent ? (
              <div className="text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center mx-auto">
                  <svg viewBox="0 0 16 16" fill="currentColor" className="w-6 h-6 text-violet-600">
                    <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z"/>
                  </svg>
                </div>
                <p className="text-sm text-slate-600">{t("checkInbox")}</p>
                <button onClick={() => { setForgotMode(false); setResetSent(false); }} className="text-sm text-violet-700 hover:text-violet-800 font-medium transition-colors">
                  {t("backToSignIn")}
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="space-y-4">
                <h2 className="text-base font-semibold text-slate-800">{t("resetPasswordTitle")}</h2>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">{t("emailLabel")}</label>
                  <input
                    type="email" required autoComplete="email" value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                  />
                </div>
                {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                <button
                  type="submit" disabled={loading}
                  className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
                >
                  {loading ? t("pleaseWait") : t("sendResetLink")}
                </button>
                <button
                  type="button" onClick={() => { setForgotMode(false); setError(null); }}
                  className="w-full text-sm text-slate-500 hover:text-violet-700 text-center transition-colors"
                >
                  {t("backToSignIn")}
                </button>
              </form>
            )}
          </div>

          <div className="mt-4 flex justify-center">
            <LocaleSwitcher />
          </div>
        </div>
      </div>
    </div>
  );
}
