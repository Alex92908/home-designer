/**
 * directorStyles —— 导演风格预设（云横店 M5：拍摄）。
 *
 * 一套预设 = 一位导演的整套拍法，变成导演台里的默认值：新镜的机位、
 * 场景默认灯光、推荐的片场/服装/动作、建议的分镜顺序（机位预设序列）。
 * 预设是起点，不是锁：选了之后用户仍可逐项改（机位、灯光、片场、
 * 服装、动作都可自由调），也可以随时清除回到 plain 默认。
 *
 * 数据驱动：加新导演 = 往 DIRECTOR_STYLES 加一条 + 在
 * docs/director-skills/ 里加一份手册，控制台 UI 不用改；新类型
 * （如科幻/恐怖）先加进 DIRECTOR_STYLE_GENRES 的分组顺序，
 * 再把预设的 genreZh/genreEn 指过去，选择器自动按类型分组显示。
 * 每条预设只引用真实存在的东西：机位 id 见 cinematic.ts 的
 * CINE_PRESETS，灯光 id 见 lighting.ts 的 LIGHTING_PRESETS，片场 id
 * 见 sceneSets.ts 的 SCENE_SETS，服装 id 见 characters.ts 的 COSTUMES，
 * 动作 id 见 actions.ts 的 ACTION_REGISTRY。引用不存在的 id 是 bug，
 * 见 scripts/check-director-styles.ts 的交叉校验。
 *
 * 选预设不会动用户已有的分镜/演员/走位：它只改场景默认灯光
 * （新镜继承；已有镜各自存了自己的 lightingId，不受影响）+ 在面板
 * 里展示建议（片场/机位/服装/动作都是点一下才接受的建议）。
 * 清除预设回到 plain 默认（灯光 day），同样不删任何已有内容。
 * 未知 id 安全回落到“无预设”（plain 默认），绝不抛错。
 *
 * 手册是事实来源：每条映射都来自 docs/director-skills/ 里对应手册的
 * “导演台可用的设置”；手册里有、控制台没有的拍法写在 gaps 里，
 * 不编造映射。
 */
import type { LightingId } from "./lighting";

/** 导演风格预设（一条 = 一位导演的整套拍法默认值 + 建议）。 */
export interface DirectorStyle {
  /** 预设 id（store 里存的就是它；storyboard.json 导出也写它） */
  id: string;
  labelZh: string;
  labelEn: string;
  /** 分组（选择器按 DIRECTOR_STYLE_GENRES 的顺序分组显示） */
  genreZh: string;
  genreEn: string;
  /** 一句话：选了它会发生什么（面板里显示在选择器旁边） */
  descriptionZh: string;
  descriptionEn: string;
  /** 默认机位（CINE_PRESETS id；新镜/首镜用它） */
  cameraPresetId: string;
  /** 场景默认灯光（LIGHTING_PRESETS id；选预设时同步设场景灯光） */
  lightingId: LightingId;
  /** 建议的分镜顺序（机位预设 id 序列；“按此风格生成分镜”按它建镜） */
  shotOrder: string[];
  /** 推荐片场（SCENE_SETS id） */
  suggestedSets: string[];
  /** 推荐服装（COSTUMES id） */
  suggestedCostumes: string[];
  /** 推荐动作（ACTION_REGISTRY id） */
  suggestedActions: string[];
  /** 拍法提示（手册里的节奏/结构要点，面板里当文字提示） */
  beatsZh: string[];
  beatsEn: string[];
  /** 手册文件（docs/director-skills/<file>） */
  playbook: string;
  /** 手册里有、控制台暂不能表示的拍法（诚实标注，不编造映射） */
  gapsZh: string[];
  gapsEn: string[];
}

/** 无预设时的 plain 默认（清除预设回到这里）。 */
export const PLAIN_DEFAULTS: { cameraPresetId: string; lightingId: LightingId } = {
  cameraPresetId: "indoor-wide",
  lightingId: "day",
};

/**
 * 风格分组（选择器按此顺序用 optgroup 分组显示；新类型加在这里 +
 * 预设的 genreZh/genreEn。分组表可以先于预设存在——校验只要求
 * 每个预设的 genre 在表里，不要求每个分组已有预设。）
 */
export const DIRECTOR_STYLE_GENRES: { zh: string; en: string }[] = [
  { zh: "通用", en: "Universal" },
  { zh: "华语", en: "Chinese & Hong Kong" },
  { zh: "好莱坞", en: "Hollywood" },
  { zh: "日本 / 韩国 / 欧洲", en: "Japan / Korea / Europe" },
  { zh: "恐怖", en: "Horror" },
  { zh: "科幻", en: "Sci-Fi" },
  { zh: "奇幻", en: "Fantasy" },
  { zh: "西部", en: "Western" },
  { zh: "战争", en: "War" },
  { zh: "歌舞", en: "Musical" },
  { zh: "爱情", en: "Romance" },
  { zh: "动画", en: "Animation" },
  { zh: "武侠 / 功夫", en: "Martial Arts" },
  { zh: "家庭", en: "Family" },
  { zh: "默片", en: "Silent" },
  { zh: "实验 / 超现实", en: "Experimental / Surreal" },
  { zh: "黑色电影", en: "Noir" },
  { zh: "史诗", en: "Epic" },
  { zh: "超级英雄", en: "Superhero" },
  { zh: "间谍", en: "Spy" },
  { zh: "青少年", en: "Teen / Youth" },
];

export const DIRECTOR_STYLES: DirectorStyle[] = [
  {
    id: "universal",
    labelZh: "通用",
    labelEn: "Universal (Top 100)",
    genreZh: "通用",
    genreEn: "Universal",
    descriptionZh: "大众观众记得住的规律：一个房间、一张听者的脸、一个低角度、一件红外套、一段楼梯。先把戏拍对，再加风格。",
    descriptionEn: "What mass audiences remember: one room, a listener's face, a low angle, one red coat, a staircase. Get the scene right first, then add style.",
    cameraPresetId: "indoor-wide",
    lightingId: "day",
    shotOrder: ["indoor-wide", "indoor-medium", "indoor-ots", "indoor-closeup"],
    suggestedSets: ["set-apartment", "set-courtroom", "set-cafe", "set-wedding"],
    suggestedCostumes: ["cinderella-gown", "ceo-suit"],
    suggestedActions: ["walk", "sit", "turn", "point"],
    beatsZh: [
      "先立地理，再制造混乱",
      "节拍：平静 → 麻烦 → 受挫 → 升级 → 代价",
      "每个动作节拍配一个反应镜头",
      "景别 = 情感距离：特写只给决定性时刻",
    ],
    beatsEn: [
      "Establish geography first, then make chaos",
      "Beats: calm → trouble → setback → escalation → cost",
      "Every action beat gets a reaction shot",
      "Shot size = emotional distance: close-up only for the decisive moment",
    ],
    playbook: "top-100.md",
    gapsZh: [
      "长镜头（《好家伙》一镜到底）没有专门的机位模式——用长时长的全景近似",
      "插入镜头（物件特写）没有独立机位——用 indoor-closeup 框住物件位置近似",
      "没有红外套服装——强调色用一件醒目的服装代替",
    ],
    gapsEn: [
      "No dedicated long-take mode (Goodfellas one-take) — approximate with a long wide shot",
      "No dedicated insert-shot preset (object close-up) — approximate with indoor-closeup framed on the object",
      "No red-coat costume — the accent is a single standout costume instead",
    ],
  },
  {
    id: "chow",
    labelZh: "周星驰",
    labelEn: "Stephen Chow",
    genreZh: "华语",
    genreEn: "Chinese & Hong Kong",
    descriptionZh: "无厘头 + 受辱的底层小人物靠心赢。宽景拍肢体喜剧，停顿–爆发–停顿，一句真心话收尾。",
    descriptionEn: "Mo lei tau + a humiliated underdog who wins by heart. Wide shots for physical comedy, pause–burst–pause, one sincere line to close.",
    cameraPresetId: "indoor-wide",
    lightingId: "day",
    shotOrder: ["indoor-wide", "indoor-medium", "indoor-wide", "indoor-closeup"],
    suggestedSets: ["set-rural-hall", "set-ancient-street", "set-market", "set-school"],
    suggestedCostumes: ["ceo-suit", "farmer-modern", "scholar-white"],
    suggestedActions: ["fight", "fall", "getUp", "bow"],
    beatsZh: [
      "停顿–爆发–停顿：静止 → 爆发 → 反应定格",
      "笑话当动作拍：必须能默片化（道具 + 走位）",
      "隐藏高手逐级揭示：绝不先亮最强者",
      "每场一个真诚特写，放在笑点之后",
    ],
    beatsEn: [
      "Pause–burst–pause: stillness → burst → held reaction",
      "Jokes are shot as action: must work silent (prop + blocking)",
      "Hidden masters revealed by escalation: never show the strongest first",
      "One sincere close-up per scene, placed after the comedy",
    ],
    playbook: "stephen-chow.md",
    gapsZh: [
      "慢动作只给 payoff——控制台没有速度控制，用更长的特写时长近似",
      "现成武器（桌腿/小册子）没有对应的特技道具——用走位 + 现有道具近似",
      "斧头帮的同步群舞没有群演编排——用多个演员的同一动作近似",
    ],
    gapsEn: [
      "Slow motion only for the payoff — no speed control in the console; approximate with a longer close-up",
      "Improvised weapons (table leg / cheap booklet) have no matching stunt prop — approximate with blocking + existing props",
      "The axe gang's synchronised dance has no crowd choreography — approximate with several actors doing the same action",
    ],
  },
  {
    id: "nolan",
    labelZh: "诺兰",
    labelEn: "Christopher Nolan",
    genreZh: "好莱坞",
    genreEn: "Hollywood",
    descriptionZh: "时间是主题。交叉剪辑多条时间线直到汇合，实拍优先，一个剪影等于一个人。",
    descriptionEn: "Time is the subject. Cross-cut timelines until they converge, practical first, one silhouette = one character.",
    cameraPresetId: "indoor-wide",
    lightingId: "cold",
    shotOrder: ["indoor-wide", "indoor-medium", "indoor-wide", "indoor-medium", "indoor-closeup"],
    suggestedSets: ["set-apartment", "set-station", "set-mountain", "set-beach"],
    suggestedCostumes: ["ceo-suit", "officer-uniform", "scholar-robe"],
    suggestedActions: ["walk", "turn", "point", "run"],
    beatsZh: [
      "交叉剪：2–3 条时间线，按危机切，在同一事件汇合",
      "说明当学徒：规则在新人做任务时教",
      "一个真实特技 + 清晰地理：先建立房间，再打碎它",
      "特写只给顿悟一拍：图腾、照片、爆炸后的脸",
    ],
    beatsEn: [
      "Cross-cut: 2–3 timelines, cut on crisis, converge on one event",
      "Exposition as apprenticeship: teach the rules while the newcomer works",
      "One real stunt + clear geography: establish the room, then break it",
      "Close-up only for the epiphany beat: totem, photo, the face after the blast",
    ],
    playbook: "nolan.md",
    gapsZh: [
      "多时间线交叉剪辑没有专门的模板——用宽景/中景交替的镜头顺序近似，汇合在特写",
      "旋转走廊（《盗梦空间》）没有对应的布景——用普通室内近似",
      "黑白/彩色时间线代码没有调色预设——用冷/暖灯光区分时间线",
      "没有帽子（猪肉馅饼帽）服装——剪影用西装/制服代替",
    ],
    gapsEn: [
      "No dedicated multi-timeline template — approximate with alternating wide/medium shots converging on a close-up",
      "No rotating-corridor set (Inception) — approximate with an ordinary interior",
      "No colour/B&W timeline code — distinguish timelines with cold/warm lighting",
      "No hat (porkpie hat) costume — the silhouette is a suit/uniform instead",
    ],
  },
  {
    id: "bay",
    labelZh: "迈克尔·贝",
    labelEn: "Michael Bay",
    genreZh: "好莱坞",
    genreEn: "Hollywood",
    descriptionZh: "Bayhem：运动 + 构图 + 快剪制造史诗尺度。开场即高潮，渺小的人对巨大的东西。",
    descriptionEn: "Bayhem: movement + composition + fast cutting for epic scale. Open with the set piece; tiny humans against huge things.",
    cameraPresetId: "orbit",
    lightingId: "dusk",
    shotOrder: ["orbit", "indoor-wide", "indoor-medium", "indoor-closeup"],
    suggestedSets: ["set-military-camp", "set-street", "set-city-wall", "set-beach"],
    suggestedCostumes: ["officer-uniform", "ceo-suit", "guard-uniform"],
    suggestedActions: ["run", "fight", "jump", "fall"],
    beatsZh: [
      "开场即布景戏：前 15–20 分钟就是最大场面",
      "靠武器化环境升级：每拍必须超过上一拍",
      "尺度 = 渺小的人对巨大的东西",
      "混乱后一个静止的英雄时刻：停顿就是 payoff",
    ],
    beatsEn: [
      "Open with the set piece: the first 15–20 minutes are the biggest scene",
      "Escalate by weaponising the environment: every beat must top the last",
      "Scale = tiny humans against huge things",
      "After chaos, one still hero moment: the pause is the payoff",
    ],
    playbook: "michael-bay.md",
    gapsZh: [
      "低角度 360° 英雄镜头是绕建筑转的 orbit——室内绕人的英雄环绕没有对应的机位预设",
      "FPV 无人机俯冲没有对应的机位路径——用 crane-up / dolly-in 近似",
      "黄金时刻用 dusk 预设——没有专门的金色时刻灯光",
      "多机位快切是剪辑手法——用多个机位预设的镜头序列近似",
    ],
    gapsEn: [
      "The low-angle 360° hero shot is the orbit preset circling the building — no indoor orbit around a person",
      "No FPV drone dive camera path — approximate with crane-up / dolly-in",
      "Golden hour uses the dusk preset — no dedicated golden-hour lighting",
      "Multi-camera fast cutting is an editing technique — approximate with a sequence of camera presets",
    ],
  },
  {
    id: "wong-kar-wai",
    labelZh: "王家卫",
    labelEn: "Wong Kar-wai",
    genreZh: "华语",
    genreEn: "Chinese & Hong Kong",
    descriptionZh: "时间是主角，爱情是未完成时。饱和色彩 + 抽帧慢动作 + 窄空间擦肩而过，情绪靠重复。",
    descriptionEn: "Time is the protagonist; love is unfinished. Saturated colour, step-printed slow motion, near-misses in narrow spaces — emotion through repetition.",
    cameraPresetId: "indoor-medium",
    lightingId: "warm",
    shotOrder: ["indoor-medium", "indoor-ots", "indoor-closeup", "crane-up"],
    suggestedSets: ["set-shikumen", "set-hotel-room", "set-market", "set-street"],
    suggestedCostumes: ["cinderella-gown", "police-uniform", "ceo-suit"],
    suggestedActions: ["walk", "turn", "sit", "dodge"],
    beatsZh: [
      "擦肩而过：走位即剧情",
      "主角慢，世界快：速度差模拟抽帧",
      "重复同一场戏，每次换一个细节",
      "旁白说心里话，画面保持沉默",
      "特写给手、背影、钟，不给脸",
    ],
    beatsEn: [
      "Near-miss: blocking IS the plot",
      "The hero moves slow, the world moves fast — speed difference simulates step-printing",
      "Repeat the same scene, change one detail each time",
      "Voiceover says the inner truth; the image stays silent",
      "Close-ups for hands, backs, clocks — never the face",
    ],
    playbook: "wong-kar-wai.md",
    gapsZh: [
      "没有黑白滤镜/调色——用冷灯光 + 素色服装近似黑白",
      "没有抽帧/慢动作速度控制——用慢走位对快人群近似",
      "没有旗袍服装——用礼服代替",
      "没有雨/天气系统——用霓虹/月光灯光 + 音效暗示",
    ],
    gapsEn: [
      "No B&W filter/grading — approximate black-white with cold lighting + plain costumes",
      "No step-printing/slow-motion speed control — approximate with slow walk vs fast crowd",
      "No qipao costume — a gown stands in",
      "No rain/weather system — imply with neon/moonlight lighting + SFX",
    ],
  },
  {
    id: "zhang-yimou",
    labelZh: "张艺谋",
    labelEn: "Zhang Yimou",
    genreZh: "华语",
    genreEn: "Chinese & Hong Kong",
    descriptionZh: "色彩即叙事：一场戏只用一种主色。仪式即权力，大场面即编舞。",
    descriptionEn: "Colour is the story: one dominant colour per scene. Ritual is power; spectacle is choreography.",
    cameraPresetId: "indoor-wide",
    lightingId: "warm",
    shotOrder: ["indoor-wide", "crane-up", "indoor-wide", "indoor-closeup"],
    suggestedSets: ["set-ming-hall", "set-tang-palace", "set-bamboo", "set-snow"],
    suggestedCostumes: ["emperor-dragon", "empress-phoenix", "wuxia-white", "farmer-ancient"],
    suggestedActions: ["fight", "bow", "block", "stand"],
    beatsZh: [
      "一色一章：颜色分清谁在说谎",
      "对称静止：仪式压人",
      "大场面先定调，再落回人",
      "打斗即舞蹈：先定节拍，再定招式",
      "最后一击留给静止",
    ],
    beatsEn: [
      "One colour per chapter: colour tells who is lying",
      "Symmetric stillness: ritual crushes people",
      "Set the tone with spectacle, then return to the person",
      "Fighting is dance: set the beat first, then the moves",
      "The final blow belongs to stillness",
    ],
    playbook: "zhang-yimou.md",
    gapsZh: [
      "没有调色预设——水墨感只靠服装 + 片场 + 灯光",
      "没有天气系统——雨/雪只靠灯光 + 音效",
      "没有群演同步工具——多演员走位手动设同一时间",
      "没有人群模拟——先排 5–8 人队形",
    ],
    gapsEn: [
      "No colour-grading preset — ink-wash mood comes only from costumes + sets + lighting",
      "No weather system — rain/snow via lighting + SFX only",
      "No crowd-sync tool — set multiple actors' waypoints to the same time by hand",
      "No crowd simulation — start with 5–8 person formations",
    ],
  },
  {
    id: "ang-lee",
    labelZh: "李安",
    labelEn: "Ang Lee",
    genreZh: "华语",
    genreEn: "Chinese & Hong Kong",
    descriptionZh: "克制：感情、欲望、冲突都压在礼仪与沉默之下。饭桌即战场，家即世界。",
    descriptionEn: "Restraint: feeling, desire and conflict pressed under manners and silence. The dinner table is the battlefield; home is the world.",
    cameraPresetId: "indoor-medium",
    lightingId: "warm",
    shotOrder: ["indoor-medium", "indoor-ots", "indoor-medium", "indoor-closeup"],
    suggestedSets: ["set-apartment", "set-home-kitchen", "set-restaurant", "set-grassland"],
    suggestedCostumes: ["cinderella-gown", "farmer-modern", "scholar-robe", "chef-whites"],
    suggestedActions: ["walk", "sit", "turn", "bow"],
    beatsZh: [
      "沉默三拍：对白 → 停顿 → 再对白",
      "压抑 → 一次释放：全片只准哭一次",
      "身体先说实话，嘴后说谎",
      "打斗是谈话：每拍一进一退",
      "重逢结构：相遇 / 分开 / 重逢",
    ],
    beatsEn: [
      "Three beats of silence: dialogue → pause → dialogue again",
      "Repression → one release: cry only once in the whole film",
      "The body tells the truth first, the mouth lies after",
      "A fight is a conversation: each beat advances and retreats",
      "Reunion structure: meet / part / meet again",
    ],
    playbook: "ang-lee.md",
    gapsZh: [
      "没有分屏对照——两个版本只能先后放，不能同屏对比",
      "没有水体特效与动物模型——海洋用空旷外景 + 灯光 + 音乐暗示",
      "没有 120fps/3D——也不要学",
      "没有旗袍服装——用礼服代替",
    ],
    gapsEn: [
      "No split-screen comparison — two versions can only play sequentially, not side by side",
      "No water effects or animal models — imply the sea with an empty outdoor set + lighting + music",
      "No 120fps/3D — and don't try to copy it",
      "No qipao costume — a gown stands in",
    ],
  },
  {
    id: "tsui-hark",
    labelZh: "徐克",
    labelEn: "Tsui Hark",
    genreZh: "华语",
    genreEn: "Chinese & Hong Kong",
    descriptionZh: "速度即风格：风先到，人后到。威亚是语法不是特效，旧类型拆开重组。",
    descriptionEn: "Speed is style: the wind arrives before the person. Wirework is grammar, not effect; old genres taken apart and rebuilt.",
    cameraPresetId: "orbit",
    lightingId: "dusk",
    shotOrder: ["crane-up", "indoor-wide", "indoor-closeup", "orbit"],
    suggestedSets: ["set-market", "set-snow", "set-tang-palace", "set-ancient-street"],
    suggestedCostumes: ["wuxia-white", "wuxia-black", "fairy-white", "emperor-dragon"],
    suggestedActions: ["flySword", "wireFly", "leap", "fight"],
    beatsZh: [
      "风先到，人后到：风是角色",
      "威亚是语法，不是特效",
      "试探 → 破坏布景 → 飞天，三拍升级",
      "一镜立住奇观，再切碎打斗",
      "身份翻转做高潮：现形那一拍最重",
    ],
    beatsEn: [
      "Wind first, person second: the wind is a character",
      "Wirework is grammar, not effect",
      "Probe → wreck the set → fly: three beats of escalation",
      "One shot establishes the spectacle, then cut the fight into pieces",
      "Identity flip is the climax: the reveal beat hits hardest",
    ],
    playbook: "tsui-hark.md",
    gapsZh: [
      "没有手持/晃动镜头预设——用近景 + 快速切换机位 + 音效近似",
      "没有群演同步工具——多演员走位手动设同一时间",
      "没有 CGI 妖怪——现形用换装 + 灯光切换 + 音效",
    ],
    gapsEn: [
      "No handheld/shaky camera preset — approximate with close-ups + fast camera switches + SFX",
      "No crowd-sync tool — set multiple actors' waypoints to the same time by hand",
      "No CGI monsters — the reveal uses a costume change + lighting switch + SFX",
    ],
  },
  {
    id: "john-woo",
    labelZh: "吴宇森",
    labelEn: "John Woo",
    genreZh: "华语",
    genreEn: "Chinese & Hong Kong",
    descriptionZh: "英雄本色：枪战当芭蕾排，慢动作只给生死与抉择。两个男人之间的义气比子弹更重要。",
    descriptionEn: "Heroic bloodshed: gunfights choreographed like ballet, slow motion only for death and decisions. Brotherhood between two men matters more than bullets.",
    cameraPresetId: "indoor-ots",
    lightingId: "candlelight",
    shotOrder: ["indoor-ots", "indoor-closeup", "indoor-wide", "indoor-closeup"],
    suggestedSets: ["set-wedding", "set-restaurant", "set-hospital", "set-beach"],
    suggestedCostumes: ["ceo-suit", "police-uniform", "officer-uniform", "scholar-robe"],
    suggestedActions: ["fight", "dodge", "leap", "fall"],
    beatsZh: [
      "对峙先静后动：墨西哥式僵局",
      "枪战当芭蕾：3–8 拍短语，空枪是转折",
      "兄弟背靠背：两个人就是一个阵型",
      "护住无辜者：枪口永远绕开一个人",
      "最后一击留给牺牲：赢的人活着，输的人有尊严",
    ],
    beatsEn: [
      "Standoff first, still then moving: the Mexican standoff",
      "Gunfight as ballet: 3–8 beat phrases, the empty gun is the turn",
      "Brothers back to back: two people are one formation",
      "Protect the innocent: the gun never points at one person",
      "The last blow belongs to sacrifice: the winner lives, the loser keeps dignity",
    ],
    playbook: "john-woo.md",
    gapsZh: [
      "动作库没有持枪/换弹/双枪专属动作——用 fight/punch/dodge 节拍 + 枪声音效近似",
      "没有白鸽道具——用慢动作 + 烛光 + 意象替代",
      "没有教堂场景——用婚礼大厅近似",
      "没有真慢动作——用走位放慢 + 音效近似",
    ],
    gapsEn: [
      "No gun/draw/reload/dual-wield actions — approximate with fight/punch/dodge beats + gun SFX",
      "No dove prop — substitute slow motion + candlelight + imagery",
      "No church set — a wedding hall stands in",
      "No true slow motion — approximate with slowed blocking + SFX",
    ],
  },
  {
    id: "johnnie-to",
    labelZh: "杜琪峰",
    labelEn: "Johnnie To",
    genreZh: "华语",
    genreEn: "Chinese & Hong Kong",
    descriptionZh: "静默的几何学：一群男人在空旷空间里站位、对峙、等待，沉默比枪声更长。",
    descriptionEn: "The geometry of silence: men standing, facing off, waiting in empty space — silence longer than gunfire.",
    cameraPresetId: "indoor-wide",
    lightingId: "night",
    shotOrder: ["indoor-wide", "indoor-medium", "indoor-ots", "indoor-wide"],
    suggestedSets: ["set-mall-prosperous", "set-street", "set-office-meeting", "set-hospital"],
    suggestedCostumes: ["ceo-suit", "police-uniform", "ceo-casual", "officer-uniform"],
    suggestedActions: ["walk", "crouch", "hide", "fall"],
    beatsZh: [
      "先静后爆：30 秒什么都不发生，枪声是标点",
      "站位即战术：先摆好，再开枪",
      "群戏轮流当主角：没有固定中心",
      "倒计时/一夜限时：时间即压力",
      "暴力要付出代价：每场开枪都不可逆",
    ],
    beatsEn: [
      "Still first, then burst: 30 seconds of nothing, gunfire is punctuation",
      "Position is tactics: set the formation first, then shoot",
      "Ensemble takes turns as lead: no fixed centre",
      "Countdown / one night only: time is the pressure",
      "Violence costs: every shot is irreversible",
    ],
    playbook: "johnnie-to.md",
    gapsZh: [
      "没有真摇臂长镜头——用不间断走位 + crane-up/orbit 模拟，注明“模拟一镜”",
      "没有真慢动作/变速——用走位放慢 + 音效近似",
      "动作库没有举枪/射击动作——用 fight 编排 + 走位 + 音效模拟",
    ],
    gapsEn: [
      "No true crane long take — simulate with unbroken blocking + crane-up/orbit, labelled 'simulated one-take'",
      "No true slow motion/speed change — approximate with slowed blocking + SFX",
      "No draw/shoot actions — simulate with fight choreography + blocking + SFX",
    ],
  },
  {
    id: "jiang-wen",
    labelZh: "姜文",
    labelEn: "Jiang Wen",
    genreZh: "华语",
    genreEn: "Chinese & Hong Kong",
    descriptionZh: "荷尔蒙 + 讽刺 + 历史寓言。阳光暴晒的 swagger、机枪一样的密集台词，站着把钱挣了。",
    descriptionEn: "Hormones + satire + historical allegory. Sun-baked swagger, machine-gun dialogue — earn the money standing up.",
    cameraPresetId: "indoor-wide",
    lightingId: "warm",
    shotOrder: ["indoor-wide", "indoor-ots", "indoor-closeup", "dolly-in"],
    suggestedSets: ["set-ancient-street", "set-rural-hall", "set-street", "set-desert"],
    suggestedCostumes: ["scholar-robe", "officer-uniform", "cinderella-gown", "farmer-ancient"],
    suggestedActions: ["point", "turn", "walk", "fall"],
    beatsZh: [
      "台词当子弹打：正反打快切，一句顶一句",
      "荒诞开场定调：第一分钟就告诉观众这不是正经历史片",
      "暴力要等：先吵架，再动手，动手只一刀",
      "幽默是刀鞘：笑完立刻见血",
      "动作在高处：屋顶、马背、火车顶",
    ],
    beatsEn: [
      "Dialogue fires like bullets: fast shot/reverse-shot, every line tops the last",
      "Absurd opening sets the tone: the first minute says this is not a straight history film",
      "Violence waits: argue first, strike once",
      "Humour is the sheath: laugh, then blood at once",
      "Action happens up high: rooftops, horseback, train roofs",
    ],
    playbook: "jiang-wen.md",
    gapsZh: [
      "没有黑白/去色灯光预设——只能用 cold/overcast 近似，黑白转彩色需后期标注",
      "没有专用低角度预设——用 crane-up 从低处起幅近似",
      "没有火车/屋顶跑酷特技——用走位高度 + 快切近似",
    ],
    gapsEn: [
      "No B&W/desaturation lighting preset — approximate with cold/overcast; the B&W-to-colour turn needs a post note",
      "No dedicated low-angle preset — approximate with crane-up starting low",
      "No train/rooftop parkour stunt — approximate with blocking height + fast cuts",
    ],
  },
  {
    id: "ning-hao",
    labelZh: "宁浩",
    labelEn: "Ning Hao",
    genreZh: "华语",
    genreEn: "Chinese & Hong Kong",
    descriptionZh: "多线交汇 + 巧合多米诺。几拨小人物被同一个值钱物件吸进同一张网，一件小事错一下，全网跟着错。",
    descriptionEn: "Multi-thread collision + coincidence dominoes. Several groups of nobodies pulled into one net by a single valuable object; one small mistake and the whole net slips.",
    cameraPresetId: "indoor-wide",
    lightingId: "overcast",
    shotOrder: ["indoor-wide", "dolly-in", "indoor-medium", "indoor-closeup"],
    suggestedSets: ["set-street", "set-desert", "set-farm", "set-market"],
    suggestedCostumes: ["farmer-modern", "ceo-suit", "rider-uniform", "ceo-casual"],
    suggestedActions: ["run", "hide", "rappel", "fall"],
    beatsZh: [
      "多线并行，最后收束：一个物件撞在一起",
      "巧合多米诺：一件小事错一下，全网跟着错",
      "追逐即收束：追的终点是所有线撞在一起",
      "暴力突然、短促、不煽情：一下之前是忍，一下之后是代价",
      "驯化反转：权力关系一拍翻转",
    ],
    beatsEn: [
      "Threads run parallel, then collide: one object brings them together",
      "Coincidence dominoes: one small mistake and the whole net slips",
      "The chase IS the collision: it ends where all threads meet",
      "Violence sudden, short, unsentimental: endure, then one blow, then the cost",
      "Taming reversed: the power relation flips in one beat",
    ],
    playbook: "ning-hao.md",
    gapsZh: [
      "没有同一事件多机位重放——同一段走位存两个版本，用不同机位各预演一次",
      "没有剪辑/转场特效——用机位硬切 + 音效模拟",
      "没有语音/方言功能——方言笑点只落在剧本台词和字幕上",
      "没有手持晃动/车载跟拍——车辆追逐用 run + waypoint 近似",
      "没有 CGI 外星人——用服装 + 道具近似",
    ],
    gapsEn: [
      "No multi-angle replay of one event — save two versions of the same blocking, preview each with a different camera",
      "No editing/transition effects — simulate with hard camera cuts + SFX",
      "No voice/dialect feature — dialect jokes live only in script lines and subtitles",
      "No handheld/vehicle-mounted tracking — car chases approximated with run + waypoints",
      "No CGI alien — approximate with costume + props",
    ],
  },
  {
    id: "james-wan",
    labelZh: "温子仁",
    labelEn: "James Wan",
    genreZh: "恐怖",
    genreEn: "Horror",
    descriptionZh: "先立恐惧，再给惊吓。一间住满人的房子、一个有规则的游戏、一段漫长的寂静，怪物是娃娃，锚点是家庭。",
    descriptionEn: "Fear first, scare second. A house full of people, a game with rules, a long silence — the monster is a doll, the anchor is the family.",
    cameraPresetId: "indoor-medium",
    lightingId: "night",
    shotOrder: ["indoor-wide", "indoor-medium", "indoor-ots", "indoor-closeup"],
    suggestedSets: ["set-apartment", "set-home-bedroom", "set-hospital", "set-school"],
    suggestedCostumes: ["farmer-modern", "ceo-suit", "lawyer-suit", "wuxia-black"],
    suggestedActions: ["walk", "hide", "crouch", "turn"],
    beatsZh: [
      "先立恐惧，再给惊吓：惊吓只是恐惧攒满后的释放",
      "声音先走，画面后到：先静，再响",
      "规则先行，再打破：观众先学会规则，再看它被违反",
      "慢走，别跑：走向危险比逃离更吓人",
      "暖场戏：恐惧之间的喘息，让观众爱上这家人",
    ],
    beatsEn: [
      "Fear first, scare second: the scare is only the release of built-up dread",
      "Sound first, image second: silence, then noise",
      "Rules first, then broken: the audience learns the rule, then watches it violated",
      "Walk slow, don't run: walking toward danger is scarier than fleeing",
      "Warm scene between scares: let the audience love this family",
    ],
    playbook: "james-wan.md",
    gapsZh: [
      "没有连续慢推功能——用中景 → 特写的两镜模拟，不要声称是真推轨",
      "没有真正的'倒着走'动作——用 turn + walk + 过肩机位模拟",
      "没有'附身'特效——用呆滞动作 + 突然爆发 + 反应特写表示",
      "没有娃娃/木偶专属道具——用程序化小道具代替",
      "服装库没有现成的'修女恶魔'套装——用原型 + 一件标志单品拼",
    ],
    gapsEn: [
      "No continuous slow push-in — simulate with a medium → close-up pair, never claim a real dolly",
      "No true 'walk backwards' action — simulate with turn + walk + over-the-shoulder",
      "No 'possession' effect — show it with stillness + sudden burst + reaction close-up",
      "No doll/puppet prop — substitute a procedural small prop",
      "No ready-made 'demon nun' costume — build it from an archetype + one signature piece",
    ],
  },
  {
    id: "john-carpenter",
    labelZh: "约翰·卡朋特",
    labelEn: "John Carpenter",
    genreZh: "恐怖",
    genreEn: "Horror",
    descriptionZh: "平凡之地 + 无声的形 + 合成器心跳。最普通的郊区街道，一个不说话的白面具身影慢慢走近。",
    descriptionEn: "Ordinary place + the silent Shape + synth heartbeat. The most ordinary suburban street, a voiceless white-masked figure walking slowly closer.",
    cameraPresetId: "indoor-wide",
    lightingId: "night",
    shotOrder: ["indoor-wide", "indoor-ots", "indoor-wide", "indoor-closeup"],
    suggestedSets: ["set-street", "set-apartment", "set-hospital", "set-snow"],
    suggestedCostumes: ["guard-uniform", "student-casual", "doctor-coat", "farmer-modern"],
    suggestedActions: ["walk", "run", "hide", "dodge"],
    beatsZh: [
      "杀手只走，不跑：不可阻挡感来自匀速",
      "宽画幅留空：杀手从画面边缘进来",
      "静默 + 极简合成器脉冲：音乐是心跳",
      "一夜时间结构：倒计时即紧张",
      "最后女孩靠反击活下来：不是靠被救",
    ],
    beatsEn: [
      "The killer only walks, never runs: unstoppable comes from constant speed",
      "Wide frame left empty: the killer enters from the edge",
      "Silence + minimal synth pulse: the music is a heartbeat",
      "One-night structure: the countdown is the tension",
      "The final girl survives by fighting back, not by being rescued",
    ],
    playbook: "john-carpenter.md",
    gapsZh: [
      "没有'杀手 POV'机位——用过肩 + 跟随走位代替",
      "没有雾效——用灯光 + 距离表现",
      "没有面具专属服装——用深色工装 + 空白面具意象",
      "没有真长镜头一镜到底——用连续走位模拟",
    ],
    gapsEn: [
      "No 'killer POV' camera — substitute over-the-shoulder + following blocking",
      "No fog effect — suggest with lighting + distance",
      "No mask costume — dark coveralls + a blank-mask image",
      "No true one-take long shot — simulate with unbroken blocking",
    ],
  },
  {
    id: "wes-craven",
    labelZh: "韦斯·克雷文",
    labelEn: "Wes Craven",
    genreZh: "恐怖",
    genreEn: "Horror",
    descriptionZh: "元恐怖：角色知道恐怖片的规则，怪物也知道。梦境即战场，安全的地方最危险。",
    descriptionEn: "Meta-horror: the characters know the rules, and so does the monster. Dreams are the battlefield; the safest place is the most dangerous.",
    cameraPresetId: "indoor-medium",
    lightingId: "dramatic",
    shotOrder: ["indoor-medium", "indoor-ots", "indoor-closeup", "orbit"],
    suggestedSets: ["set-home-bedroom", "set-apartment", "set-hospital", "set-desert"],
    suggestedCostumes: ["wuxia-black", "student-casual", "farmer-modern", "ceo-suit"],
    suggestedActions: ["hide", "fall", "turn", "point"],
    beatsZh: [
      "先立一条规则，再让角色亲口说出来",
      "梦与现实同一布景，只换灯光",
      "开场先杀一个'主角脸'",
      "电话/画外音当武器",
      "幸存者靠'识破规则'反杀，不靠力气",
    ],
    beatsEn: [
      "Set one rule first, then let a character say it aloud",
      "Dream and reality share one set — only the lighting changes",
      "Open by killing a 'lead face'",
      "The phone / off-screen voice is a weapon",
      "The survivor wins by seeing through the rule, not by strength",
    ],
    playbook: "wes-craven.md",
    gapsZh: [
      "没有倾斜机位（Dutch angle），也没有旋转房间——用 orbit 环绕 + 走位高度变化 + 灯光切 dramatic 代替",
      "没有单独的'梦境模式'——梦境 = 灯光 + 机位 + 走位的组合",
      "没有红绿横纹毛衣/白面具专属服装——用黑袍 + 标志单品近似",
      "没有剪刀道具——用现有道具替代",
    ],
    gapsEn: [
      "No Dutch angle, no rotating room — substitute orbit + blocking height changes + dramatic lighting",
      "No separate 'dream mode' — a dream is a lighting + camera + blocking combination",
      "No red-green sweater / white-mask costume — approximate with a black robe + signature piece",
      "No scissors prop — substitute an existing prop",
    ],
  },
  {
    id: "jordan-peele",
    labelZh: "乔丹·皮尔",
    labelEn: "Jordan Peele",
    genreZh: "恐怖",
    genreEn: "Horror",
    descriptionZh: "社会恐怖：最体面的日常场景藏着一套吃人的规则。反转重构一切，凝视即危险。",
    descriptionEn: "Social horror: the most respectable everyday scene hides a set of rules that eats people. The twist reframes everything; the gaze is the danger.",
    cameraPresetId: "indoor-ots",
    lightingId: "warm",
    shotOrder: ["indoor-medium", "indoor-ots", "indoor-closeup", "crane-up"],
    suggestedSets: ["set-apartment", "set-farm", "set-grassland", "set-park"],
    suggestedCostumes: ["guard-uniform", "ceo-casual", "farmer-modern", "ceo-suit"],
    suggestedActions: ["crouch", "run", "hide", "fall"],
    beatsZh: [
      "日常先行，恐怖后置：前 2/3 是剧情片",
      "伏笔 + 回放重构：每个反转至少埋 3 个前期细节",
      "声音触发器：一个日常声音就是开关",
      "凝视即危险：别看它",
      "暴力只给一击：其余全靠克制",
    ],
    beatsEn: [
      "Ordinary first, horror second: the first 2/3 is a drama",
      "Plant clues + reframe on replay: every twist needs at least 3 planted details",
      "Sound trigger: one everyday sound is the switch",
      "The gaze is the danger: don't look at it",
      "Violence gets one blow only: the rest is restraint",
    ],
    playbook: "jordan-peele.md",
    gapsZh: [
      "没有'沉没处'特效——用拉远 + 变暗 + 下沉三件套拼出来",
      "没有剪刀道具——用现有道具替代",
      "没有天空生物 CGI——没预算就别露真身，只拍云、影子和血雨",
      "没有马匹模型——牧场戏用走位 + 灯光暗示",
    ],
    gapsEn: [
      "No 'sunken place' effect — build it from pull-back + dimming + sinking blocking",
      "No scissors prop — substitute an existing prop",
      "No sky-creature CGI — don't show the real body; shoot clouds, shadows and blood rain",
      "No horse model — suggest the ranch with blocking + lighting",
    ],
  },
  {
    id: "ari-aster",
    labelZh: "阿里·艾斯特",
    labelEn: "Ari Aster",
    genreZh: "恐怖",
    genreEn: "Horror",
    descriptionZh: "悲伤即恐怖。恐惧发生在白天，慢火炖出的不安，最后 10 分钟才炸开。",
    descriptionEn: "Grief is horror. Fear happens in daylight — dread simmered on a slow fire, exploding only in the last 10 minutes.",
    cameraPresetId: "indoor-wide",
    lightingId: "day",
    shotOrder: ["indoor-wide", "indoor-medium", "dolly-in", "indoor-closeup"],
    suggestedSets: ["set-apartment", "set-home-kitchen", "set-grassland", "set-flower-field"],
    suggestedCostumes: ["ceo-casual", "fairy-white", "scholar-robe", "student-casual"],
    suggestedActions: ["walk", "turn", "point", "crouch"],
    beatsZh: [
      "慢火炖：先拍 40 分钟家庭剧，再让恐怖进来",
      "白日恐怖：最亮的光，最狠的场面",
      "悲伤当主线拍，恐怖当副线：先哭，再怕",
      "崩溃是动作：一场戏只有一个爆发点",
      "集体同步：众人一起做一件事，比一个人发疯更可怕",
    ],
    beatsEn: [
      "Slow simmer: shoot 40 minutes of family drama before horror enters",
      "Daylight horror: the brightest light, the harshest scene",
      "Grief is the main line, horror the side line: cry first, then fear",
      "Breakdown is action: one explosion point per scene",
      "Synchronised crowd: everyone doing one thing together is scarier than one person going mad",
    ],
    playbook: "ari-aster.md",
    gapsZh: [
      "没有'恐惧值'功能——dread 靠镜头停留时长、机位静止、灯光不躲三样实现",
      "没有血腥/焚烧特效——暴力用反应镜头 + 画外音效 + 事后空镜代替",
      "没有五月柱专属道具——用程序化道具搭",
      "没有整栋玩偶屋布景——复用一间 dress 好的房间 + 换灯光",
    ],
    gapsEn: [
      "No 'dread meter' — dread comes from long holds, a still camera, and lighting that doesn't hide",
      "No gore/burning effects — violence is a reaction shot + off-screen SFX + an empty shot after",
      "No maypole prop — build one from procedural props",
      "No whole dollhouse set — reuse one dressed room + relight it",
    ],
  },
  {
    id: "robert-eggers",
    labelZh: "罗伯特·艾格斯",
    labelEn: "Robert Eggers",
    genreZh: "恐怖",
    genreEn: "Horror",
    descriptionZh: "民间恐怖 + 考据癖。时代、语言、服装、建筑全部按史料还原；氛围压过 jump scare。",
    descriptionEn: "Folk horror + period obsession. Era, language, costume and architecture restored to the sources; atmosphere over jump scares.",
    cameraPresetId: "indoor-wide",
    lightingId: "candlelight",
    shotOrder: ["indoor-wide", "indoor-closeup", "indoor-wide", "crane-up"],
    suggestedSets: ["set-farm", "set-forest", "set-ming-hall", "set-rural-hall"],
    suggestedCostumes: ["farmer-ancient", "scholar-robe", "wuxia-black", "farmer-modern"],
    suggestedActions: ["turn", "crouch", "hide", "walk"],
    beatsZh: [
      "慢炖：长镜头、静止、让观众先害怕",
      "只用时代里有的光：烛光、月光、壁炉",
      "古语当台词：语言本身就是时代布景",
      "仪式当动作拍：每一步都有规矩",
      "影子先行：人未到，影子先到",
    ],
    beatsEn: [
      "Slow simmer: long takes, stillness, let the audience fear first",
      "Only light the era had: candlelight, moonlight, fireplace",
      "Archaic language as dialogue: the language IS the period set",
      "Shoot ritual as action: every step has a rule",
      "Shadow first: the person hasn't arrived, the shadow has",
    ],
    playbook: "robert-eggers.md",
    gapsZh: [
      "没有画幅比例/黑白滤镜控制——1.19:1 与黑白无法直接复现，用窄构图 + 灯光近似",
      "没有专用城堡/维京大厅布景——用室内大厅 + 烛光近似",
      "没有方言/古语功能——古语靠剧本文字实现",
      "没有动物模型——黑山羊/海鸥用走位点 + 人物绕行表示",
    ],
    gapsEn: [
      "No aspect-ratio / B&W filter control — 1.19:1 and black-white can't be reproduced directly; approximate with narrow framing + lighting",
      "No dedicated castle / Viking hall set — approximate with an indoor hall + candlelight",
      "No dialect/archaic-language feature — archaic speech lives in the script text",
      "No animal models — the black goat / seagull is a waypoint + characters walking around it",
    ],
  },
  {
    id: "hideo-nakata",
    labelZh: "中田秀夫",
    labelEn: "Hideo Nakata",
    genreZh: "恐怖",
    genreEn: "Horror",
    descriptionZh: "慢烧的日常恐怖：诅咒藏在录像带、电视、漏水的天花板里。一次爆发，绝不靠血浆和连环 jump scare。",
    descriptionEn: "Slow-burn everyday horror: the curse hides in a videotape, a TV, a leaking ceiling. One explosion — never gore or chained jump scares.",
    cameraPresetId: "indoor-wide",
    lightingId: "cold",
    shotOrder: ["indoor-wide", "indoor-ots", "indoor-closeup", "crane-up"],
    suggestedSets: ["set-apartment", "set-rural-hall", "set-bridge", "set-lake"],
    suggestedCostumes: ["fairy-white", "farmer-modern", "student-casual", "scholar-robe"],
    suggestedActions: ["walk", "crouch", "point", "climb"],
    beatsZh: [
      "慢烧：长静止镜头，让观众自己害怕",
      "声音先行：滴水、静电、耳语",
      "调查结构：倒计时 + 一条线索接一条线索",
      "日常空间越拍越小",
      "结局不是打赢，是理解或牺牲",
    ],
    beatsEn: [
      "Slow burn: long still shots, let the audience scare themselves",
      "Sound first: dripping water, static, whispers",
      "Investigation structure: a countdown, one clue after another",
      "Everyday space shot smaller and smaller",
      "The ending is not victory — it's understanding or sacrifice",
    ],
    playbook: "hideo-nakata.md",
    gapsZh: [
      "没有胶片颗粒/录像带画质滤镜——用 cold 灯光 + 静电音效代替",
      "没有真实水体模拟——swim 只是姿态，靠灯光 + 音效 + 演员姿态暗示",
      "没有'穿屏'特效——用过肩机位 + 鬼的 waypoint 从屏幕向镜头爬",
      "打斗编排在这里不用——不要给主角安排 punch/kick/fight 去打鬼",
    ],
    gapsEn: [
      "No film-grain / VHS-quality filter — substitute cold lighting + static SFX",
      "No real water simulation — swim is only a pose; suggest with lighting + SFX + the actor's pose",
      "No 'climb through the screen' effect — use over-the-shoulder + the ghost's waypoint crawling from the screen toward the lens",
      "Fight choreography is not used here — never give the hero punch/kick/fight against the ghost",
    ],
  },
  {
    id: "george-romero",
    labelZh: "乔治·A·罗梅罗",
    labelEn: "George A. Romero",
    genreZh: "恐怖",
    genreEn: "Horror",
    descriptionZh: "一间锁死的房子 + 一群走不快但永远不会停的死人 + 一群先被自己人害死的活人。怪物是镜子，讽刺是本体。",
    descriptionEn: "One locked house + a horde that walks slow but never stops + the living killed by their own first. The monster is a mirror; the satire is the point.",
    cameraPresetId: "indoor-wide",
    lightingId: "cold",
    shotOrder: ["indoor-wide", "indoor-medium", "indoor-closeup", "crane-up"],
    suggestedSets: ["set-farm", "set-mall-prosperous", "set-mall-ruined", "set-office"],
    suggestedCostumes: ["farmer-modern", "ceo-suit", "officer-uniform", "police-uniform"],
    suggestedActions: ["walk", "fall", "punch", "block"],
    beatsZh: [
      "慢就是恐怖：尸群从不跑",
      "内部冲突先于外部怪物：怪物在门外，杀机在屋里",
      "规则先立住，全片不改",
      "讽刺靠并置，不靠说教",
      "逃出生天，但不胜利",
    ],
    beatsEn: [
      "Slow is horror: the horde never runs",
      "Inner conflict before the outer monster: the monster is outside, the killing is inside",
      "Set the rules first, never change them",
      "Satire by juxtaposition, not by preaching",
      "Escape, but no victory",
    ],
    playbook: "george-romero.md",
    gapsZh: [
      "导演台没有'尸群'功能——用多个演员配同一个 walk 动作 + 宽景表现",
      "导演台没有黑白滤镜——冷调 + 高对比是近似，不是复刻",
      "导演台没有血浆/断肢特效——血腥场面用反应特写 + 音效暗示",
      "没有手持晃动伪纪录片模式——用平视定场 + 播报对白近似",
    ],
    gapsEn: [
      "No 'horde' feature — use several actors with the same walk action + wide shots",
      "No B&W filter — cold tone + high contrast is an approximation, not a replica",
      "No gore/dismemberment effects — blood is a reaction close-up + SFX",
      "No handheld pseudo-documentary mode — approximate with eye-level establishing shots + news-report dialogue",
    ],
  },
];

/** 按 id 取预设；未知 / 空 id 安全回落 undefined（= 无预设，绝不抛错）。 */
export function getDirectorStyle(id: string | null | undefined): DirectorStyle | undefined {
  if (!id) return undefined;
  return DIRECTOR_STYLES.find((s) => s.id === id);
}

export function isDirectorStyleId(id: string): boolean {
  return DIRECTOR_STYLES.some((s) => s.id === id);
}

/**
 * 选预设 = 应用它的默认值；未知 id / 清除 = plain 默认。
 * 纯函数：store 的 setDirectorStyleId 和逻辑校验共用它。
 * （注意：它只返回“默认值”，不碰 shots/actors——应用预设永不
 * 删改用户已有的分镜、演员、走位。）
 */
export function directorStyleDefaults(id: string | null | undefined): {
  cameraPresetId: string;
  lightingId: LightingId;
  shotOrder: string[];
} {
  const style = getDirectorStyle(id);
  if (!style) return { ...PLAIN_DEFAULTS, shotOrder: [] };
  return {
    cameraPresetId: style.cameraPresetId,
    lightingId: style.lightingId,
    shotOrder: [...style.shotOrder],
  };
}
