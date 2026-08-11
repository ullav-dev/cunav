"use client";

// Thin cunav-specific wrapper around @ullav-dev/tack-notes's TackNotesPanel
// -- the entity-attached notes widget every AWE-based app's own NotesPanel
// actually needs (a thread per ticket, never a team-wide folder browse; see
// that package's own README). This *replaces* cunav's former awe-server-
// backed NotesPanel (git history has the old implementation) as part of the
// AWE-apps -> tack-notes migration; tack's own NoteThread/NoteTree UI is the
// reference, not a per-app rebuild.
//
// Everything cunav-specific lives here, not in the shared package:
// - resolveAuthor: system-principal lookup (for notes created going
//   forward, once the AI-triage/inbound-email webhooks are repointed at
//   tack-server too -- a separate, following PR) layered on top of the
//   original title/body-based fallbacks (AI_NOTE_TITLES, inbound-email
//   sender extraction) that every *historical* backfilled note still needs,
//   since those predate system_principals and keep their original
//   awe-service-account created_by forever.
// - owningService/entityType/entityId: matches the Phase 2 backfill
//   script's own content_attachments scope (owning_service="awe") exactly,
//   so historical notes and new notes created here both attach to the same
//   entity identity.
// - teamId: cunav has no team switcher, so this uses the first of the
//   caller's Tack-enabled teams (getTackTeamIds) -- correct for the common
//   single-team-per-tenant case this app is built around.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { getTackTeamIds, getTeamClaims, isAdmin as isAdminToken, resolveUsers, type ResolvedUser } from "@/lib/auth-api";
import { createTackNotesApi, TackNotesPanel, type Note as TackNote, type SystemPrincipal } from "@ullav-dev/tack-notes";
import type { NoteEntityType } from "@/lib/types";
import { AI_NOTE_TITLES, INBOUND_EMAIL_NOTE_TITLE } from "@/lib/types";

/** Same entity identity the Phase 2 backfill script attached historical
 * notes under -- see tack-server's backfill-awe-notes binary. Must never
 * drift from that value, or historical notes stop showing up here. */
const OWNING_SERVICE = "awe";

/** Pulls "Name <email>" back out of an inbound-email note's "*From: ...*"
 *  line (see src/app/api/email/inbound/route.ts's noteBody template) and
 *  formats it "Name (email)" — matching how a reporter is displayed
 *  elsewhere in cunav (tickets/[id]/page.tsx's reporterDisplay) — or just
 *  the bare email if no name was captured on the inbound side. */
function extractInboundSender(body: string | null | undefined): string | null {
  if (!body) return null;
  const match = /\*From: (.*?)<([^>]+)>\*/.exec(body);
  if (!match) return null;
  const name = match[1].trim();
  const email = match[2].trim();
  return name ? `${name} (${email})` : email;
}

interface NotesPanelProps {
  entityType: NoteEntityType;
  entityId: string;
  autoSelectFirst?: boolean;
  compact?: boolean;
  twoColumn?: boolean;
  /** Extra per-note action buttons (owner-gated actions like edit/delete
   *  stay inside TackNoteThread itself; this is for actions available
   *  regardless of ownership, e.g. cunav's "Send as email"). */
  renderNoteActions?: (note: TackNote) => ReactNode;
  /** Bump this (e.g. a timestamp) to trigger a background refetch — used by
   *  the parent's manual-refresh button / auto-refresh interval. */
  refreshSignal?: number;
}

export default function NotesPanel({ entityType, entityId, autoSelectFirst = false, compact = false, twoColumn = false, renderNoteActions, refreshSignal }: NotesPanelProps) {
  const { user, token } = useAuth();
  const t = useTranslations("notes");

  const api = useMemo(() => (token ? createTackNotesApi("/api/tack", token) : null), [token]);
  const teamId = useMemo(() => getTackTeamIds(token)[0] ?? null, [token]);
  const organizationId = useMemo(() => {
    if (!teamId) return null;
    return getTeamClaims(token)[teamId]?.organization_id ?? null;
  }, [token, teamId]);

  // System principals (real bot identities, e.g. "cunav AI Assistant") --
  // fetched once per organization. Only notes created *after* the
  // AI-triage/inbound-email webhooks are repointed at tack-server will
  // actually resolve through this map; see this file's own doc comment.
  const [principals, setPrincipals] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!api || !organizationId) return;
    let cancelled = false;
    api
      .listSystemPrincipals(organizationId, { limit: 100 })
      .then((page: { principals: SystemPrincipal[] }) => {
        if (cancelled) return;
        setPrincipals(Object.fromEntries(page.principals.map((p) => [p.id, p.label])));
      })
      .catch(() => {
        /* Non-fatal: system-authored notes just fall back to the other
         * resolution paths below. */
      });
    return () => {
      cancelled = true;
    };
  }, [api, organizationId]);

  // Roster resolution for ordinary human authors, lazily batched: each
  // not-yet-seen created_by encountered by resolveAuthor is queued, then
  // resolved in one request shortly after (rather than one request per
  // note per render).
  const [roster, setRoster] = useState<Record<string, ResolvedUser>>({});
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const pendingRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function queueRosterLookup(userId: string) {
    if (!token || rosterRef.current[userId] || pendingRef.current.has(userId)) return;
    pendingRef.current.add(userId);
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      const ids = Array.from(pendingRef.current);
      pendingRef.current.clear();
      flushTimerRef.current = null;
      resolveUsers(token, ids)
        .then((resolved) => {
          setRoster((prev) => ({ ...prev, ...Object.fromEntries(resolved.map((u) => [u.id, u])) }));
        })
        .catch(() => {
          /* Non-fatal: these authors just keep showing a truncated id. */
        });
    }, 150);
  }

  function resolveAuthor(userId: string, _teamId: string | null, note?: TackNote): string {
    if (note?.title && AI_NOTE_TITLES.includes(note.title)) return t("aiAuthor");
    if (note?.title === INBOUND_EMAIL_NOTE_TITLE) {
      const from = extractInboundSender(note.body_markdown);
      if (from) return from;
    }
    if (principals[userId]) return principals[userId];
    if (userId === user?.id) return user.username ?? t("you");
    const person = roster[userId];
    if (person) return `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || person.username;
    queueRosterLookup(userId);
    return `${userId.slice(0, 8)}…`;
  }

  if (!token || !api || !teamId) {
    return <div className="text-sm text-slate-400 py-6 text-center">{t("loading")}</div>;
  }

  return (
    <TackNotesPanel
      api={api}
      owningService={OWNING_SERVICE}
      entityType={entityType}
      entityId={entityId}
      teamId={teamId}
      currentUserId={user?.id ?? ""}
      isAdmin={isAdminToken(token)}
      resolveAuthor={resolveAuthor}
      t={t}
      editable
      showFolders
      compact={compact}
      twoColumn={twoColumn}
      autoSelectFirst={autoSelectFirst}
      defaultVisibility="team"
      showUnreadBadges
      refreshSignal={refreshSignal}
      renderNoteActions={renderNoteActions}
    />
  );
}
