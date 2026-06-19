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
import type { FloorPlan, ExteriorSettings } from "./types";

export interface ShowcaseTemplate {
  id: string;
  nameZh: string;
  nameEn: string;
  descZh: string;
  descEn: string;
  /** 标签（楼层数 / 风格等），画廊卡片上展示。 */
  tags: string[];
  /** 返回可直接灌进 store 的方案（全新深拷贝）。 */
  load: () => { floorPlans: FloorPlan[]; exterior: Partial<ExteriorSettings> };
}

export const SHOWCASE_TEMPLATES: ShowcaseTemplate[] = [
  {
    id: "resort-pool-villa",
    nameZh: "度假泳池别墅",
    nameEn: "Resort Pool Villa",
    descZh: "现代极简外立面 · 泳池度假庭院 · 三层布局",
    descEn: "Modern minimal facade · Resort pool yard · 3 floors",
    tags: ["3F", "现代极简", "泳池院"],
    load: () => {
      const p = makeDefaultProject();
      return { floorPlans: p.floorPlans, exterior: p.exterior };
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
      return { floorPlans: p.floorPlans, exterior: { ...p.exterior, ...gc, preset: "glass-curtain" } };
    },
  },
  // ── 以后在此追加更多样板 / 用户投稿（也可改为运行时从 API 注入）──
];
