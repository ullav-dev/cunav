import { NextRequest } from "next/server";
import { streamText, convertToModelMessages } from "ai";
import { decryptKey, usernameFromBearer, type AiSettings } from "@/lib/ai-settings";
import { getAiModel, AiProviderNotConfiguredError } from "@/lib/ai-provider";
import type { UIMessage } from "@ai-sdk/react";

const AUTH_URL = process.env.AUTH_URL ?? "http://localhost:8081";

const SUPPORT_SYSTEM_PROMPT = `You are a customer support assistant helping support agents triage and resolve tickets. You help with:
- Understanding and categorising bug reports, feature requests, and questions
- Suggesting steps to reproduce and investigate issues
- Drafting clear responses to customers
- Finding patterns across similar issues
- Recommending priorities and next steps

When helping agents:
- Be concise and actionable
- Suggest specific investigation steps
- Help draft professional, empathetic customer communications
- Acknowledge uncertainty and suggest how to verify information`;

function errorResponse(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// This chat panel is personal (BYOK), unlike the AI-enabled-queue triage
// webhook (src/app/api/ai/triage/route.ts), which has no signed-in user and
// always uses the deployment-wide provider keys via getAiModel()'s env fallback.
async function getUserSettings(authHeader: string): Promise<AiSettings | null> {
  const res = await fetch(`${AUTH_URL}/users/me/ai-settings?app=cunav`, {
    headers: { Authorization: authHeader },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data = await res.json();
  return {
    provider: data.provider,
    model: data.model,
    ollamaUrl: data.ollama_url ?? undefined,
    encryptedKey: data.encrypted_key ?? undefined,
    iv: data.iv ?? undefined,
    authTag: data.auth_tag ?? undefined,
  };
}

function getDecryptedApiKey(settings: AiSettings): string | null {
  if (!settings.encryptedKey || !settings.iv || !settings.authTag) return null;
  try {
    return decryptKey(settings.encryptedKey, settings.iv, settings.authTag);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!usernameFromBearer(authHeader)) return errorResponse("Unauthorized", 401);

  const settings = await getUserSettings(authHeader!);
  if (!settings) {
    return errorResponse("No AI provider configured. Go to Settings to add your API key.", 400);
  }

  const { messages, ticketContext } = (await req.json()) as {
    messages: UIMessage[];
    ticketContext?: string;
  };

  let systemPrompt = SUPPORT_SYSTEM_PROMPT;
  if (ticketContext) {
    systemPrompt += `\n\n---\nCURRENT TICKET:\n${ticketContext}\n---`;
  }

  try {
    let apiKey: string | undefined;
    if (settings.provider !== "ollama") {
      const decrypted = getDecryptedApiKey(settings);
      if (!decrypted) return errorResponse("No API key configured. Go to Settings to add one.", 400);
      apiKey = decrypted;
    }

    const aiModel = getAiModel(settings.provider, settings.model, { apiKey, ollamaUrl: settings.ollamaUrl });

    const result = streamText({
      model: aiModel,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
    });
    return result.toUIMessageStreamResponse();
  } catch (err) {
    if (err instanceof AiProviderNotConfiguredError) return errorResponse(err.message, 400);
    const message = err instanceof Error ? err.message : "AI request failed";
    return errorResponse(message, 502);
  }
}
