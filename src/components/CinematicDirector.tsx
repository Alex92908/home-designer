"use client";

/**
 * CinematicDirector —— 分镜工作台 + 多风格录制 + 演员走位（云横店 M1-M3）
 * ＋ 导演台 MVP：一键搭片场、室内机位、具名角色走位、轴线、打斗单节 beat、
 * 9:16 取景框、带角色信息的控制包导出。
 * ＋ 灯光预设（lighting.ts：10 套灯光，每镜一个 lightingId + 场景默认，
 * 拍摄模拟/录制按镜切换，HouseCanvas 把生效预设写进 Three.js 灯光）。
 * ＋ 声音/音乐（soundLibrary.ts：10 种情绪配乐库，每镜推荐一首，下
 *  载来源 + 许可证逐条写明，不捆绑音频；soundEffects.ts：WebAudio 合
 *  成音效，出拳/踢/脚步/剑风/关门等，拍摄模拟按时间窗触发 + 音效开关）。
 * ＋ 剧本（script.ts：写剧本/粘贴导入 .txt → 规则拆解场次/台词/动作
 *  → 片场匹配 → 「从剧本生成分镜」按剧本顺序建镜，台词与动作随镜走；
 *  认不出的行保留原文并明说，不乱指派）。
 *  控制包 storyboard.json v4（music 字段为附加字段，版本不变）。
 *
 * 产品原子是 Shot（镜头）：机位预设 + 时长 + 提示词。用户排一组镜头（分镜），
 * 勾选导出风格（实景/白模/深度），一键批量拍摄——队列按「镜头 × 风格」展开，
 * 每次产出 参考视频 + 首/尾帧 PNG，末尾附 storyboard.json，整套即「控制包」：
 *   · 实景：本身就是最强参考视频（喂即梦/Kling 图生视频、首尾帧）
 *   · 白模：overrideMaterial 灰盒——Seedance 2.5 白模 previz 官方输入规格
 *   · 深度：近白远黑线性深度——Wan VACE / ControlNet 结构控制输入
 *
 * 演员走位（M3）：方块人级别的占位演员，在地面点两下设起点→终点，录制时
 * 随播放头行走——白模/深度 pass 同样入镜（这正是走位进 previz 的意义）。
 * 分工红线：我们锁 blocking（空间/构图/机位/走位时机），表演细节归下游 AI。
 *
 * 结构（跨 Canvas 内外，本文件内的 zustand store 通信）：
 *   <CinematicPanel/>       DOM：🎬 按钮 + 快拍 + 分镜 + 风格 + 演员 + 进度
 *   <CameraPathPlayer env/> Canvas 内：队列驱动相机 + 风格覆盖 + 录制下载
 *   <ActorsLayer/>          Canvas 内：演员放置（地面点选）+ 渲染 + 行走
 *
 * 录制期间接管相机（禁用 OrbitControls），整队拍完/取消后还原用户视角。
 * frameloop="demand" 下靠每帧 invalidate() 驱动渲染。
 * 分镜/演员 persist 到 localStorage。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import {
  CINE_PRESETS, RENDER_STYLES, getCinePreset, makeShot, makeActor,
  actorDisplayName, actorFacing, actorAction, actorTargetAt, groupTargetAt, shotCrossesAxis,
  losCandidates, tooCloseCandidates, clampIndoorCamera,
  type Shot, type Actor, type ActorAction, type RenderStyle, type SceneEnvelope, type RoomRect,
  type CameraSample,
} from "@/lib/cinematic";
import {
  DIRECTOR_STYLES, DIRECTOR_STYLE_GENRES, getDirectorStyle, directorStyleDefaults,
} from "@/lib/directorStyles";
import {
  ACTION_REGISTRY, ACTION_LIST, actionDef, actorStateAt, actorPositionAt, makeSegment, makeWaypoint,
  poseFor, segmentAt, type ActionDef, type ActionId, type ActionSegment, type Waypoint,
} from "@/lib/actions";
import {
  makeFight, makeBeat, makePhrase, validateFight, fightDuration,
  fightBeatAt, evaluateFightState, fightCameraSample,
  type Fight, type FightBeat,
} from "@/lib/fightChoreo";
import {
  buildSceneContext, parseActionText, SUPPORTED_PATTERNS,
  type ParsedInstruction, type SceneContext,
} from "@/lib/actionParser";
import {
  STUNT_PROP_LIST, STUNT_ACTION_PROPS, makeStuntProp, stuntPropDef,
  type StuntProp, type StuntPropKind,
} from "@/lib/stuntProps";
import {
  ARCHETYPES, costumesForArchetype, defaultCostumeForArchetype, eraWarningFor,
  resolveActorCostume, resolveActorArchetype, resolveCostume, suggestCostumeForNewActor,
  type CostumeDef,
} from "@/lib/characters";
import {
  LIGHTING_PRESETS, resolveLightingPreset, resolveShotLightingId,
  type LightingId,
} from "@/lib/lighting";
import {
  MUSIC_MOODS, suggestMusicForShot,
  type MusicMood,
} from "@/lib/soundLibrary";
import {
  SOUND_EFFECTS, collectDueSounds, createSimSoundCursor, ensureAudioContext,
  playSoundEffect, type SimSoundCursor, type SoundEffectId,
} from "@/lib/soundEffects";
import { StuntPropMesh, FlyingVehicleMesh, WireMesh } from "@/components/StuntProps";
import { SCENE_SETS, getSceneSet } from "@/lib/sceneSets";
import {
  SCRIPT_FORMAT_HINT, UNASSIGNED_MESSAGE,
  parseScript, enrichScriptActions, planShotsFromScript,
  type ParsedScript,
} from "@/lib/script";
import { matchProjectTemplate } from "@/lib/matchProjectTemplate";
import { useDesignerStore } from "@/lib/store";
import { runRender } from "@/lib/useAiRender";
import { getAiRenderConfig, localizeWorkflowName, type RenderWorkflow } from "@/lib/aiRenderConfig";

/** 播放头（模块级可变对象，ActorsLayer 在 useFrame 里直读，避免每帧 setState）。
 *  timeSec 为本镜内的秒数；shotId 供 ActorsLayer 找本镜的打斗编舞。 */
export const cinePlayhead = { t: 0, timeSec: 0, shotDuration: 8, shotId: null as string | null, active: false };

/** 拍摄模拟时钟（模块级，SimPlayer 写、ActorsLayer 读；UI 用的节流状态在 store） */
export const simClock = { timeSec: 0, shotIdx: 0, shotDuration: 8, shotId: null as string | null, active: false, playing: false };

/** 拍摄模拟音效游标（模块级，SimPlayer 每帧推进；换镜/scrub 时重置，
 *  见 soundEffects.ts 的 collectDueSounds）。 */
const simSfxCursor: SimSoundCursor = createSimSoundCursor();

/** 清音效游标（开始/停止模拟、scrub 跳播时调：回拨后重新播到该段时
 *  该段会再响一次）。 */
export function resetSimSfxCursor(): void {
  simSfxCursor.shotId = null;
  simSfxCursor.lastT = 0;
  simSfxCursor.firedSegs.clear();
  simSfxCursor.firedBeats.clear();
  simSfxCursor.firedDefaults.clear();
  simSfxCursor.nextStepAt.clear();
}

/** 一镜的配乐推断输入：显式 mood + 生效灯光 + 有无打斗 + 演员动作。
 *  与 storyboard.json 导出共用同一推断（面板显示与控制包一致）。 */
export function shotMusicInput(
  shot: Shot,
  sceneLightingId: LightingId,
  fights: Fight[],
  actors: Actor[],
): { musicMood?: MusicMood; lightingId: LightingId; hasFight: boolean; actions: string[] } {
  const actions: string[] = [];
  for (const a of actors) {
    if (a.action) actions.push(a.action);
    for (const s of a.timeline ?? []) actions.push(s.action);
  }
  return {
    ...(shot.musicMood ? { musicMood: shot.musicMood } : {}),
    lightingId: resolveShotLightingId(shot.lightingId, sceneLightingId),
    hasFight: fights.some((f) => f.shotId === shot.id),
    actions,
  };
}

/** 场景包络（SimPlayer 用）：从 designer store 的 floorPlans 现算 */
export function envelopeFromStore(): SceneEnvelope {
  const fps = useDesignerStore.getState().floorPlans ?? [];
  // 下限 4×3 与 HouseCanvas 的 useFootprint 同款——必须是真跨度：
  // 拍摄模拟的室内机位钳制和放置钳制都用它。旧的 12×10 下限会把
  // 小片场虚报（三希堂 9×6 → 12×10），钳制跟着放错位置。
  let W = 4, D = 3;
  for (const fp of fps) {
    const rooms = fp.enabledRooms ?? [];
    const xs: number[] = [], zs: number[] = [];
    for (const r of rooms) {
      const lay = fp.roomLayout?.[r], dims = fp.roomDimensions?.[r];
      if (!lay || !dims) continue;
      xs.push(lay.x, lay.x + dims.width);
      zs.push(lay.y, lay.y + dims.depth);
    }
    if (xs.length) {
      W = Math.max(W, (Math.max(...xs) - Math.min(...xs)) / 100);
      D = Math.max(D, (Math.max(...zs) - Math.min(...zs)) / 100);
    }
  }
  return { W, D, floors: Math.max(1, fps.length) };
}

/** 房间级机位：找出世界坐标点 (x, z) 所在的房间矩形（世界坐标，米，
 *  原点居中——与 HouseCanvas 的房间渲染同款换算：每层按本层启用房间
 *  的包围盒居中，roomLayout/roomDimensions（厘米）→ 世界米）。
 *  点在房里时返回该房；在门洞/墙缝等无房处时退而求其次取 1.0m 内
 *  最近的房；都找不到返回 undefined，调用方退回包络级钳制。
 *  演员没有楼层字段——多层套里按楼层顺序取第一个命中的房
 *  （模拟机位高度只在首层有效）。 */
export function roomRectForPoint(x: number, z: number): RoomRect | undefined {
  const fps = useDesignerStore.getState().floorPlans ?? [];
  let best: RoomRect | undefined;
  let bestDist = 1.0; // 最近房的边距阈值（米）
  for (const fp of fps) {
    const rooms = fp.enabledRooms ?? [];
    const xs: number[] = [], zs: number[] = [];
    for (const r of rooms) {
      const lay = fp.roomLayout?.[r], dims = fp.roomDimensions?.[r];
      if (!lay || !dims) continue;
      xs.push(lay.x, lay.x + dims.width);
      zs.push(lay.y, lay.y + dims.depth);
    }
    if (!xs.length) continue;
    const minX = Math.min(...xs), minZ = Math.min(...zs);
    const planW = (Math.max(...xs) - minX) / 100;
    const planD = (Math.max(...zs) - minZ) / 100;
    for (const r of rooms) {
      const lay = fp.roomLayout?.[r], dims = fp.roomDimensions?.[r];
      if (!lay || !dims) continue;
      const rect: RoomRect = {
        minX: (lay.x - minX) / 100 - planW / 2,
        maxX: (lay.x + dims.width - minX) / 100 - planW / 2,
        minZ: (lay.y - minZ) / 100 - planD / 2,
        maxZ: (lay.y + dims.depth - minZ) / 100 - planD / 2,
      };
      if (x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ) return rect;
      // 最近房：到矩形边的距离（点在矩形内时为 0，上面已返回）
      const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
      const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
      const d = Math.hypot(dx, dz);
      if (d < bestDist) { bestDist = d; best = rect; }
    }
  }
  return best;
}

/** 放置钳制：把地面点钳进建筑包络（留 0.3m 墙边距），
 *  世界坐标以建筑中心为原点（与 HouseCanvas 同款）。
 *  返回钳后的点 + 是否越界——越界时调用方应提示用户。 */
export function clampPointToFootprint(p: [number, number]): { point: [number, number]; clamped: boolean } {
  const { W, D } = envelopeFromStore();
  const M = 0.3;
  const hx = Math.max(0, W / 2 - M);
  const hz = Math.max(0, D / 2 - M);
  const x = Math.max(-hx, Math.min(hx, p[0]));
  const z = Math.max(-hz, Math.min(hz, p[1]));
  return { point: [x, z], clamped: x !== p[0] || z !== p[1] };
}

/** 放置点击分类：落在房子外面不远（≤1m）时钳到墙边（旧行为）；
 *  离房子太远（>1m——放置地面是 500×500 的大平面，随便点到院外/
 *  空地上都会落进来）时拒绝：不落点、不改 pendingFrom、不吞状态，
 *  下一次点击仍有效，只在提示里明说。调用方据此决定落点还是报错。
 *  （导出供单测；行为与面板共用同一实现。） */
export function classifyPlaceClick(p: [number, number]): { ok: boolean; point: [number, number]; clamped: boolean } {
  const { point, clamped } = clampPointToFootprint(p);
  const ok = !clamped || Math.hypot(p[0] - point[0], p[1] - point[1]) <= 1.0;
  return { ok, point, clamped };
}

/** 径向投影：沿“中心→点击”的射线把点投到包络边上（保留点击的方向）。
 *  只用于 placePoint 的“两点重合”兜底，不改变 clampPointToFootprint 的贴边语义。 */
export function radialProjectToFootprint(p: [number, number]): [number, number] {
  const { W, D } = envelopeFromStore();
  const M = 0.3;
  const hx = Math.max(0, W / 2 - M);
  const hz = Math.max(0, D / 2 - M);
  if (p[0] === 0 && p[1] === 0) return [0, 0];
  const t = Math.min(hx / Math.abs(p[0] || 1e-9), hz / Math.abs(p[1] || 1e-9));
  return [p[0] * t, p[1] * t];
}

interface QueueItem { shot: Shot; style: RenderStyle; }

/** 逐镜成片的单镜状态（phase 沿用 useAiRender 的 RenderPhase 语义） */
interface GenEntry { phase: string; msg?: string; outputs?: string[]; }

interface CineState {
  /** 分镜（持久化） */
  shots: Shot[];
  addShot: (presetId: string) => void;
  removeShot: (id: string) => void;
  moveShot: (id: string, dir: -1 | 1) => void;
  updateShot: (id: string, patch: Partial<Pick<Shot, "duration" | "prompt" | "dialogue" | "targetActorId" | "lightingId" | "musicMood">>) => void;
  /** 剧本生成的镜：替换之前由剧本生成的镜（带 scriptScene 的），保留手工镜 */
  setScriptShots: (scriptShots: Shot[]) => void;

  /** 剧本正文（持久化；与 shots 同一个 localStorage 键；旧存档无此字段 = ""） */
  scriptText: string;
  setScriptText: (t: string) => void;
  /** 剧本场次 → 手动指定的片场 id（持久化；场次号 → set id；未指定时用解析的匹配结果） */
  scriptSetOverrides: Record<number, string>;
  setScriptSetOverride: (sceneNumber: number, setId: string | null) => void;

  /** 场景默认灯光（持久化；新镜继承；旧存档缺省 = 白天） */
  sceneLightingId: LightingId;
  setSceneLightingId: (id: LightingId) => void;
  /** 导演风格预设（持久化；directorStyles.ts 的 id，null = 无预设；
   *  旧存档缺省 = null。选预设只改场景默认灯光 + 面板建议，不动已有镜/演员） */
  directorStyleId: string | null;
  setDirectorStyleId: (id: string | null) => void;
  /** 用户在面板里点选预览的灯光（易失；模拟/录制开始即交出控制权） */
  previewLightingId: LightingId | null;
  setPreviewLightingId: (id: LightingId | null) => void;

  /** 拍摄模拟音效开关（持久化；缺省开；关掉时模拟只走时间、不发声） */
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;

  /** 导出风格（至少保留一个） */
  styles: RenderStyle[];
  toggleStyle: (s: RenderStyle) => void;

  /** 演员（持久化） */
  actors: Actor[];
  addActorMode: boolean;
  pendingFrom: [number, number] | null;
  /** 重设走位中（点两下改该演员的起点→终点，名字/角色/动作保留） */
  replaceActorId: string | null;
  /** 放置越界提示（瞬态，不持久化）：点落在房子外面被钳到墙边时提示用户 */
  placeWarning: string | null;
  setPlaceWarning: (w: string | null) => void;
  beginAddActor: () => void;
  beginReplaceActor: (id: string) => void;
  placePoint: (p: [number, number]) => void;
  cancelAddActor: () => void;
  removeActor: (id: string) => void;
  updateActor: (id: string, patch: Partial<Actor>) => void;
  /** 当前片场 id（面板同步进来，供新演员自动配色按时代选服装；易失，不持久化） */
  cineSetId: string | null;
  setCineSetId: (id: string | null) => void;

  /** 动态走位：点选加路点（持久化在 actor.waypoints 里） */
  waypointMode: string | null; // 正在编路点的演员 id
  beginWaypointMode: (actorId: string) => void;
  cancelWaypointMode: () => void;
  addWaypoint: (actorId: string, p: [number, number]) => void;
  updateWaypoint: (actorId: string, idx: number, patch: Partial<Waypoint>) => void;
  removeWaypoint: (actorId: string, idx: number) => void;

  /** 动作时间轴（持久化在 actor.timeline 里） */
  addTimelineSegment: (actorId: string, seg: ActionSegment) => void;
  updateTimelineSegment: (actorId: string, segId: string, patch: Partial<ActionSegment>) => void;
  removeTimelineSegment: (actorId: string, segId: string) => void;

  /** 打斗编舞（持久化；每段 fight 挂在一个 shot 上） */
  fights: Fight[];
  addFight: (shotId: string) => void;
  removeFight: (id: string) => void;
  updateFight: (id: string, patch: Partial<Fight>) => void;
  addPhrase: (fightId: string) => void;
  removePhrase: (fightId: string, phraseId: string) => void;
  addBeat: (fightId: string, phraseId: string) => void;
  updateBeat: (fightId: string, phraseId: string, beatId: string, patch: Partial<FightBeat>) => void;
  removeBeat: (fightId: string, phraseId: string, beatId: string) => void;

  /** 特技道具（持久化） */
  stuntProps: StuntProp[];
  propPlaceKind: StuntPropKind | null; // 正在点选放道具的种类
  beginPropPlace: (kind: StuntPropKind) => void;
  cancelPropPlace: () => void;
  placeStuntProp: (p: [number, number]) => void;
  addStuntProp: (kind: StuntPropKind, x: number, z: number) => StuntProp;
  removeStuntProp: (id: string) => void;

  /** 拍摄模拟（易失；UI 用的节流状态，逐帧时钟在 simClock） */
  sim: { active: boolean; playing: boolean; shotIdx: number; timeSec: number } | null;
  startSim: () => void;
  stopSim: () => void;
  setSim: (patch: Partial<{ playing: boolean; shotIdx: number; timeSec: number }>) => void;

  /** 9:16 竖屏取景框（易失，画布上的安全框覆盖层） */
  show916: boolean;
  toggle916: () => void;

  /** 实景首帧留存（shotId → dataURL，易失）——「逐镜成片」的输入图 */
  takes: Record<string, string>;
  _setTake: (shotId: string, dataUrl: string) => void;

  /** 逐镜成片（走既有「AI 出图设置」的后端/工作流体系） */
  genWorkflowId: string;
  setGenWorkflowId: (id: string) => void;
  genRunning: boolean;
  genState: Record<string, GenEntry>;
  _setGenRunning: (v: boolean) => void;
  _setGen: (shotId: string, patch: GenEntry) => void;

  /** 录制队列：null = 空闲。快拍 = 单镜实景；分镜 = shots × styles。 */
  queue: QueueItem[] | null;
  queueIdx: number;
  batch: boolean;
  progress: number;
  menuOpen: boolean;
  startQuick: (presetId: string) => void;
  startStoryboard: () => void;
  cancel: () => void;
  setMenuOpen: (open: boolean) => void;
  _advance: () => void;
  _finish: () => void;
  _setProgress: (p: number) => void;
}

export const useCineStore = create<CineState>()(
  persist(
    (set, get) => ({
      shots: [],
      sceneLightingId: "day",
      setSceneLightingId: (id) => set({ sceneLightingId: id }),
      // 导演风格预设：选 = 应用它的默认值（场景灯光改成预设的灯光；
      // 已有镜各自存了 lightingId，不受影响；演员/走位/分镜一律不动）。
      // 清除 / 未知 id = 回到 plain 默认（灯光 day），同样不删任何内容。
      directorStyleId: null,
      setDirectorStyleId: (id) => {
        const style = getDirectorStyle(id);
        const d = directorStyleDefaults(style?.id ?? null);
        set({ directorStyleId: style ? style.id : null, sceneLightingId: d.lightingId });
      },
      previewLightingId: null,
      setPreviewLightingId: (id) => set({ previewLightingId: id }),
      soundOn: true,
      setSoundOn: (v) => set({ soundOn: v }),
      addShot: (presetId) => {
        const first = get().actors[0];
        const preset = getCinePreset(presetId);
        // 新镜继承场景默认灯光（显式存下，之后改默认不影响已有镜；
        // 想跟随默认的镜在面板里选「跟随场景」即可）
        // 群体镜头不框单个演员——targetActorId 留空（applyShotCamera 用整组）。
        set({ shots: [...get().shots, makeShot(presetId, { ...(preset?.group ? {} : first ? { targetActorId: first.id } : {}), lightingId: get().sceneLightingId })] });
      },
      removeShot: (id) => set({
        shots: get().shots.filter((s) => s.id !== id),
        fights: get().fights.filter((f) => f.shotId !== id), // 挂在该镜上的打斗一起清掉
      }),
      moveShot: (id, dir) => {
        const arr = [...get().shots];
        const i = arr.findIndex((s) => s.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        set({ shots: arr });
      },
      updateShot: (id, patch) =>
        set({ shots: get().shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
      setScriptShots: (scriptShots) =>
        set({ shots: [...get().shots.filter((s) => s.scriptScene === undefined), ...scriptShots] }),

      // ── 剧本（Part 4）：正文 + 场次手动片场（持久化；旧存档缺省 = 空剧本）──
      scriptText: "",
      setScriptText: (t) => set({ scriptText: t }),
      scriptSetOverrides: {},
      setScriptSetOverride: (sceneNumber, setId) => {
        const next = { ...get().scriptSetOverrides };
        if (setId) next[sceneNumber] = setId;
        else delete next[sceneNumber];
        set({ scriptSetOverrides: next });
      },

      styles: ["beauty"],
      toggleStyle: (s) => {
        const cur = get().styles;
        const next = cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s];
        if (next.length) set({ styles: next }); // 至少留一个
      },

      actors: [],
      addActorMode: false,
      pendingFrom: null,
      replaceActorId: null,
      placeWarning: null,
      setPlaceWarning: (w) => set({ placeWarning: w }),
      beginAddActor: () => set({ addActorMode: true, pendingFrom: null, replaceActorId: null, placeWarning: null }),
      beginReplaceActor: (id) => set({ addActorMode: true, pendingFrom: null, replaceActorId: id, placeWarning: null }),
      placePoint: (p) => {
        const { addActorMode, pendingFrom, actors, replaceActorId } = get();
        if (!addActorMode) return;
        // 离房子太远的点击直接拒绝：不落点、不改 pendingFrom、不吞状态，
        // 下一次点击仍是有效的起点/终点（之前是钳到墙边悄悄吃掉，起点
        // 会莫名其妙落在墙角，下一对点击跟着错位）。
        const c = classifyPlaceClick(p);
        if (!c.ok) {
          set({ placeWarning: `点 (${p[0].toFixed(1)}, ${p[1].toFixed(1)}) 在房子外面，请点房子里面${pendingFrom ? "选终点" : "选起点"}` });
          return;
        }
        // 近处越界钳到墙边（旧行为），并提示用户（不是悄悄吃掉点击）
        const point = c.point, clamped = c.clamped;
        let finalPoint = point;
        if (clamped && pendingFrom && Math.hypot(point[0] - pendingFrom[0], point[1] - pendingFrom[1]) < 0.05) {
          // 两点重合：逐轴钳制把角落区的两次点击吸到同一个角，演员走位退化为 0，
          // 镜头贴到演员脸上出空白帧（停车场）。改沿第二次点击的方向径向投影，
          // 保住一条有效走位；只在重合时触发，其他放置行为不变。
          finalPoint = radialProjectToFootprint(p);
        }
        if (clamped) {
          set({ placeWarning: `点 (${p[0].toFixed(1)}, ${p[1].toFixed(1)}) 在房子外面，已移到墙边 (${finalPoint[0].toFixed(1)}, ${finalPoint[1].toFixed(1)})` });
        } else if (!pendingFrom) {
          set({ placeWarning: null });
        }
        if (!pendingFrom) { set({ pendingFrom: finalPoint }); return; }
        // 第二点离起点太近（<0.15m）不算放好：保留起点，提示换个更远的
        // 终点——之前会造出零长走位的演员，朝向/机位跟着退化。
        if (Math.hypot(finalPoint[0] - pendingFrom[0], finalPoint[1] - pendingFrom[1]) < 0.15) {
          set({ placeWarning: "起点和终点太近了（<0.15m），请点一个更远的位置当终点" });
          return;
        }
        if (replaceActorId) {
          // 重设走位：只改 from/to，名字/角色/动作/朝向保留
          set({
            actors: actors.map((a) => (a.id === replaceActorId ? { ...a, from: pendingFrom, to: finalPoint } : a)),
            pendingFrom: null, addActorMode: false, replaceActorId: null, placeWarning: null,
          });
          return;
        }
        // 新演员默认名：演员N（跳过已占用的号）
        let n = actors.length + 1;
        while (actors.some((a) => a.name === `演员${n}`)) n++;
        // 新演员自动配色：挑一件没人穿的、时代合身的服装（与已用主色反差最大）。
        // 默认素体不再是自动默认——只作显式选择（原型选"未选原型"时）。
        const suggested = suggestCostumeForNewActor(
          actors.map((a) => resolveActorCostume(a).id),
          get().cineSetId,
        );
        // 放好一位后留在加演员模式：下一对点击直接放下一位，不用重开面板；
        // 点提示条的「完成」或按 Esc 退出（pendingFrom 已清，不会残留半个起点）。
        set({
          actors: [...actors, makeActor(pendingFrom, finalPoint, {
            name: `演员${n}`,
            archetypeId: suggested.archetypeId || undefined,
            costumeId: suggested.costumeId,
          })],
          pendingFrom: null, placeWarning: null,
        });
      },
      cancelAddActor: () => set({ addActorMode: false, pendingFrom: null, replaceActorId: null, placeWarning: null }),
      removeActor: (id) => set({
        actors: get().actors.filter((a) => a.id !== id),
        // 该演员参与的打斗：把他从攻/守方里摘掉；没人了的打斗删掉
        fights: get().fights
          .map((f) => ({
            ...f,
            attackerId: f.attackerId === id ? "" : f.attackerId,
            defenderId: f.defenderId === id ? "" : f.defenderId,
          }))
          .filter((f) => f.attackerId && f.defenderId),
      }),
      updateActor: (id, patch) =>
        set({ actors: get().actors.map((a) => (a.id === id ? { ...a, ...patch } : a)) }),
      cineSetId: null,
      setCineSetId: (id) => set({ cineSetId: id }),

      // ── 动态走位 ──
      waypointMode: null,
      beginWaypointMode: (actorId) => set({ waypointMode: actorId, addActorMode: false, pendingFrom: null, replaceActorId: null, propPlaceKind: null, placeWarning: null }),
      cancelWaypointMode: () => set({ waypointMode: null }),
      addWaypoint: (actorId, p) => {
        const a = get().actors.find((x) => x.id === actorId);
        if (!a) return;
        // 离房子太远的点击拒绝加路点（不吞状态：下一次点击仍有效）
        const c = classifyPlaceClick(p);
        if (!c.ok) {
          set({ placeWarning: `路点 (${p[0].toFixed(1)}, ${p[1].toFixed(1)}) 在房子外面，请点房子里面` });
          return;
        }
        // 越界钳制：路点落在房子外面时移到墙边，并提示用户
        const point = c.point, clamped = c.clamped;
        if (clamped) {
          set({ placeWarning: `路点 (${p[0].toFixed(1)}, ${p[1].toFixed(1)}) 在房子外面，已移到墙边 (${point[0].toFixed(1)}, ${point[1].toFixed(1)})` });
        }
        const wps = (a.waypoints ?? []).slice().sort((x, y) => x.t - y.t);
        // 首个路点：若演员还没有走位时间轴，先以 from→to 建两个点（t=0 / t=镜长）
        let base = wps;
        if (!base.length) {
          const dur = get().shots[0]?.duration ?? 8;
          base = [
            makeWaypoint(a.from[0], a.from[1], 0),
            makeWaypoint(a.to[0], a.to[1], dur),
          ];
        }
        const t = base.length ? base[base.length - 1].t + 2 : 0;
        const next = [...base, makeWaypoint(point[0], point[1], t)];
        get().updateActor(actorId, { waypoints: next });
      },
      updateWaypoint: (actorId, idx, patch) => {
        const a = get().actors.find((x) => x.id === actorId);
        if (!a || !a.waypoints) return;
        const next = a.waypoints
          .map((w, i) => (i === idx ? { ...w, ...patch } : w))
          .sort((x, y) => x.t - y.t); // 改时间后保持按时间排序
        get().updateActor(actorId, { waypoints: next });
      },
      removeWaypoint: (actorId, idx) => {
        const a = get().actors.find((x) => x.id === actorId);
        if (!a || !a.waypoints) return;
        const next = a.waypoints.filter((_, i) => i !== idx);
        get().updateActor(actorId, { waypoints: next.length >= 2 ? next : undefined });
      },

      // ── 动作时间轴 ──
      addTimelineSegment: (actorId, seg) => {
        const a = get().actors.find((x) => x.id === actorId);
        if (!a) return;
        get().updateActor(actorId, { timeline: [...(a.timeline ?? []), seg] });
      },
      updateTimelineSegment: (actorId, segId, patch) => {
        const a = get().actors.find((x) => x.id === actorId);
        if (!a || !a.timeline) return;
        get().updateActor(actorId, {
          timeline: a.timeline.map((s) => (s.id === segId ? { ...s, ...patch } : s)),
        });
      },
      removeTimelineSegment: (actorId, segId) => {
        const a = get().actors.find((x) => x.id === actorId);
        if (!a || !a.timeline) return;
        get().updateActor(actorId, { timeline: a.timeline.filter((s) => s.id !== segId) });
      },

      // ── 打斗编舞 ──
      fights: [],
      addFight: (shotId) => {
        const st = get();
        const atk = st.actors[0], def = st.actors[1] ?? st.actors[0];
        if (!atk || !def) return;
        const f: Fight = {
          ...makeFight(atk.id, def.id, { shotId }),
          phrases: [makePhrase([
            makeBeat("punch", atk.id, def.id, { duration: 0.8, reaction: "后仰" }),
            makeBeat("block", atk.id, def.id, { duration: 0.8 }),
            makeBeat("punch", atk.id, def.id, { duration: 0.8, reaction: "踉跄" }),
          ])],
        };
        set({ fights: [...st.fights, f] });
      },
      removeFight: (id) => set({ fights: get().fights.filter((f) => f.id !== id) }),
      updateFight: (id, patch) =>
        set({ fights: get().fights.map((f) => (f.id === id ? { ...f, ...patch } : f)) }),
      addPhrase: (fightId) => set({
        fights: get().fights.map((f) =>
          f.id === fightId ? { ...f, phrases: [...f.phrases, makePhrase([makeBeat("punch", f.attackerId, f.defenderId, {})])] } : f),
      }),
      removePhrase: (fightId, phraseId) => set({
        fights: get().fights.map((f) =>
          f.id === fightId ? { ...f, phrases: f.phrases.filter((p) => p.id !== phraseId) } : f),
      }),
      addBeat: (fightId, phraseId) => set({
        fights: get().fights.map((f) =>
          f.id === fightId
            ? { ...f, phrases: f.phrases.map((p) => (p.id === phraseId ? { ...p, beats: [...p.beats, makeBeat("punch", f.attackerId, f.defenderId, {})] } : p)) }
            : f),
      }),
      updateBeat: (fightId, phraseId, beatId, patch) => set({
        fights: get().fights.map((f) =>
          f.id === fightId
            ? { ...f, phrases: f.phrases.map((p) => (p.id === phraseId ? { ...p, beats: p.beats.map((b) => (b.id === beatId ? { ...b, ...patch } : b)) } : p)) }
            : f),
      }),
      removeBeat: (fightId, phraseId, beatId) => set({
        fights: get().fights.map((f) =>
          f.id === fightId
            ? { ...f, phrases: f.phrases.map((p) => (p.id === phraseId ? { ...p, beats: p.beats.filter((b) => b.id !== beatId) } : p)) }
            : f),
      }),

      // ── 特技道具 ──
      stuntProps: [],
      propPlaceKind: null,
      beginPropPlace: (kind) => set({ propPlaceKind: kind, addActorMode: false, pendingFrom: null, replaceActorId: null, waypointMode: null }),
      cancelPropPlace: () => set({ propPlaceKind: null }),
      placeStuntProp: (p) => {
        const kind = get().propPlaceKind;
        if (!kind) return;
        get().addStuntProp(kind, p[0], p[1]);
        set({ propPlaceKind: null });
      },
      addStuntProp: (kind, x, z) => {
        const prop = makeStuntProp(kind, x, z);
        set({ stuntProps: [...get().stuntProps, prop] });
        return prop;
      },
      removeStuntProp: (id) => set({ stuntProps: get().stuntProps.filter((p) => p.id !== id) }),

      // ── 拍摄模拟 ──
      sim: null,
      startSim: () => {
        const st = get();
        if (!st.shots.length) return;
        // 模拟接管画布：先退出一切放置模式（残留的 pendingFrom 起点标
        // 记、放置地面都不该带进模拟里；暂停后拖演员走另一条路）。
        // 用户手势里建 AudioContext：浏览器只允许手势后出声；
        // 建失败也不影响模拟（playSoundEffect 会静默）。
        ensureAudioContext();
        simClock.active = true;
        simClock.playing = true;
        simClock.shotIdx = 0;
        simClock.timeSec = 0;
        simClock.shotDuration = st.shots[0].duration;
        simClock.shotId = st.shots[0].id;
        // 音效游标从头开始（上一轮的 fired 记录清掉）
        resetSimSfxCursor();
        // 模拟接管灯光：每镜按自己的 lightingId 切，面板预览即刻失效
        set({ sim: { active: true, playing: true, shotIdx: 0, timeSec: 0 }, previewLightingId: null, addActorMode: false, pendingFrom: null, replaceActorId: null, waypointMode: null, propPlaceKind: null });
      },
      stopSim: () => {
        simClock.active = false;
        simClock.playing = false;
        resetSimSfxCursor();
        set({ sim: null, previewLightingId: null });
      },
      setSim: (patch) => {
        const cur = get().sim;
        if (!cur) return;
        const next = { ...cur, ...patch };
        // 同步逐帧时钟（scrub 时）
        if (patch.shotIdx !== undefined || patch.timeSec !== undefined) {
          const shots = get().shots;
          const shot = shots[next.shotIdx];
          simClock.shotIdx = next.shotIdx;
          simClock.timeSec = next.timeSec;
          simClock.shotDuration = shot?.duration ?? 8;
          simClock.shotId = shot?.id ?? null;
        }
        if (patch.playing !== undefined) simClock.playing = patch.playing;
        set({ sim: next });
      },

      show916: false,
      toggle916: () => set({ show916: !get().show916 }),

      takes: {},
      _setTake: (shotId, dataUrl) => set({ takes: { ...get().takes, [shotId]: dataUrl } }),

      genWorkflowId: "",
      setGenWorkflowId: (id) => set({ genWorkflowId: id }),
      genRunning: false,
      genState: {},
      _setGenRunning: (v) => set({ genRunning: v }),
      _setGen: (shotId, patch) =>
        set({ genState: { ...get().genState, [shotId]: { ...get().genState[shotId], ...patch } } }),

      queue: null,
      queueIdx: 0,
      batch: false,
      progress: 0,
      menuOpen: false,
      startQuick: (presetId) =>
        set({ queue: [{ shot: makeShot(presetId, { lightingId: get().sceneLightingId }), style: "beauty" }], queueIdx: 0, batch: false, progress: 0, menuOpen: false, addActorMode: false, pendingFrom: null, replaceActorId: null, waypointMode: null, propPlaceKind: null }),
      startStoryboard: () => {
        const { shots, styles } = get();
        if (!shots.length) return;
        // 镜头为主序、风格为次序：01-实景 → 01-白模 → 02-实景 → …
        const queue: QueueItem[] = [];
        for (const shot of shots) for (const style of styles) queue.push({ shot, style });
        set({ queue, queueIdx: 0, batch: true, progress: 0, menuOpen: false, addActorMode: false, pendingFrom: null, replaceActorId: null, waypointMode: null, propPlaceKind: null });
      },
      cancel: () => set({ queue: null, queueIdx: 0, progress: 0 }),
      setMenuOpen: (open) => set({ menuOpen: open }),
      _advance: () => set({ queueIdx: get().queueIdx + 1, progress: 0 }),
      _finish: () => set({ queue: null, queueIdx: 0, progress: 0 }),
      _setProgress: (p) => set({ progress: p }),
    }),
    // 只持久化创作数据；录制态/首帧/生成态/模拟态/灯光预览易失
    { name: "zhuya-cine-shots-v1", partialize: (s) => ({ shots: s.shots, actors: s.actors, styles: s.styles, genWorkflowId: s.genWorkflowId, fights: s.fights, stuntProps: s.stuntProps, sceneLightingId: s.sceneLightingId, directorStyleId: s.directorStyleId, soundOn: s.soundOn, scriptText: s.scriptText, scriptSetOverrides: s.scriptSetOverrides }) },
  ),
);

/** HouseCanvas 用的生效灯光 id（zustand selector，返回 LightingId|null）：
 *  优先级：录制队列当前镜 > 拍摄模拟当前镜 > 面板点选预览；三者皆无 =
 *  不覆盖（走原有 sunHour 主题，默认外观不变）。返回原始字符串，只有
 *  换镜/换预览时才变，不会每帧触发 HouseCanvas 重渲染。 */
export function selectActiveCineLightingId(
  s: Pick<CineState, "queue" | "queueIdx" | "sim" | "shots" | "sceneLightingId" | "previewLightingId">,
): LightingId | null {
  const q = s.queue;
  if (q && q.length) {
    const item = q[s.queueIdx];
    if (item) return resolveShotLightingId(item.shot.lightingId, s.sceneLightingId);
  }
  if (s.sim?.active) {
    const shot = s.shots[s.sim.shotIdx];
    if (shot) return resolveShotLightingId(shot.lightingId, s.sceneLightingId);
  }
  return s.previewLightingId ?? null;
}

/** 挑一个当前浏览器支持的视频封装（Safari 走 mp4，Chrome/Edge 走 webm） */
function pickMime(): { mime: string; ext: string } {
  const candidates: Array<[string, string]> = [
    ["video/mp4;codecs=avc1", "mp4"],
    ["video/webm;codecs=vp9", "webm"],
    ["video/webm", "webm"],
  ];
  for (const [mime, ext] of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return { mime, ext };
    }
  }
  return { mime: "", ext: "webm" };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 同步渲一帧并从帧缓冲读出 PNG（preserveDrawingBuffer:false 下
 *  toDataURL 读到陈旧缓冲，必须 readPixels——外观截图管线验证过的做法）。
 *  同时返回 dataURL：实景首帧要留在内存里给「逐镜成片」当输入图。 */
function captureFramePNG(
  gl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<{ blob: Blob | null; dataUrl: string }> {
  gl.render(scene, camera);
  const ctx = gl.getContext();
  const cv = gl.domElement;
  const w = cv.width, h = cv.height;
  const buf = new Uint8Array(w * h * 4);
  ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
  const c2 = document.createElement("canvas");
  c2.width = w; c2.height = h;
  const g2 = c2.getContext("2d")!;
  const img = g2.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - 1 - y) * w * 4 + w * 4), y * w * 4);
  }
  g2.putImageData(img, 0, 0);
  const dataUrl = c2.toDataURL("image/png");
  return new Promise((resolve) => c2.toBlob((blob) => resolve({ blob, dataUrl }), "image/png"));
}

/** 近白远黑的线性深度材质（MiDaS 习惯；VACE/ControlNet 深度输入） */
function makeDepthMaterial(env: SceneEnvelope): THREE.ShaderMaterial {
  const far = Math.max(30, Math.hypot(env.W, env.D) * 2.8);
  return new THREE.ShaderMaterial({
    uniforms: { uNear: { value: 0.5 }, uFar: { value: far } },
    vertexShader: `varying float vZ; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uNear; uniform float uFar; varying float vZ;
      void main(){ float d = clamp(1.0 - (vZ - uNear) / (uFar - uNear), 0.0, 1.0); gl_FragColor = vec4(vec3(d), 1.0); }`,
  });
}

/** 隐藏 shader 类物件（天空/星空/水面粒子等）——白模/深度 pass 只保留实体几何。
 *  返回还原函数。 */
function hideNonSolid(scene: THREE.Scene): () => void {
  const touched: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    const isShader = Array.isArray(mat)
      ? mat.some((x) => (x as THREE.ShaderMaterial).isShaderMaterial)
      : !!(mat as THREE.ShaderMaterial | undefined)?.isShaderMaterial;
    const points = (o as unknown as { isPoints?: boolean }).isPoints;
    const sprite = (o as unknown as { isSprite?: boolean }).isSprite;
    if (o.visible && (points || sprite || (m.isMesh && isShader))) {
      touched.push(o);
      o.visible = false;
    }
  });
  return () => touched.forEach((o) => (o.visible = true));
}

/** 应用导出风格（beauty 无操作）。返回还原函数。 */
function applyStyle(scene: THREE.Scene, style: RenderStyle, env: SceneEnvelope): () => void {
  if (style === "beauty") return () => {};
  const unhide = hideNonSolid(scene);
  const prevOverride = scene.overrideMaterial;
  const prevBg = scene.background;
  const mat = style === "clay"
    ? new THREE.MeshStandardMaterial({ color: 0xd9d9d9, roughness: 0.9, metalness: 0 })
    : makeDepthMaterial(env);
  scene.overrideMaterial = mat;
  scene.background = new THREE.Color(style === "clay" ? 0xdfe3e8 : 0x000000);
  return () => {
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    unhide();
    mat.dispose();
  };
}

const STYLE_SUFFIX: Record<RenderStyle, string> = { beauty: "", clay: "_clay", depth: "_depth" };

// ─── 逐镜成片（M4-A）────────────────────────────────────────
// 复用「AI 出图设置」的后端/工作流体系（本地 ComfyUI / 自建 / RunningHub），
// 每镜：实景首帧为输入图 + 本镜提示词 → runRender（上传/提交/轮询/取产出）。
// 串行执行（别挤爆用户 GPU）；菜单关了也继续跑（状态在 store）。
const genCancelFlag = { current: false };

async function runStoryboardGen() {
  const st0 = useCineStore.getState();
  if (st0.genRunning) return;
  const cfg = getAiRenderConfig();
  const wf = cfg.workflows.find((w) => w.id === st0.genWorkflowId);
  if (!wf || !st0.shots.length) return;
  genCancelFlag.current = false;
  st0._setGenRunning(true);
  for (const shot of st0.shots) {
    if (genCancelFlag.current) break;
    const st = useCineStore.getState();
    const preset = getCinePreset(shot.presetId);
    const image = st.takes[shot.id];
    if (wf.needsImage && !image) {
      st._setGen(shot.id, { phase: "error", msg: "缺首帧——先「拍摄全部」（含实景风格）留住首帧" });
      continue;
    }
    // 提示词：用户写了用用户的；空则给一句带运镜 + 灯光语义的兜底
    const lighting = resolveLightingPreset(resolveShotLightingId(shot.lightingId, st.sceneLightingId));
    const prompt = shot.prompt.trim()
      || `cinematic ${preset?.nameEn ?? "camera"} shot of a modern villa, ${lighting.nameEn} lighting, photorealistic, high quality`;
    st._setGen(shot.id, { phase: "submitting", msg: undefined, outputs: undefined });
    const res = await runRender(
      { workflow: wf, prompt, image },
      {
        onPhase: (p) => useCineStore.getState()._setGen(shot.id, { phase: p }),
        cancelRef: genCancelFlag,
        timeoutMs: 20 * 60_000, // 视频工作流慢，放宽到 20 分钟
      },
    );
    if (res === null) { useCineStore.getState()._setGen(shot.id, { phase: "idle", msg: "已取消" }); break; }
    if ("error" in res) useCineStore.getState()._setGen(shot.id, { phase: "error", msg: res.error });
    else useCineStore.getState()._setGen(shot.id, { phase: "done", outputs: res.images });
  }
  useCineStore.getState()._setGenRunning(false);
}

const GEN_PHASE_ZH: Record<string, string> = {
  uploading: "上传首帧…", submitting: "提交任务…", rendering: "生成中…",
  done: "完成", error: "失败", idle: "—",
};

/** ── 视线遮挡射线检测（Option B）────────────────────────────
 *  室内机位钳进房间后，相机→演员的视线仍可能被高大家具 / 结构柱
 *  挡住（贴墙走位最常见：视线沿墙走，正好穿过贴墙高柜）。
 *  applyShotCamera 是 sim 预览、录制、故事板导出共用的 choke 点，
 *  在此检测一次，三处同修。
 *  节流：每镜按 t 分桶（20 桶）+ 房签缓存已解算的机位；换镜或场景
 *  顶层节点数变化（GLB 加载进场）时清空缓存。未加载的 GLB 没有网
 *  格，射线会判"通"——残留的假通只存在于模型加载中的极短窗口，
 *  且换镜/节点变化会重新解算；接受并记录，不另做加载等待。 */
const losRaycaster = new THREE.Raycaster();
const losCache = new Map<string, CameraSample>();
let losCacheShotId: string | null = null;
let losCacheSceneSize = -1;

/** 射线命中的对象是否可见（three 的 Raycaster 不检查 visible，
 *  须自己沿父链查；藏起来的载具/占位网格不应挡镜）。 */
function losHitVisible(o: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}

/** 视线是否被挡：相机→演员头（只射正向）。
 *  曾试过第二条反向射线（演员头外 0.45m 射回相机，抓相机嵌进家具）
 *  ——实测误杀：贴墙走位的演员离高柜只有十几厘米，反向起点直接落在
 *  柜体里（书架纵深 2m），于是所有候选机位都被判挡，nudge 从未生效
 *  （school 实测 22 次全 fallback）。已删；正向是遮挡检测本身，机位
 *  嵌进家具的罕见情形不比今天更差，留待以后再处理。
 *  只认 Mesh 命中（Line2 路径线 / Sprite 标牌不计入；raycaster.camera
 *  须设好，否则 drei 的 Line2 射线在读 camera.near 时抛错——与
 *  HouseCanvas 的 roam 射线是两把不同的 Raycaster，此处不碰那处代码）。 */
function losBlocked(scene: THREE.Scene, cam: THREE.PerspectiveCamera, from: THREE.Vector3, head: THREE.Vector3): boolean {
  const dir = new THREE.Vector3().subVectors(head, from);
  const dist = dir.length();
  if (dist < 0.6) return false;
  dir.normalize();
  losRaycaster.camera = cam;
  losRaycaster.near = 0.05;
  // 正向：相机 → 演员头前 0.3m（留出演员自己的头/身，不把演员当遮挡）
  losRaycaster.set(from, dir);
  losRaycaster.far = dist - 0.3;
  let hits: THREE.Intersection[] = [];
  try {
    hits = losRaycaster.intersectObjects(scene.children, true);
  } catch {
    // 场景里个别对象（如未初始化的 Line2）射线抛错时 fail-open：
    // 判"通"，回落旧行为，绝不因此断了模拟/录制。
    return false;
  }
  for (const h of hits) {
    const o = h.object as THREE.Mesh;
    if (o.isMesh && losHitVisible(o)) return true;
  }
  return false;
}

/** 演员双肩点：头点左右各 0.25m（素体约 0.5m 宽）、高 1.45m。
 *  宽隔断（博古架 2m）后常出现"头通、身挡"：单点头射线说通，画面里
 *  演员半身仍在柜后。肩点沿视线在 XZ 面的垂线取，与演员朝向无关。 */
function losShoulderPoints(head: THREE.Vector3, from: THREE.Vector3): THREE.Vector3[] {
  const d = new THREE.Vector3().subVectors(head, from);
  d.y = 0;
  if (d.lengthSq() < 1e-6) return [];
  d.normalize();
  const lat = new THREE.Vector3(-d.z, 0, d.x);
  return [-0.25, 0.25].map((s) => new THREE.Vector3(head.x + lat.x * s, 1.45, head.z + lat.z * s));
}

/** 对一镜采样做视线解算（带缓存）：通则原样返回；被挡则按
 *  losCandidates 的顺序逐个试射，首个通的胜出；全不通回原机位。
 *  触发：头被挡，或头通但肩被挡（矮柜挡身不挡头时头射线是通的）。
 *  头被挡时两档：优先三点全通（头 + 双肩——宽隔断后只头通不够），
 *  没有则退到只头通的候选；头通肩挡时只接受三点全通，否则原样。 */
function resolveCameraLOS(
  scene: THREE.Scene,
  cam: THREE.PerspectiveCamera,
  sample: CameraSample,
  shot: Shot,
  t: number,
  head: [number, number, number],
  env: SceneEnvelope,
  actors: Actor[],
): CameraSample {
  // 换镜或场景节点数变化（GLB 加载进场）时缓存失效
  const sceneSize = scene.children.length;
  if (losCacheShotId !== shot.id || losCacheSceneSize !== sceneSize) {
    losCache.clear();
    losCacheShotId = shot.id;
    losCacheSceneSize = sceneSize;
  }
  const room = env.room;
  const roomSig = room
    ? `${room.minX.toFixed(1)},${room.maxX.toFixed(1)},${room.minZ.toFixed(1)},${room.maxZ.toFixed(1)}`
    : "env";
  const key = `${shot.id}|${Math.round(t * 20)}|${roomSig}`;
  const cached = losCache.get(key);
  if (cached) return cached;
  if (losCache.size > 400) losCache.clear();

  const from = new THREE.Vector3(...sample.pos);
  const headV = new THREE.Vector3(...head);
  const shoulders = losShoulderPoints(headV, from);
  // 触发条件：头被挡，或头通但肩被挡（如 1.5m 展柜挡身不挡头——
  // 头射线从柜顶上方掠过说"通"，画面里演员却只剩一个头）。
  const headBlocked = losBlocked(scene, cam, from, headV);
  const shouldersBlocked = !headBlocked && shoulders.some((t) => losBlocked(scene, cam, from, t));
  // 太近：机位被房间钳制到离演员不足 1m（演员贴墙角开场时，全景/中景
  // 的 5m/2.8m 机位会被墙压到演员脸上，画面只剩半张脸——停车场）。
  // 与遮挡同等处理：挪机位，永不比今天差。
  const MIN_CAM_DIST = 1.0;
  const tooClose = from.distanceTo(headV) < MIN_CAM_DIST;
  if (!headBlocked && !shouldersBlocked && !tooClose) {
    losCache.set(key, sample);
    return sample;
  }
  let resolved = sample;
  {
    // 轴线（前两位演员镜中点连线）：候选优先保持机位在轴线同侧
    let axis: { a: [number, number]; b: [number, number] } | undefined;
    if (actors.length >= 2) {
      const a = actorPositionAt(actors[0], shot.duration / 2, shot.duration);
      const b = actorPositionAt(actors[1], shot.duration / 2, shot.duration);
      if (a[0] !== b[0] || a[1] !== b[1]) axis = { a, b };
    }
    const cands = losCandidates(sample.pos, head, env, axis);
    // 太近时：在三点全通且距离够的候选里选离演员最远的（尽量回到
    // 预设的景别）；没有则沿用下面的遮挡逻辑（或原样）。
    // 注意：太近时视线方向已退化，losCandidates 算不出候选（len<0.6
    // 直接返回 []），改用沿正方向试的 tooCloseCandidates。
    if (tooClose) {
      let best: [number, number, number] | null = null;
      let bestDist = MIN_CAM_DIST;
      for (const cand of tooCloseCandidates(sample.pos, env)) {
        const candFrom = new THREE.Vector3(...cand);
        if (candFrom.distanceTo(headV) < MIN_CAM_DIST) continue;
        if (losBlocked(scene, cam, candFrom, headV)) continue;
        if (!shoulders.every((t) => !losBlocked(scene, cam, candFrom, t))) continue;
        const d = candFrom.distanceTo(headV);
        if (d > bestDist) { bestDist = d; best = cand; }
      }
      if (best) {
        resolved = { ...sample, pos: best };
        losCache.set(key, resolved);
        return resolved;
      }
      // 没有够远又通的候选：若同时没遮挡就原样（已是最好的了）；
      // 若有遮挡，继续走下面的遮挡逻辑找能露头的候选。
      if (!headBlocked && !shouldersBlocked) {
        losCache.set(key, sample);
        return sample;
      }
    }
    if (headBlocked) {
      // 两档：优先三点全通（头 + 双肩——宽隔断后只头通不够）；没有则退到
      // 只头通的候选（至少把头露出来）；都没有则原样，永不比今天差。
      let headOnly: [number, number, number] | null = null;
      for (const cand of cands) {
        const candFrom = new THREE.Vector3(...cand);
        if (losBlocked(scene, cam, candFrom, headV)) continue;
        if (!headOnly) headOnly = cand;
        // 三点全通才是最优解；只头通的先记下作退路，继续找更大的位移
        if (shoulders.every((t) => !losBlocked(scene, cam, candFrom, t))) {
          resolved = { ...sample, pos: cand };
          headOnly = null;
          break;
        }
      }
      if (headOnly) resolved = { ...sample, pos: headOnly };
    } else {
      // 头已通、肩被挡：只接受三点全通的候选，否则原样不动机位
      // （头本来就是通的，为一个修不好的肩膀挪机位只会坏构图）。
      for (const cand of cands) {
        const candFrom = new THREE.Vector3(...cand);
        if (!losBlocked(scene, cam, candFrom, headV) && shoulders.every((t) => !losBlocked(scene, cam, candFrom, t))) {
          resolved = { ...sample, pos: cand };
          break;
        }
      }
    }
  }
  losCache.set(key, resolved);
  return resolved;
}

/** 群体镜头保框（只动 group 预设，单人镜原样）────────────────────
 *  症状：LOS 挪机位 / 房间钳制会把机位推到墙边，整组只剩一两个人
 *  在画里，收尾帧常常只剩一面暗墙。预设本身按重心 + 世界 X 向半宽
 *  算距离，朝向一转（机位在东侧时横向其实是世界 Z）就框不全。
 *  做法：LOS 挪完后拿“挪前/挪后”两个采样逐人验框——挪后丢人就回
 *  挪前；再放宽 fov（≤75°）、沿视线后拉机位（≤3m，仍钳在房里）
 *  兜底；实在框不全也返回框住人数最多的那个，永不比原来差。
 *  只做纯数学（不射线），每帧一次，开销可忽略。
 *  （导出供单测；行为与 applyShotCamera 共用同一实现。） */
export function groupFitCount(
  sample: CameraSample,
  heads: Array<[number, number, number]>,
  aspect: number,
): number {
  const fwd = new THREE.Vector3(sample.lookAt[0] - sample.pos[0], sample.lookAt[1] - sample.pos[1], sample.lookAt[2] - sample.pos[2]);
  if (fwd.lengthSq() < 1e-6) return 0;
  fwd.normalize();
  const hHalf = Math.atan(Math.tan((sample.fov * Math.PI) / 360) * Math.max(0.5, aspect));
  const vHalf = (sample.fov * Math.PI) / 360;
  // 6% 画幅边距：人不贴边
  const hLim = hHalf * 0.94, vLim = vHalf * 0.94;
  const fwdYaw = Math.atan2(fwd.x, fwd.z);
  const fwdPitch = Math.atan2(fwd.y, Math.hypot(fwd.x, fwd.z));
  let n = 0;
  for (const h of heads) {
    const d = new THREE.Vector3(h[0] - sample.pos[0], h[1] - sample.pos[1], h[2] - sample.pos[2]);
    const dist = d.length();
    if (dist < 0.3) continue; // 机位贴到人脸上，算丢
    const yaw = Math.atan2(d.x, d.z) - fwdYaw;
    const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) - fwdPitch;
    // yaw 绕一圈归一化到 [-π, π]
    const yawN = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    if (Math.abs(yawN) <= hLim && Math.abs(pitch) <= vLim) n++;
  }
  return n;
}

export function ensureGroupFraming(
  preLos: CameraSample,
  postLos: CameraSample,
  heads: Array<[number, number, number]>,
  env: SceneEnvelope,
  aspect: number,
): CameraSample {
  const total = heads.length;
  if (!total) return postLos;
  // 挪后仍框全组：LOS 的修补保住了，直接用
  if (groupFitCount(postLos, heads, aspect) >= total) return postLos;
  // 挪后丢人、挪前框全：回挪前（取景优先于遮挡修补）
  if (groupFitCount(preLos, heads, aspect) >= total) return preLos;
  // 两个都不全：挑框住人数多的那个，再放宽 fov / 后拉机位兜底
  const preN = groupFitCount(preLos, heads, aspect);
  const postN = groupFitCount(postLos, heads, aspect);
  let best = postN > preN ? postLos : preLos;
  let bestN = Math.max(preN, postN);
  for (const fov of [60, 65, 70, 75]) {
    if (best.fov >= fov) continue;
    const widened: CameraSample = { ...best, fov };
    const n = groupFitCount(widened, heads, aspect);
    if (n > bestN) { best = widened; bestN = n; }
    if (n >= total) return widened;
  }
  // 后拉：沿视线反方向退，仍钳在房里；退不动（已贴墙）就停
  const fwd = new THREE.Vector3(best.lookAt[0] - best.pos[0], best.lookAt[1] - best.pos[1], best.lookAt[2] - best.pos[2]).normalize();
  for (const back of [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]) {
    const pulled: CameraSample = {
      ...best,
      fov: Math.max(best.fov, 70),
      pos: clampIndoorCamera(
        [best.pos[0] - fwd.x * back, best.pos[1], best.pos[2] - fwd.z * back],
        env,
      ),
    };
    if (Math.hypot(pulled.pos[0] - best.pos[0], pulled.pos[2] - best.pos[2]) < 0.05) break;
    const n = groupFitCount(pulled, heads, aspect);
    if (n > bestN) { best = pulled; bestN = n; }
    if (n >= total) return pulled;
  }
  return best;
}

/** 一镜的机位采样（录制与拍摄模拟共用）：预设机位框住 target 演员
 *  （走位时间轴 + 动作时间轴 + 高度）；本镜有打斗编舞且正在播时，
 *  beat 的机位（默认 punch-axis cheat）覆盖预设机位。
 *  scene 传入时室内镜加做视线遮挡射线检测（Option B）；不传时跳过，
 *  保持旧行为。 */
function applyShotCamera(cam: THREE.PerspectiveCamera, shot: Shot, timeSec: number, env: SceneEnvelope, scene?: THREE.Scene) {
  const preset = getCinePreset(shot.presetId);
  if (!preset) return;
  const st = useCineStore.getState();
  // 群体镜头框整组（重心 + 包络），不用单个目标演员；其余预设跟拍
  // targetActorId 指定的演员（缺省第一个）。
  const actor = st.actors.find((a) => a.id === shot.targetActorId) ?? st.actors[0];
  const target = preset.group
    ? (st.actors.length ? groupTargetAt(st.actors, shot.duration) : undefined)
    : (actor ? actorTargetAt(actor, shot.duration) : undefined);
  const t = Math.min(1, Math.max(0, timeSec / Math.max(0.1, shot.duration)));
  // 房间级机位：按演员当前位置取房，室内预设钳进该房；
  // 取不到房（门洞/墙缝/无演员）时退回包络级钳制。
  let envForShot = env;
  let actorPos: { x: number; z: number; y?: number } | undefined;
  if (target?.at) {
    const p = target.at(t);
    actorPos = p;
    const room = roomRectForPoint(p.x, p.z);
    if (room) envForShot = { ...env, room };
  }
  // 画布宽高比进包络：群体镜头据此算横向包络（竖幅导出帧横向紧得多）
  if (cam.aspect > 0) envForShot = { ...envForShot, aspect: cam.aspect };
  let s = preset.sample(t, envForShot, target);
  const fight = st.fights.find((f) => f.shotId === shot.id);
  if (fight && actor) {
    const atk = st.actors.find((a) => a.id === fight.attackerId);
    const def = st.actors.find((a) => a.id === fight.defenderId);
    if (atk && def) {
      const atkBase = actorStateAt(atk, 0, shot.duration);
      const defBase = actorStateAt(def, 0, shot.duration);
      const fs = evaluateFightState(fight, timeSec, [atkBase.x, atkBase.z, atkBase.elev], [defBase.x, defBase.z, defBase.elev]);
      const cur = fightBeatAt(fight, timeSec);
      if (fs.active && cur && cur.beat.camera !== "wide") {
        const camSample = fightCameraSample(cur.beat.camera ?? "cheat", [fs.attacker.x, fs.attacker.z], [fs.defender.x, fs.defender.z]);
        if (camSample) {
          s = { pos: [camSample.pos[0], camSample.pos[1], camSample.pos[2]], lookAt: [camSample.lookAt[0], camSample.lookAt[1], camSample.lookAt[2]], fov: 45 };
        }
      }
    }
  }
  // 视线遮挡（Option B）：只看室内镜；演员头 = 演员位置 + 1.55m
  // （方块人头顶约 1.52m），无演员时退回注视点 + 0.35m。
  let preLos = s;
  if (preset.indoor && scene) {
    const head: [number, number, number] = actorPos
      ? [actorPos.x, (actorPos.y ?? 0) + 1.55, actorPos.z]
      : [s.lookAt[0], s.lookAt[1] + 0.35, s.lookAt[2]];
    s = resolveCameraLOS(scene, cam, s, shot, t, head, envForShot, st.actors);
  }
  // 群体镜头保框：LOS 挪机位/房间钳制可能把整组推出画外（收尾只剩
  // 暗墙）——拿挪前/挪后两个采样逐人验框，丢人就回挪前，再放宽 fov、
  // 后拉机位兜底。单人镜不走这条路。
  if (preset.group && st.actors.length) {
    const heads = st.actors.map((a) => {
      const p = actorPositionAt(a, timeSec, shot.duration);
      return [p[0], 1.45, p[1]] as [number, number, number];
    });
    s = ensureGroupFraming(preLos, s, heads, envForShot, Math.max(0.5, cam.aspect || 1.6));
  }
  cam.position.set(...s.pos);
  cam.lookAt(...s.lookAt);
  if (cam.fov !== s.fov) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld();
}

/** Canvas 内组件：镜头×风格队列驱动相机 + 录制 + 产物下载。 */
export function CameraPathPlayer({ env }: { env: SceneEnvelope }) {
  const queue = useCineStore((s) => s.queue);
  const queueIdx = useCineStore((s) => s.queueIdx);
  const { gl, scene, camera, controls, invalidate } = useThree();
  const envRef = useRef(env);
  envRef.current = env;
  // 整队共享：用户视角备份 + 批次时间戳（首项建立，末项/取消时使用）
  const savedRef = useRef<{
    pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; target: THREE.Vector3 | null;
  } | null>(null);
  const stampRef = useRef("");

  useEffect(() => {
    if (!queue) return;
    const item = queue[queueIdx];
    const preset = item ? getCinePreset(item.shot.presetId) : undefined;
    if (!item || !preset) { useCineStore.getState()._finish(); return; }
    const isFirst = queueIdx === 0;
    const isLast = queueIdx === queue.length - 1;
    const cam = camera as THREE.PerspectiveCamera;
    const ctl = controls as unknown as { enabled: boolean; target: THREE.Vector3; update: () => void } | null;

    // ── 首项：备份用户视角 + 建批次时间戳，整队期间禁用轨道控制 ──
    if (isFirst) {
      savedRef.current = {
        pos: cam.position.clone(),
        quat: cam.quaternion.clone(),
        fov: cam.fov,
        target: ctl ? ctl.target.clone() : null,
      };
      stampRef.current = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    }
    if (ctl) ctl.enabled = false;

    const restore = () => {
      const saved = savedRef.current;
      if (!saved) return;
      cam.position.copy(saved.pos);
      cam.quaternion.copy(saved.quat);
      if (cam.fov !== saved.fov) { cam.fov = saved.fov; cam.updateProjectionMatrix(); }
      if (ctl) {
        if (saved.target) ctl.target.copy(saved.target);
        ctl.enabled = true;
        ctl.update();
      }
      savedRef.current = null;
      invalidate();
    };

    const applySample = (t: number) => {
      const timeSec = t * item.shot.duration;
      applyShotCamera(cam, item.shot, timeSec, envRef.current, scene);
      cinePlayhead.t = t;
      cinePlayhead.timeSec = timeSec;
      cinePlayhead.shotDuration = item.shot.duration;
      cinePlayhead.shotId = item.shot.id;
      cinePlayhead.active = true;
    };

    // ── 风格覆盖（白模/深度）——本项全程生效，结束/取消还原 ──
    const restoreStyle = applyStyle(scene, item.style, envRef.current);

    // ── 本项录制 ──
    const { mime, ext } = pickMime();
    const stream = gl.domElement.captureStream(30);
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    let cancelled = false;
    let rafId = 0;
    // 队列是 shot-major 展开（每镜连续 stylesPerShot 项）→ 镜号 = idx / 每镜项数
    const stylesPerShot = queue.filter((q) => q.shot.id === queue[0].shot.id).length;
    const no = String(Math.floor(queueIdx / stylesPerShot) + 1).padStart(2, "0");
    const base = `zhuya_${stampRef.current}_${no}-${preset.id}${STYLE_SUFFIX[item.style]}`;
    const files = { video: `${base}.${ext}`, first: `${base}_first.png`, last: `${base}_last.png` };

    recorder.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop());
      if (!cancelled && chunks.length) {
        downloadBlob(new Blob(chunks, { type: mime || "video/webm" }), files.video);
      }
    };

    /** 末项收尾：附 storyboard.json（分镜批拍才有）→ 还原视角 → 归位 */
    const finishAll = () => {
      const st = useCineStore.getState();
      if (st.batch) {
        const stylesUsed = st.styles;
        const meta = {
          tool: "zhuya-cinematic",
          version: 4,
          createdAt: new Date().toISOString(),
          scene: envRef.current,
          fps: 30,
          styles: stylesUsed,
          // 场景默认灯光（新镜继承；缺省 = 白天）
          sceneLighting: resolveShotLightingId(undefined, st.sceneLightingId),
          // 导演风格预设（附加字段，版本仍为 4）：选中的风格 id + 中文名；
          // 未选时为 null。下游按此还原机位/灯光默认值。
          directorStyle: st.directorStyleId
            ? { id: st.directorStyleId, name: getDirectorStyle(st.directorStyleId)?.labelZh ?? st.directorStyleId }
            : null,
          // 声音（Part 3，附加字段，版本仍为 4）：音效是 WebAudio 合成的，
          // 只在拍摄模拟里响，不进导出文件；配乐不捆绑音频，每镜只给推荐
          // （去哪里下 + 许可证），用户按推荐下载后配进成片。
          sound: {
            sfx: "WebAudio synthesized in shoot simulation only (no audio files bundled)",
            musicNote: "Music is not bundled — download per-shot recommendation from its source and check the license before use",
          },
          // 剧本（Part 4，附加字段，版本仍为 4）：剧本正文非空时附场次摘要
          // （场次号/地点/日夜/内外/片场/行数）；每镜的台词与剧本来源见 shots。
          ...(st.scriptText.trim()
            ? {
                script: {
                  scenes: parseScript(st.scriptText).scenes.map((sc) => ({
                    scene: sc.number,
                    location: sc.location,
                    timeOfDay: sc.timeOfDay ?? null,
                    interior: sc.interior ?? null,
                    setId: st.scriptSetOverrides[sc.number] ?? sc.setId ?? null,
                    lines: sc.lines.length,
                  })),
                },
              }
            : {}),
          // 导演台 v4：演员带名字/角色/朝向/默认动作 + 走位时间轴 + 动作时间轴；
          // 打斗编舞（phrases/beats/reset/安全）与特技道具单列。
          // v4 字段全部保留——旧存档（无 waypoints/timeline/fights/stuntProps）
          // 按默认值解析，绝不因升级丢数据。
          // 角色库（characters.ts）：archetypeId/costumeId/costume 随演员导出；
          // 旧存档（无服装字段）导出时 costumeId 为解析后的默认素体 "default"。
          actors: st.actors.map((a, i) => ({
            id: a.id,
            name: actorDisplayName(a, i),
            role: a.role ?? "",
            archetypeId: a.archetypeId ?? null,
            archetype: resolveActorArchetype(a)?.nameZh ?? "",
            costumeId: resolveActorCostume(a).id,
            costume: resolveActorCostume(a).labelZh,
            from: a.from,
            to: a.to,
            facing: actorFacing(a),
            action: actorAction(a),
            waypoints: a.waypoints ?? [],
            timeline: a.timeline ?? [],
          })),
          fights: st.fights.map((f) => ({
            id: f.id,
            name: f.name,
            shotId: f.shotId,
            attackerId: f.attackerId,
            defenderId: f.defenderId,
            duration: fightDuration(f),
            safety: f.safety,
            phrases: f.phrases.map((p) => ({
              id: p.id,
              reset: p.reset ?? 1.0,
              beats: p.beats.map((b) => ({
                id: b.id,
                move: b.move,
                attackerId: b.attackerId ?? f.attackerId,
                defenderId: b.defenderId ?? f.defenderId,
                duration: b.duration,
                reaction: b.reaction ?? "",
                camera: b.camera ?? "cheat",
              })),
            })),
          })),
          stuntProps: st.stuntProps.map((p) => ({
            id: p.id,
            kind: p.kind,
            name: stuntPropDef(p.kind)?.nameZh ?? p.kind,
            x: p.x,
            z: p.z,
            rotation: p.rotation ?? 0,
            scale: p.scale ?? 1,
          })),
          shots: st.shots.map((s, i) => {
            const p = getCinePreset(s.presetId)!;
            const n = String(i + 1).padStart(2, "0");
            const filesByStyle = Object.fromEntries(
              stylesUsed.map((sty) => {
                const b = `zhuya_${stampRef.current}_${n}-${p.id}${STYLE_SUFFIX[sty]}`;
                return [sty, { video: `${b}.${ext}`, first: `${b}_first.png`, last: `${b}_last.png` }];
              }),
            );
            const targetIdx = st.actors.findIndex((a) => a.id === s.targetActorId);
            const target = targetIdx >= 0 ? st.actors[targetIdx] : st.actors[0];
            return {
              index: i + 1,
              preset: p.id,
              name: p.nameZh,
              indoor: !!p.indoor,
              duration: s.duration,
              prompt: s.prompt,
              // 剧本来源（Part 4，附加字段；手工镜无此字段）：台词 + 角色 +
              // 场次号 + 来源行 + 动作，随控制包一起给下游 AI 视频模型。
              ...(s.dialogue ? { dialogue: s.dialogue } : {}),
              ...(s.scriptCharacter ? { scriptCharacter: s.scriptCharacter } : {}),
              ...(s.scriptScene !== undefined ? { scriptScene: s.scriptScene } : {}),
              ...(s.scriptLine ? { scriptLine: s.scriptLine } : {}),
              ...(s.scriptAction ? { scriptAction: s.scriptAction } : {}),
              // 本镜灯光（缺省 = 跟随场景默认；控制包下游按此还原光线）
              lighting: resolveShotLightingId(s.lightingId, st.sceneLightingId),
              lightingName: resolveLightingPreset(resolveShotLightingId(s.lightingId, st.sceneLightingId)).nameZh,
              // 本镜配乐推荐（显式 mood 优先，否则按打斗/动作/灯光推断；
              // 只给推荐 + 来源 + 许可，不捆绑音频，见 soundLibrary.ts）
              music: (() => {
                const m = suggestMusicForShot(shotMusicInput(s, st.sceneLightingId, st.fights, st.actors));
                return {
                  mood: m.mood,
                  name: m.nameZh,
                  nameEn: m.nameEn,
                  instrument: m.instrumentZh,
                  feel: m.feelZh,
                  source: m.source.name,
                  sourceUrl: m.source.url,
                  license: m.source.license,
                  searchHint: m.searchHintZh,
                  ...(m.exampleTrack ? { exampleTrack: `${m.exampleTrack.title} — ${m.exampleTrack.artist}` } : {}),
                };
              })(),
              targetActorId: p.group ? null : target?.id ?? null,
              targetActorName: p.group ? "全部演员" : (target ? actorDisplayName(target, targetIdx >= 0 ? targetIdx : 0) : null),
              // 本镜在场的角色（MVP：场景里全部演员都在场，镜头框住 target）
              characters: st.actors.map((a, ai) => ({
                id: a.id,
                name: actorDisplayName(a, ai),
                role: a.role ?? "",
                archetypeId: a.archetypeId ?? null,
                costumeId: resolveActorCostume(a).id,
                action: actorAction(a),
              })),
              // 本镜的打斗编舞 id（无则 null）
              fights: st.fights.filter((f) => f.shotId === s.id).map((f) => f.id),
              files: filesByStyle,
            };
          }),
        };
        downloadBlob(
          new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" }),
          `zhuya_${stampRef.current}_storyboard.json`,
        );
      }
      cinePlayhead.active = false;
      restoreStyle();
      restore();
      st._finish();
    };

    // ── 播放循环 ──
    let lastPct = -1;
    const durMs = item.shot.duration * 1000;
    const t0 = performance.now();

    const run = async () => {
      applySample(0);
      const first = await captureFramePNG(gl, scene, camera);
      if (first.blob && !cancelled) downloadBlob(first.blob, files.first);
      // 实景首帧留在内存：给「逐镜成片」当输入图（needsImage 工作流）
      if (item.style === "beauty" && !cancelled) {
        useCineStore.getState()._setTake(item.shot.id, first.dataUrl);
      }
      if (cancelled) return;
      recorder.start();

      const tick = async (now: number) => {
        if (cancelled) return;
        const t = Math.min(1, (now - t0) / durMs);
        applySample(t);
        invalidate();
        const pct = Math.round(t * 100);
        if (pct !== lastPct) { lastPct = pct; useCineStore.getState()._setProgress(pct); }
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          const last = await captureFramePNG(gl, scene, camera);
          if (last.blob && !cancelled) downloadBlob(last.blob, files.last);
          if (recorder.state !== "inactive") recorder.stop();
          if (cancelled) return;
          if (isLast) finishAll();
          else { restoreStyle(); useCineStore.getState()._advance(); }
        }
      };
      rafId = requestAnimationFrame(tick);
    };
    void run();

    return () => {
      // 两种触发：① 用户取消（queue 已置 null → 还原风格+视角）
      //          ② 队列推进（queue 还在 → 本项已在 advance 前还原过风格）
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (recorder.state !== "inactive") recorder.stop();
      if (!useCineStore.getState().queue) {
        cinePlayhead.active = false;
        restoreStyle();
        restore();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, queueIdx]);

  return null;
}

/** Canvas 内组件：拍摄模拟（previs 回放，不是视频导出）。
 *  按分镜顺序播：每镜机位移到该镜预设，演员走走位时间轴 + 动作时间轴 +
 *  打斗编舞，播完本镜时长切下一镜。播放/暂停/ scrub 由面板控制
 *  （store.sim 节流状态 + 模块级 simClock 逐帧时钟）。
 *  开始时备份用户视角并禁用轨道控制，停止时还原。 */
export function SimPlayer() {
  const sim = useCineStore((s) => s.sim);
  const { camera, controls, invalidate, scene } = useThree();
  const savedRef = useRef<{
    pos: THREE.Vector3; quat: THREE.Quaternion; fov: number; target: THREE.Vector3 | null;
  } | null>(null);
  const envRef = useRef<SceneEnvelope>({ W: 12, D: 10, floors: 1 });
  const lastTickRef = useRef(-1);
  // 经 ref 间接取相机/轨道控制：直接改 useThree 返回值会触发
  // react-hooks/immutability lint（CameraPathPlayer 已有同类报错，不再新增）。
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<{ enabled: boolean; target: THREE.Vector3; update: () => void } | null>(null);
  useEffect(() => {
    cameraRef.current = camera as THREE.PerspectiveCamera;
    controlsRef.current = controls as unknown as { enabled: boolean; target: THREE.Vector3; update: () => void } | null;
  }, [camera, controls]);

  useEffect(() => {
    const cam = cameraRef.current;
    const ctl = controlsRef.current;
    if (!cam) return;
    if (sim?.active) {
      savedRef.current = {
        pos: cam.position.clone(),
        quat: cam.quaternion.clone(),
        fov: cam.fov,
        target: ctl ? ctl.target.clone() : null,
      };
      if (ctl) ctl.enabled = false;
      envRef.current = envelopeFromStore();
      lastTickRef.current = -1;
    } else if (savedRef.current) {
      const saved = savedRef.current;
      cam.position.copy(saved.pos);
      cam.quaternion.copy(saved.quat);
      if (cam.fov !== saved.fov) { cam.fov = saved.fov; cam.updateProjectionMatrix(); }
      if (ctl) {
        if (saved.target) ctl.target.copy(saved.target);
        ctl.enabled = true;
        ctl.update();
      }
      savedRef.current = null;
      invalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim?.active]);

  useFrame((_, delta) => {
    if (!sim?.active) return;
    const st = useCineStore.getState();
    if (sim.playing) {
      const shot = st.shots[simClock.shotIdx];
      if (!shot) { st.stopSim(); return; }
      const prevT = simClock.timeSec;
      simClock.timeSec += Math.min(delta, 0.1); // 掉帧时不跳太远
      if (simClock.timeSec >= shot.duration) {
        if (simClock.shotIdx + 1 >= st.shots.length) {
          st.stopSim();
          return;
        }
        simClock.shotIdx += 1;
        simClock.timeSec = 0;
        const next = st.shots[simClock.shotIdx];
        simClock.shotDuration = next.duration;
        simClock.shotId = next.id;
      }
      // 节流同步到 store（UI 用）：每 0.1s 或换镜时
      const tick = Math.floor(simClock.timeSec * 10);
      if (tick !== lastTickRef.current || simClock.shotIdx !== st.sim?.shotIdx) {
        lastTickRef.current = tick;
        st.setSim({ shotIdx: simClock.shotIdx, timeSec: simClock.timeSec });
      }
      // 音效：按 (prevT, curT] 时间窗算该响的（段开始/beat 开始/脚步步频），
      // 开关关时只推进游标、不发声——重开时不补响一串。
      // collectDueSounds 内部处理换镜/scrub 跳播（静默重置），绝不抛错。
      const curShot = st.shots[simClock.shotIdx];
      if (curShot) {
        const due = collectDueSounds({
          shotId: curShot.id,
          shotDuration: curShot.duration,
          actors: st.actors,
          fights: st.fights,
          targetActorId: curShot.targetActorId,
          prevT,
          curT: simClock.timeSec,
          cursor: simSfxCursor,
        });
        if (st.soundOn) {
          for (const id of due) playSoundEffect(id);
        }
      }
    }
    const shot = st.shots[simClock.shotIdx];
    if (shot) {
      applyShotCamera(camera as THREE.PerspectiveCamera, shot, simClock.timeSec, envRef.current, scene);
      invalidate();
    }
  });

  return null;
}

/** 路点编号标牌（CanvasTexture，缓存复用） */
const wpLabelCache = new Map<number, THREE.CanvasTexture>();
function waypointLabelTex(n: number): THREE.CanvasTexture {
  const cached = wpLabelCache.get(n);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2dd4bf";
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#0f172a";
  g.font = "bold 64px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(n), 64, 68);
  const tex = new THREE.CanvasTexture(c);
  wpLabelCache.set(n, tex);
  return tex;
}

/** 服装配件（程序化几何，见 characters.ts 的 CostumeDef.accessory）。
 *  全部是小几何体，不导入模型文件；位置按方块人尺寸定（头顶 y≈1.52，
 *  胸前 z≈+0.21 为正面，背后 z≈-0.26）。 */
function CostumeAccessoryMesh({ costume }: { costume: CostumeDef }) {
  const c = costume.accessoryColor ?? costume.colors.torso;
  const mat = (color: string) => <meshStandardMaterial color={color} roughness={0.85} />;
  switch (costume.accessory) {
    case "none":
      return null;
    case "tie":
      return (
        <mesh position={[0, 1.02, 0.215]} castShadow>
          <boxGeometry args={[0.09, 0.5, 0.02]} />
          {mat(c)}
        </mesh>
      );
    case "cap":
      return (
        <group>
          <mesh position={[0, 1.66, 0]} castShadow>
            <cylinderGeometry args={[0.19, 0.19, 0.07, 16]} />
            {mat(c)}
          </mesh>
          <mesh position={[0, 1.63, 0.17]}>
            <boxGeometry args={[0.22, 0.02, 0.14]} />
            {mat(c)}
          </mesh>
        </group>
      );
    case "strawHat":
      return (
        <mesh position={[0, 1.66, 0]} castShadow>
          <coneGeometry args={[0.34, 0.14, 16]} />
          {mat(c)}
        </mesh>
      );
    case "crown":
      return (
        <group>
          <mesh position={[0, 1.68, 0]} castShadow>
            <cylinderGeometry args={[0.13, 0.13, 0.1, 12]} />
            {mat(c)}
          </mesh>
          {[-0.08, 0, 0.08].map((x) => (
            <mesh key={x} position={[x, 1.76, 0]}>
              <sphereGeometry args={[0.035, 8, 8]} />
              {mat(c)}
            </mesh>
          ))}
        </group>
      );
    case "chefHat":
      return (
        <group>
          <mesh position={[0, 1.7, 0]} castShadow>
            <cylinderGeometry args={[0.15, 0.15, 0.2, 12]} />
            {mat(c)}
          </mesh>
          <mesh position={[0, 1.79, 0]}>
            <cylinderGeometry args={[0.17, 0.15, 0.08, 12]} />
            {mat(c)}
          </mesh>
        </group>
      );
    case "helmet":
      return (
        <mesh position={[0, 1.56, 0]} scale={[1, 0.75, 1]} castShadow>
          <sphereGeometry args={[0.2, 16, 12]} />
          {mat(c)}
        </mesh>
      );
    case "sword":
      return (
        <group>
          <mesh position={[-0.3, 0.62, 0.08]} rotation={[0, 0, 0.5]} castShadow>
            <boxGeometry args={[0.05, 0.75, 0.02]} />
            {mat(c)}
          </mesh>
          <mesh position={[-0.3, 0.95, 0.08]} rotation={[0, 0, 0.5]}>
            <boxGeometry args={[0.14, 0.03, 0.03]} />
            {mat(c)}
          </mesh>
        </group>
      );
    case "apron":
      return (
        <mesh position={[0, 0.72, 0.21]} castShadow>
          <boxGeometry args={[0.36, 0.72, 0.03]} />
          {mat(c)}
        </mesh>
      );
    case "backpack":
      return (
        <mesh position={[0, 0.95, -0.26]} castShadow>
          <boxGeometry args={[0.36, 0.48, 0.14]} />
          {mat(c)}
        </mesh>
      );
    case "headband":
      return (
        <mesh position={[0, 1.56, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.175, 0.025, 8, 20]} />
          {mat(c)}
        </mesh>
      );
    case "badge":
      return (
        <mesh position={[0.1, 1.08, 0.21]}>
          <boxGeometry args={[0.09, 0.11, 0.02]} />
          {mat(c)}
        </mesh>
      );
    default:
      return null;
  }
}

/** Canvas 内组件：演员放置（地面点两下：起点→终点）+ 渲染 + 播放时表演。
 *  拖拽调整：按住演员拖动，from/to 一起平移（期间禁用轨道控制，松手恢复）。
 *  轴线：前两位演员起点连线（180 度轴线，橙色虚线 + "轴线"标牌）。
 *  动作系统：每帧用 actorStateAt（走位时间轴 + 动作时间轴 + 高度）算姿态，
 *  本镜有打斗编舞时参与者改用 evaluateFightState；手臂/飞行载具/威亚
 *  按当前段切换。路点模式点地面加路点，拖路点标牌移动它。 */
export function ActorsLayer() {
  const actors = useCineStore((s) => s.actors);
  const cineQueue = useCineStore((s) => s.queue);
  const cineSim = useCineStore((s) => s.sim);
  // 编辑器覆盖层（轴线、走位路径、路点编号标牌）只在编辑时显示：
  // 录制/导出与拍摄模拟是成片，所见即所得——标牌是 depthTest=false
  // 的精灵，会穿透家具画在画面正中（路点 "5" 曾污染故事板首帧）。
  // 队列/模拟播放中拖拽不可用，藏起来没有功能损失；模拟暂停时是
  // 编辑态——路径和标牌要留着，演员/路点就是这时候拖的。
  const hideOverlays = !!cineQueue || (cineSim?.active && cineSim.playing);
  const addMode = useCineStore((s) => s.addActorMode);
  const pendingFrom = useCineStore((s) => s.pendingFrom);
  const waypointMode = useCineStore((s) => s.waypointMode);
  const propPlaceKind = useCineStore((s) => s.propPlaceKind);
  const stuntProps = useCineStore((s) => s.stuntProps);
  const groupRefs = useRef(new Map<string, THREE.Group>());
  const armRefs = useRef(new Map<string, { l: THREE.Group | null; r: THREE.Group | null }>());
  const vehicleRefs = useRef(new Map<string, { sword: THREE.Group | null; broom: THREE.Group | null; flyboard: THREE.Group | null; wire: THREE.Group | null }>());
  const { invalidate, controls } = useThree();
  // 拖拽时禁用轨道控制：经 ref 间接改 enabled（直接改 useThree 返回值会
  // 触发 react-hooks/immutability lint；本文件旧代码已有同类报错，不再新增）。
  const controlsRef = useRef<typeof controls | null>(null);
  useEffect(() => { controlsRef.current = controls; }, [controls]);
  const setControlsEnabled = (v: boolean) => {
    const ctl = controlsRef.current as unknown as { enabled: boolean } | null;
    if (ctl) ctl.enabled = v;
  };
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragRef = useRef<{
    kind: "actor" | "waypoint";
    id: string;
    wpIdx?: number;
    start: [number, number];
    origFrom: [number, number];
    origTo: [number, number];
    origWp?: Waypoint;
  } | null>(null);

  // 轴线标牌（CanvasTexture 精灵，离线可用，不依赖在线字体）
  const axisLabelTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 96;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgba(20,22,32,0.88)";
    g.fillRect(8, 16, 240, 64);
    g.strokeStyle = "#f59e0b";
    g.lineWidth = 4;
    g.strokeRect(8, 16, 240, 64);
    g.fillStyle = "#fbbf24";
    g.font = "bold 40px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("轴 线", 128, 50);
    return new THREE.CanvasTexture(c);
  }, []);
  useEffect(() => () => axisLabelTex.dispose(), [axisLabelTex]);

  const endDrag = () => {
    setControlsEnabled(true);
    dragRef.current = null;
    setDraggingId(null);
  };
  // 指针在画布外松开也要结束拖拽
  useEffect(() => {
    if (!draggingId) return;
    const up = () => endDrag();
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingId]);

  // Esc 取消放置
  useEffect(() => {
    if (!addMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") useCineStore.getState().cancelAddActor(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addMode]);

  // 动作系统：每帧按镜内时间算每个演员的状态（走位时间轴 + 动作时间轴 +
  // 高度 + 姿态），本镜有打斗编舞时参与者改用编舞状态。
  // 时间源：拍摄模拟优先，其次录制播放头，否则静止（t=0）。
  // frameloop=demand 下由录制循环 / 模拟循环的 invalidate 带动。
  useFrame(() => {
    const st = useCineStore.getState();
    const list = st.actors;
    let timeSec = 0, shotDuration = 8, shotId: string | null = null;
    if (simClock.active) {
      timeSec = simClock.timeSec; shotDuration = simClock.shotDuration; shotId = simClock.shotId;
    } else if (cinePlayhead.active) {
      timeSec = cinePlayhead.timeSec; shotDuration = cinePlayhead.shotDuration; shotId = cinePlayhead.shotId;
    }
    const playing = simClock.active ? simClock.playing : cinePlayhead.active;
    // 本镜的打斗编舞：参与者状态覆盖时间轴
    const fight = shotId ? st.fights.find((f) => f.shotId === shotId) : undefined;
    const fightStates = new Map<string, { x: number; z: number; elev: number; facing: number; pose: import("@/lib/actions").Pose; action: ActionId }>();
    if (fight && playing) {
      const atk = list.find((a) => a.id === fight.attackerId);
      const def = list.find((a) => a.id === fight.defenderId);
      if (atk && def) {
        const atkBase = actorStateAt(atk, 0, shotDuration);
        const defBase = actorStateAt(def, 0, shotDuration);
        const fs = evaluateFightState(fight, timeSec, [atkBase.x, atkBase.z, atkBase.elev], [defBase.x, defBase.z, defBase.elev]);
        if (fs.active) {
          fightStates.set(atk.id, fs.attacker);
          fightStates.set(def.id, fs.defender);
        }
      }
    }
    for (const a of list) {
      const g = groupRefs.current.get(a.id);
      if (!g) continue;
      const fs = fightStates.get(a.id);
      const state = fs ?? actorStateAt(a, timeSec, shotDuration);
      // 编辑器静止预览：单次姿态（坐/蹲/躺/躲藏…）在 t=0 时还是起始态，
      // 点了姿势按钮也看不出变化；静止时取末态，点了立刻可见。
      // 模拟/播放/导出走真实时间，不受影响（poseFor 本身不动）。
      let pose = state.pose;
      if (!fs && !simClock.active && !cinePlayhead.active && !actionDef(state.action).loop) {
        const d = actionDef(state.action).duration;
        pose = poseFor(state.action, d, d);
      }
      // 高度 = 走位/跳跃/飞行高度 + 姿态偏移（坐下/蹲/躺是负偏移）
      g.position.set(state.x, state.elev + pose.y, state.z);
      g.rotation.set(pose.rotX, state.facing, pose.rotZ);
      // 手臂（肩部为支点）
      const arms = armRefs.current.get(a.id);
      if (arms) {
        if (arms.l) arms.l.rotation.set(pose.armL[0], 0, pose.armL[1]);
        if (arms.r) arms.r.rotation.set(pose.armR[0], 0, pose.armR[1]);
      }
      // 飞行载具 / 威亚：按当前段的道具切换（静止时按默认动作）
      const seg = segmentAt(a, timeSec);
      const pk = seg?.propKind ?? STUNT_ACTION_PROPS[state.action]?.prop ?? null;
      const veh = vehicleRefs.current.get(a.id);
      if (veh) {
        if (veh.sword) veh.sword.visible = pk === "sword";
        if (veh.broom) veh.broom.visible = pk === "broom";
        if (veh.flyboard) veh.flyboard.visible = pk === "flyboard";
        if (veh.wire) veh.wire.visible = state.action === "wireFly";
      }
    }
  });

  return (
    <>
      <SimPlayer />
      {/* 放置模式：铺一张接收点击的地面（加演员 / 加路点 / 放特技道具三用） */}
      {(addMode || waypointMode || propPlaceKind) && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
          onPointerDown={(e) => {
            e.stopPropagation();
            const st = useCineStore.getState();
            if (st.addActorMode) st.placePoint([e.point.x, e.point.z]);
            else if (st.waypointMode) st.addWaypoint(st.waypointMode, [e.point.x, e.point.z]);
            else if (st.propPlaceKind) st.placeStuntProp([e.point.x, e.point.z]);
            invalidate();
          }}
        >
          <planeGeometry args={[500, 500]} />
          <meshBasicMaterial transparent opacity={0.06} color="#2dd4bf" depthWrite={false} />
        </mesh>
      )}
      {/* 拖拽中：铺一张接住指针移动的地面（演员 from/to 平移 或 路点移动） */}
      {draggingId && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            e.stopPropagation();
            const dx = e.point.x - d.start[0];
            const dz = e.point.z - d.start[1];
            if (d.kind === "actor") {
              // 拖拽也钳在房子里（无声钳制：标牌贴墙停住即是反馈）
              const from = clampPointToFootprint([d.origFrom[0] + dx, d.origFrom[1] + dz]).point;
              const to = clampPointToFootprint([d.origTo[0] + dx, d.origTo[1] + dz]).point;
              useCineStore.getState().updateActor(d.id, { from, to });
            } else if (d.kind === "waypoint" && d.origWp && d.wpIdx !== undefined) {
              const pt = clampPointToFootprint([d.origWp.x + dx, d.origWp.z + dz]).point;
              useCineStore.getState().updateWaypoint(d.id, d.wpIdx, { x: pt[0], z: pt[1] });
            }
            invalidate();
          }}
          onPointerUp={() => endDrag()}
        >
          <planeGeometry args={[500, 500]} />
          <meshBasicMaterial transparent opacity={0.04} color="#2dd4bf" depthWrite={false} />
        </mesh>
      )}
      {/* 起点已定，等终点 */}
      {pendingFrom && (
        <mesh position={[pendingFrom[0], 0.06, pendingFrom[1]]}>
          <cylinderGeometry args={[0.28, 0.28, 0.1, 16]} />
          <meshBasicMaterial color="#2dd4bf" />
        </mesh>
      )}
      {/* 180 度轴线：前两位演员起点连线 + 标牌（分镜越轴警告的基准） */}
      {actors.length >= 2 && !hideOverlays && (
        <group>
          <Line
            points={[[actors[0].from[0], 0.06, actors[0].from[1]], [actors[1].from[0], 0.06, actors[1].from[1]]]}
            color="#f59e0b" dashed dashSize={0.3} gapSize={0.2} lineWidth={1.5}
          />
          <sprite
            position={[
              (actors[0].from[0] + actors[1].from[0]) / 2,
              0.55,
              (actors[0].from[1] + actors[1].from[1]) / 2,
            ]}
            scale={[1.4, 0.55, 1]}
          >
            <spriteMaterial map={axisLabelTex} transparent depthTest={false} />
          </sprite>
        </group>
      )}
      {/* 特技道具（程序化几何） */}
      {stuntProps.map((p) => (
        <StuntPropMesh key={p.id} prop={p} />
      ))}
      {actors.map((a) => {
        const wps = (a.waypoints ?? []).slice().sort((x, y) => x.t - y.t);
        const hasWps = wps.length >= 2;
        // 服装：按演员的 archetypeId/costumeId 解析；旧存档（无服装字段）
        // 与未知 id 一律回落默认素体（与 MVP 旧方块人同色）。
        const costume = resolveActorCostume(a);
        const torsoColor = costume.id === "default" && actorAction(a) === "fight" ? "#e07856" : costume.colors.torso;
        return (
          <group key={a.id}>
            {/* 走位路径：有路点画路点连线 + 编号标牌；没有则画旧的 from→to 虚线 + 终点环 */}
            {!hideOverlays && (hasWps ? (
              <group>
                <Line
                  points={wps.map((w) => [w.x, (w.y ?? 0) + 0.05, w.z] as [number, number, number])}
                  color="#2dd4bf" dashed dashSize={0.35} gapSize={0.22} lineWidth={1.5}
                />
                {wps.map((w, i) => (
                  <sprite
                    key={i}
                    position={[w.x, (w.y ?? 0) + 0.9, w.z]}
                    scale={[0.55, 0.55, 1]}
                    onPointerDown={(e) => {
                      // 路点标牌：编路点模式里可拖；模拟暂停时也可以拖
                      // （不用先停掉整场模拟）；播放中/录制中不许拖。
                      const st = useCineStore.getState();
                      if (st.queue || (st.sim?.active && st.sim.playing)) return;
                      if (waypointMode !== a.id && !(st.sim?.active && !st.sim.playing)) return;
                      e.stopPropagation();
                      setControlsEnabled(false);
                      dragRef.current = {
                        kind: "waypoint",
                        id: a.id,
                        wpIdx: i,
                        start: [e.point.x, e.point.z],
                        origFrom: [...a.from],
                        origTo: [...a.to],
                        origWp: { ...w },
                      };
                      setDraggingId(`${a.id}:wp${i}`);
                    }}
                  >
                    <spriteMaterial map={waypointLabelTex(i + 1)} transparent depthTest={false} />
                  </sprite>
                ))}
              </group>
            ) : (
              <group>
                <Line
                  points={[[a.from[0], 0.05, a.from[1]], [a.to[0], 0.05, a.to[1]]]}
                  color="#2dd4bf" dashed dashSize={0.35} gapSize={0.22} lineWidth={1.5}
                />
                <mesh position={[a.to[0], 0.04, a.to[1]]} rotation={[-Math.PI / 2, 0, 0]}>
                  <ringGeometry args={[0.2, 0.32, 20]} />
                  <meshBasicMaterial color="#2dd4bf" side={THREE.DoubleSide} />
                </mesh>
              </group>
            ))}
            {/* 方块人：胶囊身 + 球头 + 双臂（肩部为支点）+ 服装裙摆/配件 +
                飞行载具/威亚。颜色与配件由服装库驱动（见 characters.ts）。
                按住可拖动调整走位（from/to 一起平移）。 */}
            <group
              ref={(g) => { if (g) groupRefs.current.set(a.id, g); else groupRefs.current.delete(a.id); }}
              position={[a.from[0], 0, a.from[1]]}
              onPointerDown={(e) => {
                if (addMode) return;
                // 模拟播放中 / 录制中不许拖（机位和演员都在动，拖了也对不上）；
                // 模拟暂停时可以拖——调走位不用先停掉整场模拟。
                const st = useCineStore.getState();
                if (st.queue || (st.sim?.active && st.sim.playing)) return;
                e.stopPropagation();
                setControlsEnabled(false);
                dragRef.current = {
                  kind: "actor",
                  id: a.id,
                  start: [e.point.x, e.point.z],
                  origFrom: [...a.from],
                  origTo: [...a.to],
                };
                setDraggingId(a.id);
              }}
            >
              <mesh position={[0, 0.75, 0]} castShadow>
                <capsuleGeometry args={[0.22, 0.8, 4, 12]} />
                <meshStandardMaterial color={torsoColor} roughness={0.85} />
              </mesh>
              {costume.skirt && (
                <mesh position={[0, 0.36, 0]} castShadow>
                  <cylinderGeometry args={[0.24, 0.44, 0.72, 12]} />
                  <meshStandardMaterial color={costume.colors.torso} roughness={0.85} />
                </mesh>
              )}
              <mesh position={[0, 1.52, 0]} castShadow>
                <sphereGeometry args={[0.17, 16, 12]} />
                <meshStandardMaterial color={costume.colors.skin} roughness={0.85} />
              </mesh>
              <CostumeAccessoryMesh costume={costume} />
              <group
                ref={(gr) => { const m = armRefs.current.get(a.id) ?? { l: null, r: null }; m.l = gr; armRefs.current.set(a.id, m); }}
                position={[-0.28, 1.28, 0]}
              >
                <mesh position={[0, -0.42, 0]} castShadow>
                  <capsuleGeometry args={[0.08, 0.7, 4, 8]} />
                  <meshStandardMaterial color={costume.colors.arms} roughness={0.85} />
                </mesh>
              </group>
              <group
                ref={(gr) => { const m = armRefs.current.get(a.id) ?? { l: null, r: null }; m.r = gr; armRefs.current.set(a.id, m); }}
                position={[0.28, 1.28, 0]}
              >
                <mesh position={[0, -0.42, 0]} castShadow>
                  <capsuleGeometry args={[0.08, 0.7, 4, 8]} />
                  <meshStandardMaterial color={costume.colors.arms} roughness={0.85} />
                </mesh>
              </group>
              {/* 飞行载具 / 威亚：useFrame 按当前段切换 visible（初始全藏） */}
              <group
                ref={(gr) => { const m = vehicleRefs.current.get(a.id) ?? { sword: null, broom: null, flyboard: null, wire: null }; m.sword = gr; vehicleRefs.current.set(a.id, m); }}
                visible={false}
              >
                <FlyingVehicleMesh kind="sword" />
              </group>
              <group
                ref={(gr) => { const m = vehicleRefs.current.get(a.id) ?? { sword: null, broom: null, flyboard: null, wire: null }; m.broom = gr; vehicleRefs.current.set(a.id, m); }}
                visible={false}
              >
                <FlyingVehicleMesh kind="broom" />
              </group>
              <group
                ref={(gr) => { const m = vehicleRefs.current.get(a.id) ?? { sword: null, broom: null, flyboard: null, wire: null }; m.flyboard = gr; vehicleRefs.current.set(a.id, m); }}
                visible={false}
              >
                <FlyingVehicleMesh kind="flyboard" />
              </group>
              <group
                ref={(gr) => { const m = vehicleRefs.current.get(a.id) ?? { sword: null, broom: null, flyboard: null, wire: null }; m.wire = gr; vehicleRefs.current.set(a.id, m); }}
                visible={false}
              >
                <WireMesh />
              </group>
            </group>
          </group>
        );
      })}
    </>
  );
}

/** 9:16 竖屏取景框：fixed 覆盖层，居中 9:16 安全框 + 四角标记 + 标签。
 *  pointer-events-none，不拦截画布操作；不改 HouseCanvas，面板自带。 */
function Frame916Overlay() {
  const corner: CSSProperties = { position: "absolute", width: 28, height: 28, borderColor: "#2dd4bf", borderStyle: "solid" };
  return (
    <div
      className="pointer-events-none"
      style={{ position: "fixed", inset: 0, zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        className="relative"
        style={{ aspectRatio: "9 / 16", height: "100%", maxWidth: "100%", border: "2px solid rgba(45,212,191,0.9)", boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)" }}
      >
        <div style={{ ...corner, top: -2, left: -2, borderWidth: "4px 0 0 4px" }} />
        <div style={{ ...corner, top: -2, right: -2, borderWidth: "4px 4px 0 0" }} />
        <div style={{ ...corner, bottom: -2, left: -2, borderWidth: "0 0 4px 4px" }} />
        <div style={{ ...corner, bottom: -2, right: -2, borderWidth: "0 4px 4px 0" }} />
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap"
          style={{ background: "rgba(20,22,32,0.85)", color: "#2dd4bf" }}
        >
          9:16 安全框
        </div>
      </div>
    </div>
  );
}

/** 动作分类（UI 分组用） */
const ACTION_CATEGORY_ORDER = ["move", "pose", "gesture", "fight", "stunt"] as const;
const ACTION_CATEGORY_ZH: Record<string, string> = { move: "移动", pose: "姿态", gesture: "手势", fight: "打斗", stunt: "特技" };
const ACTION_CATEGORY_EN: Record<string, string> = { move: "Move", pose: "Pose", gesture: "Gesture", fight: "Fight", stunt: "Stunt" };

/** 姿势面板：姿态类动作 + 手势类前三（挥手/指/鞠躬），由注册表驱动——
 *  注册表加新姿态/手势，这里自动出现，不用改 UI。 */
const POSE_PANEL_ACTIONS: ActionDef[] = [
  ...ACTION_LIST.filter((d) => d.category === "pose"),
  ...ACTION_LIST.filter((d) => d.category === "gesture").slice(0, 3),
];

/** 文字解析结果 → 时间轴：按演员现有时间轴的末尾续接。
 *  飞行类无目标时朝当前朝向飞 4 米、升到 2.5 米；打/踢没点名对手时
 *  取最近的其他演员并面向他；姿态动作有目标且离得远时先走过去再做。
 *  缺的特技道具自动补一个（放在目标位置）。返回给人看的一句话。 */
function applyParsedInstructions(instructions: ParsedInstruction[]): string {
  const done: string[] = [];
  const endState = (a: Actor): { time: number; pos: [number, number]; elev: number; facing: number } => {
    const segEnd = (a.timeline ?? []).reduce((m, s) => Math.max(m, s.start + s.duration), 0);
    const wpEnd = (a.waypoints ?? []).reduce((m, w) => Math.max(m, w.t), 0);
    const t = Math.max(segEnd, wpEnd);
    const s = actorStateAt(a, t, Math.max(8, t + 1));
    return { time: t, pos: [s.x, s.z], elev: s.elev, facing: s.facing };
  };
  const isMove = (action: ActionId): boolean =>
    ["walk", "run", "jump", "climb", "leap", "flySword", "flyBroom", "wireFly", "rappel", "swim"].includes(action);
  for (const ins of instructions) {
    // 关键：每条指令都重读 store——上条指令刚加的时间轴段必须对下条可见。
    // 旧代码用函数开头快照的 st：处理"坐下"时 endState 还看不到"走到窗边"
    // 刚加的 walk 段，以为演员还在起点，于是又补一段一模一样的 walk
    // （"男主走到窗边坐下" → [walk, walk, sit] 的根因）。
    const cur = useCineStore.getState();
    const a = cur.actors.find((x) => x.id === ins.actorId);
    if (!a) continue;
    const end = endState(a);
    // 1) 特技道具：缺的自动补一个；飞行载具随人走，已有同类就挂上去
    let propId: string | undefined;
    if (ins.needProp) {
      const px = ins.targetPos?.[0] ?? end.pos[0] + 1.5;
      const pz = ins.targetPos?.[1] ?? end.pos[1];
      propId = cur.addStuntProp(ins.needProp, px, pz).id;
    } else if (ins.propKind) {
      propId = cur.stuntProps.find((p) => p.kind === ins.propKind)?.id;
    }
    // 2) 目标：飞行类无目标 → 朝当前朝向飞 4 米、升到 2.5 米
    let targetPos = ins.targetPos;
    let targetY = ins.targetY;
    if ((ins.action === "flySword" || ins.action === "flyBroom" || ins.action === "wireFly") && !targetPos) {
      targetPos = [end.pos[0] + Math.sin(end.facing) * 4, end.pos[1] + Math.cos(end.facing) * 4];
      targetY = 2.5;
    }
    // 3) 打/踢：对手缺省为最近的其他演员，并面向他
    let targetActorId = ins.targetActorId;
    let facing = ins.facing;
    if ((ins.action === "punch" || ins.action === "kick") && !targetActorId) {
      let best: Actor | null = null, bd = Infinity;
      for (const o of cur.actors) {
        if (o.id === a.id) continue;
        const os = endState(o);
        const d = (os.pos[0] - end.pos[0]) ** 2 + (os.pos[1] - end.pos[1]) ** 2;
        if (d < bd) { bd = d; best = o; }
      }
      if (best) {
        targetActorId = best.id;
        const bs = endState(best);
        facing = Math.atan2(bs.pos[0] - end.pos[0], bs.pos[1] - end.pos[1]);
      }
    }
    if (ins.action === "turn" && targetPos) {
      facing = Math.atan2(targetPos[0] - end.pos[0], targetPos[1] - end.pos[1]);
    }
    const start = end.time;
    const segs: ActionSegment[] = [];
    if (isMove(ins.action) && targetPos) {
      const dist = Math.hypot(targetPos[0] - end.pos[0], targetPos[1] - end.pos[1]);
      const speed = ins.action === "run" ? 3 : ins.action === "walk" ? 1.2 : 2;
      const dur = ins.action === "flySword" || ins.action === "flyBroom" || ins.action === "wireFly"
        ? 4
        : Math.max(1, dist / speed);
      segs.push(makeSegment(ins.action, start, {
        duration: dur, targetPos, targetY, arc: ins.arc, safety: ins.safety,
        propKind: ins.propKind, propId, facing, targetActorId,
      }));
    } else if (!isMove(ins.action)) {
      if (targetPos) {
        const dist = Math.hypot(targetPos[0] - end.pos[0], targetPos[1] - end.pos[1]);
        if (dist > 0.5) {
          const dur = Math.max(1, dist / 1.2);
          segs.push(makeSegment("walk", start, { duration: dur, targetPos, targetY }));
          segs.push(makeSegment(ins.action, start + dur, {
            duration: actionDef(ins.action).duration, targetY, safety: ins.safety,
            propKind: ins.propKind, propId, facing, targetActorId,
          }));
        } else {
          segs.push(makeSegment(ins.action, start, {
            duration: actionDef(ins.action).duration, targetY, safety: ins.safety,
            propKind: ins.propKind, propId, facing, targetActorId,
          }));
        }
      } else {
        segs.push(makeSegment(ins.action, start, {
          duration: actionDef(ins.action).duration, safety: ins.safety,
          propKind: ins.propKind, propId, facing, targetActorId,
        }));
      }
    }
    for (const s of segs) cur.addTimelineSegment(a.id, s);
    done.push(`${ins.actorName}${actionDef(ins.action).nameZh}`);
  }
  return done.length ? `已加入时间轴：${done.join("、")}` : "没有可加的动作";
}

/** DOM 覆盖层：🎬 入口 + 快拍 + 分镜 + 风格 + 演员 + 录制进度。 */
export function CinematicPanel({ locale = "zh" }: { locale?: string }) {
  const {
    shots, addShot, removeShot, moveShot, updateShot,
    sceneLightingId, setSceneLightingId, previewLightingId, setPreviewLightingId,
    directorStyleId, setDirectorStyleId,
    soundOn, setSoundOn,
    styles, toggleStyle,
    actors, addActorMode, pendingFrom, beginAddActor, beginReplaceActor, cancelAddActor, removeActor, updateActor, placeWarning, setPlaceWarning,
    waypointMode, beginWaypointMode, cancelWaypointMode, updateWaypoint, removeWaypoint,
    addTimelineSegment, updateTimelineSegment, removeTimelineSegment,
    fights, addFight, removeFight, updateFight, addPhrase, removePhrase, addBeat, updateBeat, removeBeat,
    stuntProps, propPlaceKind, beginPropPlace, cancelPropPlace, removeStuntProp,
    sim, startSim, stopSim, setSim,
    queue, queueIdx, progress, menuOpen,
    startQuick, startStoryboard, cancel, setMenuOpen,
    genWorkflowId, setGenWorkflowId, genRunning, genState,
    show916, toggle916,
    scriptText, setScriptText, scriptSetOverrides, setScriptSetOverride,
  } = useCineStore();
  const en = locale === "en";
  // 拍摄模拟：总时长 = 各镜时长之和（scrub 用绝对秒数）
  const simTotal = shots.reduce((m, s) => m + s.duration, 0);
  const simAbs = sim ? shots.slice(0, sim.shotIdx).reduce((m, s) => m + s.duration, 0) + sim.timeSec : 0;
  const scrubTo = (abs: number) => {
    let acc = 0;
    for (let i = 0; i < shots.length; i++) {
      if (abs <= acc + shots[i].duration || i === shots.length - 1) {
        // 跳播 = 音效游标清掉：回拨后重新播到该段时该段再响，不补响一串
        resetSimSfxCursor();
        setSim({ shotIdx: i, timeSec: Math.max(0, Math.min(shots[i].duration, abs - acc)) });
        return;
      }
      acc += shots[i].duration;
    }
  };
  // 文字催动（本地态）
  const [textInput, setTextInput] = useState("");
  const [textMsg, setTextMsg] = useState("");
  const [showPatterns, setShowPatterns] = useState(false);
  const runTextParse = () => {
    const d = useDesignerStore.getState();
    const ctx: SceneContext = {
      ...buildSceneContext(d.floorPlans, d.activeFloor),
      actors: actors.map((a) => ({ id: a.id, name: actorDisplayName(a, actors.indexOf(a)), role: a.role })),
      stuntProps: stuntProps.map((p) => ({ kind: p.kind, x: p.x, z: p.z })),
    };
    const res = parseActionText(textInput, ctx);
    if (!res.ok) {
      setTextMsg(res.message);
      return;
    }
    const applied = applyParsedInstructions(res.instructions);
    setTextMsg(`${res.message}。${applied}`);
  };
  // 剧本（本地态：解析结果 + 提示；正文与场次手动片场在 store 里持久化）
  const [parsed, setParsed] = useState<ParsedScript | null>(null);
  const [scriptMsg, setScriptMsg] = useState("");
  const scriptFileRef = useRef<HTMLInputElement | null>(null);
  const scriptAutoParsed = useRef(false);
  const buildActionCtx = (): SceneContext => {
    const d = useDesignerStore.getState();
    return {
      ...buildSceneContext(d.floorPlans, d.activeFloor),
      actors: actors.map((a) => ({ id: a.id, name: actorDisplayName(a, actors.indexOf(a)), role: a.role })),
      stuntProps: stuntProps.map((p) => ({ kind: p.kind, x: p.x, z: p.z })),
    };
  };
  const runScriptParse = (text: string) => {
    const enriched = enrichScriptActions(parseScript(text), buildActionCtx());
    setParsed(enriched);
    if (!enriched.scenes.length) {
      setScriptMsg(en ? "Script is empty — write a few lines or import a .txt file." : "剧本是空的——先写几行，或导入一个 .txt。");
      return;
    }
    const unmatched = enriched.scenes.filter((s) => !s.setId).length;
    setScriptMsg(
      en
        ? `Parsed: ${enriched.summary}.${unmatched ? ` ${unmatched} scene(s) without a matched set — pick one below.` : " Every scene matched a set."}`
        : `已拆解：${enriched.summary}。${unmatched ? `其中 ${unmatched} 场未匹配片场，可在下面手动选。` : "各场次已匹配片场。"}`,
    );
  };
  // 旧存档/刷新后：正文已持久化，进来就拆一次，不用再点解析
  useEffect(() => {
    if (!scriptAutoParsed.current && scriptText.trim()) {
      scriptAutoParsed.current = true;
      runScriptParse(scriptText);
    }
    // 只在挂载时跑一次（解析结果随正文改动失效，改完再点「解析剧本」）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const importScriptFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setScriptText(text);
      setParsed(null);
      runScriptParse(text);
    };
    reader.readAsText(file);
  };
  const generateShotsFromScript = () => {
    if (!parsed) {
      setScriptMsg(en ? "Parse the script first, then build shots." : "先点「解析剧本」，拆解没问题再生成分镜。");
      return;
    }
    const st = useCineStore.getState();
    const cast = st.actors.map((a, i) => ({ id: a.id, name: actorDisplayName(a, i), role: a.role }));
    const plans = planShotsFromScript(parsed, cast);
    if (!plans.length) {
      setScriptMsg(en ? "No lines can become shots (only dialogue/action lines do — fix the unassigned lines first)." : "这段剧本没有可成镜的行（只有台词/动作行才成镜；未认出的行先修正）。");
      return;
    }
    const created = plans.map((p) => makeShot(p.presetId, {
      targetActorId: p.targetActorId,
      lightingId: st.sceneLightingId,
      ...(p.dialogue ? { dialogue: p.dialogue } : {}),
      ...(p.character ? { scriptCharacter: p.character } : {}),
      scriptScene: p.sceneNumber,
      scriptLine: p.scriptLine,
      ...(p.actionId ? { scriptAction: p.actionId } : {}),
      prompt: p.prompt ?? "",
    }));
    st.setScriptShots(created);
    // 动作行：走「文字催动动作」同一入口上演员时间轴（走/跑/打/飞都一样），
    // 这样模拟拍摄时演员真的会演出来；重复生成会重复上轴（见提示）。
    const ctx = buildActionCtx();
    const allIns: ParsedInstruction[] = [];
    for (const p of plans) {
      if (!p.actionId) continue;
      const res = parseActionText(p.scriptLine, ctx);
      if (res.ok) allIns.push(...res.instructions);
    }
    const applied = allIns.length ? applyParsedInstructions(allIns) : "";
    const missingNames = [...new Set(plans.map((p) => p.character).filter((c): c is string => !!c))]
      .filter((name) => !cast.some((a) => a.name === name || a.name.includes(name) || (a.role ?? "").includes(name)));
    const unassigned = parsed.scenes.flatMap((s) => s.lines).filter((l) => l.kind === "unassigned").length;
    setScriptMsg(
      (en
        ? `Built ${created.length} shots (replaced shots previously built from the script; hand-made shots kept; dialogue = close-up, action = medium).`
        : `已生成 ${created.length} 镜（替换了之前由剧本生成的镜，手工镜保留；台词行=特写，动作行=中景）。`) +
      (applied ? ` ${applied}。` : "") +
      (unassigned ? (en ? ` ${unassigned} line(s) unassigned — no shot built for them.` : `另有 ${unassigned} 行未认出，未生成镜头。`) : "") +
      (missingNames.length
        ? (en ? ` Character(s) ${missingNames.map((n) => `「${n}」`).join("")} not in the cast — dialogue is saved on the shot; add a same-named actor to frame them.` : `角色${missingNames.map((n) => `「${n}」`).join("")}不在演员表里——台词已写进镜里，在「演员走位」加同名演员即可框住他。`)
        : "") +
      (en ? " Generating again re-applies actions to the timeline." : "重复点生成会重复给动作上时间轴。"),
    );
  };
  // 特技道具（本地态：选中的种类）
  const [propKind, setPropKind] = useState<StuntPropKind>("tree");
  // 音效试听（本地态：选中的音效；开关本身在 store 里持久化）
  const [previewEffect, setPreviewEffect] = useState<SoundEffectId>("punch");
  // 动作时间轴（本地态：每演员新增段的动作）
  const [newSegAction, setNewSegAction] = useState<Record<string, ActionId>>({});
  // 片场选择（本地态：刚应用的片场打 ✓；描述匹配结果文案）
  const [appliedSetId, setAppliedSetId] = useState<string | null>(null);
  const [setQuery, setSetQuery] = useState("");
  const [setMatchMsg, setSetMatchMsg] = useState("");
  const applySet = (id: string) => {
    useDesignerStore.getState().applyProjectTemplate(id);
    setAppliedSetId(id);
    setSetMatchMsg("");
  };
  const matchSetQuery = () => {
    const hit = matchProjectTemplate(setQuery);
    if (hit) {
      applySet(hit.id);
      setSetMatchMsg(en ? `Matched: ${hit.nameEn}` : `已匹配：${hit.name}`);
    } else {
      setSetMatchMsg(en ? "No set matched — try: café / office / apartment living room" : "未匹配到片场，试试：咖啡馆 / 办公室 / 公寓客厅");
    }
  };
  // 当前片场（时代锁用）：以本面板刚应用的片场为准，设计器实际加载的模板兜底。
  // 注意 activeTemplateId 是「风格模板」id（如 现代极简），不是片场 id；
  // applyProjectTemplate 会经 loadTemplate 把它设成风格模板 id，若优先用它，
  // setEra() 查不到时代记录 → 时代锁永远不警告。片场 id 只存在 appliedSetId 里。
  // 未加载任何模板时为 null → 时代锁不警告。
  const activeTemplateId = useDesignerStore((s) => s.activeTemplateId);
  const currentSetId = appliedSetId ?? activeTemplateId;
  // 新演员自动配色需要当前片场 id（时代合身用）；面板是唯一知道它的地方。
  const setCineSetId = useCineStore((s) => s.setCineSetId);
  useEffect(() => { setCineSetId(currentSetId); }, [currentSetId, setCineSetId]);
  // 当前选中的导演风格预设（null = 无预设）；下拉框可扩展到 30+ 套，不硬编码按钮。
  const directorStyle = getDirectorStyle(directorStyleId);

  // ── 演员放置提示（独立于菜单，放置时始终可见）──
  if (addActorMode) {
    return (
      <>
        {show916 && <Frame916Overlay />}
        <div
          className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs text-white shadow-xl"
          style={{ background: "rgba(20,22,32,0.88)", border: "1px solid rgba(45,212,191,0.5)" }}
        >
          <span>🚶</span>
          <span>
            {pendingFrom
              ? (en ? "Click the ground: end point" : "在地面点击：终点")
              : actors.length
                ? (en ? `Placed ${actors.length} — click twice for the next actor, or Done to finish` : `已放 ${actors.length} 位演员 — 继续点两下放下一位，或点「完成」结束`)
                : (en ? "Click the ground: start point" : "在地面点击：起点")}
          </span>
          {placeWarning && <span className="text-amber-300">⚠️ {placeWarning}</span>}
          <button onClick={cancelAddActor} className="ml-1 px-2 py-1 rounded-md hover:bg-white/10">
            {actors.length ? (en ? "Done" : "完成") : (en ? "Cancel" : "取消")}
          </button>
        </div>
      </>
    );
  }

  // ── 录制中：进度 + 取消 ──
  if (queue) {
    const item = queue[queueIdx];
    const preset = item ? getCinePreset(item.shot.presetId) : undefined;
    const styleName = item ? RENDER_STYLES.find((s) => s.id === item.style) : undefined;
    return (
      <>
        {show916 && <Frame916Overlay />}
        <div
          className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs text-white shadow-xl"
          style={{ background: "rgba(20,22,32,0.88)", border: "1px solid rgba(255,255,255,0.18)" }}
        >
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span>
            {queueIdx + 1}/{queue.length}：{en ? preset?.nameEn : preset?.nameZh}
            {item && item.style !== "beauty" && (
              <span className="text-white/50">（{en ? styleName?.nameEn : styleName?.nameZh}）</span>
            )}
          </span>
          <div className="w-32 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.15)" }}>
            <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "#2dd4bf", transition: "width 0.1s linear" }} />
          </div>
          <span className="tabular-nums w-8 text-right">{progress}%</span>
          <button onClick={cancel} className="ml-1 px-2 py-1 rounded-md hover:bg-white/10" title={en ? "Cancel" : "取消"}>
            ✕
          </button>
        </div>
      </>
    );
  }

  // ── 路点/道具放置提示（独立于菜单，放置时始终可见）──
  if (waypointMode || propPlaceKind) {
    const wpActor = waypointMode ? actors.find((a) => a.id === waypointMode) : undefined;
    return (
      <>
        {show916 && <Frame916Overlay />}
        <div
          className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs text-white shadow-xl"
          style={{ background: "rgba(20,22,32,0.88)", border: "1px solid rgba(45,212,191,0.5)" }}
        >
          <span>📍</span>
          <span>
            {waypointMode
              ? (en ? `Click the ground: add waypoint for ${wpActor ? actorDisplayName(wpActor, actors.indexOf(wpActor)) : ""} (drag a marker to move it)` : `在地面点击：给${wpActor ? actorDisplayName(wpActor, actors.indexOf(wpActor)) : "演员"}加路点（拖标牌可移动）`)
              : (en ? `Click the ground: place ${stuntPropDef(propPlaceKind!)?.nameEn ?? propPlaceKind}` : `在地面点击：放${stuntPropDef(propPlaceKind!)?.nameZh ?? propPlaceKind}`)}
          </span>
          {placeWarning && <span className="text-amber-300">⚠️ {placeWarning}</span>}
          <button onClick={() => { cancelWaypointMode(); cancelPropPlace(); }} className="ml-1 px-2 py-1 rounded-md hover:bg-white/10">
            {en ? "Cancel" : "取消"}
          </button>
        </div>
      </>
    );
  }

  // ── 拍摄模拟中：播放/暂停 + 进度条（可 scrub）+ 镜号 + 停止 ──
  if (sim?.active) {
    return (
      <>
        {show916 && <Frame916Overlay />}
        <div
          className="absolute bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs text-white shadow-xl"
          style={{ background: "rgba(20,22,32,0.88)", border: "1px solid rgba(45,212,191,0.5)" }}
        >
          <button
            onClick={() => setSim({ playing: !sim.playing })}
            className="px-2 py-1 rounded-md hover:bg-white/10 text-base leading-none"
            title={sim.playing ? (en ? "Pause" : "暂停") : (en ? "Play" : "播放")}
          >
            {sim.playing ? "⏸" : "▶"}
          </button>
          <span className="tabular-nums whitespace-nowrap">Shot {sim.shotIdx + 1}/{shots.length}</span>
          {/* 本镜灯光：模拟播放时画布正按此预设打光 */}
          {(() => {
            const cur = shots[sim.shotIdx];
            if (!cur) return null;
            const lp = resolveLightingPreset(resolveShotLightingId(cur.lightingId, sceneLightingId));
            return (
              <span className="whitespace-nowrap text-white/70" title={en ? lp.moodEn : lp.moodZh}>
                {lp.emoji} {en ? lp.nameEn : lp.nameZh}
              </span>
            );
          })()}
          {/* 本镜配乐推荐（显式 mood 优先，否则按打斗/动作/灯光推断） */}
          {(() => {
            const cur = shots[sim.shotIdx];
            if (!cur) return null;
            const m = suggestMusicForShot(shotMusicInput(cur, sceneLightingId, fights, actors));
            return (
              <span className="whitespace-nowrap text-white/70" title={en ? `${m.nameEn} · ${m.instrumentEn} · ${m.source.name} (${m.source.license})` : `${m.nameZh} · ${m.instrumentZh} · ${m.source.nameZh}（${m.source.licenseZh}）`}>
                🎵 {en ? m.nameEn : m.nameZh}
              </span>
            );
          })()}
          <button
            onClick={() => setSoundOn(!soundOn)}
            className="px-2 py-1 rounded-md hover:bg-white/10 text-base leading-none"
            style={{ color: soundOn ? undefined : "#94a3b8" }}
            title={soundOn ? (en ? "Sound effects on — click to mute" : "音效开——点一下静音") : (en ? "Sound effects off — click to enable" : "音效关——点一下打开")}
          >
            {soundOn ? "🔊" : "🔇"}
          </button>
          <input
            type="range" min={0} max={simTotal} step={0.1} value={simAbs}
            onChange={(e) => scrubTo(Number(e.target.value))}
            className="w-40 sm:w-64 accent-teal-400"
            title={en ? "Scrub the shoot" : "拖动跳转到任意镜/时间"}
          />
          <span className="tabular-nums whitespace-nowrap">{simAbs.toFixed(1)}s / {simTotal.toFixed(0)}s</span>
          <button onClick={stopSim} className="ml-1 px-2 py-1 rounded-md hover:bg-white/10" title={en ? "Stop simulation" : "停止模拟"}>
            ✕
          </button>
        </div>
      </>
    );
  }

  // ── 空闲：🎬 按钮 + 面板（左下角——右下角被页面级 AI 入口占用）──
  return (
    <>
    {show916 && <Frame916Overlay />}
    {/* 移动端抬高:样板间底部现为两条主按钮「出短片 + 打开此方案」上下叠放,
        贴 bottom-5 / bottom-20 都会重叠，抬到 bottom-40 才让得开。 */}
    <div className="absolute bottom-40 sm:bottom-5 left-4 z-50 flex flex-col items-start gap-2">
      {menuOpen && (
        <div
          className="flex flex-col gap-1 p-2 rounded-xl shadow-xl text-xs text-white w-[256px] max-h-[62vh] overflow-y-auto"
          style={{ background: "rgba(20,22,32,0.92)", border: "1px solid rgba(255,255,255,0.18)" }}
        >
          {/* 一键搭片场：点选片场即加载；或输一句描述匹配最合适的片场 */}
          <div className="px-1 pt-1 text-[10px] tracking-widest text-white/40">{en ? "SET" : "片场"}</div>
          {SCENE_SETS.map((s) => (
            <button
              key={s.id}
              onClick={() => applySet(s.id)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-white/10 text-left"
              title={en ? s.descriptionEn : s.description}
            >
              <span>{s.emoji}</span>
              <span className="flex-1 truncate">{en ? s.nameEn : s.name}</span>
              <span className="text-white/40 tabular-nums">{s.areaSqm}㎡</span>
              {appliedSetId === s.id && <span className="text-teal-300">✓</span>}
            </button>
          ))}
          <div className="flex gap-1 px-1">
            <input
              type="text"
              value={setQuery}
              placeholder={en ? "Describe a set: e.g. apartment living room" : "描述片场，如：公寓客厅 / 咖啡馆"}
              onChange={(e) => setSetQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") matchSetQuery(); }}
              className="flex-1 min-w-0 bg-white/10 rounded-lg px-2 py-1.5 outline-none placeholder:text-white/25"
            />
            <button
              onClick={matchSetQuery}
              className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 whitespace-nowrap"
            >
              {en ? "Match" : "匹配"}
            </button>
          </div>
          {setMatchMsg && <div className="px-2 text-[10px] leading-relaxed text-teal-300/90">{setMatchMsg}</div>}

          {/* 导演风格预设：选一位导演的整套拍法当默认值（机位/灯光/片场/服装/
              动作建议）。只改场景默认灯光 + 展示建议，不动已有分镜/演员/走位；
              清除回到 plain 默认（灯光 day），同样不删任何内容。 */}
          <div className="px-1 pt-1 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "DIRECTOR STYLE" : "导演风格"}
          </div>
          <div className="rounded-lg px-2 py-1.5 bg-white/5 flex flex-col gap-1.5">
            <select
              value={directorStyleId ?? ""}
              onChange={(e) => setDirectorStyleId(e.target.value || null)}
              className="w-full bg-white/10 rounded-lg px-2 py-1.5 outline-none"
              title={en ? "Pick a director style as the default for new shots — existing shots and actors are untouched" : "选一位导演的拍法当新镜的默认值——已有分镜和演员不动"}
            >
              <option value="">{en ? "None — plain defaults" : "无——plain 默认"}</option>
              {/* 按类型分组（DIRECTOR_STYLE_GENRES 的顺序）；只有已有预设的分组才显示 */}
              {DIRECTOR_STYLE_GENRES.map((g) => {
                const inGroup = DIRECTOR_STYLES.filter((s) => s.genreZh === g.zh);
                if (!inGroup.length) return null;
                return (
                  <optgroup key={g.zh} label={en ? g.en : g.zh}>
                    {inGroup.map((s) => (
                      <option key={s.id} value={s.id}>{en ? s.labelEn : s.labelZh}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            {directorStyle ? (
              <>
                <div className="text-[11px] leading-relaxed text-white/70">
                  {en ? directorStyle.descriptionEn : directorStyle.descriptionZh}
                </div>
                {/* 推荐片场：点一下即加载该片场（和上面 SET 列表同一入口） */}
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-white/40">{en ? "Sets:" : "片场："}</span>
                  {directorStyle.suggestedSets.map((sid) => {
                    const s = getSceneSet(sid);
                    return (
                      <button
                        key={sid}
                        onClick={() => applySet(sid)}
                        className="px-1.5 py-0.5 rounded-md bg-white/10 hover:bg-white/20 whitespace-nowrap"
                        title={en ? `Load set ${s ? s.nameEn : sid}` : `加载片场${s ? s.name : sid}`}
                      >
                        {s ? `${s.emoji} ${en ? s.nameEn : s.name}` : sid}
                      </button>
                    );
                  })}
                </div>
                {/* 机位顺序：点一下按该机位加一镜；也可一键按顺序生成整组分镜 */}
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-white/40">{en ? "Shots:" : "机位："}</span>
                  {directorStyle.shotOrder.map((pid, i) => {
                    const p = getCinePreset(pid);
                    return (
                      <button
                        key={`${pid}-${i}`}
                        onClick={() => addShot(pid)}
                        className="px-1.5 py-0.5 rounded-md bg-white/10 hover:bg-white/20 whitespace-nowrap"
                        title={en ? `Add a shot with ${p ? p.nameEn : pid}` : `按${p ? p.nameZh : pid}加一镜`}
                      >
                        {p ? (en ? p.nameEn : p.nameZh) : pid}
                      </button>
                    );
                  })}
                </div>
                {/* 推荐服装：点一下给第一个演员换上（无演员时只作提示） */}
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-white/40">{en ? "Costumes:" : "服装："}</span>
                  {directorStyle.suggestedCostumes.map((cid) => {
                    const c = resolveCostume(cid);
                    return (
                      <button
                        key={cid}
                        disabled={!actors.length}
                        onClick={() => {
                          const first = actors[0];
                          if (!first) return;
                          updateActor(first.id, { ...(c.archetypeId ? { archetypeId: c.archetypeId } : {}), costumeId: c.id });
                        }}
                        className="px-1.5 py-0.5 rounded-md bg-white/10 hover:bg-white/20 whitespace-nowrap disabled:opacity-40"
                        title={actors.length ? (en ? `Dress the first actor in ${c.labelEn}` : `给第一个演员换上${c.labelZh}`) : (en ? "Add an actor first" : "先加一个演员")}
                      >
                        {en ? c.labelEn : c.labelZh}
                      </button>
                    );
                  })}
                </div>
                {/* 推荐动作：点一下设为第一个演员的默认动作（无演员时只作提示） */}
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-white/40">{en ? "Actions:" : "动作："}</span>
                  {directorStyle.suggestedActions.map((aid) => (
                    <button
                      key={aid}
                      disabled={!actors.length}
                      onClick={() => {
                        const first = actors[0];
                        if (!first) return;
                        updateActor(first.id, { action: aid as ActorAction });
                      }}
                      className="px-1.5 py-0.5 rounded-md bg-white/10 hover:bg-white/20 whitespace-nowrap disabled:opacity-40"
                      title={actors.length ? (en ? `Set the first actor's default action to ${actionDef(aid as ActorAction).nameEn}` : `把第一个演员的默认动作设为${actionDef(aid as ActorAction).nameZh}`) : (en ? "Add an actor first" : "先加一个演员")}
                    >
                      {actionDef(aid as ActorAction).nameZh}
                    </button>
                  ))}
                </div>
                {/* 拍法提示 + 暂不支持的拍法（诚实标注） */}
                <div className="text-[11px] leading-relaxed text-white/50">
                  {(en ? directorStyle.beatsEn : directorStyle.beatsZh).map((b, i) => (
                    <div key={i}>· {b}</div>
                  ))}
                </div>
                {directorStyle.gapsZh.length > 0 && (
                  <div className="text-[10px] leading-relaxed text-amber-200/60">
                    {en ? "Not yet in the console: " : "导演台暂不支持："}
                    {(en ? directorStyle.gapsEn : directorStyle.gapsZh).join("；")}
                  </div>
                )}
                <button
                  onClick={() => directorStyle.shotOrder.forEach((pid) => addShot(pid))}
                  className="px-2 py-1.5 rounded-lg bg-teal-500/20 hover:bg-teal-500/30 text-teal-200 text-left"
                  title={en ? "Append one shot per step of this style's shot order (existing shots kept)" : "按此风格的机位顺序追加一组分镜（已有镜保留）"}
                >
                  {en ? "Build shots in this style's order" : "按此风格生成分镜"}
                </button>
              </>
            ) : (
              <div className="text-[11px] leading-relaxed text-white/50">
                {en ? "Pick a style to apply a director's defaults (camera, lighting, set / costume / action suggestions). Existing shots and actors are never changed." : "选一位导演，把他的拍法当默认值（机位、灯光、片场/服装/动作建议）。已有分镜和演员永远不动。"}
              </div>
            )}
          </div>

          {/* 9:16 竖屏取景框 */}
          <button
            onClick={toggle916}
            className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-white/10 text-left border-t border-white/10 mt-1 pt-2"
          >
            <span>📱 {en ? "9:16 frame" : "9:16 取景框"}</span>
            <span className={show916 ? "text-teal-300" : "text-white/40"}>{show916 ? (en ? "On" : "开") : (en ? "Off" : "关")}</span>
          </button>

          {/* 快拍：单镜实景立即录 */}
          <div className="px-1 pt-1 text-[10px] tracking-widest text-white/40">{en ? "QUICK SHOT" : "快拍"}</div>
          {CINE_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => startQuick(p.id)}
              className="flex items-center justify-between gap-4 px-3 py-1.5 rounded-lg hover:bg-white/10 text-left"
            >
              <span>{en ? p.nameEn : p.nameZh}{p.indoor && <span className="ml-1 text-[10px] text-teal-300/80">{en ? "indoor" : "室内"}</span>}</span>
              <span className="text-white/40">{p.duration}s</span>
            </button>
          ))}

          {/* 分镜工作台 */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "STORYBOARD" : "分镜"}
          </div>
          {/* 场景默认灯光：新镜继承；点选即在画布上预览（退出预览恢复原有光线） */}
          <div className="rounded-lg px-2 py-1.5 bg-white/5 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap">💡 {en ? "Scene lighting" : "场景灯光"}</span>
              <select
                value={sceneLightingId}
                onChange={(e) => {
                  const v = e.target.value as LightingId;
                  setSceneLightingId(v);
                  setPreviewLightingId(v);
                }}
                className="flex-1 min-w-0 bg-white/10 rounded px-1 py-1 outline-none"
                style={{ colorScheme: "dark" }}
                title={en ? "Default lighting for new shots — pick to preview it on the canvas" : "新镜继承的默认灯光；点选即在画布上预览"}
              >
                {LIGHTING_PRESETS.map((lp) => (
                  <option key={lp.id} value={lp.id} title={en ? lp.moodEn : lp.moodZh}>
                    {lp.emoji} {en ? lp.nameEn : lp.nameZh}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setPreviewLightingId(previewLightingId ? null : sceneLightingId)}
                className="px-2 py-1 rounded-md hover:bg-white/10 whitespace-nowrap"
                style={{ color: previewLightingId ? "#5eead4" : undefined }}
                title={en ? "Preview the scene lighting on the canvas (or exit preview)" : "在画布上预览场景灯光（再点退出预览）"}
              >
                {previewLightingId ? (en ? "👁 Exit preview" : "👁 退出预览") : (en ? "👁 Preview" : "👁 预览")}
              </button>
            </div>
            <span className="text-white/40 text-[11px] leading-snug">
              {en ? resolveLightingPreset(sceneLightingId).moodEn : resolveLightingPreset(sceneLightingId).moodZh}
              {en ? " — new shots inherit this." : "——新镜继承此灯光。"}
            </span>
          </div>
          {/* 音效开关 + 试听：开关持久化（store.soundOn）；试听只播合成音效，不出片。
              关门暂无对应动作（动作库里没有开/关门），在这里试听 */}
          <div className="rounded-lg px-2 py-1.5 bg-white/5 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSoundOn(!soundOn)}
                className="px-2 py-1 rounded-md hover:bg-white/10 whitespace-nowrap"
                style={{ color: soundOn ? "#5eead4" : undefined }}
                title={soundOn ? (en ? "Sound effects on — click to mute (saved)" : "音效开——点一下静音（已保存）") : (en ? "Sound effects off — click to enable (saved)" : "音效关——点一下打开（已保存）")}
              >
                {soundOn ? "🔊" : "🔇"} {en ? "Sound FX" : "音效"} {soundOn ? (en ? "On" : "开") : (en ? "Off" : "关")}
              </button>
              <select
                value={previewEffect}
                onChange={(e) => setPreviewEffect(e.target.value as SoundEffectId)}
                className="flex-1 min-w-0 bg-white/10 rounded px-1 py-1 outline-none"
                style={{ colorScheme: "dark" }}
                title={en ? "Pick an effect to preview" : "选一个音效试听"}
              >
                {SOUND_EFFECTS.map((s) => (
                  <option key={s.id} value={s.id}>{en ? s.nameEn : s.nameZh}</option>
                ))}
              </select>
              <button
                onClick={() => { ensureAudioContext(); playSoundEffect(previewEffect); }}
                className="px-2 py-1 rounded-md hover:bg-white/10 whitespace-nowrap"
                title={en ? "Preview the selected effect (WebAudio synthesis, no audio file)" : "试听所选音效（WebAudio 合成，无音频文件）"}
              >
                {en ? "▶ Preview" : "▶ 试听"}
              </button>
            </div>
            <span className="text-white/40 text-[11px] leading-snug">
              {en
                ? "Synthesized with WebAudio — no audio files. Effects play during shoot simulation; door-close has no action yet, preview it here."
                : "WebAudio 合成，无音频文件；模拟播放时按动作响。关门暂无对应动作，可在这里试听。"}
            </span>
          </div>
          {shots.map((s, i) => {
            const p = getCinePreset(s.presetId);
            const crosses = i > 0 && shotCrossesAxis(s, shots[i - 1], actors);
            return (
              <div key={s.id} className="rounded-lg px-2 py-1.5 bg-white/5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-white/40 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 truncate">{en ? p?.nameEn : p?.nameZh}</span>
                  {crosses && (
                    <span className="px-1 py-0.5 rounded text-[10px] whitespace-nowrap" style={{ background: "rgba(245,158,11,0.25)", color: "#fbbf24" }} title={en ? "Camera crosses the 180° axis vs the previous indoor shot" : "本镜机位与上一室内镜分处轴线两侧，可能越轴"}>
                      ⚠️ {en ? "Axis cross" : "可能越轴"}
                    </span>
                  )}
                  <input
                    type="number" min={2} max={15} value={s.duration}
                    onChange={(e) => updateShot(s.id, { duration: Math.max(2, Math.min(15, Number(e.target.value) || 2)) })}
                    className="w-10 bg-white/10 rounded px-1 py-0.5 text-right tabular-nums outline-none"
                    title={en ? "Duration (s)" : "时长(秒)"}
                  />
                  <span className="text-white/40">s</span>
                  <button onClick={() => moveShot(s.id, -1)} disabled={i === 0}
                    className="px-1 rounded hover:bg-white/10 disabled:opacity-25">↑</button>
                  <button onClick={() => moveShot(s.id, 1)} disabled={i === shots.length - 1}
                    className="px-1 rounded hover:bg-white/10 disabled:opacity-25">↓</button>
                  <button onClick={() => removeShot(s.id)} className="px-1 rounded hover:bg-white/10 text-white/60">✕</button>
                </div>
                {/* 本镜框住的角色（室内镜跟拍用；缺省第一个演员；群体镜头框整组） */}
                <div className="flex items-center gap-1.5">
                  <span className="text-white/40 whitespace-nowrap">{en ? "Frames" : "框住"}</span>
                  {p?.group ? (
                    <span className="flex-1 min-w-0 px-1 py-1 text-white/70">{en ? "All actors" : "全部演员"}</span>
                  ) : (
                    <select
                      value={s.targetActorId ?? actors[0]?.id ?? ""}
                      onChange={(e) => updateShot(s.id, { targetActorId: e.target.value || undefined })}
                      className="flex-1 min-w-0 bg-white/10 rounded px-1 py-1 outline-none"
                      style={{ colorScheme: "dark" }}
                      disabled={!actors.length}
                    >
                      {!actors.length && <option value="">{en ? "No actors yet" : "还没有演员"}</option>}
                      {actors.map((a, ai) => (
                        <option key={a.id} value={a.id}>{actorDisplayName(a, ai)}{a.role ? `（${a.role}）` : ""}</option>
                      ))}
                    </select>
                  )}
                </div>
                {/* 本镜灯光：缺省 = 跟随场景；点选即在画布上预览 */}
                <div className="flex items-center gap-1.5">
                  <span className="text-white/40 whitespace-nowrap">💡 {en ? "Lighting" : "灯光"}</span>
                  <select
                    value={s.lightingId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateShot(s.id, { lightingId: v ? (v as LightingId) : undefined });
                      setPreviewLightingId(resolveShotLightingId(v || undefined, sceneLightingId));
                    }}
                    className="flex-1 min-w-0 bg-white/10 rounded px-1 py-1 outline-none"
                    style={{ colorScheme: "dark" }}
                    title={en ? "Lighting for this shot (follow scene default, or pick one — pick to preview)" : "本镜灯光（跟随场景，或自选；点选即在画布上预览）"}
                  >
                    <option value="">
                      {en ? `Follow scene (${resolveLightingPreset(sceneLightingId).nameEn})` : `跟随场景（${resolveLightingPreset(sceneLightingId).nameZh}）`}
                    </option>
                    {LIGHTING_PRESETS.map((lp) => (
                      <option key={lp.id} value={lp.id} title={en ? lp.moodEn : lp.moodZh}>
                        {lp.emoji} {en ? lp.nameEn : lp.nameZh}
                      </option>
                    ))}
                  </select>
                </div>
                {/* 本镜配乐：缺省自动推断（打斗/动作/灯光），也可自选情绪；
                    下方显示推荐曲目 + 乐器 + 来源 + 许可（只给推荐，不捆绑音频） */}
                <div className="flex items-center gap-1.5">
                  <span className="text-white/40 whitespace-nowrap">🎵 {en ? "Music" : "配乐"}</span>
                  <select
                    value={s.musicMood ?? ""}
                    onChange={(e) => updateShot(s.id, { musicMood: e.target.value ? (e.target.value as MusicMood) : undefined })}
                    className="flex-1 min-w-0 bg-white/10 rounded px-1 py-1 outline-none"
                    style={{ colorScheme: "dark" }}
                    title={en ? "Music mood for this shot (auto = inferred from fight / actions / lighting)" : "本镜配乐情绪（自动 = 按打斗/动作/灯光推断）"}
                  >
                    <option value="">
                      {en ? `Auto (${suggestMusicForShot(shotMusicInput(s, sceneLightingId, fights, actors)).nameEn})` : `自动（${suggestMusicForShot(shotMusicInput(s, sceneLightingId, fights, actors)).nameZh}）`}
                    </option>
                    {MUSIC_MOODS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.emoji} {en ? m.nameEn : m.nameZh}
                      </option>
                    ))}
                  </select>
                </div>
                {(() => {
                  const m = suggestMusicForShot(shotMusicInput(s, sceneLightingId, fights, actors));
                  return (
                    <div
                      className="text-white/40 text-[11px] leading-snug"
                      title={en ? m.searchHintEn : m.searchHintZh}
                    >
                      🎵 {en ? m.nameEn : m.nameZh} · {en ? m.instrumentEn : m.instrumentZh} · {en ? m.source.name : m.source.nameZh}（{en ? m.source.license : m.source.licenseZh}）
                    </div>
                  );
                })()}
                <input
                  type="text" value={s.prompt} placeholder={en ? "Prompt (optional)" : "本镜提示词（可选，随控制包导出）"}
                  onChange={(e) => updateShot(s.id, { prompt: e.target.value })}
                  className="w-full bg-white/10 rounded px-2 py-1 outline-none placeholder:text-white/25"
                />
                {/* 剧本来源（Part 4）：只在剧本生成的镜上出现——场次/角色/动作 +
                    台词可改，随控制包导出 */}
                {(s.dialogue !== undefined || s.scriptScene !== undefined) && (
                  <>
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <span className="text-white/40 whitespace-nowrap">📜 {en ? "Script" : "剧本"}</span>
                      {s.scriptScene !== undefined && (
                        <span className="text-teal-300/90 whitespace-nowrap">{en ? `Scene ${s.scriptScene}` : `第 ${s.scriptScene} 场`}</span>
                      )}
                      {s.scriptCharacter && <span className="text-white/70 truncate">{s.scriptCharacter}</span>}
                      {s.scriptAction && (
                        <span className="text-white/50 truncate">{en ? actionDef(s.scriptAction).nameEn : actionDef(s.scriptAction).nameZh}</span>
                      )}
                    </div>
                    <input
                      type="text" value={s.dialogue ?? ""} placeholder={en ? "Dialogue (optional)" : "台词（可选，随控制包导出）"}
                      onChange={(e) => updateShot(s.id, { dialogue: e.target.value || undefined })}
                      className="w-full bg-white/10 rounded px-2 py-1 outline-none placeholder:text-white/25"
                    />
                  </>
                )}
              </div>
            );
          })}
          <div className="flex flex-wrap gap-1">
            {CINE_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => addShot(p.id)}
                className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-center"
                title={en ? `Add ${p.nameEn}` : `加一镜：${p.nameZh}`}
              >
                ＋{en ? p.nameEn : p.nameZh}
              </button>
            ))}
          </div>

          {/* 导出风格 */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "EXPORT STYLES" : "导出风格"}
          </div>
          <div className="flex gap-1 px-1">
            {RENDER_STYLES.map((s) => {
              const on = styles.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleStyle(s.id)}
                  className="flex-1 px-1 py-1.5 rounded-lg text-center"
                  style={{ background: on ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.05)", border: on ? "1px solid rgba(45,212,191,0.6)" : "1px solid transparent" }}
                  title={s.id === "beauty"
                    ? (en ? "Final render — strongest reference video" : "成品渲染——最强参考视频")
                    : s.id === "clay"
                      ? (en ? "Gray blockout — Seedance previz spec" : "灰盒白模——Seedance previz 规格")
                      : (en ? "Depth pass — VACE/ControlNet input" : "深度序列——VACE/ControlNet 输入")}
                >
                  {en ? s.nameEn : s.nameZh}
                </button>
              );
            })}
          </div>

          {/* 演员走位：名字/角色/动作/朝向可编；按住 3D 里的人可拖动调整走位 */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "ACTORS" : "演员走位"}
          </div>
          {placeWarning && (
            <div className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 text-[11px] leading-relaxed flex items-start gap-1.5">
              <span className="flex-1">⚠️ {placeWarning}</span>
              <button onClick={() => setPlaceWarning(null)} className="px-1 rounded hover:bg-white/10" title={en ? "Dismiss" : "知道了"}>✕</button>
            </div>
          )}
          {actors.map((a, i) => {
            const facingDeg = Math.round(((actorFacing(a) * 180) / Math.PI) % 360 + 360) % 360;
            return (
              <div key={a.id} className="rounded-lg px-2 py-1.5 bg-white/5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span>🚶</span>
                  <input
                    type="text" value={actorDisplayName(a, i)}
                    onChange={(e) => updateActor(a.id, { name: e.target.value })}
                    className="w-16 bg-white/10 rounded px-1.5 py-0.5 outline-none"
                    title={en ? "Character name" : "角色名"}
                  />
                  <input
                    type="text" value={a.role ?? ""}
                    placeholder={en ? "Role (e.g. owner)" : "角色（如店主）"}
                    onChange={(e) => updateActor(a.id, { role: e.target.value })}
                    className="flex-1 min-w-0 bg-white/10 rounded px-1.5 py-0.5 outline-none placeholder:text-white/25"
                  />
                  <button onClick={() => removeActor(a.id)} className="px-1 rounded hover:bg-white/10 text-white/60">✕</button>
                </div>
                {/* 角色原型 + 服装：选原型后服装默认该原型第一件；换服装只改服装。
                    时代锁：服装时代与当前片场时代不符时出琥珀警告（只警告、不拦截），
                    与「可能越轴」徽章同款式；未加载片场或片场未分类时不警告。 */}
                <div className="flex items-center gap-1.5">
                  <select
                    value={a.archetypeId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) updateActor(a.id, { archetypeId: undefined, costumeId: undefined });
                      else updateActor(a.id, { archetypeId: v, costumeId: defaultCostumeForArchetype(v).id });
                    }}
                    className="flex-1 min-w-0 bg-white/10 rounded px-1 py-0.5 outline-none"
                    style={{ colorScheme: "dark" }}
                    title={en ? "Character archetype" : "角色原型"}
                  >
                    <option value="">{en ? "No archetype" : "未选原型"}</option>
                    {ARCHETYPES.map((t) => (
                      <option key={t.id} value={t.id} title={en ? t.whyEn : t.whyZh}>{en ? t.nameEn : t.nameZh}</option>
                    ))}
                  </select>
                  <select
                    value={resolveActorCostume(a).id}
                    disabled={!a.archetypeId}
                    onChange={(e) => updateActor(a.id, { costumeId: e.target.value })}
                    className="flex-1 min-w-0 bg-white/10 rounded px-1 py-0.5 outline-none disabled:opacity-40"
                    style={{ colorScheme: "dark" }}
                    title={en ? "Costume" : "服装"}
                  >
                    {a.archetypeId ? (
                      costumesForArchetype(a.archetypeId).map((c) => (
                        <option key={c.id} value={c.id}>{en ? c.labelEn : c.labelZh}</option>
                      ))
                    ) : (
                      <option value="default">{en ? "Default outfit" : "默认现代装"}</option>
                    )}
                  </select>
                </div>
                {(() => {
                  const w = eraWarningFor(resolveActorCostume(a).id, currentSetId);
                  return w ? (
                    <span
                      className="px-1 py-0.5 rounded text-[10px] whitespace-normal leading-snug"
                      style={{ background: "rgba(245,158,11,0.25)", color: "#fbbf24" }}
                      title={en ? "Costume era does not match this set's era (warning only — not blocked)" : "服装时代与当前片场时代不符（仅警告，不拦截）"}
                    >
                      ⚠️ {en ? w.messageEn : w.messageZh}
                    </span>
                  ) : null;
                })()}
                <div className="flex items-center gap-1.5">
                  <select
                    value={actorAction(a)}
                    onChange={(e) => updateActor(a.id, { action: e.target.value as ActorAction })}
                    className="bg-white/10 rounded px-1 py-0.5 outline-none"
                    style={{ colorScheme: "dark" }}
                    title={en ? "Default action" : "默认动作"}
                  >
                    {ACTION_CATEGORY_ORDER.map((cat) => (
                      <optgroup key={cat} label={en ? ACTION_CATEGORY_EN[cat] : ACTION_CATEGORY_ZH[cat]}>
                        {Object.values(ACTION_REGISTRY).filter((d) => d.category === cat).map((d) => (
                          <option key={d.id} value={d.id}>{en ? d.nameEn : d.nameZh}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <span className="text-white/40 whitespace-nowrap">{en ? "Facing" : "朝向"}</span>
                  <input
                    type="range" min={0} max={359} value={facingDeg}
                    onChange={(e) => updateActor(a.id, { facing: (Number(e.target.value) * Math.PI) / 180 })}
                    className="flex-1 min-w-0 accent-teal-400"
                    title={en ? "Facing direction (degrees)" : "朝向（度）"}
                  />
                  <span className="text-white/50 tabular-nums w-9 text-right">{facingDeg}°</span>
                </div>
                {/* 姿势：点一下换姿势（与动作下拉框写同一字段，模拟/故事板/控制包都认） */}
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-white/40 whitespace-nowrap">{en ? "Pose" : "姿势"}</span>
                  {POSE_PANEL_ACTIONS.map((d) => {
                    const on = actorAction(a) === d.id;
                    return (
                      <button
                        key={d.id}
                        onClick={() => updateActor(a.id, { action: d.id })}
                        className="px-1.5 py-0.5 rounded text-[11px] whitespace-nowrap"
                        style={{ background: on ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.05)", border: on ? "1px solid rgba(45,212,191,0.6)" : "1px solid transparent", color: on ? "#5eead4" : undefined }}
                        title={en ? d.nameEn : d.nameZh}
                      >
                        {en ? d.nameEn : d.nameZh}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-white/50 tabular-nums truncate">
                    ({a.from[0].toFixed(1)},{a.from[1].toFixed(1)})→({a.to[0].toFixed(1)},{a.to[1].toFixed(1)})
                  </span>
                  <button
                    onClick={() => { beginReplaceActor(a.id); }}
                    className="px-1.5 py-0.5 rounded hover:bg-white/10 text-white/70 whitespace-nowrap"
                    title={en ? "Click ground twice to reset this actor's path" : "地面点两下，重设该演员的起点→终点"}
                  >
                    {en ? "↻ Reset path" : "↻ 重设走位"}
                  </button>
                </div>
                {/* 动态走位：路点时间轴（位置/高度/时间；拖 3D 里的标牌可移动） */}
                <div className="flex flex-col gap-1 border-t border-white/10 pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/40 whitespace-nowrap">{en ? "Waypoints" : "走位时间轴"}</span>
                    <button
                      onClick={() => { beginWaypointMode(a.id); }}
                      className="px-1.5 py-0.5 rounded hover:bg-white/10 text-white/70 whitespace-nowrap"
                    >
                      {en ? "＋ Click ground to add" : "＋地面点选加路点"}
                    </button>
                    {a.waypoints && a.waypoints.length >= 2 && (
                      <button
                        onClick={() => updateActor(a.id, { waypoints: undefined })}
                        className="px-1.5 py-0.5 rounded hover:bg-white/10 text-white/50"
                        title={en ? "Clear waypoints (back to start→end)" : "清空路点（回到起点→终点）"}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {(a.waypoints ?? []).slice().sort((x, y) => x.t - y.t).map((w, wi) => (
                    <div key={wi} className="flex items-center gap-1">
                      <span className="text-teal-300 tabular-nums w-4 text-center">{wi + 1}</span>
                      <input type="number" step={0.1} value={Number(w.x.toFixed(1))} onChange={(e) => updateWaypoint(a.id, wi, { x: Number(e.target.value) || 0 })} className="w-12 bg-white/10 rounded px-1 py-0.5 text-right tabular-nums outline-none" title="x" />
                      <input type="number" step={0.1} value={Number(w.z.toFixed(1))} onChange={(e) => updateWaypoint(a.id, wi, { z: Number(e.target.value) || 0 })} className="w-12 bg-white/10 rounded px-1 py-0.5 text-right tabular-nums outline-none" title="z" />
                      <input type="number" step={0.1} value={Number((w.y ?? 0).toFixed(1))} onChange={(e) => updateWaypoint(a.id, wi, { y: Number(e.target.value) || 0 })} className="w-11 bg-white/10 rounded px-1 py-0.5 text-right tabular-nums outline-none" title={en ? "Height (m)" : "高度（米）"} />
                      <input type="number" step={0.5} min={0} value={w.t} onChange={(e) => updateWaypoint(a.id, wi, { t: Math.max(0, Number(e.target.value) || 0) })} className="w-11 bg-white/10 rounded px-1 py-0.5 text-right tabular-nums outline-none" title={en ? "Time (s)" : "时间（秒）"} />
                      <span className="text-white/40">s</span>
                      <button onClick={() => removeWaypoint(a.id, wi)} className="px-1 rounded hover:bg-white/10 text-white/60">✕</button>
                    </div>
                  ))}
                </div>
                {/* 动作时间轴：一段一段排动作（移动段插值到目标，姿态段原地做） */}
                <div className="flex flex-col gap-1 border-t border-white/10 pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-white/40 whitespace-nowrap">{en ? "Timeline" : "动作时间轴"}</span>
                    <select
                      value={newSegAction[a.id] ?? "walk"}
                      onChange={(e) => setNewSegAction({ ...newSegAction, [a.id]: e.target.value as ActionId })}
                      className="bg-white/10 rounded px-1 py-0.5 outline-none"
                      style={{ colorScheme: "dark" }}
                    >
                      {ACTION_CATEGORY_ORDER.map((cat) => (
                        <optgroup key={cat} label={en ? ACTION_CATEGORY_EN[cat] : ACTION_CATEGORY_ZH[cat]}>
                          {Object.values(ACTION_REGISTRY).filter((d) => d.category === cat).map((d) => (
                            <option key={d.id} value={d.id}>{en ? d.nameEn : d.nameZh}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        const act = newSegAction[a.id] ?? "walk";
                        const start = Math.max(
                          (a.timeline ?? []).reduce((m, s) => Math.max(m, s.start + s.duration), 0),
                          (a.waypoints ?? []).reduce((m, w) => Math.max(m, w.t), 0),
                        );
                        const def = actionDef(act);
                        const sp = STUNT_ACTION_PROPS[act];
                        addTimelineSegment(a.id, makeSegment(act, start, {
                          duration: def.duration,
                          safety: sp?.safety,
                          propKind: sp?.prop ?? undefined,
                        }));
                      }}
                      className="px-1.5 py-0.5 rounded hover:bg-white/10 text-white/70 whitespace-nowrap"
                    >
                      {en ? "＋ Add" : "＋加一段"}
                    </button>
                  </div>
                  {(a.timeline ?? []).slice().sort((x, y) => x.start - y.start).map((s) => (
                    <div key={s.id} className="flex items-center gap-1">
                      <span className="flex-1 truncate">{en ? actionDef(s.action).nameEn : actionDef(s.action).nameZh}</span>
                      <input type="number" step={0.5} min={0} value={s.start} onChange={(e) => updateTimelineSegment(a.id, s.id, { start: Math.max(0, Number(e.target.value) || 0) })} className="w-11 bg-white/10 rounded px-1 py-0.5 text-right tabular-nums outline-none" title={en ? "Start (s)" : "开始（秒）"} />
                      <span className="text-white/40">–</span>
                      <input type="number" step={0.5} min={0.2} value={s.duration} onChange={(e) => updateTimelineSegment(a.id, s.id, { duration: Math.max(0.2, Number(e.target.value) || 0.2) })} className="w-11 bg-white/10 rounded px-1 py-0.5 text-right tabular-nums outline-none" title={en ? "Duration (s)" : "时长（秒）"} />
                      <span className="text-white/40">s</span>
                      {s.safety && <span className="text-amber-300/80 text-[10px] whitespace-nowrap" title={en ? "Safety note" : "安全备注"}>⚠ {s.safety}</span>}
                      <button onClick={() => removeTimelineSegment(a.id, s.id)} className="px-1 rounded hover:bg-white/10 text-white/60">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <button
            onClick={() => { beginAddActor(); }}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-left"
          >
            🚶 {en ? "+ Add actor (click ground: start → end)" : "＋加演员（地面点两下：起点→终点）"}
          </button>
          <div className="px-2 text-[10px] leading-relaxed text-white/40">
            {en
              ? "Drag an actor in 3D to shift their path. With 2+ actors, the orange dashed axis line appears; indoor shots on opposite sides of it get an axis-cross warning."
              : "按住 3D 里的演员可拖动平移走位。两人以上出现橙色轴线虚线；室内镜机位若与上一镜分处轴线两侧，会标「可能越轴」。"}
          </div>

          {/* 拍摄模拟：按分镜顺序预演（不是视频导出） */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "SHOOT SIMULATION" : "拍摄模拟"}
          </div>
          <button
            onClick={() => { startSim(); }}
            disabled={!shots.length}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-left disabled:opacity-30"
            title={en ? "Preview the shoot in order: camera moves to each shot, actors perform blocking + actions + fights" : "按分镜顺序预演：机位移到每镜，演员走走位+动作+打斗，播完切下一镜"}
          >
            ▶ {en ? `Simulate shoot (${shots.length} shots)` : `模拟拍摄（${shots.length} 镜）`}
          </button>
          <div className="px-2 text-[10px] leading-relaxed text-white/40">
            {en
              ? "Preview only — no video is exported. Play/pause, scrub, and the shot counter appear while simulating."
              : "只是预演，不导出视频。模拟时有播放/暂停、进度条（可拖到任意镜/时间）和镜号。"}
          </div>

          {/* 文字催动动作：规则解析，不调 AI */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "TEXT-DRIVEN ACTIONS" : "文字催动动作"}
          </div>
          <div className="flex gap-1 px-1">
            <input
              type="text"
              value={textInput}
              placeholder={en ? "e.g. 男主走到窗边坐下 / 男主御剑飞行" : "如：男主走到窗边坐下 / 男主御剑飞行"}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runTextParse(); }}
              className="flex-1 min-w-0 bg-white/10 rounded-lg px-2 py-1.5 outline-none placeholder:text-white/25"
            />
            <button
              onClick={runTextParse}
              className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 whitespace-nowrap"
            >
              {en ? "Parse" : "解析"}
            </button>
          </div>
          {textMsg && <div className="px-2 text-[10px] leading-relaxed text-teal-300/90">{textMsg}</div>}
          <button
            onClick={() => setShowPatterns(!showPatterns)}
            className="px-2 text-[10px] text-white/40 hover:text-white/70 text-left"
          >
            {showPatterns ? "▾" : "▸"} {en ? "Supported sentence patterns (rule-based, not AI)" : "支持的句式（规则匹配，不是 AI）"}
          </button>
          {showPatterns && (
            <div className="px-2 flex flex-col gap-0.5">
              {SUPPORTED_PATTERNS.map((p, i) => (
                <div key={i} className="text-[10px] leading-relaxed text-white/50">
                  <span className="text-white/70">{p.pattern}</span> — {p.example}
                </div>
              ))}
            </div>
          )}

          {/* 剧本：写/粘贴/导入 .txt → 规则拆解 → 片场匹配 → 生成分镜。
              动作行复用「文字催动动作」的解析器；认不出的行保留原文并
              明说，不乱指派；生成分镜时台词行=特写、动作行=中景。 */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "SCRIPT" : "剧本"}
          </div>
          <div className="px-2 text-[10px] leading-relaxed text-white/40">
            {en ? "Headings: Scene 1 Café Day Interior / 1. Café-Day-Interior / 【Café Day Interior】. Dialogue: Lead (angry): You're late. Other lines are actions, e.g. Lead walks to the window and sits." : SCRIPT_FORMAT_HINT}
          </div>
          <textarea
            value={scriptText}
            onChange={(e) => { setScriptText(e.target.value); setParsed(null); setScriptMsg(""); }}
            rows={8}
            placeholder={en ? "Scene 1 Café Day Interior\nLead (angry): You're late.\nLead walks to the window and sits." : "第1场 咖啡馆 日 内\n男主（愤怒）：你来晚了。\n男主走到窗边坐下"}
            className="mx-1 w-[calc(100%-8px)] bg-white/10 rounded-lg px-2 py-1.5 outline-none placeholder:text-white/25 resize-y"
          />
          <div className="flex flex-wrap gap-1 px-1">
            <button
              onClick={() => runScriptParse(scriptText)}
              className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 whitespace-nowrap"
            >
              {en ? "Parse script" : "解析剧本"}
            </button>
            <button
              onClick={generateShotsFromScript}
              disabled={!parsed}
              className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 whitespace-nowrap disabled:opacity-30"
              title={en ? "Build shots from the parsed script, in order (dialogue = close-up, action = medium)" : "按剧本顺序生成分镜（台词行=特写，动作行=中景）；替换之前由剧本生成的镜，手工镜保留"}
            >
              🎬 {en ? "Build shots from script" : "从剧本生成分镜"}
            </button>
            <button
              onClick={() => scriptFileRef.current?.click()}
              className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 whitespace-nowrap"
              title={en ? "Import a plain-text (.txt) script" : "导入纯文本（.txt）剧本"}
            >
              📄 {en ? "Import .txt" : "导入 .txt"}
            </button>
            <input
              ref={scriptFileRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={(e) => { importScriptFile(e.target.files?.[0]); e.target.value = ""; }}
            />
            <button
              onClick={() => { setScriptText(""); setParsed(null); setScriptMsg(""); }}
              className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 whitespace-nowrap"
            >
              {en ? "Clear" : "清空"}
            </button>
          </div>
          {scriptMsg && <div className="px-2 text-[10px] leading-relaxed text-teal-300/90">{scriptMsg}</div>}
          {parsed && parsed.preamble.length > 0 && (
            <div className="px-2 text-[10px] leading-relaxed text-white/40">
              {en ? `Note: ${parsed.preamble.length} line(s) before the first scene — kept as-is, no shots built for them.` : `场前 ${parsed.preamble.length} 行（不属于任何场次，已保留，不生成镜头）。`}
            </div>
          )}
          {parsed && parsed.scenes.map((sc) => {
            const override = scriptSetOverrides[sc.number];
            const effId = override ?? sc.setId;
            const effSet = effId ? getSceneSet(effId) : undefined;
            const effName = effSet ? (en ? effSet.nameEn : effSet.name) : (sc.setName ?? effId ?? "");
            return (
              <div key={sc.number} className="rounded-lg px-2 py-1.5 bg-white/5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="flex-1 truncate">
                    {en ? `Scene ${sc.number}` : `第 ${sc.number} 场`}
                    {sc.location ? ` · ${sc.location}` : (en ? " · (no location)" : " · （未写地点）")}
                    {sc.timeOfDay ? (sc.timeOfDay === "day" ? (en ? " · Day" : " · 日") : (en ? " · Night" : " · 夜")) : ""}
                    {sc.interior !== undefined ? (sc.interior ? (en ? " · Interior" : " · 内") : (en ? " · Exterior" : " · 外")) : ""}
                  </span>
                  {effId
                    ? <span className="text-teal-300 whitespace-nowrap">🎬 {effName}</span>
                    : <span className="text-amber-300 whitespace-nowrap">⚠️ {en ? "No set matched" : "未匹配片场"}</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={override ?? ""}
                    onChange={(e) => setScriptSetOverride(sc.number, e.target.value || null)}
                    className="flex-1 min-w-0 bg-white/10 rounded px-1 py-0.5 outline-none"
                    style={{ colorScheme: "dark" }}
                    title={en ? "Pick this scene's set manually (overrides the parsed match)" : "手动指定本场片场（覆盖解析的匹配结果）"}
                  >
                    <option value="">
                      {sc.setId
                        ? (en ? `Auto: ${sc.setName}` : `自动：${sc.setName}`)
                        : (en ? "Pick a set…" : "手动选片场…")}
                    </option>
                    {SCENE_SETS.map((s) => (
                      <option key={s.id} value={s.id}>{en ? s.nameEn : s.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => { if (effId) applySet(effId); }}
                    disabled={!effId}
                    className="px-1.5 py-0.5 rounded hover:bg-white/10 text-white/70 whitespace-nowrap disabled:opacity-30"
                    title={en ? "Load this set into the designer" : "把这场片场加载进设计器"}
                  >
                    {en ? "Build set" : "搭片场"}
                  </button>
                </div>
                {sc.lines.map((l) => (
                  <div key={l.id} className="flex flex-col gap-0.5 rounded bg-white/5 px-1.5 py-1">
                    <div className="flex items-start gap-1.5 text-[11px] leading-snug">
                      <span
                        className="whitespace-nowrap px-1 rounded"
                        style={{
                          background: l.kind === "dialogue" ? "rgba(45,212,191,0.2)" : l.kind === "action" ? "rgba(59,130,246,0.2)" : "rgba(245,158,11,0.25)",
                          color: l.kind === "dialogue" ? "#5eead4" : l.kind === "action" ? "#93c5fd" : "#fbbf24",
                        }}
                      >
                        {l.kind === "dialogue" ? (en ? "Line" : "台词") : l.kind === "action" ? (en ? "Action" : "动作") : (en ? "Unassigned" : UNASSIGNED_MESSAGE)}
                      </span>
                      <span className="flex-1 text-white/80 break-words">{l.raw}</span>
                    </div>
                    {l.kind === "action" && l.actionSummary && (
                      <div className="text-[10px] text-teal-300/80 pl-1">✓ {l.actionSummary}</div>
                    )}
                    {l.kind === "unassigned" && l.unassignedReason && (
                      <div className="text-[10px] text-amber-300/90 pl-1">⚠️ {l.unassignedReason}</div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {/* 打斗编舞：phrase × beat，beat 间 reset，安全是数据字段 */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "FIGHT CHOREOGRAPHY" : "打斗编舞"}
          </div>
          {fights.map((f) => {
            const atk = actors.find((a) => a.id === f.attackerId);
            const def = actors.find((a) => a.id === f.defenderId);
            const shot = shots.find((s) => s.id === f.shotId);
            const warn = validateFight(f);
            return (
              <div key={f.id} className="rounded-lg px-2 py-1.5 bg-white/5 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="flex-1 truncate">🥊 {f.name || (en ? "Fight" : "打斗")}</span>
                  <select
                    value={f.shotId}
                    onChange={(e) => updateFight(f.id, { shotId: e.target.value })}
                    className="bg-white/10 rounded px-1 py-0.5 outline-none"
                    style={{ colorScheme: "dark" }}
                    title={en ? "Shot this fight belongs to" : "挂在哪一镜"}
                  >
                    {shots.map((s, si) => (
                      <option key={s.id} value={s.id}>#{si + 1} {en ? getCinePreset(s.presetId)?.nameEn : getCinePreset(s.presetId)?.nameZh}</option>
                    ))}
                  </select>
                  <button onClick={() => removeFight(f.id)} className="px-1 rounded hover:bg-white/10 text-white/60">✕</button>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={f.attackerId}
                    onChange={(e) => updateFight(f.id, { attackerId: e.target.value })}
                    className="flex-1 min-w-0 bg-white/10 rounded px-1 py-0.5 outline-none"
                    style={{ colorScheme: "dark" }}
                    title={en ? "Attacker" : "攻方"}
                  >
                    {actors.map((a, ai) => (<option key={a.id} value={a.id}>{actorDisplayName(a, ai)}</option>))}
                  </select>
                  <span className="text-white/40">vs</span>
                  <select
                    value={f.defenderId}
                    onChange={(e) => updateFight(f.id, { defenderId: e.target.value })}
                    className="flex-1 min-w-0 bg-white/10 rounded px-1 py-0.5 outline-none"
                    style={{ colorScheme: "dark" }}
                    title={en ? "Defender" : "守方"}
                  >
                    {actors.map((a, ai) => (<option key={a.id} value={a.id}>{actorDisplayName(a, ai)}</option>))}
                  </select>
                  <span className="text-white/50 tabular-nums whitespace-nowrap">{fightDuration(f).toFixed(1)}s</span>
                </div>
                {warn.length > 0 && (
                  <div className="text-[10px] leading-relaxed text-amber-300/90">{warn.join("；")}</div>
                )}
                {f.phrases.map((ph, pi) => (
                  <div key={ph.id} className="flex flex-col gap-1 rounded bg-white/5 px-1.5 py-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-white/50">{en ? `Phrase ${pi + 1}` : `第 ${pi + 1} 段`}</span>
                      <span className="flex-1 text-white/40 text-[10px]">{en ? `reset ${ph.reset ?? 1}s after` : `段后回位 ${ph.reset ?? 1} 秒`}</span>
                      <button onClick={() => addBeat(f.id, ph.id)} className="px-1.5 py-0.5 rounded hover:bg-white/10 text-white/70">＋beat</button>
                      <button onClick={() => removePhrase(f.id, ph.id)} className="px-1 rounded hover:bg-white/10 text-white/50">✕</button>
                    </div>
                    {ph.beats.map((b, bi) => (
                      <div key={b.id} className="flex items-center gap-1">
                        <span className="text-white/40 tabular-nums w-4 text-center">{bi + 1}</span>
                        <select
                          value={b.move}
                          onChange={(e) => updateBeat(f.id, ph.id, b.id, { move: e.target.value as FightBeat["move"] })}
                          className="bg-white/10 rounded px-1 py-0.5 outline-none"
                          style={{ colorScheme: "dark" }}
                        >
                          {(["punch", "kick", "block", "dodge", "fall", "getUp"] as const).map((m) => (
                            <option key={m} value={m}>{en ? { punch: "Punch", kick: "Kick", block: "Block", dodge: "Dodge", fall: "Fall", getUp: "Get up" }[m] : { punch: "出拳", kick: "踢", block: "格挡", dodge: "闪避", fall: "倒地", getUp: "起身" }[m]}</option>
                          ))}
                        </select>
                        <input type="number" step={0.1} min={0.2} value={b.duration} onChange={(e) => updateBeat(f.id, ph.id, b.id, { duration: Math.max(0.2, Number(e.target.value) || 0.2) })} className="w-11 bg-white/10 rounded px-1 py-0.5 text-right tabular-nums outline-none" title={en ? "Duration (s)" : "时长（秒）"} />
                        <span className="text-white/40">s</span>
                        <input type="text" value={b.reaction ?? ""} placeholder={en ? "Reaction" : "反应（如后仰）"} onChange={(e) => updateBeat(f.id, ph.id, b.id, { reaction: e.target.value })} className="flex-1 min-w-0 bg-white/10 rounded px-1 py-0.5 outline-none placeholder:text-white/25" />
                        <select
                          value={b.camera ?? "cheat"}
                          onChange={(e) => updateBeat(f.id, ph.id, b.id, { camera: e.target.value as FightBeat["camera"] })}
                          className="bg-white/10 rounded px-1 py-0.5 outline-none"
                          style={{ colorScheme: "dark" }}
                          title={en ? "Camera: cheat = behind attacker's shoulder (default, never side-on)" : "机位：cheat = 攻方肩后（默认，绝不侧拍）"}
                        >
                          <option value="cheat">{en ? "Cheat" : "肩后"}</option>
                          <option value="wide">{en ? "Wide" : "全景"}</option>
                          <option value="closeup">{en ? "Close-up" : "特写"}</option>
                        </select>
                        <button onClick={() => removeBeat(f.id, ph.id, b.id)} className="px-1 rounded hover:bg-white/10 text-white/60">✕</button>
                      </div>
                    ))}
                  </div>
                ))}
                <div className="flex items-center gap-1">
                  <button onClick={() => addPhrase(f.id)} className="px-1.5 py-0.5 rounded hover:bg-white/10 text-white/70">＋{en ? "Phrase" : "加一段"}</button>
                  <input type="text" value={f.safety.props} placeholder={en ? "Props (foam/rubber)" : "道具（泡沫/橡胶）"} onChange={(e) => updateFight(f.id, { safety: { ...f.safety, props: e.target.value } })} className="flex-1 min-w-0 bg-white/10 rounded px-1 py-0.5 outline-none placeholder:text-white/25" title={en ? "Safety: props" : "安全：道具"} />
                  <input type="text" value={f.safety.rehearsal} placeholder={en ? "Rehearsal (half-speed)" : "排练（半速）"} onChange={(e) => updateFight(f.id, { safety: { ...f.safety, rehearsal: e.target.value } })} className="flex-1 min-w-0 bg-white/10 rounded px-1 py-0.5 outline-none placeholder:text-white/25" title={en ? "Safety: rehearsal" : "安全：排练"} />
                </div>
                <input type="text" value={f.safety.notes} placeholder={en ? "Safety notes…" : "安全备注…"} onChange={(e) => updateFight(f.id, { safety: { ...f.safety, notes: e.target.value } })} className="w-full bg-white/10 rounded px-2 py-0.5 outline-none placeholder:text-white/25" title={en ? "Safety notes" : "安全备注"} />
                {!shot && <div className="text-[10px] text-amber-300/90">{en ? "This fight's shot was deleted." : "这段打斗挂的镜已删。"}</div>}
                {atk && def && atk.id === def.id && <div className="text-[10px] text-amber-300/90">{en ? "Attacker and defender are the same actor." : "攻方和守方是同一个人。"}</div>}
              </div>
            );
          })}
          <button
            onClick={() => { if (shots.length && actors.length >= 2) addFight(shots[0].id); }}
            disabled={!shots.length || actors.length < 2}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-left disabled:opacity-30"
            title={en ? "Needs at least 1 shot and 2 actors" : "需要至少 1 镜 + 2 个演员"}
          >
            🥊 {en ? "+ Add fight (3-beat phrase template)" : "＋加一段打斗（3 拍模板）"}
          </button>
          <div className="px-2 text-[10px] leading-relaxed text-white/40">
            {en
              ? "A fight = phrases of 3–8 beats; fighters reset between phrases. No real contact — punches pass 15–30cm in front of the face; the camera defaults to the punch-axis cheat (behind the attacker's shoulder), never side-on."
              : "一段打斗 = 若干段（phrase），每段 3–8 拍（beat），段间回位。无真实接触——拳从脸前 15–30cm 擦过；机位默认肩后骗位（攻方肩后），绝不默认侧拍。"}
          </div>

          {/* 特技道具：程序化几何，场景里没有的特殊位置靠它 */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "STUNT PROPS" : "特技道具"}
          </div>
          <div className="flex gap-1 px-1">
            <select
              value={propKind}
              onChange={(e) => setPropKind(e.target.value as StuntPropKind)}
              className="flex-1 min-w-0 bg-white/10 rounded-lg px-2 py-1.5 outline-none"
              style={{ colorScheme: "dark" }}
            >
              {STUNT_PROP_LIST.map((d) => (
                <option key={d.kind} value={d.kind}>{en ? d.nameEn : d.nameZh}</option>
              ))}
            </select>
            <button
              onClick={() => { beginPropPlace(propKind); }}
              className="px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 whitespace-nowrap"
            >
              {en ? "Place on ground" : "地面点选放置"}
            </button>
          </div>
          {stuntProps.map((p) => {
            const def = stuntPropDef(p.kind);
            return (
              <div key={p.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/5">
                <span className="flex-1 truncate">{en ? def?.nameEn : def?.nameZh}</span>
                <span className="text-white/50 tabular-nums">({p.x.toFixed(1)}, {p.z.toFixed(1)})</span>
                <button onClick={() => removeStuntProp(p.id)} className="px-1 rounded hover:bg-white/10 text-white/60">✕</button>
              </div>
            );
          })}
          <div className="px-2 text-[10px] leading-relaxed text-white/40">
            {en
              ? "Special positions need something to stand/cling/ride on: a tree, a car, a train car, a sword, a broom, a rooftop platform… Props are simple procedural geometry — no model files. Text commands auto-add a missing prop and say so."
              : "特殊位置总要站/贴/骑在什么上：树、车、火车车厢、剑、扫帚、屋顶平台……道具是程序化几何，不引模型文件。文字指令缺道具时会自动补一个并明说。"}
          </div>

          <button
            onClick={startStoryboard}
            disabled={!shots.length}
            className="mt-1 px-3 py-2 rounded-lg text-center font-semibold disabled:opacity-30"
            style={{ background: "#007AFF" }}
          >
            🎬 {en
              ? `Shoot all (${shots.length}×${styles.length})`
              : `拍摄全部（${shots.length} 镜 × ${styles.length} 风格）`}
          </button>

          {/* 逐镜成片（M4-A：走「AI 出图设置」的后端/工作流，本地 ComfyUI / RunningHub 通吃） */}
          <div className="px-1 pt-2 text-[10px] tracking-widest text-white/40 border-t border-white/10 mt-1">
            {en ? "GENERATE (MY COMFYUI)" : "逐镜成片（我的 ComfyUI）"}
          </div>
          {(() => {
            const cfg = getAiRenderConfig();
            const wfs = cfg.workflows;
            if (!wfs.length) {
              return (
                <div className="px-2 py-1.5 text-white/45 leading-relaxed">
                  {en
                    ? "No workflows yet — add backends & workflows in AI Assistant → Render Settings (local ComfyUI supported), then pick one here."
                    : "还没有工作流——先到「AI 助手 → 出图设置」配置后端（支持本地 ComfyUI）并导入/添加工作流，再回这里选用。"}
                </div>
              );
            }
            return (
              <>
                <select
                  value={genWorkflowId}
                  onChange={(e) => setGenWorkflowId(e.target.value)}
                  className="mx-1 bg-white/10 rounded-lg px-2 py-1.5 outline-none"
                  style={{ colorScheme: "dark" }}
                >
                  <option value="">{en ? "Choose a workflow…" : "选择工作流…"}</option>
                  {wfs.map((w: RenderWorkflow) => (
                    <option key={w.id} value={w.id}>
                      {localizeWorkflowName(w, en ? "en" : "zh")}{w.needsImage ? "" : en ? " (no image)" : "（不吃图）"}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => (genRunning ? (genCancelFlag.current = true) : void runStoryboardGen())}
                  disabled={!genRunning && (!shots.length || !genWorkflowId)}
                  className="px-3 py-2 rounded-lg text-center font-semibold disabled:opacity-30"
                  style={{ background: genRunning ? "rgba(239,68,68,0.8)" : "rgba(45,212,191,0.28)", border: "1px solid rgba(45,212,191,0.5)" }}
                >
                  {genRunning
                    ? (en ? "⏹ Stop" : "⏹ 停止")
                    : `🎞 ${en ? `Generate ${shots.length} shots` : `逐镜生成（${shots.length} 镜）`}`}
                </button>
                {shots.map((s, i) => {
                  const g = genState[s.id];
                  if (!g) return null;
                  const p = getCinePreset(s.presetId);
                  return (
                    <div key={s.id} className="px-2 py-1 rounded-lg bg-white/5 flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-white/40 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                        <span className="flex-1 truncate">{en ? p?.nameEn : p?.nameZh}</span>
                        <span className={g.phase === "error" ? "text-red-400" : g.phase === "done" ? "text-teal-300" : "text-white/60"}>
                          {en ? g.phase : (GEN_PHASE_ZH[g.phase] ?? g.phase)}
                        </span>
                      </div>
                      {g.msg && <div className="text-[10px] text-red-300/80 leading-snug">{g.msg}</div>}
                      {!!g.outputs?.length && (
                        <div className="flex gap-2 flex-wrap">
                          {g.outputs.map((u, j) => (
                            <a key={j} href={u} target="_blank" rel="noreferrer" className="text-teal-300 underline">
                              {en ? "Output" : "产出"}{g.outputs!.length > 1 ? ` ${j + 1}` : ""} ↗
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="px-2 text-[10px] leading-relaxed text-white/40">
                  {en
                    ? "Uses your existing render backends (local ComfyUI / RunningHub). Shoot first (beauty style) to capture first frames; each shot = first frame + its prompt."
                    : "走「AI 出图设置」里的后端（本地 ComfyUI / RunningHub）。先「拍摄全部」（含实景）留住首帧；每镜 = 首帧 + 本镜提示词。"}
                </div>
              </>
            );
          })()}
          <div className="px-2 pt-1 pb-0.5 text-[10px] leading-relaxed text-white/40">
            {en
              ? "Each shot × style exports video + first/last frames; storyboard.json bundles metadata — the control pack for AI video models"
              : "每镜×风格导出短片 + 首/尾帧；批拍附 storyboard.json——整套控制包可喂 AI 视频模型或 ComfyUI/VACE"}
          </div>
        </div>
      )}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="px-3 py-2 rounded-xl text-sm font-semibold text-white shadow-lg"
        style={{ background: menuOpen ? "#007AFF" : "rgba(20,22,32,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
        title={en ? "Cinematic shots" : "分镜出片"}
      >
        🎬 {en ? "Shots" : "出短片"}
      </button>
    </div>
    </>
  );
}
