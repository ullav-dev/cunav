"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import type { AuthUser, LoginResponse } from "@/lib/auth-api";
import { login as apiLogin, hasCunavAccess } from "@/lib/auth-api";

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  roles: string[];
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResponse>;
  logout: () => void;
  setSession: (session: { token: string; user: AuthUser; roles: string[] }) => void;
  updateUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  token: null,
  roles: [],
  isLoading: true,
  login: async () => { throw new Error("AuthProvider not mounted"); },
  logout: () => {},
  setSession: () => {},
  updateUser: () => {},
});

const STORAGE_KEY = "cunav_auth";
const IDLE_MS = Number(process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MS ?? 3_600_000);
const WARN_BEFORE_MS = 60_000;
const ACTIVITY_EVENTS = ["mousemove", "keydown", "pointerdown", "scroll", "touchstart"] as const;

function IdleWarningModal({ onStay, onLogout }: { onStay: () => void; onLogout: () => void }) {
  const t = useTranslations("idleWarning");
  const [seconds, setSeconds] = useState(Math.round(WARN_BEFORE_MS / 1000));
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <h2 className="text-base font-semibold text-slate-800 mb-2">{t("title")}</h2>
        <p className="text-sm text-slate-600 mb-5">{t("message", { seconds })}</p>
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={onLogout} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">
            {t("logoutNow")}
          </button>
          <button type="button" onClick={onStay} className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white transition-colors">
            {t("stayLoggedIn")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [idleWarning, setIdleWarning] = useState(false);

  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleWarningRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { user: AuthUser; token: string; roles?: string[] };
        if (!parsed.roles) {
          localStorage.removeItem(STORAGE_KEY);
        } else {
          setUser(parsed.user);
          setToken(parsed.token);
          setRoles(parsed.roles);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    setRoles([]);
    setIdleWarning(false);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const setSession = useCallback((session: { token: string; user: AuthUser; roles: string[] }) => {
    setUser(session.user);
    setToken(session.token);
    setRoles(session.roles);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, []);

  const updateUser = useCallback((updated: AuthUser) => {
    setUser(updated);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, user: updated }));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    idleWarningRef.current = false;
    setIdleWarning(false);
    warnTimerRef.current = setTimeout(() => {
      setIdleWarning(true);
      idleWarningRef.current = true;
      logoutTimerRef.current = setTimeout(() => logout(), WARN_BEFORE_MS);
    }, IDLE_MS - WARN_BEFORE_MS);
  }, [logout]);

  useEffect(() => {
    if (!token) return;
    resetIdleTimer();
    const handler = () => { if (!idleWarningRef.current) resetIdleTimer(); };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, handler));
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    };
  }, [token, resetIdleTimer]);

  const login = useCallback(async (email: string, password: string): Promise<LoginResponse> => {
    const resp = await apiLogin(email, password);
    if (!hasCunavAccess(resp.token)) {
      throw new Error("no_cunav_access");
    }
    setSession({ token: resp.token, user: resp.user, roles: resp.roles });
    return resp;
  }, [setSession]);

  return (
    <AuthContext.Provider value={{ user, token, roles, isLoading, login, logout, setSession, updateUser }}>
      {children}
      {idleWarning && (
        <IdleWarningModal
          onStay={() => { setIdleWarning(false); idleWarningRef.current = false; resetIdleTimer(); }}
          onLogout={logout}
        />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
