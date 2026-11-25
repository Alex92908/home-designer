/**
 * 设计工具面 —— MCP server 与 App 内 AI agent **共用同一份**。
 *
 * 两个消费者:
 *   ① /api/mcp        外部 agent(Claude Code 等)走 MCP JSON-RPC 协议
 *   ② /api/ai-agent   App 内的模型(DeepSeek / GLM / …)走 OpenAI function calling 循环
 *
 * 工具的执行都落到同一条浏览器通道(enqueue → 页面每 2s 拉取执行 → waitResult),
 * 所以两条路径改出来的效果完全一致,描述/schema 也只维护一份。
 */
import { SYSTEM_PROMPT } from "@/lib/aiDesignContract";
import { PROJECT_TEMPLATES } from "@/lib/projectTemplates";
import { ACTION_REGISTRY, ACTION_LIST } from "@/lib/actions";
import { CINE_PRESETS } from "@/lib/cinematic";
import { COSTUMES, DEFAULT_COSTUME, ARCHETYPES, setEra } from "@/lib/characters";
import { getDesign, getFilm, isConnected, isFilmConnected, enqueue, waitResult } from "./state";
import type { McpCommandType } from "./state";

export const TOOLS = [
  {
    name: "get_design_guide",
    description:
      "Returns the FULL design-JSON contract (schema, room types, coordinate system, material/furniture/yard catalogs). READ THIS FIRST before calling apply_design — your design JSON must follow it exactly.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "list_templates",
    description:
      "Lists curated project templates (café / restaurant / office film-sets, villas in many styles). Prefer starting from a template that matches the user's intent, then fine-tune with apply_design {merge:true}.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "apply_project_template",
    description:
      "Applies a curated template as the design base (instant, high quality). Whole-house replace: geometry, doors/windows, furniture, exterior, yard all come from the template.",
    inputSchema: {
      type: "object" as const,
      properties: {
        templateId: { type: "string", description: "Template id from list_templates, e.g. set-cafe" },
      },
      required: ["templateId"] as string[],
    },
  },
  {
    name: "apply_design",
    description:
      "Applies a design JSON (contract: get_design_guide). merge=true (RECOMMENDED after a template base): incremental — only fields you provide change, e.g. one room's furniture or the exterior wall color. merge=false: full rebuild from your JSON (floorLayouts required).",
    inputSchema: {
      type: "object" as const,
      properties: {
        design: { type: "object", description: "Design JSON following the contract from get_design_guide" },
        merge: { type: "boolean", description: "true = incremental fine-tune on current canvas (default); false = full rebuild" },
      },
      required: ["design"] as string[],
    },
  },
  {
    name: "get_design_state",
    description:
      "Returns the current canvas design as a full snapshot (same JSON dialect as apply_design). Use it to verify your changes landed and to base incremental edits on reality.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "check_layout",
    description:
      "Runs the REAL geometry check on the current canvas (indoor furniture clearance + door swing + yard safety distances) and returns concrete violations. Applying a design only means the JSON landed — it does NOT mean the objects fit. ALWAYS call this after apply_design/apply_project_template, then fix the reported items and check again until it returns OK.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "auto_fix_layout",
    description:
      "Lets the APP resolve furniture collisions for you: it repeatedly reads the real geometry and pushes overlapping items apart until clearances pass, then returns the remaining report. USE THIS instead of hand-computing centimetre coordinates — you decide WHAT goes in a room and its style; the app handles the geometry. Call it right after apply_design.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "yard_auto_layout",
    description:
      "Lets the APP compose the yard for you — this is how you get a GOOD-LOOKING yard. mode=preset applies a designer-authored yard package (zones + planting + features, presetId from the error message if unknown); mode=plant scatters N trees with proper spacing away from the house; mode=paths auto-routes walkways between zones. PREFER THIS over hand-writing yard.add coordinates: collision checks only prevent overlap, they cannot make a layout look designed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mode: { type: "string", description: "preset | plant | paths" },
        presetId: { type: "string", description: "for mode=preset; call with a wrong id to list the available packages" },
        count: { type: "number", description: "for mode=plant; how many trees (default 6)" },
      },
      required: ["mode"] as string[],
    },
  },
  {
    name: "open_preview",
    description: "Returns the preview URL and how to view the design (exterior orbit, per-room views, first/third-person walkthrough).",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  // ── 出短片 film_* ──
  // 同一条命令桥（enqueue → 浏览器 useMcpBridge 落进 useCineStore → waitResult），
  // 所以外部 MCP 与 App 内 agent 共用。坐标是地面世界坐标 [x, z]（米），与演员
  // from/to 同系；浏览器侧 placePoint 会把越界点钳到房子边上（回执里会说明）。
  // HONEST LIMITS（Stage A 只有控制面，没有这些内容包）：没有球/球物理（"kick"
  // 只是打斗动作，没有球可踢/传/接）；没有跳舞、没有唱歌/口型同步、没有话筒道具。
  // 足球/篮球/MV 歌舞目前做不了 —— 需后续内容包（ball pack / dance-sync pack /
  // singing pack），见 film_list_actions 的说明。
  {
    name: "film_list_sets",
    description: "Lists the film sets （片场） you can open: id, name, era, floors, rooms. Use film_open_set to load one.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "film_open_set",
    description: "Opens a film set IN PLACE (loads the template on the current canvas, no reload — a reload would lose queued commands). Returns the film URL /?shortfilm=1&template=<id> for viewing. The open page must already be running the designer; the film panel opens from ?shortfilm=1.",
    inputSchema: {
      type: "object" as const,
      properties: {
        templateId: { type: "string", description: "Set id from film_list_sets, e.g. set-cafe" },
      },
      required: ["templateId"] as string[],
    },
  },
  {
    name: "film_get_state",
    description: "Returns the WHOLE film scene in ONE call: all actors (id/name/role/action/costume/from/to/waypoints/timeline), all shots, sim status, export-queue progress. Call this FIRST to coordinate N actors instead of driving them one blind call at a time, and again after mutations to verify they landed.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "film_list_actions",
    description: "Lists the 30 actor actions grouped by category (move/pose/gesture/fight/stunt) with ids + Chinese names + default durations. NOTE: there is NO dance action, NO singing/lip-sync, and NO ball object — 'kick' is a fight move with nothing to kick. Do not choreograph soccer/basketball/MV singing-dancing; those need future content packs.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "film_list_costumes",
    description: "Lists all costumes (id, Chinese/English label, era, archetype, colors, accessory) plus the 24 character archetypes and which costumes each offers. Use the ids in film_add_actor / film_set_actor.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "film_add_actor",
    description: "Adds ONE actor by two points: from [x,z] → to [x,z] (ground world coords, metres). Goes through the panel's own two-click path, so an unused, era-fitting costume is auto-assigned when costumeId is omitted. Returns the new actor id — keep it for later calls.",
    inputSchema: {
      type: "object" as const,
      properties: {
        from: { type: "array", description: "[x, z] start point (metres, ground world coords)", items: { type: "number" } },
        to: { type: "array", description: "[x, z] end point (metres, ground world coords)", items: { type: "number" } },
        name: { type: "string", description: "Character name, e.g. 店主" },
        role: { type: "string", description: "Role, e.g. 顾客" },
        action: { type: "string", description: "Default action id from film_list_actions, e.g. walk" },
        costumeId: { type: "string", description: "Costume id from film_list_costumes; omit for auto-assignment" },
        archetypeId: { type: "string", description: "Archetype id from film_list_costumes, e.g. ceo" },
        facing: { type: "number", description: "Facing in radians (0 = +Z); omit to face along from→to" },
      },
      required: ["from", "to"] as string[],
    },
  },
  {
    name: "film_set_actor",
    description: "Patches one actor (name/role/facing/action/archetypeId/costumeId/from/to). Only the fields you send change.",
    inputSchema: {
      type: "object" as const,
      properties: {
        actorId: { type: "string", description: "Actor id from film_get_state" },
        patch: { type: "object", description: "Partial actor fields: name, role, facing, action, archetypeId, costumeId, from [x,z], to [x,z]" },
      },
      required: ["actorId", "patch"] as string[],
    },
  },
  {
    name: "film_move_actor",
    description: "Moves one actor's path: new from and/or to [x, z].",
    inputSchema: {
      type: "object" as const,
      properties: {
        actorId: { type: "string", description: "Actor id from film_get_state" },
        from: { type: "array", description: "New [x, z] start point", items: { type: "number" } },
        to: { type: "array", description: "New [x, z] end point", items: { type: "number" } },
      },
      required: ["actorId"] as string[],
    },
  },
  {
    name: "film_remove_actor",
    description: "Removes one actor (also detaches them from any fight choreography).",
    inputSchema: {
      type: "object" as const,
      properties: {
        actorId: { type: "string", description: "Actor id from film_get_state" },
      },
      required: ["actorId"] as string[],
    },
  },
  {
    name: "film_add_waypoint",
    description: "Appends one path waypoint [x, z] to an actor's walk timeline (t auto-set 2s after the previous point). If the actor has no waypoints yet, the existing from→to is kept as the first two points.",
    inputSchema: {
      type: "object" as const,
      properties: {
        actorId: { type: "string", description: "Actor id from film_get_state" },
        x: { type: "number", description: "Ground x (metres)" },
        z: { type: "number", description: "Ground z (metres)" },
      },
      required: ["actorId", "x", "z"] as string[],
    },
  },
  {
    name: "film_move_waypoint",
    description: "Moves/retimes one waypoint by index (patch: x, z, t, y, facing). Waypoints stay sorted by t.",
    inputSchema: {
      type: "object" as const,
      properties: {
        actorId: { type: "string", description: "Actor id from film_get_state" },
        index: { type: "number", description: "Waypoint index (0-based, see film_get_state)" },
        patch: { type: "object", description: "Partial waypoint fields: x, z, t (seconds in shot), y (height in metres), facing (radians)" },
      },
      required: ["actorId", "index", "patch"] as string[],
    },
  },
  {
    name: "film_remove_waypoint",
    description: "Removes one waypoint by index. Removing down to fewer than 2 waypoints clears the walk timeline (actor falls back to from→to).",
    inputSchema: {
      type: "object" as const,
      properties: {
        actorId: { type: "string", description: "Actor id from film_get_state" },
        index: { type: "number", description: "Waypoint index (0-based, see film_get_state)" },
      },
      required: ["actorId", "index"] as string[],
    },
  },
  {
    name: "film_set_actor_waypoints",
    description: "Bulk-replaces ONE actor's whole walk path in one call: waypoints [[x, z, t], ...] (t = seconds in shot). Replaces whatever was there.",
    inputSchema: {
      type: "object" as const,
      properties: {
        actorId: { type: "string", description: "Actor id from film_get_state" },
        waypoints: { type: "array", description: "[[x, z, t], ...] — x/z metres, t seconds in shot, ascending t", items: { type: "array", items: { type: "number" } } },
      },
      required: ["actorId", "waypoints"] as string[],
    },
  },
  {
    name: "film_set_group_action",
    description: "THE multi-actor call: adds ONE action segment (same action + start + duration) to EACH listed actor's timeline, so N actors move AT THE SAME TIME on the shared sim clock. All actor ids + the action id are validated FIRST — if any is bad, the whole call fails with nothing applied. Returns per-actor segment ids. Use for synchronized group choreography (group fight, group walk, group wave). NOTE: no ball/dance/singing exists, so this cannot stage soccer, basketball, or MV singing-dancing.",
    inputSchema: {
      type: "object" as const,
      properties: {
        actorIds: { type: "array", description: "Actor ids from film_get_state (all must exist)", items: { type: "string" } },
        action: { type: "string", description: "Action id from film_list_actions, e.g. punch, wave, walk" },
        start: { type: "number", description: "Start time in seconds within the shot" },
        duration: { type: "number", description: "Segment duration in seconds (omit = action default)" },
        targetPos: { type: "array", description: "Destination [x, z] for move actions", items: { type: "number" } },
        targetActorId: { type: "string", description: "Opponent actor id for fight actions" },
        facing: { type: "number", description: "Facing in radians at the end of the segment" },
        targetY: { type: "number", description: "Destination height in metres (tabletop / rooftop / flying)" },
        safety: { type: "string", description: "Stunt safety note, e.g. 威亚+垫子" },
        propKind: { type: "string", description: "Stunt prop kind for this segment (see stunt props)" },
      },
      required: ["actorIds", "action", "start"] as string[],
    },
  },
  {
    name: "film_add_shot",
    description: "Adds one camera shot from a preset (orbit, dolly-in, crane-up, indoor-wide, indoor-medium, group-wide, indoor-closeup, indoor-ots). group-wide frames the whole group by centroid + horizontal envelope — use it for group scenes. Returns the new shot id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        presetId: { type: "string", description: "Preset id: orbit | dolly-in | crane-up | indoor-wide | indoor-medium | group-wide | indoor-closeup | indoor-ots" },
        targetActorId: { type: "string", description: "Actor this shot frames (omit = first actor)" },
        duration: { type: "number", description: "Shot duration in seconds (omit = preset default)" },
        prompt: { type: "string", description: "Shot prompt (style/content note, exported with the storyboard)" },
        dialogue: { type: "string", description: "Dialogue line for this shot" },
      },
      required: ["presetId"] as string[],
    },
  },
  {
    name: "film_update_shot",
    description: "Patches one shot: duration, prompt, dialogue, targetActorId, lightingId, musicMood. The preset itself cannot be changed — remove the shot and add a new one instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        shotId: { type: "string", description: "Shot id from film_get_state" },
        patch: { type: "object", description: "Partial shot fields: duration, prompt, dialogue, targetActorId, lightingId, musicMood" },
      },
      required: ["shotId", "patch"] as string[],
    },
  },
  {
    name: "film_remove_shot",
    description: "Removes one shot by id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        shotId: { type: "string", description: "Shot id from film_get_state" },
      },
      required: ["shotId"] as string[],
    },
  },
  {
    name: "film_start_sim",
    description: "Starts the shoot simulation: all actors move together on the shared clock through the shots in order. Requires at least 1 shot (add one with film_add_shot first).",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "film_stop_sim",
    description: "Stops the shoot simulation.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
  {
    name: "film_export_storyboard",
    description: "Starts the storyboard batch export (all shots × styles). ASYNC: the ack means 'started', NOT 'done' — the browser renders frame by frame and downloads storyboard.json + the video when the batch finishes. Watch progress with film_get_state (queue). Requires at least 1 shot.",
    inputSchema: { type: "object" as const, properties: {}, required: [] as string[] },
  },
];

function templateSummaries() {
  return PROJECT_TEMPLATES.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description ?? "",
    floors: t.floorLayouts.length,
    rooms: t.floorLayouts.map(fl => fl.rooms.map(r => r.name ?? r.room)).flat(),
  }));
}

const NOT_CONNECTED_MSG =
  "Browser not connected: open the 筑雅 designer page in a browser first — it syncs with this server every 2s. The command stays queued and will apply once the page is open.";

// ── film_* helpers ──────────────────────────────────────────────────────────
const FILM_NOT_CONNECTED_MSG =
  "Browser film state not connected: open the designer page (/?shortfilm=1) in a browser first — it syncs film state with this server every 2s.";

const ACTION_IDS = new Set(Object.keys(ACTION_REGISTRY));
const COSTUME_IDS = new Set([...Object.keys(COSTUMES), DEFAULT_COSTUME.id]);
const ARCHETYPE_IDS = new Set(ARCHETYPES.map(a => a.id));
const PRESET_IDS = new Set(CINE_PRESETS.map(p => p.id));

interface FilmActorSnap {
  id: string;
  name?: string;
  waypoints?: Array<{ x: number; z: number; t: number }>;
  timeline?: Array<{ id: string }>;
}
interface FilmShotSnap { id: string; presetId: string; duration: number; targetActorId?: string }
interface FilmSnap {
  actors: FilmActorSnap[];
  shots: FilmShotSnap[];
  sim: { active: boolean; playing: boolean; shotIdx: number; timeSec: number };
  queue: { active: boolean; progress: number; total: number; queueIdx: number };
}

/** Latest film snapshot pushed by the browser (null = never pushed / stale shape). */
function filmSnapshot(): FilmSnap | null {
  const { film } = getFilm();
  if (!film || typeof film !== "object") return null;
  const f = film as Partial<FilmSnap>;
  if (!Array.isArray(f.actors) || !Array.isArray(f.shots)) return null;
  return f as FilmSnap;
}

/** Compact post-mutation summary from the fresh film snapshot — the browser
 *  re-pushes film state immediately together with the ack, so this reads
 *  post-change state, not a 2s-old one. */
function filmSummary(): Record<string, unknown> {
  const s = filmSnapshot();
  if (!s) return {};
  return {
    actors: s.actors.length,
    actorIds: s.actors.map(a => a.id),
    shots: s.shots.length,
    shotIds: s.shots.map(x => x.id),
    sim: s.sim,
    queue: s.queue,
  };
}

function okErr(error: string): string {
  return JSON.stringify({ ok: false, error });
}

function finiteNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asPoint(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const x = finiteNum(v[0]), z = finiteNum(v[1]);
  return x === null || z === null ? null : [x, z];
}

/** Mutating film command: enqueue → wait for the browser ack → ack message +
 *  compact resulting-state summary.
 *
 *  等 60s（不是设计工具的 12s）：浏览器在重型 3D 场景里跑，apply 后主线程
 *  常被模型加载占住几十秒才回推；12s 就报超时会让 agent 以为失败而重试，
 *  重试又会重复执行（比如 film_add_actor 重试一次就多出一个演员）。
 *  等久一点，拿到的是浏览器真实回执，不是假超时。 */
async function runFilmCommand(type: McpCommandType, payload: Record<string, unknown>, timeoutMs = 60_000): Promise<string> {
  const id = enqueue(type, payload);
  if (!isFilmConnected()) return JSON.stringify({ ok: false, queued: true, error: FILM_NOT_CONNECTED_MSG });
  const r = await waitResult(id, timeoutMs);
  if (!r) return JSON.stringify({ ok: false, queued: true, error: "Timed out waiting for the browser to apply (is the page open and visible?)" });
  return JSON.stringify({ ok: r.ok, message: r.message ?? "", state: filmSummary() });
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "get_design_guide": {
      return [
        "# 筑雅 design-JSON contract (same one our server LLM uses)",
        "",
        SYSTEM_PROMPT,
        "",
        "# usage notes",
        "- Workflow: list_templates → apply_project_template (base) → apply_design {merge:true} for the user's specifics → get_design_state to verify.",
        "- merge=true means: only the fields you send change. Send ONLY deltas (e.g. one room's furniture array, or exterior.wallColor).",
        "- Coordinates: room-local cm, origin at the room's NW (back-left) corner, x→East, z→South; furniture rotation in degrees.",
      ].join("\n");
    }
    case "list_templates": {
      return JSON.stringify({ templates: templateSummaries() }, null, 2);
    }
    case "apply_project_template": {
      const templateId = String(args.templateId ?? "");
      const tpl = PROJECT_TEMPLATES.find(t => t.id === templateId);
      if (!tpl) {
        return JSON.stringify({ ok: false, error: `Unknown templateId "${templateId}". Call list_templates for valid ids.` });
      }
      const id = enqueue("apply_template", { templateId });
      if (!isConnected()) return JSON.stringify({ ok: false, queued: true, error: NOT_CONNECTED_MSG });
      const r = await waitResult(id);
      return JSON.stringify(r
        ? { ok: r.ok, applied: tpl.name, message: r.message ?? (r.ok ? "Template applied on canvas." : "Browser failed to apply.") }
        : { ok: false, queued: true, error: "Timed out waiting for the browser to apply (is the page open and visible?)" });
    }
    case "apply_design": {
      const design = args.design;
      const merge = args.merge !== false; // 默认增量——模板底子工作流的常态
      if (!design || typeof design !== "object") {
        return JSON.stringify({ ok: false, error: "`design` must be an object following the contract from get_design_guide." });
      }
      if (!merge && !Array.isArray((design as Record<string, unknown>).floorLayouts)) {
        return JSON.stringify({ ok: false, error: "Full rebuild (merge=false) requires design.floorLayouts (array). For incremental edits use merge=true." });
      }
      const id = enqueue("apply_design", { design, merge });
      if (!isConnected()) return JSON.stringify({ ok: false, queued: true, error: NOT_CONNECTED_MSG });
      const r = await waitResult(id);
      return JSON.stringify(r
        ? { ok: r.ok, merge, message: r.message ?? (r.ok ? "Design applied on canvas." : "Browser failed to apply.") }
        : { ok: false, queued: true, error: "Timed out waiting for the browser to apply (is the page open and visible?)" });
    }
    case "auto_fix_layout": {
      const id = enqueue("auto_fix_layout", {});
      if (!isConnected()) return JSON.stringify({ ok: false, queued: true, error: NOT_CONNECTED_MSG });
      const r = await waitResult(id, 30_000);   // 迭代求解比单次校验慢
      return r
        ? JSON.stringify({ ok: r.ok, report: r.message })
        : JSON.stringify({ ok: false, error: "Timed out waiting for the browser to auto-fix the layout." });
    }
    case "yard_auto_layout": {
      const id = enqueue("yard_auto", args);
      if (!isConnected()) return JSON.stringify({ ok: false, queued: true, error: NOT_CONNECTED_MSG });
      const r = await waitResult(id, 20_000);
      return r
        ? JSON.stringify({ ok: r.ok, report: r.message })
        : JSON.stringify({ ok: false, error: "Timed out waiting for the browser to run the yard auto-layout." });
    }
    case "check_layout": {
      // 真实几何校验只能在浏览器里跑(要当前 store 的房间尺寸/门窗 + 家具目录的实际长宽高),
      // 故和 apply_* 一样走命令桥。见 useMcpBridge.runLayoutCheck。
      const id = enqueue("check_layout", {});
      if (!isConnected()) return JSON.stringify({ ok: false, queued: true, error: NOT_CONNECTED_MSG });
      const r = await waitResult(id);
      return r
        ? JSON.stringify({ ok: r.ok, report: r.message })
        : JSON.stringify({ ok: false, error: "Timed out waiting for the browser to run the layout check." });
    }
    case "get_design_state": {
      const { design, ageMs, connected, yardSummary } = getDesign();
      if (!design) return JSON.stringify({ connected, error: NOT_CONNECTED_MSG });
      // yardSummary 补 design.yard 的盲区(分区/小径/导入模型不在 apply 契约里,
      // 只看 design.yard 会误判「院子是空的」)。
      return JSON.stringify({ connected, snapshotAgeMs: Math.round(ageMs), yardSummary, design }, null, 2);
    }
    case "open_preview": {
      return JSON.stringify({
        url: "/",
        views: {
          exterior: "默认外观图：轨道相机环视整栋 + 院子",
          rooms: "左侧房间列表进任意房间效果图",
          walkthrough: "外观图右上「🚶 进入室内漫游」；HUD 可切第三人称人物 + 换角色；WASD 行走、Shift 疾跑、E 开门",
        },
        tip: "The canvas updates live as you apply designs.",
      }, null, 2);
    }
    // ── 出短片 film_* ──
    case "film_list_sets": {
      return JSON.stringify({
        sets: PROJECT_TEMPLATES.map(t => ({
          id: t.id,
          name: t.name,
          nameEn: t.nameEn,
          era: setEra(t.id) ?? "modern",
          floors: t.floorLayouts.length,
          rooms: t.floorLayouts.map(fl => fl.rooms.map(r => r.name ?? r.room)).flat(),
          areaSqm: t.areaSqm,
        })),
      }, null, 2);
    }
    case "film_open_set": {
      const templateId = String(args.templateId ?? "");
      const tpl = PROJECT_TEMPLATES.find(t => t.id === templateId);
      if (!tpl) return okErr(`Unknown set id "${templateId}". Call film_list_sets for valid ids.`);
      // 复用 apply_template 入队：在当前画布原地加载模板，不导航、不刷新
      // （刷新会丢掉已入队的回执）。
      const id = enqueue("apply_template", { templateId });
      if (!isConnected()) return JSON.stringify({ ok: false, queued: true, error: NOT_CONNECTED_MSG });
      const r = await waitResult(id);
      if (!r) return JSON.stringify({ ok: false, queued: true, error: "Timed out waiting for the browser to open the set (is the page open and visible?)" });
      return JSON.stringify({ ok: r.ok, set: { id: tpl.id, name: tpl.name }, filmUrl: `/?shortfilm=1&template=${tpl.id}`, message: r.message ?? "" });
    }
    case "film_get_state": {
      const { film, ageMs, connected } = getFilm();
      if (!film) return JSON.stringify({ connected, error: FILM_NOT_CONNECTED_MSG });
      return JSON.stringify({ connected, snapshotAgeMs: Math.round(ageMs), film }, null, 2);
    }
    case "film_list_actions": {
      const order = ["move", "pose", "gesture", "fight", "stunt"] as const;
      return JSON.stringify({
        categories: order.map(cat => ({
          category: cat,
          actions: ACTION_LIST.filter(a => a.category === cat).map(a => ({
            id: a.id, nameZh: a.nameZh, nameEn: a.nameEn, duration: a.duration, loop: a.loop,
          })),
        })),
        note: "No dance, singing/lip-sync, or ball actions exist yet — 'kick' is a fight move with no ball object. Soccer/basketball/MV singing-dancing need future content packs.",
      }, null, 2);
    }
    case "film_list_costumes": {
      const all = [DEFAULT_COSTUME, ...Object.values(COSTUMES)];
      return JSON.stringify({
        costumes: all.map(c => ({
          id: c.id, labelZh: c.labelZh, labelEn: c.labelEn, era: c.era,
          archetypeId: c.archetypeId ?? null, colors: c.colors, accessory: c.accessory, skirt: !!c.skirt,
        })),
        archetypes: ARCHETYPES.map(a => ({ id: a.id, nameZh: a.nameZh, nameEn: a.nameEn, costumes: a.costumes })),
      }, null, 2);
    }
    case "film_add_actor": {
      const from = asPoint(args.from);
      const to = asPoint(args.to);
      if (!from) return okErr("`from` must be [x, z] with finite numbers (metres, ground world coords).");
      if (!to) return okErr("`to` must be [x, z] with finite numbers (metres, ground world coords).");
      if (args.action !== undefined && !ACTION_IDS.has(String(args.action))) return okErr(`Unknown action "${args.action}". Call film_list_actions for valid ids.`);
      if (args.costumeId !== undefined && !COSTUME_IDS.has(String(args.costumeId))) return okErr(`Unknown costumeId "${args.costumeId}". Call film_list_costumes for valid ids.`);
      if (args.archetypeId !== undefined && !ARCHETYPE_IDS.has(String(args.archetypeId))) return okErr(`Unknown archetypeId "${args.archetypeId}". Call film_list_costumes for valid archetype ids.`);
      if (args.facing !== undefined && finiteNum(args.facing) === null) return okErr("`facing` must be a finite number (radians).");
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      const beforeIds = new Set(snap.actors.map(a => a.id));
      const payload: Record<string, unknown> = { from, to };
      for (const k of ["name", "role", "action", "costumeId", "archetypeId", "facing"] as const) {
        if (args[k] !== undefined) payload[k] = args[k];
      }
      const res = await runFilmCommand("film_add_actor", payload);
      const parsed = JSON.parse(res) as { ok: boolean };
      if (!parsed.ok) return res;
      const created = filmSnapshot()?.actors.find(a => !beforeIds.has(a.id));
      return JSON.stringify({
        ...parsed,
        actorId: created?.id ?? null,
        ...(!created ? { note: "Browser reported success but the new actor id could not be read from the fresh snapshot — call film_get_state." } : {}),
      });
    }
    case "film_set_actor": {
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      const actorId = String(args.actorId ?? "");
      if (!snap.actors.some(a => a.id === actorId)) return okErr(`Unknown actorId "${actorId}". Call film_get_state for valid actor ids.`);
      const patch = (args.patch ?? {}) as Record<string, unknown>;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return okErr("`patch` must be an object: {name?, role?, facing?, action?, archetypeId?, costumeId?, from?, to?}.");
      if (patch.action !== undefined && !ACTION_IDS.has(String(patch.action))) return okErr(`Unknown action "${patch.action}" in patch. Call film_list_actions for valid ids.`);
      if (patch.costumeId !== undefined && !COSTUME_IDS.has(String(patch.costumeId))) return okErr(`Unknown costumeId "${patch.costumeId}" in patch. Call film_list_costumes for valid ids.`);
      if (patch.archetypeId !== undefined && !ARCHETYPE_IDS.has(String(patch.archetypeId))) return okErr(`Unknown archetypeId "${patch.archetypeId}" in patch. Call film_list_costumes for valid archetype ids.`);
      if (patch.facing !== undefined && finiteNum(patch.facing) === null) return okErr("`facing` in patch must be a finite number (radians).");
      for (const k of ["from", "to"] as const) {
        if (patch[k] !== undefined && !asPoint(patch[k])) return okErr(`\`${k}\` in patch must be [x, z] with finite numbers.`);
      }
      const clean: Record<string, unknown> = {};
      for (const k of ["name", "role", "facing", "action", "archetypeId", "costumeId", "from", "to"] as const) {
        if (patch[k] !== undefined) clean[k] = patch[k];
      }
      return runFilmCommand("film_set_actor", { actorId, patch: clean });
    }
    case "film_move_actor": {
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      const actorId = String(args.actorId ?? "");
      if (!snap.actors.some(a => a.id === actorId)) return okErr(`Unknown actorId "${actorId}". Call film_get_state for valid actor ids.`);
      const from = args.from === undefined ? undefined : asPoint(args.from);
      const to = args.to === undefined ? undefined : asPoint(args.to);
      if (args.from !== undefined && !from) return okErr("`from` must be [x, z] with finite numbers.");
      if (args.to !== undefined && !to) return okErr("`to` must be [x, z] with finite numbers.");
      if (!from && !to) return okErr("Give at least one of `from` / `to`.");
      return runFilmCommand("film_move_actor", { actorId, ...(from ? { from } : {}), ...(to ? { to } : {}) });
    }
    case "film_remove_actor": {
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      const actorId = String(args.actorId ?? "");
      if (!snap.actors.some(a => a.id === actorId)) return okErr(`Unknown actorId "${actorId}". Call film_get_state for valid actor ids.`);
      return runFilmCommand("film_remove_actor", { actorId });
    }
    case "film_add_waypoint": {
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      const actorId = String(args.actorId ?? "");
      if (!snap.actors.some(a => a.id === actorId)) return okErr(`Unknown actorId "${actorId}". Call film_get_state for valid actor ids.`);
      const x = finiteNum(args.x), z = finiteNum(args.z);
      if (x === null || z === null) return okErr("`x` and `z` must be finite numbers (metres).");
      return runFilmCommand("film_add_waypoint", { actorId, x, z });
    }
    case "film_move_waypoint":
    case "film_remove_waypoint": {
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      const actorId = String(args.actorId ?? "");
      const actor = snap.actors.find(a => a.id === actorId);
      if (!actor) return okErr(`Unknown actorId "${actorId}". Call film_get_state for valid actor ids.`);
      const idx = finiteNum(args.index);
      const wps = actor.waypoints ?? [];
      if (idx === null || !Number.isInteger(idx) || idx < 0 || idx >= wps.length) {
        return okErr(`Unknown waypoint index ${String(args.index)} for actor "${actorId}" (has ${wps.length} waypoint${wps.length === 1 ? "" : "s"}). Call film_get_state to see them.`);
      }
      if (name === "film_remove_waypoint") return runFilmCommand("film_remove_waypoint", { actorId, index: idx });
      const patch = (args.patch ?? {}) as Record<string, unknown>;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return okErr("`patch` must be an object: {x?, z?, t?, y?, facing?}.");
      for (const k of ["x", "z", "t", "y", "facing"] as const) {
        if (patch[k] !== undefined && finiteNum(patch[k]) === null) return okErr(`\`${k}\` in patch must be a finite number.`);
      }
      if (patch.t !== undefined && (finiteNum(patch.t) as number) < 0) return okErr("`t` in patch must be >= 0 (seconds in shot).");
      const clean: Record<string, unknown> = {};
      for (const k of ["x", "z", "t", "y", "facing"] as const) {
        if (patch[k] !== undefined) clean[k] = patch[k];
      }
      return runFilmCommand("film_move_waypoint", { actorId, index: idx, patch: clean });
    }
    case "film_set_actor_waypoints": {
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      const actorId = String(args.actorId ?? "");
      if (!snap.actors.some(a => a.id === actorId)) return okErr(`Unknown actorId "${actorId}". Call film_get_state for valid actor ids.`);
      if (!Array.isArray(args.waypoints)) return okErr("`waypoints` must be an array of [x, z, t] triples.");
      const wps: Array<[number, number, number]> = [];
      for (const w of args.waypoints) {
        if (!Array.isArray(w) || w.length < 3) return okErr("Each waypoint must be [x, z, t] (metres, metres, seconds in shot).");
        const x = finiteNum(w[0]), z = finiteNum(w[1]), t = finiteNum(w[2]);
        if (x === null || z === null || t === null || t < 0) return okErr(`Bad waypoint ${JSON.stringify(w)}: x/z/t must be finite numbers and t >= 0.`);
        wps.push([x, z, t]);
      }
      return runFilmCommand("film_set_actor_waypoints", { actorId, waypoints: wps });
    }
    case "film_set_group_action": {
      // 全量校验先行：任何一个 id 不合法，整单失败、一个段也不加。
      const actorIdsRaw = args.actorIds;
      if (!Array.isArray(actorIdsRaw) || !actorIdsRaw.length) return okErr("`actorIds` must be a non-empty array of actor ids.");
      const action = String(args.action ?? "");
      if (!ACTION_IDS.has(action)) return okErr(`Unknown action "${action}". Call film_list_actions for valid ids.`);
      const start = finiteNum(args.start);
      if (start === null || start < 0) return okErr("`start` must be a finite number >= 0 (seconds in shot).");
      const duration = args.duration === undefined ? undefined : finiteNum(args.duration);
      if (duration === null || (duration !== undefined && duration <= 0)) return okErr("`duration` must be a finite number > 0 (seconds).");
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      const actorIds = [...new Set(actorIdsRaw.map(String))];
      const missing = actorIds.filter(id => !snap.actors.some(a => a.id === id));
      if (missing.length) return okErr(`Unknown actorId(s): ${missing.map(m => `"${m}"`).join(", ")}. Nothing was applied — call film_get_state for valid actor ids.`);
      let targetActorId: string | undefined;
      if (args.targetActorId !== undefined) {
        targetActorId = String(args.targetActorId);
        if (!snap.actors.some(a => a.id === targetActorId)) return okErr(`Unknown targetActorId "${targetActorId}". Call film_get_state for valid actor ids.`);
      }
      const targetPos = args.targetPos === undefined ? undefined : asPoint(args.targetPos);
      if (args.targetPos !== undefined && !targetPos) return okErr("`targetPos` must be [x, z] with finite numbers.");
      for (const k of ["facing", "targetY"] as const) {
        if (args[k] !== undefined && finiteNum(args[k]) === null) return okErr(`\`${k}\` must be a finite number.`);
      }
      const payload: Record<string, unknown> = {
        actorIds, action, start,
        ...(duration !== undefined ? { duration } : {}),
        ...(targetPos ? { targetPos } : {}),
        ...(targetActorId ? { targetActorId } : {}),
      };
      for (const k of ["facing", "targetY", "safety", "propKind"] as const) {
        if (args[k] !== undefined) payload[k] = args[k];
      }
      return runFilmCommand("film_set_group_action", payload);
    }
    case "film_add_shot": {
      const presetId = String(args.presetId ?? "");
      if (!PRESET_IDS.has(presetId)) return okErr(`Unknown presetId "${presetId}". Valid: ${[...PRESET_IDS].join(", ")}.`);
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      let targetActorId: string | undefined;
      if (args.targetActorId !== undefined) {
        targetActorId = String(args.targetActorId);
        if (!snap.actors.some(a => a.id === targetActorId)) return okErr(`Unknown targetActorId "${targetActorId}". Call film_get_state for valid actor ids.`);
      }
      const duration = args.duration === undefined ? undefined : finiteNum(args.duration);
      if (duration === null || (duration !== undefined && duration <= 0)) return okErr("`duration` must be a finite number > 0 (seconds).");
      const beforeIds = new Set(snap.shots.map(s => s.id));
      const payload: Record<string, unknown> = {
        presetId,
        ...(targetActorId ? { targetActorId } : {}),
        ...(duration !== undefined ? { duration } : {}),
      };
      for (const k of ["prompt", "dialogue"] as const) {
        if (args[k] !== undefined) payload[k] = args[k];
      }
      const res = await runFilmCommand("film_add_shot", payload);
      const parsed = JSON.parse(res) as { ok: boolean };
      if (!parsed.ok) return res;
      const created = filmSnapshot()?.shots.find(s => !beforeIds.has(s.id));
      return JSON.stringify({
        ...parsed,
        shotId: created?.id ?? null,
        ...(!created ? { note: "Browser reported success but the new shot id could not be read from the fresh snapshot — call film_get_state." } : {}),
      });
    }
    case "film_update_shot": {
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      const shotId = String(args.shotId ?? "");
      if (!snap.shots.some(s => s.id === shotId)) return okErr(`Unknown shotId "${shotId}". Call film_get_state for valid shot ids.`);
      const patch = (args.patch ?? {}) as Record<string, unknown>;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return okErr("`patch` must be an object: {duration?, prompt?, dialogue?, targetActorId?, lightingId?, musicMood?}.");
      if (patch.presetId !== undefined) return okErr("A shot's preset cannot be changed — remove the shot (film_remove_shot) and add a new one (film_add_shot).");
      if (patch.targetActorId !== undefined && !snap.actors.some(a => a.id === String(patch.targetActorId))) {
        return okErr(`Unknown targetActorId "${patch.targetActorId}" in patch. Call film_get_state for valid actor ids.`);
      }
      if (patch.duration !== undefined) {
        const d = finiteNum(patch.duration);
        if (d === null || d <= 0) return okErr("`duration` in patch must be a finite number > 0 (seconds).");
      }
      const clean: Record<string, unknown> = {};
      for (const k of ["duration", "prompt", "dialogue", "targetActorId", "lightingId", "musicMood"] as const) {
        if (patch[k] !== undefined) clean[k] = patch[k];
      }
      return runFilmCommand("film_update_shot", { shotId, patch: clean });
    }
    case "film_remove_shot": {
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      const shotId = String(args.shotId ?? "");
      if (!snap.shots.some(s => s.id === shotId)) return okErr(`Unknown shotId "${shotId}". Call film_get_state for valid shot ids.`);
      return runFilmCommand("film_remove_shot", { shotId });
    }
    case "film_start_sim": {
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      if (!snap.shots.length) return okErr("No shots yet — add one with film_add_shot first (e.g. presetId \"group-wide\"), then start the sim.");
      return runFilmCommand("film_start_sim", {});
    }
    case "film_stop_sim": {
      return runFilmCommand("film_stop_sim", {});
    }
    case "film_export_storyboard": {
      const snap = filmSnapshot();
      if (!snap) return okErr(FILM_NOT_CONNECTED_MSG);
      if (!snap.shots.length) return okErr("No shots yet — add one with film_add_shot first.");
      const res = await runFilmCommand("film_start_storyboard", {});
      const parsed = JSON.parse(res) as { ok: boolean };
      if (!parsed.ok) return res;
      return JSON.stringify({
        ...parsed,
        started: true,
        shots: snap.shots.length,
        note: "Export STARTED in the browser — storyboard.json + the video download there when the batch finishes. This call does NOT mean the files exist yet; watch queue progress with film_get_state.",
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** MCP 的 inputSchema → OpenAI function-calling 的 tools 数组(DeepSeek/GLM/Qwen 等通用)。 */
export function toolsForOpenAI() {
  return TOOLS.map(t => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}
