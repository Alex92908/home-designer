/**
* script —— 剧本（Part 4）：写剧本 → 拆解 → 生成分镜。
*
* 规则解析，不调 LLM，纯客户端（与 actionParser 同款思路）：
* 1. 场次标题 → 场景（场次号/地点/日夜/内外）；
* 2. 台词行 → 角色 + 情绪 + 台词；
* 3. 其余行 → 动作行，能匹配动作库的走 actionParser（复用，不另写
* 一套），匹配不上的留作 UNASSIGNED（原文保留，UI 明说，不乱指派）。
*
* 片场匹配复用 matchProjectTemplate（与「一键搭片场」同一入口），
* 只认 set- 开头的片场 id——别墅等非片场模板不算匹配（控制台的片场
* 列表只含片场）；没匹配上就是「未匹配片场」，不崩，用户可手动选。
*
* 剧本正文存在导演台 store 的 scriptText 里（与 shots 同一个
* localStorage 持久化键）；这里只做纯解析，不碰 store、不碰 DOM。
*/
import { parseActionText, type SceneContext} from "./actionParser";
import type { ActionId} from "./actions";
import { matchProjectTemplate} from "./matchProjectTemplate";

/** 日/夜（标题里的「日/白天」「夜/晚上」；没写 = 未注明） */
export type ScriptTimeOfDay = "day" | "night";

/** 行的种类：台词 / 动作 / 未认出（原文保留） */
export type ScriptLineKind = "dialogue" | "action" | "unassigned";

export interface ScriptLine {
/** 派生 id：`s{场次}-l{行号}`（解析结果的稳定键，供 UI/分镜映射用） */
id: string;
kind: ScriptLineKind;
/** 原文——永远保留，解析失败也不丢 */
raw: string;
/** 台词行：角色名 */
character?: string;
/** 台词行：括号里的情绪（如「愤怒」），没写 = 未注明 */
emotion?: string;
/** 台词行：台词正文 */
line?: string;
/** 动作行：动作描述原文（= raw，去掉行首空白后） */
actionText?: string;
/** 动作行：actionParser 认出的动作（第一个指令的动作） */
actionId?: ActionId;
/** 动作行：解析小结（如「男主走路 → 男主坐下」） */
actionSummary?: string;
/** 动作行：actionParser 认出的演员名（第一个指令的演员） */
actorName?: string;
/** 动作行：actionParser 认出的演员 id（第一个指令的演员） */
actorId?: string;
/** 未认出行：为什么没认出来（UI 直接展示） */
unassignedReason?: string;
}

export interface ScriptScene {
/** 场次号（标题里写的；格式无号时按顺序补 1、2、3…） */
number: number;
/** 地点原文（如「咖啡馆」；没写 = ""，片场必为未匹配） */
location: string;
timeOfDay?: ScriptTimeOfDay;
/** 内/外；没写 = 未注明 */
interior?: boolean;
/** 标题原文 */
headingRaw: string;
/** 匹配到的片场 id（set- 开头）；没匹配上 = undefined */
setId?: string;
/** 匹配到的片场名；没匹配上 = undefined */
setName?: string;
lines: ScriptLine[];
}

export interface ParsedScript {
scenes: ScriptScene[];
/** 第一场之前的行（场前说明/旁白）；生成分镜时跳过，不丢 */
preamble: ScriptLine[];
unassignedCount: number;
sceneCount: number;
/** 全部行数（含场前行，不含空行） */
lineCount: number;
/** 人话小结（如「3 场 · 12 行 · 2 行未认出」） */
summary: string;
}

/** 未认出行的统一文案（UI 与 harness 共用同一句） */
export const UNASSIGNED_MESSAGE = "这行没认出来，已保留为原文";

/** 剧本格式提示（面板里的格式说明，与解析规则一一对应） */
export const SCRIPT_FORMAT_HINT =
"场次标题：第1场 咖啡馆 日 内 / 1. 咖啡馆-日-内 / \u3010咖啡馆 日 内\u3011；台词：男主（愤怒）：你来晚了。；其余行当动作写，如：男主走到窗边坐下";

// ─── 场次标题 ───

/** 「第N场」：第1场 / 第 2 场（号后可跟地点，也可只有号） */
const HEADING_NUM_RE = /^第\s*(\d+)\s*场\s*/;
/** 「N. / N、」：1. 咖啡馆-日-内 / 2、学校教室 夜 外 */
const HEADING_DOT_RE = /^(\d+)\s*[.、．]\s+/;
/** 方头括号格式（U+3010/U+3011）：咖啡馆 日 内 / 第1场 咖啡馆 日 内 */
const HEADING_BRACKET_RE = /^\u3010\s*(.+?)\s*\u3011$/;

/**
* 标题正文 → { location, timeOfDay, interior}。
* token 规则：按空白 / - / 、/ ，/ （）切分；「日/白天」= 白天，
* 「夜/晚上/夜晚」= 夜；「内/室内」= 内，「外/室外」= 外；剩下的
* token 拼起来就是地点（「唐宫 宴会厅」→「唐宫宴会厅」，匹配用）。
*/
function parseHeadingBody(body: string): { location: string; timeOfDay?: ScriptTimeOfDay; interior?: boolean} {
const cleaned = body
.replace(/^[：:]\s*/, "")
.replace(/[（(]/g, " ")
.replace(/[）)]/g, " ")
.trim();
const tokens = cleaned.split(/[\s\-、，,·/]+/).map((t) => t.trim()).filter(Boolean);
const locParts: string[] = [];
let timeOfDay: ScriptTimeOfDay | undefined;
let interior: boolean | undefined;
for (const tok of tokens) {
if (tok === "日" || tok === "白天" || tok === "白日" || tok === "昼") timeOfDay = "day";
else if (tok === "夜" || tok === "夜晚" || tok === "晚上" || tok === "夜里" || tok === "深夜") timeOfDay = "night";
else if (tok === "内" || tok === "室内" || tok === "内景") interior = true;
else if (tok === "外" || tok === "室外" || tok === "外景") interior = false;
else locParts.push(tok);
}
return { location: locParts.join(""), timeOfDay, interior};
}

/** 标题行 → { number | null（格式无号）, body}；不是标题返回 null */
function matchHeading(line: string): { number: number | null; body: string} | null {
const bracket = HEADING_BRACKET_RE.exec(line);
if (bracket) {
const inner = bracket[1].trim();
const num = HEADING_NUM_RE.exec(inner);
if (num) return { number: Number(num[1]), body: inner.slice(num[0].length)};
return { number: null, body: inner};
}
const num = HEADING_NUM_RE.exec(line);
if (num) return { number: Number(num[1]), body: line.slice(num[0].length)};
const dot = HEADING_DOT_RE.exec(line);
if (dot) return { number: Number(dot[1]), body: line.slice(dot[0].length)};
return null;
}

// ─── 台词 ───

/**
* 台词行：角色名（≤6 字、无空白、无句中标点）+ 可选括号情绪 + 中/英文冒号 + 台词。
* 情绪括号支持全角（）与半角 ()，冒号支持全角：与半角:。
* 角色名超过 6 字、或含空白/句中标点的不算台词（当动作行走解析）。
*/
const DIALOGUE_RE = /^([^：:（()\s，。、；！？]{1,6})(?:[（(]([^）)]{1,10})[）)])?[：:]\s*(.+)$/;

function matchDialogue(line: string): { character: string; emotion?: string; line: string} | null {
const m = DIALOGUE_RE.exec(line);
if (!m) return null;
const text = m[3].trim();
if (!text) return null;
return { character: m[1],...(m[2]? { emotion: m[2].trim()}: {}), line: text};
}

// ─── 片场匹配（复用 matchProjectTemplate，只认 set- 片场）───

/**
* 地点 → 片场。matchProjectTemplate 是「一键搭片场」与描述匹配的
* 同一入口；这里只接受 set- 开头的片场 id，别墅等非片场模板
* （如「别墅」→ modern-pool-villa）不算匹配——控制台的片场列表
* 只含片场，配不上就明说「未匹配片场」，不硬指。
*/
export function matchScriptSet(location: string): { id: string; name: string} | null {
const loc = (location?? "").trim();
if (!loc) return null;
const hit = matchProjectTemplate(loc);
if (!hit ||!hit.id.startsWith("set-")) return null;
return { id: hit.id, name: hit.name};
}

// ─── 主入口：纯解析（不跑动作解析器；动作富化见 enrichScriptActions）───

/** 解析剧本正文 → 场景 + 行（未分场的剧本：全部行归入隐含的第 1 场）。 */
export function parseScript(text: string): ParsedScript {
const rawText = (text?? "").replace(/^\uFEFF/, "");
const rawLines = rawText.split(/\r?\n/);
const scenes: ScriptScene[] = [];
const preamble: ScriptLine[] = [];
let current: ScriptScene | null = null;
let autoNumber = 0;
let lineIdx = 0;

const pushLine = (raw: string): void => {
const target = current?? null;
const id = target? `s${target.number}-l${lineIdx}`: `pre-l${lineIdx}`;
lineIdx++;
const dlg = matchDialogue(raw);
if (dlg) {
const l: ScriptLine = { id, kind: "dialogue", raw, character: dlg.character, line: dlg.line,...(dlg.emotion? { emotion: dlg.emotion}: {})};
if (target) target.lines.push(l);
else preamble.push(l);
return;
}
const l: ScriptLine = { id, kind: "action", raw, actionText: raw};
if (target) target.lines.push(l);
else preamble.push(l);
};

for (const rawLine of rawLines) {
const line = rawLine.trim();
if (!line) continue;
const heading = matchHeading(line);
if (heading) {
autoNumber = heading.number?? autoNumber + 1;
const body = parseHeadingBody(heading.body);
const set = matchScriptSet(body.location);
current = {
number: autoNumber,
location: body.location,
...(body.timeOfDay? { timeOfDay: body.timeOfDay}: {}),
...(body.interior!== undefined? { interior: body.interior}: {}),
headingRaw: line,
...(set? { setId: set.id, setName: set.name}: {}),
lines: [],
};
scenes.push(current);
continue;
}
pushLine(line);
}

// 全篇无标题：全部行归入隐含的第 1 场（地点未注明，片场未匹配），
// 这样没分场的短剧本也能直接生成分镜。
if (scenes.length === 0 && preamble.length > 0) {
const implicit: ScriptScene = {
number: 1,
location: "",
headingRaw: "（未分场）",
lines: preamble.splice(0, preamble.length).map((l, i) => ({...l, id: `s1-l${i}`})),
};
scenes.push(implicit);
}

const allLines = [...preamble,...scenes.flatMap((s) => s.lines)];
const unassignedCount = allLines.filter((l) => l.kind === "unassigned").length;
const summary = `${scenes.length} 场 · ${allLines.length} 行${unassignedCount? ` · ${unassignedCount} 行未认出`: ""}`;
return { scenes, preamble, unassignedCount, sceneCount: scenes.length, lineCount: allLines.length, summary};
}

// ─── 动作富化：动作行走一遍 actionParser（复用，不另写一套）───

/**
* 对已解析剧本的动作行跑 actionParser（与「文字催动动作」同一入口，
* 同一个 SceneContext：演员/家具锚点/特技道具都从当前场景来）。
* - 解析成功 → kind 保持 action，填 actionId/actionSummary/actorName/actorId；
* - 解析失败 → kind 改为 unassigned，原因写明（原文保留，不乱指派）；
* - 演员表为空时无法判断 → 全部动作行保持 action（等有了演员再解析）。
* 返回新对象（不改入参）。
*/
export function enrichScriptActions(parsed: ParsedScript, ctx: SceneContext): ParsedScript {
if (!ctx.actors.length) return parsed;
const enrichLine = (l: ScriptLine): ScriptLine => {
if (l.kind!== "action" ||!l.actionText) return l;
const res = parseActionText(l.actionText, ctx);
if (res.ok && res.instructions.length) {
const first = res.instructions[0];
return {
...l,
actionId: first.action,
actionSummary: res.message.replace(/^已解析：/, ""),
actorName: first.actorName,
actorId: first.actorId,
};
}
return {...l, kind: "unassigned", unassignedReason: `${UNASSIGNED_MESSAGE}。${res.message}`};
};
const scenes = parsed.scenes.map((s) => ({...s, lines: s.lines.map(enrichLine)}));
const preamble = parsed.preamble.map(enrichLine);
const allLines = [...preamble,...scenes.flatMap((s) => s.lines)];
const unassignedCount = allLines.filter((l) => l.kind === "unassigned").length;
const summary = `${scenes.length} 场 · ${allLines.length} 行${unassignedCount? ` · ${unassignedCount} 行未认出`: ""}`;
return {...parsed, scenes, preamble, unassignedCount, summary};
}

// ─── 剧本 → 分镜计划 ───

export interface ScriptShotPlan {
sceneNumber: number;
lineId: string;
/** 台词 → 室内特写（拍脸）；动作 → 室内中景（看清走位） */
presetId: "indoor-closeup" | "indoor-medium";
/** 台词/动作的角色名（台词行 = 说话人；动作行 = 动作解析认出的演员） */
character?: string;
/** 台词行：拼好的台词原文，如「男主（愤怒）：你来晚了。」 */
dialogue?: string;
/** 动作行：动作描述原文（同时写进镜的提示词，喂 AI 视频用） */
prompt?: string;
/** 动作行：解析出的动作 id（未富化/未认出时缺省） */
actionId?: ActionId;
/** 框住的演员 id（按名字/角色在演员表里找；找不到 = 缺省，镜跟第一个演员） */
targetActorId?: string;
/** 来源行原文 */
scriptLine: string;
}

/** 演员表里找人：名字全等 > 名字包含 > 角色包含；找不到 = undefined（不硬指） */
export function findActorForName(
actors: Array<{ id: string; name: string; role?: string}>,
name: string | undefined,
): { id: string; name: string} | undefined {
if (!name) return undefined;
const exact = actors.find((a) => a.name === name);
if (exact) return exact;
const byName = actors.find((a) => a.name.includes(name) || name.includes(a.name));
if (byName) return byName;
const byRole = actors.find((a) => (a.role?? "").includes(name) || name.includes(a.role?? "§"));
if (byRole) return byRole;
return undefined;
}

/**
* 剧本 → 分镜计划（纯函数，面板与 harness 共用）。
* 顺序 = 剧本顺序（场次 → 行）；台词行与动作行各成一镜；未认出的行
* 与场前行不成镜（原文保留在拆解里，用户可在面板里看到并修正）。
*/
export function planShotsFromScript(
parsed: ParsedScript,
actors: Array<{ id: string; name: string; role?: string}>,
): ScriptShotPlan[] {
const plans: ScriptShotPlan[] = [];
for (const scene of parsed.scenes) {
for (const line of scene.lines) {
if (line.kind === "dialogue") {
const dialogue = `${line.character?? ""}${line.emotion? `（${line.emotion}）`: ""}：${line.line?? ""}`;
plans.push({
sceneNumber: scene.number,
lineId: line.id,
presetId: "indoor-closeup",
...(line.character? { character: line.character}: {}),
dialogue,
scriptLine: line.raw,
...(findActorForName(actors, line.character)? { targetActorId: findActorForName(actors, line.character)!.id}: {}),
});
} else if (line.kind === "action") {
plans.push({
sceneNumber: scene.number,
lineId: line.id,
presetId: "indoor-medium",
...(line.actorName? { character: line.actorName}: {}),
prompt: line.raw,
...(line.actionId? { actionId: line.actionId}: {}),
scriptLine: line.raw,
...((line.actorId?? findActorForName(actors, line.actorName)?.id)
? { targetActorId: line.actorId?? findActorForName(actors, line.actorName)!.id}
: {}),
});
}
// unassigned → 不成镜（原文保留在拆解里，见 breakdown UI）
}
}
return plans;
}
