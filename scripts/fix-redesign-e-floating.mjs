/**
 * fix-redesign-e-floating.mjs — repair the 46 verify-director-sets failures
 * introduced by the Group E redesign (floating smalls at elev 85/92 with no
 * carrier beneath, + 4 out-of-bounds placements).
 *
 * Rule (same as scripts/verify-director-sets.mjs §3-5): an item with
 * elevationY > 0 must have another item in the same room whose footprint
 * covers its (x, z) (±8cm) and whose top is within 30cm of its elevation
 * — or be in SUSPENDED_ALLOWLIST (wall-mounted by design).
 *
 * Fix policy per failing item:
 *  - elevation: snap onto the nearest ground-level carrier in the same room
 *    whose top is in [40, 120] (table/sideboard/bench height), at a free
 *    slot on that carrier's top, elevationY := carrier top. If no such
 *    carrier is within 300cm, drop to the ground (elevationY := 0) — the
 *    correct placement for yard flowers/rocks/lanterns/urns/plants.
 *  - bounds: clamp (x, z) so the rotated footprint fits inside the room.
 * Iterates the check-fix loop until 0 failures (moving one small can
 * un-support another that sat on it), max 5 rounds.
 * Patches src/lib/projectTemplates.ts by line (set block + room key +
 * furnitureId + original coords), never touching anything else.
 * Usage: node scripts/fix-redesign-e-floating.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createJiti } from "jiti";

const DRY = process.argv.includes("--dry-run");
const jiti = createJiti(import.meta.url, {
  alias: { "@": new URL("../src", import.meta.url).pathname },
});
const { PROJECT_TEMPLATES } = jiti("../src/lib/projectTemplates.ts");
const { getFurnitureById } = jiti("../src/lib/furniture.ts");
const verifySrc = readFileSync(
  new URL("./verify-director-sets.mjs", import.meta.url),
  "utf8",
);
const allowSrc = verifySrc.match(
  /const SUSPENDED_ALLOWLIST = new Set\(\[([\s\S]*?)\]\);/,
)[1];
const SUSPENDED = new Set([...allowSrc.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
const listOf = (name) =>
  new Set(
    [...verifySrc.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  );
const CHECKED = new Set([...listOf("NEW_SET_IDS"), ...listOf("PAIR_SET_IDS")]);

function dims(it) {
  const f = getFurnitureById(it.furnitureId);
  if (!f) return null;
  const sw = it.scaleW ?? 1, sd = it.scaleD ?? 1, sh = it.scaleH ?? 1;
  const rot90 = it.rotation === 90 || it.rotation === 270;
  return {
    fw: rot90 ? f.depth * sd : f.width * sw,
    fd: rot90 ? f.width * sw : f.depth * sd,
    top: (it.elevationY ?? 0) + f.height * sh,
    h: f.height * sh,
  };
}

// Replicate verify-director-sets §3-5 placement check; returns failures.
function findFailures() {
  const fails = [];
  for (const tpl of PROJECT_TEMPLATES) {
    if (!CHECKED.has(tpl.id)) continue;
    for (let fi = 0; fi < tpl.floorLayouts.length; fi++) {
      const rooms = tpl.floorLayouts[fi].rooms;
      const overrides = tpl.furnitureOverrides?.[fi];
      if (!overrides) continue;
      for (const [roomId, items] of Object.entries(overrides)) {
        const room = rooms.find((r) => r.room === roomId);
        if (!room) continue;
        for (const it of items) {
          const d = dims(it);
          if (!d) continue;
          const inside =
            it.x - d.fw / 2 >= -5 && it.x + d.fw / 2 <= room.width + 5 &&
            it.z - d.fd / 2 >= -5 && it.z + d.fd / 2 <= room.depth + 5;
          if (!inside) fails.push({ tpl, roomId, room, it, kind: "bounds" });
          const elev = it.elevationY ?? 0;
          if (elev > 0 && !it.mountCeiling && !SUSPENDED.has(it.furnitureId)) {
            let supported = false;
            for (const other of items) {
              if (other === it) continue;
              const od = dims(other);
              if (!od) continue;
              const covers =
                Math.abs(it.x - other.x) <= od.fw / 2 + 8 &&
                Math.abs(it.z - other.z) <= od.fd / 2 + 8;
              if (covers && Math.abs(od.top - elev) <= 30) { supported = true; break; }
            }
            if (!supported) fails.push({ tpl, roomId, room, it, kind: "elev" });
          }
        }
      }
    }
  }
  return fails;
}

function roomItems(tpl, fi, roomId) {
  return tpl.furnitureOverrides[fi][roomId] ?? [];
}

// Items that stand on the ground by nature (plants, rocks, lanterns, urns,
// benches, bamboo) — never "on" a carrier; elev 0 is the correct fix.
const GROUND_RE = /^(plant-|proc-flower-|proc-rock|proc-stone-lantern|decor-garden-urn|proc-outdoor-bench|proc-bamboo-|proc-ground-|proc-tree-|proc-grass-)/;
// Ids that are not table surfaces: never use as carriers (no stacking a bowl
// on a flowering plant, a book on a vase, an urn on a millet sheaf).
const NOT_A_SURFACE_RE = /^(plant-|proc-flower-|proc-rock|proc-stone-lantern|decor-garden-urn|proc-outdoor-bench|proc-bamboo-|proc-ground-|proc-tree-|proc-grass-|proc-millet-|decor-vase|proc-lacquer-bowl|decor-books|decor-fruit|decor-dinner|proc-oil-lamp|proc-celadon|fountain|proc-boshanlu)/;
const isGroundType = (id) => GROUND_RE.test(id);
const isSurface = (id) => !NOT_A_SURFACE_RE.test(id);

// Free slots on a carrier footprint (inset 12cm, 30cm grid), nearest first.
function slotsOn(carrier, cd, taken) {
  const pts = [];
  const x0 = carrier.x - cd.fw / 2 + 12, x1 = carrier.x + cd.fw / 2 - 12;
  const z0 = carrier.z - cd.fd / 2 + 12, z1 = carrier.z + cd.fd / 2 - 12;
  for (let x = x0; x <= x1 + 0.01; x += 30)
    for (let z = z0; z <= z1 + 0.01; z += 30) pts.push({ x: Math.round(x), z: Math.round(z) });
  if (!pts.length) pts.push({ x: carrier.x, z: carrier.z });
  return pts
    .filter((p) => !taken.some((t) => Math.abs(t.x - p.x) < 20 && Math.abs(t.z - p.z) < 20))
    .sort((a, b) => (a.x - carrier.x) ** 2 + (a.z - carrier.z) ** 2 - ((b.x - carrier.x) ** 2 + (b.z - carrier.z) ** 2));
}

const fixes = []; // {setId, roomId, furnitureId, ox, oz, nx, nz, nelev, why}
function fixOne(f) {
  const { tpl, roomId, room, it } = f;
  const fi = tpl.floorLayouts.findIndex((l) => l.rooms.some((r) => r.room === roomId));
  const items = roomItems(tpl, fi, roomId);
  if (f.kind === "bounds") {
    const d = dims(it);
    const nx = Math.max(d.fw / 2 - 5, Math.min(room.width - d.fw / 2 + 5, it.x));
    const nz = Math.max(d.fd / 2 - 5, Math.min(room.depth - d.fd / 2 + 5, it.z));
    fixes.push({ setId: tpl.id, roomId, furnitureId: it.furnitureId, ox: it.x, oz: it.z, nx: Math.round(nx), nz: Math.round(nz), nelev: it.elevationY ?? 0, why: `bounds clamp in ${room.width}x${room.depth}` });
    it.x = Math.round(nx); it.z = Math.round(nz);
    return;
  }
  // elevation: ground-type items belong on the ground, not on a carrier
  if (isGroundType(it.furnitureId)) {
    fixes.push({ setId: tpl.id, roomId, furnitureId: it.furnitureId, ox: it.x, oz: it.z, nx: it.x, nz: it.z, nelev: 0, why: "ground-type item -> ground" });
    it.elevationY = 0;
    return;
  }
  // elevation: nearest ground-level SURFACE carrier with top in [40,120] within 300cm edge gap
  const cands = [];
  for (const other of items) {
    if (other === it) continue;
    if ((other.elevationY ?? 0) !== 0) continue; // ground-level carriers only
    if (!isSurface(other.furnitureId)) continue;
    const od = dims(other);
    if (!od || od.top < 40 || od.top > 120) continue;
    if (od.fw < 40 || od.fd < 40) continue;
    const gapX = Math.max(0, Math.abs(it.x - other.x) - od.fw / 2);
    const gapZ = Math.max(0, Math.abs(it.z - other.z) - od.fd / 2);
    const gap = Math.hypot(gapX, gapZ);
    if (gap > 300) continue;
    cands.push({ other, od, gap });
  }
  cands.sort((a, b) => a.gap - b.gap);
  let placed = null;
  for (const best of cands) {
    const taken = items
      .filter((o) => o !== it && o !== best.other)
      .map((o) => ({ x: o.x, z: o.z }));
    const slots = slotsOn(best.other, best.od, taken);
    if (slots.length) { placed = { best, s: slots[0] }; break; }
  }
  if (placed) {
    const { best, s } = placed;
    fixes.push({ setId: tpl.id, roomId, furnitureId: it.furnitureId, ox: it.x, oz: it.z, nx: s.x, nz: s.z, nelev: Math.round(best.od.top), why: `onto ${best.other.furnitureId} top=${best.od.top.toFixed(0)}` });
    it.x = s.x; it.z = s.z; it.elevationY = Math.round(best.od.top);
  } else {
    fixes.push({ setId: tpl.id, roomId, furnitureId: it.furnitureId, ox: it.x, oz: it.z, nx: it.x, nz: it.z, nelev: 0, why: "no carrier within 300cm -> ground" });
    it.elevationY = 0;
  }
}

let round = 0;
while (round < 5) {
  round++;
  const fails = findFailures();
  console.log(`round ${round}: ${fails.length} failures`);
  if (!fails.length) break;
  for (const f of fails) fixOne(f);
}
const remaining = findFailures();
console.log(`after ${round} rounds: ${remaining.length} failures remain`);
for (const f of remaining)
  console.log(`  STILL FAILING ${f.tpl.id}/${f.roomId}: ${f.it.furnitureId} @(${f.it.x},${f.it.z}) elev=${f.it.elevationY ?? 0} kind=${f.kind}`);
console.log(`total fixes: ${fixes.length}`);
for (const fx of fixes)
  console.log(`  ${fx.setId}/${fx.roomId} ${fx.furnitureId} (${fx.ox},${fx.oz}) -> (${fx.nx},${fx.nz}) elev=${fx.nelev} [${fx.why}]`);
if (DRY || remaining.length) {
  console.log(DRY ? "dry run — file NOT written" : "failures remain — file NOT written");
  process.exit(remaining.length ? 1 : 0);
}

// ---- patch the source text by line ----
const path = new URL("../src/lib/projectTemplates.ts", import.meta.url);
const lines = readFileSync(path, "utf8").split("\n");
const used = new Set();
for (const fx of fixes) {
  // find set block
  let si = lines.findIndex((l, i) => i >= 0 && l.includes(`id: "${fx.setId}"`));
  if (si < 0) throw new Error(`set not found: ${fx.setId}`);
  // find room key after set start (first `roomId: [` line)
  let ri = -1;
  for (let i = si; i < lines.length; i++) {
    if (/^\s{6}[a-zA-Z0-9_]+: \[$/.test(lines[i]) && lines[i].trim().startsWith(fx.roomId + ":")) { ri = i; break; }
    if (lines[i].includes("id: \"set-") && i !== si) break; // next set
  }
  if (ri < 0) throw new Error(`room ${fx.roomId} not found in ${fx.setId}`);
  // find item line: furnitureId + x + z, not yet patched
  let li = -1;
  for (let i = ri; i < lines.length; i++) {
    if (/^\s{6}[a-zA-Z0-9_]+: \[$/.test(lines[i]) && i !== ri) break; // next room
    if (used.has(i)) continue;
    const l = lines[i];
    if (l.includes(`furnitureId: "${fx.furnitureId}"`) && l.includes(`x: ${fx.ox}`) && l.includes(`z: ${fx.oz}`)) { li = i; break; }
  }
  if (li < 0) throw new Error(`item line not found: ${fx.setId}/${fx.roomId} ${fx.furnitureId} (${fx.ox},${fx.oz})`);
  used.add(li);
  let l = lines[li];
  l = l.replace(`x: ${fx.ox}`, `x: ${fx.nx}`).replace(`z: ${fx.oz}`, `z: ${fx.nz}`);
  if (fx.nelev === 0) l = l.replace(/, elevationY: \d+/, "");
  else if (/elevationY: \d+/.test(l)) l = l.replace(/elevationY: \d+/, `elevationY: ${fx.nelev}`);
  else l = l.replace(/ \},?$/, `, elevationY: ${fx.nelev} },`).replace(/ \},$/, `, elevationY: ${fx.nelev} },`);
  lines[li] = l;
}
writeFileSync(path, lines.join("\n"));
console.log("patched src/lib/projectTemplates.ts");
