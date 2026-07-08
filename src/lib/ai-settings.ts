import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export type AiProvider = "anthropic" | "openai" | "google" | "mistral" | "ollama";

// Personal (BYOK) AI settings for the interactive Triage chat panel. Stored in
// ullav-user-management, scoped to this app via `?app=cunav` (see
// src/app/api/ai/settings/route.ts) — separate from the deployment-wide
// provider keys (ANTHROPIC_API_KEY etc.) that power the AI-enabled-queue
// triage webhook, which has no signed-in user to own a personal key.
export interface AiSettings {
  provider: AiProvider;
  model: string;
  ollamaUrl?: string;
  encryptedKey?: string;
  iv?: string;
  authTag?: string;
}

const ENC_KEY = Buffer.from(
  (process.env.SETTINGS_ENCRYPTION_KEY ?? "cunav-dev-key-change-in-production!!")
    .padEnd(32, "0")
    .slice(0, 32),
);

export function encryptKey(plaintext: string): { encryptedKey: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedKey: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptKey(encryptedKey: string, iv: string, authTag: string): string {
  const decipher = createDecipheriv("aes-256-gcm", ENC_KEY, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedKey, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function usernameFromBearer(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    return (payload.sub as string) || (payload.username as string) || null;
  } catch {
    return null;
  }
}

export const PROVIDER_MODELS: Record<AiProvider, { label: string; value: string }[]> = {
  anthropic: [
    { label: "Claude Haiku 4.5 (fast)", value: "claude-haiku-4-5-20251001" },
    { label: "Claude Sonnet 4.6 (recommended)", value: "claude-sonnet-4-6" },
    { label: "Claude Opus 4.8 (most capable)", value: "claude-opus-4-8" },
  ],
  openai: [
    { label: "GPT-4o Mini (fast)", value: "gpt-4o-mini" },
    { label: "GPT-4o (recommended)", value: "gpt-4o" },
    { label: "GPT-4 Turbo", value: "gpt-4-turbo" },
  ],
  google: [
    { label: "Gemini 2.0 Flash (recommended)", value: "gemini-2.0-flash" },
    { label: "Gemini 2.5 Pro (most capable)", value: "gemini-2.5-pro" },
    { label: "Gemini 2.0 Flash Lite (fast)", value: "gemini-2.0-flash-lite" },
  ],
  mistral: [
    { label: "Mistral Large (recommended)", value: "mistral-large-latest" },
    { label: "Mistral Small (fast)", value: "mistral-small-latest" },
    { label: "Mistral Nemo (open)", value: "open-mistral-nemo" },
  ],
  ollama: [],
};
