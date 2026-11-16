/**
 * check-director-styles — 导演风格预设逻辑校验（node 直接跑，不用打包）。
 *
 * 校验（全部用真实注册表交叉引用，不用假数据）：
 *  1. 每个预设都有全部必填字段（label/description/camera/lighting/
 *     shotOrder/suggestedSets/suggestedCostumes/suggestedActions/
 *     beats/playbook/gaps），且 id 唯一、非空。
 *  2. 每个预设引用的机位/灯光/片场/服装/动作 id 都真实存在
 *     （机位 = CINE_PRESETS，灯光 = LIGHTING_PRESETS，片场 =
 *     projectTemplates.ts 里的 set- id，服装 = COSTUMES，动作 =
 *     ACTION_REGISTRY）——无悬空引用。
 *  3. 应用预设返回的默认值与预设文档一致（camera + lighting）。
 *  4. 未知预设 id 安全回落到 plain 默认（camera indoor-wide, lighting day,
 *     shotOrder 空），不抛错；null/"" 同理。
 *  5. 应用预设是纯默认值函数——它不返回也不触碰 shots/actors/
 *     blocking（预设永不删改用户已有内容；store 的 setDirectorStyleId
 *     只 set { directorStyleId, sceneLightingId }，见组件源码注释）。
 *  6. shotOrder 非空、全部是真实机位 id；suggestedSets/Costumes/Actions
 *     非空（每套预设至少给一个建议）。
 *
 * 用法（在仓库根目录）：
 *   npx tsc scripts/check-director-styles.ts --outDir /tmp/ds-check \
 *     --module commonjs --target es2020 --moduleResolution node \
 *     --esModuleInterop --skipLibCheck --noEmit false --rootDir . \
 *     && node /tmp/ds-check/scripts/check-director-styles.js
 * 退出码：0 = 全部通过；1 = 有失败。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIRECTOR_STYLES, getDirectorStyle, directorStyleDefaults, isDirectorStyleId, PLAIN_DEFAULTS } from "../src/lib/directorStyles";
import { CINE_PRESETS } from "../src/lib/cinematic";
import { LIGHTING_PRESETS } from "../src/lib/lighting";
import { COSTUMES } from "../src/lib/characters";
import { ACTION_REGISTRY } from "../src/lib/actions";

const root = process.cwd();

// 片场 id 的事实来源：projectTemplates.ts 里 id 以 set- 开头的模板
// （SCENE_SETS 就是它过滤出来的；这里直接读源码，避免把 500MB 的
// 模板 + GLB 依赖拉进 node 进程）。
const projectTemplatesSrc = readFileSync(join(root, "src/lib/projectTemplates.ts"), "utf8");
const SET_IDS = new Set(
  [...projectTemplatesSrc.matchAll(/id:\s*"((?:set-)[a-z0-9-]+)"/g)].map((m) => m[1]),
);

const CINE_IDS = new Set(CINE_PRESETS.map((p) => p.id));
const LIGHTING_IDS = new Set(LIGHTING_PRESETS.map((p) => p.id));
const COSTUME_IDS = new Set(Object.keys(COSTUMES));
const ACTION_IDS = new Set(Object.keys(ACTION_REGISTRY));

let pass = 0;
let fail = 0;
function check(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`Presets: ${DIRECTOR_STYLES.length} (ids: ${DIRECTOR_STYLES.map((s) => s.id).join(", ")})`);
console.log(`Reference sizes: cine=${CINE_IDS.size} lighting=${LIGHTING_IDS.size} sets=${SET_IDS.size} costumes=${COSTUME_IDS.size} actions=${ACTION_IDS.size}`);

// 1. 必填字段 + id 唯一
console.log("\n[1] required fields + unique ids");
const seen = new Set<string>();
for (const s of DIRECTOR_STYLES) {
  check(typeof s.id === "string" && s.id.length > 0, `${s.id}: id non-empty`);
  check(!seen.has(s.id), `${s.id}: id unique`);
  seen.add(s.id);
  check(!!s.labelZh && !!s.labelEn, `${s.id}: label zh+en`);
  check(!!s.descriptionZh && !!s.descriptionEn, `${s.id}: description zh+en`);
  check(typeof s.cameraPresetId === "string" && s.cameraPresetId.length > 0, `${s.id}: cameraPresetId`);
  check(typeof s.lightingId === "string" && s.lightingId.length > 0, `${s.id}: lightingId`);
  check(Array.isArray(s.shotOrder) && s.shotOrder.length > 0, `${s.id}: shotOrder non-empty`);
  check(Array.isArray(s.suggestedSets) && s.suggestedSets.length > 0, `${s.id}: suggestedSets non-empty`);
  check(Array.isArray(s.suggestedCostumes) && s.suggestedCostumes.length > 0, `${s.id}: suggestedCostumes non-empty`);
  check(Array.isArray(s.suggestedActions) && s.suggestedActions.length > 0, `${s.id}: suggestedActions non-empty`);
  check(Array.isArray(s.beatsZh) && s.beatsZh.length > 0 && Array.isArray(s.beatsEn) && s.beatsEn.length === s.beatsZh.length, `${s.id}: beats zh+en (same length)`);
  check(typeof s.playbook === "string" && s.playbook.endsWith(".md"), `${s.id}: playbook file`);
  check(Array.isArray(s.gapsZh) && Array.isArray(s.gapsEn) && s.gapsEn.length === s.gapsZh.length, `${s.id}: gaps zh+en (same length)`);
}

// 2. 交叉引用：无悬空 id
console.log("\n[2] cross-references exist (no dangling ids)");
for (const s of DIRECTOR_STYLES) {
  check(CINE_IDS.has(s.cameraPresetId), `${s.id}: camera ${s.cameraPresetId} exists`, `known: ${[...CINE_IDS].join(",")}`);
  check(LIGHTING_IDS.has(s.lightingId), `${s.id}: lighting ${s.lightingId} exists`);
  for (const pid of s.shotOrder) check(CINE_IDS.has(pid), `${s.id}: shotOrder ${pid} exists`);
  for (const sid of s.suggestedSets) check(SET_IDS.has(sid), `${s.id}: set ${sid} exists`);
  for (const cid of s.suggestedCostumes) check(COSTUME_IDS.has(cid), `${s.id}: costume ${cid} exists`);
  for (const aid of s.suggestedActions) check(ACTION_IDS.has(aid), `${s.id}: action ${aid} exists`);
  // 手册文件真实存在
  try {
    readFileSync(join(root, "docs/director-skills", s.playbook), "utf8");
    check(true, `${s.id}: playbook docs/director-skills/${s.playbook} exists`);
  } catch {
    check(false, `${s.id}: playbook docs/director-skills/${s.playbook} exists`);
  }
}

// 3. 应用预设 = 文档里的默认值
console.log("\n[3] applying a preset returns its documented defaults");
for (const s of DIRECTOR_STYLES) {
  const d = directorStyleDefaults(s.id);
  check(d.cameraPresetId === s.cameraPresetId, `${s.id}: camera = ${s.cameraPresetId}`, `got ${d.cameraPresetId}`);
  check(d.lightingId === s.lightingId, `${s.id}: lighting = ${s.lightingId}`, `got ${d.lightingId}`);
  check(JSON.stringify(d.shotOrder) === JSON.stringify(s.shotOrder), `${s.id}: shotOrder matches`);
  check(getDirectorStyle(s.id)?.id === s.id, `${s.id}: getDirectorStyle finds it`);
  check(isDirectorStyleId(s.id), `${s.id}: isDirectorStyleId true`);
}

// 4. 未知 id 安全回落
console.log("\n[4] unknown ids fall back safely to plain defaults");
for (const bad of ["no-such-director", "", null, undefined]) {
  const d = directorStyleDefaults(bad as string | null | undefined);
  check(
    d.cameraPresetId === PLAIN_DEFAULTS.cameraPresetId &&
      d.lightingId === PLAIN_DEFAULTS.lightingId &&
      d.shotOrder.length === 0,
    `directorStyleDefaults(${JSON.stringify(bad)}) → plain defaults`,
    `got ${JSON.stringify(d)}`,
  );
  check(getDirectorStyle(bad as string | null | undefined) === undefined, `getDirectorStyle(${JSON.stringify(bad)}) → undefined`);
  check(!isDirectorStyleId(String(bad ?? "")), `isDirectorStyleId(${JSON.stringify(bad)}) → false`);
}

// 5. 应用预设不触碰用户内容（纯函数：返回值里只有默认值，没有
//    shots/actors/blocking；且两次调用返回独立的 shotOrder 副本）
console.log("\n[5] applying a preset cannot touch user content (pure defaults fn)");
for (const s of DIRECTOR_STYLES) {
  const d = directorStyleDefaults(s.id);
  const keys = Object.keys(d).sort();
  check(JSON.stringify(keys) === JSON.stringify(["cameraPresetId", "lightingId", "shotOrder"]), `${s.id}: defaults object has only camera/lighting/shotOrder keys`, `got ${keys.join(",")}`);
  const d2 = directorStyleDefaults(s.id);
  d.shotOrder.push("MUTATION-PROBE");
  check(!d2.shotOrder.includes("MUTATION-PROBE"), `${s.id}: shotOrder is a fresh copy per call (no shared mutation)`);
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
