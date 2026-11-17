/**
 * check-scene-redesign-d.mjs — Group D outdoor scene redesign self-check.
 *
 * Usage: node scripts/check-scene-redesign-d.mjs
 * Deps: jiti (TS direct read, same as verify-director-sets.mjs).
 *
 * Checks ONLY the 26 Group D outdoor sets (set-forest ... set-city-wall):
 *  1. All 26 set ids exist in PROJECT_TEMPLATES and in SCENE_SETS, unchanged.
 *  2. Every furnitureId used resolves in FURNITURE; every proc- id is in
 *     the PROCEDURAL_FURNITURE_IDS registry (no invented ids).
 *  3. Every item's TRUE rotated AABB stays inside its yard room (5cm slack).
 *  4. elevationY > 0 items have a supporting item underneath whose top is
 *     within 30cm (same rule as verify-director-sets.mjs §4).
 *  5. Ground plates: exactly one main plate (no elevationY) per set, plus
 *     at most one intentional overlay plate (elevationY > 0, no z-fight).
 *  6. Era locks (spot rules): no modern-only ids in the ancient sets.
 *  7. Density report: before/after object counts vs the b0ffbf8 baseline
 *     (hard-coded from the design note's audit).
 *
 * Fails (non-zero exit) on any FAIL line.
 */
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": new URL("../src", import.meta.url).pathname },
});
const { PROCEDURAL_FURNITURE_IDS } = jiti("../src/lib/proceduralFurniture.ts");
const PROC_ID_SET = new Set(PROCEDURAL_FURNITURE_IDS);
const { getFurnitureById } = jiti("../src/lib/furniture.ts");
const { PROJECT_TEMPLATES } = jiti("../src/lib/projectTemplates.ts");
const { SCENE_SETS } = jiti("../src/lib/sceneSets.ts");

const GROUP_D = [
  "set-forest", "set-bamboo", "set-grassland", "set-desert", "set-mountain",
  "set-cliff", "set-waterfall", "set-lake", "set-beach", "set-snow",
  "set-flower-field", "set-peach", "set-garden", "set-tea", "set-rice-field",
  "set-horse-ranch", "set-farm", "set-street", "set-park", "set-bridge",
  "set-station", "set-ancient-street", "set-market", "set-battlefield",
  "set-military-camp", "set-city-wall",
];

// Object counts at b0ffbf8, audited by scripts (design-d.md appendix C).
const BASELINE = {
  "set-forest": 56, "set-bamboo": 34, "set-grassland": 37, "set-desert": 14,
  "set-mountain": 32, "set-cliff": 27, "set-waterfall": 28, "set-lake": 24,
  "set-beach": 14, "set-snow": 25, "set-flower-field": 43, "set-peach": 29,
  "set-garden": 36, "set-tea": 36, "set-rice-field": 24, "set-horse-ranch": 25,
  "set-farm": 28, "set-street": 16, "set-park": 40, "set-bridge": 19,
  "set-station": 20, "set-ancient-street": 19, "set-market": 18,
  "set-battlefield": 41, "set-military-camp": 32, "set-city-wall": 20,
};

// Modern ids that must never appear in a period set (era lock).
const MODERN_IDS = new Set([
  "proc-shop-facade", "proc-street-lamp", "proc-rail-track", "proc-platform",
  "proc-barn", "fountain", "swing",
]);
const ANCIENT_SETS = new Set([
  "set-ancient-street", "set-market", "set-battlefield", "set-military-camp",
  "set-city-wall",
]);

let failures = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log(`  PASS ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}`); }
}

const byId = new Map(PROJECT_TEMPLATES.map((t) => [t.id, t]));
const sceneIds = new Set(SCENE_SETS.map((s) => s.id));

console.log("== 1. set ids unchanged & listed ==");
for (const id of GROUP_D) {
  ok(byId.has(id), `${id} in PROJECT_TEMPLATES`);
  ok(sceneIds.has(id), `${id} in SCENE_SETS`);
}

console.log("== 2. ids resolve / 3. rotated AABB inside yard / 4. elevation support ==");
for (const id of GROUP_D) {
  const tpl = byId.get(id);
  if (!tpl) continue;
  const room = tpl.floorLayouts[0].rooms.find((r) => r.room === "yard");
  const items = tpl.furnitureOverrides[0].yard;
  for (const it of items) {
    const f = getFurnitureById(it.furnitureId);
    ok(!!f, `${id}: ${it.furnitureId} resolves`);
    if (!f) continue;
    if (it.furnitureId.startsWith("proc-")) {
      ok(PROC_ID_SET.has(it.furnitureId),
        `${id}: ${it.furnitureId} in PROCEDURAL registry`);
    }
    const sw = it.scaleW ?? 1, sd = it.scaleD ?? 1;
    const w = f.width * sw, d = f.depth * sd;
    const a = ((it.rotation ?? 0) * Math.PI) / 180;
    const hw = (Math.abs(w * Math.cos(a)) + Math.abs(d * Math.sin(a))) / 2;
    const hd = (Math.abs(w * Math.sin(a)) + Math.abs(d * Math.cos(a))) / 2;
    ok(it.x - hw >= -5 && it.x + hw <= room.width + 5 &&
       it.z - hd >= -5 && it.z + hd <= room.depth + 5,
      `${id}: ${it.furnitureId} @(${it.x},${it.z}) rot=${it.rotation} ` +
      `${(2 * hw).toFixed(0)}x${(2 * hd).toFixed(0)} in ${room.width}x${room.depth}`);
    const elev = it.elevationY ?? 0;
    if (elev > 0) {
      let supported = false;
      for (const o of items) {
        if (o === it) continue;
        const of = getFurnitureById(o.furnitureId);
        if (!of) continue;
        const ow = of.width * (o.scaleW ?? 1), od = of.depth * (o.scaleD ?? 1);
        const oa = ((o.rotation ?? 0) * Math.PI) / 180;
        const ohw = (Math.abs(ow * Math.cos(oa)) + Math.abs(od * Math.sin(oa))) / 2;
        const ohd = (Math.abs(ow * Math.sin(oa)) + Math.abs(od * Math.cos(oa))) / 2;
        const covers = Math.abs(it.x - o.x) <= ohw + 8 && Math.abs(it.z - o.z) <= ohd + 8;
        const top = (o.elevationY ?? 0) + of.height * (o.scaleH ?? 1);
        if (covers && Math.abs(top - elev) <= 30) { supported = true; break; }
      }
      ok(supported, `${id}: ${it.furnitureId} elev=${elev} supported`);
    }
  }
}

console.log("== 5. ground plates ==");
for (const id of GROUP_D) {
  const tpl = byId.get(id);
  if (!tpl) continue;
  const items = tpl.furnitureOverrides[0].yard;
  const mains = items.filter((i) => i.furnitureId.startsWith("proc-ground-") && !(i.elevationY > 0));
  const overlays = items.filter((i) => i.furnitureId.startsWith("proc-ground-") && i.elevationY > 0);
  ok(mains.length === 1, `${id}: exactly 1 main ground plate (got ${mains.length})`);
  ok(overlays.length <= 1, `${id}: at most 1 overlay plate (got ${overlays.length})`);
}

console.log("== 6. era locks ==");
for (const id of ANCIENT_SETS) {
  const tpl = byId.get(id);
  if (!tpl) continue;
  const bad = tpl.furnitureOverrides[0].yard
    .map((i) => i.furnitureId).filter((f) => MODERN_IDS.has(f));
  ok(bad.length === 0, `${id}: no modern ids (got ${bad.join(",") || "none"})`);
}

console.log("== 7. density vs b0ffbf8 baseline ==");
let before = 0, after = 0;
for (const id of GROUP_D) {
  const tpl = byId.get(id);
  if (!tpl) continue;
  const n = tpl.furnitureOverrides[0].yard.length;
  before += BASELINE[id]; after += n;
  ok(n > BASELINE[id], `${id}: ${BASELINE[id]} -> ${n} objects`);
}
console.log(`  TOTAL: ${before} -> ${after} objects (+${after - before})`);

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
