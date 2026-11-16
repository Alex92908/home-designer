/**
 * cinematic —— 电影机位路径（studio-mvp / 云横店孵化第一块砖）。
 *
 * 把「白膜 previz → AI 视频」管线的机位部分做成数据：一条路径 = 随时间 t
 * (0→1) 变化的 (相机位置, 注视点, fov)。MVP 提供三个参数化预设（按建筑
 * 尺寸自动取景），后续再上关键帧编辑器。
 *
 * 产物用途：外观图里按路径播放并用 MediaRecorder 录成短片 + 首/尾帧 PNG，
 * 直接可喂即梦/Kling 的图生视频、首尾帧模式。
 */
import {
  ACTION_REGISTRY,
  actorPositionAt,
  actorStateAt,
  resolveAction,
  type ActionId,
  type ActionSegment,
  type Waypoint,
} from "./actions";
import type { LightingId } from "./lighting";

export interface CameraSample {
  /** 世界坐标相机位置 */
  pos: [number, number, number];
  /** 注视点 */
  lookAt: [number, number, number];
  /** 视场角（度） */
  fov: number;
}

export interface CinePreset {
  id: string;
  /** 中文名（UI 展示） */
  nameZh: string;
  nameEn: string;
  /** 建议时长（秒）——对齐主流视频模型 5s/10s 档 */
  duration: number;
  /** 室内机位（在房间里框人，不围建筑转）——越轴警告只看室内镜 */
  indoor?: boolean;
  /** 按建筑包络采样：t∈[0,1] → 相机状态。target 供室内机位框人；
   *  室外预设忽略它（保持向后兼容）。 */
  sample: (t: number, env: SceneEnvelope, target?: ActorTarget) => CameraSample;
}

/** 取景所需的场景包络（由外观图现算传入） */
export interface SceneEnvelope {
  /** 地面层footprint（米） */
  W: number;
  D: number;
  /** 层数 */
  floors: number;
}

const FLOOR_H = 2.8;

/** 平滑步进（两端缓入缓出），机位不匀速才有"摇臂感" */
function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 室内机位要框的目标（一个演员的走位段）。
 *  from/to 为地面世界坐标 [x, z]；facing 为朝向（弧度，0 = +Z，
 *  与 ActorsLayer 的 rotation.y = atan2(dx, dz) 同约定）。
 *  at 可选：给定归一化时间 t∈[0,1] 返回演员当时的实际位置/高度/朝向
 *  （走位时间轴 + 动作时间轴 + 打斗编舞算出），优先于 from→to 线性插值。 */
export interface ActorTarget {
  from: [number, number];
  to: [number, number];
  facing?: number;
  /** 目标身高（米），缺省 1.7——仅作注视点高度参考 */
  height?: number;
  at?: (t: number) => { x: number; z: number; y?: number; facing: number };
}

/** 室内机位：随 t 跟住目标（at 优先，否则 from→to 平滑插值），返回目标位置 + 高度 + 朝向 */
function trackTarget(t: number, target?: ActorTarget): { x: number; y: number; z: number; facing: number } {
  if (target?.at) {
    const s = target.at(t);
    return { x: s.x, y: s.y ?? 0, z: s.z, facing: s.facing };
  }
  const tg = target ?? { from: [0, 0] as [number, number], to: [0, 0] as [number, number], facing: 0 };
  const e = easeInOut(t);
  return {
    x: tg.from[0] + (tg.to[0] - tg.from[0]) * e,
    y: 0,
    z: tg.from[1] + (tg.to[1] - tg.from[1]) * e,
    facing: tg.facing ?? 0,
  };
}

export const CINE_PRESETS: CinePreset[] = [
  {
    id: "orbit",
    nameZh: "环绕一圈",
    nameEn: "Orbit 360°",
    duration: 10,
    sample: (t, { W, D, floors }) => {
      const h = floors * FLOOR_H;
      const r = Math.max(W, D) * 1.15 + 8;
      // 从东南角起转（与默认视角接近，起幅不突兀），逆时针一整圈
      const a = Math.PI * 0.25 + t * Math.PI * 2;
      return {
        pos: [Math.sin(a) * r, h * 0.85 + 2, Math.cos(a) * r],
        lookAt: [0, h * 0.45, 0],
        fov: 45,
      };
    },
  },
  {
    id: "dolly-in",
    nameZh: "推近入户",
    nameEn: "Dolly In",
    duration: 8,
    sample: (t, { W, D, floors }) => {
      const h = floors * FLOOR_H;
      const e = easeInOut(t);
      const far = Math.max(W, D) * 1.6 + 14;
      const near = Math.max(W, D) * 0.55 + 4;
      const r = far + (near - far) * e;
      // 南侧正面推近，镜头略降（远景俯瞰 → 近景平视，入户视角）
      const a = Math.PI * 0.12; // 略偏东南，立面有透视
      return {
        pos: [Math.sin(a) * r, (h * 0.9 + 4) * (1 - e) + 1.7 * e, Math.cos(a) * r],
        lookAt: [0, h * 0.4 * (1 - e) + 1.5 * e, 0],
        fov: 45 + 5 * e, // 推近时略广，加速度感
      };
    },
  },
  {
    id: "crane-up",
    nameZh: "摇臂升起",
    nameEn: "Crane Up",
    duration: 8,
    sample: (t, { W, D, floors }) => {
      const h = floors * FLOOR_H;
      const e = easeInOut(t);
      const r0 = Math.max(W, D) * 0.7 + 5;
      const r1 = Math.max(W, D) * 1.3 + 10;
      const r = r0 + (r1 - r0) * e;
      // 人眼高度起，升到俯瞰全宅 + 院子；水平方向缓慢右摇 40°
      const a = Math.PI * 0.2 + e * (Math.PI * 0.22);
      return {
        pos: [Math.sin(a) * r, 1.7 + (h + Math.max(W, D) * 0.55) * e, Math.cos(a) * r],
        lookAt: [0, (1.5 + h * 0.35 * e) * 1, 0],
        fov: 48 - 6 * e, // 升高时略收，画面更"航拍"
      };
    },
  },
  // ── 室内机位（导演台 MVP）：在房间里框人，不围建筑转。相机方位由目标
  // 朝向推导——全景/中景/特写站在人**前面**拍脸；过肩站在人**后面**越肩拍。
  // 距离/高度按房间尺度定（不是建筑包络），镜头跟住走位目标。
  {
    id: "indoor-wide",
    nameZh: "室内全景",
    nameEn: "Indoor Wide",
    duration: 8,
    indoor: true,
    sample: (t, _env, target) => {
      const s = trackTarget(t, target);
      const a = s.facing + (t - 0.5) * 0.12; // 缓慢弧移，有呼吸感
      const d = 5;
      return {
        pos: [s.x - Math.sin(a) * d, 1.8 + s.y, s.z - Math.cos(a) * d],
        lookAt: [s.x, 1.2 + s.y, s.z],
        fov: 50,
      };
    },
  },
  {
    id: "indoor-medium",
    nameZh: "室内中景",
    nameEn: "Indoor Medium",
    duration: 8,
    indoor: true,
    sample: (t, _env, target) => {
      const s = trackTarget(t, target);
      const a = s.facing + (t - 0.5) * 0.08;
      const d = 2.8;
      return {
        pos: [s.x - Math.sin(a) * d, 1.5 + s.y, s.z - Math.cos(a) * d],
        lookAt: [s.x, 1.4 + s.y, s.z],
        fov: 45,
      };
    },
  },
  {
    id: "indoor-closeup",
    nameZh: "室内特写",
    nameEn: "Indoor Close-up",
    duration: 5,
    indoor: true,
    sample: (t, _env, target) => {
      const s = trackTarget(t, target);
      const d = 1.3;
      return {
        pos: [s.x - Math.sin(s.facing) * d, 1.55 + s.y, s.z - Math.cos(s.facing) * d],
        lookAt: [s.x, 1.5 + s.y, s.z],
        fov: 40,
      };
    },
  },
  {
    id: "indoor-ots",
    nameZh: "过肩镜头",
    nameEn: "Over the Shoulder",
    duration: 8,
    indoor: true,
    sample: (t, _env, target) => {
      const s = trackTarget(t, target);
      const d = 1.2; // 站在人后 1.2m
      return {
        pos: [s.x + Math.sin(s.facing) * d, 1.6 + s.y, s.z + Math.cos(s.facing) * d],
        lookAt: [s.x + Math.sin(s.facing) * 2, 1.4 + s.y, s.z + Math.cos(s.facing) * 2],
        fov: 45,
      };
    },
  },
];

export function getCinePreset(id: string): CinePreset | undefined {
  return CINE_PRESETS.find((p) => p.id === id);
}

/** 导出风格（并列可选，实景默认——实景渲染本身就是最强参考视频）：
 *  beauty 实景成品渲染；clay 白模灰盒（锁空间构图运动，材质交 AI 发挥，
 *  Seedance previz 规格）；depth 深度序列（近白远黑，VACE/ControlNet 输入）。 */
export type RenderStyle = "beauty" | "clay" | "depth";

export const RENDER_STYLES: Array<{ id: RenderStyle; nameZh: string; nameEn: string }> = [
  { id: "beauty", nameZh: "实景", nameEn: "Beauty" },
  { id: "clay", nameZh: "白模", nameEn: "Clay" },
  { id: "depth", nameZh: "深度", nameEn: "Depth" },
];

/** 演员动作库：见 actions.ts（数据驱动注册表，30 个动作）。
 *  旧的 walk/run/fight 是其中三项——旧存档（action 只有这三项）照常读。 */
export type ActorAction = ActionId;

export const ACTOR_ACTIONS: Array<{ id: ActorAction; nameZh: string; nameEn: string }> =
  Object.values(ACTION_REGISTRY).map((d) => ({ id: d.id, nameZh: d.nameZh, nameEn: d.nameEn }));

/** 演员占位（方块人级别即可——AI 上色阶段会替换成真人）。
 *  from/to 为地面世界坐标 [x, z]，录制时随播放头 t 从 from 走到 to。
 *  waypoints（动态走位时间轴）优先于 from→to；timeline（动作时间轴）
 *  又优先于 waypoints。两者都缺时就是旧的 from→to。
 *  name/role/facing/action 为导演台新增的可选字段——旧存档（只有 id/from/to）
 *  照常读，缺失时按默认值解释，绝不因升级丢数据。 */
export interface Actor {
  id: string;
  from: [number, number];
  to: [number, number];
  /** 角色名，缺省 "演员N"（按列表序号） */
  name?: string;
  /** 角色身份（如"店主"、"顾客"），缺省 "" */
  role?: string;
  /** 朝向（弧度，0 = +Z），缺省沿 from→to 方向 */
  facing?: number;
  /** 默认动作，缺省 "walk" */
  action?: ActorAction;
  /** 角色原型（characters.ts 的 ARCHETYPES id，如 "ceo"），缺省 = 未选原型 */
  archetypeId?: string;
  /** 服装（characters.ts 的 COSTUMES id，如 "ceo-suit"），缺省 = 原型默认；
   *  全部缺失/未知时按默认素体（default）解释——旧存档照常读，绝不丢数据 */
  costumeId?: string;
  /** 动态走位：[{x, z, y?, facing?, t}]，t 为镜内秒数；缺省 = from→to 两点 */
  waypoints?: Waypoint[];
  /** 动作时间轴：[{action, start, duration, targetPos?, targetY?, arc?, …}] */
  timeline?: ActionSegment[];
}

export function makeActor(
  from: [number, number],
  to: [number, number],
  opts?: { name?: string; role?: string; facing?: number; action?: ActorAction; archetypeId?: string; costumeId?: string; waypoints?: Waypoint[]; timeline?: ActionSegment[] },
): Actor {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    from,
    to,
    ...(opts?.name !== undefined ? { name: opts.name } : {}),
    ...(opts?.role !== undefined ? { role: opts.role } : {}),
    ...(opts?.facing !== undefined ? { facing: opts.facing } : {}),
    ...(opts?.action !== undefined ? { action: opts.action } : {}),
    ...(opts?.archetypeId !== undefined ? { archetypeId: opts.archetypeId } : {}),
    ...(opts?.costumeId !== undefined ? { costumeId: opts.costumeId } : {}),
    ...(opts?.waypoints ? { waypoints: opts.waypoints } : {}),
    ...(opts?.timeline ? { timeline: opts.timeline } : {}),
  };
}

/** 旧存档兼容：名字缺失时按列表序号补 "演员N" */
export function actorDisplayName(a: Actor, index: number): string {
  return a.name?.trim() ? a.name.trim() : `演员${index + 1}`;
}

/** 旧存档兼容：朝向缺失时沿 from→to；零长路径时朝 +Z */
export function actorFacing(a: Actor): number {
  if (a.facing !== undefined) return a.facing;
  const dx = a.to[0] - a.from[0], dz = a.to[1] - a.from[1];
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}

/** 旧存档兼容：动作缺省 "walk"，未知 id 安全回落到 "walk" */
export function actorAction(a: Actor): ActorAction {
  return resolveAction(a.action);
}

/**
 * 某镜的框人目标：用 actorStateAt 把走位时间轴 + 动作时间轴算出来，
 * 再包成 ActorTarget.at——机位跟拍时直接跟演员的真实位置/高度/朝向。
 * （打斗编舞的瞬间位置由 CameraPathPlayer 的 fight 相机覆盖处理。）
 */
export function actorTargetAt(a: Actor, shotDuration: number): ActorTarget {
  return {
    from: a.from,
    to: a.to,
    facing: actorFacing(a),
    // at 取归一化 t∈[0,1]（机位预设的采样约定），这里换算成镜内秒再算状态
    at: (tNorm: number) => {
      const st = actorStateAt(a, tNorm * shotDuration, shotDuration);
      return { x: st.x, z: st.z, y: st.elev, facing: st.facing };
    },
  };
}

/** 分镜里的一个镜头（Shot——产品的原子单位，见云横店蓝图 §三） */
export interface Shot {
  id: string;
  presetId: string;
  /** 时长（秒），可在预设默认值上微调 */
  duration: number;
  /** 本镜提示词（风格/内容描述），随控制包 storyboard.json 导出 */
  prompt: string;
  /** 本镜框住的角色（导演台：每镜下拉选一个演员；缺省为第一个演员） */
  targetActorId?: string;
  /** 本镜灯光（lighting.ts 的 LightingId；缺省 = 跟随场景默认灯光；
   *  旧存档无此字段时按场景默认解释，绝不因升级丢数据） */
  lightingId?: LightingId;
}

export function makeShot(presetId: string, opts?: { targetActorId?: string; lightingId?: LightingId }): Shot {
  const preset = getCinePreset(presetId);
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    presetId,
    duration: preset?.duration ?? 8,
    prompt: "",
    ...(opts?.targetActorId ? { targetActorId: opts.targetActorId } : {}),
    ...(opts?.lightingId ? { lightingId: opts.lightingId } : {}),
  };
}

/** 轴线侧：点 P 相对 A→B 直线的哪一侧（2D 叉积符号） */
export function sideOfLine(px: number, pz: number, ax: number, az: number, bx: number, bz: number): 1 | -1 | 0 {
  const c = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
  if (c > 1e-6) return 1;
  if (c < -1e-6) return -1;
  return 0;
}

/** 越轴判断（只看室内镜）：本镜与上一镜的机位是否落在轴线两侧。
 *  轴线 = 前两位演员在镜中点的位置连线（按走位时间轴算）；机位取各镜中点采样。
 *  室外预设绕建筑转，轴线概念不适用，一律返回 false。 */
export function shotCrossesAxis(shot: Shot, prevShot: Shot, actors: Actor[]): boolean {
  const preset = getCinePreset(shot.presetId);
  const prevPreset = getCinePreset(prevShot.presetId);
  if (!preset?.indoor || !prevPreset?.indoor) return false;
  if (actors.length < 2) return false;
  const target = actors.find((a) => a.id === shot.targetActorId) ?? actors[0];
  const prevTarget = actors.find((a) => a.id === prevShot.targetActorId) ?? actors[0];
  if (!target || !prevTarget) return false;
  const axisA = actorPositionAt(actors[0], shot.duration / 2, shot.duration);
  const axisB = actorPositionAt(actors[1], shot.duration / 2, shot.duration);
  if (axisA[0] === axisB[0] && axisA[1] === axisB[1]) return false;
  const env: SceneEnvelope = { W: 0, D: 0, floors: 1 };
  const cam = preset.sample(0.5, env, actorTargetAt(target, shot.duration));
  const prevCam = prevPreset.sample(0.5, env, actorTargetAt(prevTarget, prevShot.duration));
  const s1 = sideOfLine(cam.pos[0], cam.pos[2], axisA[0], axisA[1], axisB[0], axisB[1]);
  const s2 = sideOfLine(prevCam.pos[0], prevCam.pos[2], axisA[0], axisA[1], axisB[0], axisB[1]);
  return s1 !== 0 && s2 !== 0 && s1 !== s2;
}
