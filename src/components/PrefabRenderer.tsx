"use client";

/**
 * PrefabRenderer — turns a YardPrefab into a fully composed 3D block.
 *
 * Each prefab kind gets its own component. They share a few principles:
 *   • Pure procedural geometry (Box / Cylinder / Extrude) — no GLB
 *     dependencies, so bundle stays small and shapes are deterministic.
 *   • PBR materials via getOutdoorTexture (procedural canvas in textures.ts).
 *   • castShadow / receiveShadow on every solid surface — sunset & night
 *     modes (already wired in HouseCanvas TOD_PRESETS) get dramatic
 *     contact shadows for free.
 *   • Pivot is at world (prefab.x, 0, prefab.z), prefab dimensions are
 *     in metres internally (we convert from cm at the top).
 *
 * To add a new prefab:
 *   1. Add the kind to PrefabKind in src/lib/types.ts
 *   2. Add the param schema + default to src/lib/outdoorPrefabs.ts
 *   3. Add a case to <PrefabMesh> here.
 */

import { useMemo, Suspense } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import type { YardPrefab, PrefabKind } from "@/lib/types";
import { getPrefabDef, resolveParams } from "@/lib/outdoorPrefabs";
import { getOutdoorTexture, outdoorTileSize } from "@/lib/textures";
import { poissonRect } from "@/lib/poissonDisc";
import { GlbPrefabMesh } from "./GlbPrefabMesh";
// 院子结构件用真实 GLB 渲染：按包围盒把模型缩放到目标 footprint（米），
// 并落地（base→y=0）、水平居中。比手搓几何真实得多。
function GlbStructure({ src, sizeM }: { src: string; sizeM: number }) {
  const { scene } = useGLTF(src);
  const obj = useMemo(() => {
    const c = scene.clone(true);
    const box = new THREE.Box3().setFromObject(c);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const footprint = Math.max(size.x, size.z) || 1;
    const s = sizeM / footprint;
    c.position.set(-center.x, -box.min.y, -center.z);
    const g = new THREE.Group();
    g.add(c);
    g.scale.setScalar(s);
    return g;
  }, [scene, sizeM]);
  return <primitive object={obj} />;
}

// 泳池保留程序化 Pool（无边泳池 + 按摩池 + 动画水面），比现有 904 面低模
// GLB 真实得多；其余结构件用真实 GLB。
import { Pool } from "./HouseCanvas";

const PERGOLA_GLB   = "/models/outdoor_structure/pergola/pergola.glb";
const FOUNTAIN_GLB  = "/models/outdoor_structure/water_fountain/water_fountain.glb";
const GRILL_GLB     = "/models/outdoor_structure/outdoor_grill/outdoor_grill.glb";
useGLTF.preload(PERGOLA_GLB);
useGLTF.preload(FOUNTAIN_GLB);
useGLTF.preload(GRILL_GLB);

const CM = 0.01;

// ─── Shared materials (cached, then cloned per-instance) ──────────
// We clone the cached source so each prefab instance can set its own
// repeat without stomping on other meshes using the same matId. The
// underlying canvas data is shared via the source texture's cache.
function useTexturedMat(matId: string, repeat: [number, number] = [1, 1]) {
  return useMemo(() => {
    const src = getOutdoorTexture(matId);
    if (!src) return null;
    const t = src.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [matId, repeat[0], repeat[1]]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ─── Social Island ────────────────────────────────────────────────
// Sunken bench seat ring (open-top "stadium" of cushion blocks),
// circular fire pit at center, kitchen counter behind. The whole thing
// reads as "an architect's social space", not "a fire pit on grass".

function SocialIslandMesh({ params, rot }: {
  params: ReturnType<typeof resolveParams<"social_island">>;
  rot: number;
}) {
  const { sizeM, fireFeature, kitchenFacing, sunkenSeat } = params;
  const W = sizeM.w;
  const D = sizeM.d;

  // Calacatta-ish counter top: use travertine for warmth. Size repeat to
  // the counter scale so we see one slab on top.
  const counterTex = useTexturedMat("outdoor-travertine", [1.0, 0.3]);

  // Convert facing direction to a Y-rotation for the kitchen counter
  const facingRotY: Record<string, number> = {
    south: 0, north: Math.PI, east: -Math.PI / 2, west: Math.PI / 2,
  };
  const kitchenRotY = facingRotY[kitchenFacing] ?? 0;

  return (
    <group rotation={[0, rot, 0]}>
      {/* Recessed deck floor (sunken 35cm, rectangular, travertine) */}
      <group position={[0, -0.35, 0]}>
        <mesh position={[0, -0.05, 0]} receiveShadow>
          <boxGeometry args={[W, 0.10, D]} />
          <meshStandardMaterial
            map={counterTex ?? undefined}
            color={counterTex ? "#FFFFFF" : "#D8CDB8"}
            roughness={0.88}
          />
        </mesh>
        {/* 4 retaining walls of the sunken pit */}
        {[
          { pos: [ 0, 0,  D / 2 + 0.15], dim: [W + 0.3, 0.7, 0.3] },
          { pos: [ 0, 0, -D / 2 - 0.15], dim: [W + 0.3, 0.7, 0.3] },
          { pos: [ W / 2 + 0.15, 0, 0], dim: [0.3, 0.7, D] },
          { pos: [-W / 2 - 0.15, 0, 0], dim: [0.3, 0.7, D] },
        ].map((wall, i) => (
          <mesh key={i} position={wall.pos as [number, number, number]} castShadow receiveShadow>
            <boxGeometry args={wall.dim as [number, number, number]} />
            <meshStandardMaterial color="#7D6E5C" roughness={0.85} />
          </mesh>
        ))}
      </group>

      {/* Sunken bench cushions (3-side U around the fire) */}
      {sunkenSeat && (
        <>
          {/* Back bench (longest, behind the kitchen) */}
          <mesh position={[0, -0.15, -D / 2 + 0.30]} castShadow receiveShadow>
            <boxGeometry args={[W * 0.85, 0.30, 0.45]} />
            <meshStandardMaterial color="#E8DDC9" roughness={0.85} />
          </mesh>
          {/* Side benches */}
          <mesh position={[-W / 2 + 0.30, -0.15, 0.10]} castShadow receiveShadow>
            <boxGeometry args={[0.45, 0.30, D * 0.55]} />
            <meshStandardMaterial color="#E8DDC9" roughness={0.85} />
          </mesh>
          <mesh position={[ W / 2 - 0.30, -0.15, 0.10]} castShadow receiveShadow>
            <boxGeometry args={[0.45, 0.30, D * 0.55]} />
            <meshStandardMaterial color="#E8DDC9" roughness={0.85} />
          </mesh>
          {/* Throw pillows accent — small darker boxes on top of side benches */}
          {[-1, 1].map((sign, i) => (
            <mesh key={i} position={[sign * (W / 2 - 0.30), 0.05, D * 0.10]} castShadow>
              <boxGeometry args={[0.40, 0.10, 0.40]} />
              <meshStandardMaterial color="#3F4A55" roughness={0.95} />
            </mesh>
          ))}
        </>
      )}

      {/* Fire feature — center */}
      {fireFeature === "pit" && (
        <group position={[0, -0.35, D * 0.05]}>
          {/* Stone bowl */}
          <mesh position={[0, 0.15, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.55, 0.65, 0.30, 24]} />
            <meshStandardMaterial color="#5A4D3F" roughness={0.92} />
          </mesh>
          {/* Inner ring */}
          <mesh position={[0, 0.16, 0]} castShadow={false}>
            <cylinderGeometry args={[0.45, 0.45, 0.31, 24]} />
            <meshStandardMaterial color="#1F1612" roughness={1.0} />
          </mesh>
          {/* Glowing embers (emissive disc) */}
          <mesh position={[0, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.40, 24]} />
            <meshStandardMaterial color="#FF7B33" emissive="#E55A1A" emissiveIntensity={1.4} roughness={1.0} />
          </mesh>
          <pointLight position={[0, 0.40, 0]} intensity={2.2} distance={3.5} decay={2} color="#FFA866" />
        </group>
      )}
      {fireFeature === "table" && (
        <mesh position={[0, -0.10, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.6, 0.50, 0.6]} />
          <meshStandardMaterial color="#3A3328" roughness={0.85} />
        </mesh>
      )}

      {/* Kitchen counter — straight-line counter behind the seating, with
          inset hob and sink. Faces according to kitchenFacing. */}
      <group position={[0, 0, -D / 2 - 0.7]} rotation={[0, kitchenRotY, 0]}>
        {/* Counter base */}
        <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
          <boxGeometry args={[Math.min(W, 3.8), 0.90, 0.65]} />
          <meshStandardMaterial color="#7D6E5C" roughness={0.85} />
        </mesh>
        {/* Counter top — calacatta */}
        <mesh position={[0, 0.93, 0]} castShadow receiveShadow>
          <boxGeometry args={[Math.min(W, 3.8) + 0.05, 0.04, 0.70]} />
          <meshStandardMaterial
            map={counterTex ?? undefined}
            color={counterTex ? "#FFFFFF" : "#E8DDC9"}
            roughness={0.45}
            metalness={0.1}
          />
        </mesh>
        {/* Hob (recessed dark rectangle) */}
        <mesh position={[-0.5, 0.96, 0]} castShadow={false}>
          <boxGeometry args={[0.65, 0.02, 0.45]} />
          <meshStandardMaterial color="#1A1A1A" roughness={0.3} metalness={0.6} />
        </mesh>
        {/* Sink (slightly recessed brushed steel) */}
        <mesh position={[0.7, 0.93, 0]} castShadow={false}>
          <boxGeometry args={[0.50, 0.04, 0.40]} />
          <meshStandardMaterial color="#A8A8A8" roughness={0.35} metalness={0.85} />
        </mesh>
        {/* Faucet */}
        <mesh position={[0.7, 1.05, -0.16]} castShadow>
          <cylinderGeometry args={[0.018, 0.020, 0.30, 8]} />
          <meshStandardMaterial color="#C8C8C8" roughness={0.25} metalness={0.95} />
        </mesh>
      </group>

      {/* Decorative planters (box + green foliage-tuft sphere) removed — the
          procedural green balls read as fake (user request to drop these). */}
    </group>
  );
}

// ─── Farm Box ─────────────────────────────────────────────────────
// Raised herb beds. Simple wooden boxes 60cm tall, with darker soil
// inside and instanced foliage tufts. Walking path of crushed gravel
// passes through if pathBetween.

function FarmBoxMesh({ params, rot }: {
  params: ReturnType<typeof resolveParams<"farm_box">>;
  rot: number;
}) {
  const { bedCount, bedShape, cropMix, pathBetween } = params;

  // Lay out bedCount beds in a grid. Each bed: 1.6m × 0.8m × 0.6m tall.
  const BED_W = 1.6, BED_D = 0.8, BED_H = 0.55;
  const GAP = pathBetween ? 0.7 : 0.20;

  // ── Bed layout ─────────────────────────────────────────────────────
  const beds = useMemo(() => {
    const out: Array<{ x: number; z: number }> = [];
    const cols = Math.min(bedCount, 2);
    const rows = Math.ceil(bedCount / cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (out.length >= bedCount) break;
        if (bedShape === "U" && r === rows - 1 && c === Math.floor(cols / 2)) continue;
        out.push({
          x: (c - (cols - 1) / 2) * (BED_W + GAP),
          z: (r - (rows - 1) / 2) * (BED_D + GAP),
        });
      }
    }
    return out;
  }, [bedCount, bedShape, GAP, BED_W, BED_D]);

  // ── Poisson-disc crop points per bed ───────────────────────────────
  // Instead of a fixed 4×2 grid, Bridson sampling fills each bed with
  // naturally spaced plants — no two within minDist of each other.
  // Seed is stable per bed index so layout is deterministic across renders.
  const cropPtsPerBed = useMemo(
    () => beds.map((_, i) =>
      poissonRect(
        BED_W / 2 - 0.12,   // half-width margin
        BED_D / 2 - 0.12,   // half-depth margin
        cropMix === "veggies" ? 0.18 : 0.14,  // tighter for herbs
        i * 17 + 5,          // deterministic per-bed seed
      )
    ),
    [beds, BED_W, BED_D, cropMix],
  );

  const cropColor: Record<typeof cropMix, [string, string, string]> = {
    herbs:   ["#7C9F4A", "#9CB85F", "#6F8E3F"],
    veggies: ["#3F7A2F", "#6FA050", "#85B068"],
    mixed:   ["#7C9F4A", "#9F7AA8", "#85B068"],
  };
  const palette = cropColor[cropMix];

  return (
    <group rotation={[0, rot, 0]}>
      {beds.map((b, i) => {
        const pts = cropPtsPerBed[i];
        return (
        <group key={i} position={[b.x, 0, b.z]}>
          {/* Wood box walls */}
          <mesh position={[0, BED_H / 2 - 0.5, 0]} castShadow receiveShadow>
            <boxGeometry args={[BED_W, BED_H, BED_D]} />
            <meshStandardMaterial color="#7A5530" roughness={0.85} />
          </mesh>
          {/* Soil */}
          <mesh position={[0, BED_H / 2 - 0.5 + 0.27, 0]} receiveShadow>
            <boxGeometry args={[BED_W - 0.10, 0.06, BED_D - 0.10]} />
            <meshStandardMaterial color="#3A2F22" roughness={0.95} />
          </mesh>
          {/* Poisson-disc crop tufts — naturally distributed, never overlapping */}
          {pts.map((pt, k) => {
            // Deterministic per-point variation from seed
            const rng = ((i * 31 + k * 13) % 97) / 97;
            const color = palette[k % palette.length];
            const h     = 0.15 + rng * 0.10;
            const r     = 0.08 + rng * 0.04;
            return (
              <group key={k} position={[pt.x, BED_H / 2 - 0.5 + 0.30, pt.z]}>
                <mesh castShadow>
                  <sphereGeometry args={[r, 7, 5]} />
                  <meshStandardMaterial color={color} roughness={0.95} />
                </mesh>
                {cropMix !== "veggies" && (
                  <mesh position={[0, h * 0.5, 0]} castShadow>
                    <coneGeometry args={[0.035, h, 5]} />
                    <meshStandardMaterial color="#9F7AA8" roughness={0.95} />
                  </mesh>
                )}
              </group>
            );
          })}
        </group>
        );
      })}

      {/* Stainless cable border posts (only if pathBetween — implies formal layout) */}
      {pathBetween && [-1, 1].flatMap(sx =>
        [-1, 1].map(sz => (
          <mesh key={`${sx}_${sz}`}
            position={[sx * (BED_W + 0.6), 0.2, sz * (BED_D * 1.5 + 0.3)]}
            castShadow>
            <cylinderGeometry args={[0.025, 0.025, 1.0, 6]} />
            <meshStandardMaterial color="#8C8C8C" metalness={0.6} roughness={0.4} />
          </mesh>
        ))
      )}
    </group>
  );
}

// ─── Porte-Cochère ────────────────────────────────────────────────
// Concrete canopy on round columns, with the porte-cochère floor implied
// by the zone layer (we don't double-pave). Adds a low evergreen hedge
// on each long side to soften the structure.

function PorteCochereMesh({ params, rot }: {
  params: ReturnType<typeof resolveParams<"porte_cochere">>;
  rot: number;
}) {
  const { carCount, pillarStyle, facingDir, carModel } = params;
  const carSrc = `/models/vehicles/${carModel ?? "bmw_m3_e46.glb"}`;

  const W = carCount * 2.6 + 0.6;   // 2.6m per car + edge margin
  const D = 5.5;                     // car length + 1m of headroom
  const H = 3.0;                     // canopy clear height

  const facingRotY: Record<string, number> = {
    south: 0, north: Math.PI, east: -Math.PI / 2, west: Math.PI / 2,
  };
  const baseRotY = (facingRotY[facingDir] ?? 0) + rot;

  return (
    <group rotation={[0, baseRotY, 0]}>
      {/* Canopy slab — 25cm thick concrete */}
      <mesh position={[0, H + 0.125, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, 0.25, D]} />
        <meshStandardMaterial color="#D8D5CE" roughness={0.85} />
      </mesh>

      {/* Recessed lighting — emissive thin strips on canopy underside */}
      {[-D / 4, D / 4].map((zPos, i) => (
        <mesh key={i} position={[0, H - 0.01, zPos]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[W * 0.85, 0.06]} />
          <meshStandardMaterial color="#FFE8B0" emissive="#FFE8B0" emissiveIntensity={0.8} />
        </mesh>
      ))}

      {/* Pillars — 2 (or 4) corner columns. None means cantilevered. */}
      {pillarStyle !== "none" && [-1, 1].flatMap(sx =>
        [-1, 1].map(sz => {
          // Skip the back two pillars — canopy is conceptually cantilevered
          // from the house wall on the back side. This reads cleaner.
          if (sz === -1) return null;
          return (
            <mesh key={`${sx}_${sz}`}
              position={[sx * (W / 2 - 0.30), H / 2, sz * (D / 2 - 0.30)]}
              castShadow receiveShadow>
              {pillarStyle === "round"
                ? <cylinderGeometry args={[0.18, 0.20, H, 16]} />
                : <boxGeometry args={[0.30, H, 0.30]} />}
              <meshStandardMaterial color="#C8C5BE" roughness={0.85} />
            </mesh>
          );
        })
      )}

      {/* Side hedges removed — the procedural green hedge read as fake/ugly
          (user request to drop these plants). The canopy + curb stand alone. */}

      {/* Demarcating curb at the open (front) edge */}
      <mesh position={[0, 0.05, D / 2 - 0.05]} castShadow={false} receiveShadow>
        <boxGeometry args={[W, 0.10, 0.10]} />
        <meshStandardMaterial color="#9C9690" roughness={0.85} />
      </mesh>

      {/* Single car centred under canopy — one scene instance avoids GPU memory explosion */}
      <Suspense fallback={null}>
        <group position={[0, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <GlbStructure src={carSrc} sizeM={4.3} />
        </group>
      </Suspense>
    </group>
  );
}

// ─── Slat Wall ────────────────────────────────────────────────────
// Vertical wood slats with a recessed back wall. The signature
// "sunset shadow line" element.

function SlatWallMesh({ params, rot }: {
  params: ReturnType<typeof resolveParams<"slat_wall">>;
  rot: number;
}) {
  const { lengthM, heightM, slatCm, gapCm, backWall } = params;
  const SLAT_W = slatCm * CM;
  const GAP   = gapCm  * CM;
  const PITCH = SLAT_W + GAP;
  const SLAT_DEPTH = 0.06;
  const COUNT = Math.max(2, Math.floor(lengthM / PITCH));

  return (
    <group rotation={[0, rot, 0]}>
      {/* Back wall — fair-faced concrete (only if backWall) */}
      {backWall && (
        <mesh position={[0, heightM / 2, -0.04]} castShadow receiveShadow>
          <boxGeometry args={[lengthM, heightM, 0.08]} />
          <meshStandardMaterial color="#A8A39A" roughness={0.9} />
        </mesh>
      )}
      {/* Vertical slats, instanced via simple loop. With a high COUNT this
          could be a problem, but typical garden walls have 50-100 slats. */}
      {Array.from({ length: COUNT }).map((_, i) => {
        const x = -lengthM / 2 + PITCH * (i + 0.5);
        return (
          <mesh key={i} position={[x, heightM / 2, 0.03]} castShadow receiveShadow>
            <boxGeometry args={[SLAT_W, heightM, SLAT_DEPTH]} />
            <meshStandardMaterial color="#5A3F1E" roughness={0.85} />
          </mesh>
        );
      })}
      {/* Bottom curb — rests the slats on a stone plinth */}
      <mesh position={[0, 0.05, 0]} castShadow={false} receiveShadow>
        <boxGeometry args={[lengthM + 0.10, 0.10, 0.20]} />
        <meshStandardMaterial color="#6E6862" roughness={0.85} />
      </mesh>
    </group>
  );
}

function FenceSegmentMesh({ params, rot }: {
  params: ReturnType<typeof resolveParams<"fence_segment">>;
  rot: number;
}) {
  const { lengthM, heightM, slatCm, gapCm } = params;
  const CM = 0.01;
  const SLAT_W = slatCm * CM;
  const GAP    = gapCm  * CM;
  const PITCH  = SLAT_W + GAP;
  const COUNT  = Math.max(2, Math.floor(lengthM / PITCH));
  const DEPTH  = 0.04;

  return (
    <group rotation={[0, rot, 0]}>
      {/* Post at each end */}
      {([-1, 1] as const).map(side => (
        <mesh key={side} position={[side * lengthM / 2, heightM / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.08, heightM + 0.05, 0.08]} />
          <meshStandardMaterial color="#4A3520" roughness={0.9} />
        </mesh>
      ))}
      {/* Two horizontal rails */}
      {[0.3, 0.75].map(frac => (
        <mesh key={frac} position={[0, heightM * frac, 0]} castShadow={false} receiveShadow>
          <boxGeometry args={[lengthM, 0.045, 0.045]} />
          <meshStandardMaterial color="#6B4E30" roughness={0.85} />
        </mesh>
      ))}
      {/* Vertical slats */}
      {Array.from({ length: COUNT }).map((_, i) => {
        const x = -lengthM / 2 + PITCH * (i + 0.5);
        return (
          <mesh key={i} position={[x, heightM / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[SLAT_W, heightM, DEPTH]} />
            <meshStandardMaterial color="#7A5C38" roughness={0.85} />
          </mesh>
        );
      })}
      {/* Stone plinth */}
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <boxGeometry args={[lengthM + 0.08, 0.08, 0.14]} />
        <meshStandardMaterial color="#6E6862" roughness={0.9} />
      </mesh>
    </group>
  );
}

function ParkingAreaMesh({ params, rot }: {
  params: ReturnType<typeof resolveParams<"parking_area">>;
  rot: number;
}) {
  const { spotCount, driveway } = params;
  const SPOT_W = 2.5;  // metres per spot
  const SPOT_D = 5.0;  // depth
  const DRIVE_D = 6.0; // driveway approach
  const totalW = SPOT_W * spotCount;

  return (
    <group rotation={[0, rot, 0]}>
      {/* Concrete parking slab */}
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <boxGeometry args={[totalW, 0.02, SPOT_D]} />
        <meshStandardMaterial color="#A8A49C" roughness={0.95} />
      </mesh>
      {/* Driveway approach strip */}
      {driveway && (
        <mesh position={[0, 0.01, (SPOT_D + DRIVE_D) / 2]} receiveShadow>
          <boxGeometry args={[totalW, 0.02, DRIVE_D]} />
          <meshStandardMaterial color="#9E9A92" roughness={0.95} />
        </mesh>
      )}
      {/* White parking lines */}
      {Array.from({ length: spotCount + 1 }).map((_, i) => {
        const x = -totalW / 2 + i * SPOT_W;
        return (
          <mesh key={i} position={[x, 0.025, 0]}>
            <boxGeometry args={[0.06, 0.01, SPOT_D]} />
            <meshStandardMaterial color="#FFFFFF" roughness={0.6} />
          </mesh>
        );
      })}
      {/* Front kerb */}
      <mesh position={[0, 0.06, -SPOT_D / 2 - 0.05]} receiveShadow>
        <boxGeometry args={[totalW + 0.1, 0.12, 0.10]} />
        <meshStandardMaterial color="#707070" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ─── Top-level dispatcher ─────────────────────────────────────────

export function PrefabMesh({ prefab }: { prefab: YardPrefab }) {
  const def = getPrefabDef(prefab.prefabKind);
  if (!def) return null;
  const wx = prefab.x * CM;
  const wz = prefab.z * CM;
  const rot = prefab.rot ?? 0;

  // Y origin is the ground plane (-0.5 in HouseCanvas convention). All
  // procedural prefab meshes draw FROM the ground UP, so we wrap them
  // at y=-0.5. Structural prefabs (Pool/Pergola/etc) draw from y=0
  // internally, so they get wrapped at y=0 instead.
  // Procedural compound prefabs (use ground-based wrapper)
  if (
    prefab.prefabKind === "social_island" ||
    prefab.prefabKind === "farm_box" ||
    prefab.prefabKind === "porte_cochere" ||
    prefab.prefabKind === "slat_wall" ||
    prefab.prefabKind === "fence_segment" ||
    prefab.prefabKind === "parking_area"
  ) {
    return (
      <group position={[wx, -0.5, wz]}>
        {prefab.prefabKind === "social_island" && (
          <SocialIslandMesh params={resolveParams("social_island", prefab.params)} rot={rot} />
        )}
        {prefab.prefabKind === "farm_box" && (
          <FarmBoxMesh params={resolveParams("farm_box", prefab.params)} rot={rot} />
        )}
        {prefab.prefabKind === "porte_cochere" && (
          <PorteCochereMesh params={resolveParams("porte_cochere", prefab.params)} rot={rot} />
        )}
        {prefab.prefabKind === "slat_wall" && (
          <SlatWallMesh params={resolveParams("slat_wall", prefab.params)} rot={rot} />
        )}
        {prefab.prefabKind === "fence_segment" && (
          <FenceSegmentMesh params={resolveParams("fence_segment", prefab.params)} rot={rot} />
        )}
        {prefab.prefabKind === "parking_area" && (
          <ParkingAreaMesh params={resolveParams("parking_area", prefab.params)} rot={rot} />
        )}
      </group>
    );
  }

  // ─── AI-generated GLB model ────────────────────────────────────
  // "Transformer decomposition": each villa part (pool, pergola, gate…)
  // is a separately generated GLB, loaded here as its own node.
  // partColor overrides all mesh colours; nodeOverrides targets by name.
  if (prefab.prefabKind === "glb_model") {
    if (!prefab.glbSrc) return null;
    const scale = prefab.scale ?? 1;
    return (
      <group position={[wx, -0.5, wz]} rotation={[0, rot, 0]} scale={[scale, scale, scale]}>
        <GlbPrefabMesh
          src={prefab.glbSrc}
          partColor={prefab.partColor}
        />
      </group>
    );
  }

  // ─── Structural prefabs ── 泳池走程序化 Pool，廊架/烤架/喷泉走真实 GLB
  // （GlbStructure 按 footprint 缩放并落地居中），外层只管定位与旋转。
  return (
    <group position={[wx, 0, wz]} rotation={[0, rot, 0]}>
      {prefab.prefabKind === "pool"            && <Pool x={0} z={0} />}
      {prefab.prefabKind === "pergola_classic" && <GlbStructure src={PERGOLA_GLB} sizeM={5} />}
      {prefab.prefabKind === "outdoor_kitchen" && <GlbStructure src={GRILL_GLB} sizeM={2.2} />}
      {prefab.prefabKind === "fountain"        && <GlbStructure src={FOUNTAIN_GLB} sizeM={2.6} />}
    </group>
  );
}

/** Helper exported for tests / linting that just want to know which kinds
 *  the renderer actually supports. */
export const RENDERED_PREFAB_KINDS: PrefabKind[] = [
  "social_island", "farm_box", "porte_cochere", "slat_wall",
  "pool", "pergola_classic", "outdoor_kitchen", "fountain",
  "fence_segment", "parking_area",
  "glb_model",
];
