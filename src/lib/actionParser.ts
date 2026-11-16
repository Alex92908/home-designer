/**
 * actionParser —— 文字催动动作（规则解析，不调 LLM，纯客户端）。
 *
 * 句式：[角色][动词][目标/对手]，多动词一句可连写（"男主走到窗边坐下"）。
 * 解析三要素：
 *   1. 角色：按演员名字/角色名匹配；男主/女主/配角按名字含该词匹配，
 *      否则按顺序（男主=第1人，女主=第2人，配角=第3人）；他/她 = 上一句的人。
 *   2. 动词：按"越具体越先匹配"的顺序扫（御剑飞行 > 飞；跳车窗 > 跳车 > 跳）。
 *   3. 目标：家具锚点（场景里已摆的家具，按名字关键词）/ 特技道具
 *      （树/车/火车…，场景里没有则标记 needProp，由面板自动补一个）/
 *      方位词（中央/左边/窗边/门口…）/ 找不到 → 场景中央并明说。
 * 听不懂时不乱做：返回 ok:false + 一句"没听懂" + 最接近的正确句式建议。
 */
import type { FloorPlan } from "./types";
import { getFurnitureById } from "./furniture";
import { ACTION_REGISTRY, type ActionId } from "./actions";
import type { StuntPropKind } from "./stuntProps";

/** 场景锚点：家具世界坐标（米）+ 顶面高度（站上去用） */
export interface SceneAnchor {
  name: string;
  x: number;
  z: number;
  /** 顶面高度（米）= 家具 height(cm)/100 */
  topY: number;
}

export interface SceneContext {
  actors: Array<{ id: string; name: string; role?: string }>;
  anchors: SceneAnchor[];
  /** 场景里已有的特技道具 */
  stuntProps: Array<{ kind: string; x: number; z: number }>;
  /** 场景包络（米） */
  W: number;
  D: number;
  door?: [number, number];
  windowWall?: "N" | "S" | "W" | "E";
}

export interface ParsedInstruction {
  actorId: string;
  actorName: string;
  action: ActionId;
  targetPos?: [number, number];
  targetY?: number;
  arc?: { peak: number };
  targetActorId?: string;
  facing?: number;
  safety?: string;
  propKind?: StuntPropKind;
  /** 场景里缺这个特技道具，面板应自动补一个（放在目标位置附近） */
  needProp?: StuntPropKind;
  /** 备注（如"目标没找到，放在场景中央"） */
  note?: string;
}

export interface ParseResult {
  ok: boolean;
  instructions: ParsedInstruction[];
  /** 给人看的一句话（成功：做了什么；失败：为什么 + 建议） */
  message: string;
  /** 听不懂时的建议句式 */
  suggestion?: string;
}

/**
 * 场景上下文：从 designer store 的 floorPlans 算家具世界坐标。
 * 坐标换算与 HouseCanvas 同款：房间布局 cm → 世界米，
 * worldX = (lay.x + item.x - minX)/100 - planW/2（Y-down 布局，中心归零）。
 */
export function buildSceneContext(floorPlans: FloorPlan[], activeFloor: number): SceneContext {
  const empty: SceneContext = { actors: [], anchors: [], stuntProps: [], W: 10, D: 10 };
  const fp = floorPlans?.[activeFloor];
  if (!fp) return empty;
  const rooms = fp.enabledRooms ?? [];
  if (!rooms.length) return empty;
  const xs: number[] = [], zs: number[] = [];
  for (const r of rooms) {
    const lay = fp.roomLayout?.[r], dims = fp.roomDimensions?.[r];
    if (!lay || !dims) continue;
    xs.push(lay.x, lay.x + dims.width);
    zs.push(lay.y, lay.y + dims.depth);
  }
  if (!xs.length) return empty;
  const minX = Math.min(...xs), minZ = Math.min(...zs);
  const planW = (Math.max(...xs) - minX) / 100;
  const planD = (Math.max(...zs) - minZ) / 100;
  const anchors: SceneAnchor[] = [];
  for (const r of rooms) {
    const lay = fp.roomLayout?.[r];
    if (!lay) continue;
    for (const item of fp.rooms?.[r]?.placedItems ?? []) {
      const f = getFurnitureById(item.furnitureId);
      if (f && (f as unknown as { mountCeiling?: boolean }).mountCeiling) continue; // 吊灯不站人
      anchors.push({
        name: f?.name ?? item.furnitureId,
        x: (lay.x + item.x - minX) / 100 - planW / 2,
        z: (lay.y + item.z - minZ) / 100 - planD / 2,
        topY: ((f?.height ?? 75) as number) / 100,
      });
    }
  }
  // 门：第一个有门的房间，按 roomDoorWall 算门洞世界坐标
  let door: [number, number] | undefined;
  for (const r of rooms) {
    if (!fp.roomHasDoor?.[r]) continue;
    const lay = fp.roomLayout?.[r], dims = fp.roomDimensions?.[r];
    if (!lay || !dims) continue;
    const wall = fp.roomDoorWall?.[r] ?? "S";
    const pos = fp.roomDoorPos?.[r] ?? dims.width / 2;
    if (wall === "S") door = [(lay.x + pos - minX) / 100 - planW / 2, (lay.y + dims.depth - minZ) / 100 - planD / 2];
    else if (wall === "N") door = [(lay.x + pos - minX) / 100 - planW / 2, (lay.y - minZ) / 100 - planD / 2];
    else if (wall === "W") door = [(lay.x - minX) / 100 - planW / 2, (lay.y + pos - minZ) / 100 - planD / 2];
    else door = [(lay.x + dims.width - minX) / 100 - planW / 2, (lay.y + pos - minZ) / 100 - planD / 2];
    break;
  }
  // 窗最多的墙
  const wallCount: Record<string, number> = { N: 0, S: 0, W: 0, E: 0 };
  for (const r of rooms) {
    for (const w of fp.roomWindows?.[r] ?? []) wallCount[w.wall] = (wallCount[w.wall] ?? 0) + 1;
  }
  let windowWall: "N" | "S" | "W" | "E" = "N";
  let best = -1;
  for (const k of ["N", "S", "W", "E"] as const) {
    if ((wallCount[k] ?? 0) > best) { best = wallCount[k] ?? 0; windowWall = k; }
  }
  return { actors: [], anchors, stuntProps: [], W: Math.max(4, planW), D: Math.max(4, planD), door, windowWall };
}

// ─── 动词表（越具体越靠前）───
interface VerbPattern {
  re: RegExp;
  action: ActionId;
  /** 目标取自动词后的文本（"after"）还是无目标（"none"） */
  target: "after" | "none";
  arcPeak?: number;
  propKind?: StuntPropKind;
  safety?: string;
}

const VERBS: VerbPattern[] = [
  { re: /御剑飞行|御剑/, action: "flySword", target: "none", arcPeak: 3, propKind: "sword", safety: "威亚" },
  { re: /骑着扫帚飞|骑扫帚飞|骑扫帚/, action: "flyBroom", target: "none", arcPeak: 3, propKind: "broom", safety: "威亚" },
  { re: /吊威亚|威亚/, action: "wireFly", target: "after", arcPeak: 3, safety: "威亚+垫子" },
  { re: /飞檐走壁|轻功/, action: "leap", target: "after", arcPeak: 2.5, safety: "威亚+垫子" },
  { re: /索降/, action: "rappel", target: "none", propKind: "rope", safety: "威亚+头盔+垫子" },
  { re: /跳车窗/, action: "jump", target: "none", arcPeak: 1.2, propKind: "car", safety: "替身+垫子" },
  { re: /跳车/, action: "jump", target: "none", arcPeak: 1.0, propKind: "car", safety: "替身+垫子" },
  { re: /跳楼/, action: "jump", target: "after", arcPeak: 1.5, safety: "替身+气垫+半速排练" },
  { re: /跳上|跳到|跳进|跳/, action: "jump", target: "after", arcPeak: 0.8, safety: "垫子" },
  { re: /爬上|爬到|爬/, action: "climb", target: "after", safety: "威亚+垫子" },
  { re: /贴在|贴着|贴/, action: "cling", target: "after", safety: "威亚+垫子" },
  { re: /骑上|骑着|骑/, action: "ride", target: "after", safety: "护具" },
  { re: /躲进|躲到|躲在|藏进|藏/, action: "hide", target: "after" },
  { re: /躺|趴/, action: "prone", target: "after" },
  { re: /潜水|游泳/, action: "swim", target: "none", safety: "救生员+替身" },
  { re: /飞走|飞去|飞/, action: "wireFly", target: "after", arcPeak: 3, safety: "威亚" },
  { re: /走到|走向|走过去|走/, action: "walk", target: "after" },
  { re: /跑到|跑向|跑|冲向|冲/, action: "run", target: "after" },
  { re: /坐下|坐/, action: "sit", target: "after" },
  { re: /站起来|起身/, action: "standUp", target: "none" },
  { re: /站/, action: "stand", target: "after" },
  { re: /转身|转过身|转向/, action: "turn", target: "after" },
  { re: /挥手|招手/, action: "wave", target: "none" },
  { re: /指向|指/, action: "point", target: "after" },
  { re: /鞠躬|点头/, action: "bow", target: "none" },
  { re: /蹲下|蹲/, action: "crouch", target: "none" },
  { re: /出拳|打了|打/, action: "punch", target: "after" },
  { re: /踢/, action: "kick", target: "after" },
  { re: /格挡|挡/, action: "block", target: "none" },
  { re: /闪避|闪开|躲/, action: "dodge", target: "none" },
  { re: /倒下|摔倒|倒地/, action: "fall", target: "none" },
  { re: /爬起来|起来/, action: "getUp", target: "none" },
];

// 角色词
function resolveActor(text: string, ctx: SceneContext, lastId: string | null): { id: string; name: string } | null {
  const actors = ctx.actors;
  if (!actors.length) return null;
  // 1) 名字/角色名直接出现
  for (const a of actors) {
    if (a.name && text.includes(a.name)) return { id: a.id, name: a.name };
    if (a.role && text.includes(a.role)) return { id: a.id, name: a.name };
  }
  // 2) 男主/女主/配角/主角
  const byWord = (word: string, fallbackIdx: number): { id: string; name: string } | null => {
    if (!text.includes(word)) return null;
    const hit = actors.find((a) => (a.name && a.name.includes(word)) || (a.role && a.role.includes(word)));
    if (hit) return { id: hit.id, name: hit.name };
    const a = actors[Math.min(fallbackIdx, actors.length - 1)];
    return { id: a.id, name: a.name };
  };
  return (
    byWord("男主", 0) ?? byWord("女主", 1) ?? byWord("配角", 2) ?? byWord("主角", 0) ??
    (text.includes("他") || text.includes("她")
      ? (actors.find((a) => a.id === lastId) ? { id: lastId!, name: actors.find((a) => a.id === lastId)!.name } : { id: actors[0].id, name: actors[0].name })
      : null)
  );
}

interface ResolvedTarget {
  pos: [number, number];
  y?: number;
  /** 贴在侧面的高度（米）——贴火车/贴墙用它，不用顶高 */
  sideY?: number;
  needProp?: StuntPropKind;
  note?: string;
}

/** 目标解析：特技道具 > 家具锚点 > 方位词 > 场景中央（并明说） */
function resolveTarget(text: string, ctx: SceneContext): ResolvedTarget {
  const center: [number, number] = [0, 0];
  const { W, D } = ctx;
  const findAnchor = (kw: string): SceneAnchor | undefined =>
    ctx.anchors.find((a) => a.name.includes(kw));
  const propAt = (kind: StuntPropKind): { x: number; z: number } | undefined => {
    const p = ctx.stuntProps.find((s) => s.kind === kind);
    return p ? { x: p.x, z: p.z } : undefined;
  };
  const topYOf = (kind: StuntPropKind): number =>
    ({ tree: 2.2, car: 1.4, train: 3.0, wall: 2.2, platform: 3.0, slope: 2.5, bridge: 2.0, helicopter: 2.0 } as Record<string, number>)[kind] ?? 0;
  const sideYOf = (kind: StuntPropKind): number =>
    ({ train: 1.5, wall: 1.2, car: 0.8, platform: 1.5, bridge: 1.0 } as Record<string, number>)[kind] ?? 1.2;

  // —— 桌上/桌下 ——
  if (/桌上/.test(text)) {
    const t = findAnchor("桌");
    if (t) return { pos: [t.x, t.z], y: t.topY };
    return { pos: center, y: 0.75, note: "场景里没找到桌子，按默认桌高 0.75m 放" };
  }
  if (/桌下/.test(text)) {
    const t = findAnchor("桌");
    if (t) return { pos: [t.x, t.z], y: 0 };
    return { pos: center, y: 0, note: "场景里没找到桌子，放在场景中央" };
  }
  // —— 树上 / 树 ——
  if (/树上/.test(text)) {
    const p = propAt("tree");
    if (p) return { pos: [p.x, p.z], y: topYOf("tree") };
    return { pos: [1.5, -1.5], y: topYOf("tree"), needProp: "tree", note: "场景里没有树，已补一棵" };
  }
  if (/树/.test(text)) {
    const p = propAt("tree");
    if (p) return { pos: [p.x, p.z], y: topYOf("tree") };
    return { pos: [1.5, -1.5], y: topYOf("tree"), needProp: "tree", note: "场景里没有树，已补一棵" };
  }
  // —— 山坡 ——
  if (/山坡/.test(text)) {
    const p = propAt("slope");
    if (p) return { pos: [p.x, p.z], y: 1.25 };
    return { pos: [2, -2], y: 1.25, needProp: "slope", note: "场景里没有山坡，已补一个" };
  }
  // —— 车窗/车 ——
  if (/车窗/.test(text)) {
    const p = propAt("car");
    if (p) return { pos: [p.x + 2.5, p.z], y: 0, needProp: undefined };
    return { pos: [2.5, 0], y: 0, needProp: "car", note: "场景里没有车，已补一辆" };
  }
  if (/车/.test(text) && !/火车/.test(text)) {
    const p = propAt("car");
    if (p) return { pos: [p.x, p.z], y: 0 };
    return { pos: [2, 0], y: 0, needProp: "car", note: "场景里没有车，已补一辆" };
  }
  // —— 火车 ——
  if (/火车/.test(text)) {
    const p = propAt("train");
    if (p) return { pos: [p.x, p.z], y: topYOf("train"), sideY: sideYOf("train") };
    return { pos: [3, 0], y: topYOf("train"), sideY: sideYOf("train"), needProp: "train", note: "场景里没有火车，已补一节车厢" };
  }
  // —— 屋顶 ——
  if (/屋顶|房顶/.test(text)) {
    const p = propAt("platform");
    if (p) return { pos: [p.x, p.z], y: topYOf("platform") };
    return { pos: [2, -2], y: topYOf("platform"), needProp: "platform", note: "场景里没有屋顶平台，已补一个" };
  }
  // —— 墙头 / 墙 ——
  if (/墙头/.test(text)) {
    const p = propAt("wall");
    if (p) return { pos: [p.x, p.z], y: topYOf("wall"), sideY: sideYOf("wall") };
    return { pos: [2, 0], y: topYOf("wall"), sideY: sideYOf("wall"), needProp: "wall", note: "场景里没有墙，已补一堵" };
  }
  if (/墙/.test(text)) {
    const p = propAt("wall");
    if (p) return { pos: [p.x, p.z], y: topYOf("wall"), sideY: sideYOf("wall") };
    return { pos: [2, 0], y: topYOf("wall"), sideY: sideYOf("wall"), needProp: "wall", note: "场景里没有墙，已补一堵" };
  }
  // —— 悬崖 ——
  if (/悬崖/.test(text)) {
    const p = propAt("platform");
    if (p) return { pos: [p.x + 2.4, p.z], y: topYOf("platform") };
    return { pos: [2, -2], y: topYOf("platform"), needProp: "platform", note: "场景里没有悬崖平台，已补一个" };
  }
  // —— 桥 ——
  if (/桥上/.test(text)) {
    const p = propAt("bridge");
    if (p) return { pos: [p.x, p.z], y: topYOf("bridge") };
    return { pos: [0, -2], y: topYOf("bridge"), needProp: "bridge", note: "场景里没有桥，已补一座" };
  }
  if (/桥下/.test(text)) {
    const p = propAt("bridge");
    if (p) return { pos: [p.x, p.z + 1.5], y: 0 };
    return { pos: [0, 0], y: 0, needProp: "bridge", note: "场景里没有桥，已补一座" };
  }
  // —— 马/摩托/直升机 ——
  if (/马/.test(text) && !/马上|立刻/.test(text)) {
    const p = propAt("horse");
    if (p) return { pos: [p.x, p.z], y: 0 };
    return { pos: [1.5, 0], y: 0, needProp: "horse", note: "场景里没有马，已补一匹" };
  }
  if (/摩托/.test(text)) {
    const p = propAt("motorcycle");
    if (p) return { pos: [p.x, p.z], y: 0 };
    return { pos: [1.5, 0], y: 0, needProp: "motorcycle", note: "场景里没有摩托，已补一辆" };
  }
  if (/直升机/.test(text)) {
    const p = propAt("helicopter");
    if (p) return { pos: [p.x, p.z], y: 0 };
    return { pos: [3, 0], y: 0, needProp: "helicopter", note: "场景里没有直升机，已补一架" };
  }
  // —— 绳索 ——
  if (/绳索|绳/.test(text)) {
    const p = propAt("rope");
    if (p) return { pos: [p.x, p.z], y: 0 };
    return { pos: [1.5, 0], y: 0, needProp: "rope", note: "场景里没有绳索，已补一条" };
  }
  // —— 床底/柜子 ——
  if (/床底/.test(text)) {
    const b = findAnchor("床");
    if (b) return { pos: [b.x, b.z], y: 0 };
    return { pos: center, y: 0, note: "场景里没找到床，放在场景中央" };
  }
  if (/柜子|衣柜|柜/.test(text)) {
    const c = findAnchor("柜") ?? findAnchor("橱");
    if (c) return { pos: [c.x, c.z], y: 0 };
    return { pos: [W * 0.3, -D * 0.3], y: 0, note: "场景里没找到柜子，放在墙角" };
  }
  // —— 窗边/门口 ——
  if (/窗边|窗户|窗/.test(text)) {
    const wall = ctx.windowWall ?? "N";
    if (wall === "N") return { pos: [0, -D / 2 + 0.8], y: 0 };
    if (wall === "S") return { pos: [0, D / 2 - 0.8], y: 0 };
    if (wall === "W") return { pos: [-W / 2 + 0.8, 0], y: 0 };
    return { pos: [W / 2 - 0.8, 0], y: 0 };
  }
  if (/门口|门边/.test(text)) {
    if (ctx.door) return { pos: ctx.door, y: 0 };
    return { pos: [0, D / 2 - 0.8], y: 0 };
  }
  // —— 家具锚点（按名字关键词）：y = 家具顶高（跳/爬/站/坐上去用它；
  //   走/跑过去时解析器会按动词把它改回 0）——
  const furnitureKws = ["沙发", "桌", "床", "电视", "吧台", "书架", "茶几", "椅", "钢琴", "灶", "冰箱", "浴缸", "马桶", "洗手"];
  for (const kw of furnitureKws) {
    if (text.includes(kw)) {
      const a = findAnchor(kw);
      if (a) return { pos: [a.x, a.z], y: a.topY };
    }
  }
  // —— 方位词 ——
  if (/中央|中间/.test(text)) return { pos: center, y: 0 };
  if (/左边|左侧/.test(text)) return { pos: [-W * 0.3, 0], y: 0 };
  if (/右边|右侧/.test(text)) return { pos: [W * 0.3, 0], y: 0 };
  if (/前面|前方/.test(text)) return { pos: [0, D * 0.3], y: 0 };
  if (/后面|后方/.test(text)) return { pos: [0, -D * 0.3], y: 0 };
  if (/角落/.test(text)) return { pos: [W * 0.35, D * 0.35], y: 0 };
  // —— 找不到 ——
  return { pos: center, y: 0, note: "目标没找到，放在场景中央" };
}

/** 对手解析：动词后出现的人名/男主/女主/配角（"打了配角一拳"） */
function resolveOpponent(textAfter: string, ctx: SceneContext, selfId: string): string | null {
  for (const a of ctx.actors) {
    if (a.id === selfId) continue;
    if (a.name && textAfter.includes(a.name)) return a.id;
    if (a.role && textAfter.includes(a.role)) return a.id;
  }
  for (const [word, idx] of [["男主", 0], ["女主", 1], ["配角", 2]] as const) {
    if (!textAfter.includes(word)) continue;
    const hit = ctx.actors.find((a) => (a.name && a.name.includes(word)) || (a.role && a.role.includes(word)));
    if (hit && hit.id !== selfId) return hit.id;
    const a = ctx.actors[Math.min(idx, ctx.actors.length - 1)];
    if (a && a.id !== selfId) return a.id;
  }
  return null;
}

/** UI 下方的句式提示（支持的句型） */
export const SUPPORTED_PATTERNS: Array<{ pattern: string; example: string }> = [
  { pattern: "角色 + 走/跑到 + 目标", example: "男主走到窗边" },
  { pattern: "角色 + 走/跑到 + 目标 + 坐下/站/蹲", example: "男主走到窗边坐下" },
  { pattern: "角色 + 坐下/起身/转身/挥手/指/鞠躬/蹲下", example: "女主挥手" },
  { pattern: "角色 + 打/踢 + 对手", example: "男主打了配角一拳" },
  { pattern: "角色 + 格挡/闪避/倒下/起来", example: "配角格挡" },
  { pattern: "角色 + 跳上 + 桌子/车/屋顶", example: "男主跳上桌子" },
  { pattern: "角色 + 爬上 + 火车/树/窗", example: "男主爬上火车" },
  { pattern: "角色 + 贴在 + 火车/墙上", example: "配角贴在火车上" },
  { pattern: "角色 + 躲进 + 柜子/床底/桌下", example: "女主躲进柜子" },
  { pattern: "角色 + 御剑飞行 / 骑扫帚飞走 / 吊威亚", example: "男主御剑飞行" },
  { pattern: "角色 + 骑 + 马/摩托", example: "女主骑上马" },
  { pattern: "角色 + 轻功 / 索降 / 跳楼", example: "男主轻功飞上屋顶" },
];

const EXAMPLE_SENTENCES = [
  "男主走到窗边坐下",
  "女主跑向门口",
  "男主打了配角一拳",
  "男主跳上桌子",
  "女主躲进柜子",
  "男主御剑飞行",
];

/** 主入口：解析一整句（可含多个分句/多动词） */
export function parseActionText(input: string, ctx: SceneContext): ParseResult {
  const raw = (input ?? "").trim();
  if (!raw) {
    return { ok: false, instructions: [], message: "先输入一句话，比如：男主走到窗边坐下", suggestion: EXAMPLE_SENTENCES[0] };
  }
  if (!ctx.actors.length) {
    return { ok: false, instructions: [], message: "还没有演员——先在「演员走位」里加演员，再输动作", suggestion: EXAMPLE_SENTENCES[0] };
  }
  const clauses = raw.split(/[，。、；！？\n]+/).map((s) => s.trim()).filter(Boolean);
  const instructions: ParsedInstruction[] = [];
  const failed: string[] = [];
  let lastActorId: string | null = null;
  let lastPos: [number, number] | null = null;
  let lastY: number | undefined;

  for (const clause of clauses) {
    // 分句再按 然后/接着/再 切
    const parts = clause.split(/然后|接着|再/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const actor = resolveActor(part, ctx, lastActorId);
      if (!actor) {
        failed.push(part);
        continue;
      }
      lastActorId = actor.id;
      // 扫出本分句里的全部动词（按出现位置排序，去重叠）
      const hits: Array<{ index: number; len: number; verb: VerbPattern }> = [];
      for (const v of VERBS) {
        const m = v.re.exec(part);
        if (m) hits.push({ index: m.index, len: m[0].length, verb: v });
      }
      hits.sort((a, b) => a.index - b.index || b.len - a.len);
      const picked: typeof hits = [];
      for (const h of hits) {
        if (picked.some((p) => h.index < p.index + p.len && p.index < h.index + h.len)) continue;
        picked.push(h);
      }
      // 方向补语：紧贴上一个动词的裸"走/去/来/飞"不是新动作
      // （"骑扫帚飞走"里的"走"、"轻功飞"里的"飞"）
      const filtered = picked.filter((h, i) => {
        if (i === 0) return true;
        const prev = picked[i - 1];
        const text = part.slice(h.index, h.index + h.len);
        return !(h.index === prev.index + prev.len && (text === "走" || text === "去" || text === "来" || text === "飞"));
      });
      picked.splice(0, picked.length, ...filtered);
      if (!picked.length) {
        failed.push(part);
        continue;
      }
      for (let i = 0; i < picked.length; i++) {
        const h = picked[i];
        const afterStart = h.index + h.len;
        const afterEnd = i + 1 < picked.length ? picked[i + 1].index : part.length;
        const afterText = part.slice(afterStart, afterEnd);
        const v = h.verb;
        const ins: ParsedInstruction = { actorId: actor.id, actorName: actor.name, action: v.action };
        if (v.safety) ins.safety = v.safety;
        if (v.arcPeak !== undefined) ins.arc = { peak: v.arcPeak };
        if (v.propKind) ins.propKind = v.propKind;
        // 目标
        if (v.target === "after") {
          // 打/踢：after 里先找对手
          if (v.action === "punch" || v.action === "kick") {
            const opp = resolveOpponent(afterText, ctx, actor.id);
            if (opp) ins.targetActorId = opp;
            else {
              // 没点名对手：面板收到后补"最近的其他演员"；这里先留空
            }
            // "打了配角一拳"里的"一拳"是量词，不是目标——不解析位置
          } else if (v.action === "turn") {
            // 转向某处：目标只用来算朝向
            if (afterText.trim()) {
              const tp = resolveTarget(afterText, ctx);
              ins.targetPos = tp.pos;
              if (tp.note) ins.note = tp.note;
            }
          } else {
            // 移动/姿态：目标位置；无目标时沿用上一个动作的落点（连写句）
            if (afterText.trim()) {
              const tp = resolveTarget(afterText, ctx);
              ins.targetPos = tp.pos;
              // 高度按动词定：贴用侧面高度；跳/爬/轻功/站/骑/坐用顶高；
              // 其余（走/跑/指/转身…）都是地面位置，高度 0。
              const onTop = ["jump", "climb", "leap", "stand", "ride", "sit"];
              if (tp.y !== undefined) {
                ins.targetY = v.action === "cling" && tp.sideY !== undefined
                  ? tp.sideY
                  : onTop.includes(v.action) ? tp.y : 0;
              }
              if (tp.needProp) ins.needProp = tp.needProp;
              if (tp.note) ins.note = tp.note;
              lastPos = tp.pos;
              lastY = ins.targetY;
            } else if (lastPos && (v.action === "sit" || v.action === "stand" || v.action === "crouch" || v.action === "prone" || v.action === "hide")) {
              ins.targetPos = lastPos;
              if (lastY !== undefined) ins.targetY = lastY;
            }
          }
        } else {
          // 无目标动词：飞行类向前飞；跳车/跳车窗/索降用道具位置
          if (v.action === "flySword" || v.action === "flyBroom" || v.action === "wireFly") {
            // 向前飞 4 米、升到 2.5 米：面板按演员朝向算，这里给方向标记
            ins.targetPos = undefined; // 面板按朝向算
            ins.targetY = 2.5;
          }
          if (v.action === "jump" && v.propKind === "car") {
            const tgt = resolveTarget("车", ctx);
            ins.targetPos = [tgt.pos[0] + 2.5, tgt.pos[1]];
            if (tgt.needProp) ins.needProp = tgt.needProp;
          }
          if (v.action === "rappel") {
            const tgt = resolveTarget("绳索", ctx);
            ins.targetPos = tgt.pos;
            if (tgt.needProp) ins.needProp = tgt.needProp;
          }
        }
        // 跳上桌子这类：目标高度来自 resolveTarget；跳本身也要有 arc
        if (v.action === "jump" && ins.targetPos && ins.targetY === undefined) {
          // 跳到平地：落点高度 0，arc 已有
        }
        // 躲/躺类：目标已定，姿态在落点做
        instructions.push(ins);
      }
    }
  }

  if (!instructions.length) {
    const suggestion = closestSuggestion(raw);
    return {
      ok: false,
      instructions: [],
      message: `没听懂，试试：${suggestion}`,
      suggestion,
    };
  }
  const notes = instructions.map((i) => i.note).filter(Boolean);
  const summary = instructions
    .map((i) => {
      const def = (ACTION_REGISTRY as Record<string, { nameZh: string }>)[i.action];
      return `${i.actorName}${def?.nameZh ?? i.action}`;
    })
    .join(" → ");
  return {
    ok: true,
    instructions,
    message: `已解析：${summary}${notes.length ? `（${notes.join("；")}）` : ""}`,
  };
}

/** 听不懂时：找一个最接近的支持句式（按关键词重叠） */
function closestSuggestion(input: string): string {
  let best = EXAMPLE_SENTENCES[0];
  let bestScore = -1;
  for (const ex of EXAMPLE_SENTENCES) {
    let score = 0;
    for (const ch of ex) if (input.includes(ch)) score++;
    if (score > bestScore) { bestScore = score; best = ex; }
  }
  return best;
}
