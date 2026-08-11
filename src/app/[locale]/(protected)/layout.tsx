"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { hasCunavAccess } from "@/lib/auth-api";
import { NoteEventsProvider } from "@ullav-dev/tack-notes";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, token, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user || !token) { router.replace("/login"); return; }
    if (!hasCunavAccess(token)) { router.replace("/login?error=no_access"); }
  }, [user, token, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || !token || !hasCunavAccess(token)) return null;

  // Wraps every protected page, not just ticket detail -- NotesPanel's
  // (tack-notes) event bus needs exactly one shared provider per page tree,
  // and this is the one ancestor every NotesPanel usage already sits under.
  return <NoteEventsProvider>{children}</NoteEventsProvider>;
}
