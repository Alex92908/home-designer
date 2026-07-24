/**
 * POST /api/ai-design
 * Body: { description: string, floors?: number }
 *
 * Converts a natural-language home description into a structured floor-plan
 * JSON that the store's applyAiDesign() action can apply directly.
 *
 * Key chain (first configured key wins):
 *   1. ANTHROPIC_API_KEY  → Claude claude-opus-4-5（服务端 env 优先）
 *   2. provider + apiKey（请求 body，用户 BYOK）→ 该平台文本模型；智谱可回退
 *      .env.local 的 ZHIPUAI_API_KEY（老用户零配置仍可用）。
 *
 * provider 决定 endpoint / 文本模型，见 aiProviders 注册表。密钥只存浏览器本地，
 * 随请求转发，不落服务端、不回显。
 */
import { NextRequest, NextResponse } from "next/server";
import { getAiProvider } from "@/lib/aiProviders";
// 设计 JSON 契约（schema prompt + 工具参数）抽到共享库：/api/mcp 也要用同一契约
// 暴露给外部 agent，单一真源避免双写失同步。
import { SYSTEM_PROMPT, DESIGN_TOOL_PARAMS } from "@/lib/aiDesignContract";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const ZHIPUAI_API_KEY   = process.env.ZHIPUAI_API_KEY;


// ─── Helper: strip markdown fences and parse JSON ────────────────────────────
// 宽容解析：先去围栏，解析失败再退而求其次，截取第一个 { 到最后一个 } 的子串
// （有的模型会在 JSON 前后多带一句话）。
function parseJSON(raw: string): unknown {
  const clean = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(clean.slice(first, last + 1));
    }
    throw new Error("no JSON object found");
  }
}


// OpenAI 兼容的 tools 形态（智谱/通义/Kimi/DeepSeek/Grok/OpenAI 都用这套）。
const OPENAI_DESIGN_TOOL = {
  type: "function",
  function: {
    name: "emit_design",
    description: "提交住宅设计方案 JSON（schema 见 system 提示）。必须通过本工具返回结果。",
    parameters: DESIGN_TOOL_PARAMS,
  },
} as const;

type OutputMode = import("@/lib/aiProviders").AiOutputMode;

/** native→json→text 单向降级。任一档位失败都能自愈退到更兼容的档位。 */
function degradeOutput(m: OutputMode): OutputMode {
  return m === "native" ? "json" : "text";
}

/** 按输出档位拼 OpenAI 兼容请求体。user 可以是纯文本，也可以是
 *  多模态 content 数组（文本 + image_url，照片复刻房间用）。 */
function buildProviderBody(model: string, system: string, user: string | unknown[], mode: OutputMode, maxTokens?: number) {
  const base = {
    model,
    // 完整方案 JSON 可能很长（多楼层 + 每房家具/窗/材质），给足 8000 防截断；
    // 但要尊重平台的输出 token 硬顶（如 glm-4-flash 上限 4095，超了直接 400）。
    max_tokens: Math.min(8000, maxTokens ?? 8000),
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (mode === "native") {
    return {
      ...base,
      tools: [OPENAI_DESIGN_TOOL],
      tool_choice: { type: "function", function: { name: "emit_design" } },
    };
  }
  if (mode === "json") {
    return { ...base, response_format: { type: "json_object" } };
  }
  return base;
}

/** 从 OpenAI 兼容响应里取出方案对象：native 优先读 tool_calls.arguments，
 *  否则（含模型无视 tools 把 JSON 放进 content 的情况）回退到 content 宽容解析。 */
function extractProviderDesign(data: unknown, mode: OutputMode): unknown {
  const msg = (data as { choices?: Array<{ message?: {
    content?: string;
    tool_calls?: Array<{ function?: { arguments?: string } }>;
  } }> })?.choices?.[0]?.message;
  if (mode === "native") {
    const args = msg?.tool_calls?.[0]?.function?.arguments;
    if (typeof args === "string" && args.trim()) return parseJSON(args);
  }
  const raw = msg?.content ?? "";
  return parseJSON(raw);
}

export async function POST(req: NextRequest) {
  let description = "";
  let floors = 0;
  let apiKey = "";
  let providerId = "";
  let mode: "create" | "edit" = "create";
  let current: unknown = null;
  let image = "";
  try {
    const body = await req.json();
    description = (body.description ?? "").trim();
    floors = Number(body.floors) || 0;
    apiKey = (body.apiKey ?? "").trim();
    providerId = body.provider ?? "";
    mode = body.mode === "edit" ? "edit" : "create";
    current = body.current ?? null;
    // 参考房间照片（data URL，base64）。给了就走视觉模型按图复刻房间。
    image = typeof body.image === "string" && body.image.startsWith("data:image/")
      ? body.image : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!description && !image) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }

  const provider = getAiProvider(providerId);
  // BYOK 优先：用户弹窗自带的 key > 服务端 env 兜底（仅智谱有兜底）
  const envFallback = provider.id === "zhipu" ? (ZHIPUAI_API_KEY ?? "") : "";
  const providerKey = apiKey || envFallback;

  if (!ANTHROPIC_API_KEY && !providerKey) {
    return NextResponse.json(
      { error: "no_key", message: "尚未配置大模型 API Key —— 在弹窗里选平台并填入即可（密钥只存你本机）" },
      { status: 401 }
    );
  }

  const desc = description || "请参照附带的照片复刻这间房";
  const baseMessage = image
    ? `请按 REFERENCE PHOTO MODE 处理：参照附带的房间照片复刻这间房。${description ? `补充要求：${description}` : ""}`
    : floors > 0
      ? `请帮我设计一个${floors}层的住宅。需求描述：${desc}`
      : `请帮我设计一个住宅。需求描述：${desc}`;
  // 增量微调：把当前设计快照交给模型，让它在原方案上改，而不是重建
  const userText = mode === "edit" && current
    ? `这是当前设计（CURRENT DESIGN）：\n${JSON.stringify(current)}\n\n请在此基础上做增量修改。修改要求：${baseMessage}\n只改我提到的部分，其余保持不变。返回完整 JSON。`
    : baseMessage;
  // 带照片 → OpenAI 兼容多模态 content（text + image_url，各家通用）。
  const userMessage: string | unknown[] = image
    ? [
        { type: "text", text: userText },
        { type: "image_url", image_url: { url: image } },
      ]
    : userText;

  // ── 1. Try Anthropic Claude ──────────────────────────────────────────────
  if (ANTHROPIC_API_KEY) {
    try {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          // 工具调用：强制 Claude 通过 emit_design 工具回参，拿到的就是合法 JSON 对象。
          tools: [{ name: "emit_design", description: "提交住宅设计方案 JSON（schema 见 system 提示）。", input_schema: DESIGN_TOOL_PARAMS }],
          tool_choice: { type: "tool", name: "emit_design" },
          // Anthropic 的图片块格式与 OpenAI 兼容层不同：data URL 拆成 base64 source。
          messages: [{
            role: "user",
            content: image
              ? (() => {
                  const m = image.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
                  return m
                    ? [
                        { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
                        { type: "text", text: userText },
                      ]
                    : userText;
                })()
              : userText,
          }],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // 优先取 tool_use 块的 input（结构化对象）；兜底再读文本块宽容解析。
        const blocks: Array<{ type?: string; input?: unknown; text?: string }> = data?.content ?? [];
        const toolBlock = blocks.find(b => b.type === "tool_use");
        try {
          if (toolBlock?.input && typeof toolBlock.input === "object") {
            return NextResponse.json(toolBlock.input);
          }
          const raw = blocks.find(b => b.type === "text")?.text ?? "";
          return NextResponse.json(parseJSON(raw));
        } catch {
          console.error("[ai-design/claude] JSON parse error");
          // Fall through to ZhipuAI
        }
      } else {
        console.warn("[ai-design/claude] non-OK status:", res.status);
      }
    } catch (e) {
      console.warn("[ai-design/claude] fetch error:", e);
    }
  }

  // ── 2. Fallback: 所选平台文本模型（OpenAI 兼容） ─────────────────────────
  if (providerKey) {
    const callProvider = (mode: OutputMode) => fetch(provider.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${providerKey}`,
      },
      // 带照片走视觉模型（户型/外观解析同款），纯文字走文本模型。
      // 视觉档的 max_tokens 上限往往更紧（glm-4v-flash 限 1024），单独取。
      body: JSON.stringify(buildProviderBody(
        image ? provider.visionModel : provider.textModel,
        SYSTEM_PROMPT, userMessage, mode,
        image ? (provider.visionMaxTokens ?? provider.maxTokens) : provider.maxTokens,
      )),
    });

    // 免费档（尤其 Gemini）经常 429/503 限流或过载——这类是「瞬时」错误，重试一次常能成。
    const isTransient = (status: number) => status === 429 || status >= 500;
    // 工具调用为首选档位；若平台不吃 tools/response_format（400/422）或解析失败，
    // 就自愈降级 native→json→text，最多 2 次降级，绝不会把某个平台彻底搞挂。
    // 视觉模型普遍不支持函数调用（如 glm-4v-flash）→ 带照片时首档降到 json。
    let outputMode: OutputMode = image
      ? (provider.output === "text" ? "text" : "json")
      : (provider.output ?? "text");
    let lastStatus = 0;
    let lastDetail = "";
    let threw = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      // 仅在「瞬时」错误后退避；因降级而重试则立刻再来一发。
      if (attempt > 0 && lastStatus && isTransient(lastStatus)) {
        await new Promise((r) => setTimeout(r, 1200));
      }
      try {
        const res = await callProvider(outputMode);
        if (res.ok) {
          const data = await res.json();
          try {
            return NextResponse.json(extractProviderDesign(data, outputMode));
          } catch (parseErr) {
            console.error("[ai-design/provider] parse error in", outputMode, parseErr);
            // 还能降级就降级再试（如 native 拿不到 tool_call → 退 json/text）。
            const next = degradeOutput(outputMode);
            if (next !== outputMode) { outputMode = next; lastStatus = 0; continue; }
            return NextResponse.json({ error: "AI 返回的内容不是合法 JSON，请重试" }, { status: 502 });
          }
        }
        // 非 2xx：记录。400/422 多半是 tools/response_format 不被支持 → 降级重试。
        lastStatus = res.status;
        lastDetail = (await res.text()).slice(0, 300);
        console.error("[ai-design/provider] non-OK:", res.status, outputMode, lastDetail);
        if ((res.status === 400 || res.status === 422)) {
          const next = degradeOutput(outputMode);
          if (next !== outputMode) { outputMode = next; continue; }
        }
        if (!isTransient(res.status)) break;
      } catch (e) {
        threw = true;
        lastDetail = e instanceof Error ? e.message : String(e);
        console.error("[ai-design/provider] fetch error:", e);
        // 抛错（DNS/超时/TLS）也按瞬时处理，重试一次
      }
    }

    // 重试后仍失败：给出「是哪家平台 + 什么状态 + 该怎么办」的中文提示
    if (lastStatus === 401 || lastStatus === 403) {
      return NextResponse.json(
        { error: `${provider.label} 拒绝了密钥（${lastStatus}）：请在 ⚙️ 里检查/更换 API Key`, detail: lastDetail },
        { status: 401 },
      );
    }
    if (lastStatus === 429 || lastStatus >= 500) {
      return NextResponse.json(
        { error: `${provider.label} 当前繁忙/限流（${lastStatus}），免费档高峰常如此——稍等重试，或在 ⚙️ 换个平台`, detail: lastDetail },
        { status: 502 },
      );
    }
    if (threw) {
      return NextResponse.json(
        { error: `连接 ${provider.label} 失败：${lastDetail || "网络错误"}，请稍后重试或在 ⚙️ 换个平台`, detail: lastDetail },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: `${provider.label} 返回错误（${lastStatus}），请重试或在 ⚙️ 换个平台`, detail: lastDetail },
      { status: 502 },
    );
  }

  return NextResponse.json({ error: "All AI providers failed" }, { status: 502 });
}
