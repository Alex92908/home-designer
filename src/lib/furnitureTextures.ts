/**
 * Procedural canvas textures for furniture surfaces (fabric, wood, metal,
 * ceramic, marble). Generated once per (color, family) combination and
 * cached. Color-aware: callers pass the furniture's base color and get
 * back a texture whose average matches that color.
 *
 * This is the "visual foundation" upgrade described in Step 1 of the
 * BuildCores-direction push — makes procedural box furniture look like
 * real materials instead of flat plastic while we source real glTF assets
 * for Step 2.
 */

import * as THREE from "three";

// ─── Cache ──────────────────────────────────────────────────────────
const _cache = new Map<string, THREE.CanvasTexture>();

function cached(id: string, gen: () => THREE.CanvasTexture): THREE.CanvasTexture {
  const hit = _cache.get(id);
  if (hit) return hit;
  const tex = gen();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  tex.anisotropy = 8;
  _cache.set(id, tex);
  return tex;
}

// ─── Color helpers ──────────────────────────────────────────────────
function hexRGB(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function shade(hex: string, amt: number): string {
  const [r, g, b] = hexRGB(hex);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(r + amt)}${toHex(g + amt)}${toHex(b + amt)}`;
}

function seedFor(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619); }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function makeCtx(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!];
}

// ─── Fabric (sofas, beds, chairs) ───────────────────────────────────
// Cross-hatched weave pattern + subtle color noise → reads as woven cloth
// even at small scale. Normal map (below) adds the actual weave depth.

export function fabricMap(color: string): THREE.CanvasTexture {
  return cached(`fabric-${color}`, () => {
    const SIZE = 256;
    const [canvas, ctx] = makeCtx(SIZE);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const r = rng(seedFor(color));
    // Warp threads (vertical)
    const step = 4;
    for (let x = 0; x < SIZE; x += step) {
      const shade1 = shade(color, -8 + Math.floor(r() * 6));
      ctx.fillStyle = shade1;
      ctx.fillRect(x, 0, 1, SIZE);
    }
    // Weft threads (horizontal)
    for (let y = 0; y < SIZE; y += step) {
      ctx.fillStyle = shade(color, -5 + Math.floor(r() * 10));
      ctx.globalAlpha = 0.65;
      ctx.fillRect(0, y, SIZE, 1);
    }
    ctx.globalAlpha = 1;
    // Fine noise for organic feel
    const img = ctx.getImageData(0, 0, SIZE, SIZE);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 12;
      img.data[i]     = Math.max(0, Math.min(255, img.data[i]     + n));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(canvas);
  });
}

export function fabricNormal(): THREE.CanvasTexture {
  return cached("fabric-normal", () => {
    const SIZE = 256;
    const [canvas, ctx] = makeCtx(SIZE);
    // Neutral normal (flat) = (128, 128, 255)
    ctx.fillStyle = "rgb(128,128,255)";
    ctx.fillRect(0, 0, SIZE, SIZE);
    const step = 4;
    // Weave bumps: alternate between warp-up and weft-up
    for (let y = 0; y < SIZE; y += step) {
      for (let x = 0; x < SIZE; x += step) {
        const up = ((x / step) + (y / step)) % 2 === 0;
        if (up) {
          ctx.fillStyle = "rgb(140,128,250)";
          ctx.fillRect(x, y, step, step / 2);
          ctx.fillStyle = "rgb(128,140,250)";
          ctx.fillRect(x, y + step / 2, step, step / 2);
        } else {
          ctx.fillStyle = "rgb(128,118,248)";
          ctx.fillRect(x, y, step, step / 2);
          ctx.fillStyle = "rgb(116,128,248)";
          ctx.fillRect(x, y + step / 2, step, step / 2);
        }
      }
    }
    return new THREE.CanvasTexture(canvas);
  });
}

// ─── Wood grain (tables, desks, shelves, cabinets) ─────────────────
// Warm longitudinal grain with darker growth rings. Works for oak, walnut,
// maple — just pass the base color.

export function woodMap(color: string, direction: "horizontal" | "vertical" = "horizontal"): THREE.CanvasTexture {
  return cached(`wood-${color}-${direction}`, () => {
    const SIZE = 512;
    const [canvas, ctx] = makeCtx(SIZE);
    const r = rng(seedFor(color));
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Grain lines — soft waves running along `direction`
    const grainCount = 120;
    for (let i = 0; i < grainCount; i++) {
      const pos = r() * SIZE;
      const dark = shade(color, -15 - Math.floor(r() * 35));
      ctx.strokeStyle = dark;
      ctx.globalAlpha = 0.05 + r() * 0.22;
      ctx.lineWidth = 0.5 + r() * 1.6;
      ctx.beginPath();
      if (direction === "horizontal") {
        ctx.moveTo(0, pos);
        const steps = 12;
        for (let s = 1; s <= steps; s++) {
          ctx.lineTo((SIZE / steps) * s, pos + (r() - 0.5) * 6);
        }
      } else {
        ctx.moveTo(pos, 0);
        const steps = 12;
        for (let s = 1; s <= steps; s++) {
          ctx.lineTo(pos + (r() - 0.5) * 6, (SIZE / steps) * s);
        }
      }
      ctx.stroke();
    }

    // Occasional knots
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 5; i++) {
      const kx = r() * SIZE;
      const ky = r() * SIZE;
      const kr = 6 + r() * 14;
      const grad = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr);
      grad.addColorStop(0, shade(color, -60));
      grad.addColorStop(1, color);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(kx, ky, kr, kr * 0.6, r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return new THREE.CanvasTexture(canvas);
  });
}

// ─── Brushed metal (appliances, handles, legs) ──────────────────────
export function brushedMetalMap(color: string): THREE.CanvasTexture {
  return cached(`metal-${color}`, () => {
    const SIZE = 256;
    const [canvas, ctx] = makeCtx(SIZE);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const r = rng(seedFor(color));
    // Fine horizontal brush lines
    for (let y = 0; y < SIZE; y++) {
      const shade1 = Math.floor((r() - 0.5) * 28);
      ctx.strokeStyle = shade(color, shade1);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(SIZE, y + 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return new THREE.CanvasTexture(canvas);
  });
}

// ─── Wall paint (default wall texture) ─────────────────────────────
// Micro-noise albedo + very subtle normal map. Together they break up
// the "plastic sheet" look of pure-flat wall colors — visible on close
// inspection but doesn't fight the user's chosen wall color.

export function paintAlbedo(color: string): THREE.CanvasTexture {
  return cached(`paint-${color}`, () => {
    const SIZE = 512;
    const [canvas, ctx] = makeCtx(SIZE);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const r = rng(seedFor(color));
    // Low-freq blobs (roller pass variation) — draw as soft radial gradients
    for (let i = 0; i < 60; i++) {
      const cx = r() * SIZE;
      const cy = r() * SIZE;
      const rad = 40 + r() * 120;
      const shift = Math.floor((r() - 0.5) * 16);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grad.addColorStop(0, shade(color, shift));
      grad.addColorStop(1, `${shade(color, 0)}00`);
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;
    // High-freq per-pixel grain (paint micro-texture)
    const img = ctx.getImageData(0, 0, SIZE, SIZE);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 14;
      img.data[i]     = Math.max(0, Math.min(255, img.data[i]     + n));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(canvas);
  });
}

export function paintNormal(): THREE.CanvasTexture {
  return cached("paint-normal", () => {
    const SIZE = 512;
    const [canvas, ctx] = makeCtx(SIZE);
    const r = rng(12345);
    const img = ctx.createImageData(SIZE, SIZE);
    // Orange-peel finish: small-scale bumps. We generate XY perturbations
    // that are correlated locally (via pseudo-noise) for a proper orange
    // peel look rather than just per-pixel static.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = (y * SIZE + x) * 4;
        // Multi-octave pseudo-noise
        const n1 = Math.sin(x * 0.15 + r() * 0.3) * Math.cos(y * 0.14 + r() * 0.3);
        const n2 = Math.sin(x * 0.4) * Math.cos(y * 0.45);
        const nx = (n1 * 0.7 + n2 * 0.3) * 40;
        const ny = (Math.sin(y * 0.15) * Math.cos(x * 0.14) * 0.7 + Math.sin(y * 0.4) * Math.cos(x * 0.45) * 0.3) * 40;
        img.data[i]     = 128 + Math.floor(nx);
        img.data[i + 1] = 128 + Math.floor(ny);
        img.data[i + 2] = 240 + Math.floor(r() * 15);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(canvas);
  });
}

// ─── Default floor (wood planks) ────────────────────────────────────
// Used when the user hasn't picked a floor material. Warm wood planks
// tinted from the room's declared floorColor. Plank runs along the
// texture's horizontal axis; caller should orient repeat so planks
// run along the room's long side.

export function defaultFloorPlanks(color: string): THREE.CanvasTexture {
  return cached(`floor-default-${color}`, () => {
    const SIZE = 1024;
    const [canvas, ctx] = makeCtx(SIZE);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const r = rng(seedFor(color));
    const PLANKS = 6;            // planks per tile
    const PLANK_H = SIZE / PLANKS;
    const dark = shade(color, -35);
    const midDark = shade(color, -18);
    const light = shade(color, 12);

    for (let i = 0; i < PLANKS; i++) {
      const y = i * PLANK_H;
      // Random plank base shade
      const shift = Math.floor((r() - 0.5) * 24);
      ctx.fillStyle = shade(color, shift);
      ctx.fillRect(0, y, SIZE, PLANK_H);
      // Grain lines running along the plank
      for (let g = 0; g < 30; g++) {
        const gy = y + r() * PLANK_H;
        ctx.strokeStyle = r() > 0.6 ? midDark : light;
        ctx.globalAlpha = 0.06 + r() * 0.18;
        ctx.lineWidth = 0.5 + r() * 1.2;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        // Slight wavy grain
        for (let x = 0; x < SIZE; x += 80) {
          ctx.lineTo(x, gy + (r() - 0.5) * 3);
        }
        ctx.stroke();
      }
      // Occasional knot
      if (r() > 0.7) {
        const kx = r() * SIZE;
        const ky = y + r() * PLANK_H;
        const kr = 3 + r() * 8;
        ctx.globalAlpha = 0.4;
        const kg = ctx.createRadialGradient(kx, ky, 0.5, kx, ky, kr);
        kg.addColorStop(0, dark);
        kg.addColorStop(1, color);
        ctx.fillStyle = kg;
        ctx.beginPath();
        ctx.ellipse(kx, ky, kr, kr * 0.5, r() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // Plank gap lines between rows
    ctx.fillStyle = dark;
    for (let i = 1; i < PLANKS; i++) {
      const y = i * PLANK_H;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(0, y - 0.5, SIZE, 1.2);
    }
    // Stagger the seams (shifted vertical gaps at 1/3 and 2/3)
    ctx.globalAlpha = 0.55;
    for (let i = 0; i < PLANKS; i++) {
      const y = i * PLANK_H;
      const offsets = i % 2 === 0 ? [SIZE * 0.33] : [SIZE * 0.66];
      for (const x of offsets) {
        ctx.fillRect(x - 0.5, y, 1.2, PLANK_H);
      }
    }
    ctx.globalAlpha = 1;
    return new THREE.CanvasTexture(canvas);
  });
}

// ─── Marble / stone (countertops, bathroom) ─────────────────────────
export function marbleMap(color: string): THREE.CanvasTexture {
  return cached(`marble-${color}`, () => {
    const SIZE = 512;
    const [canvas, ctx] = makeCtx(SIZE);
    const r = rng(seedFor(color));
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Veins
    for (let i = 0; i < 18; i++) {
      ctx.strokeStyle = shade(color, -30 - Math.floor(r() * 40));
      ctx.globalAlpha = 0.15 + r() * 0.3;
      ctx.lineWidth = 0.6 + r() * 2.4;
      ctx.beginPath();
      let x = r() * SIZE;
      let y = r() * SIZE;
      ctx.moveTo(x, y);
      for (let s = 0; s < 30; s++) {
        x += (r() - 0.5) * 28;
        y += (r() - 0.5) * 28;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return new THREE.CanvasTexture(canvas);
  });
}
