// Server-only AI model factory shared by the chat route and the AI triage webhook.
// Kept separate from ai-settings.ts (which is imported by client components) so
// @ai-sdk provider packages never end up in the browser bundle.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AiProvider } from "./ai-settings";

export class AiProviderNotConfiguredError extends Error {}

export function getAiModel(provider: AiProvider, model?: string, ollamaUrl?: string) {
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new AiProviderNotConfiguredError("Anthropic not configured. Set ANTHROPIC_API_KEY.");
    return createAnthropic({ apiKey })(model ?? "claude-haiku-4-5-20251001");
  }
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new AiProviderNotConfiguredError("OpenAI not configured. Set OPENAI_API_KEY.");
    return createOpenAI({ apiKey })(model ?? "gpt-4o-mini");
  }
  if (provider === "google") {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) throw new AiProviderNotConfiguredError("Google AI not configured. Set GOOGLE_AI_API_KEY.");
    return createGoogleGenerativeAI({ apiKey })(model ?? "gemini-2.0-flash");
  }
  if (provider === "mistral") {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new AiProviderNotConfiguredError("Mistral not configured. Set MISTRAL_API_KEY.");
    return createMistral({ apiKey })(model ?? "mistral-large-latest");
  }
  if (provider === "ollama") {
    const baseURL = (ollamaUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434") + "/v1";
    return createOpenAICompatible({ name: "ollama", baseURL })(model ?? "llama3.2");
  }
  throw new AiProviderNotConfiguredError(`Unknown AI provider: ${provider}`);
}
