/**
 * actions —— 导演台动作库（人物动作 / 动态走位 / 动作时间轴）。
 *
 * 设计：动作是数据，不是散落在组件里的 if/else。
 *   · ACTION_REGISTRY：动作 id → {中文名, 类别, 默认时长, 循环}。
 *     加新动作 = 往注册表加一条 + 在 poseFor 里加一段姿态分支，
 *     控制台 UI（下拉框）自动出现，不用改 UI 代码。
 *   · Waypoint：动态走位的时间轴点 [{x, z, facing?, t}]，t 为镜内秒数。
 *     没有 waypoints 时退化为旧的 from→to（两点即一条时间轴）。
 *   · ActionSegment：演员的动作时间轴段 [{action, start, duration,
 *     targetPos?, targetActorId?, facing?}]。时间轴存在时优先于走位路径。
 *   · actorStateAt：纯函数——给定演员 + 镜内时间，算出位置/朝向/姿态。
 *     3D 层（ActorsLayer）每帧调它，不在组件里手写插值。
 *
 * 方块人姿态约定（胶囊身 + 球头 + 两条手臂，见 ActorsLayer）：
 *   pose.y 为身体高度偏移（负 = 下蹲/坐下/倒地）；rotX 为前后俯仰；
 *   armL/armR 为左右臂旋转 [x（前后摆）, z（外展）]，x 为负 = 向前抬起。
 */
import type { Actor } from "./cinematic";

/** 动作 id：旧的 walk/run/fight 是其中三项（向后兼容）；
 *  后 12 项为特技/特殊位置动作（山坡/树上/桌上下/跳车/火车/御剑/扫帚…） */
export type ActionId =
  | "idle" | "stand" | "walk" | "run"
  | "sit" | "standUp" | "turn" | "wave" | "point" | "bow" | "crouch"
  | "punch" | "kick" | "block" | "dodge" | "fall" | "getUp"
  | "fight"
  | "jump" | "climb" | "cling" | "ride"
  | "flySword" | "flyBroom" | "wireFly"
  | "hide" | "prone" | "leap" | "rappel" | "swim";

export type ActionCategory = "move" | "pose" | "gesture" | "fight" | "stunt";

export interface ActionDef {
  id: ActionId;
  nameZh: string;
  nameEn: string;
  category: ActionCategory;
  /** 默认时长（秒）——时间轴段缺省时用它 */
  duration: number;
  /** 是否循环（走/跑/站立在段内循环，单次动作只播一遍） */
  loop: boolean;
}

export const ACTION_REGISTRY: Record<ActionId, ActionDef> = {
  idle:    { id: "idle",    nameZh: "待机",   nameEn: "Idle",    category: "pose",    duration: 2.0, loop: true },
  stand:   { id: "stand",   nameZh: "站立",   nameEn: "Stand",   category: "pose",    duration: 2.0, loop: true },
  walk:    { id: "walk",    nameZh: "走路",   nameEn: "Walk",    category: "move",    duration: 3.0, loop: true },
  run:     { id: "run",     nameZh: "跑",     nameEn: "Run",     category: "move",    duration: 2.0, loop: true },
  sit:     { id: "sit",     nameZh: "坐下",   nameEn: "Sit",     category: "pose",    duration: 1.5, loop: false },
  standUp: { id: "standUp", nameZh: "起身",   nameEn: "Stand up",category: "pose",    duration: 1.2, loop: false },
  turn:    { id: "turn",    nameZh: "转身",   nameEn: "Turn",    category: "pose",    duration: 1.0, loop: false },
  wave:    { id: "wave",    nameZh: "挥手",   nameEn: "Wave",    category: "gesture", duration: 2.0, loop: false },
  point:   { id: "point",   nameZh: "指",     nameEn: "Point",   category: "gesture", duration: 1.5, loop: false },
  bow:     { id: "bow",     nameZh: "鞠躬",   nameEn: "Bow",     category: "gesture", duration: 2.0, loop: false },
  crouch:  { id: "crouch",  nameZh: "蹲下",   nameEn: "Crouch",  category: "pose",    duration: 1.5, loop: false },
  punch:   { id: "punch",   nameZh: "出拳",   nameEn: "Punch",   category: "fight",   duration: 0.8, loop: false },
  kick:    { id: "kick",    nameZh: "踢",     nameEn: "Kick",    category: "fight",   duration: 0.9, loop: false },
  block:   { id: "block",   nameZh: "格挡",   nameEn: "Block",   category: "fight",   duration: 0.8, loop: false },
  dodge:   { id: "dodge",   nameZh: "闪避",   nameEn: "Dodge",   category: "fight",   duration: 0.7, loop: false },
  fall:    { id: "fall",    nameZh: "倒地",   nameEn: "Fall",    category: "fight",   duration: 1.2, loop: false },
  getUp:   { id: "getUp",   nameZh: "起身（倒地后）", nameEn: "Get up", category: "fight", duration: 1.5, loop: false },
  fight:   { id: "fight",   nameZh: "打斗",   nameEn: "Fight",   category: "fight",   duration: 4.0, loop: true },
  // ── 特技 / 特殊位置（高度 + 道具 + 轨迹，见 stuntProps.ts）──
  jump:    { id: "jump",    nameZh: "跳",     nameEn: "Jump",    category: "stunt",   duration: 1.0, loop: false },
  climb:   { id: "climb",   nameZh: "爬",     nameEn: "Climb",   category: "stunt",   duration: 3.0, loop: true },
  cling:   { id: "cling",   nameZh: "贴",     nameEn: "Cling",   category: "pose",    duration: 2.0, loop: true },
  ride:    { id: "ride",    nameZh: "骑",     nameEn: "Ride",    category: "pose",    duration: 3.0, loop: true },
  flySword:{ id: "flySword",nameZh: "御剑飞行", nameEn: "Sword-flying", category: "stunt", duration: 4.0, loop: true },
  flyBroom:{ id: "flyBroom",nameZh: "骑扫帚飞行", nameEn: "Broom-flying", category: "stunt", duration: 4.0, loop: true },
  wireFly: { id: "wireFly", nameZh: "吊威亚", nameEn: "Wire-flying", category: "stunt", duration: 4.0, loop: true },
  hide:    { id: "hide",    nameZh: "躲藏",   nameEn: "Hide",    category: "pose",    duration: 2.0, loop: false },
  prone:   { id: "prone",   nameZh: "躺/趴", nameEn: "Lie prone", category: "pose", duration: 2.0, loop: false },
  leap:    { id: "leap",    nameZh: "轻功",   nameEn: "Qinggong leap", category: "stunt", duration: 1.6, loop: false },
  rappel:  { id: "rappel",  nameZh: "索降",   nameEn: "Rappel",  category: "stunt",   duration: 3.0, loop: true },
  swim:    { id: "swim",    nameZh: "潜水/游泳", nameEn: "Swim", category: "move",    duration: 3.0, loop: true },
};

export const ACTION_LIST: ActionDef[] = Object.values(ACTION_REGISTRY);

/** 未知动作 id 安全退化（旧存档/脏数据不炸） */
export function resolveAction(id: string | undefined): ActionId {
  return (id && id in ACTION_REGISTRY ? (id as ActionId) : "walk");
}

export function actionDef(id: ActionId): ActionDef {
  return ACTION_REGISTRY[id] ?? ACTION_REGISTRY.walk;
}

/** 动态走位的一个时间轴点：t 为镜内秒数。
 *  y 为离地高度（米，Three.js 的 Y 轴向上；地面为 0）——树上/桌上/屋顶/
 *  飞行等特殊位置用它；地面点选默认 y = 0。 */
export interface Waypoint {
  x: number;
  z: number;
  /** 离地高度（米），缺省 0 */
  y?: number;
  /** 朝向（弧度），缺省沿路径方向 */
  facing?: number;
  /** 镜内时间（秒） */
  t: number;
}

export function makeWaypoint(x: number, z: number, t: number, opts?: { y?: number; facing?: number }): Waypoint {
  return {
    x, z, t,
    ...(opts?.y !== undefined ? { y: opts.y } : {}),
    ...(opts?.facing !== undefined ? { facing: opts.facing } : {}),
  };
}

/** 动作时间轴的一段 */
export interface ActionSegment {
  id: string;
  action: ActionId;
  /** 镜内开始时间（秒） */
  start: number;
  /** 时长（秒） */
  duration: number;
  /** 移动类动作的目的地（地面坐标 [x, z]） */
  targetPos?: [number, number];
  /** 目的地高度（米；桌上/树上/屋顶/飞行等用它） */
  targetY?: number;
  /** 跳跃/飞行轨迹：peak 为弧线最高点相对起落连线的凸起（米） */
  arc?: { peak: number };
  /** 打斗类动作的对手演员 id */
  targetActorId?: string;
  /** 动作结束时的朝向（弧度；转身类用它） */
  facing?: number;
  /** 特技安全备注（如"威亚+垫子"、"替身+气垫"）——特技不是儿戏 */
  safety?: string;
  /** 本段用到的特技道具种类（见 stuntProps.ts；无则不填） */
  propKind?: string;
  /** 本段用到的特技道具实例 id（场景里的道具） */
  propId?: string;
}

export function makeSegment(
  action: ActionId | string,
  start: number,
  opts?: { duration?: number; targetPos?: [number, number]; targetY?: number; arc?: { peak: number }; targetActorId?: string; facing?: number; safety?: string; propKind?: string; propId?: string },
): ActionSegment {
  // 未知动作 id 在这里就归一化到 walk（注册表是唯一事实来源）
  const resolved = resolveAction(action);
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    action: resolved,
    start,
    duration: opts?.duration ?? actionDef(resolved).duration,
    ...(opts?.targetPos ? { targetPos: opts.targetPos } : {}),
    ...(opts?.targetY !== undefined ? { targetY: opts.targetY } : {}),
    ...(opts?.arc ? { arc: opts.arc } : {}),
    ...(opts?.targetActorId ? { targetActorId: opts.targetActorId } : {}),
    ...(opts?.facing !== undefined ? { facing: opts.facing } : {}),
    ...(opts?.safety ? { safety: opts.safety } : {}),
    ...(opts?.propKind ? { propKind: opts.propKind } : {}),
    ...(opts?.propId ? { propId: opts.propId } : {}),
  };
}

/** 方块人姿态（ActorsLayer 每帧应用到 group + 手臂） */
export interface Pose {
  /** 身体高度偏移（米），负 = 下蹲/坐下/倒地 */
  y: number;
  /** 前后俯仰（弧度），正 = 前倾 */
  rotX: number;
  /** 左右侧倾（弧度） */
  rotZ: number;
  /** 左臂 [前后摆, 外展]（前后摆为负 = 向前抬起） */
  armL: [number, number];
  /** 右臂 [前后摆, 外展] */
  armR: [number, number];
  /** 是否平躺（倒地） */
  lying: boolean;
}

const NEUTRAL_POSE: Pose = { y: 0, rotX: 0, rotZ: 0, armL: [0, 0.12], armR: [0, -0.12], lying: false };

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function smooth(v: number): number {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}
/** 旧的打斗单节 beat 曲线：冲量 0→0.7→0.2→0.8→0.1（出拳的收放节奏） */
export function lungeCurve(phase: number): number {
  const pts: Array<[number, number]> = [[0, 0], [0.25, 0.7], [0.5, 0.2], [0.75, 0.8], [1, 0.1]];
  for (let i = 1; i < pts.length; i++) {
    if (phase <= pts[i][0]) {
      const [t0, v0] = pts[i - 1];
      const [t1, v1] = pts[i];
      return v0 + (v1 - v0) * ((phase - t0) / (t1 - t0));
    }
  }
  return 0.1;
}

/**
 * 给定动作 + 段内时间（秒）+ 段时长，算出姿态。
 * 循环动作（走/跑/待机）在段内循环；单次动作播一遍后停在末态。
 */
export function poseFor(action: ActionId, localTime: number, duration: number): Pose {
  const def = actionDef(action);
  const d = Math.max(0.2, duration);
  const t = def.loop ? localTime % d : Math.min(localTime, d);
  const phase = clamp01(t / d);
  switch (action) {
    case "idle":
    case "stand":
      return { ...NEUTRAL_POSE, y: 0.012 * Math.sin((localTime / d) * Math.PI * 2) };
    case "walk": {
      const steps = Math.max(2, Math.round(d / 0.55));
      const s = Math.sin(phase * Math.PI * 2 * steps);
      return {
        ...NEUTRAL_POSE,
        y: Math.abs(Math.sin(phase * Math.PI * steps)) * 0.05,
        armL: [s * 0.55, 0.12],
        armR: [-s * 0.55, -0.12],
      };
    }
    case "run": {
      const steps = Math.max(2, Math.round(d / 0.4));
      const s = Math.sin(phase * Math.PI * 2 * steps);
      return {
        ...NEUTRAL_POSE,
        y: Math.abs(Math.sin(phase * Math.PI * steps)) * 0.07,
        rotX: 0.12,
        armL: [s * 0.8, 0.25],
        armR: [-s * 0.8, -0.25],
      };
    }
    case "sit": {
      const e = smooth(phase * 1.4);
      return { ...NEUTRAL_POSE, y: -0.38 * e, rotX: -0.15 * e, armL: [-0.35 * e, 0.12], armR: [-0.35 * e, -0.12] };
    }
    case "standUp": {
      const e = smooth(phase * 1.4);
      return { ...NEUTRAL_POSE, y: -0.38 * (1 - e), rotX: -0.15 * (1 - e), armL: [-0.35 * (1 - e), 0.12], armR: [-0.35 * (1 - e), -0.12] };
    }
    case "turn":
      return NEUTRAL_POSE; // 朝向由 actorStateAt 插值，姿态本身中性
    case "wave": {
      const sway = Math.sin(phase * Math.PI * 6);
      return {
        ...NEUTRAL_POSE,
        rotZ: 0.05 * sway,
        armR: [-2.3, -0.35 - 0.3 * Math.max(0, sway)],
      };
    }
    case "point": {
      const e = smooth(phase * 2);
      return { ...NEUTRAL_POSE, armR: [-1.5 * e, -0.1], rotX: 0.05 * e };
    }
    case "bow": {
      const b = Math.sin(phase * Math.PI);
      return { ...NEUTRAL_POSE, rotX: 0.55 * b, armL: [0.2 * b, 0.12], armR: [0.2 * b, -0.12] };
    }
    case "crouch": {
      const e = phase < 0.5 ? smooth(phase * 2) : 1;
      return { ...NEUTRAL_POSE, y: -0.3 * e, rotX: 0.25 * e, armL: [0.3 * e, 0.12], armR: [0.3 * e, -0.12] };
    }
    case "punch": {
      const k = lungeCurve(phase);
      return { ...NEUTRAL_POSE, rotX: 0.1 * k, armR: [-1.5 * k, -0.1], armL: [0.3 * k, 0.12] };
    }
    case "kick": {
      const k = Math.sin(phase * Math.PI);
      return { ...NEUTRAL_POSE, y: 0.08 * k, rotX: -0.15 * k, armL: [-0.6 * k, 0.3], armR: [0.5 * k, -0.3] };
    }
    case "block":
      return { ...NEUTRAL_POSE, y: -0.08, armL: [-1.2, 0.25], armR: [-1.2, -0.25] };
    case "dodge": {
      const k = Math.sin(phase * Math.PI);
      return { ...NEUTRAL_POSE, y: -0.15 * k, rotZ: 0.2 * k };
    }
    case "fall": {
      const e = smooth(phase * 1.6);
      return { ...NEUTRAL_POSE, y: -0.53 * e, rotX: -1.5 * e, lying: e > 0.5 };
    }
    case "getUp": {
      const e = smooth(phase * 1.6);
      return { ...NEUTRAL_POSE, y: -0.53 * (1 - e), rotX: -1.5 * (1 - e), lying: e < 0.5 };
    }
    case "fight": {
      const k = lungeCurve(phase);
      return {
        ...NEUTRAL_POSE,
        y: Math.abs(Math.sin(phase * Math.PI * 14)) * 0.06,
        rotX: 0.1 + 0.12 * k,
        armR: [-1.2 * k, -0.1],
      };
    }
    // ── 特技 / 特殊位置 ──
    case "jump": {
      const k = Math.sin(phase * Math.PI);
      return { ...NEUTRAL_POSE, rotX: 0.15 * k, armL: [0.3 * k, 0.6 * k], armR: [0.3 * k, -0.6 * k] };
    }
    case "climb": {
      const s = Math.sin(phase * Math.PI * 4);
      return {
        ...NEUTRAL_POSE,
        rotX: 0.1,
        y: Math.abs(Math.sin(phase * Math.PI * 2)) * 0.03,
        armL: [-2.2 + 0.4 * s, 0.2],
        armR: [-2.2 - 0.4 * s, -0.2],
      };
    }
    case "cling":
      return { ...NEUTRAL_POSE, y: -0.05, rotX: 0.15, armL: [-1.3, 0.5], armR: [-1.3, -0.5] };
    case "ride": {
      const bob = Math.abs(Math.sin(phase * Math.PI * 4)) * 0.04;
      return { ...NEUTRAL_POSE, y: -0.35 + bob, rotX: 0.08, armL: [-1.0, 0.15], armR: [-1.0, -0.15] };
    }
    case "flySword":
      return { ...NEUTRAL_POSE, rotX: 0.1, armL: [0.1, 0.5], armR: [0.1, -0.5] };
    case "flyBroom": {
      const bob = Math.abs(Math.sin(phase * Math.PI * 4)) * 0.04;
      return { ...NEUTRAL_POSE, y: -0.35 + bob, rotX: 0.1, armL: [-1.0, 0.15], armR: [-1.0, -0.15] };
    }
    case "wireFly":
      return { ...NEUTRAL_POSE, rotX: 0.05, armL: [0.2, 0.8], armR: [0.2, -0.8] };
    case "hide":
      return { ...NEUTRAL_POSE, y: -0.42, rotX: 0.2, armL: [0.4, 0.1], armR: [0.4, -0.1] };
    case "prone":
      return { ...NEUTRAL_POSE, y: -0.53, rotX: -1.5, lying: true };
    case "leap": {
      const k = Math.sin(phase * Math.PI);
      return { ...NEUTRAL_POSE, rotX: 0.1 * k, armL: [0.2 * k, 0.7 * k], armR: [0.2 * k, -0.7 * k] };
    }
    case "rappel": {
      const sway = Math.sin(phase * Math.PI * 2) * 0.05;
      return { ...NEUTRAL_POSE, rotZ: sway, armL: [-2.6, 0.15], armR: [-2.6, -0.15] };
    }
    case "swim": {
      const s = Math.sin(phase * Math.PI * 4);
      return { ...NEUTRAL_POSE, y: -0.4, rotX: -1.2, armL: [-1.2 + 0.5 * s, 0.3], armR: [-1.2 - 0.5 * s, -0.3] };
    }
    default:
      return NEUTRAL_POSE;
  }
}

/** 旧存档兼容：朝向缺失时沿 from→to；零长路径时朝 +Z */
export function actorFacingOf(a: Pick<Actor, "from" | "to" | "facing">): number {
  if (a.facing !== undefined) return a.facing;
  const dx = a.to[0] - a.from[0], dz = a.to[1] - a.from[1];
  if (dx === 0 && dz === 0) return 0;
  return Math.atan2(dx, dz);
}

/** 走位路径位置：有 waypoints 按时间插值，否则 from→to 线性。
 *  timeSec 为镜内秒数，shotDuration 为本镜时长（秒）。 */
export function actorPositionAt(a: Actor, timeSec: number, shotDuration: number): [number, number] {
  const wps = (a.waypoints ?? []).slice().sort((p, q) => p.t - q.t);
  if (wps.length >= 2) {
    const t = Math.max(wps[0].t, Math.min(timeSec, wps[wps.length - 1].t));
    for (let i = 1; i < wps.length; i++) {
      if (t <= wps[i].t) {
        const p0 = wps[i - 1], p1 = wps[i];
        const span = Math.max(0.001, p1.t - p0.t);
        const k = (t - p0.t) / span;
        return [p0.x + (p1.x - p0.x) * k, p0.z + (p1.z - p0.z) * k];
      }
    }
    const last = wps[wps.length - 1];
    return [last.x, last.z];
  }
  if (wps.length === 1) return [wps[0].x, wps[0].z];
  const d = Math.max(0.001, shotDuration);
  const k = Math.max(0, Math.min(1, timeSec / d));
  return [a.from[0] + (a.to[0] - a.from[0]) * k, a.from[1] + (a.to[1] - a.from[1]) * k];
}

/** 走位路径朝向：waypoints 有 facing 用它插值，否则沿路径方向 */
export function actorFacingAt(a: Actor, timeSec: number): number {
  const wps = (a.waypoints ?? []).slice().sort((p, q) => p.t - q.t);
  if (wps.length >= 2) {
    const t = Math.max(wps[0].t, Math.min(timeSec, wps[wps.length - 1].t));
    for (let i = 1; i < wps.length; i++) {
      if (t <= wps[i].t) {
        const p0 = wps[i - 1], p1 = wps[i];
        const f0 = p0.facing ?? Math.atan2(p1.x - p0.x, p1.z - p0.z);
        const f1 = p1.facing ?? f0;
        const span = Math.max(0.001, p1.t - p0.t);
        const k = (t - p0.t) / span;
        // 最短弧插值
        let df = f1 - f0;
        while (df > Math.PI) df -= Math.PI * 2;
        while (df < -Math.PI) df += Math.PI * 2;
        return f0 + df * k;
      }
    }
    const last = wps[wps.length - 1];
    if (last.facing !== undefined) return last.facing;
  }
  return actorFacingOf(a);
}

/** 走位路径高度：waypoints 的 y 插值（缺省 0，即地面） */
export function actorElevationAt(a: Actor, timeSec: number): number {
  const wps = (a.waypoints ?? []).slice().sort((p, q) => p.t - q.t);
  if (wps.length < 2) return wps.length === 1 ? (wps[0].y ?? 0) : 0;
  const t = Math.max(wps[0].t, Math.min(timeSec, wps[wps.length - 1].t));
  for (let i = 1; i < wps.length; i++) {
    if (t <= wps[i].t) {
      const p0 = wps[i - 1], p1 = wps[i];
      const span = Math.max(0.001, p1.t - p0.t);
      const k = (t - p0.t) / span;
      return (p0.y ?? 0) + ((p1.y ?? 0) - (p0.y ?? 0)) * k;
    }
  }
  return wps[wps.length - 1].y ?? 0;
}

/** 镜内某时刻正在播的时间轴段（无则 null） */
export function segmentAt(a: Actor, timeSec: number): ActionSegment | null {
  const segs = (a.timeline ?? []).slice().sort((p, q) => p.start - q.start);
  for (const s of segs) {
    if (timeSec >= s.start && timeSec < s.start + s.duration) return s;
  }
  return null;
}

/** 演员状态（位置/高度/朝向/姿态/当前动作）——ActorsLayer 与机位跟拍共用 */
export interface ActorState {
  x: number;
  z: number;
  /** 离地高度（米）——走位 y / 跳跃弧线 / 飞行高度；pose.y 是额外姿态偏移 */
  elev: number;
  facing: number;
  pose: Pose;
  action: ActionId;
}

/** 移动类动作（位置/高度随段插值；其余为姿态段，位置保持） */
export function isMoveAction(action: ActionId): boolean {
  return ["walk", "run", "jump", "climb", "leap", "flySword", "flyBroom", "wireFly", "rappel", "swim"].includes(action);
}

/**
 * 位置计算：时间轴优先于走位路径。
 * 走 timeline 的段：移动段从段起点位置插值到 targetPos，高度从段起点高度
 * 插值到 targetY（缺省为走位路径在该时刻的高度），再叠加弧线凸起
 * （peak * 4k(1-k)：跳跃/飞行先升后落）；姿态段保持位置与高度。
 * 无 timeline 时走 waypoints（或 from→to）。转身段插值朝向。
 * 打斗编舞由调用方先行处理（见 fightChoreo.evaluateFightState）。
 */
export function actorStateAt(a: Actor, timeSec: number, shotDuration: number): ActorState {
  const segs = (a.timeline ?? []).slice().sort((p, q) => p.start - q.start);
  // 基准位置/高度/朝向：走位路径在该时刻的值
  let x: number, z: number, facing: number, elev: number;
  [x, z] = actorPositionAt(a, timeSec, shotDuration);
  elev = actorElevationAt(a, timeSec);
  facing = actorFacingAt(a, timeSec);
  let action: ActionId = resolveAction(a.action);
  let pose = poseFor(action, timeSec, Math.max(0.2, shotDuration));

  if (!segs.length) return { x, z, elev, facing, pose, action };

  // 沿时间轴走到 timeSec：累计移动段的终点（位置 + 高度）
  let px = actorPositionAt(a, 0, shotDuration)[0];
  let pz = actorPositionAt(a, 0, shotDuration)[1];
  let pe = actorElevationAt(a, 0);
  let pf = actorFacingAt(a, 0);
  for (const s of segs) {
    if (timeSec < s.start) break;
    const segEnd = s.start + s.duration;
    if (isMoveAction(s.action)) {
      const target = s.targetPos ?? actorPositionAt(a, segEnd, shotDuration);
      const targetY = s.targetY ?? actorElevationAt(a, segEnd);
      const peak = s.arc?.peak ?? 0;
      if (timeSec < segEnd) {
        const k = clamp01((timeSec - s.start) / Math.max(0.001, s.duration));
        x = px + (target[0] - px) * k;
        z = pz + (target[1] - pz) * k;
        elev = pe + (targetY - pe) * k + peak * 4 * k * (1 - k);
        facing = s.facing ?? Math.atan2(target[0] - px, target[1] - pz);
        action = s.action;
        pose = poseFor(s.action, timeSec - s.start, s.duration);
        return { x, z, elev, facing, pose, action };
      }
      const dx = target[0] - px, dz = target[1] - pz;
      if (s.facing !== undefined) pf = s.facing;
      else if (dx !== 0 || dz !== 0) pf = Math.atan2(dx, dz);
      px = target[0]; pz = target[1]; pe = targetY;
      // 段结束：位置/高度停在终点，继续走后续段
      x = px; z = pz; elev = pe; facing = pf;
      action = s.action;
      pose = poseFor(s.action, s.duration, s.duration);
      continue;
    }
    if (timeSec < segEnd) {
      // 姿态/手势/打斗段：位置保持在段起点（高度可用 targetY 指定，如"站桌上"）
      x = px; z = pz;
      elev = s.targetY ?? pe;
      if (s.action === "turn" && s.facing !== undefined) {
        const k = smooth((timeSec - s.start) / Math.max(0.001, s.duration));
        let df = s.facing - pf;
        while (df > Math.PI) df -= Math.PI * 2;
        while (df < -Math.PI) df += Math.PI * 2;
        facing = pf + df * k;
        pf = facing;
      } else {
        facing = s.facing ?? pf;
        pf = facing;
      }
      action = s.action;
      pose = poseFor(s.action, timeSec - s.start, s.duration);
      return { x, z, elev, facing, pose, action };
    }
    // 段已结束：转身段更新朝向，姿态段若指定 targetY 则高度保持
    if (s.action === "turn" && s.facing !== undefined) { pf = s.facing; facing = pf; }
    else if (s.facing !== undefined) { pf = s.facing; facing = pf; }
    if (s.targetY !== undefined) { pe = s.targetY; elev = pe; }
    action = s.action;
    pose = poseFor(s.action, s.duration, s.duration);
  }
  return { x, z, elev, facing, pose, action };
}
