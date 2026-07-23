/**
 * showcaseTemplates — /showcase 样板的「方案工厂」（重模块）。
 *
 * 卡片文案在轻量的 showcaseMeta.ts；这里只补每套样板的 load() —— 返回可直接
 * 灌进 store 的完整方案（会拉 defaultProject/家具目录/外观预设，故只在查看器
 * 动态加载时才引入，不进画廊的 JS 包）。
 *
 * load() 每次返回全新深拷贝的方案数据，交给查看器临时灌进 store 渲染外形图，
 * 不污染用户自己的设计（ShowcaseViewer 负责备份/还原）。
 *
 * 结构留口给以后追加：内置多套官方样板、用户投稿（可换成 /api 拉远端列表）。
 */
import { makeDefaultProject } from "./defaultProject";
import { EXTERIOR_PRESETS } from "./exteriorPresets";
import { SHOWCASE_META, type ShowcaseMeta } from "./showcaseMeta";
import type { FloorPlan, ExteriorSettings, YardPlan } from "./types";

const EMPTY_YARD: YardPlan = { items: [], paths: [] };
/** Yard for the showcase preview lives on floorPlans[0].yardPlan in the
 *  default project (cold-start reads it the same way). */
function defaultYard(p: { floorPlans: FloorPlan[] }): YardPlan {
  return (p.floorPlans[0] as FloorPlan & { yardPlan?: YardPlan }).yardPlan ?? EMPTY_YARD;
}

export interface ShowcaseTemplate extends ShowcaseMeta {
  /** 返回可直接灌进 store 的方案（全新深拷贝）。yardPlan 让样板预览也显示
   *  院子（泳池套组等）。 */
  /** 住宅样板的方案工厂；片场样板（projectTemplateId）不用它，故可选。 */
  load?: () => { floorPlans: FloorPlan[]; exterior: Partial<ExteriorSettings>; yardPlan: YardPlan };
}

/** 按 id 挂 load 工厂；顺序/文案以 SHOWCASE_META 为准（单一数据源）。 */
const LOADERS: Record<string, ShowcaseTemplate["load"]> = {
  "resort-pool-villa": () => {
    // 与右边的玻璃幕墙别墅区分：同一套户型 + 院子，外观切成 punched-window
    // （实墙开窗）。transparentExterior:true 是关键——默认方案是玻璃幕墙、
    // 存的 transparentExterior=false，直接切实墙会触发「两段式厚基座(看着像
    // 两层地板) + 不透明静态窗(打不开)」；置 true 后是薄压边基座 + 透明可
    // 开启的 StyledWindow/门（参考 6-17 实墙方案）。
    const p = makeDefaultProject();
    return {
      floorPlans: p.floorPlans,
      exterior: {
        ...p.exterior,
        facadeSystem: "punched-window",
        facadeGlass: false,
        transparentExterior: true,
        preset: undefined,
      },
      yardPlan: defaultYard(p),
    };
  },
  "clear-glass-curtain-villa": () => {
    // 同一套 defaultProject 户型，叠加 glass-curtain 外观预设 → 通透玻璃幕墙立面。
    const p = makeDefaultProject();
    const gc = EXTERIOR_PRESETS.find((x) => x.id === "glass-curtain")?.settings ?? {};
    return { floorPlans: p.floorPlans, exterior: { ...p.exterior, ...gc, preset: "glass-curtain" }, yardPlan: defaultYard(p) };
  },
};

export const SHOWCASE_TEMPLATES: ShowcaseTemplate[] = SHOWCASE_META.map((m) => ({
  ...m,
  load: LOADERS[m.id],
}));
