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
  /** 标签（楼层数 / 风格等），画廊卡片上展示。中英各一份，按 locale 选。 */
  tagsZh: string[];
  tagsEn: string[];
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
    // 文案按实际渲染校正：院子里已无泳池，改述真实卖点(独立车库/天台露台)。
    // id 与图片文件名保留原样，避免改动路由/资源引用。
    nameZh: "度假别墅",
    nameEn: "Resort Villa",
    descZh: "实墙开窗立面 · 独立车库 · 两层带天台露台",
    descEn: "Solid-wall facade · Detached garage · 2 floors + rooftop terrace",
    tagsZh: ["2F+天台", "实墙", "车库"],
    tagsEn: ["2F + rooftop", "Solid wall", "Garage"],
    image: "/showcase/resort-pool-villa.jpg",
  },
  {
    id: "clear-glass-curtain-villa",
    nameZh: "通透玻璃幕墙别墅",
    nameEn: "Clear Glass-Curtain Villa",
    descZh: "通透玻璃幕墙 · 胡桃木挑檐 · 逐面可调立面 · 独立车库",
    descEn: "See-through glass curtain · walnut soffit · per-face facade · garage",
    tagsZh: ["3F", "玻璃幕墙", "车库"],
    tagsEn: ["3F", "Glass curtain", "Garage"],
    image: "/showcase/clear-glass-curtain-villa.jpg",
  },
  // ── 片场系列（云横店）：查看器走 applyProjectTemplate，缩略图暂用 emoji ──
  {
    id: "set-cafe",
    nameZh: "咖啡馆片场",
    nameEn: "Café Set",
    descZh: "玻璃门面 · 点单柜台+展示柜 · 密集桌位 · 书架墙",
    descEn: "Glass storefront · counter + display · dense tables · book wall",
    tagsZh: ["片场", "咖啡馆", "单层"],
    tagsEn: ["Set", "Café", "Single floor"],
    image: "/showcase/set-cafe.jpg",
    projectTemplateId: "set-cafe",
  },
  {
    id: "set-office",
    nameZh: "办公室片场",
    nameEn: "Office Set",
    descZh: "回字形大厅环绕 · 开放工位 · 会议室 · 独立办公室 · 茶水间",
    descEn: "Ring lobby wrap · open desks · meeting room · private office · pantry",
    tagsZh: ["片场", "办公室", "单层"],
    tagsEn: ["Set", "Office", "Single floor"],
    image: "/showcase/set-office.jpg",
    projectTemplateId: "set-office",
  },
  {
    id: "set-restaurant",
    nameZh: "餐厅片场",
    nameEn: "Restaurant Set",
    descZh: "大堂散座 · 包间×2+VIP · 商用后厨 · 男女洗手间 · 骑楼露天",
    descEn: "Dining hall · 2 private + VIP rooms · pro kitchen · M/F WC · patio",
    tagsZh: ["片场", "餐馆", "单层"],
    tagsEn: ["Set", "Restaurant", "Single floor"],
    image: "/showcase/set-restaurant.jpg",
    projectTemplateId: "set-restaurant",
  },
];
