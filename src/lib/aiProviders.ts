// ─── 大模型平台注册表（视觉 + 文本，全部 OpenAI 兼容） ──────────────────────
//
// 户型解析 / 外观解析需要「视觉」模型，文生设计是「纯文本」；这里每个平台都
// 登记 visionModel + textModel。前端弹窗下拉、后端代理查表都复用同一份注册表，
// 避免「加一个平台要改三处」。密钥仍只存浏览器本地，随请求转发，不落服务端。
//
// 选型口径：都挑「OpenAI /chat/completions 兼容 + 有视觉模型」的常见平台，
// 这样三类任务（视觉解析 / 文生设计）用同一套消息格式即可，无需为某家特判。

export type AiProviderId =
  | "zhipu" | "openai" | "qwen" | "moonshot" | "gemini" | "grok" | "claude" | "deepseek";

/** 文生设计的「结构化输出」能力档位 —— 决定后端怎么逼模型只吐合法 JSON：
 *  - "native": 走 OpenAI 风格 tools/tool_choice，强制调用 emit_design 工具，
 *    从 tool_calls.arguments 直接拿到对象。最稳，但要求模型支持函数调用。
 *  - "json"  : 走 response_format:{type:"json_object"}，逼模型整段返回合法 JSON
 *    （不裹 markdown、不带散文）。多数 OpenAI 兼容平台支持，弱模型也能用。
 *  - "text"  : 都不支持，纯文本返回 + 服务端宽容解析兜底。
 *  任何档位失败都会自愈降级（见 route.ts），所以填错最多退回 text，不会把平台搞挂。 */
export type AiOutputMode = "native" | "json" | "text";

export interface AiProvider {
  id: AiProviderId;
  label: string;        // 下拉显示名
  endpoint: string;     // OpenAI 兼容 /chat/completions
  visionModel: string;  // 户型 / 外观 解析
  textModel: string;    // 文生设计
  keyHint: string;      // 「去哪申请」提示
  helpUrl: string;      // 申请链接
  /** 文生设计结构化输出档位，缺省按 "text" 处理。 */
  output?: AiOutputMode;
  /** AI agent(多轮 function calling)用的模型档位。
   *  不填 = 该平台暂不支持 agent 模式(入口会置灰),避免用工具能力弱的轻量档跑出
   *  「一直不调工具 / 参数乱填」的体验。 */
  agentModel?: string;
  /** 文生设计单次 max_tokens 上限（平台输出 token 硬顶）。缺省 8000。
   *  例：glm-4-flash 输出上限 4095，传 8000 会被平台直接 400 拒掉。 */
  maxTokens?: number;
  /** 视觉模型的 max_tokens 上限（照片复刻房间用）。视觉档往往比文本档更紧：
   *  glm-4v-flash 限 [1,1024]。缺省回落到 maxTokens。 */
  visionMaxTokens?: number;
  /** 可选具体模型版本清单（用户可在设置弹窗中自由切换，也支持手填任意模型 ID） */
  models: Array<{ id: string; label: string; vision?: boolean; imageGen?: boolean }>;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProvider> = {
  zhipu: {
    id: "zhipu",
    label: "智谱 GLM（国内 · 有免费额度）",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    visionModel: "glm-4v-flash",
    // 用 flash 档：智谱「免费额度」覆盖的是 *-flash 模型；glm-4 是付费档，
    // 免费 key 调它会被拒 → 502。glm-4-flash 足够输出结构化 JSON。
    textModel: "glm-4-flash",
    keyHint: "在智谱开放平台「API Keys」页面创建。",
    helpUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    output: "json",
    // glm-4-flash 输出 token 硬顶 4095，给 8000 会 400。
    maxTokens: 4000,
    // glm-4v-flash 视觉档更紧：max_tokens 限 [1,1024]。
    visionMaxTokens: 1024,
    // agent 要多轮 function calling:glm-4-flash 工具能力弱,换 glm-4-plus。
    agentModel: "glm-4-plus",
    models: [
      { id: "glm-4.5v", label: "GLM-4.5V（最新视觉旗舰 · 强图形理解）", vision: true },
      { id: "glm-4v-plus", label: "GLM-4V-Plus（高清视觉主力）", vision: true },
      { id: "glm-4-plus", label: "GLM-4-Plus（旗舰文本 / Agent）" },
      { id: "glm-4v-flash", label: "GLM-4V-Flash（免费视觉）", vision: true },
      { id: "glm-4-flash", label: "GLM-4-Flash（免费文本）" },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI（GPT-4o）",
    endpoint: "https://api.openai.com/v1/chat/completions",
    visionModel: "gpt-4o",
    textModel: "gpt-4o-mini",
    keyHint: "在 OpenAI Platform「API keys」页面创建。",
    helpUrl: "https://platform.openai.com/api-keys",
    output: "native",
    agentModel: "gpt-4o",
    models: [
      { id: "gpt-4.1", label: "GPT-4.1（旗舰全能 · 强视觉）", vision: true },
      { id: "gpt-4o", label: "GPT-4o（多模态主力）", vision: true },
      { id: "o4-mini", label: "o4-mini（深度空间推理 · 视觉）", vision: true },
      { id: "gpt-4o-mini", label: "GPT-4o-mini（高速经济）", vision: true },
      { id: "gpt-image-1", label: "GPT-Image-1（旗舰图形渲染/编辑）", imageGen: true },
    ],
  },
  qwen: {
    id: "qwen",
    label: "通义千问 Qwen（阿里百炼）",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    visionModel: "qwen-vl-max",
    textModel: "qwen-plus",
    keyHint: "在阿里云百炼 DashScope 控制台创建 API-KEY。",
    helpUrl: "https://bailian.console.aliyun.com/?apiKey=1#/api-key",
    output: "native",
    agentModel: "qwen-plus",
    models: [
      { id: "qwen-vl-max", label: "Qwen-VL-Max（最强视觉解析）", vision: true },
      { id: "qwen2.5-vl-72b-instruct", label: "Qwen2.5-VL-72B（高精度空间视觉）", vision: true },
      { id: "qwen3-max", label: "Qwen3-Max（最新文本旗舰）" },
      { id: "qwen-plus", label: "Qwen-Plus（均衡主力）" },
    ],
  },
  moonshot: {
    id: "moonshot",
    label: "Kimi / Moonshot",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    visionModel: "moonshot-v1-8k-vision-preview",
    // 文生设计的 system prompt（材质/院子/装饰目录 + 规则）+ edit 模式回传的
    // 现状 JSON + max_tokens 8000 远超 8k 总上下文 → 必须用 32k 档。
    textModel: "moonshot-v1-32k",
    keyHint: "在 Moonshot 开放平台「API Key 管理」页面创建。",
    helpUrl: "https://platform.moonshot.cn/console/api-keys",
    output: "native",
    agentModel: "moonshot-v1-32k",
    models: [
      { id: "kimi-k2-0711-preview", label: "Kimi K2（最新旗舰）" },
      { id: "moonshot-v1-32k", label: "Moonshot-v1-32k（长上下文设计）" },
      { id: "moonshot-v1-8k-vision-preview", label: "Moonshot Vision（视觉解析）", vision: true },
    ],
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    // Google 的 OpenAI 兼容层（Bearer 鉴权 + image_url 支持 base64）
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    visionModel: "gemini-2.5-flash",
    textModel: "gemini-2.5-flash",
    keyHint: "在 Google AI Studio 创建 API key。",
    helpUrl: "https://aistudio.google.com/apikey",
    output: "json",
    agentModel: "gemini-2.5-pro",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro（旗舰多模态 · 强视觉推理）", vision: true },
      { id: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview（新一代前沿旗舰）", vision: true },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash（极速多模态）", vision: true },
      { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image（Nano Banana 旗舰生图/改图）", vision: true, imageGen: true },
    ],
  },
  grok: {
    id: "grok",
    label: "xAI Grok",
    endpoint: "https://api.x.ai/v1/chat/completions",
    visionModel: "grok-2-vision-1212",
    textModel: "grok-3",
    keyHint: "在 xAI 控制台「API Keys」创建。",
    helpUrl: "https://console.x.ai",
    output: "native",
    agentModel: "grok-3",
    models: [
      { id: "grok-3", label: "Grok 3（旗舰推理）" },
      { id: "grok-2-vision-1212", label: "Grok 2 Vision（视觉解析）", vision: true },
    ],
  },
  claude: {
    id: "claude",
    label: "Anthropic Claude",
    // Anthropic 的 OpenAI 兼容端点（Bearer 鉴权 + image_url），免去 native schema 特判
    endpoint: "https://api.anthropic.com/v1/chat/completions",
    visionModel: "claude-opus-4-5",
    textModel: "claude-opus-4-5",
    keyHint: "在 Anthropic Console「API Keys」创建。",
    helpUrl: "https://console.anthropic.com/settings/keys",
    output: "native",
    agentModel: "claude-sonnet-4-5",
    models: [
      { id: "claude-opus-4-5", label: "Claude Opus 4.5（顶级旗舰 · 强视觉）", vision: true },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5（高速主力 · 强视觉）", vision: true },
      { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet（稳定版）", vision: true },
    ],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek 深度求索",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    // DeepSeek 的 chat API 目前没有公开视觉模型 → 视觉模型字段填文本模型占位，
    // 户型/外观「视觉解析」走它会不灵；但「文生设计」纯文本任务完全没问题。
    visionModel: "deepseek-chat",
    textModel: "deepseek-chat",
    keyHint: "在 DeepSeek 开放平台「API keys」页面创建（注：暂不支持视觉解析）。",
    helpUrl: "https://platform.deepseek.com/api_keys",
    output: "native",
    agentModel: "deepseek-chat",
    models: [
      { id: "deepseek-reasoner", label: "DeepSeek-R1 Reasoner（深度空间推理）" },
      { id: "deepseek-chat", label: "DeepSeek-V3 Chat（高速主力）" },
    ],
  },
};

export const AI_PROVIDER_LIST = Object.values(AI_PROVIDERS);
export const DEFAULT_AI_PROVIDER: AiProviderId = "zhipu";

/** 容错查表：未知 / 缺省 id 一律回退到默认平台 */
export function getAiProvider(id: string | undefined | null): AiProvider {
  return AI_PROVIDERS[(id ?? "") as AiProviderId] ?? AI_PROVIDERS[DEFAULT_AI_PROVIDER];
}

/** AI agent(/api/ai-agent)用的模型档位。
 *
 *  agent 要靠 function calling 多轮调工具,和「文生设计」单发一份 JSON 的要求不同:
 *  textModel 里有几个是为**免费额度/便宜**挑的轻量档(如 glm-4-flash),工具调用能力弱
 *  甚至不支持,拿来跑 agent 会一直不调工具或调错参数。这里单独指定能用的档位。 */
export function agentModelOf(p: AiProvider): string {
  return p.agentModel ?? p.textModel;
}

/** 该平台是否具备跑 agent 的条件(有明确可用的 function calling 档位)。 */
export function supportsAgent(p: AiProvider): boolean {
  return !!p.agentModel;
}
