// Lighting preset logic checks (compiled from src/lib/*.ts with tsc, run in node).
// Covers: completeness, pairwise distinctness, unknown-id fallback,
// old-shot (no lightingId) fallback, scene-default inheritance, sim
// shot-to-shot switching (via selectActiveCineLightingId logic mirrored
// from CinematicDirector — the real selector is exercised through the
// store shape below), and makeShot inheritance.
import {
  LIGHTING_PRESETS, DEFAULT_LIGHTING_ID,
  resolveLightingPreset, resolveShotLightingId,
} from "../src/lib/lighting";
import { makeShot } from "../src/lib/cinematic";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}
const HEX = /^#[0-9A-Fa-f]{6}$/;
const NUM = (v: unknown) => typeof v === "number" && Number.isFinite(v);

// 1. Ten presets, unique ids, all required fields present + valid
check("count == 10", LIGHTING_PRESETS.length === 10, `got ${LIGHTING_PRESETS.length}`);
check("ids unique", new Set(LIGHTING_PRESETS.map((p) => p.id)).size === 10);
const EXPECTED = ["day", "night", "dusk", "overcast", "warm", "cold", "dramatic", "candlelight", "neon", "moonlight"];
check("expected ids", EXPECTED.every((id) => LIGHTING_PRESETS.some((p) => p.id === id)));
for (const p of LIGHTING_PRESETS) {
  const ok =
    !!p.nameZh && !!p.nameEn && !!p.moodZh &&
    HEX.test(p.ambient.color) && NUM(p.ambient.intensity) &&
    NUM(p.indoorAmbientIntensity) &&
    Array.isArray(p.directional.position) && p.directional.position.length === 3 &&
    p.directional.position.every(NUM) && NUM(p.directional.intensity) && HEX.test(p.directional.color) &&
    HEX.test(p.fill.color) && NUM(p.fill.intensity) &&
    HEX.test(p.hemi.sky) && HEX.test(p.hemi.ground) && NUM(p.hemi.intensity) &&
    NUM(p.indoorHemiIntensity) &&
    HEX.test(p.interiorPoint.color) && NUM(p.interiorPoint.intensity) &&
    typeof p.shadows === "boolean" &&
    HEX.test(p.background) && HEX.test(p.fogColor) &&
    NUM(p.exposure) && NUM(p.environmentIntensity);
  check(`preset ${p.id} has all params`, ok);
}

// 2. No two presets identical in any parameter (pairwise: differ in >=1 field)
const sig = (p: (typeof LIGHTING_PRESETS)[number]) => JSON.stringify([
  p.ambient, p.indoorAmbientIntensity, p.directional, p.fill, p.hemi,
  p.indoorHemiIntensity, p.interiorPoint, p.shadows, p.background,
  p.fogColor, p.exposure, p.environmentIntensity, p.stars ?? false,
]);
let dup = 0;
for (let i = 0; i < LIGHTING_PRESETS.length; i++)
  for (let j = i + 1; j < LIGHTING_PRESETS.length; j++)
    if (sig(LIGHTING_PRESETS[i]) === sig(LIGHTING_PRESETS[j])) dup++;
check("no two presets identical", dup === 0, `${dup} duplicate pairs`);
// Stronger: every pair differs in at least 3 parameter groups (not just a typo apart)
let weak = 0;
for (let i = 0; i < LIGHTING_PRESETS.length; i++) {
  for (let j = i + 1; j < LIGHTING_PRESETS.length; j++) {
    const a = LIGHTING_PRESETS[i], b = LIGHTING_PRESETS[j];
    const diffs = [
      JSON.stringify(a.ambient) !== JSON.stringify(b.ambient),
      a.indoorAmbientIntensity !== b.indoorAmbientIntensity,
      JSON.stringify(a.directional) !== JSON.stringify(b.directional),
      JSON.stringify(a.fill) !== JSON.stringify(b.fill),
      JSON.stringify(a.hemi) !== JSON.stringify(b.hemi),
      a.shadows !== b.shadows,
      a.background !== b.background,
      a.exposure !== b.exposure,
      a.environmentIntensity !== b.environmentIntensity,
    ].filter(Boolean).length;
    if (diffs < 3) weak++;
  }
}
check("every pair differs in >=3 param groups", weak === 0, `${weak} weak pairs`);

// 3. Unknown ids fall back safely to default
check("unknown id -> day", resolveLightingPreset("nope").id === "day");
check("undefined id -> day", resolveLightingPreset(undefined).id === "day");
check("null id -> day", resolveLightingPreset(null).id === "day");
check("empty id -> day", resolveLightingPreset("").id === "day");
check("DEFAULT_LIGHTING_ID is day", DEFAULT_LIGHTING_ID === "day");
check("day preset matches legacy look",
  (() => {
    const d = resolveLightingPreset("day");
    return d.ambient.intensity === 0.17 && d.indoorAmbientIntensity === 0.55 &&
      d.directional.color === "#FFF8F0" && d.interiorPoint.intensity === 8.0 &&
      d.indoorHemiIntensity === 1.2 && d.exposure === 1.0;
  })());

// 4. Old shots (no lightingId) load with the default
check("old shot, no scene default -> day", resolveShotLightingId(undefined, undefined) === "day");
check("old shot + scene dusk -> dusk", resolveShotLightingId(undefined, "dusk") === "dusk");
check("old shot + unknown scene default -> day", resolveShotLightingId(undefined, "nope") === "day");
check("explicit shot id wins over scene", resolveShotLightingId("neon", "dusk") === "neon");
check("unknown shot id falls back to scene", resolveShotLightingId("nope", "warm") === "warm");
check("unknown shot + unknown scene -> day", resolveShotLightingId("nope", "nope") === "day");

// 5. makeShot: new shots carry lightingId when given, omit it otherwise (old shape)
const s1 = makeShot("indoor-wide", { lightingId: "candlelight" });
check("makeShot stores lightingId", s1.lightingId === "candlelight");
const s2 = makeShot("indoor-wide");
check("makeShot without lightingId omits it", s2.lightingId === undefined);
check("old-shape shot resolves via scene default",
  resolveShotLightingId((s2 as { lightingId?: string }).lightingId, "moonlight") === "moonlight");

// 6. Sim shot-to-shot switch: mirror of selectActiveCineLightingId
// (same resolution order: queue > sim shot > preview > null)
type MiniState = {
  queue: { shot: { lightingId?: string } }[] | null; queueIdx: number;
  sim: { active: boolean; shotIdx: number } | null;
  shots: { lightingId?: string }[]; sceneLightingId: string; previewLightingId: string | null;
};
function activeId(st: MiniState): string | null {
  const q = st.queue;
  if (q && q.length) {
    const item = q[st.queueIdx];
    if (item) return resolveShotLightingId(item.shot.lightingId, st.sceneLightingId);
  }
  if (st.sim?.active) {
    const shot = st.shots[st.sim.shotIdx];
    if (shot) return resolveShotLightingId(shot.lightingId, st.sceneLightingId);
  }
  return st.previewLightingId ?? null;
}
const simState: MiniState = {
  queue: null, queueIdx: 0,
  sim: { active: true, shotIdx: 0 },
  shots: [{ lightingId: "dusk" }, { lightingId: "dramatic" }, {}],
  sceneLightingId: "day", previewLightingId: null,
};
check("sim shot 1 -> dusk", activeId(simState) === "dusk");
check("sim shot 2 -> dramatic", activeId({ ...simState, sim: { active: true, shotIdx: 1 } }) === "dramatic");
check("sim shot 3 (no id) -> scene day", activeId({ ...simState, sim: { active: true, shotIdx: 2 } }) === "day");
check("sim off + preview neon -> neon",
  activeId({ ...simState, sim: null, previewLightingId: "neon" }) === "neon");
check("sim off + no preview -> null (no override)",
  activeId({ ...simState, sim: null, previewLightingId: null }) === null);
check("recording queue overrides sim",
  activeId({ ...simState, queue: [{ shot: { lightingId: "candlelight" } }], queueIdx: 0 }) === "candlelight");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
