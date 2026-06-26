import { NextRequest } from "next/server";
import { streamText, convertToModelMessages } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return errorResponse(
      "AI assistant not configured. Set ANTHROPIC_API_KEY to enable.",
      400,
    );
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("Unauthorized", 401);
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
    const model = createAnthropic({ apiKey })("claude-haiku-4-5-20251001");
    const result = streamText({
      model,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
    });
    return result.toUIMessageStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed";
    return errorResponse(message, 502);
  }
}
