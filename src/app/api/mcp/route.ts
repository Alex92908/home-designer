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
import { SYSTEM_PROMPT } from "@/lib/aiDesignContract";
import { PROJECT_TEMPLATES } from "@/lib/projectTemplates";
import { getDesign, isConnected, enqueue, waitResult } from "./state";

// ── MCP 工具定义 ─────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "get_design_guide",
    description:
      "Returns the FULL design-JSON contract (schema, room types, coordinate system, material/furniture/yard catalogs). READ THIS FIRST before calling apply_design — your design JSON must follow it exactly.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "list_templates",
    description:
      "Lists curated project templates (café / restaurant / office film-sets, villas in many styles). Prefer starting from a template that matches the user's intent, then fine-tune with apply_design {merge:true}.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "apply_project_template",
    description:
      "Applies a curated template as the design base (instant, high quality). Whole-house replace: geometry, doors/windows, furniture, exterior, yard all come from the template.",
    inputSchema: {
      type: "object" as const,
      properties: {
        templateId: { type: "string", description: "Template id from list_templates, e.g. set-cafe" },
      },
      required: ["templateId"] as string[],
    },
  },
  {
    name: "apply_design",
    description:
      "Applies a design JSON (contract: get_design_guide). merge=true (RECOMMENDED after a template base): incremental — only fields you provide change, e.g. one room's furniture or the exterior wall color. merge=false: full rebuild from your JSON (floorLayouts required).",
    inputSchema: {
      type: "object" as const,
      properties: {
        design: { type: "object", description: "Design JSON following the contract from get_design_guide" },
        merge: { type: "boolean", description: "true = incremental fine-tune on current canvas (default); false = full rebuild" },
      },
      required: ["design"] as string[],
    },
  },
  {
    name: "get_design_state",
    description:
      "Returns the current canvas design as a full snapshot (same JSON dialect as apply_design). Use it to verify your changes landed and to base incremental edits on reality.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "open_preview",
    description: "Returns the preview URL and how to view the design (exterior orbit, per-room views, first/third-person walkthrough).",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
];

// ── 工具实现 ────────────────────────────────────────────────────────────────
function templateSummaries() {
  return PROJECT_TEMPLATES.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description ?? "",
    floors: t.floorLayouts.length,
    rooms: t.floorLayouts.map(fl => fl.rooms.map(r => r.name ?? r.room)).flat(),
  }));
}

const NOT_CONNECTED_MSG =
  "Browser not connected: open http://localhost:3000 (筑雅 designer) in a browser first — it syncs with this MCP server every 2s. The command stays queued and will apply once the page is open.";

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "get_design_guide": {
      return [
        "# 筑雅 design-JSON contract (same one our server LLM uses)",
        "",
        SYSTEM_PROMPT,
        "",
        "# MCP usage notes",
        "- Workflow: list_templates → apply_project_template (base) → apply_design {merge:true} for the user's specifics → get_design_state to verify.",
        "- merge=true means: only the fields you send change. Send ONLY deltas (e.g. one room's furniture array, or exterior.wallColor).",
        "- Coordinates: room-local cm, origin at the room's NW (back-left) corner, x→East, z→South; furniture rotation in degrees.",
      ].join("\n");
    }
    case "list_templates": {
      return JSON.stringify({ templates: templateSummaries() }, null, 2);
    }
    case "apply_project_template": {
      const templateId = String(args.templateId ?? "");
      const tpl = PROJECT_TEMPLATES.find(t => t.id === templateId);
      if (!tpl) {
        return JSON.stringify({ ok: false, error: `Unknown templateId "${templateId}". Call list_templates for valid ids.` });
      }
      const id = enqueue("apply_template", { templateId });
      if (!isConnected()) return JSON.stringify({ ok: false, queued: true, error: NOT_CONNECTED_MSG });
      const r = await waitResult(id);
      return JSON.stringify(r
        ? { ok: r.ok, applied: tpl.name, message: r.message ?? (r.ok ? "Template applied on canvas." : "Browser failed to apply.") }
        : { ok: false, queued: true, error: "Timed out waiting for the browser to apply (is the page open and visible?)" });
    }
    case "apply_design": {
      const design = args.design;
      const merge = args.merge !== false; // 默认增量——模板底子工作流的常态
      if (!design || typeof design !== "object") {
        return JSON.stringify({ ok: false, error: "`design` must be an object following the contract from get_design_guide." });
      }
      if (!merge && !Array.isArray((design as Record<string, unknown>).floorLayouts)) {
        return JSON.stringify({ ok: false, error: "Full rebuild (merge=false) requires design.floorLayouts (array). For incremental edits use merge=true." });
      }
      const id = enqueue("apply_design", { design, merge });
      if (!isConnected()) return JSON.stringify({ ok: false, queued: true, error: NOT_CONNECTED_MSG });
      const r = await waitResult(id);
      return JSON.stringify(r
        ? { ok: r.ok, merge, message: r.message ?? (r.ok ? "Design applied on canvas." : "Browser failed to apply.") }
        : { ok: false, queued: true, error: "Timed out waiting for the browser to apply (is the page open and visible?)" });
    }
    case "get_design_state": {
      const { design, ageMs, connected } = getDesign();
      if (!design) return JSON.stringify({ connected, error: NOT_CONNECTED_MSG });
      return JSON.stringify({ connected, snapshotAgeMs: Math.round(ageMs), design }, null, 2);
    }
    case "open_preview": {
      return JSON.stringify({
        url: "http://localhost:3000",
        views: {
          exterior: "默认外观图：轨道相机环视整栋 + 院子",
          rooms: "左侧房间列表进任意房间效果图",
          walkthrough: "外观图右上「🚶 进入室内漫游」；HUD 可切第三人称人物 + 换角色；WASD 行走、Shift 疾跑、E 开门",
        },
        tip: "Ask the user to keep this page open — the canvas updates live as you apply designs.",
      }, null, 2);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

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
