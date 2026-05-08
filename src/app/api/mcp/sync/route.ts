/**
 * POST /api/mcp/sync
 *
 * The browser client calls this to push current Zustand design state into
 * the server-side in-memory bridge so MCP tools can read it.
 */
import { NextRequest, NextResponse } from "next/server";
import { patchState } from "../state";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const updated = patchState(body);
  return NextResponse.json({ ok: true, state: updated });
}
