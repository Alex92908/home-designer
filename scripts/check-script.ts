// Script logic checks (run in node with tsx — no DOM, no localStorage).
// Covers: all three heading formats (+ plain "第N场" + paren variant),
// dialogue with/without emotion (full- and half-width), action lines
// reusing the action parser (walk/sit chain, flySword), two unparseable
// lines staying unassigned with the clear message (never silently
// misassigned), scene -> set matching for the eight common locations
// (cafe/office/restaurant/apartment/school/hospital/Tang palace/Ming
// hall) + unknown location -> unmatched (not a crash) + non-set template
// ("别墅") not counted as a set, heading-less script -> implicit scene 1,
// empty script, full multi-scene script end-to-end (scenes + shots in
// order, right characters/actions), old saves without script fields
// (makeShot defaults), and no-actor enrichment leaving action lines alone.
//
// NOTE: the editor itself (typing/paste/file upload in a real browser)
// cannot be checked here — this harness checks parsing, matching and
// shot planning only; see the report for the browser caveat.
import {
parseScript, enrichScriptActions, planShotsFromScript, matchScriptSet,
UNASSIGNED_MESSAGE,
} from "../src/lib/script";
import { makeShot} from "../src/lib/cinematic";
import type { SceneContext} from "../src/lib/actionParser";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
if (ok) { pass++; console.log(`PASS ${name}`);}
else { fail++; console.log(`FAIL ${name} ${detail}`);}
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const CTX: SceneContext = {
actors: [
{ id: "a1", name: "男主", role: "男主角"},
{ id: "a2", name: "女主", role: "女主角"},
{ id: "a3", name: "配角", role: "店员"},
],
anchors: [],
stuntProps: [],
W: 10,
D: 10,
};
const NO_ACTOR_CTX: SceneContext = { actors: [], anchors: [], stuntProps: [], W: 10, D: 10};
const CAST = CTX.actors.map((a) => ({ id: a.id, name: a.name, role: a.role}));

// ─── 1. Heading format 1: 第N场 地点 日/夜 内/外 ───
{
const p = enrichScriptActions(parseScript("第1场 咖啡馆 日 内\n男主：你来晚了。"), CTX);
const s = p.scenes[0];
check("h1: scene 1", s?.number === 1, `got ${s?.number}`);
check("h1: location 咖啡馆", s?.location === "咖啡馆", `got ${s?.location}`);
check("h1: day + interior", s?.timeOfDay === "day" && s?.interior === true);
check("h1: set-cafe", s?.setId === "set-cafe" && s?.setName === "咖啡馆片场", `got ${s?.setId}`);
check("h1: dialogue line kept", s?.lines[0]?.kind === "dialogue" && s?.lines[0]?.character === "男主");
}

// ─── 2. Heading format 2: N. 地点-日-内 ───
{
const p = parseScript("1. 办公室-夜-外\n女主：加班到几点？");
const s = p.scenes[0];
check("h2: scene 1", s?.number === 1);
check("h2: location 办公室", s?.location === "办公室", `got ${s?.location}`);
check("h2: night + exterior", s?.timeOfDay === "night" && s?.interior === false);
check("h2: set-office", s?.setId === "set-office", `got ${s?.setId}`);
}

// ─── 3. Heading format 3: \u3010地点 日 内\u3011 ───
{
const p = parseScript("\u3010餐厅 日 内\u3011\n店员：欢迎光临。");
const s = p.scenes[0];
check("h3: auto number 1", s?.number === 1, `got ${s?.number}`);
check("h3: location 餐厅", s?.location === "餐厅", `got ${s?.location}`);
check("h3: day + interior", s?.timeOfDay === "day" && s?.interior === true);
check("h3: set-restaurant", s?.setId === "set-restaurant", `got ${s?.setId}`);
}

// ─── 4. Plain 第N场 with location on the same line, no day/night ───
{
const p = parseScript("第2场 学校教室\n老师：上课。");
const s = p.scenes[0];
check("h4: scene 2", s?.number === 2, `got ${s?.number}`);
check("h4: location 学校教室", s?.location === "学校教室", `got ${s?.location}`);
check("h4: no day/night", s?.timeOfDay === undefined && s?.interior === undefined);
check("h4: set-school", s?.setId === "set-school", `got ${s?.setId}`);
}

// ─── 5. Heading with parens: 第1场 咖啡馆（日 内） ───
{
const p = parseScript("第1场 咖啡馆（日 内）");
const s = p.scenes[0];
check("h5: paren heading parses", s?.location === "咖啡馆" && s?.timeOfDay === "day" && s?.interior === true && s?.setId === "set-cafe", JSON.stringify(s));
}

// ─── 6. Dialogue with emotion (full-width) ───
{
const p = parseScript("第1场 咖啡馆 日 内\n男主（愤怒）：你来晚了。");
const l = p.scenes[0]?.lines[0];
check("dlg-emotion: character", l?.character === "男主", `got ${l?.character}`);
check("dlg-emotion: emotion 愤怒", l?.emotion === "愤怒", `got ${l?.emotion}`);
check("dlg-emotion: line", l?.line === "你来晚了。", `got ${l?.line}`);
}

// ─── 7. Dialogue without emotion ───
{
const p = parseScript("第1场 咖啡馆 日 内\n女主：对不起，路上堵车。");
const l = p.scenes[0]?.lines[0];
check("dlg-plain: character + line, no emotion", l?.character === "女主" && l?.line === "对不起，路上堵车。" && l?.emotion === undefined);
}

// ─── 8. Dialogue half-width parens/colon ───
{
const p = parseScript("第1场 咖啡馆 日 内\n男主(冷笑): 哦？");
const l = p.scenes[0]?.lines[0];
check("dlg-halfwidth: emotion 冷笑", l?.character === "男主" && l?.emotion === "冷笑" && l?.line === "哦？", JSON.stringify(l));
}

// ─── 9. Action line reuses the action parser (walk + sit chain) ───
{
const p = enrichScriptActions(parseScript("第1场 咖啡馆 日 内\n男主走到窗边坐下"), CTX);
const l = p.scenes[0]?.lines[0];
check("act-walk: kind action", l?.kind === "action", `got ${l?.kind}`);
check("act-walk: actionId walk (first of chain)", l?.actionId === "walk", `got ${l?.actionId}`);
check("act-walk: actor 男主/a1", l?.actorName === "男主" && l?.actorId === "a1", `got ${l?.actorName}/${l?.actorId}`);
check("act-walk: summary mentions 坐下", (l?.actionSummary?? "").includes("坐下"), `got ${l?.actionSummary}`);
}

// ─── 10. Action line: stunt via the same parser ───
{
const p = enrichScriptActions(parseScript("第1场 咖啡馆 日 内\n男主御剑飞行"), CTX);
const l = p.scenes[0]?.lines[0];
check("act-fly: actionId flySword", l?.actionId === "flySword", `got ${l?.actionId}`);
}

// ─── 11+12. Unparseable lines stay unassigned, with the clear message ───
{
const p = enrichScriptActions(parseScript("第1场 咖啡馆 日 内\n雨越下越大，街道空无一人。\n（此处留白）\n男主：你来晚了。"), CTX);
const lines = p.scenes[0]?.lines?? [];
check("unassigned-1: rain line unassigned", lines[0]?.kind === "unassigned", `got ${lines[0]?.kind}`);
check("unassigned-1: reason says so, original kept", (lines[0]?.unassignedReason?? "").includes(UNASSIGNED_MESSAGE) && lines[0]?.raw === "雨越下越大，街道空无一人。");
check("unassigned-2: stage direction unassigned", lines[1]?.kind === "unassigned", `got ${lines[1]?.kind}`);
check("unassigned-2: reason says so", (lines[1]?.unassignedReason?? "").includes(UNASSIGNED_MESSAGE));
check("unassigned: dialogue after them still parses", lines[2]?.kind === "dialogue" && lines[2]?.character === "男主");
check("unassigned: count == 2", p.unassignedCount === 2, `got ${p.unassignedCount}`);
}

// ─── 13. Scene -> set matching for the eight common locations ───
{
const cases: Array<[string, string]> = [
["咖啡馆", "set-cafe"],
["办公室", "set-office"],
["餐厅", "set-restaurant"],
["公寓客厅", "set-apartment"],
["学校教室", "set-school"],
["医院病房", "set-hospital"],
["唐宫", "set-tang-palace"],
["明厅", "set-ming-hall"],
];
for (const [loc, id] of cases) {
const hit = matchScriptSet(loc);
check(`match: ${loc} -> ${id}`, hit?.id === id, `got ${hit?.id?? null}`);
}
}

// ─── 14. Unknown location -> unmatched, not a crash ───
{
const p = parseScript("第1场 火星基地 日 内\n男主：这里是哪？");
const s = p.scenes[0];
check("nomatch: setId undefined", s?.setId === undefined && s?.setName === undefined);
check("nomatch: scene + line still there", s?.number === 1 && s?.lines.length === 1);
check("nomatch: matchScriptSet null", matchScriptSet("火星基地") === null);
check("nomatch: non-set template not counted", matchScriptSet("别墅") === null, `got ${JSON.stringify(matchScriptSet("别墅"))}`);
}

// ─── 15. Heading-less script -> implicit scene 1 ───
{
const p = enrichScriptActions(parseScript("男主：你来晚了。\n男主走到窗边坐下"), CTX);
check("implicit: one scene", p.scenes.length === 1 && p.scenes[0].number === 1, `got ${p.scenes.length}`);
check("implicit: location empty, unmatched", p.scenes[0].location === "" && p.scenes[0].setId === undefined);
check("implicit: both lines kept", p.scenes[0].lines.length === 2);
}

// ─── 16. Empty script ───
{
const p = parseScript("");
check("empty: 0 scenes 0 lines", p.scenes.length === 0 && p.lineCount === 0 && p.unassignedCount === 0);
check("empty: whitespace only", parseScript(" \n\n ").scenes.length === 0);
}

// ─── 17. Full multi-scene script end-to-end ───
{
const text = [
"第1场 咖啡馆 日 内",
"男主（愤怒）：你来晚了。",
"男主走到窗边坐下",
"第2场 办公室 夜 内",
"女主：加班到几点？",
"雨越下越大，街道空无一人。",
"3. 唐宫-夜-内",
"配角：陛下，宴会开始了。",
"男主御剑飞行",
].join("\n");
const parsed = enrichScriptActions(parseScript(text), CTX);
check("e2e: 3 scenes in order", eq(parsed.scenes.map((s) => s.number), [1, 2, 3]), JSON.stringify(parsed.scenes.map((s) => s.number)));
check("e2e: scene sets", eq(parsed.scenes.map((s) => s.setId), ["set-cafe", "set-office", "set-tang-palace"]), JSON.stringify(parsed.scenes.map((s) => s.setId)));
check("e2e: scene 2 night", parsed.scenes[1].timeOfDay === "night");
check("e2e: 1 unassigned line", parsed.unassignedCount === 1, `got ${parsed.unassignedCount}`);
const plans = planShotsFromScript(parsed, CAST);
check("e2e: 5 shots (unassigned makes none)", plans.length === 5, `got ${plans.length}`);
check("e2e: shot order = script order", eq(plans.map((p) => p.sceneNumber), [1, 1, 2, 3, 3]), JSON.stringify(plans.map((p) => p.sceneNumber)));
check("e2e: dialogue = closeup, action = medium", eq(plans.map((p) => p.presetId), ["indoor-closeup", "indoor-medium", "indoor-closeup", "indoor-closeup", "indoor-medium"]), JSON.stringify(plans.map((p) => p.presetId)));
check("e2e: dialogue text assembled", plans[0].dialogue === "男主（愤怒）：你来晚了。", `got ${plans[0].dialogue}`);
check("e2e: action shot carries prompt + actionId", plans[1].prompt === "男主走到窗边坐下" && plans[1].actionId === "walk", JSON.stringify({ prompt: plans[1].prompt, actionId: plans[1].actionId}));
check("e2e: flySword shot", plans[4].actionId === "flySword" && plans[4].character === "男主", JSON.stringify(plans[4]));
check("e2e: target actors resolved", plans[0].targetActorId === "a1" && plans[2].targetActorId === "a2" && plans[3].targetActorId === "a3", JSON.stringify(plans.map((p) => p.targetActorId)));
// makeShot stores the script link fields
const shots = plans.map((p) => makeShot(p.presetId, {
targetActorId: p.targetActorId, dialogue: p.dialogue, scriptCharacter: p.character,
scriptScene: p.sceneNumber, scriptLine: p.scriptLine, scriptAction: p.actionId, prompt: p.prompt?? "",
}));
check("e2e: shot 1 keeps dialogue + scene", shots[0].dialogue === "男主（愤怒）：你来晚了。" && shots[0].scriptScene === 1 && shots[0].scriptCharacter === "男主");
check("e2e: shot 2 keeps action + line", shots[1].scriptAction === "walk" && shots[1].scriptLine === "男主走到窗边坐下" && shots[1].prompt === "男主走到窗边坐下");
}

// ─── 18. Old saves: makeShot without script fields ───
{
const s = makeShot("indoor-medium");
check("old-save: no script fields", s.dialogue === undefined && s.scriptScene === undefined && s.scriptLine === undefined && s.scriptAction === undefined && s.scriptCharacter === undefined);
check("old-save: prompt still defaults to empty", s.prompt === "");
const withScript = makeShot("indoor-closeup", { dialogue: "男主：你好。", scriptScene: 1, scriptLine: "男主：你好。"});
check("old-save: script opts stored", withScript.dialogue === "男主：你好。" && withScript.scriptScene === 1);
}

// ─── 19. No actors: enrichment leaves action lines alone (cannot judge yet) ───
{
const p = enrichScriptActions(parseScript("第1场 咖啡馆 日 内\n男主走到窗边坐下"), NO_ACTOR_CTX);
const l = p.scenes[0]?.lines[0];
check("no-actor: action line stays action", l?.kind === "action" && l?.actionId === undefined, `got ${l?.kind}`);
}

// ─── 20. Unknown character: dialogue shot still built, no forced actor ───
{
const p = enrichScriptActions(parseScript("第1场 咖啡馆 日 内\n路人甲：你好。"), CTX);
const plans = planShotsFromScript(p, CAST);
check("unknown-char: shot built with dialogue", plans.length === 1 && plans[0].dialogue === "路人甲：你好。", JSON.stringify(plans));
check("unknown-char: no targetActorId forced", plans[0].targetActorId === undefined, `got ${plans[0].targetActorId}`);
}

// ─── 21. Preamble lines: kept, but build no shots ───
{
const p = enrichScriptActions(parseScript("（开场：雨夜，城市全景。）\n第1场 咖啡馆 日 内\n男主：你来晚了。"), CTX);
check("preamble: kept separately", p.preamble.length === 1 && p.scenes.length === 1, `got preamble=${p.preamble.length} scenes=${p.scenes.length}`);
check("preamble: no shot from it", planShotsFromScript(p, CAST).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail? 1: 0);
