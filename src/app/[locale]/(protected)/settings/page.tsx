"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/contexts/AuthContext";
import { PROVIDER_MODELS, type AiProvider } from "@/lib/ai-settings";

type SaveStatus = "idle" | "saved";

interface RemoteSettings {
  provider: AiProvider;
  model: string;
  ollamaUrl?: string;
  hasKey: boolean;
}

export default function SettingsPage() {
  const t = useTranslations("settings");
  const { token } = useAuth();

  const [provider, setProvider] = useState<AiProvider>("anthropic");
  const [model, setModel] = useState("claude-haiku-4-5-20251001");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    if (!token) return;
    fetch("/api/ai/settings", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => (r.ok && r.status !== 204 ? r.json() : null))
      .then((data: RemoteSettings | null) => {
        if (!data) return;
        setProvider(data.provider);
        setModel(data.model);
        setOllamaUrl(data.ollamaUrl ?? "http://localhost:11434");
        setHasKey(!!data.hasKey);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [token]);

  function handleProviderChange(p: AiProvider) {
    setProvider(p);
    const models = PROVIDER_MODELS[p];
    setModel(models[0]?.value ?? "llama3.2");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/settings", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          apiKey: apiKey || undefined,
          ollamaUrl: provider === "ollama" ? ollamaUrl : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || t("saveFailed"));
      }
      if (apiKey) setHasKey(true);
      setApiKey("");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token) return;
    setDeleting(true);
    setError(null);
    try {
      await fetch("/api/ai/settings", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setHasKey(false);
      setApiKey("");
    } catch {
      setError(t("removeFailed"));
    } finally {
      setDeleting(false);
    }
  }

  const presetModels = PROVIDER_MODELS[provider];

  return (
    <div className="max-w-2xl mx-auto py-10 px-4">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">{t("title")}</h1>
      <p className="text-slate-500 text-sm mb-8">{t("subtitle")}</p>

      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-1">{t("aiSection")}</h2>
        <p className="text-sm text-slate-500 mb-6">{t("aiDescription")}</p>

        {!loaded ? (
          <div className="text-sm text-slate-400">{t("loading")}</div>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            {/* Provider */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">{t("providerLabel")}</label>
              <div className="grid grid-cols-3 gap-2">
                {(["anthropic", "openai", "google", "mistral", "ollama"] as AiProvider[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handleProviderChange(p)}
                    className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      provider === p
                        ? "border-violet-500 bg-violet-50 text-violet-700"
                        : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {p === "anthropic" ? "Anthropic"
                      : p === "openai" ? "OpenAI"
                      : p === "google" ? "Google"
                      : p === "mistral" ? "Mistral"
                      : "Ollama"}
                    {p === "ollama" && (
                      <span className="block text-xs font-normal text-slate-400 mt-0.5">{t("ollamaLocalBadge")}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Model */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">{t("modelLabel")}</label>
              {presetModels.length > 0 ? (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                >
                  {presetModels.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. llama3.2"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
              )}
            </div>

            {/* API Key (hidden for Ollama) */}
            {provider !== "ollama" && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  {t("apiKeyLabel")}
                  {hasKey && (
                    <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-emerald-600 font-normal">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {t("keySaved")}
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasKey ? t("apiKeyPlaceholderReplace") : t("apiKeyPlaceholderNew")}
                  autoComplete="off"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
              </div>
            )}

            {/* Ollama URL */}
            {provider === "ollama" && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">{t("ollamaUrlLabel")}</label>
                <input
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
                <p className="text-xs text-slate-400 mt-1">{t("ollamaHint")}</p>
              </div>
            )}

            <p className="text-xs text-slate-400 pt-1">{t("keyNote")}</p>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              {hasKey ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-sm text-red-600 hover:text-red-700 transition-colors disabled:opacity-50"
                >
                  {deleting ? t("removing") : t("removeSettings")}
                </button>
              ) : (
                <span />
              )}
              <button
                type="submit"
                disabled={saving}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                  saveStatus === "saved"
                    ? "bg-violet-100 text-violet-700 border border-violet-300"
                    : "bg-violet-600 hover:bg-violet-700 text-white"
                }`}
              >
                {saving ? t("saving") : saveStatus === "saved" ? t("saved") : t("save")}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
