"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { hasCunavAccess } from "@/lib/auth-api";
import type { AuthUser } from "@/lib/auth-api";
import CunavIcon from "@/components/CunavIcon";

export default function SsoPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setSession } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = searchParams.get("t");
    if (!raw) { setError("No SSO token provided."); return; }
    try {
      const parsed = JSON.parse(decodeURIComponent(raw)) as {
        token: string;
        user: AuthUser;
        roles: string[];
      };
      if (!parsed.token || !parsed.user) throw new Error("Invalid SSO payload");
      if (!hasCunavAccess(parsed.token)) {
        setError("Your account does not have access to Cunav. Ask your team owner to enable Cunav for your team.");
        return;
      }
      setSession({ token: parsed.token, user: parsed.user, roles: parsed.roles ?? [] });
      router.replace("/tickets");
    } catch {
      setError("Invalid SSO session. Please log in again.");
    }
  }, [searchParams, setSession, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 via-white to-slate-50">
      <div className="text-center space-y-4">
        <CunavIcon className="w-12 h-12 mx-auto" />
        {error ? (
          <div className="max-w-sm">
            <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3 border border-red-200">{error}</p>
            <Link href="/en/login" className="block mt-3 text-sm text-violet-700 hover:text-violet-800 font-medium">
              Back to login
            </Link>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Signing you in…</p>
        )}
      </div>
    </div>
  );
}
