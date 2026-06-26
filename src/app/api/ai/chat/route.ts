import { NextRequest } from "next/server";
import { streamText, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { usernameFromBearer, type AiProvider } from "@/lib/ai-settings";
import type { UIMessage } from "@ai-sdk/react";

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

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!usernameFromBearer(authHeader)) return errorResponse("Unauthorized", 401);

  const { messages, ticketContext, provider = "anthropic", model, ollamaUrl } = (await req.json()) as {
    messages: UIMessage[];
    ticketContext?: string;
    provider?: AiProvider;
    model?: string;
    ollamaUrl?: string;
  };

  let systemPrompt = SUPPORT_SYSTEM_PROMPT;
  if (ticketContext) {
    systemPrompt += `\n\n---\nCURRENT TICKET:\n${ticketContext}\n---`;
  }

  try {
    let aiModel;

    if (provider === "anthropic") {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return errorResponse("Anthropic not configured. Set ANTHROPIC_API_KEY.", 400);
      aiModel = createAnthropic({ apiKey })(model ?? "claude-haiku-4-5-20251001");
    } else if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return errorResponse("OpenAI not configured. Set OPENAI_API_KEY.", 400);
      aiModel = createOpenAI({ apiKey })(model ?? "gpt-4o-mini");
    } else if (provider === "google") {
      const apiKey = process.env.GOOGLE_AI_API_KEY;
      if (!apiKey) return errorResponse("Google AI not configured. Set GOOGLE_AI_API_KEY.", 400);
      aiModel = createGoogleGenerativeAI({ apiKey })(model ?? "gemini-2.0-flash");
    } else if (provider === "mistral") {
      const apiKey = process.env.MISTRAL_API_KEY;
      if (!apiKey) return errorResponse("Mistral not configured. Set MISTRAL_API_KEY.", 400);
      aiModel = createMistral({ apiKey })(model ?? "mistral-large-latest");
    } else if (provider === "ollama") {
      const baseURL = (ollamaUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434") + "/v1";
      aiModel = createOpenAICompatible({ name: "ollama", baseURL })(model ?? "llama3.2");
    } else {
      return errorResponse("Unknown provider.", 400);
    }

    const result = streamText({
      model: aiModel,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
    });
    return result.toUIMessageStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed";
    return errorResponse(message, 502);
  }
}
