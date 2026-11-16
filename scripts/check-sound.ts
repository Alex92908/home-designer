// Sound / music logic checks (run in node with tsx — no DOM, no AudioContext).
// Covers: music library completeness (mood + scene types + instrument/feel +
// source + license on every entry), mood -> music suggestion mapping
// (explicit mood, fight, period actions, all 10 lighting ids, unknown-id
// fallback), SFX registry (all 9 effects, incl. the 5 required), action ->
// effect mapping (all 30 actions), beat -> effect mapping (all 6 moves),
// sim trigger windows (segment start, beat start, shot-start default,
// footsteps cadence, seek/scrub silence, unknown ids fall back silent),
// and makeShot musicMood backward compatibility.
//
// NOTE: in node there is no AudioContext, so playSoundEffect must return
// false (silently) for every id — that IS the WebAudio-unavailable check.
// Whether the synth actually sounds right can only be judged by ear in a
// browser; this harness checks code paths, not audio output.
import {
  MUSIC_LIBRARY, MUSIC_MOODS, LIGHTING_TO_MOOD,
  musicTrackForMood, suggestMusicForShot, resolveShotMusicMood,
} from "../src/lib/soundLibrary";
import {
  SOUND_EFFECTS, isSoundEffectId, isAudioAvailable,
  effectForAction, effectForBeat, playSoundEffect,
  createSimSoundCursor, collectDueSounds,
} from "../src/lib/soundEffects";
import { ACTION_REGISTRY, makeSegment } from "../src/lib/actions";
import { BEAT_MOVES, makeBeat, makePhrase, makeFight } from "../src/lib/fightChoreo";
import { makeShot, makeActor } from "../src/lib/cinematic";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${detail}`); }
}
const NONEMPTY = (v: unknown) => typeof v === "string" && v.trim().length > 0;

// ── 1. Music library: 10 entries, unique ids, all moods, all fields ──
const EXPECTED_MOODS = ["romance", "fight", "suspense", "period", "comedy", "sad", "chase", "warm", "nightCity", "epic"];
check("library count == 10", MUSIC_LIBRARY.length === 10, `got ${MUSIC_LIBRARY.length}`);
check("library ids unique", new Set(MUSIC_LIBRARY.map((t) => t.id)).size === 10);
check("MUSIC_MOODS == 10 expected", EXPECTED_MOODS.every((m) => MUSIC_MOODS.some((x) => x.id === m)) && MUSIC_MOODS.length === 10);
check("every mood has exactly one track", EXPECTED_MOODS.every((m) => MUSIC_LIBRARY.filter((t) => t.mood === m).length === 1));
for (const t of MUSIC_LIBRARY) {
  const ok =
    NONEMPTY(t.id) && NONEMPTY(t.nameZh) && NONEMPTY(t.nameEn) &&
    t.sceneTypesZh.length > 0 && t.sceneTypesEn.length > 0 &&
    NONEMPTY(t.instrumentZh) && NONEMPTY(t.instrumentEn) &&
    NONEMPTY(t.feelZh) && NONEMPTY(t.feelEn) &&
    NONEMPTY(t.source.name) && NONEMPTY(t.source.nameZh) &&
    NONEMPTY(t.source.url) && t.source.url.startsWith("https://") &&
    NONEMPTY(t.source.license) && NONEMPTY(t.source.licenseZh) &&
    NONEMPTY(t.source.attributionZh) &&
    NONEMPTY(t.searchHintZh) && NONEMPTY(t.searchHintEn);
  check(`entry ${t.id} complete (mood+scenes+instrument+feel+source+license)`, ok);
  if (t.exampleTrack) {
    check(`entry ${t.id} example track named + verified note`, NONEMPTY(t.exampleTrack.title) && NONEMPTY(t.exampleTrack.artist) && NONEMPTY(t.exampleTrack.verifiedNoteZh));
  }
}
// Named example tracks are only the ones verified to exist in the source
// (see docs/sound-library.md): Hitman, Darkest Child, Monkeys Spinning
// Monkeys, Gymnopedie No. 3, A Mission, Despair and Triumph, Chopin Nocturne.
const NAMED = MUSIC_LIBRARY.filter((t) => t.exampleTrack).map((t) => t.exampleTrack!.title);
check("7 verified named tracks, 3 search-hint-only entries",
  NAMED.length === 7 && MUSIC_LIBRARY.filter((t) => !t.exampleTrack).length === 3,
  `named=${NAMED.length}`);
check("no invented track titles beyond verified list",
  NAMED.every((n) => ["Nocturne in E-flat major, Op. 9 No. 2", "Hitman", "Darkest Child", "Monkeys Spinning Monkeys", "Gymnopédie No. 3", "A Mission", "Despair and Triumph"].includes(n)),
  NAMED.join(" | "));

// ── 2. Suggestion mapping ──
for (const mood of EXPECTED_MOODS) {
  check(`explicit mood ${mood} -> itself`, suggestMusicForShot({ musicMood: mood }).mood === mood);
}
check("unknown mood -> warm fallback, no crash", suggestMusicForShot({ musicMood: "nope" }).mood === "warm");
check("no input -> warm default", suggestMusicForShot({}).mood === "warm");
check("fight (hasFight) beats lighting", suggestMusicForShot({ hasFight: true, lightingId: "dusk" }).mood === "fight");
check("fight action beats lighting", suggestMusicForShot({ actions: ["punch"], lightingId: "dusk" }).mood === "fight");
check("flySword -> period", suggestMusicForShot({ actions: ["flySword"], lightingId: "day" }).mood === "period");
check("leap -> period", suggestMusicForShot({ actions: ["leap"] }).mood === "period");
check("explicit mood beats fight", suggestMusicForShot({ musicMood: "romance", hasFight: true }).mood === "romance");
// Lighting -> mood (all 10 Part-2 presets)
const LIGHTING_EXPECTED: Record<string, string> = {
  day: "warm", night: "suspense", dusk: "romance", overcast: "sad", warm: "warm",
  cold: "suspense", dramatic: "suspense", candlelight: "period", neon: "nightCity", moonlight: "sad",
};
for (const [lighting, mood] of Object.entries(LIGHTING_EXPECTED)) {
  check(`lighting ${lighting} -> ${mood}`, resolveShotMusicMood({ lightingId: lighting }) === mood);
  check(`LIGHTING_TO_MOOD covers ${lighting}`, LIGHTING_TO_MOOD[lighting] === mood);
}
check("unknown lighting -> warm fallback", resolveShotMusicMood({ lightingId: "nope" }) === "warm");
check("musicTrackForMood unknown -> warm", musicTrackForMood("nope").mood === "warm");
// Task examples: fight + dramatic -> fight; romance + golden hour (dusk) -> romance
check("example: fight + dramatic -> fight", suggestMusicForShot({ hasFight: true, lightingId: "dramatic" }).mood === "fight");
check("example: romance + golden hour -> romance", suggestMusicForShot({ lightingId: "dusk" }).mood === "romance");

// ── 3. SFX registry ──
const REQUIRED = ["punch", "kick", "footstep", "swordWhoosh", "doorClose"];
for (const id of REQUIRED) {
  check(`SFX has required effect ${id}`, SOUND_EFFECTS.some((s) => s.id === id) && isSoundEffectId(id));
}
check("SFX count == 9", SOUND_EFFECTS.length === 9, `got ${SOUND_EFFECTS.length}`);
check("SFX ids unique", new Set(SOUND_EFFECTS.map((s) => s.id)).size === SOUND_EFFECTS.length);
for (const s of SOUND_EFFECTS) {
  check(`SFX ${s.id} has names + method`, NONEMPTY(s.nameZh) && NONEMPTY(s.nameEn) && NONEMPTY(s.methodZh) && NONEMPTY(s.methodEn));
}

// ── 4. WebAudio unavailable (node) + unknown ids + disabled ──
check("no AudioContext in node (expected)", isAudioAvailable() === false);
for (const s of SOUND_EFFECTS) {
  let threw = false, ret: boolean | undefined;
  try { ret = playSoundEffect(s.id); } catch { threw = true; }
  check(`playSoundEffect(${s.id}) silent false in node, no throw`, !threw && ret === false);
}
check("playSoundEffect unknown id -> false, no throw", (() => { try { return playSoundEffect("explosion") === false; } catch { return false; } })());
check("playSoundEffect enabled:false -> false", playSoundEffect("punch", { enabled: false }) === false);
check("isSoundEffectId unknown -> false", isSoundEffectId("explosion") === false);

// ── 5. Action -> effect (all 30 actions, no throw) ──
const ACTION_IDS = Object.keys(ACTION_REGISTRY);
check("action registry == 30", ACTION_IDS.length === 30, `got ${ACTION_IDS.length}`);
for (const a of ACTION_IDS) {
  let threw = false, r: string | null = null;
  try { r = effectForAction(a); } catch { threw = true; }
  check(`effectForAction(${a}) no throw`, !threw && (r === null || isSoundEffectId(r)));
}
check("punch -> punch", effectForAction("punch") === "punch");
check("kick -> kick", effectForAction("kick") === "kick");
check("fight -> punch", effectForAction("fight") === "punch");
check("walk -> footstep", effectForAction("walk") === "footstep");
check("run -> footstep", effectForAction("run") === "footstep");
check("flySword -> swordWhoosh", effectForAction("flySword") === "swordWhoosh");
check("block -> block", effectForAction("block") === "block");
check("fall -> fall", effectForAction("fall") === "fall");
check("dodge -> dodge", effectForAction("dodge") === "dodge");
check("jump/leap -> jump", effectForAction("jump") === "jump" && effectForAction("leap") === "jump");
check("idle/sit/wave -> null (silent)", effectForAction("idle") === null && effectForAction("sit") === null && effectForAction("wave") === null);
check("unknown action -> null", effectForAction("explode") === null && effectForAction(undefined) === null);

// ── 6. Beat -> effect (all 6 moves) ──
check("beat moves == 6", BEAT_MOVES.length === 6);
for (const m of BEAT_MOVES) {
  const r = effectForBeat(m.id);
  check(`effectForBeat(${m.id})`, m.id === "getUp" ? r === null : r !== null && isSoundEffectId(r));
}
check("beat punch -> punch, kick -> kick", effectForBeat("punch") === "punch" && effectForBeat("kick") === "kick");
check("beat unknown -> null", effectForBeat("spin" as never) === null);

// ── 7. Sim trigger windows ──
const A = makeActor([0, 0], [3, 0], { name: "甲" });
const B = makeActor([3, 0], [0, 0], { name: "乙" });

// 7a. Shot-start default: actor with one-shot default action, no timeline
{
  const actor = { ...A, action: "punch" as const };
  const cur = createSimSoundCursor();
  const due = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: 0, curT: 0.016, cursor: cur });
  check("shot-start default punch fires once", due.includes("punch") && due.filter((d) => d === "punch").length === 1, JSON.stringify(due));
  const due2 = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: 0.016, curT: 0.032, cursor: cur });
  check("shot-start default does not repeat", !due2.includes("punch"), JSON.stringify(due2));
}
// 7b. Timeline segment start: kick at t=1.0
{
  const actor = { ...A, action: "walk" as const, timeline: [makeSegment("kick", 1.0)] };
  const cur = createSimSoundCursor();
  const before = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: 0, curT: 0.5, cursor: cur });
  check("kick segment not fired before start", !before.includes("kick"), JSON.stringify(before));
  const at = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: 0.95, curT: 1.05, cursor: cur });
  check("kick segment fires at start", at.includes("kick"), JSON.stringify(at));
  const after = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: 1.05, curT: 1.2, cursor: cur });
  check("kick segment fires only once", !after.includes("kick"), JSON.stringify(after));
}
// 7c. Sword segment: flySword at t=0.5
{
  const actor = { ...A, timeline: [makeSegment("flySword", 0.5)] };
  const cur = createSimSoundCursor();
  const due = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: 0.4, curT: 0.55, cursor: cur });
  check("flySword segment -> swordWhoosh", due.includes("swordWhoosh"), JSON.stringify(due));
}
// 7d. Fight beats: punch 0.8s then kick 0.9s, shot s1
{
  const fight = makeFight(A.id, B.id, { shotId: "s1" });
  fight.phrases = [makePhrase([makeBeat("punch", A.id, B.id), makeBeat("kick", A.id, B.id)])];
  const cur = createSimSoundCursor();
  const first = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [A, B], fights: [fight], prevT: 0, curT: 0.1, cursor: cur });
  check("fight beat 1 (punch) fires at beat start", first.includes("punch"), JSON.stringify(first));
  const second = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [A, B], fights: [fight], prevT: 0.75, curT: 0.85, cursor: cur });
  check("fight beat 2 (kick) fires at beat start", second.includes("kick"), JSON.stringify(second));
  const again = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [A, B], fights: [fight], prevT: 0.85, curT: 0.95, cursor: cur });
  check("fight beat does not repeat within beat", !again.includes("kick"), JSON.stringify(again));
  // Other shot's fight must not fire here
  const other = makeFight(A.id, B.id, { shotId: "s2" });
  other.phrases = [makePhrase([makeBeat("punch", A.id, B.id)])];
  const cur2 = createSimSoundCursor();
  const dueOther = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [A, B], fights: [other], prevT: 0, curT: 0.1, cursor: cur2 });
  check("fight for another shot does not fire", !dueOther.includes("punch"), JSON.stringify(dueOther));
}
// 7e. Footsteps: walking actor, 0.1s frames over 2s -> >= 2 steps, none in first frame
{
  const actor = { ...A, action: "walk" as const };
  const cur = createSimSoundCursor();
  let steps = 0, firstFrameSteps = 0;
  let t = 0;
  for (let i = 0; i < 20; i++) {
    const due = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: t, curT: t + 0.1, cursor: cur });
    const n = due.filter((d) => d === "footstep").length;
    if (i === 0) firstFrameSteps = n;
    steps += n;
    t += 0.1;
  }
  check("walk footsteps fire at cadence (>=2 in 2s)", steps >= 2, `steps=${steps}`);
  check("no footstep burst on first frame", firstFrameSteps === 0, `first=${firstFrameSteps}`);
}
// 7f. Seek / scrub: big jump and backwards jump stay silent
{
  const actor = { ...A, action: "walk" as const, timeline: [makeSegment("punch", 1.0)] };
  const cur = createSimSoundCursor();
  const seek = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: 0, curT: 2.0, cursor: cur });
  check("seek jump (>0.5s window) stays silent", seek.length === 0, JSON.stringify(seek));
  collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: 2.0, curT: 2.1, cursor: cur });
  const back = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: 2.1, curT: 0.5, cursor: cur });
  check("scrub backwards stays silent", back.length === 0, JSON.stringify(back));
  // 回拨后重新播到该段 -> 再响一次
  collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: 0.5, curT: 0.6, cursor: cur });
  const refire = collectDueSounds({ shotId: "s1", shotDuration: 8, actors: [actor], fights: [], prevT: 0.95, curT: 1.05, cursor: cur });
  check("scrub back then replay -> segment fires again", refire.includes("punch"), JSON.stringify(refire));
  // After a shot change, cursor resets silently
  const change = collectDueSounds({ shotId: "s2", shotDuration: 8, actors: [actor], fights: [], prevT: 0.5, curT: 0.6, cursor: cur });
  check("shot change resets silently", change.length === 0, JSON.stringify(change));
}

// ── 8. makeShot musicMood backward compatibility ──
{
  const withMood = makeShot("indoor-wide", { musicMood: "fight" });
  check("makeShot stores musicMood", withMood.musicMood === "fight");
  const plain = makeShot("indoor-wide");
  check("makeShot without musicMood -> undefined (old saves fine)", plain.musicMood === undefined);
  const oldShot = { ...plain };
  delete (oldShot as Record<string, unknown>).musicMood;
  check("old shot (no musicMood) still suggests music", suggestMusicForShot({ musicMood: oldShot.musicMood, lightingId: "dusk" }).mood === "romance");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
