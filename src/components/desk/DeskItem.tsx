"use client";

/**
 * DeskItem — renders a single placed item as a detailed 3D object.
 *
 * Dispatches geometry by `category` and applies PBR material from the
 * catalog spec. Everything uses RoundedBox where possible to avoid the
 * dead-giveaway 90° sharp edges that scream "low-poly primitive".
 *
 * When real glTF assets are wired in later, only this component needs
 * updating — the catalog/store stay stable.
 */

import { memo, useMemo } from "react";
import { RoundedBox } from "@react-three/drei";
import type { PlacedItem } from "@/lib/desk/store";
import type { CatalogItem } from "@/lib/desk/catalog";
import { getCatalogItem } from "@/lib/desk/catalog";
import { MATERIAL_MAP, type MaterialSpec } from "./materials";

/** Convert cm → m for Three.js world units */
const CM = (v: number) => v / 100;

interface Props {
  placed:     PlacedItem;
  selected:   boolean;
  onSelect:   (id: string) => void;
}

// ────────────────────────────────────────────────────────
// Material dispatch — standard vs. physical material class
// ────────────────────────────────────────────────────────

function makeMaterialProps(spec: MaterialSpec) {
  return {
    color:              spec.color,
    roughness:          spec.roughness,
    metalness:          spec.metalness,
    emissive:           spec.emissive,
    emissiveIntensity:  spec.emissiveIntensity,
    envMapIntensity:    spec.envMapIntensity ?? 1.0,
  };
}

function makePhysicalProps(spec: MaterialSpec) {
  return {
    color:              spec.color,
    roughness:          spec.roughness,
    metalness:          spec.metalness,
    transmission:       spec.transmission,
    ior:                spec.ior,
    thickness:          spec.thickness,
    clearcoat:          spec.clearcoat,
    clearcoatRoughness: spec.clearcoatRoughness,
    emissive:           spec.emissive,
    emissiveIntensity:  spec.emissiveIntensity,
    envMapIntensity:    spec.envMapIntensity ?? 1.0,
  };
}

function Mat({ spec }: { spec: MaterialSpec }) {
  if (spec.kind === "physical") {
    return <meshPhysicalMaterial {...makePhysicalProps(spec)} />;
  }
  return <meshStandardMaterial {...makeMaterialProps(spec)} />;
}

// ────────────────────────────────────────────────────────
// Per-category geometry renderers
// ────────────────────────────────────────────────────────

/** Desk: rounded top with chamfered edges + sleek legs */
function Desk({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const matSpec   = MATERIAL_MAP[cat.material];
  const accSpec   = MATERIAL_MAP[cat.accent ?? "metal-black"];
  const legT      = 0.04;
  const topT      = 0.032;
  const inset     = 0.05;  // leg inset from desk edge
  const legX      = w / 2 - inset;
  const legZ      = d / 2 - inset;
  return (
    <group>
      {/* Rounded desktop — beveled edges read as quality */}
      <RoundedBox
        args={[w, topT, d]}
        radius={0.008}
        smoothness={3}
        creaseAngle={0.4}
        position={[0, h - topT / 2, 0]}
        castShadow
        receiveShadow
      >
        <Mat spec={matSpec} />
      </RoundedBox>
      {/* 4 legs — slightly rounded metal */}
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([sx, sz], i) => (
        <RoundedBox
          key={i}
          args={[legT, h - topT, legT]}
          radius={0.006}
          smoothness={3}
          position={[sx * legX, (h - topT) / 2, sz * legZ]}
          castShadow
        >
          <Mat spec={accSpec} />
        </RoundedBox>
      ))}
      {/* Crossbar under the back — adds visual weight */}
      <RoundedBox
        args={[w - inset * 2 - legT, 0.02, 0.02]}
        radius={0.004}
        smoothness={3}
        position={[0, 0.18, -(d / 2 - inset - legT / 2)]}
        castShadow
      >
        <Mat spec={accSpec} />
      </RoundedBox>
    </group>
  );
}

/** Monitor: proper bezel + inset screen + sleek stand arm + round base */
function Monitor({ cat }: { cat: CatalogItem }) {
  const [w, , h] = cat.size.map(CM);
  const bezelT   = 0.018;
  const bezelW   = 0.01;   // frame width around screen
  const standH   = 0.14;
  const baseR    = 0.12;
  const mat      = MATERIAL_MAP[cat.material];
  const acc      = MATERIAL_MAP[cat.accent ?? "plastic-black"];
  return (
    <group>
      {/* Circular base */}
      <mesh castShadow receiveShadow position={[0, -h / 2 - standH + 0.013, 0]}>
        <cylinderGeometry args={[baseR, baseR * 1.05, 0.026, 32]} />
        <Mat spec={acc} />
      </mesh>
      {/* Stand arm — tapered rectangle, angled back slightly */}
      <mesh castShadow position={[0, -h / 2 - standH / 2 + 0.01, 0.01]} rotation={[-0.08, 0, 0]}>
        <boxGeometry args={[0.035, standH, 0.045]} />
        <Mat spec={acc} />
      </mesh>
      {/* Bezel — rounded box slightly larger than screen */}
      <RoundedBox
        args={[w, h, bezelT]}
        radius={0.012}
        smoothness={3}
        position={[0, 0, -bezelT / 2]}
        castShadow
      >
        <Mat spec={acc} />
      </RoundedBox>
      {/* Screen — inset into bezel, slightly in front so it glows out */}
      <mesh position={[0, 0, 0.001]}>
        <planeGeometry args={[w - bezelW * 2, h - bezelW * 2]} />
        <Mat spec={mat} />
      </mesh>
      {/* Subtle logo bar at bottom of bezel — faint accent */}
      <mesh position={[0, -h / 2 + 0.008, 0.002]}>
        <planeGeometry args={[0.04, 0.004]} />
        <meshStandardMaterial color="#6366f1" emissive="#6366f1" emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}

/** Chair: padded seat, contoured back, armrests, gas cylinder, 5-wheel base */
function Chair({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const mat       = MATERIAL_MAP[cat.material];
  const acc       = MATERIAL_MAP[cat.accent ?? "metal-black"];
  const seatH     = 0.47;
  const seatT     = 0.09;
  const backT     = 0.08;
  const backH     = h - seatH - seatT - 0.02;
  return (
    <group>
      {/* Padded seat — rounded box, fuller than a plank */}
      <RoundedBox
        args={[w, seatT, d]}
        radius={0.04}
        smoothness={4}
        creaseAngle={0.5}
        position={[0, seatH + seatT / 2, 0]}
        castShadow
        receiveShadow
      >
        <Mat spec={mat} />
      </RoundedBox>
      {/* Backrest — curved by angling slightly back + rounded */}
      <RoundedBox
        args={[w * 0.82, backH, backT]}
        radius={0.04}
        smoothness={4}
        creaseAngle={0.5}
        position={[0, seatH + seatT + backH / 2, -d / 2 + backT / 2 + 0.02]}
        rotation={[-0.1, 0, 0]}
        castShadow
      >
        <Mat spec={mat} />
      </RoundedBox>
      {/* Lumbar pad — little emphasis line on the backrest */}
      <RoundedBox
        args={[w * 0.55, backH * 0.3, backT * 0.3]}
        radius={0.015}
        smoothness={3}
        position={[0, seatH + seatT + backH * 0.35, -d / 2 + backT + 0.012]}
        rotation={[-0.1, 0, 0]}
      >
        <Mat spec={mat} />
      </RoundedBox>
      {/* Armrests — two curved pads on the sides */}
      {[-1, 1].map(sx => (
        <group key={sx}>
          {/* Arm support post */}
          <mesh castShadow position={[sx * (w / 2 - 0.03), seatH + seatT + 0.08, -d / 4]}>
            <boxGeometry args={[0.02, 0.16, 0.02]} />
            <Mat spec={acc} />
          </mesh>
          {/* Arm pad */}
          <RoundedBox
            args={[0.05, 0.025, 0.2]}
            radius={0.01}
            smoothness={3}
            position={[sx * (w / 2 - 0.03), seatH + seatT + 0.175, -d / 4]}
            castShadow
          >
            <Mat spec={mat} />
          </RoundedBox>
        </group>
      ))}
      {/* Gas lift cylinder — tapered for modern feel */}
      <mesh castShadow position={[0, seatH / 2 + 0.05, 0]}>
        <cylinderGeometry args={[0.025, 0.03, seatH - 0.04, 16]} />
        <Mat spec={acc} />
      </mesh>
      {/* Hub — where 5-star base meets column */}
      <mesh castShadow position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.06, 0.05, 0.05, 20]} />
        <Mat spec={acc} />
      </mesh>
      {/* 5-star base legs + caster wheels */}
      {[0, 1, 2, 3, 4].map(i => {
        const angle = (i / 5) * Math.PI * 2;
        const legLen = 0.28;
        return (
          <group key={i} rotation={[0, angle, 0]}>
            {/* leg */}
            <mesh castShadow position={[0, 0.04, legLen / 2 + 0.02]}>
              <boxGeometry args={[0.045, 0.035, legLen]} />
              <Mat spec={acc} />
            </mesh>
            {/* caster wheel (tiny cylinder) */}
            <mesh
              castShadow
              position={[0, 0.022, legLen + 0.02]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.022, 0.022, 0.025, 12]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.6} metalness={0.1} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Lamp: articulated arm + adjustable head (for arm-lamps), or strip */
function Lamp({ cat }: { cat: CatalogItem }) {
  const [w, , h] = cat.size.map(CM);
  const mat      = MATERIAL_MAP[cat.material];
  const acc      = MATERIAL_MAP[cat.accent ?? "plastic-white"];

  // RGB bar — horizontal strip mounted on top of monitor
  if (cat.id === "lamp-rgb-bar") {
    return (
      <group>
        {/* housing */}
        <RoundedBox args={[w, 0.03, 0.035]} radius={0.008} smoothness={3} castShadow>
          <Mat spec={mat} />
        </RoundedBox>
        {/* LED strip underside */}
        <mesh position={[0, -0.017, 0]}>
          <boxGeometry args={[w * 0.95, 0.003, 0.025]} />
          <Mat spec={acc} />
        </mesh>
      </group>
    );
  }

  // Arm-style desk lamp (articulated)
  if (cat.id === "lamp-desk-arm") {
    return (
      <group>
        {/* heavy base */}
        <mesh castShadow position={[0, 0.015, 0]}>
          <cylinderGeometry args={[w / 2 * 0.9, w / 2, 0.03, 24]} />
          <Mat spec={mat} />
        </mesh>
        {/* vertical arm segment */}
        <mesh castShadow position={[0, h * 0.4, 0]} rotation={[-0.1, 0, 0]}>
          <cylinderGeometry args={[0.01, 0.01, h * 0.6, 12]} />
          <Mat spec={mat} />
        </mesh>
        {/* joint */}
        <mesh castShadow position={[0, h * 0.7, 0.03]}>
          <sphereGeometry args={[0.022, 16, 12]} />
          <Mat spec={mat} />
        </mesh>
        {/* horizontal arm */}
        <mesh castShadow position={[0.1, h * 0.75, 0.05]} rotation={[0, 0, -Math.PI / 4]}>
          <cylinderGeometry args={[0.008, 0.008, 0.22, 12]} />
          <Mat spec={mat} />
        </mesh>
        {/* shade */}
        <group position={[0.18, h * 0.62, 0.1]} rotation={[0.3, 0, -0.3]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.04, 0.06, 0.08, 20]} />
            <Mat spec={mat} />
          </mesh>
          {/* bulb inside shade */}
          <mesh position={[0, -0.04, 0]}>
            <sphereGeometry args={[0.028, 16, 12]} />
            <meshStandardMaterial color="#ffdda8" emissive="#ffc673" emissiveIntensity={3.5} />
          </mesh>
        </group>
      </group>
    );
  }

  // Ambient glow lamp — rounded diffuser on a base
  return (
    <group>
      <mesh castShadow position={[0, 0.02, 0]}>
        <cylinderGeometry args={[w / 2 * 0.95, w / 2, 0.035, 24]} />
        <Mat spec={mat} />
      </mesh>
      <mesh castShadow position={[0, h * 0.55, 0]}>
        <sphereGeometry args={[w / 2 * 0.8, 24, 18]} />
        <meshPhysicalMaterial
          color={acc.color ?? "#ffe0b3"}
          roughness={0.4}
          transmission={0.35}
          thickness={0.3}
          emissive={acc.emissive ?? "#ffcc88"}
          emissiveIntensity={1.8}
          envMapIntensity={0.8}
        />
      </mesh>
    </group>
  );
}

/** Keyboard: body + visible keycap grid */
function Keyboard({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const mat       = MATERIAL_MAP[cat.material];
  const acc       = MATERIAL_MAP[cat.accent ?? "plastic-white"];
  const rows      = cat.id === "kb-magic" ? 4 : cat.id === "kb-mech-60" ? 5 : 6;
  const cols      = cat.id === "kb-magic" ? 15 : cat.id === "kb-mech-60" ? 14 : 17;
  const pad       = 0.012;
  const gridW     = w - pad * 2;
  const gridD     = d - pad * 2;
  const keyW      = gridW / cols * 0.88;
  const keyD      = gridD / rows * 0.88;
  const keyH      = 0.008;
  return (
    <group>
      {/* body */}
      <RoundedBox
        args={[w, h, d]}
        radius={0.006}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <Mat spec={mat} />
      </RoundedBox>
      {/* keycap grid — instanced-ish (manual to keep it simple) */}
      {Array.from({ length: rows }).map((_, row) =>
        Array.from({ length: cols }).map((_, col) => {
          const x = -gridW / 2 + (col + 0.5) * (gridW / cols);
          const z = -gridD / 2 + (row + 0.5) * (gridD / rows);
          return (
            <mesh
              key={`${row}-${col}`}
              position={[x, h / 2 + keyH / 2, z]}
              castShadow
            >
              <boxGeometry args={[keyW, keyH, keyD]} />
              <Mat spec={acc} />
            </mesh>
          );
        })
      )}
    </group>
  );
}

/** Mouse: rounded body with subtle hump + scroll wheel */
function Mouse({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const mat       = MATERIAL_MAP[cat.material];
  return (
    <group>
      {/* body — use ellipsoid via scaled sphere, halved to sit flat */}
      <mesh castShadow receiveShadow scale={[w, h * 1.6, d]} position={[0, -h * 0.3, 0]}>
        <sphereGeometry args={[0.5, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2 + 0.15]} />
        <Mat spec={mat} />
      </mesh>
      {/* scroll wheel */}
      <mesh castShadow position={[0, h * 0.5, -d * 0.15]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.006, 0.006, 0.012, 12]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.3} />
      </mesh>
    </group>
  );
}

/** PC tower: chassis, glass side panel, front panel distinction */
function PC({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const mat       = MATERIAL_MAP[cat.material];
  const acc       = MATERIAL_MAP[cat.accent ?? "glass"];

  // Mac Studio-style short block
  if (cat.id === "pc-mac-studio") {
    return (
      <group>
        <RoundedBox
          args={[w, h, d]}
          radius={0.01}
          smoothness={3}
          castShadow
          receiveShadow
        >
          <Mat spec={mat} />
        </RoundedBox>
        {/* Top vent grille hint */}
        <mesh position={[0, h / 2 + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[Math.min(w, d) * 0.35, 32]} />
          <meshStandardMaterial color="#0f0f12" roughness={0.8} metalness={0.1} />
        </mesh>
        {/* Front power LED */}
        <mesh position={[0, -h * 0.3, d / 2 + 0.001]}>
          <circleGeometry args={[0.003, 16]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={3} />
        </mesh>
      </group>
    );
  }

  // Full-tower PC
  return (
    <group>
      {/* chassis */}
      <RoundedBox
        args={[w, h, d]}
        radius={0.012}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <Mat spec={mat} />
      </RoundedBox>
      {/* glass side panel (right side) */}
      <RoundedBox
        args={[0.006, h - 0.08, d - 0.05]}
        radius={0.006}
        smoothness={3}
        position={[w / 2 + 0.002, 0, 0]}
        castShadow
      >
        <Mat spec={acc} />
      </RoundedBox>
      {/* RGB strip inside glass panel — visible through transmission */}
      <mesh position={[w / 2 - 0.01, 0, -d / 2 + 0.02]}>
        <boxGeometry args={[0.01, h * 0.7, 0.008]} />
        <meshStandardMaterial
          color="#ff3bd6"
          emissive="#ff3bd6"
          emissiveIntensity={2.5}
        />
      </mesh>
      {/* front power button */}
      <mesh position={[0, h * 0.35, d / 2 + 0.001]}>
        <cylinderGeometry args={[0.008, 0.008, 0.002, 16]} />
        <meshStandardMaterial
          color="#4ae3ff"
          emissive="#4ae3ff"
          emissiveIntensity={2.5}
        />
      </mesh>
      {/* front top vent hint */}
      {Array.from({ length: 6 }).map((_, i) => (
        <mesh
          key={i}
          position={[0, h / 2 - 0.02 - i * 0.012, d / 2 + 0.001]}
        >
          <boxGeometry args={[w * 0.7, 0.004, 0.001]} />
          <meshStandardMaterial color="#0a0a0c" />
        </mesh>
      ))}
    </group>
  );
}

/** Decor: plant / speaker / book stack */
function Decor({ cat }: { cat: CatalogItem }) {
  const [w, d, h] = cat.size.map(CM);
  const mat       = MATERIAL_MAP[cat.material];
  const acc       = MATERIAL_MAP[cat.accent ?? cat.material];

  // Plant leaf positions — computed unconditionally so hook order is stable
  // (only consumed inside the plant branch below, trivial overhead otherwise)
  const leafPositions = useMemo(() => {
    // Fibonacci-ish arrangement for natural look
    const out: { pos: [number, number, number]; rot: [number, number, number]; scale: number; color: string }[] = [];
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.399;                           // golden angle
      const radius = 0.02 + (i / 9) * 0.04;
      const lift = h * 0.45 + (i / 9) * h * 0.35;
      out.push({
        pos: [Math.cos(angle) * radius, lift, Math.sin(angle) * radius],
        rot: [0.3 + i * 0.05, angle, 0.1],
        scale: 0.75 + Math.random() * 0.35,
        color: i % 3 === 0 ? "#2f5a33" : i % 3 === 1 ? "#3f7040" : "#4c8550",
      });
    }
    return out;
  }, [h]);

  if (cat.id === "decor-plant") {
    const potR = w / 2 * 0.75;
    return (
      <group>
        {/* pot (slightly tapered cylinder) */}
        <mesh castShadow position={[0, h * 0.2, 0]}>
          <cylinderGeometry args={[potR, potR * 0.75, h * 0.4, 24]} />
          <Mat spec={mat} />
        </mesh>
        {/* soil top — dark disc */}
        <mesh position={[0, h * 0.4 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[potR - 0.004, 24]} />
          <meshStandardMaterial color="#2a1d14" roughness={0.95} />
        </mesh>
        {/* stem */}
        <mesh castShadow position={[0, h * 0.55, 0]}>
          <cylinderGeometry args={[0.004, 0.005, h * 0.3, 8]} />
          <meshStandardMaterial color="#3a5a2a" roughness={0.9} />
        </mesh>
        {/* leaves — multiple with variation */}
        {leafPositions.map((l, i) => (
          <mesh key={i} castShadow position={l.pos} rotation={l.rot} scale={l.scale}>
            <sphereGeometry args={[0.04, 14, 10]} />
            <meshStandardMaterial color={l.color} roughness={0.82} envMapIntensity={0.7} />
          </mesh>
        ))}
      </group>
    );
  }

  if (cat.id === "decor-book") {
    // Stack of 3 books with slight rotation and color variation
    const books = [
      { h: h * 0.35, rot: 0.12,  color1: mat, color2: acc },
      { h: h * 0.33, rot: -0.08, color1: acc, color2: mat },
      { h: h * 0.32, rot: 0.05,  color1: mat, color2: acc },
    ];
    let yCursor = 0;
    return (
      <group>
        {books.map((b, i) => {
          const y = yCursor + b.h / 2;
          yCursor += b.h + 0.003;
          return (
            <group key={i} position={[0, y, 0]} rotation={[0, b.rot, 0]}>
              <RoundedBox
                args={[w, b.h, d]}
                radius={0.005}
                smoothness={2}
                castShadow
                receiveShadow
              >
                <Mat spec={b.color1} />
              </RoundedBox>
              {/* spine — slightly lighter band on one side */}
              <mesh position={[-w / 2 - 0.001, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
                <planeGeometry args={[d, b.h]} />
                <Mat spec={b.color2} />
              </mesh>
            </group>
          );
        })}
      </group>
    );
  }

  if (cat.id === "decor-speaker") {
    return (
      <group>
        {/* cabinet */}
        <RoundedBox args={[w, h, d]} radius={0.015} smoothness={3} castShadow receiveShadow>
          <Mat spec={mat} />
        </RoundedBox>
        {/* main driver (large front cone) */}
        <mesh position={[0, h * 0.05, d / 2 + 0.002]}>
          <circleGeometry args={[Math.min(w, h) * 0.32, 24]} />
          <meshStandardMaterial color="#14141a" roughness={0.85} metalness={0.15} />
        </mesh>
        {/* tweeter (small upper circle) */}
        <mesh position={[0, h * 0.35, d / 2 + 0.002]}>
          <circleGeometry args={[0.015, 20]} />
          <meshStandardMaterial color="#0a0a0e" roughness={0.8} metalness={0.2} />
        </mesh>
        {/* fabric grille subtle ring around driver */}
        <mesh position={[0, h * 0.05, d / 2 + 0.0015]}>
          <ringGeometry args={[Math.min(w, h) * 0.32, Math.min(w, h) * 0.35, 24]} />
          <Mat spec={acc} />
        </mesh>
      </group>
    );
  }

  // Fallback decor
  return (
    <RoundedBox args={[w, h, d]} radius={0.008} smoothness={3} castShadow receiveShadow>
      <Mat spec={mat} />
    </RoundedBox>
  );
}

// ────────────────────────────────────────────────────────

const DeskItemInner = memo(function DeskItemInner({ placed, selected, onSelect }: Props) {
  const cat = useMemo(() => getCatalogItem(placed.catalogId), [placed.catalogId]);
  if (!cat) return null;

  // Selection highlight — glowing halo ring
  const selectionRing = selected ? (
    <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.19, 0.23, 48]} />
      <meshBasicMaterial color="#818cf8" transparent opacity={0.85} />
    </mesh>
  ) : null;

  return (
    <group
      position={placed.position}
      rotation={[0, placed.rotY, 0]}
      onClick={(e) => { e.stopPropagation(); onSelect(placed.id); }}
    >
      {cat.category === "desk"     && <Desk cat={cat} />}
      {cat.category === "monitor"  && <Monitor cat={cat} />}
      {cat.category === "chair"    && <Chair cat={cat} />}
      {cat.category === "lamp"     && <Lamp cat={cat} />}
      {cat.category === "keyboard" && <Keyboard cat={cat} />}
      {cat.category === "mouse"    && <Mouse cat={cat} />}
      {cat.category === "pc"       && <PC cat={cat} />}
      {cat.category === "decor"    && <Decor cat={cat} />}
      {selectionRing}
    </group>
  );
});

export default DeskItemInner;
