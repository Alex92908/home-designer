/**
 * soundEffects —— 导演台音效（云横店 M4-C：声音/音乐）。
 *
 * 全部音效用 WebAudio 合成（振荡器 + 噪声），不捆绑任何音频文件，
 * 不新增依赖。拍摄模拟播放时按时间窗触发（collectDueSounds），
 * 音效开关（store.soundOn）关掉时只走时间、不发声。
 *
 * 安全规则（模拟绝不能因为声音崩掉）：
 *   · 没有 window / 没有 AudioContext（如 node、旧浏览器）→ 全部调用
 *     静默返回 false，模拟照常播；
 *   · AudioContext 创建/恢复失败 → 记一次 audioUnavailable，后续直接
 *     返回，不再反复 try；
 *   · 每次合成包在 try/catch 里，单个音效失败不影响下一个；
 *   · 音量封顶 0.6、时长 ≤ 0.4s，短促不吵人。
 *
 * 纯函数部分（collectDueSounds / effectForAction / effectForBeat）不碰
 * DOM，可在 node 里直接测；真正发声的 playSoundEffect 只在浏览器里
 * 走通 AudioContext。
 */
import {
  actorStateAt, actionDef,
  type ActionId,
} from "./actions";
import type { Actor } from "./cinematic";
import { fightBeatAt, type BeatMove, type Fight } from "./fightChoreo";

export type SoundEffectId =
  | "punch"      // 出拳
  | "kick"       // 踢
  | "footstep"   // 脚步
  | "swordWhoosh"// 剑风声
  | "doorClose"  // 关门
  | "block"      // 格挡
  | "fall"       // 倒地
  | "dodge"      // 闪避（气流声）
  | "jump";      // 跳/轻功起跳

export interface SoundEffectDef {
  id: SoundEffectId;
  nameZh: string;
  nameEn: string;
  /** 合成方法（一句话，供 docs/sound-library.md 对照） */
  methodZh: string;
  methodEn: string;
}

export const SOUND_EFFECTS: SoundEffectDef[] = [
  { id: "punch", nameZh: "出拳", nameEn: "Punch", methodZh: "正弦 160→55Hz 闷响 + 300Hz 带通噪声 burst，0.12s", methodEn: "Sine thump 160→55 Hz + 300 Hz band-passed noise burst, 0.12s" },
  { id: "kick", nameZh: "踢", nameEn: "Kick", methodZh: "正弦 110→38Hz 低沉闷响 + 200Hz 低通噪声，0.18s", methodEn: "Low sine thump 110→38 Hz + 200 Hz low-passed noise, 0.18s" },
  { id: "footstep", nameZh: "脚步", nameEn: "Footstep", methodZh: "400Hz 低通噪声轻点 + 70Hz 低音，0.06s，音量小", methodEn: "Soft 400 Hz low-passed noise tap + 70 Hz low sine, 0.06s, quiet" },
  { id: "swordWhoosh", nameZh: "剑风声", nameEn: "Sword whoosh", methodZh: "噪声带通 500→2600Hz 上扫，0.3s", methodEn: "Noise band-pass sweep 500→2600 Hz, 0.3s" },
  { id: "doorClose", nameZh: "关门", nameEn: "Door close", methodZh: "正弦 95→48Hz 关门闷响 + 短促咔哒，0.2s", methodEn: "Sine thud 95→48 Hz + short click, 0.2s" },
  { id: "block", nameZh: "格挡", nameEn: "Block", methodZh: "方波 220Hz + 三角波 620Hz 金属碰击，0.08s", methodEn: "Square 220 Hz + triangle 620 Hz metallic clack, 0.08s" },
  { id: "fall", nameZh: "倒地", nameEn: "Fall", methodZh: "正弦 140→50Hz 下滑 + 300Hz 低通噪声闷响，0.35s", methodEn: "Sine slide 140→50 Hz + 300 Hz low-passed noise thud, 0.35s" },
  { id: "dodge", nameZh: "闪避", nameEn: "Dodge", methodZh: "噪声带通 900→300Hz 下扫气流声，0.22s", methodEn: "Noise band-pass sweep 900→300 Hz airy whoosh, 0.22s" },
  { id: "jump", nameZh: "跳", nameEn: "Jump", methodZh: "正弦 300→520Hz 轻上扬，0.18s，音量小", methodEn: "Soft sine rise 300→520 Hz, 0.18s, quiet" },
];

const SOUND_BY_ID: Record<string, SoundEffectDef> = Object.fromEntries(
  SOUND_EFFECTS.map((s) => [s.id, s]),
);

export function isSoundEffectId(id: string): id is SoundEffectId {
  return id in SOUND_BY_ID;
}

/** 动作 → 音效（无合适音效的动作返回 null = 静默，不硬配）。 */
export function effectForAction(action: string | undefined): SoundEffectId | null {
  switch (action) {
    case "punch": return "punch";
    case "kick": return "kick";
    case "fight": return "punch"; // 打斗循环段按出拳声打底，beat 级另有精确触发
    case "block": return "block";
    case "dodge": return "dodge";
    case "fall": return "fall";
    case "walk": return "footstep";
    case "run": return "footstep";
    case "flySword": return "swordWhoosh";
    case "flyBroom": return "dodge"; // 扫帚飞行是气流声，不是剑风
    case "wireFly": return "dodge"; // 威亚飞行同上
    case "jump": return "jump";
    case "leap": return "jump"; // 轻功起跳
    default: return null; // idle/stand/sit/standUp/turn/wave/point/bow/crouch/getUp/climb/cling/ride/hide/prone/rappel/swim：无音效
  }
}

/** 打斗 beat → 音效（getUp 无音效 = 静默）。 */
export function effectForBeat(move: BeatMove | string): SoundEffectId | null {
  switch (move) {
    case "punch": return "punch";
    case "kick": return "kick";
    case "block": return "block";
    case "dodge": return "dodge";
    case "fall": return "fall";
    default: return null;
  }
}

// ── WebAudio 合成（浏览器 only；node 里全部静默 false）──

let sharedCtx: AudioContext | null = null;
let audioUnavailable = false;
let noiseBuf: AudioBuffer | null = null;

function getAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * 取（或建）共享 AudioContext 并 resume。用户手势里调（开始模拟/点试听）
 * 才能 resume 成功；非手势调用时 resume 会被浏览器挂起，返回 ctx 仍可用、
 * 声音等下次手势后才出——绝不抛错。
 * 无 AudioContext 时返回 null（调用方静默）。
 */
export function ensureAudioContext(): AudioContext | null {
  if (audioUnavailable) return null;
  if (sharedCtx) {
    if (sharedCtx.state === "suspended") {
      // resume 是异步的，也可能被浏览器拒绝；失败也不抛，声音只是暂不出
      sharedCtx.resume().catch(() => { /* 静默：模拟照常播 */ });
    }
    return sharedCtx;
  }
  const Ctor = getAudioContextCtor();
  if (!Ctor) { audioUnavailable = true; return null; }
  try {
    sharedCtx = new Ctor();
    if (sharedCtx.state === "suspended") {
      sharedCtx.resume().catch(() => { /* 静默 */ });
    }
    return sharedCtx;
  } catch {
    audioUnavailable = true;
    return null;
  }
}

export function isAudioAvailable(): boolean {
  return getAudioContextCtor() !== null;
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuf = buf;
  return buf;
}

function noise(
  ctx: AudioContext, t0: number, dur: number, peak: number,
  filterType: BiquadFilterType, freq0: number, freq1?: number, q = 1,
): void {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  src.loop = true;
  const flt = ctx.createBiquadFilter();
  flt.type = filterType;
  flt.frequency.setValueAtTime(Math.max(20, freq0), t0);
  if (freq1 !== undefined) flt.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), t0 + dur);
  flt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(flt).connect(g).connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function tone(
  ctx: AudioContext, t0: number, dur: number, peak: number,
  type: OscillatorType, freq0: number, freq1?: number,
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq0), t0);
  if (freq1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function synthEffect(ctx: AudioContext, id: SoundEffectId, t0: number, volume: number): void {
  const v = Math.max(0, Math.min(1, volume));
  switch (id) {
    case "punch":
      tone(ctx, t0, 0.11, 0.5 * v, "sine", 160, 55);
      noise(ctx, t0, 0.08, 0.25 * v, "bandpass", 300, undefined, 1);
      break;
    case "kick":
      tone(ctx, t0, 0.16, 0.6 * v, "sine", 110, 38);
      noise(ctx, t0, 0.12, 0.3 * v, "lowpass", 200);
      break;
    case "footstep":
      noise(ctx, t0, 0.06, 0.18 * v, "lowpass", 400);
      tone(ctx, t0, 0.05, 0.12 * v, "sine", 70, 55);
      break;
    case "swordWhoosh":
      noise(ctx, t0, 0.3, 0.22 * v, "bandpass", 500, 2600, 1.5);
      break;
    case "doorClose":
      tone(ctx, t0, 0.16, 0.5 * v, "sine", 95, 48);
      noise(ctx, t0 + 0.1, 0.03, 0.15 * v, "highpass", 1500);
      break;
    case "block":
      tone(ctx, t0, 0.06, 0.15 * v, "square", 220);
      tone(ctx, t0, 0.08, 0.12 * v, "triangle", 620, 480);
      noise(ctx, t0, 0.05, 0.12 * v, "bandpass", 1800, undefined, 2);
      break;
    case "fall":
      tone(ctx, t0, 0.35, 0.4 * v, "sine", 140, 50);
      noise(ctx, t0 + 0.05, 0.3, 0.25 * v, "lowpass", 300);
      break;
    case "dodge":
      noise(ctx, t0, 0.22, 0.18 * v, "bandpass", 900, 300, 1.2);
      break;
    case "jump":
      tone(ctx, t0, 0.18, 0.15 * v, "sine", 300, 520);
      break;
    default:
      break; // 未知 id 在 playSoundEffect 已拦下，这里是最后一道防线
  }
}

/**
 * 播一个音效。返回 true = 已排进 AudioContext；false = 没播
 * （开关关了 / 无 AudioContext / 未知 id / 合成抛错）。
 * 绝不抛错——模拟循环里调它必须安全。
 */
export function playSoundEffect(
  id: string,
  opts?: { enabled?: boolean; volume?: number },
): boolean {
  if (opts?.enabled === false) return false;
  if (!isSoundEffectId(id)) return false;
  const ctx = ensureAudioContext();
  if (!ctx) return false;
  try {
    synthEffect(ctx, id, ctx.currentTime, opts?.volume ?? 1);
    return true;
  } catch {
    return false;
  }
}

// ── 拍摄模拟：时间窗 → 该响的音效（纯函数，可在 node 里测）──

export interface SimSoundCursor {
  shotId: string | null;
  lastT: number;
  /** 已触发过的时间轴段 id（一段只响一次） */
  firedSegs: Set<string>;
  /** 已触发过的打斗 beat id（一拍只响一次） */
  firedBeats: Set<string>;
  /** 已触发过的默认动作（每镜开头一次） */
  firedDefaults: Set<string>;
  /** 每演员下次脚步声时间（走/跑按步频） */
  nextStepAt: Map<string, number>;
}

export function createSimSoundCursor(): SimSoundCursor {
  return { shotId: null, lastT: 0, firedSegs: new Set(), firedBeats: new Set(), firedDefaults: new Set(), nextStepAt: new Map() };
}

function resetCursor(c: SimSoundCursor, shotId: string, t: number): void {
  c.shotId = shotId;
  c.lastT = t;
  c.firedSegs.clear();
  c.firedBeats.clear();
  c.firedDefaults.clear();
  c.nextStepAt.clear();
}

/** 走/跑的步频（秒/步）：与 actions.ts poseFor 的步频对齐（走 0.55s/步，跑 0.4s/步）。 */
const STEP_CADENCE: Record<string, number> = { walk: 0.55, run: 0.4 };

/**
 * 给定上一帧到这一帧的时间窗 (prevT, curT]，算出该响的音效 id 列表。
 * 触发源（按时间点）：
 *   · 时间轴段开始：段 action 对应的音效（如 punch/kick/flySword），一段一次；
 *   · 打斗 beat 开始：beat move 对应的音效，一拍一次（用 fightBeatAt 的 beatStart）；
 *   · 演员默认动作是单次动作（如 punch）时在镜开头响一次；
 *   · 走/跑：按步频持续出脚步声（最多 2 个演员，避免一堆脚步叠成噪声）。
 * 窗口 > 0.5s 视为 seek/scrub（跳播）：静默重置，不补响一串。
 * 时间倒流（scrub 回拨）或换镜瞬间（curT 回 0）：同样由帧窗口检查
 * 拦下，静默重置；回拨后重新播到该段时该段会再响一次（fired 记录
 * 随重置清掉）。同镜内 scrub 前跳由调用方处理（CinematicDirector
 * 的 scrubTo 直接清游标）。
 * 例外：新镜第一帧（prevT ≈ 0）不算 seek——镜开头的默认动作
 * 和 t=0 开始的 beat 必须能响，否则每镜第一拍永远哑火。
 * 从不抛错：脏数据（未知动作/缺字段）一律按静默处理。
 */
export function collectDueSounds(args: {
  shotId: string;
  shotDuration: number;
  actors: Actor[];
  fights: Fight[];
  /** 本镜框住的演员（脚步声优先给他） */
  targetActorId?: string;
  prevT: number;
  curT: number;
  cursor: SimSoundCursor;
}): SoundEffectId[] {
  const { shotId, shotDuration, actors, fights, targetActorId, prevT, curT, cursor } = args;
  const out: SoundEffectId[] = [];
  try {
    // 大跳或倒流的帧窗口 = seek：重置，不响
    if (curT < prevT - 1e-9 || curT - prevT > 0.5) {
      resetCursor(cursor, shotId, curT);
      return out;
    }
    if (cursor.shotId !== shotId) {
      // 换镜/开场：初始化游标后继续算这扇窗。真正的 discontinuity
      // （换镜瞬间 curT 回 0、scrub 跳播的大窗口）已由上面的帧窗口
      // 检查拦下；这里只剩「游标是新的，但时间是连续的」的情况。
      resetCursor(cursor, shotId, prevT);
    }
    // 同镜内 scrub（回拨/前跳）不在这里判断：scrub 是显式的 store
    // 动作，调用方（CinematicDirector 的 scrubTo）在跳播时直接调
    // resetSimSfxCursor() 清游标；这里只看帧窗口本身。
    const push = (e: SoundEffectId | null) => { if (e) out.push(e); };

    // 1. 打斗 beat 开始（本镜的编舞：与 ActorsLayer 同规则，只取 shotId 匹配的那场）
    const fight = fights.find((f) => f.shotId === shotId);
    if (fight) {
      const cur = fightBeatAt(fight, curT);
      if (cur && cur.beatStart > prevT - 1e-9 && cur.beatStart <= curT + 1e-9 && !cursor.firedBeats.has(cur.beat.id)) {
        cursor.firedBeats.add(cur.beat.id);
        push(effectForBeat(cur.beat.move));
      }
    }

    // 2. 时间轴段开始 + 3. 默认动作（镜开头一次）+ 4. 脚步声
    // 脚步声最多 2 人：框住的演员优先，其余按列表顺序
    const ordered = [...actors].sort((a, b) => {
      if (a.id === targetActorId) return -1;
      if (b.id === targetActorId) return 1;
      return 0;
    });
    let stepActors = 0;
    for (const actor of ordered) {
      const timeline = actor.timeline ?? [];
      for (const seg of timeline) {
        if (seg.start > prevT - 1e-9 && seg.start <= curT + 1e-9 && !cursor.firedSegs.has(seg.id)) {
          cursor.firedSegs.add(seg.id);
          push(effectForAction(seg.action));
        }
      }
      // 默认动作：无时间轴的演员，单次动作在镜开头响一次
      if (prevT <= 0.001 && curT > 0 && timeline.length === 0) {
        const key = `${shotId}:${actor.id}`;
        if (!cursor.firedDefaults.has(key)) {
          cursor.firedDefaults.add(key);
          const def = actionDef(actor.action ?? "walk");
          if (!def.loop) push(effectForAction(actor.action));
        }
      }
      // 脚步声：当前动作是走/跑时按步频响
      let action: ActionId = "walk";
      try {
        action = actorStateAt(actor, curT, shotDuration).action;
      } catch {
        action = "walk";
      }
      const cadence = STEP_CADENCE[action];
      if (cadence && stepActors < 2) {
        stepActors++;
        const next = cursor.nextStepAt.get(actor.id);
        if (next === undefined || curT >= next) {
          cursor.nextStepAt.set(actor.id, curT + cadence);
          // 镜开头第一帧不补响（避免开始模拟瞬间一串脚步）：只在已有 next 时响
          if (next !== undefined) push("footstep");
        }
      } else {
        cursor.nextStepAt.delete(actor.id);
      }
    }

    cursor.lastT = curT;
    return out;
  } catch {
    // 任何脏数据都不该炸掉模拟循环
    return out;
  }
}
