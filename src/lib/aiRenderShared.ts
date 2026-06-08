// ─── AI 出图：⚡ 一键直达 与 🎨 下拉 共用的一套逻辑 ──────────────────────────
// 截图、提示词选择都收敛到这里，保证两个入口行为一致（同一视图出同一种提示词）。

import { generateExteriorPrompt } from "./sceneToPrompt";
import type { ViewMode, ExteriorSettings, YardItem } from "./types";

// 提示词按「视图类型」分四种：室内写实 / 彩平图 / 院子景观 / 室外场景生成器。
export type PromptKind = "interior" | "exterior" | "plan" | "yard";

export const INTERIOR_PROMPT =
  "RAW photo, photorealistic interior design, ultra-detailed 8K, natural lighting, " +
  "Architectural Digest quality, professional real-estate photography, no people";
export const PLAN_PROMPT =
  "top-down colored architectural floor plan rendering, furnished rooms with clear furniture layout, " +
  "clean color-coded zones, professional 2D presentation plan, high detail, no people";
export const YARD_PROMPT =
  "landscape garden design rendering, courtyard with lawn, planting, paving and water feature, " +
  "soft daylight, photorealistic exterior landscape, ultra-detailed 8K, no people";

// 每个视图对应的提示词类型（六站全覆盖）。⚡ 与 🎨 都据此选词。
const VIEW_PROMPT_KIND: Partial<Record<ViewMode, PromptKind>> = {
  all:      "plan",
  "2d":     "interior",
  "3d":     "interior",
  global3d: "exterior",
  yard2d:   "yard",
  exterior: "exterior",
};

export function viewPromptKind(viewMode: ViewMode): PromptKind {
  return VIEW_PROMPT_KIND[viewMode] ?? "exterior";
}

export interface BuildPromptArgs {
  viewMode: ViewMode;
  exterior: ExteriorSettings;
  yardItems: YardItem[];
  sunHour?: number;
}

/** 按当前视图生成正向提示词：室内/彩平/院子用静态写实词，室外走场景生成器。 */
export function buildViewPrompt({ viewMode, exterior, yardItems, sunHour = 14 }: BuildPromptArgs): string {
  switch (viewPromptKind(viewMode)) {
    case "interior": return INTERIOR_PROMPT;
    case "plan":     return PLAN_PROMPT;
    case "yard":     return YARD_PROMPT;
    default:         return generateExteriorPrompt({ exterior, yardItems, sunHour }).positive;
  }
}

/** 抓当前 Three.js WebGL 画布为 PNG dataURL（needsImage 工作流用作输入图）。 */
export function captureCanvas(): string | null {
  const canvases = document.querySelectorAll<HTMLCanvasElement>("canvas");
  for (const c of canvases) {
    const ctx = c.getContext("webgl") ?? c.getContext("webgl2");
    if (ctx) return c.toDataURL("image/png");
  }
  return null;
}
