// Server-side (route handlers, AI outcome executors) helper for writing
// notes to tack-server -- the automated-note-writer counterpart to
// components/notes/NotesPanel.tsx's browser-side createTackNotesApi("/api/
// tack", token). Server code has no browser proxy to go through, so this
// calls tack-server directly.
// Deliberately imports the package's api submodule directly, not its root
// barrel (`@ullav-dev/tack-notes`) -- the barrel also re-exports
// TackNoteThread/TackNotesPanel (React/JSX), which this server-only module
// has no use for and which Jest's transform (unlike Next's own build) can't
// process out of node_modules, breaking every test that imports this file
// transitively.
import { createTackNotesApi, type TackNotesApi } from "@ullav-dev/tack-notes/src/api";

const TACK_URL = process.env.TACK_URL ?? "http://localhost:8087";

/** Same entity identity the Phase 2 backfill script attached historical
 *  notes under, and NotesPanel.tsx's own OWNING_SERVICE -- must never
 *  drift, or these notes stop showing up in a ticket's notes panel. */
export const OWNING_SERVICE = "awe";

/** The system principal label every cunav automated note-writer attributes
 *  to, once one exists for a given organization -- an admin/ops
 *  provisioning action (see tack-server's `POST /system-principals`),
 *  same class of task as enabling the `tack` product for a team. Until
 *  that's done for a given organization, resolveAiPrincipalId returns
 *  undefined and the note is created under the calling service account's
 *  own id instead (tack-server's create_note already falls back the same
 *  way for any non-admin caller with no resolvable principal) -- never a
 *  hard failure either way. */
const AI_PRINCIPAL_LABEL = "cunav AI Assistant";

export function tackNotesApi(token: string): TackNotesApi {
  return createTackNotesApi(TACK_URL, token);
}

// Per-organization, process-lifetime cache -- system principals are
// admin-provisioned and essentially never change at request rate, so
// there's no need to re-list them on every single note write.
const principalCache = new Map<string, string | null>();

export async function resolveAiPrincipalId(api: TackNotesApi, organizationId: string | null): Promise<string | undefined> {
  if (!organizationId) return undefined;
  if (principalCache.has(organizationId)) return principalCache.get(organizationId) ?? undefined;
  try {
    const page = await api.listSystemPrincipals(organizationId, { limit: 100 });
    const found = page.principals.find((p) => p.label === AI_PRINCIPAL_LABEL)?.id ?? null;
    principalCache.set(organizationId, found);
    return found ?? undefined;
  } catch {
    // Non-fatal: the note still gets created, just attributed to the
    // service account's own id instead of a resolvable bot identity.
    return undefined;
  }
}

export function workflowAttachment(ticketId: string) {
  return { owning_service: OWNING_SERVICE, entity_type: "workflow", entity_id: ticketId } as const;
}
