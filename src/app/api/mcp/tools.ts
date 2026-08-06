/**
 * 设计工具面 —— MCP server 与 App 内 AI agent **共用同一份**。
 *
 * 两个消费者:
 *   ① /api/mcp        外部 agent(Claude Code 等)走 MCP JSON-RPC 协议
 *   ② /api/ai-agent   App 内的模型(DeepSeek / GLM / …)走 OpenAI function calling 循环
 *
 * 工具的执行都落到同一条浏览器通道(enqueue → 页面每 2s 拉取执行 → waitResult),
 * 所以两条路径改出来的效果完全一致,描述/schema 也只维护一份。
 */
import { SYSTEM_PROMPT } from "@/lib/aiDesignContract";
import { PROJECT_TEMPLATES } from "@/lib/projectTemplates";
import { getDesign, isConnected, enqueue, waitResult } from "./state";

export const TOOLS = [
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
    name: "check_layout",
    description:
      "Runs the REAL geometry check on the current canvas (indoor furniture clearance + door swing + yard safety distances) and returns concrete violations. Applying a design only means the JSON landed — it does NOT mean the objects fit. ALWAYS call this after apply_design/apply_project_template, then fix the reported items and check again until it returns OK.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "auto_fix_layout",
    description:
      "Lets the APP resolve furniture collisions for you: it repeatedly reads the real geometry and pushes overlapping items apart until clearances pass, then returns the remaining report. USE THIS instead of hand-computing centimetre coordinates — you decide WHAT goes in a room and its style; the app handles the geometry. Call it right after apply_design.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "yard_auto_layout",
    description:
      "Lets the APP compose the yard for you — this is how you get a GOOD-LOOKING yard. mode=preset applies a designer-authored yard package (zones + planting + features, presetId from the error message if unknown); mode=plant scatters N trees with proper spacing away from the house; mode=paths auto-routes walkways between zones. PREFER THIS over hand-writing yard.add coordinates: collision checks only prevent overlap, they cannot make a layout look designed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mode: { type: "string", description: "preset | plant | paths" },
        presetId: { type: "string", description: "for mode=preset; call with a wrong id to list the available packages" },
        count: { type: "number", description: "for mode=plant; how many trees (default 6)" },
      },
      required: ["mode"] as string[],
    },
  },
  {
    name: "open_preview",
    description: "Returns the preview URL and how to view the design (exterior orbit, per-room views, first/third-person walkthrough).",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
];

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
  "Browser not connected: open the 筑雅 designer page in a browser first — it syncs with this server every 2s. The command stays queued and will apply once the page is open.";

export async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "get_design_guide": {
      return [
        "# 筑雅 design-JSON contract (same one our server LLM uses)",
        "",
        SYSTEM_PROMPT,
        "",
        "# usage notes",
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
    case "auto_fix_layout": {
      const id = enqueue("auto_fix_layout", {});
      if (!isConnected()) return JSON.stringify({ ok: false, queued: true, error: NOT_CONNECTED_MSG });
      const r = await waitResult(id, 30_000);   // 迭代求解比单次校验慢
      return r
        ? JSON.stringify({ ok: r.ok, report: r.message })
        : JSON.stringify({ ok: false, error: "Timed out waiting for the browser to auto-fix the layout." });
    }
    case "yard_auto_layout": {
      const id = enqueue("yard_auto", args);
      if (!isConnected()) return JSON.stringify({ ok: false, queued: true, error: NOT_CONNECTED_MSG });
      const r = await waitResult(id, 20_000);
      return r
        ? JSON.stringify({ ok: r.ok, report: r.message })
        : JSON.stringify({ ok: false, error: "Timed out waiting for the browser to run the yard auto-layout." });
    }
    case "check_layout": {
      // 真实几何校验只能在浏览器里跑(要当前 store 的房间尺寸/门窗 + 家具目录的实际长宽高),
      // 故和 apply_* 一样走命令桥。见 useMcpBridge.runLayoutCheck。
      const id = enqueue("check_layout", {});
      if (!isConnected()) return JSON.stringify({ ok: false, queued: true, error: NOT_CONNECTED_MSG });
      const r = await waitResult(id);
      return r
        ? JSON.stringify({ ok: r.ok, report: r.message })
        : JSON.stringify({ ok: false, error: "Timed out waiting for the browser to run the layout check." });
    }
    case "get_design_state": {
      const { design, ageMs, connected, yardSummary } = getDesign();
      if (!design) return JSON.stringify({ connected, error: NOT_CONNECTED_MSG });
      // yardSummary 补 design.yard 的盲区(分区/小径/导入模型不在 apply 契约里,
      // 只看 design.yard 会误判「院子是空的」)。
      return JSON.stringify({ connected, snapshotAgeMs: Math.round(ageMs), yardSummary, design }, null, 2);
    }
    case "open_preview": {
      return JSON.stringify({
        url: "/",
        views: {
          exterior: "默认外观图：轨道相机环视整栋 + 院子",
          rooms: "左侧房间列表进任意房间效果图",
          walkthrough: "外观图右上「🚶 进入室内漫游」；HUD 可切第三人称人物 + 换角色；WASD 行走、Shift 疾跑、E 开门",
        },
        tip: "The canvas updates live as you apply designs.",
      }, null, 2);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** MCP 的 inputSchema → OpenAI function-calling 的 tools 数组(DeepSeek/GLM/Qwen 等通用)。 */
export function toolsForOpenAI() {
  return TOOLS.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}
