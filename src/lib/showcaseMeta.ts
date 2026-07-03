/**
 * showcaseMeta — 样板间画廊卡片的「纯元数据」（零依赖）。
 *
 * 关键：画廊页只需要每套样板的名字/描述/标签来渲染卡片，绝不该为此把
 * defaultProject + 整个家具目录 + three.js 拖进画廊的 JS 包。所以卡片文案
 * 单独放这里（不 import 任何重模块），画廊只引本文件 → 落地几乎瞬间。
 *
 * 真正渲染样板要用的 load() 方案工厂（会拉家具目录/预设）留在
 * showcaseTemplates.ts，只有点「查看外形」动态加载查看器时才引入。
 */
export interface ShowcaseMeta {
  id: string;
  nameZh: string;
  nameEn: string;
  descZh: string;
  descEn: string;
  /** 标签（楼层数 / 风格等），画廊卡片上展示。 */
  tags: string[];
}

export const SHOWCASE_META: ShowcaseMeta[] = [
  {
    id: "resort-pool-villa",
    nameZh: "度假泳池别墅",
    nameEn: "Resort Pool Villa",
    descZh: "实墙开窗立面 · 泳池套组庭院 · 两层带天台",
    descEn: "Solid-wall facade · Pool-set yard · 2 floors + rooftop",
    tags: ["2F+天台", "实墙", "泳池院"],
  },
  {
    id: "clear-glass-curtain-villa",
    nameZh: "通透玻璃幕墙别墅",
    nameEn: "Clear Glass-Curtain Villa",
    descZh: "通透玻璃幕墙 · 胡桃木挑檐 · 逐面可调立面 · 泳池庭院",
    descEn: "See-through glass curtain · walnut soffit · per-face facade · pool yard",
    tags: ["3F", "玻璃幕墙", "泳池院"],
  },
  // ── 以后在此追加更多样板卡片（load 工厂同步加到 showcaseTemplates.ts）──
];
