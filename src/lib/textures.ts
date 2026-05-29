/**
 * Procedural canvas-based texture generator for PBR materials.
 * All textures are generated once and cached by ID.
 * Textures use RepeatWrapping; callers set repeat based on room dimensions.
 */

import * as THREE from "three";

// ── Cache ──────────────────────────────────────────────────────────────────
const _cache = new Map<string, THREE.CanvasTexture>();

/** Procedural fine-grain stucco for exterior walls. Multiplies into a
 *  baseColor on the ConcreteFacade box so monolithic cream walls stop
 *  reading as flat-fill cardboard. Output is a tilable 512² noise +
 *  speckle pattern, near-white luminance averaging ~0.96 so it doesn't
 *  visibly darken the wall. Cache key includes seed so callers can mix
 *  variants per facade if they want. */
export function getStuccoTexture(seed = 1): THREE.CanvasTexture {
  return cached(`stucco-${seed}`, () => {
    const N = 512;
    const [c, ctx] = makeCtx(N);
    // Base: near-white cream
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, N, N);
    // Low-frequency tonal blotches — like sun-faded stucco mottling.
    // Deterministic xorshift so the same seed always produces the same
    // pattern (avoids per-mount re-blotching jank).
    let s = seed * 2654435761;
    const rand = () => {
      s = (s ^ (s << 13)) >>> 0;
      s = (s ^ (s >>> 17)) >>> 0;
      s = (s ^ (s << 5))  >>> 0;
      return s / 0xffffffff;
    };
    for (let i = 0; i < 90; i++) {
      const x = rand() * N;
      const y = rand() * N;
      const r = 40 + rand() * 80;
      const v = 240 + Math.floor(rand() * 15);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0,   `rgba(${v},${v},${v},0.10)`);
      g.addColorStop(1,   `rgba(${v},${v},${v},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // High-frequency grain — 0.5px speckles giving a faint sandpaper
    // microtexture that catches sun without visible repetition.
    const img = ctx.getImageData(0, 0, N, N);
    for (let i = 0; i < img.data.length; i += 4) {
      const j = (rand() * 14 - 7) | 0;
      img.data[i]   = Math.max(0, Math.min(255, img.data[i]   + j));
      img.data[i+1] = Math.max(0, Math.min(255, img.data[i+1] + j));
      img.data[i+2] = Math.max(0, Math.min(255, img.data[i+2] + j));
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

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
  // Round AFTER clamp so non-integer `amt` values (e.g. tint * rng()) don't
  // produce "58.873e25fe…" hex strings. The indoor textures pass these to
  // ctx.fillStyle which silently ignores bad colors, but addColorStop
  // throws — so always emit integer channels here.
  const toHex = (v: number) => Math.round(clamp(v)).toString(16).padStart(2, "0");
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
// Carbonized bamboo: wide planks composed of tightly-pressed thin bamboo strips.
// Planks run horizontally (left-right), node marks add organic variation.
function bambooFloor(baseColor: string, darkColor: string): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(21);

  ctx.fillStyle = adjustHex(darkColor, -15);
  ctx.fillRect(0, 0, SIZE, SIZE);

  // ── Wide planks (like engineered bamboo boards) ──
  const PLANK_H = 80;  // ~4 planks visible = realistic wide-plank bamboo
  const planks = Math.ceil(SIZE / PLANK_H);

  for (let row = 0; row < planks; row++) {
    const y = row * PLANK_H;
    const plankBase = lerpHex(baseColor, darkColor, rng() * 0.25);
    ctx.fillStyle = plankBase;
    ctx.fillRect(0, y + 1, SIZE, PLANK_H - 2);

    // ── Tight micro-strips within each plank (pressed bamboo strips) ──
    const STRIP_H = 7;
    const stripCount = Math.floor((PLANK_H - 2) / STRIP_H);
    for (let s = 0; s < stripCount; s++) {
      const sy = y + 1 + s * STRIP_H;
      const sc = lerpHex(plankBase, darkColor, rng() * 0.22);
      ctx.fillStyle = sc;
      ctx.fillRect(0, sy, SIZE, STRIP_H - 1);
    }

    // ── Grain lines (longitudinal bamboo fibers) ──
    for (let g = 0; g < 30; g++) {
      const gx = rng() * SIZE;
      ctx.strokeStyle = darkColor;
      ctx.globalAlpha = 0.05 + rng() * 0.09;
      ctx.lineWidth = 0.4 + rng() * 0.8;
      ctx.beginPath();
      ctx.moveTo(gx, y + 1);
      for (let step = 1; step <= 4; step++) {
        ctx.lineTo(gx + (rng() - 0.5) * 3, y + 1 + (PLANK_H - 2) * (step / 4));
      }
      ctx.stroke();
    }

    // ── Node marks (natural bamboo culm knuckle) ──
    if (rng() > 0.45) {
      const nx = rng() * SIZE;
      const ny = y + PLANK_H * 0.45 + (rng() - 0.5) * PLANK_H * 0.2;
      ctx.strokeStyle = adjustHex(darkColor, -8);
      ctx.globalAlpha = 0.22 + rng() * 0.12;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(Math.max(0, nx - 40), ny);
      ctx.bezierCurveTo(nx - 15, ny + (rng() - 0.5) * 4, nx + 15, ny + (rng() - 0.5) * 4, Math.min(SIZE, nx + 40), ny);
      ctx.stroke();
    }
  }

  // ── Plank end gaps ──
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = adjustHex(darkColor, -25);
  for (let row = 1; row <= planks; row++) {
    ctx.fillRect(0, row * PLANK_H - 1, SIZE, 2);
  }

  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(canvas);
}

// ── Outdoor: travertine slab paving ───────────────────────────────────────
// Large-format limestone slabs with subtle cloudy veining and tight
// tooled joints. Reads as the "建筑师 spec" floor — natural stone,
// muted warm-grey, expensive-looking without being shiny.
function travertineSlab(): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(101);
  const SLAB = 256;             // 2×2 large slabs per tile (~1.5m each in world)
  const G = 4;
  const base = "#D8CDB8";
  const dark = "#A8917A";

  // Joint colour
  ctx.fillStyle = "#7E6F58";
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      const sx = col * SLAB, sy = row * SLAB;
      const slabBase = lerpHex(base, dark, rng() * 0.18);
      ctx.fillStyle = slabBase;
      ctx.fillRect(sx + G, sy + G, SLAB - G * 2, SLAB - G * 2);

      // Cloudy patches — broad soft regions
      for (let p = 0; p < 5; p++) {
        const cx = sx + G + rng() * (SLAB - G * 2);
        const cy = sy + G + rng() * (SLAB - G * 2);
        const r  = 30 + rng() * 50;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, lerpHex(slabBase, dark, 0.25));
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(sx + G, sy + G, SLAB - G * 2, SLAB - G * 2);
      }
      ctx.globalAlpha = 1;

      // Pin-prick pores (travertine signature)
      for (let i = 0; i < 200; i++) {
        const px = sx + G + rng() * (SLAB - G * 2);
        const py = sy + G + rng() * (SLAB - G * 2);
        ctx.fillStyle = adjustHex(slabBase, -25);
        ctx.globalAlpha = 0.18 + rng() * 0.22;
        ctx.beginPath();
        ctx.arc(px, py, 0.6 + rng() * 1.0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Subtle drift veins
      for (let v = 0; v < 2; v++) {
        ctx.strokeStyle = adjustHex(slabBase, -15);
        ctx.globalAlpha = 0.10 + rng() * 0.10;
        ctx.lineWidth = 0.6 + rng() * 0.6;
        ctx.beginPath();
        const sx2 = sx + G + rng() * (SLAB - G * 2);
        const sy2 = sy + G;
        ctx.moveTo(sx2, sy2);
        ctx.bezierCurveTo(
          sx2 + (rng() - 0.5) * 60, sy + SLAB * 0.4,
          sx2 + (rng() - 0.5) * 80, sy + SLAB * 0.7,
          sx2 + (rng() - 0.5) * 30, sy + SLAB - G,
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
  return new THREE.CanvasTexture(canvas);
}

// ── Outdoor: polished concrete ────────────────────────────────────────────
// Continuous troweled concrete, narrow control joints every ~1.5m.
// Low chroma cool grey, faint mottling. The driveway / porte-cochère floor.
function polishedConcrete(): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(202);
  const base = "#A8A8A4";

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Soft mottling with 2 cloud layers
  for (let pass = 0; pass < 2; pass++) {
    for (let p = 0; p < 28; p++) {
      const cx = rng() * SIZE, cy = rng() * SIZE, r = 40 + rng() * 90;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const tint = pass === 0 ? -10 : 10;
      grad.addColorStop(0, adjustHex(base, tint));
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.18;
      ctx.fillRect(0, 0, SIZE, SIZE);
    }
  }
  ctx.globalAlpha = 1;

  // Aggregate dots (polish-ground concrete shows tiny stones)
  for (let i = 0; i < 1500; i++) {
    const x = rng() * SIZE, y = rng() * SIZE;
    ctx.fillStyle = adjustHex(base, (rng() - 0.4) * 30);
    ctx.globalAlpha = 0.10 + rng() * 0.18;
    ctx.beginPath();
    ctx.arc(x, y, 0.3 + rng() * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Control joints — every quarter (one tile = 6m, joints every 1.5m)
  ctx.fillStyle = adjustHex(base, -28);
  for (const fx of [SIZE / 4, SIZE / 2, (SIZE * 3) / 4]) {
    ctx.fillRect(fx - 0.5, 0, 1, SIZE);
    ctx.fillRect(0, fx - 0.5, SIZE, 1);
  }

  return new THREE.CanvasTexture(canvas);
}

// ── Outdoor: ipe / teak deck ─────────────────────────────────────────────
// Long narrow planks, dark warm wood, visible plank ends. The pergola /
// private retreat floor.
function woodDeckTeak(): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(303);
  const PLANK_H = 36;     // ~10 planks in 1.6m repeat ≈ 16cm wide planks
  const baseColor = "#7A5530";
  const darkColor = "#3F2810";

  ctx.fillStyle = adjustHex(darkColor, -10);
  ctx.fillRect(0, 0, SIZE, SIZE);

  const planks = Math.ceil(SIZE / PLANK_H);
  for (let row = 0; row < planks; row++) {
    const y = row * PLANK_H;
    const plankColor = lerpHex(baseColor, darkColor, rng() * 0.32);
    ctx.fillStyle = plankColor;
    ctx.fillRect(0, y + 1, SIZE, PLANK_H - 2);

    // Heavy longitudinal grain
    for (let g = 0; g < 18; g++) {
      const gx = rng() * SIZE;
      ctx.strokeStyle = darkColor;
      ctx.globalAlpha = 0.08 + rng() * 0.14;
      ctx.lineWidth = 0.5 + rng() * 1.2;
      ctx.beginPath();
      ctx.moveTo(gx, y + 1);
      for (let s = 1; s <= 6; s++) {
        ctx.lineTo(gx + (rng() - 0.5) * 4, y + 1 + (PLANK_H - 2) * (s / 6));
      }
      ctx.stroke();
    }

    // Plank-end butt joint every ~1.6m (== full SIZE here)
    if (rng() > 0.45) {
      const jx = rng() * SIZE;
      ctx.strokeStyle = adjustHex(darkColor, -8);
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(jx, y + 1);
      ctx.lineTo(jx, y + PLANK_H - 1);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Plank gap shadows (horizontal lines between rows)
  ctx.fillStyle = "#1B0F05";
  for (let row = 1; row < planks + 1; row++) {
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, row * PLANK_H - 1, SIZE, 2);
  }
  ctx.globalAlpha = 1;

  return new THREE.CanvasTexture(canvas);
}

// ── Outdoor: crushed gravel ──────────────────────────────────────────────
// Round-ish 1-2cm pebbles. The agro / decomposed-granite path under raised beds.
function crushedGravel(): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(404);
  const baseDark = "#7A6A52";

  ctx.fillStyle = baseDark;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Pebbles
  for (let i = 0; i < 1200; i++) {
    const x = rng() * SIZE, y = rng() * SIZE;
    const r = 2 + rng() * 5;
    const tone = lerpHex("#C8B698", "#7A6A52", rng());
    ctx.fillStyle = tone;
    ctx.globalAlpha = 0.7 + rng() * 0.3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // Shadow on bottom-right of each pebble
    ctx.fillStyle = "#3A2F22";
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(x + r * 0.25, y + r * 0.30, r * 0.85, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return new THREE.CanvasTexture(canvas);
}

// ── Outdoor: lawn turf ────────────────────────────────────────────────────
// Mottled green carpet with tiny brighter speckles — reads as mowed grass
// from a distance, not the awkward instanced-blade carpet.
function lawnTurf(): THREE.CanvasTexture {
  const SIZE = 512;
  const [canvas, ctx] = makeCtx(SIZE);
  const rng = seededRng(505);
  const base = "#5C8A3F";

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Soft mottles
  for (let p = 0; p < 50; p++) {
    const cx = rng() * SIZE, cy = rng() * SIZE, r = 20 + rng() * 50;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const tint = (rng() - 0.5) * 25;
    grad.addColorStop(0, adjustHex(base, tint));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.30;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }
  ctx.globalAlpha = 1;

  // Bright fine speckles (highlight blades)
  for (let i = 0; i < 6000; i++) {
    const x = rng() * SIZE, y = rng() * SIZE;
    ctx.fillStyle = adjustHex(base, 12 + rng() * 14);
    ctx.globalAlpha = 0.10 + rng() * 0.14;
    ctx.fillRect(x, y, 0.7, 0.7);
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
      return cached(id, () => bambooFloor("#A8904E", "#4E3015"));
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
      return [1.6, 1.6];  // 4 planks × 40cm wide = ~1.6m repeat
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

// ── Outdoor texture API ───────────────────────────────────────────────────
// Decoupled from getFloorTexture so the indoor floor picker isn't polluted
// with outdoor-only paving options. Use these from ZoneRenderer / Ground.

/** Returns a procedural canvas texture for an outdoor paving material id.
 *  Returns null for unknown ids — callers should fall back to flat color. */
export function getOutdoorTexture(id: string): THREE.CanvasTexture | null {
  switch (id) {
    case "outdoor-travertine":
      return cached(id, () => travertineSlab());
    case "outdoor-polished-concrete":
      return cached(id, () => polishedConcrete());
    case "outdoor-wood-deck":
      return cached(id, () => woodDeckTeak());
    case "outdoor-crushed-gravel":
      return cached(id, () => crushedGravel());
    case "outdoor-lawn-turf":
      return cached(id, () => lawnTurf());
    default:
      return null;
  }
}

/** Real-world tile size in metres for outdoor materials. Multiply your
 *  surface dimensions by this to compute the texture repeat count. */
export function outdoorTileSize(id: string): [number, number] {
  switch (id) {
    case "outdoor-travertine":
      return [3.0, 3.0];   // 2×2 large slabs ≈ 3m × 3m repeat
    case "outdoor-polished-concrete":
      return [6.0, 6.0];   // bigger repeat — joints every 1.5m within tile
    case "outdoor-wood-deck":
      return [1.6, 1.6];   // ~10 planks × 16cm wide
    case "outdoor-crushed-gravel":
      return [1.0, 1.0];
    case "outdoor-lawn-turf":
      return [2.0, 2.0];
    default:
      return [2.0, 2.0];
  }
}
