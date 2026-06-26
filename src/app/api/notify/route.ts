import { NextRequest, NextResponse } from "next/server";

// Phase 1 stub — awe-server fires a webhook here on ticket status changes.
// Full email delivery is wired in Phase 1.5 once the awe-server trigger surface is confirmed.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("[cunav/notify] webhook received:", JSON.stringify(body, null, 2));
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}
