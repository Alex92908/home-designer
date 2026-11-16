/**
 * directorStyles —— 导演风格预设（云横店 M5：拍摄）。
 *
 * 一套预设 = 一位导演的整套拍法，变成导演台里的默认值：新镜的机位、
 * 场景默认灯光、推荐的片场/服装/动作、建议的分镜顺序（机位预设序列）。
 * 预设是起点，不是锁：选了之后用户仍可逐项改（机位、灯光、片场、
 * 服装、动作都可自由调），也可以随时清除回到 plain 默认。
 *
 * 数据驱动：加新导演 = 往 DIRECTOR_STYLES 加一条 + 在
 * docs/director-skills/ 里加一份手册，控制台 UI 不用改。
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

export const DIRECTOR_STYLES: DirectorStyle[] = [
  {
    id: "universal",
    labelZh: "通用",
    labelEn: "Universal (Top 100)",
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
