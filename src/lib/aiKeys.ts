// ─── 视觉 / LLM 服务 BYOK 密钥 ──────────────────────────────────────────────
//
// 与出图后端（aiRenderConfig）分开：那边是 ComfyUI / RunningHub「工作流」语言，
// 这里是大模型 API（户型解析、外观解析、文生设计等）。两者服务商不同，各管各的
// 密钥，避免互相耦合。平台清单见 [[aiProviders]]（注册表，加平台只改那一处）。
//
// 密钥只存浏览器 localStorage，随请求传给本站代理路由，绝不落服务端、不被回显。
// 另外记一个「当前选中的平台」，下次解析直接用上次选的那家，省得每次重选。

import { AiProviderId, DEFAULT_AI_PROVIDER } from "./aiProviders";

const KEYS_STORAGE     = "home-designer-ai-keys";
const PROVIDER_STORAGE = "home-designer-ai-provider";

type KeyMap = Partial<Record<AiProviderId, string>>;

function readMap(): KeyMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEYS_STORAGE);
    return raw ? (JSON.parse(raw) as KeyMap) : {};
  } catch {
    return {};
  }
}

/** 取某平台的 BYOK 密钥（无则空串） */
export function getAiKey(provider: AiProviderId): string {
  return readMap()[provider]?.trim() ?? "";
}

/** 写入 / 更新某平台的密钥（空串视为清除） */
export function setAiKey(provider: AiProviderId, key: string): void {
  if (typeof window === "undefined") return;
  const map = readMap();
  const trimmed = key.trim();
  if (trimmed) map[provider] = trimmed;
  else delete map[provider];
  window.localStorage.setItem(KEYS_STORAGE, JSON.stringify(map));
}

/** 当前选中的平台（默认智谱） */
export function getSelectedProvider(): AiProviderId {
  if (typeof window === "undefined") return DEFAULT_AI_PROVIDER;
  const v = window.localStorage.getItem(PROVIDER_STORAGE);
  return (v as AiProviderId) || DEFAULT_AI_PROVIDER;
}

/** 记住用户选的平台 */
export function setSelectedProvider(provider: AiProviderId): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROVIDER_STORAGE, provider);
}
