/**
 * showcaseTemplates — /showcase 模板画廊的数据源。
 *
 * 目前只有 1 套内置样板（度假泳池别墅，复用 defaultProject）。结构刻意做成
 * 「数组 + load() 工厂」，方便以后追加：
 *   · 内置多套官方样板；
 *   · 用户投稿的得意设计（来源可换成 /api 拉取的远端列表，push 进来即可）。
 *
 * load() 每次返回全新深拷贝的方案数据，交给 /showcase 临时灌进 store 渲染
 * 外形图，不污染用户自己的设计（ShowcaseClient 负责备份/还原）。
 */
import { makeDefaultProject } from "./defaultProject";
import { EXTERIOR_PRESETS } from "./exteriorPresets";
import type { FloorPlan, ExteriorSettings, YardPlan } from "./types";

const EMPTY_YARD: YardPlan = { items: [], paths: [] };
/** Yard for the showcase preview lives on floorPlans[0].yardPlan in the
 *  default project (cold-start reads it the same way). */
function defaultYard(p: { floorPlans: FloorPlan[] }): YardPlan {
  return (p.floorPlans[0] as FloorPlan & { yardPlan?: YardPlan }).yardPlan ?? EMPTY_YARD;
}

export interface ShowcaseTemplate {
  id: string;
  nameZh: string;
  nameEn: string;
  descZh: string;
  descEn: string;
  /** 标签（楼层数 / 风格等），画廊卡片上展示。 */
  tags: string[];
  /** 返回可直接灌进 store 的方案（全新深拷贝）。yardPlan 让样板预览也显示
   *  院子（泳池套组等）。 */
  load: () => { floorPlans: FloorPlan[]; exterior: Partial<ExteriorSettings>; yardPlan: YardPlan };
}

export const SHOWCASE_TEMPLATES: ShowcaseTemplate[] = [
  {
    id: "resort-pool-villa",
    nameZh: "度假泳池别墅",
    nameEn: "Resort Pool Villa",
    descZh: "实墙开窗立面 · 泳池套组庭院 · 两层带天台",
    descEn: "Solid-wall facade · Pool-set yard · 2 floors + rooftop",
    tags: ["2F+天台", "实墙", "泳池院"],
    load: () => {
      // 与右边的玻璃幕墙别墅区分：同一套户型 + 院子，外观切成 punched-window
      // （实墙开窗），做成"实墙立面"版样板。
      const p = makeDefaultProject();
      return {
        floorPlans: p.floorPlans,
        exterior: { ...p.exterior, facadeSystem: "punched-window", facadeGlass: false, preset: undefined },
        yardPlan: defaultYard(p),
      };
    },
  },
  {
    id: "clear-glass-curtain-villa",
    nameZh: "通透玻璃幕墙别墅",
    nameEn: "Clear Glass-Curtain Villa",
    descZh: "通透玻璃幕墙 · 胡桃木挑檐 · 逐面可调立面 · 泳池庭院",
    descEn: "See-through glass curtain · walnut soffit · per-face facade · pool yard",
    tags: ["3F", "玻璃幕墙", "泳池院"],
    load: () => {
      // 同一套 defaultProject 户型，叠加 glass-curtain 外观预设 → 通透玻璃幕墙立面。
      const p = makeDefaultProject();
      const gc = EXTERIOR_PRESETS.find((x) => x.id === "glass-curtain")?.settings ?? {};
      return { floorPlans: p.floorPlans, exterior: { ...p.exterior, ...gc, preset: "glass-curtain" }, yardPlan: defaultYard(p) };
    },
  },
  // ── 以后在此追加更多样板 / 用户投稿（也可改为运行时从 API 注入）──
];
