// audit-brief-b.mjs — audit Group B sets against the 6 universal rules.
// Run from the worktree: node scripts/audit-brief-b.mjs (uses jiti like the check script).
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, {
  alias: { '@': new URL('../src', import.meta.url).pathname },
});
const { PROJECT_TEMPLATES } = jiti('../src/lib/projectTemplates.ts');

const B = ['set-school','set-school-playground','set-school-library','set-school-cafeteria','set-school-bathroom','set-school-waterroom','set-school-parking','set-school-track','set-home-bedroom','set-home-kitchen','set-home-bathroom','set-office-ceo','set-office-meeting','set-office-lobby','set-office-pantry','set-office-elevator','set-dormitory','set-hotel-room','set-police','set-courtroom','set-bar','set-gym','set-supermarket','set-ktv','set-wedding','set-hospital'];
// Main room per set (default activeRoom from applyProjectTemplate logic).
const MAIN = {
  'set-school': 'study', 'set-school-playground': 'yard', 'set-school-library': 'study',
  'set-school-cafeteria': 'dining', 'set-school-bathroom': 'bathroom', 'set-school-waterroom': 'equipment_room',
  'set-school-parking': 'yard', 'set-school-track': 'yard', 'set-home-bedroom': 'master',
  'set-home-kitchen': 'kitchen', 'set-home-bathroom': 'bathroom', 'set-office-ceo': 'study',
  'set-office-meeting': 'study', 'set-office-lobby': 'living', 'set-office-pantry': 'kitchen',
  'set-office-elevator': 'hallway', 'set-dormitory': 'bedroom', 'set-hotel-room': 'master',
  'set-police': 'study', 'set-courtroom': 'living', 'set-bar': 'living', 'set-gym': 'gym',
  'set-supermarket': 'living', 'set-ktv': 'living', 'set-wedding': 'living', 'set-hospital': 'master',
};
const SMALL_RE = /^(decor-|toy-|proc-(thermos|basin|teapot|towel|tissue|toothbrush)|appliance-(kettle|coffee-machine|microwave|rice-cooker|toaster|hairdryer))/;
const WALL_RE = /^(artwork-|mural-|curtain-|sign-|decor-victorian-clock|lamp-wall-sconce|decor-wall|proc-blackboard|proc-whiteboard)/;
const CEIL_RE = /^(lamp-ceiling-|lamp-chandelier-|lamp-pendant-)/;
const CLUTTER_RE = /^(decor-books-pile|decor-books-pack|decor-tea-set|decor-dinnerware|decor-tableware|decor-bed-clothes|decor-cutlery|decor-tissue-box|decor-fruit-bowl|toy-plush|appliance-kettle|decor-copper-pots|decor-pots-pans|decor-spice-rack)/;

for (const id of B) {
  const tpl = PROJECT_TEMPLATES.find((t) => t.id === id);
  if (!tpl) { console.log(id, 'MISSING'); continue; }
  const dims = {};
  for (const fl of tpl.floorLayouts || []) for (const r of fl.rooms || []) dims[r.room] = { w: r.width, d: r.depth, name: r.name || r.room };
  const ov = tpl.furnitureOverrides?.[0] || {};
  console.log(`\n== ${id} (${tpl.name}) ==`);
  for (const [room, items] of Object.entries(ov)) {
    const d = dims[room] || {};
    const area = d.w && d.d ? ((d.w * d.d) / 10000).toFixed(1) + 'm2' : '?';
    const small = items.filter((it) => SMALL_RE.test(it.furnitureId)).length;
    const wall = items.filter((it) => WALL_RE.test(it.furnitureId));
    const ceil = items.filter((it) => CEIL_RE.test(it.furnitureId));
    const clutter = items.filter((it) => CLUTTER_RE.test(it.furnitureId)).length;
    const isMain = MAIN[id] === room;
    const target = isMain ? 18 : 10;
    const flag = items.length < target ? `  <-- BELOW ${isMain ? 'MAIN' : 'secondary'} target ${target}` : '';
    const smallFlag = isMain && small < 6 ? `  <-- small<6` : '';
    const wallFlag = wall.length === 0 ? '  <-- NO WALL ITEM' : '';
    const ceilFlag = ceil.length === 0 ? '  <-- NO CEILING LIGHT' : '';
    console.log(`  ${isMain ? '*' : ' '} ${room} (${d.name || '?'}, ${area}): n=${items.length} small=${small} clutter=${clutter} wall=[${[...new Set(wall.map((w) => w.furnitureId))].join(',')}] ceil=${ceil.length}${flag}${smallFlag}${wallFlag}${ceilFlag}`);
  }
}
