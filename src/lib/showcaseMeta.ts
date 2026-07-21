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
  /** 预渲染外观图（public/showcase/ 下的静态 JPG）。以 "/" 开头视为图片路径；
   *  否则当 emoji 占位（片场卡暂用 emoji，预览图以后补）。 */
  image: string;
  /** 片场类样板：查看器改调 store.applyProjectTemplate(该 id) 构建场景，
   *  而非 showcaseTemplates 的 load()。住宅样板不填此项。 */
  projectTemplateId?: string;
}

export const SHOWCASE_META: ShowcaseMeta[] = [
  {
    id: "resort-pool-villa",
    nameZh: "度假泳池别墅",
    nameEn: "Resort Pool Villa",
    descZh: "实墙开窗立面 · 泳池套组庭院 · 两层带天台",
    descEn: "Solid-wall facade · Pool-set yard · 2 floors + rooftop",
    tags: ["2F+天台", "实墙", "泳池院"],
    image: "/showcase/resort-pool-villa.jpg",
  },
  {
    id: "clear-glass-curtain-villa",
    nameZh: "通透玻璃幕墙别墅",
    nameEn: "Clear Glass-Curtain Villa",
    descZh: "通透玻璃幕墙 · 胡桃木挑檐 · 逐面可调立面 · 泳池庭院",
    descEn: "See-through glass curtain · walnut soffit · per-face facade · pool yard",
    tags: ["3F", "玻璃幕墙", "泳池院"],
    image: "/showcase/clear-glass-curtain-villa.jpg",
  },
  // ── 片场系列（云横店）：查看器走 applyProjectTemplate，缩略图暂用 emoji ──
  {
    id: "set-cafe",
    nameZh: "咖啡馆片场",
    nameEn: "Café Set",
    descZh: "玻璃门面 · 点单柜台+展示柜 · 密集桌位 · 书架墙",
    descEn: "Glass storefront · counter + display · dense tables · book wall",
    tags: ["片场", "咖啡馆", "单层"],
    image: "/showcase/set-cafe.jpg",
    projectTemplateId: "set-cafe",
  },
  {
    id: "set-office",
    nameZh: "办公室片场",
    nameEn: "Office Set",
    descZh: "开放工位 · 会议室 · 茶水间 · 玻璃幕墙",
    descEn: "Open desks · meeting room · pantry · glass facade",
    tags: ["片场", "办公室", "单层"],
    image: "💼",
    projectTemplateId: "set-office",
  },
  {
    id: "set-restaurant",
    nameZh: "小餐馆片场",
    nameEn: "Bistro Set",
    descZh: "四桌堂食 · 后厨中岛 · 市井暖调",
    descEn: "4-table dining · kitchen island · warm bistro",
    tags: ["片场", "餐馆", "单层"],
    image: "🍜",
    projectTemplateId: "set-restaurant",
  },
];
