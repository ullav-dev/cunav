"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isAdmin } from "@/lib/auth-api";
import {
  adminListTeams,
  adminListTeamProducts,
  adminEnableTeamProduct,
  adminGetTeam,
  adminAssignProductRole,
  adminRevokeProductRole,
  type AdminTeamSummary,
  type AdminTeamMember,
  type TeamProductAccess,
} from "@/lib/auth-api";
import { useRouter } from "@/i18n/navigation";

const PRODUCT_SLUG = "cunav";
const SUPPORT_ROLE = "support";

interface TeamRow {
  team: AdminTeamSummary;
  products: TeamProductAccess[];
  loading: boolean;
}

interface MemberRow {
  member: AdminTeamMember;
  teamId: string;
  loading: boolean;
}

function displayName(m: AdminTeamMember): string {
  const full = [m.user.first_name, m.user.last_name].filter(Boolean).join(" ");
  return full || m.user.username;
}

export default function AccessPage() {
  const { token } = useAuth();
  const router = useRouter();

  // ── Team product access ──────────────────────────────────────────────────────
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Support dispatchers ──────────────────────────────────────────────────────
  const [memberRows, setMemberRows] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    if (!isAdmin(token)) router.replace("/tickets");
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

      // Load members of cunav-enabled teams for support role management.
      const enabledTeams = withProducts.filter((r) =>
        r.products.some((p) => p.product_slug === PRODUCT_SLUG)
      );
      if (enabledTeams.length > 0) {
        setMembersLoading(true);
        const allMembers: MemberRow[] = [];
        await Promise.all(
          enabledTeams.map(async ({ team }) => {
            const detail = await adminGetTeam(token, team.id).catch(() => null);
            if (!detail) return;
            for (const member of detail.members) {
              if (member.status === "active") {
                allMembers.push({ member, teamId: team.id, loading: false });
              }
            }
          })
        );
        setMemberRows(allMembers);
        setMembersLoading(false);
      }
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
      // Reload members now that a new team is enabled.
      load();
    } catch {
      setRows((prev) => prev.map((r) => r.team.id === teamId ? { ...r, loading: false } : r));
    }
  }

  async function handleToggleSupport(row: MemberRow) {
    if (!token) return;
    const isSupport = row.member.product_roles?.[PRODUCT_SLUG] === SUPPORT_ROLE;
    setMemberRows((prev) =>
      prev.map((r) =>
        r.member.id === row.member.id && r.teamId === row.teamId ? { ...r, loading: true } : r
      )
    );
    try {
      if (isSupport) {
        await adminRevokeProductRole(token, row.teamId, row.member.user.id, PRODUCT_SLUG);
        setMemberRows((prev) =>
          prev.map((r) =>
            r.member.id === row.member.id && r.teamId === row.teamId
              ? { ...r, loading: false, member: { ...r.member, product_roles: { ...r.member.product_roles, [PRODUCT_SLUG]: "" } } }
              : r
          )
        );
      } else {
        await adminAssignProductRole(token, row.teamId, row.member.user.id, PRODUCT_SLUG, SUPPORT_ROLE);
        setMemberRows((prev) =>
          prev.map((r) =>
            r.member.id === row.member.id && r.teamId === row.teamId
              ? { ...r, loading: false, member: { ...r.member, product_roles: { ...r.member.product_roles, [PRODUCT_SLUG]: SUPPORT_ROLE } } }
              : r
          )
        );
      }
    } catch {
      setMemberRows((prev) =>
        prev.map((r) =>
          r.member.id === row.member.id && r.teamId === row.teamId ? { ...r, loading: false } : r
        )
      );
    }
  }

  const hasProduct = (row: TeamRow) => row.products.some((p) => p.product_slug === PRODUCT_SLUG);
  const supportMembers = memberRows.filter((r) => r.member.product_roles?.[PRODUCT_SLUG] === SUPPORT_ROLE);
  const teamName = (teamId: string) => rows.find((r) => r.team.id === teamId)?.team.name ?? teamId;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-slate-200 bg-white px-6 py-4 shrink-0">
        <h1 className="text-xl font-bold text-slate-900">Access management</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage Cunav team access and support dispatcher roles</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
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
          <>
            {/* ── Section 1: Team product access ──────────────────────────── */}
            <section>
              <div className="mb-3">
                <h2 className="text-base font-semibold text-slate-800">Team access</h2>
                <p className="text-sm text-slate-500">Enable Cunav for each team whose members should have access.</p>
              </div>
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
            </section>

            {/* ── Section 2: Support dispatchers ──────────────────────────── */}
            <section>
              <div className="mb-3">
                <h2 className="text-base font-semibold text-slate-800">Support dispatchers</h2>
                <p className="text-sm text-slate-500">
                  Members with the <span className="font-medium text-violet-700">Support</span> role can send tickets to any Togra project, not just their own team&apos;s.
                  The user must re-login after a role change for it to take effect.
                </p>
              </div>

              {supportMembers.length > 0 && (
                <div className="max-w-2xl mb-3 p-3 bg-violet-50 border border-violet-200 rounded-xl">
                  <p className="text-xs font-semibold text-violet-700 mb-2">Current support dispatchers</p>
                  <div className="flex flex-wrap gap-2">
                    {supportMembers.map((r) => (
                      <span key={`${r.teamId}-${r.member.id}`} className="inline-flex items-center gap-1.5 text-xs bg-white border border-violet-200 text-violet-800 px-2.5 py-1 rounded-full">
                        <span className="w-4 h-4 rounded-full bg-violet-100 text-violet-700 text-[9px] font-bold flex items-center justify-center">
                          {displayName(r.member).charAt(0).toUpperCase()}
                        </span>
                        {displayName(r.member)}
                        <span className="text-violet-400">·</span>
                        <span className="text-violet-500">{teamName(r.teamId)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {membersLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
                  <div className="w-4 h-4 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
                  Loading members…
                </div>
              ) : memberRows.length === 0 ? (
                <p className="text-sm text-slate-400">Enable Cunav for at least one team to manage support roles.</p>
              ) : (
                <div className="max-w-2xl space-y-2">
                  {memberRows.map((row) => {
                    const isSupport = row.member.product_roles?.[PRODUCT_SLUG] === SUPPORT_ROLE;
                    return (
                      <div key={`${row.teamId}-${row.member.id}`} className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center shrink-0">
                            {displayName(row.member).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800">{displayName(row.member)}</p>
                            <p className="text-xs text-slate-400 truncate">{row.member.user.email} · {teamName(row.teamId)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-4">
                          {isSupport && (
                            <span className="text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full">
                              Support
                            </span>
                          )}
                          <button
                            onClick={() => handleToggleSupport(row)}
                            disabled={row.loading}
                            className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                              isSupport
                                ? "text-red-600 border-red-200 hover:border-red-400 hover:bg-red-50"
                                : "text-violet-700 border-violet-300 hover:border-violet-500 hover:bg-violet-50"
                            }`}
                          >
                            {row.loading ? "Saving…" : isSupport ? "Remove support" : "Assign support"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
