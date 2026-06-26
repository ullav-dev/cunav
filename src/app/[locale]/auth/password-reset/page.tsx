"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { confirmPasswordReset } from "@/lib/auth-api";
import CunavIcon from "@/components/CunavIcon";

export default function PasswordResetPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const resetToken = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setError(null);
    setLoading(true);
    try {
      await confirmPasswordReset(resetToken, password);
      setDone(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4"><CunavIcon className="w-12 h-12" /></div>
          <h1 className="text-xl font-bold text-slate-900">Reset your password</h1>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          {!resetToken ? (
            <p className="text-sm text-red-600">Invalid or expired reset link.</p>
          ) : done ? (
            <div className="text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-violet-100 flex items-center justify-center mx-auto">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-6 h-6 text-violet-600">
                  <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z"/>
                </svg>
              </div>
              <p className="text-sm text-slate-600">Password reset successfully. Redirecting to login…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">New password</label>
                <input
                  type="password" required minLength={8} value={password}
                  onChange={(e) => setPassword(e.target.value)} autoFocus
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirm password</label>
                <input
                  type="password" required minLength={8} value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <button
                type="submit" disabled={loading || !password || !confirm}
                className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
              >
                {loading ? "Resetting…" : "Set new password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
