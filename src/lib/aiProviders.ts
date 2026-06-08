// ─── 大模型平台注册表（视觉 + 文本，全部 OpenAI 兼容） ──────────────────────
//
// 户型解析 / 外观解析需要「视觉」模型，文生设计是「纯文本」；这里每个平台都
// 登记 visionModel + textModel。前端弹窗下拉、后端代理查表都复用同一份注册表，
// 避免「加一个平台要改三处」。密钥仍只存浏览器本地，随请求转发，不落服务端。
//
// 选型口径：都挑「OpenAI /chat/completions 兼容 + 有视觉模型」的常见平台，
// 这样三类任务（视觉解析 / 文生设计）用同一套消息格式即可，无需为某家特判。

export type AiProviderId =
  | "zhipu" | "openai" | "qwen" | "moonshot" | "gemini" | "grok" | "claude";

export interface AiProvider {
  id: AiProviderId;
  label: string;        // 下拉显示名
  endpoint: string;     // OpenAI 兼容 /chat/completions
  visionModel: string;  // 户型 / 外观 解析
  textModel: string;    // 文生设计
  keyHint: string;      // 「去哪申请」提示
  helpUrl: string;      // 申请链接
}

export const AI_PROVIDERS: Record<AiProviderId, AiProvider> = {
  zhipu: {
    id: "zhipu",
    label: "智谱 GLM（国内 · 有免费额度）",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    visionModel: "glm-4v-flash",
    textModel: "glm-4",
    keyHint: "在智谱开放平台「API Keys」页面创建。",
    helpUrl: "https://open.bigmodel.cn/usercenter/apikeys",
  },
  openai: {
    id: "openai",
    label: "OpenAI（GPT-4o）",
    endpoint: "https://api.openai.com/v1/chat/completions",
    visionModel: "gpt-4o",
    textModel: "gpt-4o-mini",
    keyHint: "在 OpenAI Platform「API keys」页面创建。",
    helpUrl: "https://platform.openai.com/api-keys",
  },
  qwen: {
    id: "qwen",
    label: "通义千问 Qwen（阿里百炼）",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    visionModel: "qwen-vl-max",
    textModel: "qwen-plus",
    keyHint: "在阿里云百炼 DashScope 控制台创建 API-KEY。",
    helpUrl: "https://bailian.console.aliyun.com/?apiKey=1#/api-key",
  },
  moonshot: {
    id: "moonshot",
    label: "Kimi / Moonshot",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    visionModel: "moonshot-v1-8k-vision-preview",
    textModel: "moonshot-v1-8k",
    keyHint: "在 Moonshot 开放平台「API Key 管理」页面创建。",
    helpUrl: "https://platform.moonshot.cn/console/api-keys",
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
  },
  grok: {
    id: "grok",
    label: "xAI Grok",
    endpoint: "https://api.x.ai/v1/chat/completions",
    visionModel: "grok-2-vision-1212",
    textModel: "grok-3",
    keyHint: "在 xAI 控制台「API Keys」创建。",
    helpUrl: "https://console.x.ai",
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
  },
};

export const AI_PROVIDER_LIST = Object.values(AI_PROVIDERS);
export const DEFAULT_AI_PROVIDER: AiProviderId = "zhipu";

/** 容错查表：未知 / 缺省 id 一律回退到默认平台 */
export function getAiProvider(id: string | undefined | null): AiProvider {
  return AI_PROVIDERS[(id ?? "") as AiProviderId] ?? AI_PROVIDERS[DEFAULT_AI_PROVIDER];
}
