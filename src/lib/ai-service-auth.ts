// Service-account auth for background AI processing (no end-user is present).
// Logs in as a dedicated bot account (CUNAV_AI_SERVICE_EMAIL/PASSWORD) via
// ullav-user-management and caches the JWT in memory until shortly before it expires.
import { login } from "./auth-api";

let cached: { token: string; expiresAtMs: number } | null = null;

function decodeExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : Date.now() + 5 * 60_000;
  } catch {
    return Date.now() + 5 * 60_000;
  }
}

/** Returns a bearer token for the AI service account, re-authenticating when expired
 *  or close to expiry (60s buffer). Throws if CUNAV_AI_SERVICE_EMAIL/PASSWORD are unset. */
export async function getAiServiceToken(): Promise<string> {
  if (cached && cached.expiresAtMs - Date.now() > 60_000) return cached.token;

  const email = process.env.CUNAV_AI_SERVICE_EMAIL;
  const password = process.env.CUNAV_AI_SERVICE_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "AI triage service account not configured. Set CUNAV_AI_SERVICE_EMAIL and CUNAV_AI_SERVICE_PASSWORD."
    );
  }

  const { token } = await login(email, password);
  cached = { token, expiresAtMs: decodeExpiry(token) };
  return token;
}
