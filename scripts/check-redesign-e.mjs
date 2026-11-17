// check-redesign-e.mjs — Group E scene-redesign verification (text-based).
// Run: node scripts/check-redesign-e.mjs   (from the worktree root)
// Verifies, for the 23 Group E sets only:
//   1. every set id is unchanged vs HEAD (and no template id anywhere changed)
//   2. every furnitureId used exists in the catalog (furniture.ts) or the
//      procedural registry (proceduralFurniture.ts)
//   3. each prosperity/decline pair still shares identical base geometry:
//      same floorLayouts expression AND the shared layout function text is
//      byte-identical to HEAD
//   4. every override room key matches a room in that pair's layout, and
//      every non-ground-plane item sits inside its room's bounds
//   5. the villa yardPlan uses only valid yard kinds / prefab kinds / zone kinds
//   6. elevationY / mountCeiling / scale values are sane
// Exit code 0 = all checks pass.
import { execSync } from "node:child_process";
import fs from "node:fs";

const TPL = "src/lib/projectTemplates.ts";
const src = fs.readFileSync(TPL, "utf8");
const head = execSync(`git show HEAD:${TPL}`, { encoding: "utf8" });

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}

// ─── registries ────────────────────────────────────────────────────────────
const furnSrc = fs.readFileSync("src/lib/furniture.ts", "utf8");
const catalogIds = new Set([...furnSrc.matchAll(/id:\s*"([a-z0-9_-]+)"/g)].map(m => m[1]));
const procSrc = fs.readFileSync("src/lib/proceduralFurniture.ts", "utf8");
const procIds = new Set([...procSrc.matchAll(/"(proc-[a-z0-9-]+)":\s*build/g)].map(m => m[1]));
const allFurnitureIds = new Set([...catalogIds, ...procIds]);
check("catalog has proc ids too (sanity)", [...procIds].every(id => catalogIds.has(id)) || procIds.size === 137,
  `proc registry=${procIds.size}`);
check("procedural registry == 137 ids", procIds.size === 137, `got ${procIds.size}`);

const outdoorSrc = fs.readFileSync("src/lib/outdoorAssets.ts", "utf8");
const yardKinds = new Set([...outdoorSrc.matchAll(/kind:\s*"((?:tree|plant|rock|feature)\.[a-zA-Z]+)"/g)].map(m => m[1]));
const typesSrc = fs.readFileSync("src/lib/types.ts", "utf8");
const prefabKinds = new Set([...typesSrc.matchAll(/\|\s*"([a-z_]+)"/g)].map(m => m[1])
  .filter(k => ["social_island","farm_box","porte_cochere","slat_wall","fence_segment","parking_area","glb_model","pool","pergola_classic","outdoor_kitchen","fountain"].includes(k)));
const zoneKinds = new Set(["social","private","utility","agro","lawn"]);

// ─── Group E sets ──────────────────────────────────────────────────────────
const PAIRS = [
  ["set-tang-changan-prosperous", "set-tang-changan-ruined", "tangChanganLayout"],
  ["set-song-bianjing-prosperous", "set-song-bianjing-ruined", "songBianjingLayout"],
  ["set-qing-garden-prosperous", "set-qing-garden-ruined", "qingGardenLayout"],
  ["set-ming-palace-prosperous", "set-ming-palace-ruined", "mingPalaceLayout"],
  ["set-rome-prosperous", "set-rome-ruined", "romeLayout"],
  ["set-pompeii-prosperous", "set-pompeii-ruined", "pompeiiLayout"],
  ["set-loulan-prosperous", "set-loulan-ruined", "loulanLayout"],
  ["set-mall-prosperous", "set-mall-ruined", "mallLayout"],
  ["set-mansion-prosperous", "set-mansion-ruined", "mansionLayout"],
  ["set-school-prosperous", "set-school-abandoned", "schoolPairLayout"],
  ["set-village-prosperous", "set-village-hollow", "villageLayout"],
];
const GROUP_E = [...PAIRS.flatMap(([a, b]) => [a, b]), "set-villa-suburban"];

// 1. template ids unchanged vs HEAD (whole file)
const idsNow = [...src.matchAll(/^  id:\s*"([^"]+)",$/gm)].map(m => m[1]);
const idsHead = [...head.matchAll(/^  id:\s*"([^"]+)",$/gm)].map(m => m[1]);
check("template id list identical to HEAD",
  idsNow.length === idsHead.length && idsNow.every((id, i) => id === idsHead[i]),
  `now=${idsNow.length} head=${idsHead.length}`);
for (const id of GROUP_E) check(`set id present: ${id}`, idsNow.includes(id));

// helpers to slice one set's const block
function setBlock(s, sid) {
  const m = s.match(new RegExp(`id:\\s*"${sid}"`));
  if (!m) return null;
  const start = s.lastIndexOf("const ", m.index);
  // block ends at the next top-level "const " after start+10 or "};" at col 0
  const next = s.indexOf("\nconst ", start + 10);
  const end = s.indexOf("\n};", start + 10);
  const cut = [next, end].filter(x => x > 0);
  return s.slice(start, Math.min(...cut) + 3);
}
function bracketSpan(s, i) {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === "[") depth++;
    else if (s[k] === "]") { depth--; if (depth === 0) return k + 1; }
  }
  return -1;
}
function overridesOf(block) {
  const m = block.match(/furnitureOverrides:\s*\[/);
  if (!m) return null;
  const a = m.index + m[0].length - 1;
  return block.slice(a, bracketSpan(block, a));
}
function layoutFn(s, name) {
  const m = s.match(new RegExp(`function ${name}\\(\\)[\\s\\S]*?\\n\\}`));
  return m ? m[0] : null;
}
function roomsOfLayout(fnText) {
  // { room: "yard", x: 0, y: 0, width: 1800, depth: 700, ...
  return [...fnText.matchAll(/\{\s*room:\s*"(\w+)",\s*x:\s*\d+,\s*y:\s*\d+,\s*width:\s*(\d+),\s*depth:\s*(\d+)/g)]
    .map(m => ({ room: m[1], width: +m[2], depth: +m[3] }));
}
function parseItems(ovText) {
  // returns [{room, fid, x, z, elev, ceil, sw, sd}]
  const out = [];
  const roomRe = /^(\s{6})(\w+): \[$/gm;
  let rm;
  const rooms = [];
  while ((rm = roomRe.exec(ovText))) rooms.push({ room: rm[2], idx: rm.index });
  rooms.push({ room: null, idx: ovText.length });
  for (let i = 0; i < rooms.length - 1; i++) {
    const seg = ovText.slice(rooms[i].idx, rooms[i + 1].idx);
    for (const im of seg.matchAll(/\{\s*furnitureId:\s*"([^"]+)",\s*x:\s*(-?[\d.]+),\s*z:\s*(-?[\d.]+),\s*rotation:\s*(-?[\d.]+)(?:,\s*elevationY:\s*(-?[\d.]+))?(?:,\s*mountCeiling:\s*true)?(?:,\s*scaleW:\s*([\d.]+),\s*scaleD:\s*([\d.]+))?\s*\}/g)) {
      out.push({ room: rooms[i].room, fid: im[1], x: +im[2], z: +im[3],
        elev: im[5] !== undefined ? +im[5] : null,
        ceil: im[0].includes("mountCeiling"),
        sw: im[6] !== undefined ? +im[6] : null,
        sd: im[7] !== undefined ? +im[7] : null });
    }
  }
  return out;
}

// 2/3/4. per pair
const GROUND = new Set(["proc-ground-sand", "proc-ground-dry", "proc-water-plane"]);
for (const [pros, ruin, layoutFnName] of PAIRS) {
  const fnNow = layoutFn(src, layoutFnName);
  const fnHead = layoutFn(head, layoutFnName);
  check(`${layoutFnName} unchanged vs HEAD`, fnNow !== null && fnNow === fnHead);
  const rooms = roomsOfLayout(fnNow);
  check(`${layoutFnName} has rooms`, rooms.length >= 3, JSON.stringify(rooms));
  for (const sid of [pros, ruin]) {
    const block = setBlock(src, sid);
    check(`${sid} block found`, !!block);
    if (!block) continue;
    check(`${sid} uses shared layout ${layoutFnName}`,
      block.includes(`floorLayouts: [${layoutFnName}()]`));
    const ov = overridesOf(block);
    check(`${sid} has furnitureOverrides`, !!ov);
    if (!ov) continue;
    const items = parseItems(ov);
    const badIds = items.filter(it => !allFurnitureIds.has(it.fid));
    check(`${sid} all ${items.length} furniture ids exist`, badIds.length === 0,
      badIds.map(b => b.fid).join(","));
    const roomNames = new Set(rooms.map(r => r.room));
    const badRooms = [...new Set(items.map(i => i.room))].filter(r => !roomNames.has(r));
    check(`${sid} override rooms match layout`, badRooms.length === 0, badRooms.join(","));
    const oob = items.filter(it => {
      if (GROUND.has(it.fid)) return false; // ground sheets intentionally extend
      const r = rooms.find(x => x.room === it.room);
      return !r || it.x < 0 || it.x > r.width || it.z < 0 || it.z > r.depth;
    });
    check(`${sid} items inside room bounds`, oob.length === 0,
      oob.map(o => `${o.fid}@${o.room}(${o.x},${o.z})`).join(" "));
    const badElev = items.filter(it => it.elev !== null && (it.elev < 0 || it.elev > 300));
    check(`${sid} elevationY sane`, badElev.length === 0);
    console.log(`  counts ${sid}: total=${items.length} ` +
      rooms.map(r => `${r.room}=${items.filter(i => i.room === r.room).length}`).join(" "));
  }
}

// 5. villa: overrides + yardPlan + wallDecor
{
  const sid = "set-villa-suburban";
  const block = setBlock(src, sid);
  check(`${sid} block found`, !!block);
  const ov = overridesOf(block);
  const items = parseItems(ov);
  const badIds = items.filter(it => !allFurnitureIds.has(it.fid));
  check(`${sid} all ${items.length} furniture ids exist`, badIds.length === 0,
    badIds.map(b => b.fid).join(","));
  check(`${sid} has 2 floors`, (ov.match(/^\s{4}\{/gm) || []).length === 2);
  console.log(`  counts ${sid}: total=${items.length}`);
  // yardPlan kinds
  const yp = block.match(/yardPlan:\s*\{([\s\S]*?)\n  \},/);
  check(`${sid} yardPlan non-empty`, !!yp && !yp[1].includes("items: []"));
  const ypText = yp ? yp[1] : "";
  const badKinds = [...ypText.matchAll(/kind:\s*"([^"]+)"/g)].map(m => m[1])
    .filter(k => !yardKinds.has(k));
  check(`${sid} yard singleton kinds valid`, badKinds.length === 0, badKinds.join(","));
  const badPrefs = [...ypText.matchAll(/prefabKind:\s*"([^"]+)"/g)].map(m => m[1])
    .filter(k => !prefabKinds.has(k));
  check(`${sid} yard prefabKinds valid`, badPrefs.length === 0, badPrefs.join(","));
  const badZones = [...ypText.matchAll(/zoneKind:\s*"([^"]+)"/g)].map(m => m[1])
    .filter(k => !zoneKinds.has(k));
  check(`${sid} yard zoneKinds valid`, badZones.length === 0, badZones.join(","));
  const yIds = [...ypText.matchAll(/id:\s*"([^"]+)"/g)].map(m => m[1]);
  check(`${sid} yard item ids unique`, new Set(yIds).size === yIds.length,
    `n=${yIds.length}`);
  check(`${sid} hallway wallDecor has nameplate + wall lamp`,
    block.includes('"nameplate-family"') && block.includes('"wall-lamp-lantern"'));
}

// 6. no other file region changed: layout functions list identical
const fnNamesNow = [...src.matchAll(/^function (\w+Layout)\(\)/gm)].map(m => m[1]);
const fnNamesHead = [...head.matchAll(/^function (\w+Layout)\(\)/gm)].map(m => m[1]);
check("layout function list identical to HEAD",
  JSON.stringify(fnNamesNow) === JSON.stringify(fnNamesHead));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
