"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/auth-api";
import {
  adminListTeams,
  adminListTeamProducts,
  adminEnableTeamProduct,
  type AdminTeamSummary,
  type TeamProductAccess,
} from "@/lib/auth-api";
import { useRouter } from "@/i18n/navigation";

const PRODUCT_SLUG = "cunav";

interface TeamRow {
  team: AdminTeamSummary;
  products: TeamProductAccess[];
  loading: boolean;
}

export default function AccessPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    if (!isAdmin(token)) { router.replace("/tickets"); }
  }, [token, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const page = await adminListTeams(token);
      const withProducts = await Promise.all(
        page.teams.map(async (team) => {
          const products = await adminListTeamProducts(token, team.id).catch(() => [] as TeamProductAccess[]);
          return { team, products, loading: false };
        })
      );
      setRows(withProducts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function handleEnable(teamId: string) {
    if (!token) return;
    setRows((prev) => prev.map((r) => r.team.id === teamId ? { ...r, loading: true } : r));
    try {
      const products = await adminEnableTeamProduct(token, teamId, PRODUCT_SLUG);
      setRows((prev) => prev.map((r) => r.team.id === teamId ? { ...r, products, loading: false } : r));
    } catch {
      setRows((prev) => prev.map((r) => r.team.id === teamId ? { ...r, loading: false } : r));
    }
  }

  const hasProduct = (row: TeamRow) =>
    row.products.some((p) => p.product_slug === PRODUCT_SLUG);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-slate-200 bg-white px-6 py-4 shrink-0">
        <h1 className="text-xl font-bold text-slate-900">Access management</h1>
        <p className="text-sm text-slate-500 mt-0.5">Enable Cunav access per team</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={load} className="mt-2 text-sm text-violet-700 hover:underline">Retry</button>
          </div>
        ) : (
          <div className="max-w-2xl space-y-2">
            {rows.map(({ team, products, loading: rowLoading }) => {
              const enabled = products.some((p) => p.product_slug === PRODUCT_SLUG);
              return (
                <div key={team.id} className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{team.name}</p>
                    {team.description && <p className="text-xs text-slate-400 mt-0.5">{team.description}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">{team.member_count} member{team.member_count !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {enabled ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2.5 py-1 rounded-full">
                        <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                          <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z"/>
                        </svg>
                        Enabled
                      </span>
                    ) : (
                      <button
                        onClick={() => handleEnable(team.id)}
                        disabled={rowLoading}
                        className="text-xs font-medium text-violet-700 hover:text-violet-900 border border-violet-300 hover:border-violet-500 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {rowLoading ? "Enabling…" : "Enable Cunav"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
