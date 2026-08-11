// Typed wrappers for ullav-user-management. Requests go via /auth-api/* rewrite in the browser.

const BASE =
  typeof window === "undefined"
    ? (process.env.AUTH_URL ?? "http://localhost:8081")
    : "/auth-api";

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
  roles: string[];
  permissions: string[];
}

async function authRequest<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    ...init,
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status === 204 || !contentType.includes("application/json")) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return undefined as T;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? data.message ?? data.detail ?? `HTTP ${res.status}`);
  return data as T;
}

function decodePayload(token: string): Record<string, unknown> | null {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

export const login = (email: string, password: string): Promise<LoginResponse> =>
  authRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const requestPasswordReset = (
  email: string,
  app_url?: string
): Promise<{ reset_token?: string; message?: string }> =>
  authRequest("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email, ...(app_url ? { app_url } : {}) }),
  });

export const confirmPasswordReset = (token: string, new_password: string): Promise<void> =>
  authRequest("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify({ token, new_password }),
  });

// ── Team-level product access ─────────────────────────────────────────────────

export interface TeamClaim {
  name: string;
  role: string;
  team_roles: string[];
  product_roles: Record<string, string>;
  products: string[];
  /** Already present on the wire (every team claim carries its own
   * organization_id) -- just not previously declared here. Needed to
   * resolve which tack-server organization a team's system principals
   * belong to (see getTackTeamIds's own doc comment). */
  organization_id?: string;
}

export function getTeamClaims(token: string | null): Record<string, TeamClaim> {
  if (!token) return {};
  const payload = decodePayload(token);
  if (!payload) return {};
  return (payload.teams ?? {}) as Record<string, TeamClaim>;
}

export function hasCunavAccess(token: string | null): boolean {
  const teams = getTeamClaims(token);
  return Object.values(teams).some(
    (t) => (t.products ?? []).includes("cunav"),
  );
}

/** Mirrors `hasCunavAccess` -- true if any of the caller's teams has the
 * `tack` product slug enabled. Gates the tack-notes cutover: a team must be
 * Tack-enabled in ullav-user-management (an ops task, not app code) before
 * its notes traffic can move off awe-server's own notes API. */
export function hasTackAccess(token: string | null): boolean {
  const teams = getTeamClaims(token);
  return Object.values(teams).some(
    (t) => (t.products ?? []).includes("tack"),
  );
}

export function getCunavTeamIds(token: string | null): string[] {
  const teams = getTeamClaims(token);
  return Object.entries(teams)
    .filter(([, t]) => (t.products ?? []).includes("cunav"))
    .map(([id]) => id);
}

/** Mirrors `getCunavTeamIds`. Tack-server notes need a `team_id` to file
 * under (unlike awe-server's own notes API, which resolves the caller's
 * team implicitly server-side) -- `NotesPanel` uses the first of these as
 * the operative team for new notes/folders it creates. */
export function getTackTeamIds(token: string | null): string[] {
  const teams = getTeamClaims(token);
  return Object.entries(teams)
    .filter(([, t]) => (t.products ?? []).includes("tack"))
    .map(([id]) => id);
}

export function hasObairAccess(token: string | null): boolean {
  return Object.values(getTeamClaims(token)).some(
    (t) => (t.products ?? []).includes("obair"),
  );
}

/** True if the user has product_roles.cunav === "support" in any team — grants cross-team Togra dispatch. */
export function hasSupportRole(token: string | null): boolean {
  return Object.values(getTeamClaims(token)).some(
    (t) => (t.product_roles ?? {})["cunav"] === "support",
  );
}

/** Team IDs where both cunav and obair are enabled — required for creating queues/tickets in awe-server. */
export function getAweTeamIds(token: string | null): string[] {
  return Object.entries(getTeamClaims(token))
    .filter(([, t]) => (t.products ?? []).includes("obair"))
    .map(([id]) => id);
}

export function hasTograAccess(token: string | null): boolean {
  return Object.values(getTeamClaims(token)).some(
    (t) => (t.products ?? []).includes("togra"),
  );
}

export interface SupportTeam {
  id: string;
  slug: string;
  name: string;
}

/** Resolves "the team that owns every cunav ticket queue" — see
 *  ullav-user-management's `teams.is_support_team` flag, set via its
 *  admin TeamsPanel. No id/name is ever hardcoded on the cunav side.
 *  `organizationId` is currently always omitted (resolves the default,
 *  org-less bucket) since cunav hasn't adopted multi-tenancy — pass it once
 *  cunav gains an organization context to resolve per-tenant instead.
 *  Returns `null`, not a thrown error, if no team is flagged yet — a real,
 *  expected state (e.g. a fresh deployment) that callers must handle. */
export async function getSupportTeam(
  token: string | null,
  organizationId?: string
): Promise<SupportTeam | null> {
  if (!token) return null;
  const qs = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : "";
  // Not routed through authRequest: a 404 here is a real, expected "none
  // configured yet" state, not an error to throw — UUM's NotFound variant
  // also returns the same generic {"error":"user not found"} body used by
  // every other 404 in that codebase, so status code is the only reliable
  // way to distinguish it from an actual failure.
  const res = await fetch(`${BASE}/teams/support${qs}`, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    // 400 here means UUM found more than one organization's Support team and
    // needs organizationId to disambiguate (see get_support_team's
    // SupportTeamLookup::Ambiguous) — surface its actual message rather than
    // a bare status code, since "which org" is real, actionable information.
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Failed to resolve Support team: HTTP ${res.status}`);
  }
  return res.json() as Promise<SupportTeam>;
}

export function isAdmin(token: string | null): boolean {
  if (!token) return false;
  const payload = decodePayload(token);
  if (!payload) return false;
  return ((payload.roles ?? []) as string[]).includes("admin");
}

// ── Admin API ─────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  roles: string[];
  created_at: string;
}

export interface AdminUsersPage {
  users: AdminUser[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminTeamUser {
  id: string;
  username: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

export interface AdminTeamMember {
  id: string;
  user: AdminTeamUser;
  status: string;
  role: string;
  product_roles: Record<string, string>;
  joined_at: string | null;
}

export interface AdminTeam {
  id: string;
  name: string;
  description: string | null;
  owner: AdminTeamUser;
  members: AdminTeamMember[];
}

export interface AdminTeamSummary {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
}

export interface AdminTeamsPage {
  teams: AdminTeamSummary[];
  total: number;
}

export interface TeamProductAccess {
  product_slug: string;
  product_name: string;
  granted_at: string;
}

export const adminListUsers = (token: string, pageSize = 200): Promise<AdminUsersPage> =>
  authRequest(`/admin/users?page=1&page_size=${pageSize}`, {}, token);

export const adminListTeams = (token: string, pageSize = 200): Promise<AdminTeamsPage> =>
  authRequest(`/admin/teams?page=1&page_size=${pageSize}`, {}, token);

export const adminGetTeam = (token: string, teamId: string): Promise<AdminTeam> =>
  authRequest(`/admin/teams/${teamId}`, {}, token);

export const adminListTeamProducts = (token: string, teamId: string): Promise<TeamProductAccess[]> =>
  authRequest(`/admin/teams/${teamId}/products`, {}, token);

export const adminEnableTeamProduct = (token: string, teamId: string, slug: string): Promise<TeamProductAccess[]> =>
  authRequest(`/admin/teams/${teamId}/products/${slug}`, { method: "POST" }, token);

export const adminAddTeamMember = (token: string, teamId: string, userId: string): Promise<AdminTeam> =>
  authRequest(`/admin/teams/${teamId}/members`, { method: "POST", body: JSON.stringify({ user_id: userId }) }, token);

export const adminRemoveTeamMember = (token: string, teamId: string, userId: string): Promise<void> =>
  authRequest(`/admin/teams/${teamId}/members/${userId}`, { method: "DELETE" }, token);

export const adminAssignProductRole = (token: string, teamId: string, userId: string, slug: string, role: string): Promise<void> =>
  authRequest(`/admin/teams/${teamId}/members/${userId}/product-roles/${slug}`, { method: "POST", body: JSON.stringify({ role }) }, token);

export const adminRevokeProductRole = (token: string, teamId: string, userId: string, slug: string): Promise<void> =>
  authRequest(`/admin/teams/${teamId}/members/${userId}/product-roles/${slug}`, { method: "DELETE" }, token);

// ── Profile ───────────────────────────────────────────────────────────────────

export const getMe = (token: string): Promise<AuthUser> =>
  authRequest("/users/me", {}, token);

export interface UpdateProfilePayload {
  first_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
}

export const updateProfile = (token: string, data: UpdateProfilePayload): Promise<AuthUser> =>
  authRequest("/users/me", { method: "PATCH", body: JSON.stringify(data) }, token);

// ── Public identity resolution ──────────────────────────────────────────────

export interface ResolvedUser {
  id: string;
  username: string;
  avatar_url: string | null;
  first_name: string | null;
  last_name: string | null;
}

/** Resolve a batch of user ids to their public username/avatar/display-name
 *  fields. Ids with no matching row are simply omitted from the result. */
export const resolveUsers = (token: string, ids: string[]): Promise<ResolvedUser[]> =>
  authRequest(`/users/resolve?ids=${ids.map(encodeURIComponent).join(",")}`, {}, token);

/** Resolves one internal user's email — separate from resolveUsers above,
 *  which deliberately never returns email. Requires cunav product access
 *  (any team); lets an agent email a ticket's internal reporter the same
 *  way "Send as email" already can an external one. See UUM's
 *  GET /users/{id}/email. */
export const getUserEmail = (token: string, userId: string): Promise<{ email: string }> =>
  authRequest(`/users/${encodeURIComponent(userId)}/email`, {}, token);

export async function gravatarUrl(email: string, size = 200): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const hash = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `https://gravatar.com/avatar/${hash}?d=identicon&s=${size}`;
}
