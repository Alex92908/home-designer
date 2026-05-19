"use client";

/**
 * InteriorRoomDetail — Phase A+B+C of docs/yard-design-references.md
 * exterior-walkthrough-LOD line.
 *
 * Mounted INSIDE FloorPlanExterior's per-room render loop, only when
 * `insideBuilding` is true. Adds visual detail that brings the
 * exterior walkthrough closer to the 效果图 look WITHOUT touching the
 * underlying wall / floor geometry (those are still owned by
 * FloorPlanExterior). Purely additive — disabling the component or
 * passing insideBuilding=false renders the exterior walkthrough
 * unchanged from before.
 *
 *   A. Baseboards (踢脚线) — thin dark strip along inside wall bases
 *   B. Crown moldings (天花线) — thin strip along inside wall tops
 *   C. Interior point light — warm pointLight at room centre +
 *      a small ceiling-fixture mesh so light has a visible source
 *
 * Coordinates: room is centered at (cx, cz) in world cm; rW/rD are the
 * room dimensions in metres; yBase is the floor's world Y in metres.
 * FloorPlanExterior uses FLOOR_H_M = 2.8 as the ceiling height.
 */

import * as THREE from "three";
import { useMemo } from "react";

const FLOOR_H_M = 2.8;

export interface InteriorRoomDetailProps {
  /** Room centre in world cm — passed straight through from FloorPlanExterior. */
  cx: number;
  cz: number;
  /** Floor world Y in metres (== fi * FLOOR_H_M). */
  yBase: number;
  /** Room width / depth in metres. */
  rW: number;
  rD: number;
  /** Wall paint color — used to harmonise crown molding tone. */
  wallColor: string;
  /** Whether the user is inside the building (FloorPlanExterior already gates
   *  this, but accept as prop so the parent can flip without remounting). */
  enabled?: boolean;
}

/** Darken a hex color by `amount` (0..1). Used for baseboard + crown tone. */
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "#3A3530";
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 0xff) * (1 - amount))));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8)  & 0xff) * (1 - amount))));
  const b = Math.max(0, Math.min(255, Math.round((n        & 0xff) * (1 - amount))));
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

const BASEBOARD_H = 0.10;     // metres — 10 cm strip at floor
const BASEBOARD_T = 0.02;     // metres — 2 cm thick out from wall
const CROWN_H     = 0.08;     // metres — 8 cm strip at ceiling
const CROWN_T     = 0.025;
const FIXTURE_H_DOWN = 0.18;  // light fixture hangs this far below ceiling

/**
 * Renders A+B+C as a single group. Position is implicit: the parent
 * mounts each instance under the room's centred frame already, so
 * relative to (0, yBase, 0) at room centre we draw 4 baseboards, 4
 * crowns, 1 fixture, 1 pointLight.
 */
export function InteriorRoomDetail({
  cx, cz, yBase, rW, rD, wallColor, enabled = true,
}: InteriorRoomDetailProps) {
  // Memo the colors so we don't recompute per frame
  const baseColor  = useMemo(() => shade(wallColor, 0.55), [wallColor]);
  const crownColor = useMemo(() => shade(wallColor, 0.08), [wallColor]);

  if (!enabled) return null;

  // World-cm → metres at the parent level. Position our group at the
  // room centre on the floor. yBase is the floor Y; baseboard sits
  // 5 cm above to avoid Z-fighting with the floor plane.
  const px = cx / 100;
  const pz = cz / 100;
  const py = yBase;

  // Baseboard / crown strip positions, room-local. Walls are oriented
  // so back = -Z, front = +Z, left = -X, right = +X.
  const halfW = rW / 2;
  const halfD = rD / 2;
  const baseY = py + BASEBOARD_H / 2 + 0.005;
  const crownY = py + FLOOR_H_M - CROWN_H / 2 - 0.005;
  const fixtureY = py + FLOOR_H_M - 0.04;

  return (
    <group position={[px, 0, pz]}>
      {/* ── A. BASEBOARDS — 4 walls ── */}
      <mesh position={[0, baseY, -halfD + BASEBOARD_T / 2]} castShadow={false}>
        <boxGeometry args={[rW - 0.02, BASEBOARD_H, BASEBOARD_T]} />
        <meshStandardMaterial color={baseColor} roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh position={[0, baseY,  halfD - BASEBOARD_T / 2]} castShadow={false}>
        <boxGeometry args={[rW - 0.02, BASEBOARD_H, BASEBOARD_T]} />
        <meshStandardMaterial color={baseColor} roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh position={[-halfW + BASEBOARD_T / 2, baseY, 0]} castShadow={false}>
        <boxGeometry args={[BASEBOARD_T, BASEBOARD_H, rD - 0.02]} />
        <meshStandardMaterial color={baseColor} roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh position={[ halfW - BASEBOARD_T / 2, baseY, 0]} castShadow={false}>
        <boxGeometry args={[BASEBOARD_T, BASEBOARD_H, rD - 0.02]} />
        <meshStandardMaterial color={baseColor} roughness={0.55} metalness={0.05} />
      </mesh>

      {/* ── B. CROWN MOLDINGS — 4 walls at ceiling ── */}
      <mesh position={[0, crownY, -halfD + CROWN_T / 2]} castShadow={false}>
        <boxGeometry args={[rW - 0.02, CROWN_H, CROWN_T]} />
        <meshStandardMaterial color={crownColor} roughness={0.7} metalness={0.02} />
      </mesh>
      <mesh position={[0, crownY,  halfD - CROWN_T / 2]} castShadow={false}>
        <boxGeometry args={[rW - 0.02, CROWN_H, CROWN_T]} />
        <meshStandardMaterial color={crownColor} roughness={0.7} metalness={0.02} />
      </mesh>
      <mesh position={[-halfW + CROWN_T / 2, crownY, 0]} castShadow={false}>
        <boxGeometry args={[CROWN_T, CROWN_H, rD - 0.02]} />
        <meshStandardMaterial color={crownColor} roughness={0.7} metalness={0.02} />
      </mesh>
      <mesh position={[ halfW - CROWN_T / 2, crownY, 0]} castShadow={false}>
        <boxGeometry args={[CROWN_T, CROWN_H, rD - 0.02]} />
        <meshStandardMaterial color={crownColor} roughness={0.7} metalness={0.02} />
      </mesh>

      {/* ── C1. CEILING FIXTURE — small disc + warm emissive bulb ── */}
      <mesh position={[0, fixtureY, 0]} castShadow={false}>
        <cylinderGeometry args={[0.18, 0.18, 0.04, 16]} />
        <meshStandardMaterial color="#E8E4DE" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, fixtureY - FIXTURE_H_DOWN, 0]} castShadow={false}>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshStandardMaterial
          color="#FFE5A8" emissive="#FFC95A" emissiveIntensity={1.6}
          roughness={0.4} metalness={0.0} />
      </mesh>

      {/* ── C2. INTERIOR POINT LIGHT — warm, room-sized ── */}
      {/*  Intensity tuned so a 4×4 m room reads as "warmly lit" without
           bloating overall scene brightness when 10+ rooms light up.    */}
      <pointLight
        position={[0, fixtureY - FIXTURE_H_DOWN, 0]}
        color="#FFC580"
        intensity={Math.min(0.9, 0.18 * rW * rD)}
        distance={Math.max(rW, rD) * 1.8}
        decay={2}
        castShadow={false}
      />
    </group>
  );
}

// Ensure THREE is referenced so tree-shaking doesn't drop it.
void THREE;
