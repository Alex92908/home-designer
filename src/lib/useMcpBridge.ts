"use client";
/**
 * useMcpBridge — 浏览器侧的 MCP 命令桥（挂在 TopBar，App 打开即生效）。
 *
 * 每 2s 一趟 /api/mcp/sync：
 *   推送 — 当前完整设计快照（serializeCurrentDesign），MCP 的 get_design_state 读它
 *   拉取 — MCP 工具入队的命令（apply_template / apply_design），逐条落进 store
 *   回执 — 应用结果 {id, ok, message}，MCP tools/call 等这个回执答复 CLI
 *
 * 外部 agent（Claude Code 等）由此获得「所见即所得」的设计闭环：CLI 里调工具，
 * 浏览器画布 2s 内生效。失败静默（best-effort）——MCP 未用时零打扰。
 */
import { useEffect } from "react";
import { useDesignerStore } from "./store";
import { serializeCurrentDesign } from "./aiDesignSerialize";
import type { AiDesignResult } from "./aiDesignTypes";
import { evaluateRoom, itemBBox } from "./clearance";
import { YARD_PRESETS } from "./outdoorAssets";
import { autoScatterTrees } from "./yardAutoPlanting";
import { autoGenerateYardPaths, houseHalfExtentsCm } from "./yardAutoLayout";
import { evaluateYardPlan } from "./outdoorClearance";

import { getFurnitureById } from "./furniture";
import { makeSegment, makeWaypoint } from "./actions";
import type { Waypoint } from "./actions";
import type { Actor, ActorAction, Shot } from "./cinematic";

// ── CinematicDirector 按需加载 ──────────────────────────────────
// 它（含 three/fiber/场景集）平时不进首屏包：TopBar 常驻的
// useMcpBridge 若静态 import 它，整条 film 栈都会被打进初始 JS。
// serializeFilm 在模块未加载时返回与默认 store 完全一致的空快照；
// film_* 命令到达时先加载模块再执行；本地已有持久化片场
// （zhuya-cine-shots-v1）时在首个心跳加载一次，让 MCP 读到真实快照。
type CineModule = typeof import("../components/CinematicDirector");
let _cineMod: CineModule | null = null;
let _cinePromise: Promise<CineModule> | null = null;
function loadCine(): Promise<CineModule> {
  if (_cineMod) return Promise.resolve(_cineMod);
  if (!_cinePromise) {
    _cinePromise = import("../components/CinematicDirector").then((m) => {
      _cineMod = m;
      return m;
    });
  }
  return _cinePromise;
}

interface BridgeCommand {
  id: string;
  type: "apply_template" | "apply_design" | "check_layout" | "auto_fix_layout" | "yard_auto"
    | "film_add_actor" | "film_set_actor" | "film_move_actor" | "film_remove_actor"
    | "film_add_waypoint" | "film_move_waypoint" | "film_remove_waypoint" | "film_set_actor_waypoints"
    | "film_set_group_action" | "film_add_shot" | "film_update_shot" | "film_remove_shot"
    | "film_start_sim" | "film_stop_sim" | "film_start_storyboard";
  payload: Record<string, unknown>;
}

/** 出短片快照 —— film_get_state 读它：全量演员 + 分镜 + 模拟/导出进度，
 *  让 AI 一次看清整个场面再编排 N 个演员，而不是逐个盲调。
 *  sim 读逐帧时钟 simClock（真值），不是 UI 的节流镜像 cine.sim。 */
function serializeFilm() {
  // 模块未加载 = 本会话没开过片场面板且无持久化片场：默认 store
  // 就是空演员/空分镜/静止时钟，直接返回等价快照，不为此加载模块。
  if (!_cineMod) {
    return {
      actors: [],
      shots: [],
      sim: { active: false, playing: false, shotIdx: 0, timeSec: 0 },
      queue: { active: false, progress: 0, queueIdx: 0, total: 0, batch: false },
      styles: ["beauty"],
    };
  }
  const c = _cineMod.useCineStore.getState();
  const simClock = _cineMod.simClock;
  return {
    actors: c.actors.map(a => ({
      id: a.id,
      name: a.name ?? null,
      role: a.role ?? null,
      action: a.action ?? "walk",
      costumeId: a.costumeId ?? null,
      archetypeId: a.archetypeId ?? null,
      from: a.from,
      to: a.to,
      facing: a.facing ?? null,
      waypoints: a.waypoints ?? [],
      timeline: a.timeline ?? [],
    })),
    shots: c.shots.map(s => ({
      id: s.id, presetId: s.presetId, duration: s.duration,
      targetActorId: s.targetActorId ?? null, prompt: s.prompt ?? "", dialogue: s.dialogue ?? "",
    })),
    sim: {
      active: simClock.active,
      playing: simClock.playing,
      shotIdx: simClock.shotIdx,
      timeSec: Math.round(simClock.timeSec * 10) / 10,
    },
    queue: {
      active: c.queue !== null,
      progress: c.progress,
      queueIdx: c.queueIdx,
      total: c.queue?.length ?? 0,
      batch: c.batch,
    },
    styles: c.styles,
  };
}

function numPair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const x = Number(v[0]), z = Number(v[1]);
  return Number.isFinite(x) && Number.isFinite(z) ? [x, z] : null;
}

/** 出短片命令：落进 useCineStore。返回回执 message（写明实际改了什么）。
 *  抛错 = 回执 ok:false（服务端把 message 原样带回给 agent）。
 *
 *  film_add_actor 走面板自己的两点放置（beginAddActor + placePoint ×2），
 *  所以自动配色（挑一件没人穿的、时代合身的服装）照常生效；placePoint 的
 *  越界钳制也照常（回执里带 placeWarning，不悄悄吃掉坐标）。 */
async function runFilmCommand(cmd: BridgeCommand): Promise<string> {
  // film 命令到达时才加载模块（首个 film 命令会多一次 chunk 加载，
  // 之后常驻；无 film 命令的会话永不加载）。
  await loadCine();
  const cine = () => _cineMod!.useCineStore.getState();
  const p = cmd.payload;
  const actorOrThrow = (actorId: string) => {
    const a = cine().actors.find(x => x.id === actorId);
    if (!a) throw new Error(`Unknown actorId "${actorId}".`);
    return a;
  };
  switch (cmd.type) {
    case "film_add_actor": {
      const from = numPair(p.from);
      const to = numPair(p.to);
      if (!from || !to) throw new Error("film_add_actor needs from/to as [x, z] with finite numbers.");
      const before = new Set(cine().actors.map(a => a.id));
      cine().beginAddActor();
      cine().placePoint(from);
      cine().placePoint(to);
      const after = cine();
      const created = after.actors.find(a => !before.has(a.id));
      if (!created) throw new Error("Actor was not created (placePoint did not complete the two-click add).");
      const patch: Partial<Actor> = {};
      if (typeof p.name === "string") patch.name = p.name;
      if (typeof p.role === "string") patch.role = p.role;
      if (typeof p.action === "string") patch.action = p.action as ActorAction;
      if (typeof p.costumeId === "string") patch.costumeId = p.costumeId;
      if (typeof p.archetypeId === "string") patch.archetypeId = p.archetypeId;
      if (typeof p.facing === "number") patch.facing = p.facing;
      if (Object.keys(patch).length) cine().updateActor(created.id, patch);
      const fin = cine().actors.find(a => a.id === created.id);
      const warn = cine().placeWarning;
      return `Added actor ${created.id} ("${fin?.name ?? "?"}") from (${from[0]}, ${from[1]}) to (${to[0]}, ${to[1]}), costume ${fin?.costumeId ?? "?"}. Total actors: ${cine().actors.length}.${warn ? ` Note: ${warn}` : ""}`;
    }
    case "film_set_actor": {
      const actorId = String(p.actorId ?? "");
      const actor = actorOrThrow(actorId);
      const raw = (p.patch ?? {}) as Record<string, unknown>;
      const patch: Partial<Actor> = {};
      if (typeof raw.name === "string") patch.name = raw.name;
      if (typeof raw.role === "string") patch.role = raw.role;
      if (typeof raw.facing === "number") patch.facing = raw.facing;
      if (typeof raw.action === "string") patch.action = raw.action as ActorAction;
      if (typeof raw.archetypeId === "string") patch.archetypeId = raw.archetypeId;
      if (typeof raw.costumeId === "string") patch.costumeId = raw.costumeId;
      if (raw.from !== undefined) {
        const v = numPair(raw.from);
        if (!v) throw new Error("patch.from must be [x, z] with finite numbers.");
        patch.from = v;
      }
      if (raw.to !== undefined) {
        const v = numPair(raw.to);
        if (!v) throw new Error("patch.to must be [x, z] with finite numbers.");
        patch.to = v;
      }
      cine().updateActor(actorId, patch);
      return `Updated actor ${actorId} ("${actor.name ?? "?"}"): ${Object.keys(patch).join(", ") || "no fields"}.`;
    }
    case "film_move_actor": {
      const actorId = String(p.actorId ?? "");
      const actor = actorOrThrow(actorId);
      const patch: Partial<Actor> = {};
      if (p.from !== undefined) {
        const v = numPair(p.from);
        if (!v) throw new Error("from must be [x, z] with finite numbers.");
        patch.from = v;
      }
      if (p.to !== undefined) {
        const v = numPair(p.to);
        if (!v) throw new Error("to must be [x, z] with finite numbers.");
        patch.to = v;
      }
      cine().updateActor(actorId, patch);
      const fin = cine().actors.find(a => a.id === actorId) ?? actor;
      return `Moved actor ${actorId} ("${fin.name ?? "?"}") to from (${fin.from[0]}, ${fin.from[1]}), to (${fin.to[0]}, ${fin.to[1]}).`;
    }
    case "film_remove_actor": {
      const actorId = String(p.actorId ?? "");
      const actor = actorOrThrow(actorId);
      cine().removeActor(actorId);
      return `Removed actor ${actorId} ("${actor.name ?? "?"}"). Remaining actors: ${cine().actors.length}.`;
    }
    case "film_add_waypoint": {
      const actorId = String(p.actorId ?? "");
      actorOrThrow(actorId);
      const x = Number(p.x), z = Number(p.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error("x/z must be finite numbers.");
      cine().addWaypoint(actorId, [x, z]);
      const n = cine().actors.find(a => a.id === actorId)?.waypoints?.length ?? 0;
      return `Added waypoint (${x}, ${z}) to actor ${actorId}; now ${n} waypoint(s).`;
    }
    case "film_move_waypoint": {
      const actorId = String(p.actorId ?? "");
      const actor = actorOrThrow(actorId);
      const wps = actor.waypoints ?? [];
      const idx = Number(p.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= wps.length) {
        throw new Error(`Waypoint index ${String(p.index)} out of range (actor ${actorId} has ${wps.length}).`);
      }
      const raw = (p.patch ?? {}) as Record<string, unknown>;
      const wpPatch: Partial<Waypoint> = {};
      for (const k of ["x", "z", "t", "y", "facing"] as const) {
        if (typeof raw[k] === "number") wpPatch[k] = raw[k];
      }
      cine().updateWaypoint(actorId, idx, wpPatch);
      return `Updated waypoint ${idx} of actor ${actorId}.`;
    }
    case "film_remove_waypoint": {
      const actorId = String(p.actorId ?? "");
      const actor = actorOrThrow(actorId);
      const wps = actor.waypoints ?? [];
      const idx = Number(p.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= wps.length) {
        throw new Error(`Waypoint index ${String(p.index)} out of range (actor ${actorId} has ${wps.length}).`);
      }
      cine().removeWaypoint(actorId, idx);
      const n = cine().actors.find(a => a.id === actorId)?.waypoints?.length ?? 0;
      return `Removed waypoint ${idx} of actor ${actorId}; now ${n} waypoint(s).`;
    }
    case "film_set_actor_waypoints": {
      const actorId = String(p.actorId ?? "");
      actorOrThrow(actorId);
      if (!Array.isArray(p.waypoints)) throw new Error("waypoints must be [[x, z, t], ...].");
      const wps = (p.waypoints as unknown[]).map(w => {
        const arr = w as unknown[];
        if (!Array.isArray(arr) || arr.length < 3) throw new Error("Each waypoint must be [x, z, t].");
        const x = Number(arr[0]), z = Number(arr[1]), t = Number(arr[2]);
        if (![x, z, t].every(Number.isFinite) || t < 0) throw new Error(`Bad waypoint ${JSON.stringify(w)}: x/z/t must be finite numbers and t >= 0.`);
        return makeWaypoint(x, z, t);
      });
      cine().updateActor(actorId, { waypoints: wps });
      return `Set ${wps.length} waypoint(s) on actor ${actorId} (replaced previous path).`;
    }
    case "film_set_group_action": {
      // 全量校验先行（服务端也验过，这里是最后一道防线）：任何一个演员
      // 不存在，整单不执行 —— 不允许一半演员动起来、一半没动。
      const actorIds = p.actorIds as string[];
      const action = String(p.action ?? "");
      const start = Number(p.start);
      const duration = p.duration === undefined ? undefined : Number(p.duration);
      if (!Array.isArray(actorIds) || !actorIds.length) throw new Error("actorIds must be a non-empty array.");
      const missing = actorIds.filter(id => !cine().actors.some(a => a.id === id));
      if (missing.length) throw new Error(`Unknown actorId(s): ${missing.join(", ")} — nothing applied.`);
      if (!Number.isFinite(start) || start < 0) throw new Error("start must be a finite number >= 0.");
      if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) throw new Error("duration must be > 0.");
      const targetPos = p.targetPos === undefined ? undefined : numPair(p.targetPos);
      if (p.targetPos !== undefined && !targetPos) throw new Error("targetPos must be [x, z] with finite numbers.");
      const pairs: string[] = [];
      for (const id of actorIds) {
        const seg = makeSegment(action, start, {
          ...(duration !== undefined ? { duration } : {}),
          ...(targetPos ? { targetPos } : {}),
          ...(typeof p.targetY === "number" ? { targetY: p.targetY } : {}),
          ...(typeof p.facing === "number" ? { facing: p.facing } : {}),
          ...(typeof p.targetActorId === "string" ? { targetActorId: p.targetActorId } : {}),
          ...(typeof p.safety === "string" ? { safety: p.safety } : {}),
          ...(typeof p.propKind === "string" ? { propKind: p.propKind } : {}),
        });
        cine().addTimelineSegment(id, seg);
        pairs.push(`${id}=${seg.id}`);
      }
      return `Added "${action}" segment (start ${start}s${duration !== undefined ? `, ${duration}s` : ""}) to ${actorIds.length} actor(s) on the shared clock: ${pairs.join(", ")}.`;
    }
    case "film_add_shot": {
      const presetId = String(p.presetId ?? "");
      const before = new Set(cine().shots.map(s => s.id));
      cine().addShot(presetId);
      const created = cine().shots.find(s => !before.has(s.id));
      if (!created) throw new Error("Shot was not created.");
      const patch: Partial<Pick<Shot, "duration" | "prompt" | "dialogue" | "targetActorId" | "lightingId" | "musicMood">> = {};
      if (typeof p.duration === "number") patch.duration = p.duration;
      if (typeof p.prompt === "string") patch.prompt = p.prompt;
      if (typeof p.dialogue === "string") patch.dialogue = p.dialogue;
      if (typeof p.targetActorId === "string") patch.targetActorId = p.targetActorId;
      if (Object.keys(patch).length) cine().updateShot(created.id, patch);
      const fin = cine().shots.find(s => s.id === created.id) ?? created;
      return `Added shot ${created.id} (preset ${presetId}, ${fin.duration}s). Total shots: ${cine().shots.length}.`;
    }
    case "film_update_shot": {
      const shotId = String(p.shotId ?? "");
      const shot = cine().shots.find(s => s.id === shotId);
      if (!shot) throw new Error(`Unknown shotId "${shotId}".`);
      const raw = (p.patch ?? {}) as Record<string, unknown>;
      const patch: Partial<Pick<Shot, "duration" | "prompt" | "dialogue" | "targetActorId" | "lightingId" | "musicMood">> = {};
      for (const k of ["duration", "prompt", "dialogue", "targetActorId", "lightingId", "musicMood"] as const) {
        if (raw[k] !== undefined) (patch as Record<string, unknown>)[k] = raw[k];
      }
      cine().updateShot(shotId, patch);
      return `Updated shot ${shotId} (${shot.presetId}): ${Object.keys(patch).join(", ") || "no fields"}.`;
    }
    case "film_remove_shot": {
      const shotId = String(p.shotId ?? "");
      const shot = cine().shots.find(s => s.id === shotId);
      if (!shot) throw new Error(`Unknown shotId "${shotId}".`);
      cine().removeShot(shotId);
      return `Removed shot ${shotId} (${shot.presetId}). Remaining shots: ${cine().shots.length}.`;
    }
    case "film_start_sim": {
      if (!cine().shots.length) throw new Error("No shots yet — add one with film_add_shot first.");
      cine().startSim();
      return `Simulation started: ${cine().shots.length} shot(s), all actors on the shared clock from shot 1.`;
    }
    case "film_stop_sim": {
      cine().stopSim();
      return "Simulation stopped.";
    }
    case "film_start_storyboard": {
      const shots = cine().shots.length;
      if (!shots) throw new Error("No shots yet — add one with film_add_shot first.");
      const styles = cine().styles.length;
      cine().startStoryboard();
      return `Storyboard export STARTED: ${shots} shot(s) × ${styles} style(s) = ${shots * styles} frame(s) queued. Files (storyboard.json + video) download in the browser when the batch finishes — not yet.`;
    }
    default:
      throw new Error(`Unknown film command type ${cmd.type}`);
  }
}

/** 院子的**只读**摘要 —— 补 serializeCurrentDesign 的盲区。
 *
 *  快照里的 yard 只回传 AI 能产出的两类(4 种 prefab + singleton),把 zone 分区、
 *  path 小径、glb_model 全丢了。于是院子里明明有铺装和小径,agent 读到 yard 为空,
 *  如实汇报「院子是空的」并反问用户要加什么(用户实拍,直呼很笨)—— 它不是笨,是瞎。
 *  这里单独给它一份「现场有什么」的清单;它只用来**了解现状**,不参与 apply 契约。 */
function summarizeYard(
  yard: { items?: unknown[]; paths?: unknown[] } | undefined,
  fp0?: Parameters<typeof houseHalfExtentsCm>[0],
): string {
  // 把**房子的真实占地**一并告诉 agent:院子坐标落在房子轮廓内会被静默丢弃,
  // 而它无从知道房子多大,只能猜(实测猜的 ±500/±300 全落在 12×7.8m 的房子里,
  // 加的树全被丢掉,它却以为是 add 语法不对,来回瞎试)。
  const { hw, hd } = houseHalfExtentsCm(fp0);
  const houseInfo = `房子占地:半宽 ${Math.round(hw)}cm、半深 ${Math.round(hd)}cm(坐标原点=房子中心)。` +
    `院子物件要摆在房子轮廓之外,落在轮廓内会被自动丢弃 —— 具体摆哪由你按设计意图定,` +
    `拿不准就省略 x/z 让系统自动散摆。`;
  const items = (yard?.items ?? []) as Array<Record<string, unknown>>;
  const paths = (yard?.paths ?? []) as unknown[];
  if (!items.length && !paths.length) return `院子当前为空。${houseInfo}`;
  const count = new Map<string, number>();
  for (const it of items) {
    const t = String(it.type ?? "singleton");
    const label =
      t === "prefab" ? `套组:${String(it.prefabKind ?? "?")}`
      : t === "zone" ? `分区:${String(it.zoneKind ?? it.kind ?? "?")}`
      : t === "glb_model" ? `模型:${String(it.label ?? it.kind ?? "?")}`
      : `${String(it.kind ?? "?")}`;
    count.set(label, (count.get(label) ?? 0) + 1);
  }
  const parts = [...count.entries()].map(([k, n]) => (n > 1 ? `${k}×${n}` : k));
  if (paths.length) parts.push(`小径×${paths.length}`);
  return `院子现有:${parts.join("、")}。${houseInfo}` +
    `(注:分区/小径/导入模型只能读、不能通过 apply_design 生成)`;
}

/** 院子的「自动布局」能力 —— 把构图交给项目自带的引擎,而不是让模型手写坐标。
 *
 *  这是布局质量的分水岭:碰撞校验只能保证"不重叠",保证不了"合理"。好看的院子来自
 *  设计师调过的庭院包(YARD_PRESETS)和散植/动线算法,不是模型逐点算出来的坐标
 *  (实测让它手摆,树会堆成两坨)。所以:模型负责**选**(要哪种风格、种什么、几棵),
 *  引擎负责**摆**。
 */
function runYardAuto(payload: Record<string, unknown>): string {
  const s = useDesignerStore.getState();
  const { hw, hd } = houseHalfExtentsCm(s.floorPlans[0]);
  const house = { minX: -hw, maxX: hw, minZ: -hd, maxZ: hd };
  const mode = String(payload.mode ?? "");

  if (mode === "preset") {
    const id = String(payload.presetId ?? "");
    const preset = YARD_PRESETS.find(p => p.id === id);
    if (!preset) {
      return `未知庭院包 "${id}"。可选:${YARD_PRESETS.map(p => `${p.id}(${p.label})`).join("、")}`;
    }
    const stamp = Date.now();
    // 与 UI 的「自动设计」同一条路径:整包物件(分区+植物+设施)一次性落地。
    preset.items.forEach((it, i) => {
      s.addYardItem({ ...it, id: `${preset.id}-${stamp}-${i}` } as never);
    });
    return `已套用庭院包「${preset.label}」:${preset.items.length} 件(含分区/植物/设施,位置由设计包给定)。`;
  }

  if (mode === "plant") {
    const count = Math.max(1, Math.min(20, Number(payload.count ?? 6)));
    const items = (s.yardPlan?.items ?? []) as never[];
    const trees = autoScatterTrees(items, house, 1500, 7, count);
    if (!trees.length) return "没有可用的种植位(院子太挤或已种满),未新增。";
    trees.forEach(t => s.addYardItem(t as never));
    return `已按散植算法种下 ${trees.length} 棵树:自动避开房子、彼此间距 ≥7m、分布均匀。`;
  }

  if (mode === "paths") {
    const items = (s.yardPlan?.items ?? []) as never[];
    const paths = autoGenerateYardPaths(items, house);
    if (!paths.length) return "当前院子没有可连接的分区,未生成小径(先套庭院包或加分区)。";
    useDesignerStore.setState(state => ({
      yardPlan: {
        ...(state.yardPlan ?? { items: [] }),
        items: state.yardPlan?.items ?? [],
        paths: [...(state.yardPlan?.paths ?? []), ...paths],
      },
    }));
    return `已自动生成 ${paths.length} 条动线小径(连接各功能分区与入口)。`;
  }

  return `未知的自动布局模式 "${mode}"。可选:preset / plant / paths`;
}

/** 应用前后的可比计数:院子按 kind 计数 + 每间房家具数。用来回报真实差异。 */
function countDesign(s: ReturnType<typeof useDesignerStore.getState>) {
  const yard = new Map<string, number>();
  for (const it of (s.yardPlan?.items ?? []) as unknown as Array<Record<string, unknown>>) {
    const k = String(it.kind ?? it.prefabKind ?? it.zoneKind ?? "?");
    yard.set(k, (yard.get(k) ?? 0) + 1);
  }
  // 位置指纹:**移动不改变数量**,只比数量的话 yard.move 生效了也会被报成
  // 「画布没有任何变化」,模型据此以为 move 不管用就放弃移动改去 add,树全堆成一坨
  // (用户实拍)。—— 修"工具说谎"的回报自己又说谎,必须连位置一起比。
  const posYard = new Map<string, string>();
  for (const it of (s.yardPlan?.items ?? []) as unknown as Array<Record<string, unknown>>) {
    posYard.set(String(it.id ?? ""), `${Math.round(Number(it.x))},${Math.round(Number(it.z))}`);
  }
  const rooms = new Map<string, number>();
  const posRoom = new Map<string, string>();
  s.floorPlans.forEach((fp, fi) => {
    for (const r of (fp.enabledRooms ?? [])) {
      const items = fp.rooms?.[r]?.placedItems ?? [];
      rooms.set(`${fi + 1}F/${r}`, items.length);
      for (const p of items) posRoom.set(p.instanceId, `${Math.round(p.x)},${Math.round(p.z)},${p.rotation ?? 0}`);
    }
  });
  return { yard, rooms, paths: (s.yardPlan?.paths ?? []).length, posYard, posRoom };
}

/** 把「请求了什么」和「实际变成什么」对照着讲清楚,特别点名被静默丢弃的情况。 */
function diffReport(
  before: ReturnType<typeof countDesign>,
  after: ReturnType<typeof countDesign>,
  design: AiDesignResult,
): string {
  const lines: string[] = [];
  const keys = new Set([...before.yard.keys(), ...after.yard.keys()]);
  for (const k of keys) {
    const b = before.yard.get(k) ?? 0, a = after.yard.get(k) ?? 0;
    if (a !== b) lines.push(`院子 ${k}:${b} → ${a}`);
  }
  if (before.paths !== after.paths) lines.push(`小径:${before.paths} → ${after.paths}`);

  // 位置变化(move 的成效在这里体现,数量不会变)
  let movedYard = 0;
  for (const [id, p] of after.posYard) {
    const b = before.posYard.get(id);
    if (b && b !== p) movedYard++;
  }
  if (movedYard) lines.push(`院子 ${movedYard} 件已挪到新位置`);
  let movedRoom = 0;
  for (const [id, p] of after.posRoom) {
    const b = before.posRoom.get(id);
    if (b && b !== p) movedRoom++;
  }
  if (movedRoom) lines.push(`室内 ${movedRoom} 件家具位置/朝向已更新`);
  for (const [k, a] of after.rooms) {
    const b = before.rooms.get(k) ?? 0;
    if (a !== b) lines.push(`${k} 家具:${b} → ${a}`);
  }

  // 请求新增了院子物件却没涨 → 多半是坐标落在房子占地上被丢弃(clearYardItemsOfHouse)
  const wantAdd = (design?.yard?.add ?? []).length;
  if (wantAdd) {
    const gained = [...after.yard.entries()].reduce((n, [k, a]) => n + Math.max(0, a - (before.yard.get(k) ?? 0)), 0);
    if (gained < wantAdd) {
      lines.push(
        `⚠️ 请求新增 ${wantAdd} 件院子物件,实际只进 ${gained} 件。` +
        `多半是给的坐标落在**房子占地范围内**被自动丢弃了 —— 院子坐标以房子中心为原点,` +
        `请放到房子轮廓之外(或省略 x/z 让系统自动散摆)。`,
      );
    }
  }
  return lines.length ? `已应用。实际变化:\n${lines.join("\n")}` : "已应用,但**画布没有任何变化** —— 检查你的字段名/操作是否被支持,不要重复提交同样的内容。";
}

/** 自动解摆位冲突 —— 由**代码**把家具推开,而不是让模型手算厘米坐标。
 *
 *  这是这套 agent 能不能好用的关键分水岭:让语言模型按坐标排家具,它会陷入
 *  「我算着够了 / 但报告说冲突 / 那我挪一点 / 还是冲突…」的死循环(用户实拍)。
 *  Claude Code 高效不是因为它会手算字节偏移,而是编辑器和编译器替它扛住了难的部分。
 *  同理:模型负责"放什么、什么风格",几何冲突交给这里迭代求解。
 *
 *  策略:每轮读真实违规 → 对每对冲突沿"重叠最小的轴"把两件各推开一半 → 夹在房间内 →
 *  再校验。最多 N 轮,收敛不了就把剩余问题如实回报(不假装成功)。 */
/** 这些类别不该被自动挪走:楼梯是通行结构、壁挂/嵌入件位置由墙决定。 */
const STICKY = new Set(["stair", "artwork", "curtain"]);

function runAutoFix(maxRounds = 6): string {
  const s0 = useDesignerStore.getState();
  const getF = (id: string) =>
    getFurnitureById(id) ?? s0.customFurniture.find(f => f.id === id);

  for (let round = 0; round < maxRounds; round++) {
    const s = useDesignerStore.getState();
    let moved = 0;

    s.floorPlans.forEach((fp, fi) => {
      for (const room of (fp.enabledRooms ?? [])) {
        const items = fp.rooms?.[room]?.placedItems ?? [];
        const dims = fp.roomDimensions?.[room];
        if (!items.length || !dims) return;
        let evalRes;
        try { evalRes = evaluateRoom(items, getF, dims.width, dims.depth); } catch { return; }
        const byId = new Map(evalRes.items.map(e => [e.placed.instanceId, e]));

        for (const it of evalRes.items) {
          // 净距扇区(clearanceBBox 按朝向算出的"必须留空"区域)。真实规则是
          // 「冰箱**前方**留 90cm」这种有方向的扇区,不是简单的中心距 —— 之前按中心距
          // 推,方向都不对,自然一件也挪不动(实测 26 处推完还是 26 处)。
          const zone = it.zone;
          if (!zone) continue;
          for (const v of it.violations) {
            // 只解**必须项**:建议项(如 260cm 橱柜在 280cm 厨房里要求前方留 90cm)
            // 受房间尺寸所限本就无解,追着它推只会白转还把别的推乱。
            if (v.severity !== "required" || !v.otherId) continue;
            const b = byId.get(v.otherId);
            if (!b) continue;
            if (STICKY.has(b.f.category)) continue;      // 楼梯/门窗类不该被推走
            const fp = itemBBox(b.placed, b.f);

            // 把 b 的占地推出 a 的扇区:四个方向各算"退出所需距离",取最小的那个。
            const exits: Array<{ dx: number; dz: number; cost: number }> = [
              { dx: (zone.cx - zone.w / 2) - (fp.cx + fp.w / 2), dz: 0, cost: 0 },  // 往 -x
              { dx: (zone.cx + zone.w / 2) - (fp.cx - fp.w / 2), dz: 0, cost: 0 },  // 往 +x
              { dx: 0, dz: (zone.cz - zone.d / 2) - (fp.cz + fp.d / 2), cost: 0 },  // 往 -z
              { dx: 0, dz: (zone.cz + zone.d / 2) - (fp.cz - fp.d / 2), cost: 0 },  // 往 +z
            ].map(e => ({ ...e, cost: Math.abs(e.dx) + Math.abs(e.dz) }));
            exits.sort((p, q) => p.cost - q.cost);
            const e = exits[0];
            if (!e || e.cost < 0.5 || e.cost > 400) continue;   // 已经出去了 / 挪得太离谱就放弃

            const margin = 1;
            const nx = b.placed.x + e.dx + Math.sign(e.dx) * margin;
            const nz = b.placed.z + e.dz + Math.sign(e.dz) * margin;
            // 夹在房间内(用 b 自己的占地半尺寸)
            const cx = Math.max(fp.w / 2, Math.min(dims.width - fp.w / 2, nx));
            const cz = Math.max(fp.d / 2, Math.min(dims.depth - fp.d / 2, nz));
            if (Math.abs(cx - b.placed.x) < 0.5 && Math.abs(cz - b.placed.z) < 0.5) continue; // 被墙夹住,挪不动
            useDesignerStore.getState().moveItem(b.placed.instanceId, cx, cz);
            moved++;
          }
        }
      }
    });

    if (!moved) break;   // 已收敛
  }
  return runLayoutCheck();
}

/** 跑一遍真实摆位校验(室内 evaluateRoom + 院子 evaluateYardPlan),把违规回报给 agent。
 *
 *  为什么必须在浏览器里跑:校验要用**当前 store 的真实几何**(房间尺寸、门窗、家具目录
 *  的实际长宽高),服务端拿不到。agent 之前是「盲写坐标 → 收到 ok → 以为成了」,
 *  结果家具层层叠在一起还宣称已按 >200cm 间距排好(用户实拍)。有了它,agent 能看见
 *  自己摆出来的真实后果并迭代修正。 */
function runLayoutCheck(): string {
  const s = useDesignerStore.getState();
  // 必须 / 建议 分开报:混在一起等于给 agent 一份**永远清不完的清单**,它会一直在
  // 「还有 26 处」里打转(用户实拍)。很多建议项几何上根本无解 —— 比如 260cm 宽的橱柜
  // 放进 280cm 宽的厨房,规则要它前方留 90cm,再怎么挪都满足不了。必须项清零即算通过。
  const problems: Array<{ where: string; item: string; issue: string }> = [];
  const advisories: Array<{ where: string; item: string; issue: string }> = [];

  // ── 室内:逐层逐间 ──
  s.floorPlans.forEach((fp, fi) => {
    for (const room of (fp.enabledRooms ?? [])) {
      const rs = fp.rooms?.[room];
      const items = rs?.placedItems ?? [];
      if (!items.length) continue;
      const dims = fp.roomDimensions?.[room];
      if (!dims) continue;
      try {
        const evalRes = evaluateRoom(
          items,
          (id: string) => getFurnitureById(id) ?? s.customFurniture.find(f => f.id === id),
          dims.width, dims.depth,
        );
        // 报告要带**坐标和尺寸**:只说「冲突了」的话,模型没有足够信息算怎么挪,
        // 只能瞎猜并和报告反复较劲(用户实拍:满屏「应该够…但报告仍说冲突…」)。
        const byId = new Map(evalRes.items.map(e => [e.placed.instanceId, e]));
        const pos = (e: typeof evalRes.items[number] | undefined) =>
          e ? `@(${Math.round(e.placed.x)},${Math.round(e.placed.z)}) ${Math.round(e.f.width)}×${Math.round(e.f.depth)}cm` : "";
        for (const it of evalRes.items) {
          for (const v of it.violations) {
            const other = v.otherId ? byId.get(v.otherId) : undefined;
            const entry = {
              where: `${fi + 1}F/${room}(${dims.width}×${dims.depth}cm)`,
              item: `${it.f.name}${pos(it)}`,
              issue: other
                ? `需与「${v.otherName}」${pos(other)}保持 ${v.required}cm:${v.reason}`
                : `${v.reason}(需 ${v.required}cm)`,
            };
            (v.severity === "required" ? problems : advisories).push(entry);
          }
        }
      } catch { /* 某间算不动不该拖垮整体校验 */ }
    }
  });

  // ── 院子 ──
  try {
    const yard = s.yardPlan;
    if (yard?.items?.length) {
      // 院子校验要房子的占地矩形(cm),用一层的半宽半深换算成 bbox。
      const { hw, hd } = houseHalfExtentsCm(s.floorPlans[0]);
      const vs = evaluateYardPlan(yard.items, { minX: -hw, maxX: hw, minZ: -hd, maxZ: hd }, yard.paths);
      for (const v of vs) {
        const it = yard.items.find(i => i.id === v.itemId) as { kind?: string } | undefined;
        const entry = { where: "院子", item: it?.kind ?? v.itemId, issue: v.reasonZh ?? v.kind };
        (v.severity === "required" ? problems : advisories).push(entry);
      }
    }
  } catch { /* 同上 */ }

  const fmt = (p: { where: string; item: string; issue: string }) => `- [${p.where}] ${p.item}:${p.issue}`;
  const tail = advisories.length
    ? ["", `另有 ${advisories.length} 处**建议级**优化(不阻塞,可忽略;有些受房间尺寸所限本就无解):`,
       ...advisories.slice(0, 10).map(fmt)]
    : [];

  if (!problems.length) {
    return ["OK:必须修正项已全部通过(家具间距、门窗开启、院子安全距离)。", ...tail].join("\n");
  }
  return [
    `发现 ${problems.length} 处**必须修正**的摆位冲突:`,
    ...problems.slice(0, 30).map(fmt),
    ...tail,
  ].join("\n");
}

/** 本标签的桥身份。App 内的 AI agent 发请求时带上它,服务端据此把租约拽回本标签,
 *  保证 agent 改的是**用户眼前这一页**,而不是碰巧持有租约的另一个标签。 */
let currentTabId = "";
export function getBridgeTabId(): string { return currentTabId; }

export function useMcpBridge() {
  useEffect(() => {
    let stopped = false;
    let acks: Array<{ id: string; ok: boolean; message?: string }> = [];
    // 本标签的身份：服务端按它发租约，多标签同开只有租约持有者执行命令。
    const tabId = crypto.randomUUID();
    currentTabId = tabId;

    // 本地已有持久化片场时加载一次 film 模块（store 在模块求值时从
    // localStorage 恢复），让后续心跳的 film 快照是真实数据；没有
    // 片场时模块永不加载，首屏不为此付 three/fiber 的账。
    try {
      if (localStorage.getItem("zhuya-cine-shots-v1")) void loadCine();
    } catch { /* ignore */ }

    const tick = async () => {
      if (stopped) return;
      try {
        const s = useDesignerStore.getState();
        const design = serializeCurrentDesign(s.floorPlans, s.exterior, s.yardPlan);
        const yardSummary = summarizeYard(s.yardPlan, s.floorPlans[0]);
        const film = serializeFilm();
        const res = await fetch("/api/mcp/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tabId, design, yardSummary, film, ack: acks }),
        });
        acks = [];
        const data = (await res.json()) as { commands?: BridgeCommand[] };
        for (const cmd of data.commands ?? []) {
          try {
            const st = useDesignerStore.getState();
            if (cmd.type === "apply_template") {
              st.applyProjectTemplate(String(cmd.payload.templateId));
              acks.push({ id: cmd.id, ok: true, message: `Template ${cmd.payload.templateId} applied.` });
            } else if (cmd.type === "apply_design") {
              // 应用前后各点一次数,回报**真实发生了什么**。
              // 之前一律回 "Design applied.",于是:院子物件因落在房子占地上被静默丢弃、
              // 或某类根本不支持的操作被忽略时,agent 收到 ok 就以为成了,只能靠事后
              // 对比快照才发现没生效,然后开始瞎猜重试(用户实拍多次)。
              const before = countDesign(useDesignerStore.getState());
              st.applyAiDesign(cmd.payload.design as AiDesignResult, { merge: cmd.payload.merge !== false });
              const after = countDesign(useDesignerStore.getState());
              acks.push({ id: cmd.id, ok: true, message: diffReport(before, after, cmd.payload.design as AiDesignResult) });
            } else if (cmd.type === "yard_auto") {
              const report = runYardAuto(cmd.payload);
              acks.push({ id: cmd.id, ok: !report.startsWith("未知"), message: report });
            } else if (cmd.type === "auto_fix_layout") {
              const report = runAutoFix();
              acks.push({ id: cmd.id, ok: report.startsWith("OK:"), message: report });
            } else if (cmd.type === "check_layout") {
              const report = runLayoutCheck();
              acks.push({ id: cmd.id, ok: report.startsWith("OK:"), message: report });
            } else if (cmd.type.startsWith("film_")) {
              const message = await runFilmCommand(cmd);
              acks.push({ id: cmd.id, ok: true, message });
            } else {
              acks.push({ id: cmd.id, ok: false, message: `Unknown command type ${cmd.type}` });
            }
          } catch (e) {
            acks.push({ id: cmd.id, ok: false, message: e instanceof Error ? e.message : "apply failed" });
          }
        }
        // 有回执就立刻补一趟，让 CLI 少等一个周期。
        // ⚠️ 必须**连新快照一起推**:命令刚改完画布,快照却要等下一个 2s 心跳才更新,
        // agent 套完模板马上 get_design_state 会读到**改之前**的旧快照 → 它以为模板没生效
        // (实测:"模板应用后 rooms 为空数组"),于是退回去手工重建整屋,布局就乱了。
        if (acks.length) {
          const s2 = useDesignerStore.getState();
          await fetch("/api/mcp/sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              tabId,
              design: serializeCurrentDesign(s2.floorPlans, s2.exterior, s2.yardPlan),
              yardSummary: summarizeYard(s2.yardPlan, s2.floorPlans[0]),
              film: serializeFilm(),
              ack: acks,
            }),
          });
          acks = [];
        }
      } catch {
        /* best-effort：本地无 MCP 使用时零打扰 */
      }
    };

    // ⚠️ 定时器放 Web Worker：真实用法里用户在 CLI 干活、浏览器标签在后台——Chrome
    // 会把**主线程** setInterval 节流到约 1 次/分钟（实测 hidden 标签页推送稀成这样，
    // agent 的命令要等一分钟才生效）。Worker 线程的定时器不受页面可见性节流，后台
    // 标签也保持 2s 心跳。Worker 不可用（老浏览器/SSR 安全网）回落主线程定时器。
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    try {
      const src = URL.createObjectURL(new Blob(["setInterval(function(){postMessage(0)},2000)"], { type: "application/javascript" }));
      worker = new Worker(src);
      worker.onmessage = () => void tick();
      URL.revokeObjectURL(src);
    } catch {
      timer = setInterval(tick, 2000);
    }
    void tick(); // 打开即同步一次，别让首个命令等 2s
    return () => {
      stopped = true;
      worker?.terminate();
      if (timer) clearInterval(timer);
    };
  }, []);
}
