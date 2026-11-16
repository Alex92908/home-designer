/**
 * lighting —— 导演台灯光预设（云横店 M4-B）。
 *
 * 数据驱动：一组预设 = 一套 Three.js 灯光参数。导演台每镜存一个
 * lightingId（见 cinematic.ts 的 Shot.lightingId，缺省 = 跟随场景默认），
 * 拍摄模拟/录制时按镜切换（HouseCanvas 按 store 的当前镜解析出
 * 生效预设，见 useCineStore 的 activeCineLightingId 选择器）。
 *
 * 默认预设 "day" 的数值对齐现有日间主题（HouseCanvas getSkyTheme 在
 * 默认 sunHour 10.5 下的值：ambient ≈0.17、sun #FFF8F0 ≈1.10、
 * fill #C8E0F8 ≈0.27、hemi #C8DDEF/#A8A070 ≈0.36、室内 ambient 0.55、
 * 室内半球 1.2、室内顶灯 #FFF8E8 8.0、exposure ≈1.0），所以从不碰
 * 灯光的用户看到的画面不变；灯光覆盖只在导演台模拟/录制/预览时生效。
 *
 * 字段说明（每项预设必填，缺一不可）：
 *   ambient —— 环境光（室外值；颜色 + 强度）
 *   indoorAmbientIntensity —— 室内 ambient 强度（室内没有太阳，基准不同）
 *   directional —— 主光（位置 = 角度/方向，强度，颜色；室外是太阳，室内不用）
 *   fill —— 补光（颜色 + 强度；位置为主光的镜像方向，见 HouseCanvas）
 *   hemi —— 半球光（天空色/地面色/强度，室外）
 *   indoorHemiIntensity —— 室内半球光强度（室内基准 1.2）
 *   interiorPoint —— 室内顶灯（颜色 + 强度；每层一组点光）
 *   shadows —— 主光是否投射阴影（阴天关，别的开）
 *   background —— 背景色（室内 color 背景；室外取代 Sky 的纯色天 + 雾色基准）
 *   fogColor —— 雾色（室外）
 *   exposure —— toneMapping 曝光（绝对值，替代 theme.exposure）
 *   environmentIntensity —— HDR 环境光（IBL）强度；暗预设压低，免得白天 HDR
 *     把夜戏照亮
 *   stars —— 是否显示星空 + 月亮（只 night / moonlight）
 */
export type LightingId =
  | "day"
  | "night"
  | "dusk"
  | "overcast"
  | "warm"
  | "cold"
  | "dramatic"
  | "candlelight"
  | "neon"
  | "moonlight";

export interface LightingPreset {
  id: LightingId;
  nameZh: string;
  nameEn: string;
  emoji: string;
  /** 一句话：这光服务什么情绪/戏 */
  moodZh: string;
  moodEn: string;
  ambient: { color: string; intensity: number };
  indoorAmbientIntensity: number;
  directional: { position: [number, number, number]; intensity: number; color: string };
  fill: { color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  indoorHemiIntensity: number;
  interiorPoint: { color: string; intensity: number };
  shadows: boolean;
  background: string;
  fogColor: string;
  exposure: number;
  environmentIntensity: number;
  stars?: boolean;
}

export const DEFAULT_LIGHTING_ID: LightingId = "day";

export const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: "day",
    nameZh: "白天",
    nameEn: "Day",
    emoji: "☀️",
    moodZh: "日常 / 清晰明亮，适合大多数场景",
    moodEn: "Everyday / bright and clear, the default look",
    ambient: { color: "#FFFFFF", intensity: 0.17 },
    indoorAmbientIntensity: 0.55,
    directional: { position: [30, 45, 20], intensity: 1.1, color: "#FFF8F0" },
    fill: { color: "#C8E0F8", intensity: 0.27 },
    hemi: { sky: "#C8DDEF", ground: "#A8A070", intensity: 0.36 },
    indoorHemiIntensity: 1.2,
    interiorPoint: { color: "#FFF8E8", intensity: 8.0 },
    shadows: true,
    background: "#87CEEB",
    fogColor: "#C0D4E8",
    exposure: 1.0,
    environmentIntensity: 1.0,
  },
  {
    id: "night",
    nameZh: "夜晚",
    nameEn: "Night",
    emoji: "🌙",
    moodZh: "悬疑 / 夜戏 / 城市夜晚",
    moodEn: "Suspense / night scenes / city at night",
    ambient: { color: "#8FA3C8", intensity: 0.1 },
    indoorAmbientIntensity: 0.22,
    directional: { position: [-25, 38, -30], intensity: 0.25, color: "#B8C4D8" },
    fill: { color: "#3A4258", intensity: 0.12 },
    hemi: { sky: "#252D3F", ground: "#10131C", intensity: 0.18 },
    indoorHemiIntensity: 0.45,
    interiorPoint: { color: "#FFD9A0", intensity: 5.0 },
    shadows: true,
    background: "#0A0F1E",
    fogColor: "#181C28",
    exposure: 0.85,
    environmentIntensity: 0.35,
    stars: true,
  },
  {
    id: "dusk",
    nameZh: "黄昏 / 黄金时刻",
    nameEn: "Golden Hour",
    emoji: "🌇",
    moodZh: "浪漫 / 告别 / 怀旧",
    moodEn: "Romance / farewell / nostalgia",
    ambient: { color: "#FFD9B0", intensity: 0.22 },
    indoorAmbientIntensity: 0.45,
    directional: { position: [-35, 12, 25], intensity: 1.3, color: "#F89830" },
    fill: { color: "#8898C0", intensity: 0.3 },
    hemi: { sky: "#C86040", ground: "#503020", intensity: 0.5 },
    indoorHemiIntensity: 0.9,
    interiorPoint: { color: "#FFE0B0", intensity: 6.5 },
    shadows: true,
    background: "#E07840",
    fogColor: "#C87840",
    exposure: 1.05,
    environmentIntensity: 0.8,
  },
  {
    id: "overcast",
    nameZh: "阴天",
    nameEn: "Overcast",
    emoji: "☁️",
    moodZh: "压抑 / 平淡日常 / 纪实",
    moodEn: "Oppressive / flat everyday / documentary",
    ambient: { color: "#DDE3EA", intensity: 0.55 },
    indoorAmbientIntensity: 0.6,
    directional: { position: [10, 50, 5], intensity: 0.35, color: "#E8ECF0" },
    fill: { color: "#C8D0DC", intensity: 0.35 },
    hemi: { sky: "#C8CCD4", ground: "#8A8A80", intensity: 0.55 },
    indoorHemiIntensity: 1.1,
    interiorPoint: { color: "#FFF4E0", intensity: 7.0 },
    shadows: false,
    background: "#B8C0CC",
    fogColor: "#B8C0CC",
    exposure: 0.95,
    environmentIntensity: 0.7,
  },
  {
    id: "warm",
    nameZh: "暖光",
    nameEn: "Warm Interior",
    emoji: "💡",
    moodZh: "温馨 / 家庭 / 团聚",
    moodEn: "Warmth / family / reunion",
    ambient: { color: "#FFE8C8", intensity: 0.35 },
    indoorAmbientIntensity: 0.7,
    directional: { position: [15, 30, 10], intensity: 0.6, color: "#FFD9A0" },
    fill: { color: "#E8C8A0", intensity: 0.3 },
    hemi: { sky: "#FFE8C8", ground: "#C8B090", intensity: 0.45 },
    indoorHemiIntensity: 1.3,
    interiorPoint: { color: "#FFC978", intensity: 9.0 },
    shadows: true,
    background: "#F5E6D0",
    fogColor: "#E8D8C0",
    exposure: 1.0,
    environmentIntensity: 0.8,
  },
  {
    id: "cold",
    nameZh: "冷光",
    nameEn: "Cold Interior",
    emoji: "🧊",
    moodZh: "疏离 / 医院 / 办公室 / 科幻",
    moodEn: "Distance / hospital / office / sci-fi",
    ambient: { color: "#D8E8F8", intensity: 0.35 },
    indoorAmbientIntensity: 0.6,
    directional: { position: [-15, 35, 20], intensity: 0.7, color: "#D8E8FF" },
    fill: { color: "#B8C8E0", intensity: 0.3 },
    hemi: { sky: "#D8E8F8", ground: "#9098A8", intensity: 0.4 },
    indoorHemiIntensity: 1.2,
    interiorPoint: { color: "#D8E8FF", intensity: 7.0 },
    shadows: true,
    background: "#DCE8F2",
    fogColor: "#C8D8E8",
    exposure: 1.0,
    environmentIntensity: 0.9,
  },
  {
    id: "dramatic",
    nameZh: "戏剧光",
    nameEn: "Dramatic",
    emoji: "🎭",
    moodZh: "对峙 / 揭晓 / 审讯",
    moodEn: "Confrontation / reveal / interrogation",
    ambient: { color: "#606878", intensity: 0.06 },
    indoorAmbientIntensity: 0.12,
    directional: { position: [8, 25, 4], intensity: 2.2, color: "#FFF2D8" },
    fill: { color: "#20242E", intensity: 0.05 },
    hemi: { sky: "#3A3F4A", ground: "#14161C", intensity: 0.12 },
    indoorHemiIntensity: 0.25,
    interiorPoint: { color: "#FFE8C0", intensity: 3.0 },
    shadows: true,
    background: "#101218",
    fogColor: "#14161C",
    exposure: 0.95,
    environmentIntensity: 0.25,
  },
  {
    id: "candlelight",
    nameZh: "烛光",
    nameEn: "Candlelight",
    emoji: "🕯️",
    moodZh: "古装 / 亲密 / 密谈",
    moodEn: "Period drama / intimate / hushed talk",
    ambient: { color: "#FFC880", intensity: 0.12 },
    indoorAmbientIntensity: 0.28,
    directional: { position: [2, 6, 2], intensity: 0.15, color: "#FF9A30" },
    fill: { color: "#583818", intensity: 0.08 },
    hemi: { sky: "#FFC880", ground: "#38220F", intensity: 0.2 },
    indoorHemiIntensity: 0.5,
    interiorPoint: { color: "#FF9A30", intensity: 6.0 },
    shadows: true,
    background: "#1A0E06",
    fogColor: "#241408",
    exposure: 0.95,
    environmentIntensity: 0.2,
  },
  {
    id: "neon",
    nameZh: "霓虹",
    nameEn: "Neon",
    emoji: "🌃",
    moodZh: "夜市 / 赛博 / 都市欲望",
    moodEn: "Night market / cyber / urban desire",
    ambient: { color: "#C878F8", intensity: 0.22 },
    indoorAmbientIntensity: 0.35,
    directional: { position: [-20, 25, 15], intensity: 0.4, color: "#FF6EC7" },
    fill: { color: "#38E8FF", intensity: 0.25 },
    hemi: { sky: "#483868", ground: "#180F28", intensity: 0.3 },
    indoorHemiIntensity: 0.7,
    interiorPoint: { color: "#FF6EC7", intensity: 5.0 },
    shadows: true,
    background: "#120A24",
    fogColor: "#1A0F30",
    exposure: 1.0,
    environmentIntensity: 0.5,
  },
  {
    id: "moonlight",
    nameZh: "月光",
    nameEn: "Moonlight",
    emoji: "🌕",
    moodZh: "梦境 / 思念 / 宁静夜晚",
    moodEn: "Dream / longing / quiet night",
    ambient: { color: "#A8BCE0", intensity: 0.14 },
    indoorAmbientIntensity: 0.25,
    directional: { position: [-30, 40, -20], intensity: 0.5, color: "#D8E8FF" },
    fill: { color: "#2A3450", intensity: 0.12 },
    hemi: { sky: "#2A3450", ground: "#12141C", intensity: 0.22 },
    indoorHemiIntensity: 0.5,
    interiorPoint: { color: "#FFE8C0", intensity: 2.5 },
    shadows: true,
    background: "#0B1226",
    fogColor: "#141C30",
    exposure: 0.9,
    environmentIntensity: 0.3,
    stars: true,
  },
];

const LIGHTING_BY_ID: Record<string, LightingPreset> = Object.fromEntries(
  LIGHTING_PRESETS.map((p) => [p.id, p]),
);

/** 未知/缺失 id 安全回落到默认（白天），绝不崩。 */
export function resolveLightingPreset(id?: string | null): LightingPreset {
  if (id && LIGHTING_BY_ID[id]) return LIGHTING_BY_ID[id];
  return LIGHTING_BY_ID[DEFAULT_LIGHTING_ID];
}

export function isLightingId(id: string): id is LightingId {
  return id in LIGHTING_BY_ID;
}

/**
 * 一镜的生效灯光：本镜显式 lightingId 优先；缺省（旧存档无此字段，或
 * 用户选「跟随场景」）跟场景默认；两者都未知时回落到白天。
 * 旧分镜（v4 存档，无 lightingId）照常读，绝不因升级丢数据。
 */
export function resolveShotLightingId(
  shotLightingId: string | undefined,
  sceneDefault?: string,
): LightingId {
  if (shotLightingId && LIGHTING_BY_ID[shotLightingId]) return shotLightingId as LightingId;
  if (sceneDefault && LIGHTING_BY_ID[sceneDefault]) return sceneDefault as LightingId;
  return DEFAULT_LIGHTING_ID;
}
