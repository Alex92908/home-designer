"use client";

import * as THREE from "three";
import type { FurnitureItem } from "@/lib/types";

/**
 * FallbackMeshes — procedural geometry for furniture categories that used
 * to fall through to GenericBox (one solid colored box).
 *
 * Why this exists: FurnitureMesh is BOTH the render path for items with
 * no GLB and the <Suspense> fallback while a GLB is still loading. So
 * whenever the real model isn't on screen yet — slow load, failed load,
 * or no model at all — the user sees this mesh. A plain box reads as a
 * low-poly placeholder ("低像素模型"); a shaped mesh reads as the object.
 *
 * Rules followed here (Chu's quality bar):
 * - Procedural three.js primitives only. No new GLB downloads.
 * - Every shape must read as the object it stands for from a normal
 *   room-viewing distance. No sloppy single-box "close enough".
 * - The generic fallback for unknown ids is a two-part object (base +
 *   rounded form + accent), never one solid box.
 * - Dims (w/d/h) are in METERS, group origin at floor-center, y-up —
 *   same convention as the meshes in RoomCanvas.tsx.
 */

export interface FallbackProps {
  item: FurnitureItem;
  color: string;
  sc?: string;
  w: number;
  d: number;
  h: number;
}

type V3 = [number, number, number];

function shade(hex: string, pct: number): string {
  const c = hex.replace("#", "");
  if (c.length < 6) return hex;
  const r = Math.min(255, Math.max(0, parseInt(c.slice(0, 2), 16) + pct * 2));
  const g = Math.min(255, Math.max(0, parseInt(c.slice(2, 4), 16) + pct * 2));
  const b = Math.min(255, Math.max(0, parseInt(c.slice(4, 6), 16) + pct * 2));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ─── Tiny part helpers (keeps each mesh a readable list of parts) ───
type MatProps = {
  c: string; rough?: number; metal?: number;
  e?: string; ei?: number; o?: number; side?: THREE.Side;
};
function mat(p: MatProps) {
  return (
    <meshStandardMaterial
      color={p.c}
      roughness={p.rough ?? 0.7}
      metalness={p.metal ?? 0}
      emissive={p.e ?? "#000000"}
      emissiveIntensity={p.e ? (p.ei ?? 0.5) : 0}
      transparent={p.o !== undefined}
      opacity={p.o ?? 1}
      side={p.side}
    />
  );
}
function Box({ p, s, rot, cast = true, ...m }: MatProps & { p: V3; s: V3; rot?: V3; cast?: boolean }) {
  return (
    <mesh position={p} rotation={rot} castShadow={cast} receiveShadow>
      <boxGeometry args={s} />
      {mat(m)}
    </mesh>
  );
}
function Cyl({ p, rt, rb, len, seg = 16, open = false, th0, thLen, rot, cast = true, ...m }: MatProps & {
  p: V3; rt: number; rb: number; len: number; seg?: number; open?: boolean;
  th0?: number; thLen?: number; rot?: V3; cast?: boolean;
}) {
  return (
    <mesh position={p} rotation={rot} castShadow={cast} receiveShadow>
      <cylinderGeometry args={[rt, rb, len, seg, 1, open, th0 ?? 0, thLen ?? Math.PI * 2]} />
      {mat(m)}
    </mesh>
  );
}
function Sph({ p, r, s, rot, cast = true, ...m }: MatProps & {
  p: V3; r: number; s?: V3; rot?: V3; cast?: boolean;
}) {
  return (
    <mesh position={p} rotation={rot} scale={s} castShadow={cast} receiveShadow>
      <sphereGeometry args={[r, 16, 12]} />
      {mat(m)}
    </mesh>
  );
}
function Cone({ p, r, len, seg = 12, rot, cast = true, ...m }: MatProps & {
  p: V3; r: number; len: number; seg?: number; rot?: V3; cast?: boolean;
}) {
  return (
    <mesh position={p} rotation={rot} castShadow={cast} receiveShadow>
      <coneGeometry args={[r, len, seg]} />
      {mat(m)}
    </mesh>
  );
}
function Tor({ p, r, tube, rot, cast = true, ...m }: MatProps & {
  p: V3; r: number; tube: number; rot?: V3; cast?: boolean;
}) {
  return (
    <mesh position={p} rotation={rot} castShadow={cast} receiveShadow>
      <torusGeometry args={[r, tube, 10, 28]} />
      {mat(m)}
    </mesh>
  );
}
function Rock({ p, r, c, rot, s }: { p: V3; r: number; c: string; rot?: V3; s?: V3 }) {
  return (
    <mesh position={p} rotation={rot} scale={s} castShadow receiveShadow>
      <icosahedronGeometry args={[r, 0]} />
      <meshStandardMaterial color={c} roughness={0.95} flatShading />
    </mesh>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DECOR
// ═══════════════════════════════════════════════════════════════════

/** Vase body: foot + rounded body + neck + rim. `bodyColor` is the ceramic;
 *  flowers (if any) carry the item color separately. */
function VaseBody({ w, d, h, bodyColor }: { w: number; d: number; h: number; bodyColor: string }) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      {/* Foot */}
      <Cyl p={[0, h * 0.04, 0]} rt={r * 0.62} rb={r * 0.72} len={h * 0.08} c={shade(bodyColor, -12)} rough={0.4} />
      {/* Rounded body */}
      <Sph p={[0, h * 0.42, 0]} r={r * 0.78} s={[1, 1.15, 1]} c={bodyColor} rough={0.35} />
      {/* Neck */}
      <Cyl p={[0, h * 0.78, 0]} rt={r * 0.34} rb={r * 0.42} len={h * 0.28} c={bodyColor} rough={0.35} />
      {/* Rim */}
      <Tor p={[0, h * 0.92, 0]} r={r * 0.34} tube={Math.max(0.004, r * 0.07)} rot={[Math.PI / 2, 0, 0]} c={shade(bodyColor, -18)} rough={0.4} />
    </group>
  );
}

/** decor-tulip — THE pink-cube fix. Cream vase, green stems, PINK tulip
 *  heads (the catalog color is the flower color, not the vase). Must never
 *  read as a pink box again. */
function TulipVase({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  const r = Math.min(w, d) / 2;
  const stems: Array<{ x: number; z: number; tilt: V3; top: V3 }> = [
    { x: 0, z: 0, tilt: [0, 0, 0], top: [0, h * 0.99, 0] },
    { x: r * 0.28, z: r * 0.12, tilt: [0.1, 0, -0.14], top: [r * 0.42, h * 0.94, r * 0.18] },
    { x: -r * 0.28, z: r * 0.1, tilt: [0.08, 0, 0.15], top: [-r * 0.42, h * 0.95, r * 0.15] },
    { x: r * 0.1, z: -r * 0.3, tilt: [-0.16, 0, -0.05], top: [r * 0.16, h * 0.93, -r * 0.44] },
    { x: -r * 0.12, z: -r * 0.28, tilt: [-0.14, 0, 0.06], top: [-r * 0.18, h * 0.92, -r * 0.42] },
  ];
  return (
    <group>
      <VaseBody w={w} d={d} h={h * 0.66} bodyColor="#F2EEE6" />
      {/* Stems rise out of the vase mouth (~0.66h) to the flower heads */}
      {stems.map((s, i) => (
        <Cyl
          key={i}
          p={[s.x / 2, h * 0.8, s.z / 2]}
          rt={0.0035} rb={0.0035} len={h * 0.32}
          rot={s.tilt}
          c="#3A7030" rough={0.85}
          cast={false}
        />
      ))}
      {/* Tulip heads — pink, cup-shaped (sphere stretched tall) */}
      {stems.map((s, i) => (
        <Sph key={i} p={s.top} r={Math.max(0.014, r * 0.22)} s={[1, 1.4, 1]} c={color} rough={0.6} cast={false} />
      ))}
      {/* Two leaves */}
      <Sph p={[r * 0.5, h * 0.78, r * 0.1]} r={0.02} s={[1, 2.2, 0.35]} rot={[0, 0, -0.5]} c="#4A8038" rough={0.85} cast={false} />
      <Sph p={[-r * 0.45, h * 0.76, -r * 0.08]} r={0.018} s={[1, 2.0, 0.35]} rot={[0, 0, 0.5]} c="#4A8038" rough={0.85} cast={false} />
    </group>
  );
}

/** Stack of books lying flat (books-pile / books-set / book-stack …). */
function BookStack({ color, sc, w, d, h }: { color: string; sc?: string; w: number; d: number; h: number }) {
  const n = h > 0.2 ? 4 : 3;
  const cols = [color, shade(color, -18), sc ?? shade(color, 14), shade(color, -30)];
  const bookH = h / n;
  return (
    <group>
      {Array.from({ length: n }).map((_, i) => {
        const y = bookH * (i + 0.5);
        const rot = (i % 2 === 0 ? 1 : -1) * 0.06 * (i + 1);
        const bw = w * (0.94 - i * 0.04);
        return (
          <group key={i} position={[0, y, 0]} rotation={[0, rot, 0]}>
            {/* Cover */}
            <Box p={[0, 0, 0]} s={[bw, bookH * 0.55, d * 0.9]} c={cols[i % cols.length]} rough={0.75} />
            {/* Pages */}
            <Box p={[bw * 0.02, 0, 0]} s={[bw * 0.9, bookH * 0.4, d * 0.82]} c="#F5F0E0" rough={0.9} cast={false} />
          </group>
        );
      })}
    </group>
  );
}

/** Row of standing books (books-pack / books-vintage). */
function BookRow({ color, sc, w, d, h }: { color: string; sc?: string; w: number; d: number; h: number }) {
  const n = Math.max(4, Math.min(7, Math.round(w / 0.05)));
  const cols = [color, shade(color, -20), sc ?? "#8A6A45", shade(color, 16), "#5A6A7A", "#7A4A3A"];
  const bw = (w * 0.92) / n;
  return (
    <group>
      {Array.from({ length: n }).map((_, i) => {
        const x = -w * 0.46 + bw * (i + 0.5);
        const bh = h * (0.82 + ((i * 37) % 10) / 50);
        const lean = i === n - 1 ? -0.14 : 0;
        return (
          <group key={i} position={[x, bh / 2, 0]} rotation={[0, 0, lean]}>
            <Box p={[0, 0, 0]} s={[bw * 0.88, bh, d * 0.85]} c={cols[i % cols.length]} rough={0.8} />
            <Box p={[0, bh * 0.32, d * 0.44]} s={[bw * 0.7, bh * 0.06, 0.004]} c="#F5F0E0" rough={0.9} cast={false} />
          </group>
        );
      })}
    </group>
  );
}

/** Cushions / pillows leaning (decor-pillows) + folded blanket/clothes. */
function PillowMesh({ color, sc, w, d, h }: { color: string; sc?: string; w: number; d: number; h: number }) {
  const cw = w * 0.46;
  return (
    <group>
      {/* Two cushions leaning against each other */}
      <Sph p={[-cw * 0.55, h * 0.48, 0]} r={cw * 0.52} s={[1, 1.15, 0.42]} rot={[0, 0, 0.1]} c={color} rough={0.95} />
      <Sph p={[cw * 0.55, h * 0.46, d * 0.06]} r={cw * 0.52} s={[1, 1.1, 0.42]} rot={[-0.18, 0, -0.08]} c={sc ?? shade(color, 18)} rough={0.95} />
      {/* Seam piping hint */}
      <Tor p={[-cw * 0.55, h * 0.48, d * 0.2]} r={cw * 0.42} tube={0.006} c={shade(color, -25)} rough={0.9} cast={false} />
    </group>
  );
}

function FoldedStack({ color, sc, w, d, h }: { color: string; sc?: string; w: number; d: number; h: number }) {
  const cols = [color, sc ?? shade(color, 16), shade(color, -16)];
  return (
    <group>
      {[0, 1, 2].map((i) => (
        <Sph
          key={i}
          p={[(i - 1) * w * 0.04, h * (0.2 + i * 0.3), 0]}
          r={Math.min(w, d) * 0.42}
          s={[1.15, 0.32, 0.95]}
          c={cols[i % 3]}
          rough={0.95}
        />
      ))}
    </group>
  );
}

/** Sculpture on a plinth: humanoid (buddha/religious/nutcracker) or animal
 *  (dog/deer/lion/elephant/swan/rooster). Abstract silhouette, stone or
 *  brass — reads as "a statue", never as a plain box. */
function StatueMesh({ item, color, w, d, h }: FallbackProps) {
  const id = item.id;
  const plinthH = h * 0.16;
  const figH = h - plinthH;
  const figColor = /lion|金狮/.test(id) ? "#C8A040" : color;
  const isAnimal = /dog|deer|lion|elephant|swan|rooster|犬|鹿|狮|象|天鹅|公鸡/.test(id + item.name);
  const isBuddha = /buddha|佛像|religious|宗教/.test(id + item.name);
  return (
    <group>
      {/* Plinth */}
      <Box p={[0, plinthH / 2, 0]} s={[w * 0.62, plinthH, d * 0.62]} c="#4A4640" rough={0.9} />
      {isBuddha ? (
        <group>
          {/* Crossed-legs base */}
          <Sph p={[0, plinthH + figH * 0.14, 0]} r={Math.min(w, d) * 0.3} s={[1.25, 0.42, 1]} c={figColor} rough={0.5} metal={0.25} />
          {/* Robed torso */}
          <Cone p={[0, plinthH + figH * 0.48, 0]} r={Math.min(w, d) * 0.26} len={figH * 0.52} c={figColor} rough={0.5} metal={0.25} />
          {/* Head + topknot */}
          <Sph p={[0, plinthH + figH * 0.82, 0]} r={Math.min(w, d) * 0.15} c={figColor} rough={0.5} metal={0.25} />
          <Sph p={[0, plinthH + figH * 0.95, 0]} r={Math.min(w, d) * 0.05} c={figColor} rough={0.5} metal={0.25} cast={false} />
        </group>
      ) : isAnimal ? (
        <group>
          {/* Body — horizontal ellipsoid */}
          <Sph p={[0, plinthH + figH * 0.42, 0]} r={Math.min(w, d) * 0.3} s={[1.5, 0.8, 0.75]} c={figColor} rough={0.55} metal={0.2} />
          {/* Head */}
          <Sph p={[w * 0.32, plinthH + figH * 0.62, 0]} r={Math.min(w, d) * 0.17} c={figColor} rough={0.55} metal={0.2} />
          {/* Legs */}
          {[[-0.22, -0.14], [0.22, -0.14], [-0.22, 0.14], [0.22, 0.14]].map(([lx, lz], i) => (
            <Cyl key={i} p={[lx * w, plinthH + figH * 0.14, lz * d]} rt={0.012} rb={0.012} len={figH * 0.28} c={shade(figColor, -20)} rough={0.6} cast={false} />
          ))}
          {/* Tail */}
          <Cyl p={[-w * 0.42, plinthH + figH * 0.5, 0]} rt={0.008} rb={0.012} len={figH * 0.3} rot={[0, 0, 0.7]} c={shade(figColor, -15)} rough={0.6} cast={false} />
          {/elephant|大象/.test(id + item.name) && (
            <group>
              {/* Trunk */}
              <Cyl p={[w * 0.44, plinthH + figH * 0.5, 0]} rt={0.014} rb={0.02} len={figH * 0.34} rot={[0, 0, 0.35]} c={shade(figColor, -8)} rough={0.6} cast={false} />
              {/* Ears */}
              <Sph p={[w * 0.26, plinthH + figH * 0.66, d * 0.14]} r={Math.min(w, d) * 0.12} s={[0.3, 1, 1]} c={shade(figColor, -10)} rough={0.6} cast={false} />
              <Sph p={[w * 0.26, plinthH + figH * 0.66, -d * 0.14]} r={Math.min(w, d) * 0.12} s={[0.3, 1, 1]} c={shade(figColor, -10)} rough={0.6} cast={false} />
            </group>
          )}
          {/deer|鹿/.test(id + item.name) && (
            <group>
              <Cyl p={[w * 0.28, plinthH + figH * 0.86, -d * 0.06]} rt={0.006} rb={0.008} len={figH * 0.26} rot={[0.15, 0, -0.25]} c="#8A6A45" rough={0.8} cast={false} />
              <Cyl p={[w * 0.28, plinthH + figH * 0.86, d * 0.06]} rt={0.006} rb={0.008} len={figH * 0.26} rot={[-0.15, 0, -0.25]} c="#8A6A45" rough={0.8} cast={false} />
            </group>
          )}
          {/swan|天鹅/.test(id + item.name) && (
            <group>
              <Cyl p={[w * 0.36, plinthH + figH * 0.72, 0]} rt={0.012} rb={0.016} len={figH * 0.34} rot={[0, 0, -0.5]} c={figColor} rough={0.55} cast={false} />
              <Cone p={[w * 0.48, plinthH + figH * 0.88, 0]} r={0.012} len={0.05} rot={[0, 0, -Math.PI / 2]} c="#E8821E" rough={0.6} cast={false} />
            </group>
          )}
          {/rooster|公鸡/.test(id + item.name) && (
            <group>
              <Cone p={[w * 0.32, plinthH + figH * 0.78, 0]} r={0.014} len={0.05} c="#C82020" rough={0.6} cast={false} />
              <Box p={[-w * 0.4, plinthH + figH * 0.62, 0]} s={[w * 0.16, 0.02, d * 0.2]} rot={[0, 0, 0.6]} c={shade(figColor, -20)} rough={0.6} cast={false} />
            </group>
          )}
          {/lion|金狮/.test(id + item.name) && (
            <Sph p={[w * 0.3, plinthH + figH * 0.62, 0]} r={Math.min(w, d) * 0.24} c={shade(figColor, -25)} rough={0.7} cast={false} />
          )}
        </group>
      ) : (
        <group>
          {/* Standing robed figure: robe cone + torso + head */}
          <Cone p={[0, plinthH + figH * 0.32, 0]} r={Math.min(w, d) * 0.3} len={figH * 0.6} c={figColor} rough={0.55} metal={0.2} />
          <Sph p={[0, plinthH + figH * 0.72, 0]} r={Math.min(w, d) * 0.2} s={[1, 1.15, 0.9]} c={figColor} rough={0.55} metal={0.2} />
          <Sph p={[0, plinthH + figH * 0.9, 0]} r={Math.min(w, d) * 0.13} c={figColor} rough={0.55} metal={0.2} />
        </group>
      )}
    </group>
  );
}

/** Tea set / dinnerware / cups on a tray. */
function TablewareMesh({ item, color, sc, w, d, h }: FallbackProps) {
  const id = item.id;
  const isTea = /tea-set|茶具/.test(id + item.name);
  const trayH = h * 0.1;
  return (
    <group>
      {/* Tray */}
      <Box p={[0, trayH / 2, 0]} s={[w * 0.92, trayH, d * 0.9]} c={shade(color, -25)} rough={0.5} />
      {isTea ? (
        <group>
          {/* Teapot: round body + spout + handle */}
          <Sph p={[-w * 0.2, trayH + h * 0.28, 0]} r={Math.min(w, d) * 0.2} s={[1, 0.85, 1]} c={color} rough={0.35} />
          <Cyl p={[-w * 0.2 + Math.min(w, d) * 0.2, trayH + h * 0.32, 0]} rt={0.008} rb={0.014} len={Math.min(w, d) * 0.28} rot={[0, 0, -0.9]} c={color} rough={0.35} cast={false} />
          <Tor p={[-w * 0.2 - Math.min(w, d) * 0.22, trayH + h * 0.3, 0]} r={Math.min(w, d) * 0.1} tube={0.006} rot={[0, Math.PI / 2, 0]} c={shade(color, -20)} rough={0.4} cast={false} />
          {/* Two cups */}
          {[0.18, 0.36].map((cx, i) => (
            <Cyl key={i} p={[w * cx, trayH + h * 0.1, 0]} rt={Math.min(w, d) * 0.11} rb={Math.min(w, d) * 0.09} len={h * 0.2} c={sc ?? "#F2EEE6"} rough={0.35} />
          ))}
        </group>
      ) : (
        <group>
          {/* Cups / small bowls */}
          {[-0.22, 0.05, 0.28].map((cx, i) => (
            <Cyl key={i} p={[w * cx, trayH + h * 0.16, (i % 2 === 0 ? -1 : 1) * d * 0.12]} rt={Math.min(w, d) * 0.12} rb={Math.min(w, d) * 0.1} len={h * 0.32} c={i === 1 ? (sc ?? "#F2EEE6") : color} rough={0.35} />
          ))}
          {/* Plates stacked */}
          <Cyl p={[-w * 0.3, trayH + h * 0.06, d * 0.22]} rt={Math.min(w, d) * 0.2} rb={Math.min(w, d) * 0.2} len={h * 0.1} c="#F2EEE6" rough={0.4} />
        </group>
      )}
    </group>
  );
}

/** Fruit bowl: shallow bowl + fruit. */
function FruitBowl({ w, d, h }: { w: number; d: number; h: number }) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Cyl p={[0, h * 0.08, 0]} rt={r * 0.4} rb={r * 0.3} len={h * 0.16} c="#8A6A45" rough={0.6} />
      <Cyl p={[0, h * 0.2, 0]} rt={r} rb={r * 0.55} len={h * 0.22} c="#F2EEE6" rough={0.35} />
      <Sph p={[-r * 0.3, h * 0.42, 0]} r={r * 0.3} c="#E8821E" rough={0.5} />
      <Sph p={[r * 0.32, h * 0.4, r * 0.1]} r={r * 0.28} c="#C82020" rough={0.5} />
      <Sph p={[0, h * 0.44, -r * 0.28]} r={r * 0.26} c="#7AB648" rough={0.5} />
    </group>
  );
}

/** Retro / SLR camera: body + lens + prism. */
function CameraMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.42, 0]} s={[w, h * 0.62, d]} c={color} rough={0.45} metal={0.3} />
      {/* Lens */}
      <Cyl p={[0, h * 0.42, d / 2 + 0.01]} rt={Math.min(w, h) * 0.26} rb={Math.min(w, h) * 0.28} len={0.02} rot={[Math.PI / 2, 0, 0]} c="#1A1A1A" rough={0.2} metal={0.6} />
      <Cyl p={[0, h * 0.42, d / 2 + 0.025]} rt={Math.min(w, h) * 0.14} rb={Math.min(w, h) * 0.14} len={0.015} rot={[Math.PI / 2, 0, 0]} c="#0A2A4A" rough={0.1} metal={0.4} e="#16283F" ei={0.4} />
      {/* Top prism + shutter */}
      <Box p={[0, h * 0.82, 0]} s={[w * 0.4, h * 0.18, d * 0.6]} c={shade(color, -15)} rough={0.45} metal={0.3} />
      <Cyl p={[w * 0.32, h * 0.78, 0]} rt={0.012} rb={0.012} len={0.02} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
    </group>
  );
}

/** Phone standing: thin dark slab + lit screen. */
function PhoneMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, Math.max(0.012, d * 0.5)]} c="#1A1A1A" rough={0.3} metal={0.5} />
      <Box p={[0, h * 0.52, d * 0.28]} s={[w * 0.86, h * 0.86, 0.004]} c="#0A1626" rough={0.15} e="#1A3A5A" ei={0.5} cast={false} />
      <Sph p={[0, h * 0.94, d * 0.29]} r={0.006} c="#222" rough={0.3} cast={false} />
    </group>
  );
}

/** Vintage rotary phone: base + handset + dial. */
function VintagePhoneMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.2, 0]} s={[w, h * 0.4, d]} c={color} rough={0.4} />
      {/* Handset lying across the top */}
      <Cyl p={[0, h * 0.48, 0]} rt={0.02} rb={0.02} len={w * 0.8} rot={[0, 0, Math.PI / 2]} c={shade(color, -20)} rough={0.4} />
      <Sph p={[-w * 0.4, h * 0.48, 0]} r={0.028} c={shade(color, -20)} rough={0.4} />
      <Sph p={[w * 0.4, h * 0.48, 0]} r={0.028} c={shade(color, -20)} rough={0.4} />
      {/* Dial */}
      <Cyl p={[0, h * 0.62, d * 0.2]} rt={Math.min(w, d) * 0.26} rb={Math.min(w, d) * 0.26} len={0.012} rot={[Math.PI / 2.4, 0, 0]} c="#F2EEE6" rough={0.4} />
    </group>
  );
}

/** Radio / tape recorder / record player: box + dials; gramophone adds horn. */
function RadioMesh({ item, color, w, d, h }: FallbackProps) {
  const isGramo = /gramophone|留声机/.test(item.id + item.name);
  const isRecord = /record-player|黑胶/.test(item.id + item.name);
  return (
    <group>
      <Box p={[0, h * 0.4, 0]} s={[w, h * 0.8, d]} c={color} rough={0.45} metal={0.15} />
      {/* Speaker grille */}
      <Box p={[-w * 0.22, h * 0.42, d / 2 + 0.002]} s={[w * 0.4, h * 0.5, 0.004]} c="#2A2A2A" rough={0.9} cast={false} />
      {/* Dials */}
      <Cyl p={[w * 0.28, h * 0.55, d / 2 + 0.006]} rt={0.014} rb={0.014} len={0.012} rot={[Math.PI / 2, 0, 0]} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
      <Cyl p={[w * 0.28, h * 0.32, d / 2 + 0.006]} rt={0.011} rb={0.011} len={0.012} rot={[Math.PI / 2, 0, 0]} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
      {isRecord && (
        <group>
          <Cyl p={[0, h * 0.84, 0]} rt={Math.min(w, d) * 0.36} rb={Math.min(w, d) * 0.36} len={0.012} c="#1A1A1A" rough={0.3} />
          <Cyl p={[w * 0.3, h * 0.86, 0]} rt={0.006} rb={0.006} len={0.16} rot={[0, 0, Math.PI / 2.3]} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
        </group>
      )}
      {isGramo && (
        <group>
          <Cone p={[0, h * 0.78, 0]} r={Math.min(w, d) * 0.34} len={h * 0.34} rot={[0, 0, Math.PI]} c="#C8A040" metal={0.7} rough={0.3} />
          <Cyl p={[0, h * 0.86, 0]} rt={Math.min(w, d) * 0.3} rb={Math.min(w, d) * 0.3} len={0.012} c="#1A1A1A" rough={0.3} />
        </group>
      )}
    </group>
  );
}

/** Mandolin: rounded body + neck. */
function MandolinMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Sph p={[0, h * 0.26, 0]} r={Math.min(w, d) * 0.42} s={[1, 0.28, 1.25]} c={color} rough={0.4} />
      <Box p={[0, h * 0.62, 0]} s={[w * 0.16, h * 0.55, d * 0.2]} c={shade(color, -20)} rough={0.5} />
      <Box p={[0, h * 0.94, 0]} s={[w * 0.22, h * 0.12, d * 0.24]} c="#2A2A2A" rough={0.5} />
    </group>
  );
}

/** Globe on a stand, tilted axis. */
function GlobeMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  const r = Math.min(w, d) * 0.42;
  return (
    <group>
      <Cyl p={[0, h * 0.05, 0]} rt={r * 0.7} rb={r * 0.8} len={h * 0.1} c="#8A6A45" rough={0.6} />
      <Cyl p={[0, h * 0.55, 0]} rt={0.008} rb={0.008} len={h * 0.85} rot={[0, 0, 0.4]} c="#C8A040" metal={0.7} rough={0.3} cast={false} />
      <Sph p={[0, h * 0.58, 0]} r={r} c="#3A6EA5" rough={0.5} />
      <Sph p={[-r * 0.3, h * 0.68, r * 0.6]} r={r * 0.28} s={[1, 0.7, 0.5]} c="#4A8038" rough={0.7} cast={false} />
      <Sph p={[r * 0.35, h * 0.48, -r * 0.55]} r={r * 0.22} s={[1, 0.7, 0.5]} c="#4A8038" rough={0.7} cast={false} />
    </group>
  );
}

/** Standing mirror: frame + glass + feet. */
function MirrorMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, Math.max(0.02, d * 0.6)]} c={color} rough={0.4} metal={0.2} />
      <Box p={[0, h * 0.52, d * 0.32]} s={[w * 0.86, h * 0.9, 0.006]} c="#CFE0E8" rough={0.08} metal={0.9} cast={false} />
      <Box p={[-w * 0.32, 0.02, 0]} s={[0.03, 0.04, d * 0.5]} c={shade(color, -20)} rough={0.5} cast={false} />
      <Box p={[w * 0.32, 0.02, 0]} s={[0.03, 0.04, d * 0.5]} c={shade(color, -20)} rough={0.5} cast={false} />
    </group>
  );
}

/** Trash bin / laundry basket: tapered body + rim (+ lid for bins). */
function BinMesh({ item, color, w, d, h }: FallbackProps) {
  const isBin = /trash-bin|bin-|垃圾桶/.test(item.id + item.name);
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Cyl p={[0, h * 0.48, 0]} rt={r * 0.92} rb={r * 0.78} len={h * 0.92} c={color} rough={0.6} />
      <Tor p={[0, h * 0.94, 0]} r={r * 0.9} tube={Math.max(0.006, r * 0.06)} rot={[Math.PI / 2, 0, 0]} c={shade(color, -18)} rough={0.6} cast={false} />
      {isBin && <Cyl p={[0, h * 0.97, 0]} rt={r * 0.95} rb={r * 0.95} len={h * 0.06} c={shade(color, -12)} rough={0.55} />}
      {!isBin && (
        <group>
          <Sph p={[-r * 0.3, h * 0.96, 0]} r={r * 0.3} s={[1, 0.5, 1]} c={shade(color, 20)} rough={0.9} cast={false} />
          <Sph p={[r * 0.32, h * 0.95, r * 0.1]} r={r * 0.26} s={[1, 0.5, 1]} c={shade(color, -10)} rough={0.9} cast={false} />
        </group>
      )}
    </group>
  );
}

/** Suitcase: body + handle + straps. */
function SuitcaseMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.5} />
      <Box p={[0, h * 0.52, d / 2 + 0.002]} s={[w * 0.9, h * 0.82, 0.004]} c={shade(color, -15)} rough={0.55} cast={false} />
      <Box p={[-w * 0.28, h / 2, d / 2 + 0.006]} s={[0.02, h * 0.9, 0.004]} c={shade(color, -30)} rough={0.6} cast={false} />
      <Box p={[w * 0.28, h / 2, d / 2 + 0.006]} s={[0.02, h * 0.9, 0.004]} c={shade(color, -30)} rough={0.6} cast={false} />
      <Box p={[0, h + 0.02, 0]} s={[w * 0.4, 0.03, 0.03]} c="#2A2A2A" rough={0.5} />
    </group>
  );
}

/** Tissue box + a tissue sticking out. */
function TissueMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.42, 0]} s={[w, h * 0.84, d]} c={color} rough={0.6} />
      <Box p={[0, h * 0.86, 0]} s={[w * 0.5, h * 0.06, d * 0.5]} c="#2A2A2A" rough={0.8} cast={false} />
      <Box p={[0, h * 0.95, 0]} s={[w * 0.2, h * 0.14, d * 0.1]} rot={[0, 0, 0.25]} c="#FFFFFF" rough={0.95} cast={false} />
    </group>
  );
}

/** Umbrella stand: tube + umbrella sticks. */
function UmbrellaStandMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Cyl p={[0, h * 0.3, 0]} rt={r} rb={r * 0.85} len={h * 0.6} c={color} rough={0.5} metal={0.3} />
      {[-0.3, 0, 0.3].map((tx, i) => (
        <Cyl key={i} p={[tx * w, h * 0.72, (i - 1) * d * 0.12]} rt={0.008} rb={0.008} len={h * 0.55} rot={[(i - 1) * 0.12, 0, tx * 0.5]} c={["#C82020", "#2A5AA8", "#E8A020"][i]} rough={0.7} />
      ))}
      <Cone p={[0, h * 0.98, 0]} r={0.02} len={0.05} c="#C82020" rough={0.7} cast={false} />
    </group>
  );
}

/** Ottoman / footstool: rounded cushion + short legs. */
function OttomanMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Sph p={[0, h * 0.42, 0]} r={Math.min(w, d) * 0.48} s={[1.25, 0.72, 1.05]} c={color} rough={0.9} />
      {[[-0.32, -0.3], [0.32, -0.3], [-0.32, 0.3], [0.32, 0.3]].map(([lx, lz], i) => (
        <Cyl key={i} p={[lx * w, h * 0.08, lz * d]} rt={0.015} rb={0.015} len={h * 0.16} c="#6A4A30" rough={0.7} cast={false} />
      ))}
    </group>
  );
}

/** Shoe box: flat box + lid. */
function ShoeBoxMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.42, 0]} s={[w, h * 0.84, d]} c={color} rough={0.6} />
      <Box p={[0, h * 0.92, 0]} s={[w * 1.02, h * 0.16, d * 1.02]} c={shade(color, 12)} rough={0.6} />
      <Box p={[0, h * 0.6, d / 2 + 0.002]} s={[w * 0.4, h * 0.2, 0.004]} c="#F2EEE6" rough={0.7} cast={false} />
    </group>
  );
}

/** Treadmill (decor-treadmill): belt + posts + console. */
function TreadmillMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      {/* Belt base */}
      <Box p={[0, h * 0.08, 0]} s={[w * 0.5, h * 0.14, d]} c="#2A2A2A" rough={0.85} />
      <Box p={[0, h * 0.16, 0]} s={[w * 0.42, 0.012, d * 0.92]} c="#444" rough={0.9} cast={false} />
      {/* Front posts */}
      <Cyl p={[-w * 0.2, h * 0.5, d * 0.46]} rt={0.02} rb={0.02} len={h * 0.72} rot={[0.25, 0, 0]} c={color} metal={0.6} rough={0.35} />
      <Cyl p={[w * 0.2, h * 0.5, d * 0.46]} rt={0.02} rb={0.02} len={h * 0.72} rot={[0.25, 0, 0]} c={color} metal={0.6} rough={0.35} />
      {/* Console */}
      <Box p={[0, h * 0.86, d * 0.4]} s={[w * 0.55, h * 0.16, 0.05]} c="#1A1A1A" rough={0.4} />
      <Box p={[0, h * 0.87, d * 0.43]} s={[w * 0.4, h * 0.08, 0.006]} c="#0A1626" rough={0.2} e="#1A3A5A" ei={0.5} cast={false} />
      {/* Handrail */}
      <Cyl p={[0, h * 0.62, d * 0.46]} rt={0.014} rb={0.014} len={w * 0.44} rot={[0, 0, Math.PI / 2]} c={color} metal={0.6} rough={0.35} />
    </group>
  );
}

/** Clock: body + white face + hands. */
function ClockMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.45} />
      <Cyl p={[0, h * 0.62, d / 2 + 0.004]} rt={Math.min(w, h) * 0.32} rb={Math.min(w, h) * 0.32} len={0.01} rot={[Math.PI / 2, 0, 0]} c="#F8F4E8" rough={0.4} cast={false} />
      <Box p={[0, h * 0.66, d / 2 + 0.01]} s={[0.006, h * 0.14, 0.004]} c="#1A1A1A" rough={0.5} cast={false} />
      <Box p={[0.01, h * 0.62, d / 2 + 0.01]} s={[0.006, h * 0.1, 0.004]} rot={[0, 0, -1.1]} c="#1A1A1A" rough={0.5} cast={false} />
      <Sph p={[0, h + 0.01, 0]} r={Math.min(w, d) * 0.08} c="#C8A040" metal={0.7} rough={0.3} cast={false} />
    </group>
  );
}

/** Telescope: tube on a tripod. */
function TelescopeMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Cyl p={[0, h * 0.68, 0]} rt={Math.min(w, d) * 0.12} rb={Math.min(w, d) * 0.09} len={h * 0.5} rot={[0.5, 0, 0]} c={color} metal={0.5} rough={0.35} />
      <Cyl p={[0, h * 0.92, 0.1 * h]} rt={0.02} rb={0.02} len={0.05} rot={[0.5, 0, 0]} c="#1A1A1A" rough={0.3} cast={false} />
      {[-0.5, 0.5, 0].map((tx, i) => (
        <Cyl key={i} p={[tx * w * 0.5, h * 0.24, i === 2 ? -d * 0.2 : d * 0.14]} rt={0.008} rb={0.008} len={h * 0.5} rot={[i === 2 ? -0.3 : 0.3, 0, tx * 0.6]} c="#3A3A3A" metal={0.6} rough={0.4} />
      ))}
    </group>
  );
}

/** Hammer / pen / gift / wall shelf — small specific shapes. */
function HammerMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Cyl p={[0, h * 0.5, 0]} rt={0.012} rb={0.012} len={h * 0.85} c="#8A6A45" rough={0.7} />
      <Box p={[0, h * 0.92, 0]} s={[w * 0.8, h * 0.14, d * 0.8]} c="#3A3A3A" metal={0.6} rough={0.4} />
    </group>
  );
}
function PenMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Cyl p={[0, h / 2, 0]} rt={Math.min(w, d) * 0.3} rb={Math.min(w, d) * 0.3} len={h * 0.85} rot={[0, 0, Math.PI / 2]} c="#1A1A1A" metal={0.4} rough={0.35} />
      <Cone p={[w * 0.48, h / 2, 0]} r={Math.min(w, d) * 0.3} len={w * 0.18} rot={[0, 0, -Math.PI / 2]} c="#C8A040" metal={0.8} rough={0.25} />
    </group>
  );
}
function GiftMesh({ color, sc, w, d, h }: { color: string; sc?: string; w: number; d: number; h: number }) {
  const ribbon = sc ?? "#C82020";
  return (
    <group>
      <Box p={[0, h * 0.4, 0]} s={[w, h * 0.8, d]} c={color} rough={0.6} />
      <Box p={[0, h * 0.4, 0]} s={[w * 0.14, h * 0.82, d * 1.01]} c={ribbon} rough={0.55} cast={false} />
      <Box p={[0, h * 0.4, 0]} s={[w * 1.01, h * 0.82, d * 0.14]} c={ribbon} rough={0.55} cast={false} />
      <Box p={[0, h * 0.86, 0]} s={[w * 1.04, h * 0.12, d * 1.04]} c={shade(color, -12)} rough={0.6} />
      <Tor p={[0, h * 0.96, 0]} r={Math.min(w, d) * 0.16} tube={0.012} rot={[Math.PI / 2.3, 0, 0.4]} c={ribbon} rough={0.5} cast={false} />
    </group>
  );
}
function WallShelfMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.55, 0]} s={[w, h * 0.08, d]} c={color} rough={0.5} />
      <Box p={[-w * 0.32, h * 0.3, 0]} s={[0.02, h * 0.5, d * 0.7]} c={shade(color, -25)} rough={0.55} cast={false} />
      <Box p={[w * 0.32, h * 0.3, 0]} s={[0.02, h * 0.5, d * 0.7]} c={shade(color, -25)} rough={0.55} cast={false} />
      <Cyl p={[-w * 0.25, h * 0.66, 0]} rt={0.02} rb={0.016} len={h * 0.12} c="#7AB648" rough={0.7} cast={false} />
      <Box p={[w * 0.22, h * 0.66, 0]} s={[w * 0.3, h * 0.14, d * 0.6]} c="#5A6A7A" rough={0.7} cast={false} />
    </group>
  );
}

/** Standing / wall sign boards: framed board (+ legs for A-frame). */
function SignMesh({ item, color, w, d, h }: FallbackProps) {
  const isAFrame = /aframe|A字|wet-floor|地滑/.test(item.id + item.name);
  const isWhite = /whiteboard|白板/.test(item.id + item.name);
  const isBlack = /blackboard|黑板|menu|菜单|chalkboard/.test(item.id + item.name);
  const boardColor = isWhite ? "#F8F8F8" : isBlack ? "#2A3230" : color;
  return (
    <group>
      {isAFrame ? (
        <group>
          <Box p={[0, h * 0.5, -d * 0.12]} s={[w, h, 0.02]} rot={[0.22, 0, 0]} c={boardColor} rough={0.6} />
          <Box p={[0, h * 0.5, d * 0.12]} s={[w, h, 0.02]} rot={[-0.22, 0, 0]} c={shade(boardColor, -8)} rough={0.6} />
          <Box p={[0, h * 0.88, 0]} s={[w * 0.9, 0.02, d * 0.3]} c={shade(color, -20)} rough={0.6} cast={false} />
        </group>
      ) : (
        <group>
          {/* Legs / stand for floor-standing boards */}
          {h > 0.8 && (
            <group>
              <Cyl p={[-w * 0.32, h * 0.2, 0]} rt={0.012} rb={0.012} len={h * 0.42} c="#3A3A3A" metal={0.6} rough={0.4} />
              <Cyl p={[w * 0.32, h * 0.2, 0]} rt={0.012} rb={0.012} len={h * 0.42} c="#3A3A3A" metal={0.6} rough={0.4} />
              <Box p={[0, h * 0.42, 0]} s={[w * 0.8, 0.025, 0.04]} c="#3A3A3A" metal={0.5} rough={0.45} cast={false} />
            </group>
          )}
          {/* Board + frame */}
          <Box p={[0, h * 0.62, 0]} s={[w, h * 0.72, Math.max(0.02, d * 0.5)]} c={shade(color, -20)} rough={0.5} />
          <Box p={[0, h * 0.62, d * 0.28]} s={[w * 0.9, h * 0.62, 0.008]} c={boardColor} rough={isBlack ? 0.9 : 0.35} cast={false} />
          {/* Chalk / marker lines */}
          {isBlack && (
            <group>
              <Box p={[-w * 0.1, h * 0.74, d * 0.29]} s={[w * 0.5, 0.012, 0.002]} c="#E8E8E8" rough={0.9} cast={false} />
              <Box p={[-w * 0.16, h * 0.6, d * 0.29]} s={[w * 0.38, 0.012, 0.002]} c="#E8E8E8" rough={0.9} cast={false} />
              <Box p={[-w * 0.05, h * 0.48, d * 0.29]} s={[w * 0.6, 0.012, 0.002]} c="#E8E8E8" rough={0.9} cast={false} />
            </group>
          )}
        </group>
      )}
    </group>
  );
}

/** Cross: two crossed beams. */
function CrossMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.5, 0]} s={[w * 0.22, h, d * 0.5]} c="#6A4A30" rough={0.7} />
      <Box p={[0, h * 0.68, 0]} s={[w, h * 0.16, d * 0.5]} c="#6A4A30" rough={0.7} />
    </group>
  );
}

/** Oil / kerosene lamp: base + glass chimney + flame. */
function OilLampMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Cyl p={[0, h * 0.1, 0]} rt={r * 0.9} rb={r} len={h * 0.2} c={color} rough={0.4} metal={0.4} />
      <Cyl p={[0, h * 0.48, 0]} rt={r * 0.62} rb={r * 0.72} len={h * 0.56} c="#D8E8E8" rough={0.1} o={0.45} />
      <Cone p={[0, h * 0.82, 0]} r={r * 0.22} len={h * 0.22} c="#FFB347" rough={0.4} e="#FF9800" ei={1.2} />
      <Cyl p={[0, h * 0.22, 0]} rt={0.012} rb={0.012} len={h * 0.1} c="#2A2A2A" rough={0.5} cast={false} />
    </group>
  );
}

/** Grain sheaf: bundle of stalks + tie band. */
function SheafMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  const stalks = [-0.3, -0.15, 0, 0.15, 0.3];
  return (
    <group>
      {stalks.map((tx, i) => (
        <Cyl key={i} p={[tx * w, h * 0.5, ((i * 37) % 3 - 1) * d * 0.14]} rt={0.006} rb={0.008} len={h * 0.94} rot={[((i * 37) % 3 - 1) * 0.08, 0, tx * 0.55]} c={shade(color, (i % 2 === 0 ? 8 : -8))} rough={0.9} />
      ))}
      <Cyl p={[0, h * 0.42, 0]} rt={Math.min(w, d) * 0.32} rb={Math.min(w, d) * 0.32} len={h * 0.05} c="#8A6A45" rough={0.85} />
      {stalks.map((tx, i) => (
        <Sph key={i} p={[tx * w * 1.25, h * 0.96, ((i * 37) % 3 - 1) * d * 0.16]} r={0.016} s={[1, 1.6, 1]} c={shade(color, 14)} rough={0.9} cast={false} />
      ))}
    </group>
  );
}

/** Broom: stick + bristle head. */
function BroomMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Cyl p={[0, h * 0.58, 0]} rt={0.012} rb={0.012} len={h * 0.8} c="#8A6A45" rough={0.75} />
      <Box p={[0, h * 0.12, 0]} s={[w * 0.9, h * 0.22, d * 0.7]} c="#C8A860" rough={0.9} />
      <Box p={[0, h * 0.24, 0]} s={[w * 0.5, h * 0.04, d * 0.5]} c="#6A4A30" rough={0.8} cast={false} />
    </group>
  );
}

/** IV stand: pole + cross base + hanging bag. */
function IvStandMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, 0.02, 0]} s={[w * 0.8, 0.04, 0.03]} c="#888" metal={0.7} rough={0.35} />
      <Box p={[0, 0.02, 0]} s={[0.03, 0.04, d * 0.8]} c="#888" metal={0.7} rough={0.35} />
      <Cyl p={[0, h * 0.5, 0]} rt={0.012} rb={0.012} len={h * 0.94} c="#AAAAAA" metal={0.8} rough={0.3} />
      <Cyl p={[0, h * 0.97, 0]} rt={0.008} rb={0.008} len={w * 0.4} rot={[0, 0, Math.PI / 2]} c="#AAAAAA" metal={0.8} rough={0.3} cast={false} />
      <Box p={[w * 0.16, h * 0.88, 0]} s={[w * 0.2, h * 0.14, d * 0.3]} c="#E8F0F0" rough={0.3} o={0.7} />
    </group>
  );
}

/** Thermos: body + cap + handle. */
function ThermosMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Cyl p={[0, h * 0.45, 0]} rt={r * 0.9} rb={r} len={h * 0.85} c={color} rough={0.35} metal={0.3} />
      <Cyl p={[0, h * 0.94, 0]} rt={r * 0.55} rb={r * 0.6} len={h * 0.1} c={shade(color, -25)} rough={0.4} />
      <Box p={[r * 0.95, h * 0.5, 0]} s={[0.012, h * 0.5, 0.03]} c="#2A2A2A" rough={0.5} cast={false} />
    </group>
  );
}

/** Basin: shallow bowl. */
function BasinMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Cyl p={[0, h * 0.4, 0]} rt={r} rb={r * 0.7} len={h * 0.8} c={color} rough={0.4} />
      <Tor p={[0, h * 0.8, 0]} r={r * 0.96} tube={Math.max(0.005, r * 0.05)} rot={[Math.PI / 2, 0, 0]} c={shade(color, -15)} rough={0.4} cast={false} />
      <Cyl p={[0, h * 0.72, 0]} rt={r * 0.85} rb={r * 0.85} len={0.008} c="#B8D8E8" rough={0.15} cast={false} />
    </group>
  );
}

/** Mirror wall: big panel + frame. */
function MirrorWallMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, Math.max(0.02, d * 0.5)]} c="#6A4A30" rough={0.5} />
      <Box p={[0, h * 0.52, d * 0.28]} s={[w * 0.92, h * 0.92, 0.006]} c="#CFE0E8" rough={0.08} metal={0.9} cast={false} />
    </group>
  );
}

/** Tokonoma alcove: posts + beam + hanging scroll + tiny vase. */
function TokonomaMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.94, 0]} s={[w, h * 0.08, d]} c="#6A4A30" rough={0.6} />
      <Cyl p={[-w * 0.44, h * 0.48, 0]} rt={0.02} rb={0.02} len={h * 0.88} c="#6A4A30" rough={0.6} />
      <Cyl p={[w * 0.44, h * 0.48, 0]} rt={0.02} rb={0.02} len={h * 0.88} c="#6A4A30" rough={0.6} />
      <Box p={[0, h * 0.62, d * 0.1]} s={[w * 0.34, h * 0.5, 0.015]} c="#F2EEE6" rough={0.9} />
      <Box p={[0, h * 0.62, d * 0.11]} s={[w * 0.06, h * 0.3, 0.004]} c="#2A2A2A" rough={0.9} cast={false} />
      <Cyl p={[w * 0.3, h * 0.12, 0]} rt={0.03} rb={0.024} len={h * 0.2} c="#3A5A3A" rough={0.5} />
      <Sph p={[w * 0.3, h * 0.26, 0]} r={0.02} s={[1, 1.3, 1]} c="#7AB648" rough={0.8} cast={false} />
    </group>
  );
}

/** Shoji screen: frame + lattice + paper. */
function ShojiMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, Math.max(0.015, d * 0.4)]} c="#F5F0E0" rough={0.9} o={0.92} />
      {/* Frame */}
      <Box p={[0, h * 0.98, 0]} s={[w, h * 0.04, d * 0.6]} c="#6A4A30" rough={0.6} />
      <Box p={[0, h * 0.02, 0]} s={[w, h * 0.04, d * 0.6]} c="#6A4A30" rough={0.6} />
      <Box p={[-w * 0.48, h / 2, 0]} s={[w * 0.04, h, d * 0.6]} c="#6A4A30" rough={0.6} />
      <Box p={[w * 0.48, h / 2, 0]} s={[w * 0.04, h, d * 0.6]} c="#6A4A30" rough={0.6} />
      {/* Lattice */}
      {[-0.25, 0, 0.25].map((fx, i) => (
        <Box key={i} p={[fx * w, h / 2, 0]} s={[0.012, h * 0.94, d * 0.45]} c="#8A6A45" rough={0.7} cast={false} />
      ))}
      {[0.3, 0.62].map((fy, i) => (
        <Box key={i} p={[0, fy * h, 0]} s={[w * 0.94, 0.012, d * 0.45]} c="#8A6A45" rough={0.7} cast={false} />
      ))}
    </group>
  );
}

/** Floor cushion: flattened rounded form. */
function FloorCushionMesh({ color, sc, w, d, h }: { color: string; sc?: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Sph p={[0, h * 0.45, 0]} r={Math.min(w, d) * 0.48} s={[1.15, 0.5, 1]} c={color} rough={0.95} />
      <Sph p={[0, h * 0.78, 0]} r={Math.min(w, d) * 0.36} s={[1.1, 0.4, 0.95]} c={sc ?? shade(color, 16)} rough={0.95} />
    </group>
  );
}

/** Wedding arch: two posts + flowered arch. */
function WeddingArchMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  const r = w * 0.46;
  return (
    <group>
      <Cyl p={[-w * 0.46, h * 0.42, 0]} rt={0.03} rb={0.035} len={h * 0.84} c="#F2EEE6" rough={0.6} />
      <Cyl p={[w * 0.46, h * 0.42, 0]} rt={0.03} rb={0.035} len={h * 0.84} c="#F2EEE6" rough={0.6} />
      <Tor p={[0, h * 0.84, 0]} r={r} tube={0.025} rot={[0, 0, 0]} c="#F2EEE6" rough={0.6} />
      {/* Flower clusters along the arch */}
      {[-0.9, -0.45, 0, 0.45, 0.9].map((a, i) => (
        <Sph key={i} p={[Math.sin(a) * r, h * 0.84 + Math.cos(a) * r * 0.9, 0]} r={0.035} c={i % 2 === 0 ? "#E8A0B0" : "#FFFFFF"} rough={0.7} cast={false} />
      ))}
      <Sph p={[-w * 0.46, h * 0.88, 0]} r={0.04} c={color} rough={0.7} cast={false} />
      <Sph p={[w * 0.46, h * 0.88, 0]} r={0.04} c={color} rough={0.7} cast={false} />
    </group>
  );
}

/** Street lamp (decor): pole + lantern head. */
function StreetLampMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Cyl p={[0, h * 0.06, 0]} rt={0.05} rb={0.06} len={h * 0.12} c="#2A2A2A" metal={0.6} rough={0.4} />
      <Cyl p={[0, h * 0.5, 0]} rt={0.02} rb={0.025} len={h * 0.8} c="#2A2A2A" metal={0.7} rough={0.35} />
      <Box p={[0, h * 0.93, 0]} s={[w * 0.4, h * 0.1, d * 0.7]} c="#1A1A1A" metal={0.6} rough={0.4} />
      <Box p={[0, h * 0.93, 0]} s={[w * 0.3, h * 0.07, d * 0.55]} c="#FFE8B0" rough={0.3} e="#FFE8B0" ei={0.7} cast={false} />
      <Cone p={[0, h * 0.99, 0]} r={Math.min(w, d) * 0.26} len={h * 0.06} seg={4} c="#1A1A1A" metal={0.6} rough={0.4} />
    </group>
  );
}

/** Banner flag on a pole. */
function BannerMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Cyl p={[0, h * 0.5, 0]} rt={0.012} rb={0.012} len={h} c="#8A6A45" rough={0.7} />
      <Sph p={[0, h + 0.01, 0]} r={0.018} c="#C8A040" metal={0.7} rough={0.3} cast={false} />
      <Box p={[w * 0.28, h * 0.78, 0]} s={[w * 0.56, h * 0.34, 0.006]} c={color} rough={0.75} />
      <Box p={[w * 0.28, h * 0.88, 0]} s={[w * 0.5, 0.012, 0.002]} c="#F2EEE6" rough={0.8} cast={false} />
    </group>
  );
}

/** Stone lantern: stacked base + pillar + light box + roof. */
function StoneLanternMesh({ w, d, h }: { w: number; d: number; h: number }) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Box p={[0, h * 0.05, 0]} s={[w * 0.9, h * 0.1, d * 0.9]} c="#9A958C" rough={0.95} />
      <Box p={[0, h * 0.3, 0]} s={[w * 0.34, h * 0.4, d * 0.34]} c="#9A958C" rough={0.95} />
      <Box p={[0, h * 0.56, 0]} s={[w * 0.7, h * 0.08, d * 0.7]} c="#8A8580" rough={0.95} />
      <Box p={[0, h * 0.7, 0]} s={[w * 0.52, h * 0.2, d * 0.52]} c="#7A7570" rough={0.95} />
      <Box p={[0, h * 0.7, d * 0.27]} s={[w * 0.3, h * 0.12, 0.006]} c="#FFE8B0" rough={0.4} e="#FFE8B0" ei={0.6} cast={false} />
      <Cone p={[0, h * 0.9, 0]} r={r * 0.95} len={h * 0.2} seg={4} c="#8A8580" rough={0.95} />
      <Sph p={[0, h + 0.005, 0]} r={r * 0.16} c="#9A958C" rough={0.95} cast={false} />
    </group>
  );
}

/** Spear: long pole + metal tip. */
function SpearMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Cyl p={[0, h * 0.42, 0]} rt={0.012} rb={0.012} len={h * 0.84} c="#8A6A45" rough={0.7} />
      <Cone p={[0, h * 0.93, 0]} r={Math.min(w, d) * 0.3} len={h * 0.14} c="#C8C8C8" metal={0.85} rough={0.25} />
      <Cyl p={[0, h * 0.82, 0]} rt={0.02} rb={0.02} len={h * 0.05} c="#C8A040" metal={0.7} rough={0.3} cast={false} />
    </group>
  );
}

/** Rubble pile: cluster of gray rocks. */
function RubbleMesh({ w, d, h }: { w: number; d: number; h: number }) {
  const rocks: Array<{ p: V3; r: number; c: string }> = [
    { p: [0, h * 0.2, 0], r: Math.min(w, d) * 0.3, c: "#8A8580" },
    { p: [-w * 0.28, h * 0.14, d * 0.1], r: Math.min(w, d) * 0.22, c: "#7A7570" },
    { p: [w * 0.26, h * 0.16, -d * 0.12], r: Math.min(w, d) * 0.2, c: "#9A958C" },
    { p: [w * 0.08, h * 0.42, d * 0.06], r: Math.min(w, d) * 0.18, c: "#6A6560" },
    { p: [-w * 0.1, h * 0.36, -d * 0.16], r: Math.min(w, d) * 0.15, c: "#8A8580" },
  ];
  return (
    <group>
      {rocks.map((rk, i) => (
        <Rock key={i} p={rk.p} r={rk.r} c={rk.c} rot={[i * 0.7, i * 1.3, i * 0.4]} />
      ))}
    </group>
  );
}

/** Cobweb: radial threads + faint sheet. */
function CobwebMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, 0.004]} c="#FFFFFF" rough={0.9} o={0.1} cast={false} />
      {[-0.5, 0, 0.5].map((a, i) => (
        <Cyl key={i} p={[0, h / 2, 0.004]} rt={0.0015} rb={0.0015} len={Math.hypot(w, h)} rot={[0, 0, a]} c="#E8E8E8" rough={0.9} cast={false} />
      ))}
      <Tor p={[0, h * 0.3, 0.005]} r={Math.min(w, h) * 0.22} tube={0.0015} c="#E8E8E8" rough={0.9} cast={false} />
    </group>
  );
}

/** Collapsed wall segment: stepped-top blocks. */
function BrokenWallMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[-w * 0.26, h * 0.34, 0]} s={[w * 0.46, h * 0.68, d]} c={color} rough={0.9} />
      <Box p={[w * 0.26, h * 0.2, 0]} s={[w * 0.46, h * 0.4, d]} c={shade(color, -12)} rough={0.9} />
      <Box p={[-w * 0.26, h * 0.72, 0]} s={[w * 0.3, h * 0.08, d * 0.9]} c={shade(color, -20)} rough={0.95} cast={false} />
    </group>
  );
}

/** Lantern pole: pole + crossarm + hanging lanterns. */
function LanternPoleMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Cyl p={[0, h * 0.5, 0]} rt={0.016} rb={0.02} len={h} c="#8A3A20" rough={0.7} />
      <Cyl p={[0, h * 0.9, 0]} rt={0.01} rb={0.01} len={w * 0.7} rot={[0, 0, Math.PI / 2]} c="#8A3A20" rough={0.7} />
      {[-0.3, 0.3].map((tx, i) => (
        <group key={i}>
          <Cyl p={[tx * w, h * 0.86, 0]} rt={0.004} rb={0.004} len={h * 0.07} c="#333" rough={0.8} cast={false} />
          <Sph p={[tx * w, h * 0.78, 0]} r={Math.min(w, d) * 0.16} s={[1, 1.25, 1]} c="#C82020" rough={0.6} e="#801010" ei={0.5} />
          <Cyl p={[tx * w, h * 0.88, 0]} rt={0.02} rb={0.02} len={0.015} c="#D4A030" metal={0.7} rough={0.35} cast={false} />
        </group>
      ))}
    </group>
  );
}

/** Roman column: base + fluted-ish shaft + capital. */
function RomanColumnMesh({ w, d, h }: { w: number; d: number; h: number }) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Box p={[0, h * 0.04, 0]} s={[w * 0.95, h * 0.08, d * 0.95]} c="#D8D2C4" rough={0.85} />
      <Cyl p={[0, h * 0.5, 0]} rt={r * 0.72} rb={r * 0.8} len={h * 0.8} seg={20} c="#E8E2D4" rough={0.8} />
      <Box p={[0, h * 0.92, 0]} s={[w * 0.95, h * 0.07, d * 0.95]} c="#D8D2C4" rough={0.85} />
      <Box p={[0, h * 0.97, 0]} s={[w, h * 0.05, d]} c="#CFC8B8" rough={0.85} />
    </group>
  );
}

/** Fallen column: column lying on its side. */
function FallenColumnMesh({ w, d, h }: { w: number; d: number; h: number }) {
  const r = Math.min(d, h) / 2;
  return (
    <group>
      <Cyl p={[0, r * 0.9, 0]} rt={r * 0.85} rb={r * 0.85} len={w * 0.9} rot={[0, 0, Math.PI / 2]} seg={20} c="#E8E2D4" rough={0.85} />
      <Cyl p={[-w * 0.46, r * 0.9, 0]} rt={r} rb={r} len={0.03} rot={[0, 0, Math.PI / 2]} c="#D8D2C4" rough={0.85} />
      <Cyl p={[w * 0.46, r * 0.9, 0]} rt={r} rb={r} len={0.03} rot={[0, 0, Math.PI / 2]} c="#D8D2C4" rough={0.85} />
    </group>
  );
}

/** Stone well: ring + posts + gable roof + bucket. */
function StoneWellMesh({ w, d, h }: { w: number; d: number; h: number }) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Cyl p={[0, h * 0.2, 0]} rt={r * 0.95} rb={r} len={h * 0.4} seg={20} c="#9A958C" rough={0.95} />
      <Cyl p={[0, h * 0.4, 0]} rt={r * 0.8} rb={r * 0.8} len={0.012} c="#1A2A3A" rough={0.2} cast={false} />
      <Cyl p={[-r * 0.85, h * 0.62, 0]} rt={0.02} rb={0.02} len={h * 0.5} c="#6A4A30" rough={0.7} />
      <Cyl p={[r * 0.85, h * 0.62, 0]} rt={0.02} rb={0.02} len={h * 0.5} c="#6A4A30" rough={0.7} />
      <Box p={[0, h * 0.92, 0]} s={[w * 1.05, 0.03, d * 0.4]} rot={[0, 0, 0.28]} c="#8A6A45" rough={0.8} />
      <Box p={[0, h * 0.92, 0]} s={[w * 1.05, 0.03, d * 0.4]} rot={[0, 0, -0.28]} c="#8A6A45" rough={0.8} />
      <Cyl p={[0, h * 0.82, 0]} rt={0.012} rb={0.012} len={w * 1.5} rot={[0, 0, Math.PI / 2]} c="#6A4A30" rough={0.7} cast={false} />
      <Cyl p={[r * 0.3, h * 0.62, 0]} rt={0.05} rb={0.045} len={0.09} c="#8A6A45" rough={0.7} />
    </group>
  );
}

/** Burnt beam: charred, slightly tilted. */
function BurntBeamMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.5, 0]} s={[w, h, d]} rot={[0, 0, 0.1]} c="#1A1512" rough={0.98} />
      <Sph p={[w * 0.2, h * 0.62, d * 0.2]} r={0.012} c="#FF6A00" rough={0.5} e="#FF5500" ei={1.4} cast={false} />
      <Sph p={[-w * 0.15, h * 0.5, -d * 0.18]} r={0.009} c="#FF6A00" rough={0.5} e="#FF5500" ei={1.2} cast={false} />
    </group>
  );
}

/** Taihu rock: cluster of gray rocks. */
function RockeryMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Rock p={[0, h * 0.42, 0]} r={Math.min(w, d) * 0.34} c="#8A8580" rot={[0.4, 0.8, 0.2]} s={[0.9, 1.3, 0.8]} />
      <Rock p={[-w * 0.3, h * 0.22, d * 0.12]} r={Math.min(w, d) * 0.24} c="#7A7570" rot={[0.9, 0.3, 1.1]} />
      <Rock p={[w * 0.28, h * 0.18, -d * 0.1]} r={Math.min(w, d) * 0.2} c="#9A958C" rot={[0.2, 1.5, 0.6]} />
    </group>
  );
}

/** Fan / lattice window: frame + lattice bars + paper backing. */
function LatticeWindowMesh({ item, w, d, h }: FallbackProps) {
  const isFan = /fan-window|扇窗/.test(item.id + item.name);
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, 0.008]} c="#F5F0E0" rough={0.9} o={0.85} cast={false} />
      <Box p={[0, h * 0.98, 0]} s={[w, h * 0.04, d]} c="#6A4A30" rough={0.6} />
      <Box p={[0, h * 0.02, 0]} s={[w, h * 0.04, d]} c="#6A4A30" rough={0.6} />
      <Box p={[-w * 0.48, h / 2, 0]} s={[w * 0.04, h, d]} c="#6A4A30" rough={0.6} />
      <Box p={[w * 0.48, h / 2, 0]} s={[w * 0.04, h, d]} c="#6A4A30" rough={0.6} />
      {isFan ? (
        <group>
          {[-0.5, -0.25, 0, 0.25, 0.5].map((a, i) => (
            <Box key={i} p={[Math.sin(a) * w * 0.42, h * 0.32 + Math.cos(a) * h * 0.2, 0]} s={[0.014, h * 0.5, d * 0.7]} rot={[0, 0, -a * 0.9]} c="#8A6A45" rough={0.7} cast={false} />
          ))}
          <Tor p={[0, h * 0.28, 0]} r={w * 0.2} tube={0.012} c="#8A6A45" rough={0.7} cast={false} />
        </group>
      ) : (
        <group>
          {[-0.25, 0, 0.25].map((fx, i) => (
            <Box key={i} p={[fx * w, h / 2, 0]} s={[0.014, h * 0.94, d * 0.7]} c="#8A6A45" rough={0.7} cast={false} />
          ))}
          {[0.33, 0.66].map((fy, i) => (
            <Box key={i} p={[0, fy * h, 0]} s={[w * 0.94, 0.014, d * 0.7]} c="#8A6A45" rough={0.7} cast={false} />
          ))}
        </group>
      )}
    </group>
  );
}

/** Pedestal / display stand. */
function PedestalMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.04, 0]} s={[w * 0.9, h * 0.08, d * 0.9]} c={shade(color, -15)} rough={0.6} metal={0.2} />
      <Box p={[0, h * 0.48, 0]} s={[w * 0.55, h * 0.8, d * 0.55]} c={color} rough={0.55} metal={0.25} />
      <Box p={[0, h * 0.92, 0]} s={[w * 0.95, h * 0.08, d * 0.95]} c={shade(color, 10)} rough={0.55} metal={0.2} />
    </group>
  );
}

/** Kitchen cluster: pots + rack. */
function KitchenClusterMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.05, 0]} s={[w, h * 0.1, d]} c="#6A4A30" rough={0.6} />
      <Cyl p={[-w * 0.26, h * 0.3, 0]} rt={Math.min(w, d) * 0.2} rb={Math.min(w, d) * 0.17} len={h * 0.4} c={shade(color, -10)} metal={0.5} rough={0.35} />
      <Cyl p={[w * 0.1, h * 0.26, d * 0.08]} rt={Math.min(w, d) * 0.16} rb={Math.min(w, d) * 0.14} len={h * 0.32} c={color} metal={0.6} rough={0.3} />
      <Cyl p={[w * 0.32, h * 0.36, -d * 0.1]} rt={0.012} rb={0.012} len={h * 0.6} rot={[0.2, 0, 0.15]} c="#8A6A45" rough={0.7} cast={false} />
      <Box p={[w * 0.32, h * 0.72, -d * 0.12]} s={[0.02, 0.02, d * 0.3]} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
    </group>
  );
}

/** Whole-scene decor items (bathroom-scene / kids-room): mini room mockup. */
function SceneMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      {/* Floor slab */}
      <Box p={[0, 0.015, 0]} s={[w, 0.03, d]} c="#D8D2C4" rough={0.85} />
      {/* Back wall */}
      <Box p={[0, h * 0.45, -d * 0.48]} s={[w, h * 0.9, 0.03]} c="#F2EEE6" rough={0.9} />
      {/* Fixture 1: tub / bed */}
      <Box p={[-w * 0.22, h * 0.14, -d * 0.2]} s={[w * 0.4, h * 0.26, d * 0.4]} c="#FFFFFF" rough={0.4} />
      <Box p={[-w * 0.22, h * 0.26, -d * 0.2]} s={[w * 0.34, 0.02, d * 0.34]} c="#B8D8E8" rough={0.2} cast={false} />
      {/* Fixture 2: vanity / desk */}
      <Box p={[w * 0.26, h * 0.2, -d * 0.22]} s={[w * 0.3, h * 0.38, d * 0.34]} c="#8A6A45" rough={0.6} />
      <Box p={[w * 0.26, h * 0.4, -d * 0.22]} s={[w * 0.28, 0.015, d * 0.3]} c="#F2EEE6" rough={0.4} cast={false} />
    </group>
  );
}

/** Stall partition / door: thin panel + frame + handle. */
function StallMesh({ item, color, w, d, h }: FallbackProps) {
  const isDoor = /stall-door|隔间门/.test(item.id + item.name);
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, Math.max(0.015, d * 0.4)]} c={color} rough={0.6} />
      <Box p={[0, h * 0.98, 0]} s={[w, h * 0.04, d * 0.6]} c={shade(color, -20)} rough={0.55} />
      <Box p={[0, h * 0.02, 0]} s={[w, h * 0.04, d * 0.6]} c={shade(color, -20)} rough={0.55} />
      {isDoor && (
        <group>
          <Cyl p={[w * 0.32, h * 0.5, d * 0.26]} rt={0.012} rb={0.012} len={0.09} rot={[Math.PI / 2, 0, 0]} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
          <Box p={[0, h * 0.88, d * 0.22]} s={[w * 0.3, h * 0.05, 0.006]} c="#C82020" rough={0.6} cast={false} />
        </group>
      )}
    </group>
  );
}

/** Generic decor fallback — two-part object, NEVER one solid box.
 *  Tall thin items read as a vessel; low wide items read as an object
 *  on a plinth with an accent piece. */
function GenericDecorMesh({ color, sc, w, d, h }: { color: string; sc?: string; w: number; d: number; h: number }) {
  const tall = h > 1.6 * Math.max(w, d);
  if (tall) {
    const r = Math.min(w, d) / 2;
    return (
      <group>
        <Cyl p={[0, h * 0.04, 0]} rt={r * 0.7} rb={r * 0.8} len={h * 0.08} c={shade(color, -15)} rough={0.5} />
        <Cyl p={[0, h * 0.45, 0]} rt={r * 0.85} rb={r * 0.7} len={h * 0.68} c={color} rough={0.45} />
        <Sph p={[0, h * 0.82, 0]} r={r * 0.55} s={[1, 0.7, 1]} c={shade(color, 12)} rough={0.45} />
        <Cyl p={[0, h * 0.93, 0]} rt={r * 0.3} rb={r * 0.4} len={h * 0.12} c={sc ?? shade(color, -20)} rough={0.4} />
      </group>
    );
  }
  return (
    <group>
      {/* Plinth */}
      <Box p={[0, h * 0.07, 0]} s={[w * 0.86, h * 0.14, d * 0.86]} c={shade(color, -22)} rough={0.6} />
      {/* Main rounded form */}
      <Sph p={[0, h * 0.5, 0]} r={Math.min(w, d) * 0.4} s={[1.15, 0.85, 0.95]} c={color} rough={0.55} />
      {/* Accent */}
      <Sph p={[w * 0.18, h * 0.82, d * 0.1]} r={Math.min(w, d) * 0.14} c={sc ?? shade(color, 22)} rough={0.5} cast={false} />
      <Cyl p={[-w * 0.2, h * 0.3, d * 0.18]} rt={0.012} rb={0.012} len={h * 0.3} rot={[0, 0, 0.4]} c={shade(color, -30)} rough={0.6} cast={false} />
    </group>
  );
}

/** Vase group: three small vases in a row. */
function VaseSetMesh({ color, sc, w, d, h }: { color: string; sc?: string; w: number; d: number; h: number }) {
  const cols = [color, sc ?? shade(color, 18), shade(color, -14)];
  return (
    <group>
      {[-0.32, 0, 0.32].map((fx, i) => (
        <group key={i} position={[fx * w, 0, 0]}>
          <VaseBody w={w * 0.3} d={d * 0.8} h={h * (0.85 + (i % 2) * 0.15)} bodyColor={cols[i % 3]} />
        </group>
      ))}
    </group>
  );
}

export function DecorMesh({ item, color, sc, w, d, h }: FallbackProps) {
  const id = item.id;
  const name = item.name;
  const has = (...keys: string[]) => keys.some((k) => id.includes(k) || name.includes(k));
  const p = { color, sc, w, d, h };

  if (id === "decor-tulip") return <TulipVase color={color} w={w} d={d} h={h} />;
  if (has("vase-set", "花瓶组")) return <VaseSetMesh {...p} />;
  if (has("boshanlu", "博山炉")) return <VaseBody w={w} d={d} h={h * 0.7} bodyColor={color} />;
  if (has("vase", "花瓶", "青花", "青瓷", "彩陶", "黑陶", "大缸", "梅瓶")) return <VaseBody w={w} d={d} h={h} bodyColor={color} />;
  if (has("books-pack", "books-vintage", "成排书籍", "复古书册")) return <BookRow {...p} />;
  if (has("book", "书")) return <BookStack {...p} />;
  if (has("pillow", "抱枕", "blanket", "毛毯")) return <PillowMesh {...p} />;
  if (has("clothes", "衣物", "bed-clothes", "被褥")) return <FoldedStack {...p} />;
  if (has("statue", "雕塑", "buddha", "佛像", "nutcracker", "胡桃夹子")) return <StatueMesh item={item} color={color} sc={sc} w={w} d={d} h={h} />;
  if (has("fruit-bowl", "果盘")) return <FruitBowl w={w} d={d} h={h} />;
  if (has("tea-set", "茶具", "dinnerware", "餐具", "tableware", "coffee-cups", "cups", "咖啡杯", "metal-cup", "金属杯", "coffee-mug", "马克杯", "cappuccino", "卡布奇诺", "cocktail", "鸡尾酒", "cutlery", "刀叉", "spoons", "勺", "coffee-for-two", "双人咖啡", "coffee-jar", "咖啡豆罐", "dinner-set")) return <TablewareMesh item={item} color={color} sc={sc} w={w} d={d} h={h} />;
  if (has("camera", "相机")) return <CameraMesh {...p} />;
  if (has("vintage-phone", "转盘电话")) return <VintagePhoneMesh {...p} />;
  if (has("phone", "手机", "电话")) return <PhoneMesh w={w} d={d} h={h} />;
  if (has("tape-recorder", "磁带机", "radio", "收音机", "record-player", "黑胶", "gramophone", "留声机")) return <RadioMesh item={item} color={color} sc={sc} w={w} d={d} h={h} />;
  if (has("mandolin", "曼陀林")) return <MandolinMesh {...p} />;
  if (has("globe", "地球仪")) return <GlobeMesh {...p} />;
  if (has("mirror-wall", "镜墙")) return <MirrorWallMesh w={w} d={d} h={h} />;
  if (has("mirror", "镜")) return <MirrorMesh {...p} />;
  if (has("trash-bin", "垃圾桶", "bin-", "laundry-basket", "洗衣篮")) return <BinMesh item={item} color={color} sc={sc} w={w} d={d} h={h} />;
  if (has("suitcase", "行李箱")) return <SuitcaseMesh {...p} />;
  if (has("tissue", "纸巾")) return <TissueMesh {...p} />;
  if (has("umbrella", "伞架")) return <UmbrellaStandMesh {...p} />;
  if (has("ottoman", "脚凳")) return <OttomanMesh {...p} />;
  if (has("shoe-box", "球鞋盒")) return <ShoeBoxMesh {...p} />;
  if (has("treadmill", "跑步机")) return <TreadmillMesh {...p} />;
  if (has("clock", "座钟")) return <ClockMesh {...p} />;
  if (has("telescope", "望远镜")) return <TelescopeMesh {...p} />;
  if (has("hammer", "锤子")) return <HammerMesh w={w} d={d} h={h} />;
  if (has("pen", "钢笔", "caliper", "卡尺")) return <PenMesh w={w} d={d} h={h} />;
  if (has("xmas", "圣诞", "presents", "礼盒")) return <GiftMesh {...p} />;
  if (has("wall-shelf", "壁挂层架")) return <WallShelfMesh {...p} />;
  if (has("sign", "招牌", "店招", "chalkboard", "黑板", "whiteboard", "白板", "menu", "菜单", "welcome-sign", "欢迎牌", "wet-floor", "地滑", "coffee-menu")) return <SignMesh item={item} color={color} sc={sc} w={w} d={d} h={h} />;
  if (has("cross", "十字架")) return <CrossMesh w={w} d={d} h={h} />;
  if (has("oil-lamp", "豆油灯", "kerosene-lamp", "煤油灯")) return <OilLampMesh {...p} />;
  if (has("sheaf", "粟束", "稻束")) return <SheafMesh {...p} />;
  if (has("broom", "扫帚")) return <BroomMesh w={w} d={d} h={h} />;
  if (has("iv-stand", "输液架")) return <IvStandMesh w={w} d={d} h={h} />;
  if (has("thermos", "保温壶")) return <ThermosMesh {...p} />;
  if (has("basin", "脸盆")) return <BasinMesh {...p} />;
  if (has("tokonoma", "床の間")) return <TokonomaMesh w={w} d={d} h={h} />;
  if (has("shoji", "障子")) return <ShojiMesh w={w} d={d} h={h} />;
  if (has("floor-cushion", "坐垫")) return <FloorCushionMesh {...p} />;
  if (has("wedding-arch", "婚礼拱门")) return <WeddingArchMesh {...p} />;
  if (has("street-lamp", "路灯")) return <StreetLampMesh w={w} d={d} h={h} />;
  if (has("banner", "旗帜")) return <BannerMesh {...p} />;
  if (has("stone-lantern", "石灯笼")) return <StoneLanternMesh w={w} d={d} h={h} />;
  if (has("spear", "长枪")) return <SpearMesh w={w} d={d} h={h} />;
  if (has("rubble", "瓦砾")) return <RubbleMesh w={w} d={d} h={h} />;
  if (has("cobweb", "蛛网")) return <CobwebMesh w={w} d={d} h={h} />;
  if (has("broken-wall", "坍塌墙")) return <BrokenWallMesh {...p} />;
  if (has("lantern-pole", "灯笼杆")) return <LanternPoleMesh w={w} d={d} h={h} />;
  if (has("roman-column", "罗马柱")) return <RomanColumnMesh w={w} d={d} h={h} />;
  if (has("fallen-column", "倒塌石柱")) return <FallenColumnMesh w={w} d={d} h={h} />;
  if (has("stone-well", "石井")) return <StoneWellMesh w={w} d={d} h={h} />;
  if (has("burnt-beam", "焦黑断梁")) return <BurntBeamMesh w={w} d={d} h={h} />;
  if (has("rockery", "太湖石")) return <RockeryMesh w={w} d={d} h={h} />;
  if (has("fan-window", "扇窗", "lattice-window", "花格窗")) return <LatticeWindowMesh item={item} color={color} sc={sc} w={w} d={d} h={h} />;
  if (has("pedestal", "花架", "展台")) return <PedestalMesh {...p} />;
  if (has("pots-pans", "锅具", "copper-pots", "铜锅", "utensils", "厨具", "spice-rack", "调料架", "kitchen-pack", "厨房饰品")) return <KitchenClusterMesh {...p} />;
  if (has("bathroom-scene", "卫浴", "kids-room", "儿童房")) return <SceneMesh w={w} d={d} h={h} />;
  if (has("partition-stall", "隔断", "stall-door", "隔间门")) return <StallMesh item={item} color={color} sc={sc} w={w} d={d} h={h} />;
  return <GenericDecorMesh {...p} />;
}

// ═══════════════════════════════════════════════════════════════════
// LAMP
// ═══════════════════════════════════════════════════════════════════

/** Table / desk / bedside lamp: base + stem + warm shade. */
function TableLampMesh({ item, color, w, d, h }: FallbackProps) {
  const isArm = /desk-arm|书桌灯/.test(item.id + item.name);
  const r = Math.min(w, d) / 2;
  return (
    <group>
      {/* Base */}
      <Cyl p={[0, h * 0.04, 0]} rt={r * 0.85} rb={r} len={h * 0.08} c={shade(color, -15)} metal={0.3} rough={0.4} />
      {isArm ? (
        <group>
          {/* Articulated arm: two segments */}
          <Cyl p={[-w * 0.12, h * 0.3, 0]} rt={0.01} rb={0.01} len={h * 0.45} rot={[0, 0, 0.5]} c="#2A2A2A" metal={0.7} rough={0.3} />
          <Cyl p={[w * 0.1, h * 0.52, 0]} rt={0.01} rb={0.01} len={h * 0.4} rot={[0, 0, -0.7]} c="#2A2A2A" metal={0.7} rough={0.3} />
          <Sph p={[0, h * 0.48, 0]} r={0.018} c="#2A2A2A" metal={0.7} rough={0.3} cast={false} />
          {/* Small shade, angled down */}
          <Cone p={[w * 0.26, h * 0.62, 0]} r={r * 0.85} len={h * 0.24} rot={[0, 0, -0.9]} c={color} rough={0.5} metal={0.2} />
          <Sph p={[w * 0.3, h * 0.56, 0]} r={0.02} c="#FFE8B0" rough={0.3} e="#FFE8B0" ei={1.0} cast={false} />
        </group>
      ) : (
        <group>
          {/* Stem */}
          <Cyl p={[0, h * 0.36, 0]} rt={0.012} rb={0.014} len={h * 0.56} c={shade(color, -10)} metal={0.5} rough={0.35} />
          {/* Shade — trapezoid, warm emissive */}
          <Cyl p={[0, h * 0.74, 0]} rt={r * 0.72} rb={r * 1.05} len={h * 0.34} c="#F5EED8" rough={0.85} e="#FFE8B0" ei={0.3} />
          {/* Bulb glow inside shade */}
          <Sph p={[0, h * 0.7, 0]} r={Math.max(0.015, r * 0.3)} c="#FFE8B0" rough={0.3} e="#FFE8B0" ei={1.2} cast={false} />
        </group>
      )}
    </group>
  );
}

/** Pendant lamp: cord + shade + bulb. Saturno gets its signature ring. */
function PendantLampMesh({ item, color, w, d, h }: FallbackProps) {
  const isSaturno = /saturno|土星环/.test(item.id + item.name);
  const isMulti = /ikea4|四头/.test(item.id + item.name);
  const r = Math.min(w, d) / 2;
  if (isSaturno) {
    return (
      <group>
        {/* Suspension cord */}
        <Cyl p={[0, h * 0.88, 0]} rt={0.006} rb={0.006} len={h * 0.24} c="#333" rough={0.6} />
        {/* Central globe */}
        <Sph p={[0, h * 0.5, 0]} r={r * 0.62} c="#EDEDE8" rough={0.25} e="#FFEEC8" ei={0.35} />
        {/* Saturn ring — tilted gold torus, the signature */}
        <Tor p={[0, h * 0.5, 0]} r={r * 1.05} tube={Math.max(0.006, r * 0.05)} rot={[1.15, 0, 0.3]} c="#C8A040" metal={0.85} rough={0.25} />
        {/* Small bulb glow */}
        <Sph p={[0, h * 0.32, 0]} r={0.02} c="#FFE8B0" rough={0.3} e="#FFE8B0" ei={1.0} cast={false} />
      </group>
    );
  }
  if (isMulti) {
    return (
      <group>
        <Cyl p={[0, h * 0.9, 0]} rt={0.008} rb={0.008} len={h * 0.2} c="#333" rough={0.6} />
        <Box p={[0, h * 0.78, 0]} s={[w * 0.9, 0.02, d * 0.3]} c="#2A2A2A" metal={0.7} rough={0.3} />
        {[-0.36, -0.12, 0.12, 0.36].map((fx, i) => (
          <group key={i}>
            <Cyl p={[fx * w, h * 0.72, 0]} rt={0.004} rb={0.004} len={h * 0.1} c="#333" rough={0.6} cast={false} />
            <Cone p={[fx * w, h * 0.6, 0]} r={r * 0.42} len={h * 0.18} rot={[Math.PI, 0, 0]} c={color} rough={0.5} metal={0.2} />
            <Sph p={[fx * w, h * 0.52, 0]} r={0.016} c="#FFE8B0" rough={0.3} e="#FFE8B0" ei={1.0} cast={false} />
          </group>
        ))}
      </group>
    );
  }
  return (
    <group>
      <Cyl p={[0, h * 0.82, 0]} rt={0.005} rb={0.005} len={h * 0.36} c="#333" rough={0.6} />
      {/* Drum shade */}
      <Cyl p={[0, h * 0.48, 0]} rt={r * 0.85} rb={r} len={h * 0.42} c={color} rough={0.5} metal={0.25} />
      {/* Bulb */}
      <Sph p={[0, h * 0.28, 0]} r={Math.max(0.016, r * 0.3)} c="#FFE8B0" rough={0.3} e="#FFE8B0" ei={1.1} cast={false} />
      {/* Bottom rim */}
      <Tor p={[0, h * 0.27, 0]} r={r * 0.95} tube={0.006} rot={[Math.PI / 2, 0, 0]} c={shade(color, -20)} metal={0.5} rough={0.35} cast={false} />
    </group>
  );
}

/** Chandelier: stem + two tiers of arms + bulbs + crystal drops. */
function ChandelierMesh({ color, w, d, h }: FallbackProps) {
  const r = Math.min(w, d) / 2;
  const arms = [0, 60, 120, 180, 240, 300];
  return (
    <group>
      {/* Top stem + canopy */}
      <Cyl p={[0, h * 0.94, 0]} rt={0.01} rb={0.01} len={h * 0.12} c="#2A2A2A" metal={0.8} rough={0.3} />
      <Cone p={[0, h * 0.86, 0]} r={r * 0.2} len={h * 0.06} c="#2A2A2A" metal={0.8} rough={0.3} />
      {/* Central column */}
      <Cyl p={[0, h * 0.5, 0]} rt={0.016} rb={0.02} len={h * 0.72} c="#C8A040" metal={0.8} rough={0.25} />
      {/* Two tiers of arms — each arm in its own Y-rotated group so the
          cylinder points exactly radially (combined Euler angles drift). */}
      {[0.62, 0.38].map((fy, tier) => (
        <group key={tier} position={[0, h * fy, 0]}>
          {arms.map((deg) => {
            const rad = (deg * Math.PI) / 180;
            const armLen = r * 0.85;
            return (
              <group key={deg} rotation={[0, -rad, 0]}>
                <Cyl
                  p={[armLen / 2, 0, 0]}
                  rt={0.008} rb={0.008} len={armLen}
                  rot={[0, 0, -Math.PI / 2]}
                  c="#C8A040" metal={0.8} rough={0.25}
                  cast={false}
                />
                {/* Bulb at arm end */}
                <Sph p={[armLen, h * 0.05, 0]} r={0.02} c="#FFE8B0" rough={0.3} e="#FFE8B0" ei={1.2} cast={false} />
                {/* Crystal drop under arm end */}
                <Cone p={[armLen, -h * 0.06, 0]} r={0.012} len={0.05} rot={[Math.PI, 0, 0]} c="#E8F0F8" rough={0.1} o={0.75} cast={false} />
              </group>
            );
          })}
        </group>
      ))}
      {/* Bottom finial + drop */}
      <Sph p={[0, h * 0.1, 0]} r={0.022} c="#C8A040" metal={0.8} rough={0.25} cast={false} />
      <Cone p={[0, h * 0.03, 0]} r={0.018} len={0.06} rot={[Math.PI, 0, 0]} c="#E8F0F8" rough={0.1} o={0.75} cast={false} />
    </group>
  );
}

/** Ceiling lamp: flat disc / long bar with lit underside. */
function CeilingLampMesh({ item, color, w, d, h }: FallbackProps) {
  const isLong = /long|长条/.test(item.id + item.name);
  return (
    <group>
      {isLong ? (
        <group>
          <Box p={[0, h * 0.55, 0]} s={[w, h * 0.5, d]} c={color} rough={0.4} metal={0.3} />
          <Box p={[0, h * 0.28, 0]} s={[w * 0.9, h * 0.1, d * 0.8]} c="#FFF8E8" rough={0.3} e="#FFEEC8" ei={0.9} cast={false} />
        </group>
      ) : (
        <group>
          <Cyl p={[0, h * 0.6, 0]} rt={Math.min(w, d) * 0.48} rb={Math.min(w, d) * 0.5} len={h * 0.5} c={color} rough={0.4} metal={0.2} />
          <Cyl p={[0, h * 0.3, 0]} rt={Math.min(w, d) * 0.44} rb={Math.min(w, d) * 0.44} len={h * 0.12} c="#FFF8E8" rough={0.3} e="#FFEEC8" ei={0.9} cast={false} />
          <Tor p={[0, h * 0.36, 0]} r={Math.min(w, d) * 0.46} tube={0.008} rot={[Math.PI / 2, 0, 0]} c={shade(color, -20)} metal={0.5} rough={0.35} cast={false} />
        </group>
      )}
    </group>
  );
}

/** Wall sconce: plate + arm + downward shade + bulb. */
function WallSconceMesh({ color, w, d, h }: { color: string; w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.7, 0]} s={[w * 0.5, h * 0.4, 0.015]} c="#2A2A2A" metal={0.7} rough={0.35} />
      <Cyl p={[0, h * 0.45, d * 0.25]} rt={0.01} rb={0.01} len={d * 0.5} rot={[Math.PI / 2, 0, 0]} c="#2A2A2A" metal={0.7} rough={0.35} cast={false} />
      <Cyl p={[0, h * 0.28, d * 0.42]} rt={Math.min(w, d) * 0.32} rb={Math.min(w, d) * 0.42} len={h * 0.3} c={color} rough={0.5} metal={0.3} />
      <Sph p={[0, h * 0.14, d * 0.42]} r={Math.min(w, d) * 0.16} c="#FFE8B0" rough={0.3} e="#FFE8B0" ei={1.1} cast={false} />
    </group>
  );
}

/** Street lamp (furniture): tall pole + lantern head. */
function StreetLampFurnMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Cyl p={[0, h * 0.04, 0]} rt={0.06} rb={0.08} len={h * 0.08} c="#1A1A1A" metal={0.6} rough={0.4} />
      <Cyl p={[0, h * 0.5, 0]} rt={0.02} rb={0.028} len={h * 0.85} c="#1A1A1A" metal={0.7} rough={0.35} />
      <Box p={[0, h * 0.94, 0]} s={[w * 0.5, h * 0.06, d * 0.6]} c="#1A1A1A" metal={0.6} rough={0.4} />
      <Box p={[0, h * 0.9, 0]} s={[w * 0.36, h * 0.05, d * 0.44]} c="#FFE8B0" rough={0.3} e="#FFE8B0" ei={0.8} cast={false} />
      <Cone p={[0, h * 0.98, 0]} r={Math.min(w, d) * 0.32} len={h * 0.04} seg={4} c="#1A1A1A" metal={0.6} rough={0.4} />
    </group>
  );
}

export function LampMesh({ item, color, sc, w, d, h }: FallbackProps) {
  const id = item.id;
  const name = item.name;
  const has = (...keys: string[]) => keys.some((k) => id.includes(k) || name.includes(k));
  const p = { item, color, sc, w, d, h };

  // NOTE: chandelier first — "吊灯" also matches chandelier names.
  if (has("chandelier", "水晶吊灯", "烛台吊灯")) return <ChandelierMesh {...p} />;
  if (has("saturno", "土星环", "pendant", "吊灯")) return <PendantLampMesh {...p} />;
  if (has("ceiling", "吸顶")) return <CeilingLampMesh item={item} color={color} sc={sc} w={w} d={d} h={h} />;
  if (has("sconce", "壁灯")) return <WallSconceMesh color={color} w={w} d={d} h={h} />;
  if (has("street", "路灯")) return <StreetLampFurnMesh w={w} d={d} h={h} />;
  return <TableLampMesh item={item} color={color} sc={sc} w={w} d={d} h={h} />;
}

// ═══════════════════════════════════════════════════════════════════
// ELECTRONICS
// ═══════════════════════════════════════════════════════════════════

/** TV: flat panel on a stand, or a genuinely CURVED panel (cylinder
 *  segment) for tv-curved; retro gets a chunky body + inset screen. */
function TvMesh({ item, color, w, d, h }: FallbackProps) {
  const isCurved = /curved|曲面/.test(item.id + item.name);
  const isRetro = /retro|复古/.test(item.id + item.name);
  const panelH = h * 0.84;
  const panelY = h * 0.52;
  if (isRetro) {
    return (
      <group>
        <Box p={[0, h * 0.5, 0]} s={[w, h, d]} c={color} rough={0.45} />
        {/* Inset screen */}
        <Box p={[0, h * 0.56, d / 2 + 0.003]} s={[w * 0.68, h * 0.5, 0.006]} c="#2A3A2A" rough={0.15} e="#1A2A1A" ei={0.35} cast={false} />
        {/* Knobs */}
        <Cyl p={[w * 0.4, h * 0.62, d / 2 + 0.008]} rt={0.014} rb={0.014} len={0.012} rot={[Math.PI / 2, 0, 0]} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
        <Cyl p={[w * 0.4, h * 0.42, d / 2 + 0.008]} rt={0.011} rb={0.011} len={0.012} rot={[Math.PI / 2, 0, 0]} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
        {/* Antenna */}
        <Cyl p={[-w * 0.3, h * 0.98, 0]} rt={0.004} rb={0.004} len={h * 0.3} rot={[0, 0, 0.5]} c="#888" metal={0.8} rough={0.3} cast={false} />
      </group>
    );
  }
  if (isCurved) {
    // Genuine curve: cylinder segment, concave toward the viewer (+z).
    const sag = Math.min(0.14, w * 0.08);
    const R = ((w / 2) ** 2 + sag ** 2) / (2 * sag);
    const th = 2 * Math.asin(w / 2 / R);
    return (
      <group>
        {/* Back shell */}
        <mesh position={[0, panelY, -R]} castShadow receiveShadow>
          <cylinderGeometry args={[R, R, panelH, 24, 1, true, -th / 2, th]} />
          <meshStandardMaterial color="#111111" roughness={0.35} metalness={0.3} side={THREE.DoubleSide} />
        </mesh>
        {/* Screen, 6mm proud of the shell, faintly lit */}
        <mesh position={[0, panelY, -R + 0.001]} castShadow={false}>
          <cylinderGeometry args={[R + 0.005, R + 0.005, panelH * 0.92, 24, 1, true, -th / 2, th]} />
          <meshStandardMaterial color="#0A1626" roughness={0.15} metalness={0.1} emissive="#16283F" emissiveIntensity={0.3} side={THREE.DoubleSide} />
        </mesh>
        {/* Neck + base */}
        <Box p={[0, h * 0.06, -sag / 2]} s={[w * 0.08, h * 0.12, 0.04]} c="#1A1A1A" metal={0.5} rough={0.4} />
        <Box p={[0, 0.012, -sag / 2]} s={[w * 0.5, 0.024, d * 0.9]} c="#1A1A1A" metal={0.5} rough={0.4} />
      </group>
    );
  }
  return (
    <group>
      {/* Bezel */}
      <Box p={[0, panelY, 0]} s={[w, panelH, 0.03]} c="#111111" rough={0.3} metal={0.3} />
      {/* Screen */}
      <Box p={[0, panelY, 0.018]} s={[w * 0.94, panelH * 0.9, 0.006]} c="#0A1626" rough={0.15} e="#16283F" ei={0.3} cast={false} />
      {/* Brand dot */}
      <Box p={[0, h * 0.1, 0.018]} s={[w * 0.08, 0.012, 0.002]} c="#888" metal={0.7} rough={0.3} cast={false} />
      {/* Neck + feet */}
      <Box p={[0, h * 0.06, 0]} s={[w * 0.08, h * 0.1, 0.04]} c="#1A1A1A" metal={0.5} rough={0.4} />
      <Box p={[-w * 0.32, 0.012, 0]} s={[w * 0.2, 0.024, d * 0.7]} c="#1A1A1A" metal={0.5} rough={0.4} />
      <Box p={[w * 0.32, 0.012, 0]} s={[w * 0.2, 0.024, d * 0.7]} c="#1A1A1A" metal={0.5} rough={0.4} />
    </group>
  );
}

/** Monitor: panel + neck + base. */
function MonitorMesh({ color, w, d, h }: FallbackProps) {
  const panelH = h * 0.72;
  return (
    <group>
      <Box p={[0, h * 0.56, 0]} s={[w, panelH, 0.025]} c="#1A1A1A" rough={0.3} metal={0.3} />
      <Box p={[0, h * 0.56, 0.015]} s={[w * 0.93, panelH * 0.88, 0.005]} c="#0A1626" rough={0.15} e="#16283F" ei={0.35} cast={false} />
      <Box p={[0, h * 0.16, 0]} s={[w * 0.07, h * 0.22, 0.03]} c="#222" metal={0.5} rough={0.4} />
      <Box p={[0, 0.012, 0]} s={[w * 0.45, 0.024, d * 0.75]} c="#222" metal={0.5} rough={0.4} />
    </group>
  );
}

/** Gaming setup: monitor + tower with LED + keyboard slab. */
function GamingSetupMesh({ color, w, d, h }: FallbackProps) {
  const monW = w * 0.58;
  return (
    <group>
      {/* Monitor */}
      <Box p={[-w * 0.16, h * 0.6, 0]} s={[monW, h * 0.62, 0.025]} c="#1A1A1A" rough={0.3} metal={0.3} />
      <Box p={[-w * 0.16, h * 0.6, 0.015]} s={[monW * 0.92, h * 0.52, 0.005]} c="#0A1626" rough={0.15} e="#24385A" ei={0.5} cast={false} />
      <Box p={[-w * 0.16, h * 0.2, 0]} s={[0.04, h * 0.18, 0.03]} c="#222" metal={0.5} rough={0.4} />
      {/* Tower */}
      <Box p={[w * 0.32, h * 0.32, 0]} s={[w * 0.2, h * 0.64, d * 0.8]} c="#111" rough={0.35} metal={0.4} />
      <Box p={[w * 0.32, h * 0.32, d * 0.42]} s={[0.012, h * 0.5, 0.012]} c="#00C8FF" rough={0.3} e="#00A8E8" ei={1.4} cast={false} />
      <Box p={[w * 0.32, h * 0.58, d * 0.42]} s={[w * 0.14, 0.02, 0.008]} c="#222" rough={0.5} cast={false} />
      {/* Keyboard slab */}
      <Box p={[-w * 0.14, 0.015, d * 0.28]} s={[w * 0.55, 0.03, d * 0.3]} c="#222" rough={0.5} />
      {[0, 1, 2].map((i) => (
        <Box key={i} p={[-w * 0.14, 0.032, d * (0.18 + i * 0.1)]} s={[w * 0.5, 0.008, 0.02]} c="#3A3A3A" rough={0.6} cast={false} />
      ))}
    </group>
  );
}

/** Laptop: base + screen leaning back. */
function LaptopMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, 0.012, 0]} s={[w, 0.024, d]} c={color} rough={0.35} metal={0.5} />
      <Box p={[0, 0.026, d * 0.1]} s={[w * 0.8, 0.004, d * 0.6]} c="#2A2A2A" rough={0.6} cast={false} />
      <group position={[0, 0.024, -d / 2 + 0.01]} rotation={[-0.32, 0, 0]}>
        <Box p={[0, h * 0.32, 0]} s={[w, h * 0.64, 0.014]} c="#1A1A1A" rough={0.3} metal={0.4} />
        <Box p={[0, h * 0.32, 0.01]} s={[w * 0.9, h * 0.54, 0.004]} c="#0A1626" rough={0.15} e="#16283F" ei={0.35} cast={false} />
      </group>
    </group>
  );
}

/** PC tower: tall box + LED strip + vents. */
function PcTowerMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.35} metal={0.4} />
      <Box p={[0, h * 0.5, d / 2 + 0.002]} s={[0.012, h * 0.7, 0.008]} c="#00C8FF" rough={0.3} e="#00A8E8" ei={1.4} cast={false} />
      {[0.72, 0.6, 0.48].map((fy, i) => (
        <Box key={i} p={[-w * 0.2, h * fy, d / 2 + 0.002]} s={[w * 0.4, 0.012, 0.004]} c="#000" rough={0.8} cast={false} />
      ))}
      <Sph p={[w * 0.3, h * 0.85, d / 2 + 0.004]} r={0.008} c="#00FF88" rough={0.3} e="#00FF88" ei={1.2} cast={false} />
    </group>
  );
}

/** Speaker / hifi: box + driver circles. */
function SpeakerMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.4} />
      <Cyl p={[0, h * 0.68, d / 2 + 0.004]} rt={Math.min(w, d) * 0.3} rb={Math.min(w, d) * 0.3} len={0.012} rot={[Math.PI / 2, 0, 0]} c="#1A1A1A" rough={0.3} cast={false} />
      <Cyl p={[0, h * 0.3, d / 2 + 0.004]} rt={Math.min(w, d) * 0.36} rb={Math.min(w, d) * 0.36} len={0.012} rot={[Math.PI / 2, 0, 0]} c="#222" rough={0.3} cast={false} />
      <Cyl p={[0, h * 0.3, d / 2 + 0.012]} rt={Math.min(w, d) * 0.18} rb={Math.min(w, d) * 0.18} len={0.006} rot={[Math.PI / 2, 0, 0]} c="#3A3A3A" rough={0.4} cast={false} />
    </group>
  );
}

/** Keyboard: flat slab + key rows. */
function KeyboardMesh({ w, d, h }: { w: number; d: number; h: number }) {
  return (
    <group>
      <Box p={[0, h * 0.4, 0]} s={[w, h * 0.8, d]} c="#222" rough={0.5} />
      {[0.25, 0.5, 0.75].map((fz, i) => (
        <Box key={i} p={[0, h * 0.82, -d * 0.5 + fz * d]} s={[w * 0.92, h * 0.08, d * 0.18]} c="#3A3A3A" rough={0.6} cast={false} />
      ))}
    </group>
  );
}

/** Router: box + two antennae. */
function RouterMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h * 0.35, 0]} s={[w, h * 0.7, d]} c={color} rough={0.4} />
      <Cyl p={[-w * 0.3, h * 0.75, -d * 0.3]} rt={0.006} rb={0.006} len={h * 0.6} rot={[0.25, 0, 0.2]} c="#222" rough={0.5} cast={false} />
      <Cyl p={[w * 0.3, h * 0.75, -d * 0.3]} rt={0.006} rb={0.006} len={h * 0.6} rot={[0.25, 0, -0.2]} c="#222" rough={0.5} cast={false} />
      <Sph p={[w * 0.2, h * 0.72, d * 0.2]} r={0.008} c="#00FF88" rough={0.3} e="#00FF88" ei={1.2} cast={false} />
    </group>
  );
}

/** Printer: body + lid + paper + slot. */
function PrinterMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h * 0.42, 0]} s={[w, h * 0.84, d]} c={color} rough={0.4} />
      <Box p={[0, h * 0.88, 0]} s={[w * 0.9, h * 0.08, d * 0.9]} c={shade(color, -12)} rough={0.4} />
      {/* Paper sticking out the back, tilted */}
      <Box p={[0, h * 0.95, -d * 0.3]} s={[w * 0.55, h * 0.3, 0.006]} rot={[0.35, 0, 0]} c="#FFFFFF" rough={0.9} cast={false} />
      {/* Front output slot + display */}
      <Box p={[0, h * 0.3, d / 2 + 0.002]} s={[w * 0.7, h * 0.08, 0.006]} c="#1A1A1A" rough={0.8} cast={false} />
      <Box p={[w * 0.3, h * 0.62, d / 2 + 0.003]} s={[w * 0.22, h * 0.1, 0.005]} c="#0A1626" rough={0.2} e="#1A3A5A" ei={0.5} cast={false} />
    </group>
  );
}

/** Server rack: tall dark box + slots + status LEDs. */
function ServerRackMesh({ w, d, h }: FallbackProps) {
  const slots = Math.max(4, Math.min(9, Math.floor(h / 0.22)));
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c="#1A1C1E" rough={0.45} metal={0.4} />
      {Array.from({ length: slots }).map((_, i) => {
        const y = h * (0.08 + (0.84 * (i + 0.5)) / slots);
        return (
          <group key={i}>
            <Box p={[0, y, d / 2 + 0.002]} s={[w * 0.86, h * 0.045, 0.004]} c="#2E3134" rough={0.5} cast={false} />
            <Sph p={[w * 0.36, y, d / 2 + 0.006]} r={0.007} c={i % 3 === 0 ? "#FFB020" : "#00FF88"} rough={0.3} e={i % 3 === 0 ? "#FFB020" : "#00FF88"} ei={1.2} cast={false} />
          </group>
        );
      })}
    </group>
  );
}

/** KTV / display screen: big framed panel, faintly lit. */
function KtvScreenMesh({ w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, Math.max(0.02, d * 0.6)]} c="#111" rough={0.35} metal={0.3} />
      <Box p={[0, h * 0.52, d * 0.32]} s={[w * 0.92, h * 0.88, 0.006]} c="#0A1626" rough={0.15} e="#1A3050" ei={0.4} cast={false} />
      <Box p={[0, h * 0.08, d * 0.32]} s={[w * 0.3, h * 0.04, 0.004]} c="#C8C8C8" metal={0.7} rough={0.3} cast={false} />
    </group>
  );
}

/** POS / card terminal: base + tilted screen + keys. */
function PosMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h * 0.3, 0]} s={[w, h * 0.6, d]} c={color} rough={0.4} />
      <Box p={[0, h * 0.68, -d * 0.1]} s={[w * 0.8, h * 0.4, 0.02]} rot={[-0.35, 0, 0]} c="#1A1A1A" rough={0.3} />
      <Box p={[0, h * 0.7, -d * 0.1 + 0.02]} s={[w * 0.68, h * 0.3, 0.005]} rot={[-0.35, 0, 0]} c="#0A1626" rough={0.15} e="#1A3A5A" ei={0.5} cast={false} />
      {[0, 1, 2].map((i) => (
        <Box key={i} p={[-w * 0.2 + i * w * 0.2, h * 0.62, d * 0.3]} s={[w * 0.12, 0.012, d * 0.14]} c="#C8C8C8" metal={0.6} rough={0.35} cast={false} />
      ))}
    </group>
  );
}

/** Generic electronics fallback: device body + screen + buttons. */
function GenericElectronicsMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.4} metal={0.2} />
      <Box p={[0, h * 0.62, d / 2 + 0.003]} s={[w * 0.8, h * 0.5, 0.005]} c="#0A1626" rough={0.15} e="#16283F" ei={0.35} cast={false} />
      <Box p={[0, h * 0.16, d / 2 + 0.003]} s={[w * 0.5, h * 0.08, 0.005]} c={shade(color, -20)} rough={0.5} cast={false} />
      <Sph p={[w * 0.32, h * 0.16, d / 2 + 0.006]} r={0.008} c="#00FF88" rough={0.3} e="#00FF88" ei={1.0} cast={false} />
    </group>
  );
}

export function ElectronicsMesh({ item, color, sc, w, d, h }: FallbackProps) {
  const id = item.id;
  const name = item.name;
  const has = (...keys: string[]) => keys.some((k) => id.includes(k) || name.includes(k));
  const p = { item, color, sc, w, d, h };

  if (has("tv", "电视")) return <TvMesh {...p} />;
  if (has("gamer-setup", "电竞桌", "gaming-pc", "电竞主机", "setup-ultimate", "终极电竞")) return <GamingSetupMesh {...p} />;
  if (has("display-stand", "显示器支架")) return <KtvScreenMesh {...p} />;
  if (has("server", "服务器", "机柜", "机架", "机房")) return <ServerRackMesh {...p} />;
  if (has("computer-case", "电脑主机", "pc-futuristic", "未来风电脑")) return <PcTowerMesh {...p} />;
  if (has("laptop", "笔记本")) return <LaptopMesh {...p} />;
  if (has("hifi", "音箱", "speaker", "落地音箱")) return <SpeakerMesh {...p} />;
  if (has("keyboard", "键盘")) return <KeyboardMesh w={w} d={d} h={h} />;
  if (has("router", "路由器")) return <RouterMesh {...p} />;
  if (has("printer", "打印机")) return <PrinterMesh {...p} />;
  if (has("ktv-screen", "KTV大屏")) return <KtvScreenMesh {...p} />;
  if (has("monitor", "显示器", "personal-computer", "个人电脑", "pc-desk", "电脑桌")) return <MonitorMesh {...p} />;
  if (has("pos", "收银", "card-terminal", "刷卡")) return <PosMesh {...p} />;
  return <GenericElectronicsMesh {...p} />;
}

// ═══════════════════════════════════════════════════════════════════
// APPLIANCE
// ═══════════════════════════════════════════════════════════════════

/** Microwave: body + door window + handle + display. */
function MicrowaveMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.4} metal={0.25} />
      {/* Door */}
      <Box p={[-w * 0.12, h * 0.5, d / 2 + 0.002]} s={[w * 0.62, h * 0.78, 0.005]} c={shade(color, -18)} rough={0.4} metal={0.2} cast={false} />
      {/* Door window */}
      <Box p={[-w * 0.12, h * 0.52, d / 2 + 0.006]} s={[w * 0.48, h * 0.52, 0.004]} c="#1A1A1A" rough={0.15} cast={false} />
      {/* Handle */}
      <Cyl p={[w * 0.2, h * 0.5, d / 2 + 0.012]} rt={0.008} rb={0.008} len={h * 0.6} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
      {/* Display + buttons */}
      <Box p={[w * 0.38, h * 0.68, d / 2 + 0.004]} s={[w * 0.14, h * 0.12, 0.004]} c="#0A2A12" rough={0.3} e="#00FF88" ei={0.6} cast={false} />
      <Box p={[w * 0.38, h * 0.42, d / 2 + 0.004]} s={[w * 0.12, h * 0.06, 0.004]} c="#333" rough={0.5} cast={false} />
    </group>
  );
}

/** Oven: body + big glass door + handle + knobs. */
function OvenMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.4} metal={0.3} />
      <Box p={[0, h * 0.44, d / 2 + 0.002]} s={[w * 0.9, h * 0.68, 0.005]} c="#1A1A1A" rough={0.15} cast={false} />
      <Box p={[0, h * 0.44, d / 2 + 0.005]} s={[w * 0.78, h * 0.5, 0.004]} c="#2A2018" rough={0.1} e="#3A2410" ei={0.3} cast={false} />
      <Cyl p={[0, h * 0.82, d / 2 + 0.014]} rt={0.01} rb={0.01} len={w * 0.8} rot={[0, 0, Math.PI / 2]} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
      {[0.85, 0.93].map((fy, i) => (
        <Cyl key={i} p={[w * (0.3 + i * 0.12), h * fy, d / 2 + 0.006]} rt={0.012} rb={0.012} len={0.01} rot={[Math.PI / 2, 0, 0]} c="#888" metal={0.8} rough={0.3} cast={false} />
      ))}
    </group>
  );
}

/** Coffee / espresso machine: body + group head + drip tray + cup. */
function CoffeeMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h * 0.48, 0]} s={[w, h * 0.9, d]} c={color} rough={0.35} metal={0.35} />
      <Box p={[0, h * 0.96, 0]} s={[w * 0.9, h * 0.08, d * 0.9]} c={shade(color, -15)} rough={0.4} metal={0.3} />
      {/* Group head */}
      <Cyl p={[0, h * 0.62, d * 0.2]} rt={0.03} rb={0.035} len={0.05} rot={[Math.PI / 2, 0, 0]} c="#2A2A2A" metal={0.6} rough={0.35} />
      {/* Drip tray + cup */}
      <Box p={[0, h * 0.12, d * 0.2]} s={[w * 0.5, 0.015, d * 0.4]} c="#333" rough={0.5} metal={0.5} cast={false} />
      <Cyl p={[0, h * 0.22, d * 0.2]} rt={0.028} rb={0.024} len={h * 0.12} c="#F2EEE6" rough={0.35} />
      {/* Display + buttons */}
      <Box p={[0, h * 0.82, d / 2 + 0.003]} s={[w * 0.4, h * 0.08, 0.004]} c="#0A1626" rough={0.2} e="#1A3A5A" ei={0.5} cast={false} />
      <Sph p={[w * 0.3, h * 0.82, d / 2 + 0.005]} r={0.008} c="#00FF88" rough={0.3} e="#00FF88" ei={1.0} cast={false} />
    </group>
  );
}

/** Coffee grinder: base + hopper + handle. */
function GrinderMesh({ color, w, d, h }: FallbackProps) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Cyl p={[0, h * 0.3, 0]} rt={r * 0.85} rb={r} len={h * 0.6} c={color} rough={0.4} metal={0.3} />
      <Cone p={[0, h * 0.78, 0]} r={r * 0.8} len={h * 0.3} rot={[Math.PI, 0, 0]} c="#D8D8D8" rough={0.2} o={0.55} />
      <Cyl p={[0, h * 0.95, 0]} rt={r * 0.4} rb={r * 0.4} len={h * 0.06} c={shade(color, -20)} rough={0.4} />
      <Box p={[r * 0.95, h * 0.55, 0]} s={[0.014, h * 0.3, 0.03]} c="#2A2A2A" rough={0.5} cast={false} />
    </group>
  );
}

/** Kettle: tapered body + spout + handle + lid. */
function KettleMesh({ color, w, d, h }: FallbackProps) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Cyl p={[0, h * 0.45, 0]} rt={r * 0.78} rb={r * 0.95} len={h * 0.82} c={color} rough={0.35} metal={0.4} />
      {/* Spout */}
      <Cyl p={[r * 0.95, h * 0.55, 0]} rt={0.012} rb={0.022} len={h * 0.4} rot={[0, 0, -0.7]} c={shade(color, -10)} rough={0.35} metal={0.4} />
      {/* Handle: vertical + top bar */}
      <Cyl p={[-r * 1.05, h * 0.5, 0]} rt={0.01} rb={0.01} len={h * 0.55} c="#2A2A2A" rough={0.5} cast={false} />
      {/* Lid + knob */}
      <Cyl p={[0, h * 0.88, 0]} rt={r * 0.55} rb={r * 0.6} len={h * 0.06} c={shade(color, -15)} rough={0.4} metal={0.3} />
      <Sph p={[0, h * 0.94, 0]} r={0.014} c="#2A2A2A" rough={0.5} cast={false} />
    </group>
  );
}

/** Washer / dryer: body + round door + controls. */
function WasherMesh({ color, w, d, h }: FallbackProps) {
  const r = Math.min(w, h) * 0.32;
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.4} metal={0.2} />
      {/* Round door */}
      <Cyl p={[0, h * 0.48, d / 2 + 0.004]} rt={r} rb={r} len={0.015} rot={[Math.PI / 2, 0, 0]} c="#2A2A2A" rough={0.3} metal={0.4} />
      <Cyl p={[0, h * 0.48, d / 2 + 0.012]} rt={r * 0.72} rb={r * 0.72} len={0.008} rot={[Math.PI / 2, 0, 0]} c="#1A2A3A" rough={0.1} e="#16283F" ei={0.3} cast={false} />
      {/* Control strip + dial + display */}
      <Box p={[0, h * 0.9, d / 2 + 0.002]} s={[w * 0.9, h * 0.1, 0.005]} c={shade(color, -12)} rough={0.45} cast={false} />
      <Cyl p={[-w * 0.3, h * 0.9, d / 2 + 0.007]} rt={0.016} rb={0.016} len={0.01} rot={[Math.PI / 2, 0, 0]} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
      <Box p={[w * 0.28, h * 0.9, d / 2 + 0.006]} s={[w * 0.2, h * 0.05, 0.004]} c="#0A2A12" rough={0.3} e="#00FF88" ei={0.6} cast={false} />
    </group>
  );
}

/** Wall-mounted AC: long box + vent + display. */
function AcIndoorMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.4} />
      <Box p={[0, h * 0.28, d / 2 + 0.002]} s={[w * 0.86, h * 0.14, 0.005]} c="#3A3A3A" rough={0.7} cast={false} />
      <Box p={[0, h * 0.22, d / 2 + 0.005]} s={[w * 0.8, 0.01, 0.004]} c="#222" rough={0.8} cast={false} />
      <Box p={[w * 0.34, h * 0.62, d / 2 + 0.003]} s={[w * 0.1, h * 0.18, 0.004]} c="#0A2A12" rough={0.3} e="#00FF88" ei={0.6} cast={false} />
    </group>
  );
}

/** Outdoor AC unit: box + fan. */
function AcOutdoorMesh({ color, w, d, h }: FallbackProps) {
  const r = Math.min(w, h) * 0.34;
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.5} metal={0.15} />
      <Cyl p={[0, h * 0.52, d / 2 + 0.004]} rt={r} rb={r} len={0.012} rot={[Math.PI / 2, 0, 0]} c="#3A3A3A" rough={0.6} cast={false} />
      <Cyl p={[0, h * 0.52, d / 2 + 0.012]} rt={r * 0.28} rb={r * 0.28} len={0.008} rot={[Math.PI / 2, 0, 0]} c="#888" metal={0.7} rough={0.35} cast={false} />
      {[0, 120, 240].map((deg) => (
        <Box key={deg} p={[0, h * 0.52, d / 2 + 0.012]} s={[r * 1.5, 0.008, r * 0.22]} rot={[0, 0, (deg * Math.PI) / 180]} c="#555" rough={0.6} cast={false} />
      ))}
      {/* Grille slats */}
      {[0.82, 0.9].map((fy, i) => (
        <Box key={i} p={[0, h * fy, d / 2 + 0.002]} s={[w * 0.8, 0.01, 0.004]} c="#999" rough={0.6} cast={false} />
      ))}
    </group>
  );
}

/** Glass-door fridge (wine / drinks): body + glass + shelves + bottles. */
function GlassFridgeMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.4} metal={0.3} />
      {/* Glass door */}
      <Box p={[0, h * 0.52, d / 2 + 0.003]} s={[w * 0.88, h * 0.92, 0.005]} c="#9AB8C8" rough={0.1} o={0.35} cast={false} />
      {/* Shelves + bottles behind glass */}
      {[0.3, 0.55, 0.8].map((fy, i) => (
        <group key={i}>
          <Box p={[0, h * fy, d * 0.1]} s={[w * 0.8, 0.012, d * 0.6]} c="#C8C8C8" metal={0.6} rough={0.4} cast={false} />
          {[-0.25, 0, 0.25].map((bx, j) => (
            <Cyl key={j} p={[bx * w, h * (fy + 0.07), d * 0.1]} rt={0.014} rb={0.014} len={h * 0.1} c={["#2A4A2A", "#4A2A2A", "#2A2A4A"][(i + j) % 3]} rough={0.3} cast={false} />
          ))}
        </group>
      ))}
      {/* Handle */}
      <Cyl p={[w * 0.4, h * 0.52, d / 2 + 0.012]} rt={0.008} rb={0.008} len={h * 0.6} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
    </group>
  );
}

/** Hairdryer: barrel + nozzle + handle. */
function HairdryerMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Cyl p={[0, h * 0.68, 0]} rt={Math.min(w, d) * 0.28} rb={Math.min(w, d) * 0.32} len={w * 0.8} rot={[0, 0, Math.PI / 2]} c={color} rough={0.35} metal={0.3} />
      <Cone p={[w * 0.52, h * 0.68, 0]} r={Math.min(w, d) * 0.2} len={w * 0.24} rot={[0, 0, -Math.PI / 2]} c={shade(color, -15)} rough={0.35} metal={0.3} />
      <Box p={[-w * 0.1, h * 0.34, 0]} s={[w * 0.16, h * 0.6, d * 0.5]} c={shade(color, -12)} rough={0.4} />
      <Sph p={[-w * 0.1, h * 0.06, 0]} r={0.012} c="#C82020" rough={0.4} cast={false} />
    </group>
  );
}

/** Cooktop: slab + 4 burners. */
function CooktopMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h * 0.4, 0]} s={[w, h * 0.8, d]} c={color} rough={0.3} metal={0.4} />
      {[[-0.25, -0.22], [0.25, -0.22], [-0.25, 0.22], [0.25, 0.22]].map(([bx, bz], i) => (
        <Cyl key={i} p={[bx * w, h * 0.82, bz * d]} rt={Math.min(w, d) * 0.16} rb={Math.min(w, d) * 0.16} len={0.008} c="#1A1A1A" rough={0.4} />
      ))}
      {[0.3, 0.42].map((fx, i) => (
        <Cyl key={i} p={[w * fx, h * 0.82, -d * 0.38]} rt={0.012} rb={0.012} len={0.01} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
      ))}
    </group>
  );
}

/** Kitchen appliance group: counter slab + pots. */
function KitchenApplianceMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h * 0.06, 0]} s={[w, h * 0.12, d]} c="#6A4A30" rough={0.6} />
      <Cyl p={[-w * 0.26, h * 0.32, 0]} rt={Math.min(w, d) * 0.2} rb={Math.min(w, d) * 0.17} len={h * 0.42} c={shade(color, -10)} metal={0.5} rough={0.35} />
      <Cyl p={[w * 0.08, h * 0.28, d * 0.06]} rt={Math.min(w, d) * 0.16} rb={Math.min(w, d) * 0.14} len={h * 0.34} c={color} metal={0.6} rough={0.3} />
      <Box p={[w * 0.34, h * 0.2, -d * 0.1]} s={[w * 0.2, h * 0.28, d * 0.5]} c="#8A6A45" rough={0.7} />
    </group>
  );
}

/** Rice cooker: rounded body + lid + handle. */
function RiceCookerMesh({ color, w, d, h }: FallbackProps) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Cyl p={[0, h * 0.42, 0]} rt={r * 0.92} rb={r} len={h * 0.8} c={color} rough={0.35} metal={0.2} />
      <Sph p={[0, h * 0.84, 0]} r={r * 0.85} s={[1, 0.4, 1]} c={shade(color, -12)} rough={0.35} metal={0.2} />
      <Tor p={[0, h * 0.9, 0]} r={r * 0.5} tube={0.008} rot={[Math.PI / 2, 0, 0]} c="#2A2A2A" rough={0.5} cast={false} />
      <Box p={[0, h * 0.5, d / 2 + 0.003]} s={[w * 0.3, h * 0.14, 0.005]} c={shade(color, -20)} rough={0.4} cast={false} />
    </group>
  );
}

/** Toaster: body + slots + lever. */
function ToasterMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h * 0.48, 0]} s={[w, h * 0.92, d]} c={color} rough={0.35} metal={0.4} />
      <Box p={[-w * 0.2, h * 0.95, 0]} s={[w * 0.24, 0.012, d * 0.7]} c="#1A1A1A" rough={0.8} cast={false} />
      <Box p={[w * 0.2, h * 0.95, 0]} s={[w * 0.24, 0.012, d * 0.7]} c="#1A1A1A" rough={0.8} cast={false} />
      <Box p={[w * 0.48, h * 0.5, 0]} s={[0.02, h * 0.14, 0.04]} c="#2A2A2A" rough={0.5} cast={false} />
    </group>
  );
}

/** Dishwasher: body + door + handle + controls. */
function DishwasherMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.4} metal={0.25} />
      <Box p={[0, h * 0.48, d / 2 + 0.002]} s={[w * 0.9, h * 0.72, 0.005]} c={shade(color, -10)} rough={0.45} cast={false} />
      <Cyl p={[0, h * 0.86, d / 2 + 0.012]} rt={0.009} rb={0.009} len={w * 0.7} rot={[0, 0, Math.PI / 2]} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
      <Box p={[0, h * 0.93, d / 2 + 0.003]} s={[w * 0.5, h * 0.05, 0.004]} c="#0A2A12" rough={0.3} e="#00FF88" ei={0.5} cast={false} />
    </group>
  );
}

/** Range hood: canopy + chimney + light strip. */
function HoodMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      {/* Chimney */}
      <Box p={[0, h * 0.72, -d * 0.1]} s={[w * 0.3, h * 0.56, d * 0.5]} c={color} rough={0.4} metal={0.5} />
      {/* Canopy — wider at bottom */}
      <Cyl p={[0, h * 0.32, 0]} rt={w * 0.32} rb={w * 0.52} len={h * 0.32} seg={4} c={shade(color, -8)} rough={0.4} metal={0.5} />
      {/* Light strip under canopy */}
      <Box p={[0, h * 0.16, d * 0.1]} s={[w * 0.6, 0.012, d * 0.3]} c="#FFF8E8" rough={0.3} e="#FFEEC8" ei={0.9} cast={false} />
      {/* Filter grille */}
      <Box p={[0, h * 0.3, d * 0.42]} s={[w * 0.7, h * 0.12, 0.006]} c="#3A3A3A" rough={0.6} cast={false} />
    </group>
  );
}

/** Robot vacuum: flat disc + button + bumper. */
function RobotVacuumMesh({ color, w, d, h }: FallbackProps) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Cyl p={[0, h * 0.35, 0]} rt={r} rb={r * 0.94} len={h * 0.7} c={color} rough={0.4} />
      <Cyl p={[0, h * 0.72, 0]} rt={r * 0.96} rb={r * 0.96} len={h * 0.1} c={shade(color, -15)} rough={0.45} />
      <Sph p={[0, h * 0.82, 0]} r={r * 0.18} c="#2A2A2A" rough={0.4} cast={false} />
      <Sph p={[r * 0.5, h * 0.78, 0]} r={0.008} c="#00FF88" rough={0.3} e="#00FF88" ei={1.0} cast={false} />
    </group>
  );
}

/** Water dispenser: cabinet + bottle + taps. */
function WaterDispenserMesh({ color, w, d, h }: FallbackProps) {
  const r = Math.min(w, d) / 2;
  return (
    <group>
      <Box p={[0, h * 0.32, 0]} s={[w, h * 0.64, d]} c={color} rough={0.4} />
      <Cyl p={[0, h * 0.82, 0]} rt={r * 0.78} rb={r * 0.85} len={h * 0.32} c="#7AB8D8" rough={0.15} o={0.55} />
      <Cyl p={[0, h * 0.97, 0]} rt={r * 0.3} rb={r * 0.35} len={h * 0.05} c="#3A6A8A" rough={0.3} />
      {/* Taps */}
      <Cyl p={[-w * 0.18, h * 0.58, d / 2 + 0.01]} rt={0.012} rb={0.012} len={0.05} rot={[Math.PI / 2, 0, 0]} c="#C82020" rough={0.4} cast={false} />
      <Cyl p={[w * 0.18, h * 0.58, d / 2 + 0.01]} rt={0.012} rb={0.012} len={0.05} rot={[Math.PI / 2, 0, 0]} c="#2A5AA8" rough={0.4} cast={false} />
      <Box p={[0, h * 0.42, d / 2 + 0.002]} s={[w * 0.7, h * 0.1, 0.005]} c={shade(color, -12)} rough={0.45} cast={false} />
    </group>
  );
}

/** Gym bench: pad + legs + barbell. */
function GymBenchMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h * 0.45, 0]} s={[w * 0.4, h * 0.12, d * 0.9]} c={color} rough={0.6} />
      {[[-0.3, -0.35], [0.3, -0.35], [-0.3, 0.35], [0.3, 0.35]].map(([lx, lz], i) => (
        <Cyl key={i} p={[lx * w, h * 0.2, lz * d]} rt={0.014} rb={0.014} len={h * 0.4} c="#3A3A3A" metal={0.6} rough={0.4} cast={false} />
      ))}
      {/* Barbell on uprights */}
      <Cyl p={[-w * 0.42, h * 0.78, 0]} rt={0.012} rb={0.012} len={h * 0.4} c="#3A3A3A" metal={0.7} rough={0.35} />
      <Cyl p={[w * 0.42, h * 0.78, 0]} rt={0.012} rb={0.012} len={h * 0.4} c="#3A3A3A" metal={0.7} rough={0.35} />
      <Cyl p={[0, h * 0.82, 0]} rt={0.014} rb={0.014} len={w * 1.1} rot={[0, 0, Math.PI / 2]} c="#888" metal={0.8} rough={0.3} />
      <Cyl p={[-w * 0.5, h * 0.82, 0]} rt={0.07} rb={0.07} len={0.03} rot={[0, 0, Math.PI / 2]} c="#222" metal={0.6} rough={0.4} />
      <Cyl p={[w * 0.5, h * 0.82, 0]} rt={0.07} rb={0.07} len={0.03} rot={[0, 0, Math.PI / 2]} c="#222" metal={0.6} rough={0.4} />
    </group>
  );
}

/** Dumbbell rack: frame + dumbbells. */
function DumbbellRackMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      {/* Frame uprights + shelves */}
      {[-0.4, 0.4].map((fx, i) => (
        <Box key={i} p={[fx * w, h * 0.45, 0]} s={[0.03, h * 0.9, d * 0.9]} c="#3A3A3A" metal={0.6} rough={0.4} />
      ))}
      {[0.25, 0.6].map((fy, i) => (
        <Box key={i} p={[0, h * fy, 0]} s={[w * 0.85, 0.02, d * 0.85]} c="#3A3A3A" metal={0.6} rough={0.4} />
      ))}
      {/* Dumbbells on each shelf */}
      {[0.25, 0.6].map((fy, i) => (
        <group key={i}>
          {[-0.22, 0.22].map((fx, j) => (
            <group key={j} position={[fx * w, h * (fy + 0.06), 0]} rotation={[0, 0, Math.PI / 2]}>
              <Cyl p={[0, 0, 0]} rt={0.012} rb={0.012} len={w * 0.16} c="#888" metal={0.8} rough={0.3} />
              <Sph p={[0, w * 0.09, 0]} r={0.032} c={color} rough={0.5} />
              <Sph p={[0, -w * 0.09, 0]} r={0.032} c={color} rough={0.5} />
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Generic appliance fallback: body + door + handle + display. */
function GenericApplianceMesh({ color, w, d, h }: FallbackProps) {
  return (
    <group>
      <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} rough={0.4} metal={0.25} />
      <Box p={[0, h * 0.5, d / 2 + 0.002]} s={[w * 0.86, h * 0.66, 0.005]} c={shade(color, -14)} rough={0.45} cast={false} />
      <Cyl p={[0, h * 0.86, d / 2 + 0.01]} rt={0.008} rb={0.008} len={w * 0.6} rot={[0, 0, Math.PI / 2]} c="#C8C8C8" metal={0.8} rough={0.3} cast={false} />
      <Box p={[w * 0.3, h * 0.88, d / 2 + 0.004]} s={[w * 0.16, h * 0.07, 0.004]} c="#0A2A12" rough={0.3} e="#00FF88" ei={0.6} cast={false} />
    </group>
  );
}

export function ApplianceMesh({ item, color, sc, w, d, h }: FallbackProps) {
  const id = item.id;
  const name = item.name;
  const has = (...keys: string[]) => keys.some((k) => id.includes(k) || name.includes(k));
  const p = { item, color, sc, w, d, h };

  if (has("microwave", "微波炉")) return <MicrowaveMesh {...p} />;
  if (has("oven", "烤箱")) return <OvenMesh {...p} />;
  if (has("coffee-grinder", "磨豆机")) return <GrinderMesh {...p} />;
  if (has("coffee", "咖啡机", "espresso", "brewer")) return <CoffeeMesh {...p} />;
  if (has("kettle", "水壶", "热水壶")) return <KettleMesh {...p} />;
  if (has("washer", "洗衣机", "dryer", "干衣机")) return <WasherMesh {...p} />;
  if (has("ac-outdoor", "空调外机")) return <AcOutdoorMesh {...p} />;
  if (has("ac-", "空调")) return <AcIndoorMesh {...p} />;
  if (has("wine-fridge", "红酒柜", "drink-fridge", "饮料柜")) return <GlassFridgeMesh {...p} />;
  if (has("hairdryer", "吹风机")) return <HairdryerMesh {...p} />;
  if (has("cooktop", "燃气灶", "灶台")) return <CooktopMesh {...p} />;
  if (has("kitchen-set", "kitchen-combo", "厨房用具", "厨房电器")) return <KitchenApplianceMesh {...p} />;
  if (has("rice-cooker", "电饭煲")) return <RiceCookerMesh {...p} />;
  if (has("toaster", "烤面包")) return <ToasterMesh {...p} />;
  if (has("dishwasher", "洗碗机")) return <DishwasherMesh {...p} />;
  if (has("hood", "油烟机")) return <HoodMesh {...p} />;
  if (has("robot-vacuum", "扫地机器人")) return <RobotVacuumMesh {...p} />;
  if (has("water-dispenser", "饮水机")) return <WaterDispenserMesh {...p} />;
  if (has("gym-treadmill", "跑步机")) return <TreadmillMesh {...p} />;
  if (has("gym-bench", "卧推")) return <GymBenchMesh {...p} />;
  if (has("dumbbell", "哑铃")) return <DumbbellRackMesh {...p} />;
  return <GenericApplianceMesh {...p} />;
}
