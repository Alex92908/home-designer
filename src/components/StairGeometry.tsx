"use client";

import { useMemo } from "react";
import * as THREE from "three";

// ─── Types ─────────────────────────────────────────────────────────────────

interface StairCaseProps {
  /** Total width of the staircase in metres */
  width?: number;
  /** Total vertical rise in metres */
  rise?: number;
  /** Number of steps */
  stepCount?: number;
  /** World-space position [x, y, z] */
  position?: [number, number, number];
  /** Euler rotation [x, y, z] in radians */
  rotation?: [number, number, number];
  /** Hex/CSS colour string for the stair material */
  color?: string;
}

interface StairRailingProps {
  width?: number;
  rise?: number;
  stepCount?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  color?: string;
}

interface HouseStairsProps {
  /** Number of storeys */
  floors: number;
  /** Height of each storey in metres */
  floorH?: number;
  /** Building footprint width (X axis) */
  W: number;
  /** Building footprint depth (Z axis) */
  D: number;
}

// ─── Shared material ────────────────────────────────────────────────────────

/** Concrete / stone look — shared across stair meshes. */
function useStairMaterial(color: string) {
  return useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.8,
        metalness: 0.0,
      }),
    [color]
  );
}

// ─── StairCase ───────────────────────────────────────────────────────────────

/**
 * Procedural straight staircase rendered as individual step-tread boxes
 * plus a solid stringer panel underneath the run.
 */
export function StairCase({
  width = 1.2,
  rise = 2.8,
  stepCount = 12,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  color = "#c0bab2",
}: StairCaseProps) {
  const mat = useStairMaterial(color);

  // Derived per-step dimensions.
  const stepRise = rise / stepCount;           // vertical height of each step
  const stepRun  = stepRise * 1.75;            // horizontal depth (≈ comfortable tread ratio)
  const treadH   = stepRise * 0.25;            // thickness of the tread slab

  // Stringer geometry: a box that fills the triangular void under the run.
  const stringerLen = Math.sqrt(
    Math.pow(stepRun * stepCount, 2) + Math.pow(rise, 2)
  );
  const stringerAngle = Math.atan2(rise, stepRun * stepCount);
  const stringerThickness = 0.18;

  const stringerMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color).multiplyScalar(0.85),
        roughness: 0.85,
        metalness: 0.0,
      }),
    [color]
  );

  const steps = useMemo(() => {
    const arr: { x: number; y: number }[] = [];
    for (let i = 0; i < stepCount; i++) {
      arr.push({
        x: i * stepRun + stepRun * 0.5,
        y: (i + 0.5) * stepRise - treadH * 0.5,
      });
    }
    return arr;
  }, [stepCount, stepRise, stepRun, treadH]);

  return (
    <group position={position} rotation={rotation}>
      {/* Step treads */}
      {steps.map(({ x, y }, i) => (
        <mesh
          key={i}
          position={[x, y, 0]}
          castShadow
          receiveShadow
          material={mat}
        >
          <boxGeometry args={[stepRun, treadH, width]} />
        </mesh>
      ))}

      {/* Stringer panel — centred under the run */}
      <mesh
        position={[
          (stepRun * stepCount) * 0.5,
          rise * 0.5 - (rise / 4),
          0,
        ]}
        rotation={[0, 0, stringerAngle]}
        castShadow
        receiveShadow
        material={stringerMat}
      >
        <boxGeometry args={[stringerLen, stringerThickness, width - 0.02]} />
      </mesh>
    </group>
  );
}

// ─── StairRailing ─────────────────────────────────────────────────────────────

/**
 * Two vertical end posts and a horizontal top rail on each side of the stair run.
 */
export function StairRailing({
  width = 1.2,
  rise = 2.8,
  stepCount = 12,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  color = "#8a8a8a",
}: StairRailingProps) {
  const stepRun  = (rise / stepCount) * 1.75;
  const runLen   = stepRun * stepCount;

  const railAngle = Math.atan2(rise, runLen);
  const railLen   = Math.sqrt(runLen * runLen + rise * rise);

  const postH    = 0.9;
  const postR    = 0.04;
  const railR    = 0.03;

  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.6,
        metalness: 0.1,
      }),
    [color]
  );

  const halfW = width * 0.5;

  // Posts are placed at start and end of the run, offset inward slightly.
  const posts: Array<{ x: number; y: number; z: number }> = [
    { x: 0,      y: postH * 0.5,        z: -halfW + postR * 2 },
    { x: runLen, y: rise + postH * 0.5, z: -halfW + postR * 2 },
    { x: 0,      y: postH * 0.5,        z:  halfW - postR * 2 },
    { x: runLen, y: rise + postH * 0.5, z:  halfW - postR * 2 },
  ];

  // Rail centres for the two sides.
  const rails: Array<{ cx: number; cy: number; cz: number }> = [
    { cx: runLen * 0.5, cy: rise * 0.5 + postH, cz: -halfW + postR * 2 },
    { cx: runLen * 0.5, cy: rise * 0.5 + postH, cz:  halfW - postR * 2 },
  ];

  return (
    <group position={position} rotation={rotation}>
      {/* Vertical posts */}
      {posts.map(({ x, y, z }, i) => (
        <mesh key={`post-${i}`} position={[x, y, z]} castShadow material={mat}>
          <cylinderGeometry args={[postR, postR, postH, 8]} />
        </mesh>
      ))}

      {/* Inclined top rails */}
      {rails.map(({ cx, cy, cz }, i) => (
        <mesh
          key={`rail-${i}`}
          position={[cx, cy, cz]}
          rotation={[0, 0, railAngle]}
          castShadow
          material={mat}
        >
          <cylinderGeometry args={[railR, railR, railLen, 8]} />
        </mesh>
      ))}
    </group>
  );
}

// ─── HouseStairs ──────────────────────────────────────────────────────────────

/**
 * External corridor staircase — flush against the right side wall.
 *
 * Each run goes from ground level of one storey to the next, running along
 * the Z axis (building depth direction), centred on the building's midpoint.
 * Adjacent runs alternate direction (dogleg) so they don't overlap on 3+ floor
 * buildings.  A small concrete landing platform connects each run to the wall.
 */
export function HouseStairs({
  floors,
  floorH = 2.8,
  W,
  D,
}: HouseStairsProps) {
  if (floors < 2) return null;

  // Derived geometry for each run
  const STEP_COUNT = 14;
  const stepRise = floorH / STEP_COUNT;
  const stepRun  = stepRise * 1.72;            // comfortable 17cm rise / 30cm tread ratio
  const runLen   = stepRun * STEP_COUNT;       // horizontal run length (≈ 4.4m for 2.8m storey)

  const stairW    = 1.2;                       // tread width
  const wallGap   = 0.08;                      // gap between stair edge and wall face
  // Stair centre sits just outside the right wall (x = W/2 + wallGap + stairW/2)
  const stairCX   = W / 2 + wallGap + stairW / 2;
  const landingD  = 1.0;                       // landing depth (into which the run exits)
  const landingH  = 0.12;

  return (
    <>
      {Array.from({ length: floors - 1 }, (_, i) => {
        const baseY = i * floorH;
        // Alternate direction: even runs go front→back, odd go back→front
        const dir   = i % 2 === 0 ? 1 : -1;
        // Centre run along Z, but clamp if building is shorter than the run
        const runZ  = dir > 0
          ? Math.min(D / 2 - 0.2, runLen / 2)   // start near front, run toward back
          : Math.max(-D / 2 + 0.2, -runLen / 2); // start near back, run toward front
        const rotY  = dir > 0 ? -Math.PI / 2 : Math.PI / 2;

        return (
          <group key={i}>
            {/* Stair treads + stringer */}
            <StairCase
              width={stairW}
              rise={floorH}
              stepCount={STEP_COUNT}
              position={[stairCX, baseY, runZ]}
              rotation={[0, rotY, 0]}
              color="#C8C0B4"
            />
            {/* Guardrail / handrail */}
            <StairRailing
              width={stairW}
              rise={floorH}
              stepCount={STEP_COUNT}
              position={[stairCX, baseY, runZ]}
              rotation={[0, rotY, 0]}
              color="#9A9490"
            />
            {/* Concrete landing at top of run (attached to wall) */}
            <mesh
              position={[
                stairCX,
                baseY + floorH + landingH / 2,
                dir > 0 ? runZ - runLen : runZ + runLen,
              ]}
              castShadow receiveShadow
            >
              <boxGeometry args={[stairW + 0.2, landingH, landingD]} />
              <meshStandardMaterial color="#D0C8BE" roughness={0.9} />
            </mesh>
            {/* Concrete landing at base of run */}
            <mesh
              position={[stairCX, baseY + landingH / 2, runZ]}
              castShadow receiveShadow
            >
              <boxGeometry args={[stairW + 0.2, landingH, landingD]} />
              <meshStandardMaterial color="#D0C8BE" roughness={0.9} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}
