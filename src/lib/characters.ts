/**
 * characters —— 导演台角色原型 + 服装库（云横店 M5：人物资源）。
 *
 * 设计：角色与服装都是数据，不是散落在组件里的 if/else。
 *   · ARCHETYPES：短剧高频角色原型 id → {中文名, 入选理由, 常驻片场, 服装}。
 *     加新角色 = 往注册表加一条 + 往 COSTUMES 加服装，控制台 UI 自动出现。
 *   · COSTUMES：服装 id → {标签, 时代, 配色, 版型, 配件}。
 *     3D 层（ActorsLayer）只按这份数据给方块人换色/加裙摆/加配件——
 *     不导入任何新模型文件，全部是 Three.js 程序化几何。
 *   · 时代锁（era lock）：服装时代 × 片场时代，不匹配只警告、不拦截
 *     （与「可能越轴」徽章同款式）。片场时代来自 SET_ERA（按片场 id 查）；
 *     没有时代记录的片场一律不警告、不猜。
 *
 * 本文件零依赖（不 import cinematic / sceneSets），可直接用 tsc 编译后
 * 跑 node 逻辑校验。
 */

/** 时代 id。dynasty 系（秦汉～清）+ 史前/民国/现代；"ancient" 与
 *  "timeless" 只出现在服装一侧（通用古装 / 时代中立的占位素体）。 */
export type EraId =
  | "prehistoric" | "qin-han" | "wei-jin" | "tang" | "song" | "yuan"
  | "ming" | "qing" | "republican" | "modern"
  | "ancient" | "timeless";

export const ERA_LABELS: Record<EraId, { zh: string; en: string }> = {
  prehistoric: { zh: "史前", en: "Prehistoric" },
  "qin-han": { zh: "秦汉", en: "Qin–Han" },
  "wei-jin": { zh: "魏晋", en: "Wei–Jin" },
  tang: { zh: "唐代", en: "Tang" },
  song: { zh: "宋代", en: "Song" },
  yuan: { zh: "元代", en: "Yuan" },
  ming: { zh: "明代", en: "Ming" },
  qing: { zh: "清代", en: "Qing" },
  republican: { zh: "民国", en: "Republican" },
  modern: { zh: "现代", en: "Modern" },
  ancient: { zh: "古代（通用）", en: "Ancient (generic)" },
  timeless: { zh: "不限时代", en: "Timeless" },
};

/** 朝代集合：通用古装（ancient）在这些片场都算合身，民国/现代/史前不算。 */
const ANCIENT_DYNASTIES: EraId[] = ["qin-han", "wei-jin", "tang", "song", "yuan", "ming", "qing"];

/**
 * 片场时代表（按片场 id 查；与 sceneSets.ts 的清单对齐）。
 * 未列入的片场 = 没有时代记录 = 不分类、不警告、不猜：
 *   set-versailles（18 世纪法国宫廷）、set-washitsu（日本和室）、
 *   set-hanok（韩国韩屋）——三者都是海外古风，现有中国朝代体系套不上，
 *   等海外时代体系补上再分类。
 * set-rural-hall 是当代农村自建房（混凝土外立面、平顶），属现代。
 */
export const SET_ERA: Record<string, EraId> = {
  "set-cafe": "modern",
  "set-office": "modern",
  "set-restaurant": "modern",
  "set-apartment": "modern",
  "set-rural-hall": "modern",
  "set-villa-suburban": "modern",
  "set-school": "modern",
  "set-hospital": "modern",
  "set-ming-hall": "ming",
  "set-qing-sanxitang": "qing",
  "set-tang-palace": "tang",
  "set-song-study": "song",
  "set-shikumen": "republican",
  "set-qinhan": "qin-han",
  "set-weijin": "wei-jin",
  "set-yuan": "yuan",
  "set-banpo": "prehistoric",
  "set-hemudu": "prehistoric",
  "set-rural-republican": "republican",
};

/** 片场时代：有记录返回时代 id，无记录返回 undefined（不分类）。 */
export function setEra(setId: string | null | undefined): EraId | undefined {
  if (!setId) return undefined;
  return SET_ERA[setId];
}

/** 服装时代与片场时代是否合身。 */
export function costumeEraMatches(costumeEra: EraId, setEraId: EraId): boolean {
  if (costumeEra === "timeless") return true;
  if (costumeEra === setEraId) return true;
  if (costumeEra === "ancient" && ANCIENT_DYNASTIES.includes(setEraId)) return true;
  return false;
}

/** 服装配件（全部是程序化几何，见 ActorsLayer 的 CostumeAccessoryMesh）。 */
export type AccessoryKind =
  | "none" | "tie" | "cap" | "strawHat" | "crown" | "chefHat"
  | "helmet" | "sword" | "apron" | "backpack" | "headband" | "badge";

export interface CostumeColors {
  /** 上身（胶囊身） */
  torso: string;
  /** 双臂 */
  arms: string;
  /** 头（肤色；默认素体保留旧灰色，见 DEFAULT_COSTUME） */
  skin: string;
}

export interface CostumeDef {
  id: string;
  /** 所属原型；默认素体（default）不属于任何原型 */
  archetypeId?: string;
  labelZh: string;
  labelEn: string;
  /** 服装时代（决定时代锁） */
  era: EraId;
  colors: CostumeColors;
  /** 长袍/长裙：下身加一截锥形裙摆（古装袍、连衣裙、凤袍等） */
  skirt?: boolean;
  /** 配件（每套服装最多一件，取最具识别度的） */
  accessory: AccessoryKind;
  /** 配件颜色（缺省取 torso 色；帽/徽章等有自己的默认色时填） */
  accessoryColor?: string;
}

/** 默认素体：旧存档（无服装字段）与未知 id 一律回落到它——
 *  颜色与导演台 MVP 的旧方块人完全一致，时代 timeless（占位素体不触发时代锁）。 */
export const DEFAULT_COSTUME: CostumeDef = {
  id: "default",
  labelZh: "默认现代装",
  labelEn: "Default modern outfit",
  era: "timeless",
  colors: { torso: "#a8b0bc", arms: "#98a0ac", skin: "#c2c9d4" },
  accessory: "none",
};

export const COSTUMES: Record<string, CostumeDef> = {
  "ceo-suit": { id: "ceo-suit", archetypeId: "ceo", labelZh: "霸总西装", labelEn: "CEO suit", era: "modern",
    colors: { torso: "#1f2937", arms: "#1f2937", skin: "#d9a986" }, accessory: "tie", accessoryColor: "#7f1d1d" },
  "ceo-casual": { id: "ceo-casual", archetypeId: "ceo", labelZh: "休闲西装", labelEn: "Casual suit", era: "modern",
    colors: { torso: "#334155", arms: "#334155", skin: "#d9a986" }, accessory: "none" },
  "cinderella-plain": { id: "cinderella-plain", archetypeId: "cinderella", labelZh: "灰姑娘素裙", labelEn: "Plain dress", era: "modern",
    colors: { torso: "#9ca3af", arms: "#9ca3af", skin: "#e8c39a" }, skirt: true, accessory: "none" },
  "cinderella-gown": { id: "cinderella-gown", archetypeId: "cinderella", labelZh: "晚礼服", labelEn: "Evening gown", era: "modern",
    colors: { torso: "#f9a8d4", arms: "#f9a8d4", skin: "#e8c39a" }, skirt: true, accessory: "none" },
  "police-uniform": { id: "police-uniform", archetypeId: "police", labelZh: "警服", labelEn: "Police uniform", era: "modern",
    colors: { torso: "#1e3a5f", arms: "#1e3a5f", skin: "#d9a986" }, accessory: "cap", accessoryColor: "#17293f" },
  "doctor-coat": { id: "doctor-coat", archetypeId: "doctor", labelZh: "白大褂", labelEn: "White coat", era: "modern",
    colors: { torso: "#f8fafc", arms: "#f8fafc", skin: "#d9a986" }, accessory: "badge", accessoryColor: "#f59e0b" },
  "lawyer-suit": { id: "lawyer-suit", archetypeId: "lawyer", labelZh: "律师西装", labelEn: "Lawyer suit", era: "modern",
    colors: { torso: "#111827", arms: "#111827", skin: "#d9a986" }, accessory: "tie", accessoryColor: "#1e40af" },
  "wuxia-white": { id: "wuxia-white", archetypeId: "wuxia", labelZh: "白衣侠客袍", labelEn: "White wuxia robe", era: "ancient",
    colors: { torso: "#f1f5f9", arms: "#f1f5f9", skin: "#d9a986" }, skirt: true, accessory: "sword", accessoryColor: "#94a3b8" },
  "wuxia-black": { id: "wuxia-black", archetypeId: "wuxia", labelZh: "黑衣侠客袍", labelEn: "Black wuxia robe", era: "ancient",
    colors: { torso: "#1f2937", arms: "#1f2937", skin: "#d9a986" }, skirt: true, accessory: "sword", accessoryColor: "#94a3b8" },
  "fairy-pink": { id: "fairy-pink", archetypeId: "fairy", labelZh: "粉衣仙裙", labelEn: "Pink fairy dress", era: "ancient",
    colors: { torso: "#fbcfe8", arms: "#fbcfe8", skin: "#ecd0b8" }, skirt: true, accessory: "headband", accessoryColor: "#f472b6" },
  "fairy-white": { id: "fairy-white", archetypeId: "fairy", labelZh: "白衣仙袍", labelEn: "White immortal robe", era: "ancient",
    colors: { torso: "#ffffff", arms: "#e0e7ff", skin: "#ecd0b8" }, skirt: true, accessory: "headband", accessoryColor: "#c7d2fe" },
  "emperor-dragon": { id: "emperor-dragon", archetypeId: "emperor", labelZh: "皇帝龙袍", labelEn: "Dragon robe", era: "ancient",
    colors: { torso: "#b45309", arms: "#92400e", skin: "#d9a986" }, skirt: true, accessory: "crown", accessoryColor: "#f59e0b" },
  "empress-phoenix": { id: "empress-phoenix", archetypeId: "emperor", labelZh: "皇后凤袍", labelEn: "Phoenix robe", era: "ancient",
    colors: { torso: "#be123c", arms: "#9f1239", skin: "#ecd0b8" }, skirt: true, accessory: "crown", accessoryColor: "#f59e0b" },
  "eunuch-qing": { id: "eunuch-qing", archetypeId: "eunuch", labelZh: "清代太监服", labelEn: "Qing eunuch robe", era: "qing",
    colors: { torso: "#374151", arms: "#374151", skin: "#d9a986" }, skirt: true, accessory: "cap", accessoryColor: "#111827" },
  "maid-qing": { id: "maid-qing", archetypeId: "maid", labelZh: "清代丫鬟服", labelEn: "Qing maid dress", era: "qing",
    colors: { torso: "#5b7a99", arms: "#5b7a99", skin: "#e8c39a" }, skirt: true, accessory: "headband", accessoryColor: "#f8fafc" },
  "farmer-ancient": { id: "farmer-ancient", archetypeId: "farmer", labelZh: "古代粗布衣", labelEn: "Ancient coarse cloth", era: "ancient",
    colors: { torso: "#8a6d4b", arms: "#8a6d4b", skin: "#c98f5f" }, accessory: "strawHat", accessoryColor: "#d9b380" },
  "farmer-republican": { id: "farmer-republican", archetypeId: "farmer", labelZh: "民国农家衣", labelEn: "Republican farm clothes", era: "republican",
    colors: { torso: "#6b7280", arms: "#6b7280", skin: "#c98f5f" }, accessory: "strawHat", accessoryColor: "#d9b380" },
  "farmer-modern": { id: "farmer-modern", archetypeId: "farmer", labelZh: "现代农家衣", labelEn: "Modern farm clothes", era: "modern",
    colors: { torso: "#4d7c0f", arms: "#365314", skin: "#c98f5f" }, accessory: "cap", accessoryColor: "#365314" },
  "student-uniform": { id: "student-uniform", archetypeId: "student", labelZh: "校服", labelEn: "School uniform", era: "modern",
    colors: { torso: "#2563eb", arms: "#2563eb", skin: "#e8c39a" }, accessory: "backpack", accessoryColor: "#1e40af" },
  "student-casual": { id: "student-casual", archetypeId: "student", labelZh: "学生便装", labelEn: "Student casual", era: "modern",
    colors: { torso: "#fbbf24", arms: "#fbbf24", skin: "#e8c39a" }, accessory: "none" },
  "teacher-modern": { id: "teacher-modern", archetypeId: "teacher", labelZh: "教师衬衫", labelEn: "Teacher shirt", era: "modern",
    colors: { torso: "#e0f2fe", arms: "#e0f2fe", skin: "#d9a986" }, accessory: "none" },
  "waiter-uniform": { id: "waiter-uniform", archetypeId: "waiter", labelZh: "服务员制服", labelEn: "Waiter uniform", era: "modern",
    colors: { torso: "#111827", arms: "#111827", skin: "#d9a986" }, accessory: "apron", accessoryColor: "#f8fafc" },
  "guard-uniform": { id: "guard-uniform", archetypeId: "guard", labelZh: "保安制服", labelEn: "Security uniform", era: "modern",
    colors: { torso: "#1f2937", arms: "#1f2937", skin: "#d9a986" }, accessory: "cap", accessoryColor: "#111827" },
  "rider-uniform": { id: "rider-uniform", archetypeId: "rider", labelZh: "外卖骑手服", labelEn: "Delivery rider uniform", era: "modern",
    colors: { torso: "#facc15", arms: "#eab308", skin: "#c98f5f" }, accessory: "helmet", accessoryColor: "#facc15" },
  "programmer-casual": { id: "programmer-casual", archetypeId: "programmer", labelZh: "程序员卫衣", labelEn: "Programmer hoodie", era: "modern",
    colors: { torso: "#6b7280", arms: "#6b7280", skin: "#d9a986" }, accessory: "none" },
  "influencer-trendy": { id: "influencer-trendy", archetypeId: "influencer", labelZh: "网红潮服", labelEn: "Influencer outfit", era: "modern",
    colors: { torso: "#ec4899", arms: "#db2777", skin: "#ecd0b8" }, accessory: "none" },
  "nurse-uniform": { id: "nurse-uniform", archetypeId: "nurse", labelZh: "护士服", labelEn: "Nurse uniform", era: "modern",
    colors: { torso: "#fdf2f8", arms: "#fdf2f8", skin: "#e8c39a" }, accessory: "cap", accessoryColor: "#ffffff" },
  "chef-whites": { id: "chef-whites", archetypeId: "chef", labelZh: "厨师服", labelEn: "Chef whites", era: "modern",
    colors: { torso: "#ffffff", arms: "#ffffff", skin: "#d9a986" }, accessory: "chefHat", accessoryColor: "#ffffff" },
  "driver-uniform": { id: "driver-uniform", archetypeId: "driver", labelZh: "司机服", labelEn: "Driver uniform", era: "modern",
    colors: { torso: "#334155", arms: "#334155", skin: "#d9a986" }, accessory: "cap", accessoryColor: "#1e293b" },
  "officer-uniform": { id: "officer-uniform", archetypeId: "officer", labelZh: "军官服", labelEn: "Officer uniform", era: "modern",
    colors: { torso: "#365314", arms: "#365314", skin: "#d9a986" }, accessory: "cap", accessoryColor: "#1a2e05" },
  "merchant-ancient": { id: "merchant-ancient", archetypeId: "merchant", labelZh: "古代商人袍", labelEn: "Ancient merchant robe", era: "ancient",
    colors: { torso: "#92400e", arms: "#92400e", skin: "#d9a986" }, skirt: true, accessory: "none" },
  "merchant-modern": { id: "merchant-modern", archetypeId: "merchant", labelZh: "现代商人西装", labelEn: "Modern merchant suit", era: "modern",
    colors: { torso: "#1e293b", arms: "#1e293b", skin: "#d9a986" }, accessory: "tie", accessoryColor: "#b45309" },
  "scholar-robe": { id: "scholar-robe", archetypeId: "scholar", labelZh: "书生青衫", labelEn: "Scholar robe", era: "ancient",
    colors: { torso: "#e7e5e4", arms: "#e7e5e4", skin: "#d9a986" }, skirt: true, accessory: "cap", accessoryColor: "#111827" },
  "scholar-white": { id: "scholar-white", archetypeId: "scholar", labelZh: "书生白衫", labelEn: "Scholar white robe", era: "ancient",
    colors: { torso: "#f5f5f4", arms: "#f5f5f4", skin: "#d9a986" }, skirt: true, accessory: "none" },
};

/** 服装查表：未知 id 安全回落默认素体，绝不抛错。 */
export function resolveCostume(id?: string | null): CostumeDef {
  if (!id) return DEFAULT_COSTUME;
  return COSTUMES[id] ?? DEFAULT_COSTUME;
}

export interface ArchetypeDef {
  id: string;
  nameZh: string;
  nameEn: string;
  /** 入选理由（按短剧实际出现频率） */
  whyZh: string;
  whyEn: string;
  /** 常驻片场（set id；仅作 UI 提示/文档，不参与时代锁判定） */
  typicalScenes: string[];
  /** 该原型可选服装（至少一件；第一件为默认） */
  costumes: string[];
}

/**
 * 角色原型注册表（24 个）。入选按短剧实际出现频率：
 * 霸总/灰姑娘是现代短剧男女主标配；警/医/律是三大职业剧支柱；
 * 侠客/仙子/皇帝/太监/丫鬟/书生是古装·宫斗·仙侠的常驻身份；
 * 农民/学生/老师/服务员/保安/外卖员/程序员/网红是都市·校园·乡土剧
 * 的高频配角；护士/厨师/司机/军官/商人是职业剧第二梯队的常见身份。
 */
export const ARCHETYPES: ArchetypeDef[] = [
  { id: "ceo", nameZh: "霸总", nameEn: "CEO", whyZh: "现代短剧男主标配，出场率最高", whyEn: "The default male lead of modern short dramas", typicalScenes: ["set-office", "set-villa-suburban", "set-restaurant"], costumes: ["ceo-suit", "ceo-casual"] },
  { id: "cinderella", nameZh: "灰姑娘/小白花", nameEn: "Cinderella", whyZh: "现代短剧女主标配，与霸总对戏", whyEn: "The default female lead, paired with the CEO", typicalScenes: ["set-apartment", "set-office", "set-cafe"], costumes: ["cinderella-plain", "cinderella-gown"] },
  { id: "police", nameZh: "警察", nameEn: "Police officer", whyZh: "刑侦/警匪短剧主力，制服识别度最高", whyEn: "Lead of crime/police dramas; uniform reads instantly", typicalScenes: ["set-office", "set-apartment", "set-school"], costumes: ["police-uniform"] },
  { id: "doctor", nameZh: "医生", nameEn: "Doctor", whyZh: "医疗短剧主力，白大褂一眼可认", whyEn: "Lead of medical dramas", typicalScenes: ["set-hospital"], costumes: ["doctor-coat"] },
  { id: "lawyer", nameZh: "律师", nameEn: "Lawyer", whyZh: "律政短剧主力，常与霸总/总裁戏交叉", whyEn: "Lead of legal dramas", typicalScenes: ["set-office"], costumes: ["lawyer-suit"] },
  { id: "wuxia", nameZh: "古装侠客", nameEn: "Wuxia hero", whyZh: "武侠短剧核心，御剑/打斗戏的标配身份", whyEn: "Core of wuxia dramas; the sword-flying identity", typicalScenes: ["set-tang-palace", "set-song-study", "set-weijin", "set-yuan"], costumes: ["wuxia-white", "wuxia-black"] },
  { id: "fairy", nameZh: "仙子/仙女", nameEn: "Fairy", whyZh: "仙侠短剧女主标配，与侠客/帝君对戏", whyEn: "Female lead of xianxia dramas", typicalScenes: ["set-tang-palace", "set-song-study"], costumes: ["fairy-pink", "fairy-white"] },
  { id: "emperor", nameZh: "皇帝/皇后", nameEn: "Emperor / Empress", whyZh: "宫斗/帝王短剧核心，龙袍凤袍即身份", whyEn: "Core of palace dramas; the robe is the identity", typicalScenes: ["set-tang-palace", "set-ming-hall", "set-qing-sanxitang", "set-song-study"], costumes: ["emperor-dragon", "empress-phoenix"] },
  { id: "eunuch", nameZh: "太监", nameEn: "Eunuch", whyZh: "宫斗短剧高频配角；清代造型（马褂+太监帽）最具识别度，故服装锁清代", whyEn: "Frequent palace-drama supporting role; Qing styling is the recognisable one, so the costume is Qing-locked", typicalScenes: ["set-qing-sanxitang"], costumes: ["eunuch-qing"] },
  { id: "maid", nameZh: "丫鬟", nameEn: "Maid", whyZh: "宫斗/古装短剧高频配角；同太监，造型取清代丫鬟", whyEn: "Frequent period-drama supporting role; Qing styling like the eunuch", typicalScenes: ["set-qing-sanxitang"], costumes: ["maid-qing"] },
  { id: "farmer", nameZh: "农民", nameEn: "Farmer", whyZh: "乡土/农村短剧主力；横跨古今，故三套服装各锁一个时代段", whyEn: "Lead of rural dramas; spans all eras, so one costume per era band", typicalScenes: ["set-rural-hall", "set-rural-republican"], costumes: ["farmer-ancient", "farmer-republican", "farmer-modern"] },
  { id: "student", nameZh: "学生", nameEn: "Student", whyZh: "校园短剧主力，校服+书包一眼可认", whyEn: "Lead of school dramas", typicalScenes: ["set-school"], costumes: ["student-uniform", "student-casual"] },
  { id: "teacher", nameZh: "老师", nameEn: "Teacher", whyZh: "校园短剧高频配角，常与学生对戏", whyEn: "Frequent school-drama supporting role", typicalScenes: ["set-school"], costumes: ["teacher-modern"] },
  { id: "waiter", nameZh: "服务员", nameEn: "Waiter", whyZh: "都市短剧高频配角，咖啡馆/餐厅戏必备", whyEn: "Frequent urban-drama supporting role; cafés and restaurants need one", typicalScenes: ["set-cafe", "set-restaurant"], costumes: ["waiter-uniform"] },
  { id: "guard", nameZh: "保安", nameEn: "Security guard", whyZh: "都市短剧高频配角，写字楼/小区门禁戏常见", whyEn: "Frequent urban-drama supporting role", typicalScenes: ["set-office", "set-apartment", "set-school"], costumes: ["guard-uniform"] },
  { id: "rider", nameZh: "外卖员", nameEn: "Delivery rider", whyZh: "都市短剧高频身份，黄头盔+黄衣识别度极高", whyEn: "Frequent urban-drama identity; yellow helmet reads instantly", typicalScenes: ["set-office", "set-apartment", "set-restaurant"], costumes: ["rider-uniform"] },
  { id: "programmer", nameZh: "程序员", nameEn: "Programmer", whyZh: "职场/都市短剧高频配角，卫衣即标签", whyEn: "Frequent workplace-drama supporting role", typicalScenes: ["set-office"], costumes: ["programmer-casual"] },
  { id: "influencer", nameZh: "网红", nameEn: "Influencer", whyZh: "直播/网红题材短剧近年的高频主角", whyEn: "Frequent lead of livestream/influencer dramas", typicalScenes: ["set-cafe", "set-apartment", "set-office"], costumes: ["influencer-trendy"] },
  { id: "nurse", nameZh: "护士", nameEn: "Nurse", whyZh: "医疗短剧第二主角，与医生对戏", whyEn: "Second lead of medical dramas, paired with the doctor", typicalScenes: ["set-hospital"], costumes: ["nurse-uniform"] },
  { id: "chef", nameZh: "厨师", nameEn: "Chef", whyZh: "美食短剧主力，厨师帽+白衣一眼可认", whyEn: "Lead of food dramas", typicalScenes: ["set-restaurant", "set-cafe"], costumes: ["chef-whites"] },
  { id: "driver", nameZh: "司机", nameEn: "Driver", whyZh: "都市/霸总短剧高频配角（总裁司机）", whyEn: "Frequent urban-drama supporting role (the CEO's driver)", typicalScenes: ["set-office", "set-villa-suburban"], costumes: ["driver-uniform"] },
  { id: "officer", nameZh: "军官", nameEn: "Officer", whyZh: "军旅/特种兵短剧高频主角，军装识别度高", whyEn: "Frequent lead of military dramas", typicalScenes: ["set-office", "set-villa-suburban"], costumes: ["officer-uniform"] },
  { id: "merchant", nameZh: "商人", nameEn: "Merchant", whyZh: "古装经商剧与现代商战剧都有，横跨古今故两套服装", whyEn: "Appears in both period trade dramas and modern business dramas", typicalScenes: ["set-tang-palace", "set-song-study", "set-office", "set-restaurant"], costumes: ["merchant-ancient", "merchant-modern"] },
  { id: "scholar", nameZh: "书生", nameEn: "Scholar", whyZh: "古装文人短剧高频主角，书斋戏的标配身份", whyEn: "Frequent lead of period literati dramas; the study-scene identity", typicalScenes: ["set-song-study", "set-ming-hall", "set-weijin"], costumes: ["scholar-robe", "scholar-white"] },
];

export function resolveArchetype(id?: string | null): ArchetypeDef | undefined {
  if (!id) return undefined;
  return ARCHETYPES.find((a) => a.id === id);
}

/** 原型的可选服装（全部解析后返回；原型未知返回空数组）。 */
export function costumesForArchetype(archetypeId: string): CostumeDef[] {
  const a = resolveArchetype(archetypeId);
  if (!a) return [];
  return a.costumes.map((c) => resolveCostume(c));
}

/** 原型的默认服装（第一件；原型未知返回默认素体）。 */
export function defaultCostumeForArchetype(archetypeId?: string | null): CostumeDef {
  const a = resolveArchetype(archetypeId);
  if (!a || a.costumes.length === 0) return DEFAULT_COSTUME;
  return resolveCostume(a.costumes[0]);
}

/** 演员身上的服装：costumeId 优先；只有原型无服装时取原型默认；
 *  全部缺失/未知 → 默认素体（旧存档兼容）。 */
export function resolveActorCostume(a: { archetypeId?: string | null; costumeId?: string | null }): CostumeDef {
  if (a.costumeId) return resolveCostume(a.costumeId);
  if (a.archetypeId) return defaultCostumeForArchetype(a.archetypeId);
  return DEFAULT_COSTUME;
}

/** 演员的原型：未知 id 返回 undefined（UI 显示"未选原型"）。 */
export function resolveActorArchetype(a: { archetypeId?: string | null }): ArchetypeDef | undefined {
  return resolveArchetype(a.archetypeId);
}

export interface EraWarning {
  costume: CostumeDef;
  setEraId: EraId;
  messageZh: string;
  messageEn: string;
}

/**
 * 时代锁警告（只警告、不拦截）：
 *  - 服装 timeless（默认素体）→ 不警告；
 *  - 片场无时代记录（未分类）→ 不警告、不猜；
 *  - 时代合身（同朝代，或通用古装落在任一朝代片场）→ 不警告；
 *  - 否则返回警告文案（UI 用「可能越轴」同款琥珀徽章展示）。
 */
export function eraWarningFor(
  costumeId: string | null | undefined,
  setId: string | null | undefined,
): EraWarning | null {
  const costume = resolveCostume(costumeId);
  if (costume.era === "timeless") return null;
  const era = setEra(setId);
  if (!era) return null;
  if (costumeEraMatches(costume.era, era)) return null;
  return {
    costume,
    setEraId: era,
    messageZh: `时代不符：${costume.labelZh}属${ERA_LABELS[costume.era].zh}，当前片场属${ERA_LABELS[era].zh}`,
    messageEn: `Era mismatch: ${costume.labelEn} is ${ERA_LABELS[costume.era].en}, this set is ${ERA_LABELS[era].en}`,
  };
}
