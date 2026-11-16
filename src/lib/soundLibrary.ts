/**
 * soundLibrary —— 导演台配乐库（云横店 M4-C：声音/音乐）。
 *
 * 只做「配乐推荐」，不捆绑任何音频文件：
 *   · 每条 = 一种情绪（mood）→ 适用场面 + 推荐乐器/感觉 + 去哪里找
 *     （YouTube Audio Library / Incompetech / Musopen / Pixabay Music /
 *     Free Music Archive）+ 该条的许可证。
 *   · 命名的具体曲目只写已核实确实存在于该来源的（见每条 exampleTrack
 *     的核实说明）；其余条目只给「去该库搜什么」的 searchHint，绝不编曲名。
 *   · 许可证按条目写（CC BY 3.0 / CC0 / 各曲自带许可），用之前务必再看
 *     一眼曲目页——库会换许可，代码里的许可只是下载时的快照。
 *
 * 建议逻辑（suggestMusicForShot）：控制台按「本镜情绪」给每镜推荐一首，
 * 维度 = 显式选的 mood > 打斗 > 剑类飞行（古装）> 灯光情绪 > 默认温馨。
 * 灯光是 Part 2 的维度（lighting.ts）：dramatic/candlelight/neon/dusk 等
 * 在这里映射到情绪，见 LIGHTING_TO_MOOD。
 *
 * 纯数据 + 纯函数：不碰 DOM、不碰 AudioContext，可在 node 里直接测。
 * 音乐本身不在仓库里——用户按 source + searchHint 去下载，配乐进成片。
 */

export type MusicMood =
  | "romance"   // 浪漫
  | "fight"     // 打斗
  | "suspense"  // 悬疑
  | "period"    // 古装
  | "comedy"    // 喜剧
  | "sad"       // 悲伤
  | "chase"     // 紧张追逐
  | "warm"      // 温馨家庭
  | "nightCity" // 夜店/都市
  | "epic";     // 史诗/战争

export const MUSIC_MOODS: Array<{ id: MusicMood; nameZh: string; nameEn: string; emoji: string }> = [
  { id: "romance",   nameZh: "浪漫",     nameEn: "Romance",      emoji: "💕" },
  { id: "fight",     nameZh: "打斗",     nameEn: "Fight",        emoji: "🥊" },
  { id: "suspense",  nameZh: "悬疑",     nameEn: "Suspense",     emoji: "🕵️" },
  { id: "period",    nameZh: "古装",     nameEn: "Period drama", emoji: "🏮" },
  { id: "comedy",    nameZh: "喜剧",     nameEn: "Comedy",       emoji: "😂" },
  { id: "sad",       nameZh: "悲伤",     nameEn: "Sad",          emoji: "😢" },
  { id: "chase",     nameZh: "紧张追逐", nameEn: "Chase",        emoji: "🏃" },
  { id: "warm",      nameZh: "温馨家庭", nameEn: "Warm family",  emoji: "🏠" },
  { id: "nightCity", nameZh: "夜店/都市", nameEn: "Night city",  emoji: "🌃" },
  { id: "epic",      nameZh: "史诗/战争", nameEn: "Epic / war",  emoji: "⚔️" },
];

export function musicMoodName(mood: string): { nameZh: string; nameEn: string } {
  const hit = MUSIC_MOODS.find((m) => m.id === mood);
  return hit ? { nameZh: hit.nameZh, nameEn: hit.nameEn } : { nameZh: "温馨家庭", nameEn: "Warm family" };
}

/** 配乐来源：名字 + 入口 + 该条的许可证（快照，用前再看曲目页）。 */
export interface MusicSource {
  /** 来源库名 */
  name: string;
  nameZh: string;
  /** 入口（只写首页/频道级链接，不编深层 URL） */
  url: string;
  /** 许可证（本条曲目/该库该类曲目的许可） */
  license: string;
  licenseZh: string;
  /** 署名要求（一句话） */
  attributionZh: string;
}

export interface MusicTrack {
  id: string;
  mood: MusicMood;
  nameZh: string;
  nameEn: string;
  /** 适用场面 */
  sceneTypesZh: string[];
  sceneTypesEn: string[];
  /** 推荐乐器/音色 */
  instrumentZh: string;
  instrumentEn: string;
  /** 感觉（一句话） */
  feelZh: string;
  feelEn: string;
  source: MusicSource;
  /** 去该库搜什么（没给具体曲名时就按这个搜） */
  searchHintZh: string;
  searchHintEn: string;
  /** 已核实存在于该来源的具体曲目（无 = 本条只给 searchHint，不编曲名）。
   *  核实方式见 docs/sound-library.md。 */
  exampleTrack?: { title: string; artist: string; verifiedNoteZh: string };
}

const INCOMPETECH: MusicSource = {
  name: "Incompetech (Kevin MacLeod)",
  nameZh: "Incompetech（Kevin MacLeod 曲库）",
  url: "https://incompetech.com/music/royalty-free/",
  license: "CC BY 3.0",
  licenseZh: "CC BY 3.0（署名即可免费商用）",
  attributionZh: "须在片尾/简介按该曲页面给出的格式署名（曲名 / Kevin MacLeod / incompetech.com / CC BY 3.0）；不想署名可付费买免署名许可。",
};

const YT_AUDIO_LIBRARY: MusicSource = {
  name: "YouTube Audio Library",
  nameZh: "YouTube 音频库",
  url: "https://studio.youtube.com",
  license: "Per-track (Audio Library license or CC BY)",
  licenseZh: "按曲目：免署名许可 或 CC BY（曲目页会写明）",
  attributionZh: "标「无需署名」的直接用；标 CC BY 的须在简介署名。进 YouTube Studio → 左侧「音频库」。",
};

const MUSOPEN: MusicSource = {
  name: "Musopen",
  nameZh: "Musopen（公共版权古典录音）",
  url: "https://musopen.org",
  license: "Public domain composition; recording CC0 / CC BY (per recording)",
  licenseZh: "曲子本身是公共版权；录音按每条标 CC0 或 CC BY",
  attributionZh: "曲子（作曲家去世超 70 年）无版权；录音看该条标注，CC BY 的须署名演奏者/录音来源。",
};

const PIXABAY_MUSIC: MusicSource = {
  name: "Pixabay Music",
  nameZh: "Pixabay Music",
  url: "https://pixabay.com/music/",
  license: "Pixabay Content License",
  licenseZh: "Pixabay 内容许可（免费、无需署名）",
  attributionZh: "无需署名，可免费商用；但不得把音乐本身原样转卖或声称是自己创作。",
};

const FMA: MusicSource = {
  name: "Free Music Archive",
  nameZh: "Free Music Archive",
  url: "https://freemusicarchive.org",
  license: "Per-track Creative Commons (check the track page)",
  licenseZh: "按曲目：各曲自带 CC 许可（下之前看曲目页）",
  attributionZh: "每首许可不同：CC0 无需署名，CC BY 须署名，CC BY-NC 不可商用——以下载页为准。",
};

/**
 * 配乐库：10 种情绪各一条。每条必填：mood + 适用场面 + 乐器/感觉 +
 * 来源 + 许可证（缺一不可，见 scripts/check-sound.ts 的校验）。
 * 曲名只写核实过的；没核实的只给 searchHint。
 */
export const MUSIC_LIBRARY: MusicTrack[] = [
  {
    id: "romance-piano",
    mood: "romance",
    nameZh: "浪漫 · 柔板钢琴",
    nameEn: "Romance · Soft piano",
    sceneTypesZh: ["表白", "告别", "重逢", "婚礼", "黄昏散步"],
    sceneTypesEn: ["confession", "farewell", "reunion", "wedding", "dusk walk"],
    instrumentZh: "钢琴独奏，柔板",
    instrumentEn: "Solo piano, slow tempo",
    feelZh: "安静、留白多，让台词先出来，音乐只托底",
    feelEn: "Quiet, lots of space — dialogue leads, music only supports",
    source: MUSOPEN,
    searchHintZh: "在 Musopen 搜 nocturne（夜曲）或 Chopin，找 CC0 录音",
    searchHintEn: "On Musopen, search “nocturne” or “Chopin” for a CC0 recording",
    exampleTrack: {
      title: "Nocturne in E-flat major, Op. 9 No. 2",
      artist: "Frédéric Chopin (作曲，公共版权）",
      verifiedNoteZh: "曲子是公共版权（肖邦逝于 1849 年）；录音须在 Musopen 上另找一条标 CC0/CC BY 的，录音许可以下载页为准。",
    },
  },
  {
    id: "fight-drums",
    mood: "fight",
    nameZh: "打斗 · 重鼓",
    nameEn: "Fight · Heavy drums",
    sceneTypesZh: ["打斗", "对峙", "追打", "比武"],
    sceneTypesEn: ["fight", "standoff", "chase-fight", "duel"],
    instrumentZh: "重鼓 + 急促弦乐",
    instrumentEn: "Heavy drums + driving strings",
    feelZh: "鼓点跟出拳走，一拍一拳，越打越密",
    feelEn: "Drums follow the punches — one beat per hit, denser as the fight escalates",
    source: INCOMPETECH,
    searchHintZh: "在 Incompetech 按 feel 搜 aggressive / intense",
    searchHintEn: "On Incompetech, search by feel: aggressive / intense",
    exampleTrack: {
      title: "Hitman",
      artist: "Kevin MacLeod",
      verifiedNoteZh: "已核实：Incompetech 曲库曲目，多部作品配乐表有收录；CC BY 3.0。",
    },
  },
  {
    id: "suspense-strings",
    mood: "suspense",
    nameZh: "悬疑 · 低音弦乐",
    nameEn: "Suspense · Low strings",
    sceneTypesZh: ["悬疑", "夜戏", "跟踪", "揭晓前"],
    sceneTypesEn: ["suspense", "night scene", "stalking", "before the reveal"],
    instrumentZh: "低音弦乐 + 不协和长音",
    instrumentEn: "Low strings + dissonant sustained tones",
    feelZh: "压着、拖着，音越少越吓人；揭晓那一下再放出来",
    feelEn: "Held back and dragging — fewer notes, more dread; release only at the reveal",
    source: INCOMPETECH,
    searchHintZh: "在 Incompetech 按 feel 搜 eerie / dark / suspenseful",
    searchHintEn: "On Incompetech, search by feel: eerie / dark / suspenseful",
    exampleTrack: {
      title: "Darkest Child",
      artist: "Kevin MacLeod",
      verifiedNoteZh: "已核实：Incompetech 曲库曲目，被多处列为 MacLeod 的阴郁/悬疑代表作；CC BY 3.0。",
    },
  },
  {
    id: "period-guzheng",
    mood: "period",
    nameZh: "古装 · 古筝",
    nameEn: "Period drama · Guzheng",
    sceneTypesZh: ["古装", "武侠", "宫廷", "江湖夜话", "烛光密谈"],
    sceneTypesEn: ["period drama", "wuxia", "palace", "riverside night talk", "candlelit talk"],
    instrumentZh: "古筝 + 笛",
    instrumentEn: "Guzheng + dizi flute",
    feelZh: "拨弦留白，像烛光一样一闪一闪，别铺满",
    feelEn: "Plucked strings with space, flickering like candlelight — never wall-to-wall",
    source: YT_AUDIO_LIBRARY,
    searchHintZh: "在 YouTube 音频库搜 guzheng 或 Chinese traditional；或在 FMA 搜 guzheng（看每首许可）",
    searchHintEn: "In the YouTube Audio Library search “guzheng” or “Chinese traditional”; or on FMA search “guzheng” (check each track's license)",
  },
  {
    id: "comedy-plucked",
    mood: "comedy",
    nameZh: "喜剧 · 轻快拨弦",
    nameEn: "Comedy · Light plucked strings",
    sceneTypesZh: ["喜剧", "闹剧", "误会", "追逐打闹", "周星驰式笑点"],
    sceneTypesEn: ["comedy", "farce", "misunderstanding", "playful chase", "Stephen Chow-style gag"],
    instrumentZh: "轻快拨弦 + 长笛",
    instrumentEn: "Light pizzicato strings + flute",
    feelZh: "蹦蹦跳跳，笑点落在拨弦的空拍上",
    feelEn: "Bouncy — the gag lands on the pizzicato off-beat",
    source: INCOMPETECH,
    searchHintZh: "在 Incompetech 按 feel 搜 quirky / comedic / playful",
    searchHintEn: "On Incompetech, search by feel: quirky / comedic / playful",
    exampleTrack: {
      title: "Monkeys Spinning Monkeys",
      artist: "Kevin MacLeod",
      verifiedNoteZh: "已核实：Incompetech 曲库曲目，Wikimedia Commons 有该曲文件页（CC BY 3.0，ISRC USUAN1400011）；喜剧代表作。",
    },
  },
  {
    id: "sad-cello",
    mood: "sad",
    nameZh: "悲伤 · 独奏大提琴",
    nameEn: "Sad · Solo cello",
    sceneTypesZh: ["离别", "失去", "回忆", "独白", "月夜思念"],
    sceneTypesEn: ["parting", "loss", "memory", "monologue", "longing under moonlight"],
    instrumentZh: "独奏大提琴，或缓慢钢琴",
    instrumentEn: "Solo cello, or slow solo piano",
    feelZh: "一个音拉长，越慢越疼；别加鼓，别加第二件乐器抢戏",
    feelEn: "One long note — slower hurts more; no drums, no second instrument stealing the scene",
    source: INCOMPETECH,
    searchHintZh: "在 Incompetech 按 feel 搜 sad / somber / melancholy",
    searchHintEn: "On Incompetech, search by feel: sad / somber / melancholy",
    exampleTrack: {
      title: "Gymnopédie No. 3",
      artist: "Erik Satie (作曲，公共版权），Kevin MacLeod 演绎版",
      verifiedNoteZh: "已核实：多部作品配乐表收录该 MacLeod 演绎版（incompetech.com）；曲子本身是公共版权（萨蒂逝于 1925 年），演绎版 CC BY 3.0。",
    },
  },
  {
    id: "chase-percussion",
    mood: "chase",
    nameZh: "紧张追逐 · 快打击乐",
    nameEn: "Chase · Fast percussion",
    sceneTypesZh: ["追逐", "逃跑", "倒计时", "夺路"],
    sceneTypesEn: ["chase", "escape", "countdown", "fighting through"],
    instrumentZh: "快速打击乐 + 驱动型低音",
    instrumentEn: "Fast percussion + driving bass",
    feelZh: "不停顿的脉冲，脚步声踩在鼓点上",
    feelEn: "Unstopping pulse — footsteps land on the drumbeat",
    source: INCOMPETECH,
    searchHintZh: "在 Incompetech 按 feel 搜 intense / driving / action",
    searchHintEn: "On Incompetech, search by feel: intense / driving / action",
    exampleTrack: {
      title: "A Mission",
      artist: "Kevin MacLeod",
      verifiedNoteZh: "已核实：Incompetech 曲库动作类曲目，见 MacLeod 代表作表（Action Cuts）；CC BY 3.0。",
    },
  },
  {
    id: "warm-acoustic",
    mood: "warm",
    nameZh: "温馨家庭 · 轻柔木吉他",
    nameEn: "Warm family · Gentle acoustic",
    sceneTypesZh: ["家庭", "团聚", "做饭", "日常", "回家"],
    sceneTypesEn: ["family", "reunion", "cooking", "everyday life", "coming home"],
    instrumentZh: "轻柔木吉他",
    instrumentEn: "Gentle acoustic guitar",
    feelZh: "暖、不抢戏，像家里一直开着的收音机",
    feelEn: "Warm and unobtrusive, like a radio left on at home",
    source: YT_AUDIO_LIBRARY,
    searchHintZh: "在 YouTube 音频库按心情筛「温馨/平静」，筛「无需署名」",
    searchHintEn: "In the YouTube Audio Library filter by mood “warm / calm” and “attribution not required”",
  },
  {
    id: "nightcity-electronic",
    mood: "nightCity",
    nameZh: "夜店/都市 · 电子霓虹",
    nameEn: "Night city · Electronic neon",
    sceneTypesZh: ["夜店", "霓虹街", "都市夜晚", "赛博", "酒吧"],
    sceneTypesEn: ["nightclub", "neon street", "city at night", "cyber", "bar"],
    instrumentZh: "电子合成器 / 合成波",
    instrumentEn: "Synths / synthwave",
    feelZh: "霓虹灯的嗡鸣，低音压着、亮音闪着",
    feelEn: "The hum of neon — low end pressing, bright notes flashing",
    source: PIXABAY_MUSIC,
    searchHintZh: "在 Pixabay Music 搜 synthwave 或 electronic night",
    searchHintEn: "On Pixabay Music search “synthwave” or “electronic night”",
  },
  {
    id: "epic-orchestral",
    mood: "epic",
    nameZh: "史诗/战争 · 管弦乐",
    nameEn: "Epic / war · Orchestral",
    sceneTypesZh: ["史诗", "战争", "出征", "决战", "大场面"],
    sceneTypesEn: ["epic", "war", "departure for battle", "final battle", "large-scale scene"],
    instrumentZh: "管弦乐团 + 合唱式高潮",
    instrumentEn: "Full orchestra + choral-style climax",
    feelZh: "大、慢、重，高潮只留给全片最关键的一镜",
    feelEn: "Big, slow, heavy — save the climax for the single most important shot",
    source: INCOMPETECH,
    searchHintZh: "在 Incompetech 按 feel 搜 epic / dramatic / heroic",
    searchHintEn: "On Incompetech, search by feel: epic / dramatic / heroic",
    exampleTrack: {
      title: "Despair and Triumph",
      artist: "Kevin MacLeod",
      verifiedNoteZh: "已核实：多部作品配乐表收录该曲（incompetech.com）；CC BY 3.0。",
    },
  },
];

const MUSIC_BY_MOOD: Record<string, MusicTrack> = Object.fromEntries(
  MUSIC_LIBRARY.map((t) => [t.mood, t]),
);

/** 未知/缺失 mood 安全回落到温馨（日常默认），绝不崩。 */
export function musicTrackForMood(mood?: string | null): MusicTrack {
  if (mood && MUSIC_BY_MOOD[mood]) return MUSIC_BY_MOOD[mood];
  return MUSIC_BY_MOOD.warm;
}

export function isMusicMood(id: string): id is MusicMood {
  return id in MUSIC_BY_MOOD;
}

/**
 * 灯光 → 情绪映射（Part 2 的灯光维度，见 lighting.ts 的 moodZh）：
 *   candlelight 烛光 → 古装（古装/密谈）；neon 霓虹 → 夜店/都市；
 *   dusk 黄昏 → 浪漫；warm 暖光 → 温馨家庭；moonlight 月光 → 悲伤（思念）；
 *   dramatic 戏剧光 → 悬疑（对峙/揭晓）；night 夜晚 → 悬疑（夜戏）；
 *   cold 冷光 → 悬疑（疏离）；overcast 阴天 → 悲伤（压抑）；
 *   day 白天 → 温馨家庭（日常默认）。
 *   未知灯光 → 温馨家庭（默认）。
 */
export const LIGHTING_TO_MOOD: Record<string, MusicMood> = {
  candlelight: "period",
  neon: "nightCity",
  dusk: "romance",
  warm: "warm",
  moonlight: "sad",
  dramatic: "suspense",
  night: "suspense",
  cold: "suspense",
  overcast: "sad",
  day: "warm",
};

/** 剑类飞行动作 → 古装（御剑/扫帚/威亚/轻功都是武侠语汇） */
const PERIOD_ACTIONS = new Set(["flySword", "flyBroom", "wireFly", "leap"]);
/** 打斗类动作 → 打斗 */
const FIGHT_ACTIONS = new Set(["fight", "punch", "kick", "block"]);

export interface ShotMusicInput {
  /** 本镜显式选的情绪（Shot.musicMood；缺省 = 自动推断） */
  musicMood?: string | null;
  /** 本镜生效灯光 id（resolveShotLightingId 算出的；缺省 = day） */
  lightingId?: string | null;
  /** 本镜有无打斗编舞 */
  hasFight?: boolean;
  /** 本镜演员的动作（默认动作 + 时间轴段动作），用于推断 */
  actions?: string[];
}

/**
 * 一镜的配乐情绪推断。优先级（先赢）：
 *   1. 本镜显式 musicMood；2. 有打斗编舞或打斗类动作 → 打斗；
 *   3. 剑类飞行动作 → 古装；4. 灯光映射；5. 默认温馨家庭。
 *  旧分镜（无 musicMood）照常推断，绝不因升级丢数据。
 */
export function resolveShotMusicMood(input: ShotMusicInput): MusicMood {
  if (input.musicMood && MUSIC_BY_MOOD[input.musicMood]) return input.musicMood as MusicMood;
  if (input.hasFight) return "fight";
  const acts = input.actions ?? [];
  if (acts.some((a) => FIGHT_ACTIONS.has(a))) return "fight";
  if (acts.some((a) => PERIOD_ACTIONS.has(a))) return "period";
  if (input.lightingId && LIGHTING_TO_MOOD[input.lightingId]) return LIGHTING_TO_MOOD[input.lightingId];
  return "warm";
}

/** 一镜的推荐配乐（情绪 + 完整条目：场面/乐器/来源/许可/搜什么）。 */
export function suggestMusicForShot(input: ShotMusicInput): MusicTrack {
  return musicTrackForMood(resolveShotMusicMood(input));
}
