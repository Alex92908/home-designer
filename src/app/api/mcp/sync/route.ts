/**
 * POST /api/mcp/sync — 浏览器 ↔ MCP 桥的心跳。
 *
 * 浏览器每 2s 调一次，一趟完成三件事：
 *   body.design — 推送当前完整设计快照（serializeCurrentDesign 输出）
 *   body.ack    — 回执上一批命令的执行结果 { id, ok, message? }
 *   响应.commands — 取走待执行的 MCP 命令（apply_template / apply_design）
 */
import { NextRequest, NextResponse } from "next/server";
import { pushDesign, drainCommands, ack, acquireLease } from "../state";

export async function POST(req: NextRequest) {
  let body: {
    tabId?: string;
    design?: unknown;
    ack?: { id: string; ok: boolean; message?: string } | Array<{ id: string; ok: boolean; message?: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  // 租约：多标签同开时只有持有者是执行者（推快照+拉命令），其余标签闲置心跳。
  // 没有租约会互相抢命令/快照打架（实测把用户正开着的设计覆盖了）。
  const tabId = typeof body.tabId === "string" && body.tabId ? body.tabId : "anonymous";
  const leader = acquireLease(tabId);
  const acks = Array.isArray(body.ack) ? body.ack : body.ack ? [body.ack] : [];
  for (const a of acks) {
    if (a && typeof a.id === "string") ack(a.id, !!a.ok, a.message);
  }
  if (!leader) return NextResponse.json({ ok: true, leader: false, commands: [] });
  if (body.design !== undefined) pushDesign(body.design);
  return NextResponse.json({ ok: true, leader: true, commands: drainCommands() });
}
