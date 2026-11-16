/**
 * fightChoreo —— 打斗编舞（导演台动作系统）。
 *
 * 数据模型（按真实武打设计）：
 *   打斗 = 乐句列表；乐句 = 3–8 个 beat；beat = 一次攻/防/中招+反应；
 *   乐句之间 RESET（回位），不是一直缠斗。
 *   beat = {attacker, defender, move, duration, reaction, camera}
 *   安全是数据字段（道具/排练/备注），不是口头约定。
 *
 * 规则：
 *   · 无真实接触——出拳从脸前 15–30cm 擦过（冲量曲线最高 0.8，不贴脸）。
 *   · 骗镜头：beat 机位默认 "cheat"（攻方肩后、顺出拳轴线），绝不默认侧面。
 *   · 反应镜头比出拳重要：每个 beat 带 reaction（中招方的反应描述）。
 *   · 旧的单节 beat（approach/retreat + lunge）是 punch 的一种表现，
 *     不是整个系统——见 actions.ts 的 lungeCurve。
 */
import type { CameraSample } from "./cinematic";
import { lungeCurve, type Pose, type ActionId } from "./actions";

export type BeatMove = "punch" | "kick" | "block" | "dodge" | "fall" | "getUp";

/** beat 机位：cheat = 攻方肩后顺拳轴（默认）；wide = 本镜预设；closeup = 中招方特写 */
export type BeatCamera = "cheat" | "wide" | "closeup";

export const BEAT_MOVES: Array<{ id: BeatMove; nameZh: string; nameEn: string; defaultDuration: number }> = [
  { id: "punch", nameZh: "出拳", nameEn: "Punch", defaultDuration: 0.8 },
  { id: "kick", nameZh: "踢", nameEn: "Kick", defaultDuration: 0.9 },
  { id: "block", nameZh: "格挡", nameEn: "Block", defaultDuration: 0.8 },
  { id: "dodge", nameZh: "闪避", nameEn: "Dodge", defaultDuration: 0.7 },
  { id: "fall", nameZh: "倒地", nameEn: "Fall", defaultDuration: 1.2 },
  { id: "getUp", nameZh: "起身", nameEn: "Get up", defaultDuration: 1.5 },
];

export function beatMoveDef(move: BeatMove): { nameZh: string; nameEn: string; defaultDuration: number } {
  return BEAT_MOVES.find((m) => m.id === move) ?? BEAT_MOVES[0];
}

export interface FightBeat {
  id: string;
  move: BeatMove;
  attackerId: string;
  defenderId: string;
  /** 时长（秒） */
  duration: number;
  /** 中招方的反应（如"踉跄后退"、"捂脸"）——反应镜头比出拳重要 */
  reaction?: string;
  /** 机位，缺省 "cheat"（攻方肩后） */
  camera?: BeatCamera;
}

export interface FightPhrase {
  id: string;
  beats: FightBeat[];
  /** 乐句结束后的回位停顿（秒），缺省 1.0 */
  reset?: number;
}

export interface FightSafety {
  /** 道具（如"泡沫拳套/橡胶刀"） */
  props: string;
  /** 排练（如"半速排练 3 遍"） */
  rehearsal: string;
  /** 备注（如"替身/护具/现场医护"） */
  notes: string;
}

export interface Fight {
  id: string;
  name: string;
  /** 所属镜头（缺省 = 任何镜头都可播；指定后只在该镜播） */
  shotId?: string;
  attackerId: string;
  defenderId: string;
  phrases: FightPhrase[];
  safety: FightSafety;
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function makeBeat(
  move: BeatMove,
  attackerId: string,
  defenderId: string,
  opts?: { duration?: number; reaction?: string; camera?: BeatCamera },
): FightBeat {
  return {
    id: newId(),
    move,
    attackerId,
    defenderId,
    duration: opts?.duration ?? beatMoveDef(move).defaultDuration,
    ...(opts?.reaction ? { reaction: opts.reaction } : {}),
    ...(opts?.camera ? { camera: opts.camera } : {}),
  };
}

export function makePhrase(beats: FightBeat[], reset = 1.0): FightPhrase {
  return { id: newId(), beats, reset };
}

export function makeFight(attackerId: string, defenderId: string, opts?: { name?: string; shotId?: string }): Fight {
  return {
    id: newId(),
    name: opts?.name ?? "打斗",
    ...(opts?.shotId ? { shotId: opts.shotId } : {}),
    attackerId,
    defenderId,
    phrases: [],
    safety: { props: "泡沫道具", rehearsal: "半速排练", notes: "" },
  };
}

/** 打斗总时长（秒）：各 beat 时长 + 乐句间 reset（最后一句后无 reset） */
export function fightDuration(f: Fight): number {
  let total = 0;
  f.phrases.forEach((p, i) => {
    total += p.beats.reduce((s, b) => s + Math.max(0.2, b.duration), 0);
    if (i < f.phrases.length - 1) total += p.reset ?? 1.0;
  });
  return total;
}

export interface BeatAtTime {
  beat: FightBeat;
  phraseIndex: number;
  beatIndex: number;
  /** beat 内进度 0..1 */
  phase: number;
  /** 该 beat 在整场打斗中的开始时间（秒） */
  beatStart: number;
}

/** 镜内时间 → 当前 beat（乐句间 reset 时段返回 null，由调用方做回位）。
 *  边界用 1e-6 容差：0.8×3 这类累加会出 2.4000000000000004，精确边界
 *  （如 t=2.4）必须落在 reset 里、而不是上一拍的末尾。 */
export function fightBeatAt(f: Fight, timeSec: number): BeatAtTime | null {
  const EPS = 1e-6;
  let t = 0;
  for (let pi = 0; pi < f.phrases.length; pi++) {
    const p = f.phrases[pi];
    for (let bi = 0; bi < p.beats.length; bi++) {
      const b = p.beats[bi];
      const d = Math.max(0.2, b.duration);
      if (timeSec >= t - EPS && timeSec < t + d - EPS) {
        return { beat: b, phraseIndex: pi, beatIndex: bi, phase: Math.max(0, Math.min(1, (timeSec - t) / d)), beatStart: t };
      }
      t += d;
    }
    if (pi < f.phrases.length - 1) {
      const reset = p.reset ?? 1.0;
      if (timeSec >= t - EPS && timeSec < t + reset - EPS) return null; // 回位时段
      t += reset;
    }
  }
  return null;
}

/** 校验：乐句 beat 数 3–8（研究建议；少于 3 仍可播，只告警） */
export function validateFight(f: Fight): string[] {
  const warns: string[] = [];
  if (!f.phrases.length) warns.push("打斗没有乐句");
  f.phrases.forEach((p, i) => {
    if (!p.beats.length) warns.push(`第 ${i + 1} 乐句没有 beat`);
    if (p.beats.length > 8) warns.push(`第 ${i + 1} 乐句 ${p.beats.length} 个 beat（建议 3–8）`);
    if (p.beats.length > 0 && p.beats.length < 3) warns.push(`第 ${i + 1} 乐句只有 ${p.beats.length} 个 beat（建议 3–8）`);
  });
  if (!f.attackerId || !f.defenderId) warns.push("打斗缺攻方或守方");
  if (f.attackerId === f.defenderId) warns.push("攻方与守方是同一人");
  return warns;
}

/** beat 的移动量：攻方朝守方冲出的距离（米）+ 守方反应位移。
 *  出拳擦过不停留：冲量峰值 0.8，拳到脸前 15–30cm 即收——无接触。 */
function beatOffsets(move: BeatMove): { attackerLunge: number; defenderShift: number; defenderSide: number } {
  switch (move) {
    case "punch": return { attackerLunge: 0.55, defenderShift: 0.25, defenderSide: 0 };
    case "kick": return { attackerLunge: 0.6, defenderShift: 0.35, defenderSide: 0 };
    case "block": return { attackerLunge: 0.3, defenderShift: 0, defenderSide: 0 };
    case "dodge": return { attackerLunge: 0.45, defenderShift: 0.1, defenderSide: 0.7 };
    case "fall": return { attackerLunge: 0.2, defenderShift: 0.3, defenderSide: 0 };
    case "getUp": return { attackerLunge: 0, defenderShift: -0.2, defenderSide: 0 };
    default: return { attackerLunge: 0.3, defenderShift: 0, defenderSide: 0 };
  }
}

/** beat 对应的方块人姿态（攻方/守方分别算） */
export function beatPose(move: BeatMove, phase: number, isAttacker: boolean): Pose {
  if (isAttacker) {
    switch (move) {
      case "punch": {
        const k = lungeCurve(phase);
        return { y: 0, rotX: 0.1 * k, rotZ: 0, armL: [0.3 * k, 0.12], armR: [-1.5 * k, -0.1], lying: false };
      }
      case "kick": {
        const k = Math.sin(phase * Math.PI);
        return { y: 0.08 * k, rotX: -0.15 * k, rotZ: 0, armL: [-0.6 * k, 0.3], armR: [0.5 * k, -0.3], lying: false };
      }
      case "block":
        return { y: -0.08, rotX: 0, rotZ: 0, armL: [-1.2, 0.25], armR: [-1.2, -0.25], lying: false };
      case "dodge": {
        const k = Math.sin(phase * Math.PI);
        return { y: -0.15 * k, rotX: 0, rotZ: 0.2 * k, armL: [0, 0.12], armR: [0, -0.12], lying: false };
      }
      default:
        return { y: 0, rotX: 0, rotZ: 0, armL: [0, 0.12], armR: [0, -0.12], lying: false };
    }
  }
  // 守方
  switch (move) {
    case "punch":
    case "kick": {
      // 中招：后仰 + 捂脸（反应镜头卖点）
      const k = Math.sin(Math.min(1, phase * 1.4) * Math.PI);
      return { y: -0.05 * k, rotX: -0.25 * k, rotZ: 0, armL: [-0.9 * k, 0.3], armR: [-0.9 * k, -0.3], lying: false };
    }
    case "block":
      return { y: -0.08, rotX: 0, rotZ: 0, armL: [-1.2, 0.25], armR: [-1.2, -0.25], lying: false };
    case "dodge": {
      const k = Math.sin(phase * Math.PI);
      return { y: -0.12 * k, rotX: 0, rotZ: -0.15 * k, armL: [0, 0.12], armR: [0, -0.12], lying: false };
    }
    case "fall": {
      const e = phase < 0.6 ? (phase / 0.6) * (phase / 0.6) * (3 - 2 * (phase / 0.6)) : 1;
      return { y: -0.53 * e, rotX: -1.5 * e, rotZ: 0, armL: [0, 0.12], armR: [0, -0.12], lying: e > 0.5 };
    }
    case "getUp": {
      const e = phase < 0.6 ? (phase / 0.6) * (phase / 0.6) * (3 - 2 * (phase / 0.6)) : 1;
      return { y: -0.53 * (1 - e), rotX: -1.5 * (1 - e), rotZ: 0, armL: [0, 0.12], armR: [0, -0.12], lying: e < 0.5 };
    }
    default:
      return { y: 0, rotX: 0, rotZ: 0, armL: [0, 0.12], armR: [0, -0.12], lying: false };
  }
}

export interface FightActorState {
  x: number;
  z: number;
  /** 离地高度（米）——打斗在地面打，取开打时的基准高度 */
  elev: number;
  facing: number;
  pose: Pose;
  /** 当前 beat 的动作 id（供 UI 显示） */
  action: ActionId;
}

/**
 * 打斗中某一方的状态。basePos 为该方在打斗开始时的基准位置
 * （调用方用 actorStateAt 在 fight 开始时刻算出，不含打斗本身），
 * 格式 [x, z, elev]。
 * beat 内：攻方按冲量曲线冲向守方再收；守方按反应位移。
 * reset 时段：双方线性回位到基准位置。
 */
export function evaluateFightState(
  f: Fight,
  timeSec: number,
  attackerBase: [number, number, number],
  defenderBase: [number, number, number],
): { attacker: FightActorState; defender: FightActorState; active: boolean } {
  const atkFace = Math.atan2(defenderBase[0] - attackerBase[0], defenderBase[1] - attackerBase[1]);
  const defFace = Math.atan2(attackerBase[0] - defenderBase[0], attackerBase[1] - defenderBase[1]);
  const total = fightDuration(f);
  if (timeSec < 0 || timeSec >= total || !f.phrases.length) {
    const idle: Pose = { y: 0, rotX: 0, rotZ: 0, armL: [0, 0.12], armR: [0, -0.12], lying: false };
    return {
      attacker: { x: attackerBase[0], z: attackerBase[1], elev: attackerBase[2], facing: atkFace, pose: idle, action: "fight" },
      defender: { x: defenderBase[0], z: defenderBase[1], elev: defenderBase[2], facing: defFace, pose: idle, action: "fight" },
      active: false,
    };
  }
  const cur = fightBeatAt(f, timeSec);
  if (!cur) {
    // reset 时段：回位（线性插回基准位置，姿态待机）
    const idle: Pose = { y: 0, rotX: 0, rotZ: 0, armL: [0, 0.12], armR: [0, -0.12], lying: false };
    return {
      attacker: { x: attackerBase[0], z: attackerBase[1], elev: attackerBase[2], facing: atkFace, pose: idle, action: "fight" },
      defender: { x: defenderBase[0], z: defenderBase[1], elev: defenderBase[2], facing: defFace, pose: idle, action: "fight" },
      active: true,
    };
  }
  const { beat, phase } = cur;
  const off = beatOffsets(beat.move);
  // 攻方位置：基准 → 朝守方冲出 lunge*曲线 → 收
  const dirX = defenderBase[0] - attackerBase[0];
  const dirZ = defenderBase[1] - attackerBase[1];
  const dist = Math.max(0.001, Math.hypot(dirX, dirZ));
  const ux = dirX / dist, uz = dirZ / dist;
  const lunge = beat.move === "punch" ? lungeCurve(phase) : Math.sin(phase * Math.PI);
  const ax = attackerBase[0] + ux * off.attackerLunge * lunge;
  const az = attackerBase[1] + uz * off.attackerLunge * lunge;
  // 守方位置：后退 + 侧闪
  const sideX = -uz, sideZ = ux;
  const dx = defenderBase[0] + ux * off.defenderShift * Math.sin(phase * Math.PI) + sideX * off.defenderSide * Math.sin(phase * Math.PI);
  const dz = defenderBase[1] + uz * off.defenderShift * Math.sin(phase * Math.PI) + sideZ * off.defenderSide * Math.sin(phase * Math.PI);
  return {
    attacker: { x: ax, z: az, elev: attackerBase[2], facing: atkFace, pose: beatPose(beat.move, phase, true), action: beat.move },
    defender: { x: dx, z: dz, elev: defenderBase[2], facing: defFace, pose: beatPose(beat.move, phase, false), action: beat.move },
    active: true,
  };
}

/**
 * beat 机位：cheat = 攻方肩后、顺出拳轴线（默认，绝不侧面）；
 * closeup = 中招方特写（1.3m）。wide 由调用方用本镜预设。
 */
export function fightCameraSample(
  mode: BeatCamera,
  attackerPos: [number, number],
  defenderPos: [number, number],
): CameraSample | null {
  if (mode === "wide") return null;
  const dx = defenderPos[0] - attackerPos[0];
  const dz = defenderPos[1] - attackerPos[1];
  const dist = Math.max(0.001, Math.hypot(dx, dz));
  const ux = dx / dist, uz = dz / dist;
  if (mode === "cheat") {
    // 攻方身后 1.2m、高 1.6m，越肩看向守方胸口（骗镜头的标准站位）
    return {
      pos: [attackerPos[0] - ux * 1.2, 1.6, attackerPos[1] - uz * 1.2],
      lookAt: [defenderPos[0], 1.4, defenderPos[1]],
      fov: 45,
    };
  }
  // closeup：守方脸前 1.3m
  return {
    pos: [defenderPos[0] - ux * 1.3, 1.55, defenderPos[1] - uz * 1.3],
    lookAt: [defenderPos[0], 1.5, defenderPos[1]],
    fov: 40,
  };
}

/** beat 的动作 id → actions.ts 注册表动作（poseFor 用） */
export function beatMoveToAction(move: BeatMove): ActionId {
  return move;
}
