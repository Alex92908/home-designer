// ─── ComfyUI「UI 图」→「API prompt」转换 ────────────────────────────────────
//
// 素材包里的工作流 JSON 都是 ComfyUI 前端的「UI 图」格式（含 nodes[] / links[]），
// 而 ComfyUI 的 /prompt 接口只吃「API prompt」格式（{ nodeId: {class_type, inputs} }）。
// 浏览器里 ComfyUI 用 litegraph + object_info 做这步转换；这里在服务端用目标
// ComfyUI 的 /object_info 复刻同样的算法（best-effort）。
//
// 关键点：
//   - 连线输入 → inputs[name] = [originNodeId, originSlot]
//   - 控件输入 → 按 object_info 里 required+optional 的顺序，依次取 widgets_values
//   - seed/INT 控件后常跟一个 control_after_generate 合成控件
//     （值为 fixed/increment/decrement/randomize），要跳过，不进 prompt

type ObjectInfo = Record<string, {
  input?: {
    required?: Record<string, unknown[]>;
    optional?: Record<string, unknown[]>;
  };
}>;

interface UiNode {
  id: number | string;
  type: string;
  mode?: number;                 // 2=muted 4=bypassed
  inputs?: Array<{ name: string; link: number | null; widget?: { name: string } }>;
  widgets_values?: unknown[] | Record<string, unknown>;
}

interface UiGraph {
  nodes?: UiNode[];
  links?: Array<[number, number | string, number, number | string, number, string]>;
}

const CONTROL_VALUES = new Set(["fixed", "increment", "decrement", "randomize"]);

/** 判断一个 input 定义是不是「控件」（而非连线端口）。控件类型：组合框(数组)/INT/FLOAT/STRING/BOOLEAN */
function isWidgetInput(def: unknown[]): boolean {
  const t = def?.[0];
  if (Array.isArray(t)) return true; // combo
  if (typeof t === "string") return ["INT", "FLOAT", "STRING", "BOOLEAN"].includes(t);
  return false;
}

/** 该控件定义是否带 control_after_generate（seed 类） */
function hasControlAfter(def: unknown[], name: string): boolean {
  const opts = def?.[1] as Record<string, unknown> | undefined;
  if (opts && typeof opts === "object" && "control_after_generate" in opts) return true;
  // 常见 seed 字段即便没显式标记，litegraph 也会加控件
  return /seed/i.test(name) && (def?.[0] === "INT");
}

export function isUiGraph(obj: unknown): obj is UiGraph {
  return Boolean(obj && typeof obj === "object" && Array.isArray((obj as UiGraph).nodes));
}

export interface ConvertResult {
  ok: boolean;
  prompt?: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  missingNodes?: string[];
  error?: string;
}

export function uiGraphToApiPrompt(graph: UiGraph, objectInfo: ObjectInfo): ConvertResult {
  const nodes = graph.nodes ?? [];
  // linkId -> [originNodeId, originSlot]
  const linkMap = new Map<number, [string, number]>();
  for (const l of graph.links ?? []) {
    linkMap.set(l[0], [String(l[1]), l[2]]);
  }

  const prompt: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {};
  const missing = new Set<string>();

  for (const node of nodes) {
    if (node.mode === 2 || node.mode === 4) continue; // muted/bypassed
    const def = objectInfo[node.type];
    if (!def) {
      // Reroute/Note/PrimitiveNode 等纯前端节点没有 object_info，跳过即可
      if (!/^(Reroute|Note|MarkdownNote|PrimitiveNode|PrimitiveString.*|GET_|SET_)/.test(node.type)) {
        missing.add(node.type);
      }
      continue;
    }
    const required = def.input?.required ?? {};
    const optional = def.input?.optional ?? {};
    const orderedNames = [...Object.keys(required), ...Object.keys(optional)];
    const defOf = (name: string): unknown[] => (required[name] ?? optional[name] ?? []) as unknown[];

    const inputs: Record<string, unknown> = {};

    // 1) 连线输入
    const connectedNames = new Set<string>();
    for (const slot of node.inputs ?? []) {
      if (slot.link != null && linkMap.has(slot.link)) {
        const name = slot.widget?.name ?? slot.name;
        inputs[name] = linkMap.get(slot.link);
        connectedNames.add(name);
      }
    }

    // 2) 控件输入：按定义顺序消费 widgets_values
    const wv = Array.isArray(node.widgets_values) ? node.widgets_values : [];
    if (wv.length > 0) {
      let i = 0;
      for (const name of orderedNames) {
        if (i >= wv.length) break;
        if (connectedNames.has(name)) continue; // 已被连线占用，不吃控件值
        const d = defOf(name);
        if (!isWidgetInput(d)) continue;        // 连线端口，不在 widgets_values 里
        inputs[name] = wv[i++];
        // 跳过 control_after_generate 合成控件
        if (hasControlAfter(d, name) && i < wv.length && CONTROL_VALUES.has(String(wv[i]))) {
          i++;
        }
      }
    } else if (node.widgets_values && !Array.isArray(node.widgets_values)) {
      // 个别节点 widgets_values 是对象，直接并入
      Object.assign(inputs, node.widgets_values as Record<string, unknown>);
    }

    prompt[String(node.id)] = { class_type: node.type, inputs };
  }

  if (missing.size > 0) {
    return { ok: false, prompt, missingNodes: [...missing], error: `缺少节点定义：${[...missing].join(", ")}（目标 ComfyUI 未安装对应自定义节点）` };
  }
  return { ok: true, prompt };
}
