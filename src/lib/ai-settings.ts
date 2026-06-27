export type AiProvider = "anthropic" | "openai" | "google" | "mistral" | "ollama";

export interface AiPreference {
  provider: AiProvider;
  model: string;
  ollamaUrl?: string;
}

const DEFAULT_PREF: AiPreference = {
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
};

const PREF_KEY = "cunav_ai_pref";

export function loadPreference(): AiPreference {
  if (typeof window === "undefined") return DEFAULT_PREF;
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) return { ...DEFAULT_PREF, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PREF;
}

export function savePreference(pref: AiPreference): void {
  localStorage.setItem(PREF_KEY, JSON.stringify(pref));
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
