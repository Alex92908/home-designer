/**
 * GET  /api/mcp — MCP server 发现清单
 * POST /api/mcp — MCP JSON-RPC 2.0（initialize / tools/list / tools/call）
 *
 * 「筑雅智能设计」全能力 MCP：外部 agent（Claude Code 等）接入后即可对话式设计——
 * agent 自己就是大模型，按设计契约（get_design_guide 返回，与 /api/ai-design 发给
 * BYOK 模型的 SYSTEM_PROMPT 同源）产设计 JSON，经 apply_design 落进浏览器画布。
 *
 * 工具集：
 *   get_design_guide       — 设计 JSON 契约（schema/坐标系/素材目录），先读再设计
 *   list_templates         — 精修项目模板清单（咖啡馆/餐厅/办公/各风格别墅）
 *   apply_project_template — 秒套精修模板当底子
 *   apply_design           — 应用设计 JSON（merge=true 增量微调 / false 整套重建）
 *   get_design_state       — 当前画布完整设计快照（浏览器每 2s 推送）
 *   open_preview           — 预览地址与查看指引
 *
 * 命令经内存桥入队，浏览器轮询 /api/mcp/sync 拉取并应用后回执；tools/call 等到
 * 回执才答复，CLI 拿到的是浏览器真实结果（成功/失败/未连接）。
 */
import { NextRequest, NextResponse } from "next/server";
// 工具面已抽到 ./tools —— 与 App 内的 AI agent(/api/ai-agent)共用同一份定义和实现,
// 两条路径(外部 Claude Code 走 MCP、内部模型走 function calling)行为完全一致。
import { TOOLS, callTool } from "./tools";

// ── JSON-RPC 2.0 ────────────────────────────────────────────────────────────
interface RpcRequest { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown>; }

const SERVER_INFO = {
  name: "zhuya-design",
  version: "1.0.0",
  description: "筑雅 ZHUYA intelligent architecture & interior design — templates, full design-JSON authoring, live canvas.",
};

export async function GET() {
  return NextResponse.json({ ...SERVER_INFO, protocol: "mcp", transport: "http", tools: TOOLS.map(t => t.name) });
}

export async function POST(req: NextRequest) {
  let rpc: RpcRequest;
  try {
    rpc = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const id = rpc.id ?? null;
  try {
    switch (rpc.method) {
      case "initialize":
        return NextResponse.json({
          jsonrpc: "2.0", id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        });
      case "notifications/initialized":
        // 通知无需应答体，但一些客户端期待 200
        return NextResponse.json({ jsonrpc: "2.0", id, result: {} });
      case "tools/list":
        return NextResponse.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      case "tools/call": {
        const name = String(rpc.params?.name ?? "");
        const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>;
        const text = await callTool(name, args);
        return NextResponse.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
      }
      default:
        return NextResponse.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${rpc.method}` } });
    }
  } catch (e) {
    return NextResponse.json({ jsonrpc: "2.0", id, error: { code: -32000, message: e instanceof Error ? e.message : "Internal error" } });
  }
}
