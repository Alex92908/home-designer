/**
 * load-path check: call the real store.applyProjectTemplate (the same
 * function the console picker calls) for every new scene + 3 old scenes,
 * and assert the resulting floorPlans carry the template's rooms,
 * dimensions and placed furniture.
 * Usage: node scripts/check-load-path.mjs  (not part of the harness)
 */
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": new URL("../src", import.meta.url).pathname },
});
const { PROJECT_TEMPLATES } = jiti("../src/lib/projectTemplates.ts");
const { useDesignerStore } = jiti("../src/lib/store.ts");

const NEW_IDS = [
  "set-school-playground", "set-school-library", "set-school-cafeteria",
  "set-school-bathroom", "set-school-waterroom", "set-school-parking",
  "set-school-track", "set-home-bedroom", "set-home-kitchen",
  "set-home-bathroom", "set-office-ceo", "set-office-meeting",
  "set-office-lobby", "set-office-pantry", "set-office-elevator",
  "set-dormitory", "set-hotel-room", "set-police", "set-courtroom",
  "set-bar", "set-gym", "set-supermarket", "set-ktv", "set-wedding",
];
const OLD_IDS = ["set-school", "set-office", "set-cafe"];

let failures = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log(`  PASS ${msg}`);
  else { failures++; console.log(`  FAIL ${msg}`); }
}

for (const id of [...NEW_IDS, ...OLD_IDS]) {
  const tpl = PROJECT_TEMPLATES.find((t) => t.id === id);
  useDesignerStore.getState().applyProjectTemplate(id);
  const s = useDesignerStore.getState();
  const fp = s.floorPlans[0];
  ok(!!fp, `${id}: floorPlans[0] exists after apply`);
  if (!fp) continue;
  const layout = tpl.floorLayouts[0];
  for (const r of layout.rooms) {
    const got = fp.roomLayout[r.room];
    ok(!!got && got.x === r.x && got.y === r.y,
      `${id}/${r.room}: layout (${got?.x},${got?.y}) = (${r.x},${r.y})`);
    const dim = fp.roomDimensions[r.room];
    ok(!!dim && dim.width === r.width && dim.depth === r.depth,
      `${id}/${r.room}: dims ${dim?.width}x${dim?.depth} = ${r.width}x${r.depth}`);
  }
  const overrides = tpl.furnitureOverrides?.[0] ?? {};
  for (const [roomId, items] of Object.entries(overrides)) {
    const placed = fp.rooms[roomId]?.placedItems ?? [];
    const wantIds = items.map((i) => i.furnitureId);
    const gotIds = placed.map((p) => p.furnitureId);
    ok(JSON.stringify(gotIds) === JSON.stringify(wantIds),
      `${id}/${roomId}: placed ${gotIds.length} items = override ${wantIds.length} items`);
    // elevationY / mountCeiling passthrough on at least the items that declare them
    for (let i = 0; i < items.length; i++) {
      if (items[i].elevationY != null) {
        ok(placed[i]?.elevationY === items[i].elevationY,
          `${id}/${roomId}: ${items[i].furnitureId} elevationY=${placed[i]?.elevationY}`);
      }
      if (items[i].mountCeiling) {
        ok(placed[i]?.mountCeiling === true,
          `${id}/${roomId}: ${items[i].furnitureId} mountCeiling passthrough`);
      }
    }
  }
  // switching scenes must not leak the previous scene's rooms
  // (hideFromSwitcher rooms, e.g. office corridors, are excluded)
  const roomTypes = layout.rooms.filter((r) => !r.hideFromSwitcher).map((r) => r.room);
  ok(fp.enabledRooms.length === roomTypes.length &&
     roomTypes.every((r) => fp.enabledRooms.includes(r)),
    `${id}: enabledRooms = template rooms (${fp.enabledRooms.length})`);
}

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
