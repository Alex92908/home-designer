/**
 * check-scene-redesign-b.mjs — Group B scene-redesign self-check.
 *
 * 用法：node scripts/check-scene-redesign-b.mjs
 * 依赖：仓库自带的 jiti（TS 直读），与 verify-director-sets.mjs 相同。
 *
 * 查 3 件事（失败即非零退出）：
 *  1. 26 个 Group B 场景 id 全部存在且仅出现一次（id 未改、未丢、未重复）。
 *  2. 26 个场景里的每个 furnitureId 都能在 FURNITURE（587 件目录 +
 *     137 个 proc-* 程序化件 + vehicle.*）里解析到。
 *  3. 打印每个场景的件数（与 redesign 前的基数对照：358 -> 见输出）。
 */
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": new URL("../src", import.meta.url).pathname },
});
const { getFurnitureById } = jiti("../src/lib/furniture.ts");
const { PROJECT_TEMPLATES } = jiti("../src/lib/projectTemplates.ts");

const GROUP_B_IDS = [
  "set-school", "set-school-playground", "set-school-library",
  "set-school-cafeteria", "set-school-bathroom", "set-school-waterroom",
  "set-school-parking", "set-school-track", "set-home-bedroom",
  "set-home-kitchen", "set-home-bathroom", "set-office-ceo",
  "set-office-meeting", "set-office-lobby", "set-office-pantry",
  "set-office-elevator", "set-dormitory", "set-hotel-room", "set-police",
  "set-courtroom", "set-bar", "set-gym", "set-supermarket", "set-ktv",
  "set-wedding", "set-hospital",
];
const BEFORE = {
  "set-school": 20, "set-school-playground": 12, "set-school-library": 17,
  "set-school-cafeteria": 11, "set-school-bathroom": 18,
  "set-school-waterroom": 9, "set-school-parking": 20, "set-school-track": 11,
  "set-home-bedroom": 13, "set-home-kitchen": 15, "set-home-bathroom": 6,
  "set-office-ceo": 14, "set-office-meeting": 15, "set-office-lobby": 9,
  "set-office-pantry": 10, "set-office-elevator": 4, "set-dormitory": 18,
  "set-hotel-room": 16, "set-police": 17, "set-courtroom": 13, "set-bar": 15,
  "set-gym": 13, "set-supermarket": 12, "set-ktv": 8, "set-wedding": 19,
  "set-hospital": 23,
};

let failures = 0;
const byId = new Map(PROJECT_TEMPLATES.map((t) => [t.id, t]));
for (const id of GROUP_B_IDS) {
  const n = PROJECT_TEMPLATES.filter((t) => t.id === id).length;
  if (n !== 1) {
    console.log(`FAIL set id ${id}: found ${n} times (want 1)`);
    failures++;
  }
}
let total = 0;
const unknown = new Map();
for (const id of GROUP_B_IDS) {
  const tpl = byId.get(id);
  if (!tpl) continue;
  let count = 0;
  for (const floor of tpl.furnitureOverrides ?? []) {
    for (const items of Object.values(floor)) {
      for (const it of items) {
        count++;
        if (!getFurnitureById(it.furnitureId)) {
          unknown.set(it.furnitureId, (unknown.get(it.furnitureId) ?? 0) + 1);
        }
      }
    }
  }
  total += count;
  console.log(`${id}: ${BEFORE[id]} -> ${count} (+${count - BEFORE[id]})`);
}
for (const [fid, n] of [...unknown.entries()].sort()) {
  console.log(`FAIL unknown furnitureId ${fid} (x${n})`);
  failures++;
}
console.log(`TOTAL: ${total} items in ${GROUP_B_IDS.length} Group B sets`);
if (failures > 0) {
  console.log(`CHECK FAILED: ${failures} failure(s)`);
  process.exit(1);
}
console.log("CHECK PASSED");
