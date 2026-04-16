/**
 * Procedural canvas-based texture generator for PBR materials.
 * All textures are generated once and cached by ID.
 * Textures use RepeatWrapping; callers set repeat based on room dimensions.
 */

import * as THREE from "three";

// ── Cache ──────────────────────────────────────────────────────────────────
const _cache = new Map<string, THREE.CanvasTexture>();

function cached(id: string, gen: () => THREE.CanvasTexture): THREE.CanvasTexture {
  if (_cache.has(id)) return _cache.get(id)!;
  const tex = gen();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  _cache.set(id, tex);
  return tex;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function makeCtx(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

/** Convert hex to [r,g,b] 0-255 */
function hexRGB(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Lighten/darken a hex color by an amount -255..255 */
function adjustHex(hex: string, amt: number): string {
  const [r, g, b] = hexRGB(hex);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(r + amt)}${toHex(g + amt)}${toHex(b + amt)}`;
}

/** Lerp between two hex colors */
function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexRGB(a);
  const [br, bg, bb] = hexRGB(b);
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * t);
  const toHex = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0");
  return `#${toHex(lerp(ar, br))}${toHex(lerp(ag, bg))}${toHex(lerp(ab, bb))}`;
}

// ── seeded PRNG so textures are deterministic ──────────────────────────────
function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ── Wood plank floor ───────────────────────────────────────────────────────
function woodFloor(
  baseColor: string,
  darkColor: string,
  plankW: number,   // plank width in pixels (out of 512)
  grainCount: number,
  seedN: number,
): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(seedN);

  // Background
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Planks (horizontal strips) ──
  const plankH = SIZE;  // full height — we tile vertically = plank direction
  // Actually let's make planks run horizontally (along X axis)
  // Each plank = a horizontal band
  const PLANK_H = Math.round(SIZE / plankW);  // plankW = number of planks
  for (let row = 0; row < plankW + 1; row++) {
    const y = row * PLANK_H;
    const plankColor = lerpHex(baseColor, darkColor, rng() * 0.35);
    ctx.fillStyle = plankColor;
    ctx.fillRect(0, y, SIZE, PLANK_H - 1);
  }

  // ── Grain lines (vertical wavering lines across planks) ──
  for (let i = 0; i < grainCount; i++) {
    const x = rng() * SIZE;
    ctx.strokeStyle = darkColor;
    ctx.globalAlpha = 0.07 + rng() * 0.13;
    ctx.lineWidth = 0.5 + rng() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    const steps = 8;
    for (let s = 1; s <= steps; s++) {
      ctx.lineTo(x + (rng() - 0.5) * 6, (SIZE / steps) * s);
    }
    ctx.stroke();
  }

  // ── Plank gaps (thin dark lines between planks) ──
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = adjustHex(darkColor, -20);
  for (let row = 1; row < plankW + 1; row++) {
    ctx.fillRect(0, row * PLANK_H - 1, SIZE, 1);
  }

  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(canvas);
}

// ── Herringbone floor ──────────────────────────────────────────────────────
function herringboneFloor(light: string, dark: string): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(42);
  const BW = 40;  // block width
  const BH = 16;  // block height

  ctx.fillStyle = light;
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let row = -2; row < SIZE / BW + 2; row++) {
    for (let col = -2; col < SIZE / BH + 4; col++) {
      const even = (row + col) % 2 === 0;
      const blockColor = lerpHex(light, dark, rng() * 0.3 + (even ? 0 : 0.15));
      ctx.save();
      const cx = col * BH * 2 + (row % 2 === 0 ? 0 : BH);
      const cy = row * BW;
      ctx.translate(cx + BW / 2, cy + BH / 2);
      ctx.rotate(even ? Math.PI / 4 : -Math.PI / 4);
      ctx.fillStyle = blockColor;
      ctx.fillRect(-BW / 2, -BH / 2, BW - 1, BH - 1);
      ctx.restore();
    }
  }

  return new THREE.CanvasTexture(canvas);
}

// ── Square tile floor ──────────────────────────────────────────────────────
function squareTile(
  tileColor: string,
  groutColor: string,
  tilesAcross: number,  // how many tiles in 512px
  groutW: number,
  seedN: number,
): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(seedN);
  const TILE = Math.floor(SIZE / tilesAcross);
  const G = groutW;

  // Grout background
  ctx.fillStyle = groutColor;
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let row = 0; row < tilesAcross + 1; row++) {
    for (let col = 0; col < tilesAcross + 1; col++) {
      const shade = lerpHex(tileColor, adjustHex(tileColor, -12), rng() * 0.2);
      ctx.fillStyle = shade;
      ctx.fillRect(col * TILE + G, row * TILE + G, TILE - G * 2, TILE - G * 2);
    }
  }

  return new THREE.CanvasTexture(canvas);
}

// ── Concrete floor ────────────────────────────────────────────────────────
function concreteFloor(baseColor: string): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(77);

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Noise / aggregate
  for (let i = 0; i < 4000; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const r = rng() * 2;
    const bright = rng() > 0.5 ? 18 : -18;
    ctx.fillStyle = adjustHex(baseColor, bright * rng());
    ctx.globalAlpha = 0.08 + rng() * 0.15;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hairline cracks
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = adjustHex(baseColor, -25);
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    const sx = rng() * SIZE;
    const sy = rng() * SIZE;
    ctx.moveTo(sx, sy);
    for (let s = 0; s < 8; s++) {
      ctx.lineTo(sx + (rng() - 0.5) * 80 * s, sy + rng() * 40);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(canvas);
}

// ── Subway / metro wall tile ───────────────────────────────────────────────
function metroTile(tileColor: string, groutColor: string): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(13);

  // Width=76, Height=38 (2:1 ratio) — subway tile
  const TW = 76;
  const TH = 38;
  const G = 4;
  const cols = Math.ceil(SIZE / TW) + 1;
  const rows = Math.ceil(SIZE / TH) + 1;

  ctx.fillStyle = groutColor;
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let row = 0; row < rows; row++) {
    const offset = (row % 2) * (TW / 2);
    for (let col = 0; col < cols; col++) {
      const x = col * TW + offset - TW / 2;
      const y = row * TH;
      const brightness = (rng() - 0.5) * 8;
      ctx.fillStyle = adjustHex(tileColor, brightness);
      ctx.fillRect(x + G, y + G, TW - G * 2, TH - G * 2);
    }
  }

  return new THREE.CanvasTexture(canvas);
}

// ── Marble / large-format wall tile ───────────────────────────────────────
function marbleTile(baseColor: string): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(55);
  const G = 3;
  const TILE = 256; // 2 tiles across (large format)

  ctx.fillStyle = adjustHex(baseColor, -15);
  ctx.fillRect(0, 0, SIZE, SIZE);

  // 4 large tiles
  const positions = [[0, 0], [TILE, 0], [0, TILE], [TILE, TILE]];
  for (const [tx, ty] of positions) {
    // Tile base
    const tileC = adjustHex(baseColor, (rng() - 0.5) * 10);
    ctx.fillStyle = tileC;
    ctx.fillRect(tx + G, ty + G, TILE - G * 2, TILE - G * 2);

    // Marble veins
    for (let v = 0; v < 4; v++) {
      ctx.strokeStyle = adjustHex(baseColor, -30);
      ctx.globalAlpha = 0.12 + rng() * 0.15;
      ctx.lineWidth = 1 + rng() * 2;
      ctx.beginPath();
      const sx = tx + G + rng() * (TILE - G * 2);
      const sy = ty + G;
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(
        sx + (rng() - 0.5) * 60, ty + TILE * 0.33,
        sx + (rng() - 0.5) * 80, ty + TILE * 0.66,
        sx + (rng() - 0.5) * 40, ty + TILE - G,
      );
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(canvas);
}

// ── Wood panel wall ────────────────────────────────────────────────────────
function woodPanelWall(baseColor: string, darkColor: string): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(99);
  const PANEL_W = 64; // panels run vertically
  const panels = Math.ceil(SIZE / PANEL_W);

  ctx.fillStyle = adjustHex(darkColor, -10);
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let col = 0; col < panels; col++) {
    const x = col * PANEL_W;
    const panelColor = lerpHex(baseColor, darkColor, rng() * 0.25);
    ctx.fillStyle = panelColor;
    ctx.fillRect(x + 2, 0, PANEL_W - 4, SIZE);

    // Grain lines
    for (let g = 0; g < 12; g++) {
      const gx = x + 2 + rng() * (PANEL_W - 4);
      ctx.strokeStyle = darkColor;
      ctx.globalAlpha = 0.06 + rng() * 0.1;
      ctx.lineWidth = 0.5 + rng() * 1;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      for (let s = 1; s <= 8; s++) {
        ctx.lineTo(gx + (rng() - 0.5) * 4, (SIZE / 8) * s);
      }
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(canvas);
}

// ── Emerald / solid colored tile ──────────────────────────────────────────
function solidTile(tileColor: string, groutColor: string): THREE.CanvasTexture {
  // reuse square tile with larger tiles
  return squareTile(tileColor, groutColor, 6, 4, 88);
}

// ── Bamboo floor ──────────────────────────────────────────────────────────
function bambooFloor(baseColor: string, darkColor: string): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(21);

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, SIZE, SIZE);

  const STRIP_H = 10; // thin bamboo strips
  const strips = Math.ceil(SIZE / STRIP_H);

  for (let row = 0; row < strips; row++) {
    const y = row * STRIP_H;
    const stripColor = lerpHex(baseColor, darkColor, rng() * 0.4);
    ctx.fillStyle = stripColor;
    ctx.fillRect(0, y, SIZE, STRIP_H - 1);

    // subtle bamboo node marks
    if (rng() > 0.85) {
      ctx.strokeStyle = darkColor;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + STRIP_H / 2);
      ctx.lineTo(SIZE, y + STRIP_H / 2 + (rng() - 0.5) * 2);
      ctx.stroke();
    }
  }

  // Vertical bamboo seams
  for (let col = 0; col < 4; col++) {
    ctx.strokeStyle = adjustHex(darkColor, -15);
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(col * SIZE / 4, 0);
    ctx.lineTo(col * SIZE / 4, SIZE);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(canvas);
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Returns a texture for the given material ID, or null for solid-color materials. */
export function getFloorTexture(id: string): THREE.CanvasTexture | null {
  switch (id) {
    case "floor-oak":
      return cached(id, () => woodFloor("#C8A882", "#7A5530", 8, 80, 11));
    case "floor-walnut":
      return cached(id, () => woodFloor("#6B4423", "#3A2010", 8, 70, 22));
    case "floor-herringbone":
      return cached(id, () => herringboneFloor("#B89060", "#7A5530"));
    case "floor-white-tile":
      return cached(id, () => squareTile("#F0EFEB", "#D0CECA", 4, 5, 33));
    case "floor-black-tile":
      return cached(id, () => squareTile("#2A2A2A", "#111111", 4, 4, 44));
    case "floor-concrete":
      return cached(id, () => concreteFloor("#888888"));
    case "floor-bamboo":
      return cached(id, () => bambooFloor("#A0874A", "#5A4020"));
    case "floor-terracotta":
      return cached(id, () => squareTile("#C67B5C", "#8B4A35", 5, 5, 55));
    case "floor-hex-tile":
      return cached(id, () => squareTile("#FAFAFA", "#D0D0D0", 6, 4, 66));
    default:
      return null;
  }
}

export function getWallTexture(id: string): THREE.CanvasTexture | null {
  switch (id) {
    case "wall-tile-white":
      return cached(id, () => marbleTile("#EFEFEF"));
    case "wall-tile-metro":
      return cached(id, () => metroTile("#FAFAFA", "#D8D8D8"));
    case "wall-wood-panel":
      return cached(id, () => woodPanelWall("#C0924E", "#7A5530"));
    case "wall-emerald-tile":
      return cached(id, () => solidTile("#2D6A4F", "#1A3F30"));
    default:
      return null;
  }
}

/** Tile size in metres for correct UV repeat calculation.
 *  Returns [uSize, vSize] — the real-world size one texture repetition covers. */
export function floorTileSize(id: string): [number, number] {
  switch (id) {
    case "floor-white-tile":
    case "floor-black-tile":
      return [2.4, 2.4];  // 4 tiles × 60cm = 2.4m
    case "floor-hex-tile":
      return [1.8, 1.8];
    case "floor-terracotta":
      return [2.0, 2.0];
    case "floor-concrete":
      return [3.0, 3.0];
    case "floor-herringbone":
      return [1.6, 1.6];
    case "floor-bamboo":
      return [1.2, 1.2];
    default:
      return [2.0, 2.0];  // wood floors: repeat every 2m
  }
}

export function wallTileSize(id: string): [number, number] {
  switch (id) {
    case "wall-tile-metro":
      return [1.5, 0.76];  // metro tiles ~30×15cm × 5cols = 1.5m wide
    case "wall-tile-white":
      return [2.0, 2.0];   // large marble 60×60cm × ~3 = ~2m
    case "wall-wood-panel":
      return [2.0, 2.4];
    case "wall-emerald-tile":
      return [1.8, 1.8];
    default:
      return [2.0, 2.0];
  }
}
