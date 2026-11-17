// dump-rooms-b.mjs — print current furniture + dims for selected (set, room) pairs.
// Usage: node scripts/dump-rooms-b.mjs
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, {
  alias: { '@': new URL('../src', import.meta.url).pathname },
});
const { PROJECT_TEMPLATES } = jiti('../src/lib/projectTemplates.ts');
const WANT = [
  ['set-school', 'hallway'], ['set-school', 'study2'],
  ['set-school-library', 'hallway'], ['set-school-library', 'study2'],
  ['set-school-cafeteria', 'kitchen'],
  ['set-school-bathroom', 'bathroom'],
  ['set-school-waterroom', 'equipment_room'], ['set-school-waterroom', 'hallway'],
  ['set-home-bathroom', 'bathroom'],
  ['set-home-bedroom', 'closet'],
  ['set-office-meeting', 'study2'],
  ['set-office-pantry', 'kitchen'],
  ['set-office-elevator', 'hallway'],
  ['set-dormitory', 'bathroom2'], ['set-dormitory', 'balcony'],
  ['set-hotel-room', 'hallway'], ['set-hotel-room', 'master'],
  ['set-courtroom', 'hallway'],
  ['set-ktv', 'hallway'],
  ['set-hospital', 'bathroom'], ['set-hospital', 'hallway'],
  ['set-gym', 'bathroom2'],
  ['set-supermarket', 'hallway'],
  ['set-wedding', 'living'],
  ['set-police', 'study'],
];
for (const [id, room] of WANT) {
  const tpl = PROJECT_TEMPLATES.find((t) => t.id === id);
  const fl = (tpl.floorLayouts || [])[0];
  const r = (fl.rooms || []).find((x) => x.room === room);
  const items = (tpl.furnitureOverrides?.[0] || {})[room] || [];
  const wins = (r.windows || []).map((w) => `${w.wall}@${w.pos}+${w.len}`).join(' ');
  const doors = (r.doors || []).map((d) => `${d.wall}@${d.pos}`).join(' ');
  console.log(`\n## ${id} / ${room} (${r.name || room}) ${r.width}x${r.depth} wallsHidden=${(r.wallsHidden || []).join(',') || '-'} win[${wins}] doors[${doors}]`);
  for (const it of items) {
    console.log(`   ${it.furnitureId} x=${it.x} z=${it.z} rot=${it.rotation ?? 0}${it.elevationY != null ? ' elev=' + it.elevationY : ''}${it.mountCeiling ? ' CEIL' : ''}${it.scaleW ? ' sw=' + it.scaleW : ''}${it.scaleD ? ' sd=' + it.scaleD : ''}${it.label ? ' label=' + it.label : ''}`);
  }
}
