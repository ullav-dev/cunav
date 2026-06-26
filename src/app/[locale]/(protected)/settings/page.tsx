"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { loadPreference, savePreference, PROVIDER_MODELS, type AiProvider, type AiPreference } from "@/lib/ai-settings";

type SaveStatus = "idle" | "saved";

export default function SettingsPage() {
  const t = useTranslations("settings");

  const [pref, setPref] = useState<AiPreference>({ provider: "anthropic", model: "claude-haiku-4-5-20251001" });
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    setPref(loadPreference());
    setLoaded(true);
  }, []);

  function handleProviderChange(p: AiProvider) {
    const models = PROVIDER_MODELS[p];
    setPref({ provider: p, model: models[0]?.value ?? "llama3.2", ollamaUrl: pref.ollamaUrl });
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    savePreference(pref);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  }

  const presetModels = PROVIDER_MODELS[pref.provider];

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
                      pref.provider === p
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
                  value={pref.model}
                  onChange={(e) => setPref((p) => ({ ...p, model: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                >
                  {presetModels.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={pref.model}
                  onChange={(e) => setPref((p) => ({ ...p, model: e.target.value }))}
                  placeholder="e.g. llama3.2"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
              )}
            </div>

            {/* Ollama URL */}
            {pref.provider === "ollama" && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">{t("ollamaUrlLabel")}</label>
                <input
                  value={pref.ollamaUrl ?? "http://localhost:11434"}
                  onChange={(e) => setPref((p) => ({ ...p, ollamaUrl: e.target.value }))}
                  placeholder="http://localhost:11434"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
                <p className="text-xs text-slate-400 mt-1">{t("ollamaHint")}</p>
              </div>
            )}

            <p className="text-xs text-slate-400 pt-1">{t("keyNote")}</p>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="submit"
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  saveStatus === "saved"
                    ? "bg-violet-100 text-violet-700 border border-violet-300"
                    : "bg-violet-600 hover:bg-violet-700 text-white"
                }`}
              >
                {saveStatus === "saved" ? t("saved") : t("save")}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
