/**
 * sunAnalysis.ts — Astronomical sun position + shadow polygon generator
 *
 * Replaces the simplified 31°N-hardcoded trigonometry in HouseCanvas with
 * SunCalc — a proven open-source library used by weather apps, GIS tools,
 * and smart-home systems.  Accepts real lat/lng so the sun slider becomes
 * geographically accurate when the user sets their project location.
 *
 * Two exports:
 *   getSunPosition3D  → Three.js [x,y,z] for DirectionalLight placement
 *   getShadowPolygon  → 2D trapezoid polygon (cm) for the YardPlan overlay
 */

import SunCalc from "suncalc";

// ─── Shared types ──────────────────────────────────────────────────────────
export interface LatLng { lat: number; lng: number }

/** Sky theme for the sky-sphere / ambient light colour — same shape as
 *  the legacy SkyTheme so HouseCanvas swap is a drop-in. */
export interface SkyTheme {
  skyRgb:    [number, number, number];
  horizRgb:  [number, number, number];
  sunRgb:    [number, number, number];
  ambient:   number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build a JS Date that has today's calendar date but the given decimal hour. */
function dateAtHour(hour: number): Date {
  const d = new Date();
  d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return d;
}

/** Clamp a value between lo and hi. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Linear interpolation between two values. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Lerp between two RGB triples. */
function lerpRgb(
  a: [number,number,number],
  b: [number,number,number],
  t: number,
): [number,number,number] {
  return [lerp(a[0],b[0],t), lerp(a[1],b[1],t), lerp(a[2],b[2],t)];
}

// ─── Sky palettes (same as original HouseCanvas) ──────────────────────────
const SKY: Record<string, [number,number,number]> = {
  night:   [10,  12,  28],
  dawn:    [255, 160, 80],
  day:     [100, 180, 255],
  dusk:    [255, 100, 60],
};
const HORIZ: Record<string, [number,number,number]> = {
  night:   [15,  18,  40],
  dawn:    [255, 200, 140],
  day:     [210, 235, 255],
  dusk:    [255, 160, 100],
};
const SUN_COLOR: Record<string, [number,number,number]> = {
  night:   [20,  30,  80],
  dawn:    [255, 200, 80],
  day:     [255, 255, 220],
  dusk:    [255, 160, 60],
};

// ─── Main exports ──────────────────────────────────────────────────────────

/**
 * Returns the Three.js world [x, y, z] position for the DirectionalLight
 * representing the sun at the given decimal hour and geographic coordinates.
 *
 * Coordinate convention (matches HouseCanvas scene):
 *   +X = west,  -X = east
 *   +Y = up
 *   +Z = south, -Z = north
 *
 * SunCalc outputs:
 *   altitude  radians above horizon (negative = below horizon)
 *   azimuth   radians, 0 = south, positive = clockwise toward west
 */
export function getSunPosition3D(
  hour: number,
  { lat, lng }: LatLng,
): [number, number, number] {
  const pos = SunCalc.getPosition(dateAtHour(hour), lat, lng);
  const el  = pos.altitude;   // radians, negative = below horizon
  const az  = pos.azimuth;    // radians from south, +west

  if (el <= 0) {
    // Sun below horizon — park it at a low invisible position
    return [0, -5, 0];
  }

  const R = 45; // scene orbit radius (metres)
  // azimuth 0=south (+Z), π/2=west (+X), π=north (-Z), -π/2=east (-X)
  const x =  Math.sin(az) * Math.cos(el) * R;  // west positive
  const y =  Math.sin(el) * R;
  const z =  Math.cos(az) * Math.cos(el) * R * 0.5 + 14; // scene centre offset
  return [x, y, z];
}

/**
 * Returns a SkyTheme for the given hour at the given location.
 * Phases: night → dawn (±30 min around sunrise) → day → dusk → night
 */
export function getSkyTheme(hour: number, loc: LatLng): SkyTheme {
  const times = SunCalc.getTimes(dateAtHour(hour), loc.lat, loc.lng);
  const sunrise = times.sunrise.getHours() + times.sunrise.getMinutes() / 60;
  const sunset  = times.sunset.getHours()  + times.sunset.getMinutes()  / 60;

  // Band half-widths in hours
  const dawnW = 0.6, duskW = 0.6;
  const dawnMid = sunrise, duskMid = sunset;

  let skyRgb:   [number,number,number];
  let horizRgb: [number,number,number];
  let sunRgb:   [number,number,number];
  let ambient:  number;

  if (hour < dawnMid - dawnW || hour > duskMid + duskW) {
    // Night
    skyRgb = SKY.night; horizRgb = HORIZ.night; sunRgb = SUN_COLOR.night; ambient = 0.05;
  } else if (hour <= dawnMid + dawnW) {
    // Dawn blend
    const t = (hour - (dawnMid - dawnW)) / (dawnW * 2);
    const tt = t < 0.5 ? t * 2 : (1 - t) * 2;
    skyRgb   = lerpRgb(SKY.night,   lerpRgb(SKY.dawn,   SKY.day,   tt), t);
    horizRgb = lerpRgb(HORIZ.night, lerpRgb(HORIZ.dawn, HORIZ.day, tt), t);
    sunRgb   = lerpRgb(SUN_COLOR.night, lerpRgb(SUN_COLOR.dawn, SUN_COLOR.day, tt), t);
    ambient  = lerp(0.05, 0.55, t);
  } else if (hour < duskMid - duskW) {
    // Full day
    skyRgb = SKY.day; horizRgb = HORIZ.day; sunRgb = SUN_COLOR.day; ambient = 0.55;
  } else {
    // Dusk blend
    const t = (hour - (duskMid - duskW)) / (duskW * 2);
    const tt = t < 0.5 ? t * 2 : (1 - t) * 2;
    skyRgb   = lerpRgb(SKY.day,   lerpRgb(SKY.dusk,   SKY.night,   tt), t);
    horizRgb = lerpRgb(HORIZ.day, lerpRgb(HORIZ.dusk, HORIZ.night, tt), t);
    sunRgb   = lerpRgb(SUN_COLOR.day, lerpRgb(SUN_COLOR.dusk, SUN_COLOR.night, tt), t);
    ambient  = lerp(0.55, 0.05, t);
  }

  return { skyRgb, horizRgb, sunRgb, ambient };
}

/**
 * Format hour as "06:30" string.
 */
export function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h % 1) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ─── Shadow polygon for YardPlan overlay ──────────────────────────────────

/**
 * Compute the 2D shadow cast by the house on the ground plane at the given
 * sun hour.  Returns a polygon in **world cm** (same coordinate system as
 * YardPlan: origin = house centre, +Z = front/south, +X = east).
 *
 * Uses a simplified model: the house is treated as its axis-aligned bounding
 * box (width × depth × height).  The shadow is the projection of the top
 * four corners of the bbox onto the ground plane.
 *
 * Returns null when the sun is below the horizon (no shadow).
 *
 * @param hour      Decimal hour (0–24)
 * @param loc       Geographic location
 * @param houseWcm  House width in cm (X axis)
 * @param houseDcm  House depth in cm (Z axis)
 * @param houseHm   House height in metres
 */
export function getShadowPolygon(
  hour:     number,
  loc:      LatLng,
  houseWcm: number,
  houseDcm: number,
  houseHm:  number,
): Array<[number, number]> | null {
  const pos = SunCalc.getPosition(dateAtHour(hour), loc.lat, loc.lng);
  if (pos.altitude <= 0.02) return null; // sun at/below horizon

  // Shadow length per metre of height
  const shadowLenPerM = 1 / Math.tan(pos.altitude); // metres
  const shadowLenCm   = shadowLenPerM * houseHm * 100;

  // Shadow direction: opposite to sun direction (sun azimuth + π)
  // SunCalc azimuth 0=south, +west. Shadow falls away from sun.
  const shadowAz = pos.azimuth + Math.PI;
  const sdx = Math.sin(shadowAz) * shadowLenCm;  // shadow offset in X (cm)
  const sdz = Math.cos(shadowAz) * shadowLenCm;  // shadow offset in Z (cm)

  const hw = houseWcm / 2;
  const hd = houseDcm / 2;

  // Four top corners of the house bbox (in world cm)
  const topCorners: Array<[number, number]> = [
    [-hw, -hd],
    [ hw, -hd],
    [ hw,  hd],
    [-hw,  hd],
  ];

  // Project each top corner to ground by adding the shadow offset
  const shadowCorners: Array<[number, number]> = topCorners.map(([x, z]) => [
    x + sdx,
    z + sdz,
  ]);

  // Convex hull of all 8 points (4 base + 4 shadow tips)
  const allPts: Array<[number, number]> = [...topCorners, ...shadowCorners];
  return convexHull(allPts);
}

// ─── Simple convex hull (Graham scan) ─────────────────────────────────────
function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  const n = pts.length;
  if (n < 3) return pts;

  // Find lowest-leftmost point
  let lo = 0;
  for (let i = 1; i < n; i++) {
    if (pts[i][1] < pts[lo][1] || (pts[i][1] === pts[lo][1] && pts[i][0] < pts[lo][0])) lo = i;
  }
  const pivot = pts[lo];

  // Sort by polar angle from pivot
  const rest = pts.filter((_, i) => i !== lo).sort((a, b) => {
    const angA = Math.atan2(a[1] - pivot[1], a[0] - pivot[0]);
    const angB = Math.atan2(b[1] - pivot[1], b[0] - pivot[0]);
    return angA - angB;
  });

  const hull: Array<[number, number]> = [pivot];
  for (const p of rest) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      // Cross product: if right turn, pop
      if ((b[0]-a[0])*(p[1]-a[1]) - (b[1]-a[1])*(p[0]-a[0]) <= 0) hull.pop();
      else break;
    }
    hull.push(p);
  }
  return hull;
}

/**
 * Human-readable lighting description for the AI prompt —
 * replaces the hardcoded lightingFromHour() in sceneToPrompt.ts.
 */
export function lightingDescFromSun(hour: number, loc: LatLng): string {
  const pos = SunCalc.getPosition(dateAtHour(hour), loc.lat, loc.lng);
  const times = SunCalc.getTimes(dateAtHour(hour), loc.lat, loc.lng);
  const sunrise = times.sunrise.getHours() + times.sunrise.getMinutes() / 60;
  const sunset  = times.sunset.getHours()  + times.sunset.getMinutes()  / 60;

  if (pos.altitude <= 0) return "moonlit night, dramatic artificial lighting, warm lamplight";
  if (hour < sunrise + 0.5) return "golden sunrise light, long horizontal shadows, warm amber glow";
  if (hour < sunrise + 2)   return "bright morning light, crisp shadows, golden hour";
  if (hour < 15)             return "bright midday sun, sharp shadows, vibrant colors";
  if (hour < sunset - 1)    return "warm afternoon sunlight, soft shadows";
  if (hour < sunset + 0.3)  return "golden hour sunset, long dramatic shadows, warm orange glow";
  return "dusk, deep blue sky, subtle artificial lighting";
}
