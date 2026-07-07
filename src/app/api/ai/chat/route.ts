import { NextRequest } from "next/server";
import { streamText, convertToModelMessages } from "ai";
import { usernameFromBearer, type AiProvider } from "@/lib/ai-settings";
import { getAiModel, AiProviderNotConfiguredError } from "@/lib/ai-provider";
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
    const aiModel = getAiModel(provider, model, ollamaUrl);

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
