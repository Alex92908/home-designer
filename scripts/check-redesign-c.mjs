#!/usr/bin/env node
/**
 * check-redesign-c.mjs — Group C (period/culture) redesign verification.
 *
 * Verifies, for the 9 Group C sets in src/lib/projectTemplates.ts:
 *  1. Every set id is present exactly once (ids unchanged).
 *  2. Every furniture id used in furnitureOverrides + wallDecor exists in
 *     src/lib/furniture.ts (catalog + 137 proc-* procedural ids).
 *  3. Era-lock spot checks (from docs/scene-assets.md "时代锁自查"):
 *     - qinhan: no chairs/stools/high tables, no blue-and-white, no
 *       modern rug, no tropical houseplants.
 *     - weijin: no blue-and-white, no Ming-style high furniture, no
 *       modern rug, no tropical houseplants.
 *     - yuan: no bed / carved bed / bogujia in the yurt camp, no
 *       blue-and-white in the camp, no Ming plain furniture.
 *     - banpo: zero furniture (no tables/chairs/beds/cabinets/lamps),
 *       millet not rice, no Hemudu items.
 *     - hemudu: rice not millet, no Banpo items, zero furniture.
 *     - rural-republican: no electric light / fridge / TV / gramophone /
 *       telephone / fan, no wardrobe / desk / bookshelf.
 *     - versailles: no modern bathroom (toilet/bathtub).
 *     - washitsu: no fixed Western bed, no chairs, no modern coffee
 *       table in the tatami room, no tropical houseplants.
 *     - hanok: courtyard has no rockery/rocks/plants (only path +
 *       firewood tufts), no Chinese furniture.
 *     - all 9: no plant-sansevieria / plant-monstera /
 *       plant-tropic-flowers, no rug-nordic-geo.
 *  4. Room geometry untouched: every set's floorLayouts rooms keep the
 *     same x/y/width/depth as the b0ffbf8 baseline (hard-coded below).
 *
 * Usage: node scripts/check-redesign-c.mjs [--baseline]
 *   --baseline prints per-set furniture counts only (for before/after).
 * Exit 0 = 0 failures, 1 = any failure.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TPL = fs.readFileSync(path.join(ROOT, "src/lib/projectTemplates.ts"), "utf8");
const FURN = fs.readFileSync(path.join(ROOT, "src/lib/furniture.ts"), "utf8");

const SETS = [
  "set-qinhan", "set-weijin", "set-yuan", "set-banpo", "set-hemudu",
  "set-rural-republican", "set-versailles", "set-washitsu", "set-hanok",
];

// Baseline room geometry at b0ffbf8: "setId:roomType" -> [x, y, width, depth]
const BASELINE_GEOM = {
  "set-qinhan:living": [0, 0, 900, 650], "set-qinhan:master": [900, 0, 600, 650],
  "set-qinhan:hallway": [0, 650, 1500, 350],
  "set-weijin:study": [0, 0, 650, 700], "set-weijin:living": [650, 0, 450, 700],
  "set-weijin:hallway": [0, 700, 1100, 300],
  "set-yuan:hallway": [0, 0, 1100, 700], "set-yuan:master": [1100, 0, 900, 700],
  "set-banpo:living": [0, 0, 1600, 1000], "set-banpo:hallway": [1600, 0, 400, 1000],
  "set-hemudu:hallway": [0, 0, 2300, 700], "set-hemudu:custom1": [0, 700, 2300, 300],
  "set-rural-republican:living": [0, 0, 400, 650],
  "set-rural-republican:bedroom": [400, 0, 400, 650],
  "set-rural-republican:bedroom2": [800, 0, 400, 650],
  "set-rural-republican:hallway": [0, 650, 1200, 350],
  "set-versailles:living": [0, 0, 2000, 700], "set-versailles:master": [2000, 0, 800, 700],
  "set-versailles:hallway": [0, 700, 2800, 300],
  "set-washitsu:living": [0, 0, 540, 360], "set-washitsu:study": [540, 0, 360, 360],
  "set-washitsu:hallway": [0, 360, 900, 300],
  "set-hanok:living": [0, 0, 600, 650], "set-hanok:master": [600, 0, 500, 650],
  "set-hanok:kitchen": [600, 650, 500, 350], "set-hanok:hallway": [0, 650, 600, 350],
};

// Era-lock denylists: setId -> room (or "*" = whole set) -> forbidden ids.
// "FURNITURE" is a pseudo-token: any catalog item whose category is a
// furniture category (bed/desk/dining_table/dining_chair/sideboard/
// bookshelf/wardrobe/kitchen_cabinet/sofa/coffee_table) — Banpo/Hemudu
// allow only decor/storage/outdoor_*/plant/rug-ish ground items.
const DENY = {
  "set-qinhan": {
    "*": ["proc-huchuang", "proc-wood-stool", "desk-study", "sideboard-walnut",
      "proc-bluewhite-vase", "rug-nordic-geo", "plant-sansevieria",
      "plant-monstera", "plant-tropic-flowers", "proc-bogujia"],
  },
  "set-weijin": {
    "*": ["proc-bluewhite-vase", "rug-nordic-geo", "plant-sansevieria",
      "plant-monstera", "plant-tropic-flowers", "bookshelf-solid-walnut",
      "desk-study", "sideboard-walnut"],
  },
  "set-yuan": {
    hallway: ["proc-han-ta", "proc-bluewhite-vase", "proc-bogujia",
      "proc-broken-table", "desk-study", "sideboard-walnut"],
    "*": ["proc-bogujia"],
  },
  "set-banpo": {
    "*": ["FURNITURE", "proc-rice-sheaf", "proc-hemudu-pot", "proc-hemudu-stilt",
      "proc-han-ta", "proc-han-an", "proc-han-ji", "proc-kang", "proc-oil-lamp",
      "proc-kerosene-lamp", "proc-bluewhite-vase", "proc-bogujia",
      "proc-huchuang", "proc-wood-stool", "desk-study", "sideboard-walnut"],
  },
  "set-hemudu": {
    "*": ["FURNITURE", "proc-millet-sheaf", "proc-banpo-pot", "proc-banpo-house",
      "proc-banpo-firepit", "proc-han-ta", "proc-han-an", "proc-han-ji",
      "proc-kang", "proc-oil-lamp", "proc-kerosene-lamp", "proc-bluewhite-vase",
      "proc-bogujia", "proc-huchuang", "proc-wood-stool", "desk-study",
      "sideboard-walnut"],
  },
  "set-rural-republican": {
    "*": ["wardrobe-with-clothes", "desk-study", "bookshelf-solid-walnut",
      "fridge", "refrigerator", "tv-", "gramophone", "telephone",
      "fan-electric", "lamp-chandelier-antique"],
  },
  "set-versailles": {
    "*": ["toilet", "bathtub", "bath-tub", "shower", "washbasin-bathroom"],
  },
  "set-washitsu": {
    "*": ["bed-tatami", "plant-sansevieria", "plant-monstera",
      "plant-tropic-flowers", "proc-wood-stool", "desk-study"],
    living: ["coffee-oak-round"],
  },
  "set-hanok": {
    "*": ["sideboard-walnut", "desk-study", "proc-bogujia"],
    hallway: ["proc-rock", "proc-rock-big", "proc-bamboo-clump", "proc-bush",
      "proc-stone-lantern", "proc-water-plane", "proc-pond"],
  },
};

const failures = [];
const notes = [];
const fail = (msg) => failures.push(msg);
const note = (msg) => notes.push(msg);

// --- catalog ids -----------------------------------------------------------
const catalogIds = new Set();
for (const m of FURN.matchAll(/id:\s*"([^"]+)"/g)) catalogIds.add(m[1]);
// furniture category map (for the FURNITURE pseudo-token)
const FURNITURE_CATS = new Set(["bed", "desk", "dining_table", "dining_chair",
  "sideboard", "bookshelf", "wardrobe", "kitchen_cabinet", "sofa", "coffee_table",
  "appliance", "electronics"]);
const catOf = new Map();
for (const m of FURN.matchAll(/id:\s*"([^"]+)"[^}]*?category:\s*"([^"]+)"/gs)) {
  if (!catOf.has(m[1])) catOf.set(m[1], m[2]);
}

// --- split projectTemplates.ts into per-set blocks --------------------------
// Sets are top-level `const XXX_SET: ProjectTemplate = {...};` — slice from
// `id: "set-..."` to the next set's `id: "set-..."` (or end of the 9-set run).
const setSpans = [];
{
  const re = /id:\s*"(set-[a-z-]+)"/g;
  let m;
  const hits = [];
  while ((m = re.exec(TPL))) hits.push({ id: m[1], idx: m.index });
  for (const s of SETS) {
    const hs = hits.filter((h) => h.id === s);
    if (hs.length !== 1) { fail(`set id ${s}: found ${hs.length} times (want 1)`); continue; }
    const start = hs[0].idx;
    const next = hits.find((h) => h.idx > start);
    setSpans.push({ id: s, text: TPL.slice(start, next ? next.idx : TPL.length) });
  }
}
if (setSpans.length !== SETS.length) fail(`only ${setSpans.length}/9 set blocks located`);

// --- per-set checks ---------------------------------------------------------
const counts = {};
for (const { id, text } of setSpans) {
  // furnitureOverrides block: from "furnitureOverrides:" to the closing "];"
  const ovMatch = text.match(/furnitureOverrides:\s*\[([\s\S]*?)\n  \],/);
  if (!ovMatch) { fail(`${id}: furnitureOverrides block not found`); continue; }
  const ov = ovMatch[1];
  // room sections inside overrides: `roomType: [ ... ]`
  const roomSections = {};
  for (const m of ov.matchAll(/(\w+):\s*\[([\s\S]*?)\n      \],/g)) {
    roomSections[m[1]] = m[2];
  }
  // wallDecor entries (room-level, in floorLayouts)
  const wallDecorIds = [...text.matchAll(/wallDecor:\s*\[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/furnitureId:\s*"([^"]+)"/g)].map((x) => x[1]));
  // all furniture ids used (overrides + wallDecor)
  const used = [...ov.matchAll(/furnitureId:\s*"([^"]+)"/g)].map((m) => m[1]);
  const allUsed = [...used, ...wallDecorIds];
  counts[id] = { total: used.length, wallDecor: wallDecorIds.length, rooms: {} };
  for (const [room, body] of Object.entries(roomSections)) {
    counts[id].rooms[room] = [...body.matchAll(/furnitureId:\s*"([^"]+)"/g)].length;
  }
  // 1. every used id exists
  for (const fid of new Set(allUsed)) {
    if (!catalogIds.has(fid)) fail(`${id}: unknown furniture id "${fid}"`);
  }
  // 2. era-lock denylists
  const denyStar = DENY[id]?.["*"] ?? [];
  const checkRoom = (room, ids) => {
    const deny = [...denyStar, ...(DENY[id]?.[room] ?? [])];
    for (const fid of ids) {
      if (deny.includes(fid)) fail(`${id}/${room}: era-lock violation — forbidden id "${fid}"`);
      if (deny.includes("FURNITURE") && FURNITURE_CATS.has(catOf.get(fid) ?? "")) {
        fail(`${id}/${room}: era-lock violation — furniture-category item "${fid}" (${catOf.get(fid)}) in a zero-furniture set`);
      }
      if (fid.startsWith("tv-") && DENY[id]?.["*"]?.includes("tv-")) {
        fail(`${id}/${room}: era-lock violation — TV "${fid}"`);
      }
      if (fid.includes("fridge") || fid.includes("refrigerator")) {
        if (DENY[id]?.["*"]?.some((d) => fid.includes(d))) fail(`${id}/${room}: era-lock violation — fridge "${fid}"`);
      }
    }
  };
  for (const [room, body] of Object.entries(roomSections)) {
    checkRoom(room, [...body.matchAll(/furnitureId:\s*"([^"]+)"/g)].map((m) => m[1]));
  }
  checkRoom("*", wallDecorIds);
  // 3. geometry unchanged
  for (const m of text.matchAll(/\{ room:\s*"(\w+)",\s*x:\s*(\d+),\s*y:\s*(\d+),\s*width:\s*(\d+),\s*depth:\s*(\d+)/g)) {
    const key = `${id}:${m[1]}`;
    const want = BASELINE_GEOM[key];
    if (!want) { fail(`${id}: unexpected room "${m[1]}" in floorLayouts`); continue; }
    const got = [+m[2], +m[3], +m[4], +m[5]];
    if (got.join(",") !== want.join(",")) {
      fail(`${id}/${m[1]}: geometry changed [${got}] (baseline [${want}])`);
    }
  }
  // 4. era-lock positive checks (things that must still be true)
  if (id === "set-qinhan" && !used.includes("proc-han-ta")) fail("set-qinhan: host ta missing");
  if (id === "set-yuan" && !used.includes("proc-yurt")) fail("set-yuan: yurt missing");
  if (id === "set-banpo" && !used.includes("proc-banpo-firepit")) fail("set-banpo: firepit missing");
  if (id === "set-hemudu" && !used.includes("proc-hemudu-stilt")) fail("set-hemudu: stilt longhouse missing");
  if (id === "set-rural-republican" && (!used.includes("proc-oil-lamp") || !used.includes("proc-kerosene-lamp"))) {
    fail("set-rural-republican: oil/kerosene lamp pair missing");
  }
  if (id === "set-versailles" && !used.includes("proc-mirror-wall")) fail("set-versailles: mirror walls missing");
  if (id === "set-washitsu" && !used.includes("proc-tokonoma")) fail("set-washitsu: tokonoma missing");
  if (id === "set-hanok" && !used.includes("proc-ondol-floor")) fail("set-hanok: ondol floor missing");
  // 5. wallDecor present where the design note requires it (all except the
  // two prehistoric sets, which correctly have none)
  const needsDecor = !["set-banpo", "set-hemudu"].includes(id);
  if (needsDecor && wallDecorIds.length === 0) fail(`${id}: no wallDecor (design note requires it)`);
  if (!needsDecor && wallDecorIds.length > 0) fail(`${id}: wallDecor present but prehistoric sets must have none`);
  // 6. no modern flat-roof exterior leftovers are NOT checked here —
  // roofStyle is ignored by the floor-plan-driven renderer (see report).
}

// --- report -----------------------------------------------------------------
const baseline = process.argv.includes("--baseline");
console.log("Group C redesign check — 9 sets");
for (const id of SETS) {
  const c = counts[id];
  if (!c) { console.log(`  ${id}: BLOCK NOT FOUND`); continue; }
  const rooms = Object.entries(c.rooms).map(([r, n]) => `${r}:${n}`).join(" ");
  console.log(`  ${id}: total=${c.total} wallDecor=${c.wallDecor} [${rooms}]`);
}
if (notes.length) { console.log("\nnotes:"); for (const n of notes) console.log(`  - ${n}`); }
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n0 failures — all ids exist, set ids unchanged, geometry unchanged, era-lock spot checks pass.");
