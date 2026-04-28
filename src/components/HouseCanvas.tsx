"use client";

import { useRef, useMemo, useEffect, useState, Fragment, Suspense, Component, type ReactElement, type ReactNode } from "react";
import { Canvas, useThree, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls, Environment, Html, MeshReflectorMaterial, useGLTF, Clone, Sky } from "@react-three/drei";
import { EffectComposer, SSAO, Bloom, Vignette, BrightnessContrast, SMAA } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";
import { useDesignerStore } from "@/lib/store";
import { getSunPosition3D, formatHour as sunFormatHour } from "@/lib/sunAnalysis";
import { ROOM_DEFS, ExteriorSettings, ExteriorWall, isYardPrefab, isYardZone } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { getOutdoorAssetByKind } from "@/lib/outdoorAssets";
import { DetailedDecor } from "./DetailedDecor";
import { PrefabMesh } from "./PrefabRenderer";
import { ZoneMesh } from "./ZoneRenderer";

// ─── Constants ─────────────────────────────────────────────
const FLOOR_H = 2.8;
const WT      = 0.24;
const OV      = 0.55;   // overhang for pitched roofs
const FLAT_OV = 1.4;    // deep cantilever overhang for modern flat roof

// ─── Footprint ─────────────────────────────────────────────
function useFootprint() {
  const enabledRooms   = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const roomLayout     = useDesignerStore(s => s.floorPlans[s.activeFloor].roomLayout);
  const roomDimensions = useDesignerStore(s => s.floorPlans[s.activeFloor].roomDimensions);
  const indoor = enabledRooms.filter(r => !ROOM_DEFS[r].isOutdoor);
  if (!indoor.length) return { W: 8, D: 6 };
  const xs = indoor.flatMap(r => [roomLayout[r].x, roomLayout[r].x + roomDimensions[r].width]);
  const zs = indoor.flatMap(r => [roomLayout[r].y, roomLayout[r].y + roomDimensions[r].depth]);
  return {
    W: Math.max(4, (Math.max(...xs) - Math.min(...xs)) / 100),
    D: Math.max(3, (Math.max(...zs) - Math.min(...zs)) / 100),
  };
}

// ─── Exterior capture — registers capture fn in store ──────
// Same pattern as RoomCanvas.CameraAndCaptureSetup, but mounted inside
// HouseCanvas so the AI render modal can grab exterior angle shots.
function ExteriorCaptureSetup() {
  const { camera, gl, scene, controls } = useThree();
  const setCameraAndCapture = useDesignerStore(s => s.setCameraAndCapture);

  useEffect(() => {
    setCameraAndCapture((pos, lookAt) => {
      camera.position.set(...pos);
      const target = new THREE.Vector3(...lookAt);
      if (controls) {
        (controls as THREE.EventDispatcher & { target: THREE.Vector3; update: () => void }).target.copy(target);
        (controls as THREE.EventDispatcher & { target: THREE.Vector3; update: () => void }).update();
      } else {
        camera.lookAt(target);
      }
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/jpeg", 0.88);
    });
    return () => setCameraAndCapture(null);
  }, [camera, gl, scene, controls, setCameraAndCapture]);

  return null;
}

// ─── Camera ────────────────────────────────────────────────
// Eye-level perspective — mirrors RoomCanvas style so the exterior feels
// like a natural continuation of the interior room view, not a toy diorama.
function CameraRig({ W, D, floors }: { W: number; D: number; floors: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const h    = floors * FLOOR_H;
    // Wide diagonal view — shows pool foreground + full building height,
    // like the luxury villa reference shots (angled from front-left).
    const diag = Math.sqrt(W * W + D * D);
    const dist = diag * 1.55 + 4;
    // Low diagonal view — pool fills foreground, full building visible
    camera.position.set(dist * 0.52, Math.max(h * 0.65, 3.5), dist * 1.30);
    (camera as THREE.PerspectiveCamera).fov = 52;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    (camera as THREE.PerspectiveCamera).lookAt(0, h * 0.38, 0);
  }, [W, D, floors]);
  return null;
}

// ─── Roof styles ────────────────────────────────────────────

function FlatRoof({ W, D, color }: { W: number; D: number; color: string }) {
  const ov = FLAT_OV;
  const slabW = W + ov * 2, slabD = D + ov * 2;
  return (
    <group>
      {/* Main roof slab — thick for the modernist look */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[slabW, 0.30, slabD]} />
        <meshStandardMaterial color={color} roughness={0.72} metalness={0.01} envMapIntensity={0.35} />
      </mesh>
      {/* Wood soffit — individual walnut slats (horizontal rhythm) running along X axis.
          Slats are visible under the cantilever overhang and give Canny strong parallel
          edge lines that guide SDXL to reproduce the correct roof soffit character. */}
      {(() => {
        const SLAT_W   = 0.090;   // 9 cm slat face width (Z direction)
        const SLAT_GAP = 0.022;   // 2.2 cm shadow gap between slats
        const SLAT_T   = 0.048;   // 4.8 cm slat thickness (Y direction)
        const step     = SLAT_W + SLAT_GAP;
        const numSlats = Math.floor((slabD - 0.04) / step);
        const totalSpan = numSlats * step - SLAT_GAP;
        const startZ   = -totalSpan / 2 + SLAT_W / 2;
        return Array.from({ length: numSlats }).map((_, i) => {
          // Alternate very slightly between two warm tones for natural variation
          const warm = i % 3 === 0 ? "#7A4E22" : i % 3 === 1 ? "#8B5A2B" : "#96622F";
          return (
            <mesh key={i} position={[0, -0.21, startZ + i * step]} receiveShadow castShadow>
              <boxGeometry args={[slabW - 0.06, SLAT_T, SLAT_W]} />
              <meshStandardMaterial
                color={warm}
                roughness={0.38}
                metalness={0.0}
                envMapIntensity={0.65}
                emissive="#1E0A00"
                emissiveIntensity={0.09}
              />
            </mesh>
          );
        });
      })()}
      {/* Dark fascia boards on all 4 edges (thin aluminum-look) */}
      {([
        { pos: [0, 0.05, -(slabD / 2)], args: [slabW + 0.02, 0.42, 0.05] as [number,number,number] },
        { pos: [0, 0.05,  (slabD / 2)], args: [slabW + 0.02, 0.42, 0.05] as [number,number,number] },
        { pos: [-(slabW / 2), 0.05, 0], args: [0.05, 0.42, slabD] as [number,number,number] },
        { pos: [ (slabW / 2), 0.05, 0], args: [0.05, 0.42, slabD] as [number,number,number] },
      ] as Array<{ pos: [number,number,number]; args: [number,number,number] }>).map((p, i) => (
        <mesh key={i} position={p.pos} castShadow>
          <boxGeometry args={p.args} />
          <meshStandardMaterial color="#1C1C1C" roughness={0.40} metalness={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function GableRoofMesh({ geo, color }: { geo: THREE.BufferGeometry; color: string }) {
  const { map, normalMap, roughnessMap } = usePbrSet("roof", "roof_07", [4, 3]);
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial map={map} normalMap={normalMap} roughnessMap={roughnessMap}
        color={color} roughness={0.80} metalness={0.02} envMapIntensity={0.30} side={THREE.DoubleSide} />
    </mesh>
  );
}

function GableRoof({ W, D, color }: { W: number; D: number; color: string }) {
  const H = D * 0.38;
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-(W / 2 + OV), 0);
    shape.lineTo(W / 2 + OV, 0);
    shape.lineTo(0, H);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: D + OV * 2, bevelEnabled: false });
    g.translate(0, 0, -(D / 2 + OV));
    return g;
  }, [W, D]);
  return (
    <Suspense fallback={
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial color={color} roughness={0.80} envMapIntensity={0.25} side={THREE.DoubleSide} />
      </mesh>
    }>
      <GableRoofMesh geo={geo} color={color} />
    </Suspense>
  );
}

function HipRoofMesh({ geo, color }: { geo: THREE.BufferGeometry; color: string }) {
  const { map, normalMap, roughnessMap } = usePbrSet("roof", "roof_07", [4, 3]);
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial map={map} normalMap={normalMap} roughnessMap={roughnessMap}
        color={color} roughness={0.80} metalness={0.02} envMapIntensity={0.28} side={THREE.DoubleSide} />
    </mesh>
  );
}

function HipRoof({ W, D, color, upturn = 0 }: { W: number; D: number; color: string; upturn?: number }) {
  const H = D * 0.38;
  const geo = useMemo(() => {
    const ov = OV, w2 = W / 2 + ov, d2 = D / 2 + ov;
    const rLen = Math.max(0.3, (W - D) / 2);
    const pos = new Float32Array([
      -w2, upturn, -d2,  w2, upturn, -d2,
       w2, upturn,  d2, -w2, upturn,  d2,
      -rLen, H, 0,  rLen, H, 0,
    ]);
    const idx = [0,5,1, 0,4,5, 3,5,4, 3,2,5, 0,3,4, 1,5,2];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [W, D, upturn]);
  return (
    <Suspense fallback={
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial color={color} roughness={0.82} envMapIntensity={0.25} side={THREE.DoubleSide} />
      </mesh>
    }>
      <HipRoofMesh geo={geo} color={color} />
    </Suspense>
  );
}

function MansardRoof({ W, D, color }: { W: number; D: number; color: string }) {
  const lowerH = D * 0.22;
  const shrink = 0.7;
  const iW = W * shrink, iD = D * shrink;
  const lGeo = useMemo(() => {
    const ov = OV, iOv = -OV * 0.3;
    const outer = [[-(W/2+ov),0,-(D/2+ov)],[W/2+ov,0,-(D/2+ov)],[W/2+ov,0,D/2+ov],[-(W/2+ov),0,D/2+ov]];
    const inner = [[-(iW/2+iOv),lowerH,-(iD/2+iOv)],[iW/2+iOv,lowerH,-(iD/2+iOv)],[iW/2+iOv,lowerH,iD/2+iOv],[-(iW/2+iOv),lowerH,iD/2+iOv]];
    const verts: number[] = [...outer.flat(), ...inner.flat()];
    const idx = [0,4,5, 0,5,1, 2,6,7, 2,7,3, 3,7,4, 3,4,0, 1,5,6, 1,6,2];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, [W, D]);
  return (
    <group>
      <mesh geometry={lGeo} castShadow>
        <meshStandardMaterial color={color} roughness={0.88} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, lowerH, 0]} castShadow>
        <boxGeometry args={[iW + OV, 0.18, iD + OV]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
    </group>
  );
}

function ChineseRoof({ W, D, color }: { W: number; D: number; color: string }) {
  return (
    <group>
      <HipRoof W={W} D={D} color={color} upturn={0.55} />
      <mesh position={[0, D * 0.38 + 0.08, 0]} castShadow>
        <boxGeometry args={[Math.max(0.4, W - D), 0.18, 0.28]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      {[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sz],i) => (
        <mesh key={i} position={[sx * (W/2 + OV * 0.7), 0.55 + 0.15, sz * (D/2 + OV * 0.7)]}
          rotation={[0, Math.atan2(sz, sx), Math.PI / 6]} castShadow>
          <boxGeometry args={[0.6, 0.1, 0.15]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function RoofSwitch({ W, D, roofStyle, roofColor }: { W: number; D: number; roofStyle: string; roofColor: string }) {
  switch (roofStyle) {
    case "gable":   return <GableRoof   W={W} D={D} color={roofColor} />;
    case "hip":     return <HipRoof     W={W} D={D} color={roofColor} />;
    case "mansard": return <MansardRoof W={W} D={D} color={roofColor} />;
    case "chinese": return <ChineseRoof W={W} D={D} color={roofColor} />;
    default:        return <FlatRoof    W={W} D={D} color={roofColor} />;
  }
}

// ─── Wall face ──────────────────────────────────────────────
// PBR wall body — loads concrete_wall_007 (smooth plaster / bare concrete).
// All instances use the same fixed repeat so shared-texture mutation is idempotent.
function WallBodyTextured({ width, height, color, wallMaterial }: {
  width: number; height: number; color: string;
  wallMaterial: import("@/lib/types").WallMaterialType;
}) {
  const WALL_REPEAT: [number, number] = [2.0, 1.5];
  const { map, normalMap, roughnessMap } = usePbrSet("wall", "concrete_wall_007", WALL_REPEAT);
  // Render = smooth painted plaster — no coarse texture, just a clean surface.
  // Concrete = exposed bare concrete — apply the full PBR texture.
  const useTexture = wallMaterial === "concrete";
  const normalStr  = wallMaterial === "concrete" ? 1.0 : 0.35;
  const roughness  = wallMaterial === "concrete" ? 0.72 : wallMaterial === "render" ? 0.76 : wallMaterial === "wood" ? 0.82 : wallMaterial === "brick" ? 0.88 : 0.84;
  const envMap     = wallMaterial === "render" ? 0.55 : wallMaterial === "concrete" ? 0.45 : 0.18;
  return (
    <mesh receiveShadow castShadow>
      <boxGeometry args={[width, height, WT]} />
      <meshStandardMaterial
        map={useTexture ? map : undefined}
        normalMap={useTexture ? normalMap : undefined}
        roughnessMap={useTexture ? roughnessMap : undefined}
        normalScale={new THREE.Vector2(normalStr, normalStr)}
        color={color}
        roughness={roughness}
        metalness={0.0}
        envMapIntensity={envMap}
      />
    </mesh>
  );
}

function WallFace({ width, height, color, accentColor, wallMaterial = "render", hasDoor = false, winCount, glassFacade = false, glassFlip = false }: {
  width: number; height: number; color: string; accentColor: string;
  wallMaterial?: import("@/lib/types").WallMaterialType;
  hasDoor?: boolean; winCount: number;
  glassFacade?: boolean;
  /** flip=true: glass protrudes toward local -Z (for walls rotated 180°, so glass faces outward) */
  glassFlip?: boolean;
}) {
  const frameColor = glassFacade ? "#1A1A1A" : accentColor;
  // glassFlip: back wall (rotation=PI) needs glass on local -Z so it appears on the exterior
  const glassZ = glassFlip ? -(WT / 2 + 0.01) : (WT / 2 + 0.01);
  const glassDir = glassFlip ? -1 : 1;

  if (glassFacade) {
    const glassH   = height * 0.87;
    const margin   = (height - glassH) / 2;
    const panelCount = winCount;
    const totalGlassW = width * 0.84;
    const mullionW    = 0.055;
    const panelW  = (totalGlassW - (panelCount - 1) * mullionW) / panelCount;
    const startX  = -totalGlassW / 2 + panelW / 2;
    // Interior warm plane — simulates lit interior visible through glass
    const interiorColor = glassFlip ? "#F2EAD8" : color;

    return (
      <group>
        {/* Wall body — for glassFlip walls, warm interior tone shows through glass */}
        <Suspense fallback={
          <mesh receiveShadow castShadow>
            <boxGeometry args={[width, height, WT]} />
            <meshStandardMaterial color={interiorColor} roughness={0.80} metalness={0.0} />
          </mesh>
        }>
          <WallBodyTextured width={width} height={height} color={interiorColor} wallMaterial={glassFlip ? "render" : (wallMaterial ?? "render")} />
        </Suspense>
        {/* Curtain wall: glass panels + thin aluminum mullions */}
        {Array.from({ length: panelCount }).map((_, i) => {
          const x = startX + i * (panelW + mullionW);
          const isSlider = hasDoor && i === Math.floor(panelCount / 2);
          return (
            <group key={i} position={[x, 0, glassZ]}>
              {/* Outer frame (thin aluminum) */}
              <mesh>
                <boxGeometry args={[panelW + mullionW, glassH + 0.04, 0.07]} />
                <meshStandardMaterial color={frameColor} roughness={0.28} metalness={0.72} envMapIntensity={1.5} />
              </mesh>
              {/* Glass — warm emissive simulates interior lighting glow */}
              <mesh position={[0, 0, glassDir * 0.04]}>
                <boxGeometry args={[panelW - 0.02, glassH - 0.02, 0.04]} />
                <meshPhysicalMaterial color="#CBE8F5" transmission={0.84} ior={1.52} roughness={0.02} metalness={0.0} thickness={0.10} envMapIntensity={4.0} emissive="#FFF0CC" emissiveIntensity={0.12} side={THREE.DoubleSide} />
              </mesh>
              {isSlider && (
                <mesh position={[0, -glassH * 0.18, glassDir * 0.06]}>
                  <boxGeometry args={[panelW - 0.01, 0.04, 0.03]} />
                  <meshStandardMaterial color={frameColor} roughness={0.3} metalness={0.7} />
                </mesh>
              )}
            </group>
          );
        })}
        {hasDoor && (
          <mesh position={[0, -height / 2 + margin * 0.4, glassZ]}>
            <boxGeometry args={[width * 0.16 * 0.5, margin * 0.8, 0.03]} />
            <meshStandardMaterial color={color} roughness={0.75} />
          </mesh>
        )}
      </group>
    );
  }

  // ── Standard punched-window mode (non-flat roofs) ──────────────
  const winW = 1.05, winH = 1.25, winY = height * 0.58;
  const doorW = 1.0, doorH = 2.15;
  const halfW = width / 2;
  const slots = winCount + (hasDoor ? 1 : 0);
  const spacing = width / (slots + 1);
  const windowXs: number[] = [];
  let doorX = 0;
  for (let i = 0; i < slots; i++) {
    const x = -halfW + spacing * (i + 1);
    if (hasDoor && i === Math.floor(slots / 2)) { doorX = x; }
    else { windowXs.push(x); }
  }
  return (
    <group>
      <Suspense fallback={
        <mesh receiveShadow castShadow>
          <boxGeometry args={[width, height, WT]} />
          <meshStandardMaterial color={color} roughness={0.82} metalness={0.0} />
        </mesh>
      }>
        <WallBodyTextured width={width} height={height} color={color} wallMaterial={wallMaterial ?? "render"} />
      </Suspense>
      {windowXs.map((x, i) => (
        <group key={i} position={[x, winY - height / 2, WT / 2 + 0.01]}>
          <mesh><boxGeometry args={[winW + 0.12, winH + 0.12, 0.06]} /><meshStandardMaterial color={accentColor} roughness={0.7} /></mesh>
          <mesh position={[0, 0, 0.04]}><boxGeometry args={[winW, winH, 0.04]} /><meshPhysicalMaterial color="#C8E8F8" transmission={0.90} ior={1.52} roughness={0.02} metalness={0.0} thickness={0.08} envMapIntensity={3.5} /></mesh>
          <mesh position={[0, 0, 0.05]}><boxGeometry args={[winW + 0.04, 0.04, 0.03]} /><meshStandardMaterial color={accentColor} roughness={0.7} /></mesh>
          <mesh position={[0, 0, 0.05]}><boxGeometry args={[0.04, winH + 0.04, 0.03]} /><meshStandardMaterial color={accentColor} roughness={0.7} /></mesh>
        </group>
      ))}
      {hasDoor && (
        <group position={[doorX, doorH / 2 - height / 2, WT / 2 + 0.01]}>
          <mesh><boxGeometry args={[doorW + 0.14, doorH + 0.1, 0.06]} /><meshStandardMaterial color={accentColor} roughness={0.7} /></mesh>
          <mesh position={[0, 0, 0.04]}><boxGeometry args={[doorW, doorH, 0.04]} /><meshStandardMaterial color={accentColor} roughness={0.6} /></mesh>
          <mesh position={[doorW * 0.3, -0.1, 0.08]}><sphereGeometry args={[0.06, 8, 8]} /><meshStandardMaterial color="#C8B060" roughness={0.2} metalness={0.8} /></mesh>
        </group>
      )}
    </group>
  );
}

// ─── Floor shell ────────────────────────────────────────────
function FloorShell({ floorIndex, W, D, settings, totalFloors }: {
  floorIndex: number; W: number; D: number; settings: ExteriorSettings; totalFloors: number;
}) {
  const { wallColor, accentColor, wallMaterial, roofStyle } = settings;
  const H = FLOOR_H;
  const isGround = floorIndex === 0;
  const isModern  = roofStyle === "flat";
  // Modern flat-roof style: bigger windows and glass curtain walls
  const winCountFront = isModern
    ? Math.max(2, Math.floor(W / 1.8))
    : Math.max(1, Math.floor(W / 2.6) - (isGround ? 1 : 0));
  const winCountSide  = isModern
    ? Math.max(1, Math.floor(D / 1.8))
    : Math.max(1, Math.floor(D / 2.6));

  // Slab band color — exposed white concrete between floors (modernist)
  const slabColor = isModern ? "#F2EDE8" : "#C8C0B0";

  return (
    <group position={[0, floorIndex * H, 0]}>
      {/* Floor slab */}
      <mesh receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[W, 0.18, D]} />
        <meshStandardMaterial color="#D0CABB" roughness={0.95} />
      </mesh>
      {/* Front wall */}
      <group position={[0, H / 2, -(D / 2 - WT / 2)]}>
        <WallFace width={W} height={H} color={wallColor} accentColor={accentColor} wallMaterial={wallMaterial}
          hasDoor={isGround} winCount={winCountFront} glassFacade={isModern} />
      </group>
      {/* Back wall */}
      <group position={[0, H / 2, D / 2 - WT / 2]} rotation={[0, Math.PI, 0]}>
        <WallFace width={W} height={H} color={wallColor} accentColor={accentColor} wallMaterial={wallMaterial}
          winCount={winCountFront} glassFacade={isModern} glassFlip={isModern} />
      </group>
      {/* Left side wall */}
      <group position={[-(W / 2 - WT / 2), H / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <WallFace width={D} height={H} color={wallColor} accentColor={accentColor} wallMaterial={wallMaterial}
          winCount={winCountSide} glassFacade={isModern} />
      </group>
      {/* Right side wall */}
      <group position={[W / 2 - WT / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <WallFace width={D} height={H} color={wallColor} accentColor={accentColor} wallMaterial={wallMaterial}
          winCount={winCountSide} glassFacade={isModern} />
      </group>
      {/* Exposed slab band between floors — thicker & more prominent for modern style */}
      {floorIndex < totalFloors - 1 && (
        <mesh position={[0, H, 0]} castShadow receiveShadow>
          <boxGeometry args={[W + (isModern ? 0.10 : 0), isModern ? 0.28 : 0.18, D + (isModern ? 0.10 : 0)]} />
          <meshStandardMaterial color={slabColor} roughness={isModern ? 0.70 : 0.95} envMapIntensity={isModern ? 0.4 : 0.1} />
        </mesh>
      )}
      {/* Slab band at base of upper floors */}
      {floorIndex > 0 && (
        <mesh position={[0, 0.09, 0]} castShadow>
          <boxGeometry args={[W + (isModern ? 0.10 : 0.04), isModern ? 0.28 : 0.22, D + (isModern ? 0.10 : 0.04)]} />
          <meshStandardMaterial color={slabColor} roughness={isModern ? 0.70 : 0.80} envMapIntensity={isModern ? 0.4 : 0.1} />
        </mesh>
      )}
      {/* Glass balcony railing on front face — modern style upper floors only */}
      {isModern && floorIndex > 0 && (
        <group position={[0, 0.28 + 0.55, -(D / 2 + 0.02)]}>
          {/* Glass panel */}
          <mesh>
            <boxGeometry args={[W - 0.12, 1.05, 0.012]} />
            <meshPhysicalMaterial color="#C0DCF0" transmission={0.78} ior={1.52} roughness={0.04} metalness={0.0} envMapIntensity={2.5} />
          </mesh>
          {/* Top handrail — dark anodized aluminum */}
          <mesh position={[0, 0.525, 0.010]}>
            <boxGeometry args={[W - 0.10, 0.045, 0.045]} />
            <meshStandardMaterial color="#1A1A1A" roughness={0.20} metalness={0.82} envMapIntensity={2.0} />
          </mesh>
          {/* Vertical posts every ~2m */}
          {Array.from({ length: Math.ceil(W / 2) + 1 }).map((_, pi) => {
            const px = -W / 2 + 0.06 + pi * (W / Math.ceil(W / 2));
            return (
              <mesh key={pi} position={[px, 0, 0.02]}>
                <boxGeometry args={[0.025, 1.10, 0.025]} />
                <meshStandardMaterial color="#1A1A1A" roughness={0.20} metalness={0.82} />
              </mesh>
            );
          })}
        </group>
      )}
    </group>
  );
}

// ─── Exterior wall decor (per-room) ─────────────────────────
// Each room's RoomState may carry an `exteriorDecor` array pinning items
// (wall lights, mailboxes, numbers, vines…) to the OUTSIDE face of one
// of its 4 walls. In HouseCanvas we aggregate decor from every enabled
// room on every floor, and translate each item's local (u, v) into
// world coords using that room's layout + dimensions. In RoomCanvas the
// same data is rendered at room-local coords (see RoomExteriorDecorLayer
// there).
//
// Convention: decor wall names match WindowConfig (back = -Z, front = +Z
// in ROOM-local coords; left = -X, right = +X). Each decor sits on the
// OUTSIDE face of that wall, normal = outward from the room.

const DECOR_OFFSET = 0.025; // push decor this far off the wall surface

/** Shared with RoomCanvas — renders an exterior decor item. Handles three
 *  visual modes: textured image (has imageUrl), emissive light strip
 *  (id starts with "light-strip-"), or plain colored box. */
function DecorMesh({
  furnitureId, scaleW = 1, scaleH = 1, rotation = 0, selected, onSelect, onDragStart,
}: {
  furnitureId: string; scaleW?: number; scaleH?: number; rotation?: number;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (e: any) => void;
}) {
  const item = getFurnitureById(furnitureId);
  const canvasTex = useMemo(
    () => (item ? makeHouseCanvasDecorTexture(item) : null),
    [item]
  );
  useEffect(() => () => { canvasTex?.dispose(); }, [canvasTex]);
  if (!item) return null;
  const w = (item.width / 100) * scaleW;
  const h = (item.height / 100) * scaleH;
  const d = item.depth / 100;
  const isLightStrip = item.id.startsWith("light-strip-");
  const isVine = item.id === "climbing-vine";
  const hasImage = !!item.imageUrl;
  const detailed = DetailedDecor({ item, w, h, d });

  return (
    <group
      rotation={[0, 0, (rotation * Math.PI) / 180]}
      onPointerDown={(e) => { e.stopPropagation(); onSelect(); onDragStart(e); }}
    >
      {detailed ? detailed : canvasTex ? (
        <mesh position={[0, 0, 0.005]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            map={canvasTex}
            transparent={isVine}
            alphaTest={isVine ? 0.1 : 0}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : hasImage ? (
        <Suspense fallback={
          <mesh position={[0, 0, 0.005]}>
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial color={item.color} side={THREE.DoubleSide} />
          </mesh>
        }>
          <HouseMuralPlane url={item.imageUrl!} w={w} h={h} />
        </Suspense>
      ) : isLightStrip ? (
        <mesh position={[0, 0, d / 2]}>
          <boxGeometry args={[w, h, Math.max(0.01, d)]} />
          <meshStandardMaterial
            color={item.color}
            emissive={item.color}
            emissiveIntensity={1.5}
            roughness={0.3}
          />
        </mesh>
      ) : (
        <mesh position={[0, 0, d / 2]} castShadow>
          <boxGeometry args={[w, h, Math.max(0.02, d)]} />
          <meshStandardMaterial color={item.color} roughness={0.55} metalness={0.3} />
        </mesh>
      )}
      {selected && (
        <>
          <mesh position={[0, h / 2 + 0.015, 0.01]}>
            <boxGeometry args={[w + 0.04, 0.02, 0.01]} />
            <meshBasicMaterial color="#22C55E" />
          </mesh>
          <mesh position={[0, -h / 2 - 0.015, 0.01]}>
            <boxGeometry args={[w + 0.04, 0.02, 0.01]} />
            <meshBasicMaterial color="#22C55E" />
          </mesh>
          <mesh position={[-w / 2 - 0.015, 0, 0.01]}>
            <boxGeometry args={[0.02, h, 0.01]} />
            <meshBasicMaterial color="#22C55E" />
          </mesh>
          <mesh position={[w / 2 + 0.015, 0, 0.01]}>
            <boxGeometry args={[0.02, h, 0.01]} />
            <meshBasicMaterial color="#22C55E" />
          </mesh>
        </>
      )}
    </group>
  );
}

/** Suspense-loaded mural plane — the same pattern as RoomCanvas's
 *  MuralPlane: useLoader caches by URL globally and the mesh mounts only
 *  once the image is ready, so murals show reliably on add (no async
 *  setState timing quirks). */
function HouseMuralPlane({ url, w, h }: { url: string; w: number; h: number }) {
  const tex = useLoader(THREE.TextureLoader, url);
  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
  }, [tex]);
  return (
    <mesh position={[0, 0, 0.005]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} side={THREE.DoubleSide} />
    </mesh>
  );
}

function makeHouseCanvasDecorTexture(item: import("@/lib/types").FurnitureItem): THREE.CanvasTexture | null {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  const drawCouplet = (chars: string[], bgColor: string) => {
    const W = 256, H = 1536;
    c.width = W; c.height = H;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#F0D070";
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.fillStyle = "#F8E090";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${W * 0.68}px "Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", serif`;
    const slotH = H / chars.length;
    chars.forEach((ch, i) => ctx.fillText(ch, W / 2, slotH * (i + 0.5)));
  };
  const drawPlate = (text: string, bg: string[], textColor: string) => {
    const W = 800, H = 320;
    c.width = W; c.height = H;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, bg[0]); grad.addColorStop(0.5, bg[1]); grad.addColorStop(1, bg[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#484A4C"; ctx.lineWidth = 8;
    ctx.strokeRect(12, 12, W - 24, H - 24);
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fs = text.length <= 3 ? H * 0.75 : H * 0.55;
    ctx.font = `bold ${fs}px "Arial Black", "Heiti SC", "Microsoft YaHei", sans-serif`;
    ctx.fillText(text, W / 2, H / 2 + 6);
  };

  const drawMeander = () => {
    const W = 1200, H = 100;
    c.width = W; c.height = H;
    ctx.fillStyle = "#7A3518"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#D4A030"; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 5); ctx.lineTo(W, 5);
    ctx.moveTo(0, H - 5); ctx.lineTo(W, H - 5);
    ctx.stroke();
    for (let x = 0; x < W; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x + 10, 30); ctx.lineTo(x + 90, 30);
      ctx.lineTo(x + 90, 50); ctx.lineTo(x + 30, 50);
      ctx.lineTo(x + 30, 70); ctx.lineTo(x + 70, 70);
      ctx.lineTo(x + 70, 10);
      ctx.stroke();
    }
  };
  const drawFloral = () => {
    const W = 1200, H = 100;
    c.width = W; c.height = H;
    ctx.fillStyle = "#F0EADB"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#8A4A18"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 5); ctx.lineTo(W, 5);
    ctx.moveTo(0, H - 5); ctx.lineTo(W, H - 5);
    ctx.stroke();
    for (let x = 0; x < W; x += 120) {
      ctx.beginPath();
      ctx.moveTo(x + 20, 50);
      ctx.quadraticCurveTo(x + 40, 25, x + 60, 50);
      ctx.quadraticCurveTo(x + 80, 75, x + 100, 50);
      ctx.stroke();
      ctx.fillStyle = "#B87030"; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.arc(x + 60, 50, 18, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#8A4A18";
      ctx.beginPath(); ctx.arc(x + 60, 50, 10, 0, Math.PI * 2); ctx.fill();
    }
  };
  const drawIvy = () => {
    const W = 400, H = 600;
    c.width = W; c.height = H;
    ctx.fillStyle = "#5A4028"; ctx.fillRect(0, 0, W, H);
    const leaf = (cx: number, cy: number, color: string, alpha: number, size = 22) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.strokeStyle = "#1A3A18"; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy - size);
      ctx.quadraticCurveTo(cx - size, cy - size * 0.5, cx - size * 0.6, cy + size * 0.5);
      ctx.quadraticCurveTo(cx, cy + size, cx + size * 0.6, cy + size * 0.5);
      ctx.quadraticCurveTo(cx + size, cy - size * 0.5, cx, cy - size);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - size); ctx.lineTo(cx, cy + size); ctx.stroke();
      ctx.restore();
    };
    for (let y = 0; y < H; y += 50) {
      for (let x = 0; x < W; x += 40) {
        const ox = (Math.floor(y / 50) % 2 === 0) ? 0 : 20;
        leaf(x + ox, y, "#2D5A2A", 0.95);
      }
    }
    for (let y = 25; y < H; y += 50) {
      for (let x = 20; x < W; x += 40) leaf(x, y, "#3A7030", 0.85, 20);
    }
    ctx.strokeStyle = "#4A3020"; ctx.lineWidth = 3; ctx.globalAlpha = 0.7;
    [50, 200, 350].forEach(sx => {
      ctx.beginPath(); ctx.moveTo(sx, 0);
      for (let y = 0; y <= H; y += 30) ctx.lineTo(sx + Math.sin(y / 40) * 20, y);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  };

  if (item.id === "couplet-spring")        drawCouplet(["春","回","大","地","千","山","秀"], "#C82020");
  else if (item.id === "couplet-prosperity") drawCouplet(["万","事","如","意","福","满","门"], "#A81818");
  else if (item.id === "house-number")     drawPlate("888", ["#D0D2D4","#E8EAEC","#A8ABAE"], "#1A1C1E");
  else if (item.id === "nameplate-family") drawPlate("之家", ["#D4A85A","#F0C878","#8A6528"], "#3A2410");
  else if (item.id === "border-meander")   drawMeander();
  else if (item.id === "border-floral")    drawFloral();
  else if (item.id === "climbing-vine")    drawIvy();
  else return null;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Compute the world-space transform for one room's exterior wall
 *  surface. Input is the room's world-centered X/Z (meters) + room
 *  dimensions + room height + which wall.
 *
 *  The returned frame is oriented so that inside the frame:
 *    local +X = "right" when standing outside the wall looking at it
 *    local +Y = up
 *    local +Z = outward normal (away from the room interior)
 */
function roomWallFrame(
  roomCx: number, roomCz: number, roomW: number, roomD: number, roomH: number,
  wall: import("@/lib/types").ExteriorWall,
): { position: [number, number, number]; rotation: [number, number, number]; wallW: number; wallH: number } {
  const y = roomH / 2;
  const off = DECOR_OFFSET;
  switch (wall) {
    case "back":  return { position: [roomCx, y, roomCz - roomD / 2 - off], rotation: [0, Math.PI, 0],     wallW: roomW, wallH: roomH };
    case "front": return { position: [roomCx, y, roomCz + roomD / 2 + off], rotation: [0, 0, 0],           wallW: roomW, wallH: roomH };
    case "left":  return { position: [roomCx - roomW / 2 - off, y, roomCz], rotation: [0, -Math.PI / 2, 0], wallW: roomD, wallH: roomH };
    case "right": return { position: [roomCx + roomW / 2 + off, y, roomCz], rotation: [0,  Math.PI / 2, 0], wallW: roomD, wallH: roomH };
  }
}

function WallFrame({
  decorRoom, wall, roomCx, roomCz, roomW, roomD, roomH, yOffset,
  items, selectedId, setSelected, draggingIdRef, orbitRef, updateDecor,
}: {
  /** Owning room — needed so updateDecor knows where to patch. */
  decorRoom: import("@/lib/types").RoomType;
  wall: import("@/lib/types").ExteriorWall;
  roomCx: number; roomCz: number; roomW: number; roomD: number; roomH: number;
  /** World Y offset for multi-floor stacking. */
  yOffset: number;
  items: Array<import("@/lib/types").ExteriorWallDecorItem>;
  selectedId: string | null;
  setSelected: (id: string | null) => void;
  draggingIdRef: React.MutableRefObject<string | null>;
  orbitRef: React.MutableRefObject<any>;
  updateDecor: (room: import("@/lib/types").RoomType, id: string, patch: Partial<import("@/lib/types").ExteriorWallDecorItem>) => void;
}) {
  const { position, rotation, wallW, wallH } = roomWallFrame(roomCx, roomCz, roomW, roomD, roomH, wall);
  const groupRef = useRef<THREE.Group>(null);
  // 5px threshold before a pointer-down counts as a drag — prevents
  // click jitter from nudging decor position on tap/click.
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pastThresholdRef = useRef(false);

  const onDragMove = (e: any) => {
    const id = draggingIdRef.current;
    if (!id || !groupRef.current) return;
    if (!pastThresholdRef.current && pointerStartRef.current) {
      const dx = e.clientX - pointerStartRef.current.x;
      const dy = e.clientY - pointerStartRef.current.y;
      if (Math.hypot(dx, dy) < 5) return;
      pastThresholdRef.current = true;
    }
    const worldPt = e.point as THREE.Vector3;
    const local = groupRef.current.worldToLocal(worldPt.clone());
    const u = local.x / wallW + 0.5;
    const v = local.y / wallH + 0.5;
    const clampedU = Math.max(0.04, Math.min(0.96, u));
    const clampedV = Math.max(0.04, Math.min(0.96, v));
    updateDecor(decorRoom, id, { u: clampedU, v: clampedV });
  };
  const onDragEnd = () => {
    if (draggingIdRef.current) {
      draggingIdRef.current = null;
      pointerStartRef.current = null;
      pastThresholdRef.current = false;
      if (orbitRef.current) orbitRef.current.enabled = true;
    }
  };

  // Apply yOffset on top of roomWallFrame's Y (which is roomH/2 for this
  // floor's slice). The whole frame group's final world Y = yOffset + roomH/2.
  const finalPosition: [number, number, number] = [position[0], position[1] + yOffset, position[2]];

  return (
    <group ref={groupRef} position={finalPosition} rotation={rotation}>
      {/* Invisible drag plane */}
      <mesh
        position={[0, 0, 0.002]}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerLeave={onDragEnd}
      >
        <planeGeometry args={[wallW, wallH]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {items.map(d => (
        <group
          key={d.instanceId}
          position={[(d.u - 0.5) * wallW, (d.v - 0.5) * wallH, 0.01]}
        >
          <DecorMesh
            furnitureId={d.furnitureId}
            scaleW={d.scaleW}
            scaleH={d.scaleH}
            rotation={d.rotation}
            selected={selectedId === d.instanceId}
            onSelect={() => setSelected(d.instanceId)}
            onDragStart={(e: any) => {
              draggingIdRef.current = d.instanceId;
              pointerStartRef.current = { x: e.clientX, y: e.clientY };
              pastThresholdRef.current = false;
              if (orbitRef.current) orbitRef.current.enabled = false;
            }}
          />
        </group>
      ))}
    </group>
  );
}

/** Aggregator: walks every enabled room on every floor, computes its
 *  world-centered X/Z (via roomLayout + roomDimensions), and renders a
 *  WallFrame per decor'd wall. The room's world center is derived the
 *  same way as `useFootprint` computes the house bbox — rooms layout
 *  in cm with Y-down screen coords → world: (layout.x - minX) - W*50
 *  shifts the cm-origin to house center. */
function WallDecorLayer({
  W, D, orbitRef,
}: {
  W: number; D: number;
  orbitRef: React.MutableRefObject<any>;
}) {
  const floorPlans = useDesignerStore(s => s.floorPlans);
  const selectedId = useDesignerStore(s => s.selectedExteriorDecorId);
  const setSelected = useDesignerStore(s => s.setSelectedExteriorDecor);
  const updateDecor = useDesignerStore(s => s.updateRoomExteriorDecor);
  const draggingIdRef = useRef<string | null>(null);

  const frames: ReactElement[] = [];
  floorPlans.forEach((plan, floorIdx) => {
    const indoor = plan.enabledRooms.filter(r => !ROOM_DEFS[r].isOutdoor);
    if (indoor.length === 0) return;
    const xs = indoor.flatMap(r => [plan.roomLayout[r].x, plan.roomLayout[r].x + plan.roomDimensions[r].width]);
    const zs = indoor.flatMap(r => [plan.roomLayout[r].y, plan.roomLayout[r].y + plan.roomDimensions[r].depth]);
    const minX = Math.min(...xs), minZ = Math.min(...zs);
    const planW_m = (Math.max(...xs) - minX) / 100;
    const planD_m = (Math.max(...zs) - minZ) / 100;
    for (const room of indoor) {
      const decor = plan.rooms[room]?.exteriorDecor;
      if (!decor || decor.length === 0) continue;
      const dims = plan.roomDimensions[room];
      const lay = plan.roomLayout[room];
      // Room world center (meters), relative to the whole-house footprint
      // centered at world origin.
      const roomCx = ((lay.x + dims.width / 2) - minX) / 100 - planW_m / 2;
      const roomCz = ((lay.y + dims.depth / 2) - minZ) / 100 - planD_m / 2;
      const roomW  = dims.width / 100;
      const roomD  = dims.depth / 100;
      // Use ROOM_DEFS height for the storey's interior height. HouseCanvas
      // itself stacks floors via FLOOR_H; we match that so the decor
      // aligns with its floor slab.
      const roomH  = FLOOR_H;
      const yOff   = floorIdx * FLOOR_H;
      const walls: import("@/lib/types").ExteriorWall[] = ["front", "back", "left", "right"];
      for (const wall of walls) {
        const items = decor.filter(d => d.wall === wall);
        if (items.length === 0) continue;
        frames.push(
          <WallFrame
            key={`${floorIdx}-${room}-${wall}`}
            decorRoom={room}
            wall={wall}
            roomCx={roomCx} roomCz={roomCz}
            roomW={roomW} roomD={roomD} roomH={roomH}
            yOffset={yOff}
            items={items}
            selectedId={selectedId}
            setSelected={setSelected}
            draggingIdRef={draggingIdRef}
            orbitRef={orbitRef}
            updateDecor={updateDecor}
          />
        );
      }
    }
  });

  // `W`, `D` parameters are unused at the moment (kept for call-site
  // backward compatibility).
  void W; void D;
  return <>{frames}</>;
}

/** Catches failures from drei's <Environment> — most commonly a CDN
 *  fetch error on the Poly Haven HDR used by presets like "sunset" /
 *  "apartment". Without this, a network failure crashes the whole
 *  Canvas; with it, we gracefully degrade to ambient + directional. */
class HouseEnvironmentFallback extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error) {
    console.warn(`[HouseCanvas.Environment] HDR fetch failed: ${err.message}`);
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

// ─── Foundation ─────────────────────────────────────────────
function Foundation({ W, D, color }: { W: number; D: number; color: string }) {
  return (
    <mesh position={[0, -0.25, 0]} receiveShadow>
      <boxGeometry args={[W + 0.3, 0.5, D + 0.3]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

// ─── Tree variations ─────────────────────────────────────────
// Deterministic 0..1 hash from (x,z) so each tree gets a stable random
// look across re-renders without needing useMemo per instance.
function treeHash(x: number, z: number, salt = 0): number {
  const v = Math.sin(x * 12.9898 + z * 78.233 + salt * 31.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Map our high-level tree archetype → Kenney Nature Kit GLB filename.
 *  All assets share a unified stylized low-poly art direction so the whole
 *  yard reads as one cohesive scene (not the previous mix of procedural
 *  cones + PBR concrete that read amateur). */
const KENNEY_TREE_MAP: Record<string, string> = {
  round:   "tree_oak",
  pine:    "tree_pineDefaultA",
  palm:    "tree_palmTall",
  cypress: "tree_pineTallA",
  olive:   "tree_default",
  topiary: "tree_blocks",
  boxwood: "plant_bushLarge",
};

/** Kenney models are authored ~1 unit per game-tile (~0.4m), so a raw
 *  oak comes out only ~1m tall. Our scene is in real meters with a 2.8m
 *  storey height, so we scale 3-5x to get realistic tree heights (3-5m
 *  for canopy trees, 4-7m for tall conifers). */
const KENNEY_TREE_BASE_SCALE: Record<string, number> = {
  tree_oak:          4.5,
  tree_pineDefaultA: 5.0,
  tree_palmTall:     5.5,
  tree_pineTallA:    6.0,
  tree_default:      4.0,
  tree_blocks:       3.5,
  plant_bushLarge:   2.0,
};

function KenneyAsset({ name, scale = 1, rotY = 0 }: { name: string; scale?: number; rotY?: number }) {
  const { scene } = useGLTF(`/models/kenney_nature/${name}.glb`);
  useMemo(() => {
    scene.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).castShadow = true;
        (o as THREE.Mesh).receiveShadow = true;
      }
    });
  }, [scene]);
  return <Clone object={scene} scale={scale} rotation={[0, rotY, 0]} />;
}

// ─── Technical-drawing Kenney asset ─────────────────────────────────
// Loads the same Kenney GLB but overrides ALL materials with a flat-shaded
// single colour from the technical-drawing palette, and adds a back-face
// outline overlay (classic toon trick). This is what makes the same
// underlying low-poly geometry read as "architectural model" rather than
// "Minecraft tree". One outline pass per asset = no global postprocessing
// changes required.
//
// `colorOverride` lets the caller force a specific palette colour (for
// hero trees that should pop). When undefined, picks the technical
// default for the asset's category.
const TECH_OUTLINE_COLOR = "#1F1F1F";
const TECH_OUTLINE_SCALE = 1.035;

function TechKenneyAsset({
  glbName, scale = 1, rotY = 0, colorOverride,
}: {
  glbName: string;
  scale?: number;
  rotY?: number;
  colorOverride?: string;
}) {
  const { scene } = useGLTF(`/models/kenney_nature/${glbName}.glb`);

  // Build two scene clones: one with the flat-shaded fill material, one
  // with the back-face outline material. We must clone both because each
  // clone gets its own materials — sharing would tint everything together.
  const { fill, outline } = useMemo(() => {
    const fillRoot = scene.clone(true);
    const outlineRoot = scene.clone(true);

    fillRoot.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.material = new THREE.MeshStandardMaterial({
          color: colorOverride ?? "#8FA386",
          roughness: 0.95,
          metalness: 0,
          flatShading: true,
        });
      }
    });
    outlineRoot.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) {
        m.castShadow = false;
        m.receiveShadow = false;
        m.material = new THREE.MeshBasicMaterial({
          color: TECH_OUTLINE_COLOR,
          side: THREE.BackSide,
        });
      }
    });

    return { fill: fillRoot, outline: outlineRoot };
  }, [scene, colorOverride]);

  return (
    <group scale={scale} rotation={[0, rotY, 0]}>
      <primitive object={fill} />
      <primitive object={outline} scale={[TECH_OUTLINE_SCALE, TECH_OUTLINE_SCALE, TECH_OUTLINE_SCALE]} />
    </group>
  );
}

// ─── Real PBR asset (Sketchfab) ───────────────────────────────────
// Used when an OutdoorAsset has customGltfPath set. Loads the real GLTF
// and renders WITHOUT the technical-drawing material override — the
// asset's own PBR materials carry the visual fidelity.
//
// CRITICAL: auto-normalises the model to a target real-world height
// using its bounding box. Sketchfab models come in arbitrary units
// (cm, m, inches, blender 1u=1m, blender 1u=1cm) — without this
// auto-norm, an "olive tree" can be 200m tall AND no per-asset scale
// number will fit. We measure once on first load and cache.
const _bboxCache = new Map<string, { height: number; minY: number }>();

function PbrSketchfabAsset({
  gltfPath, targetHeightM, userScale = 1, rotY = 0, groundAlign = true,
}: {
  gltfPath: string;
  /** Auto-normalise model height to this many metres. When set,
   *  overrides any raw scale calculation. */
  targetHeightM?: number;
  /** Multiplier on TOP of the auto-normalised scale (for jitter / hero
   *  emphasis). Default 1.0 — i.e. exactly the target height. */
  userScale?: number;
  rotY?: number;
  /** Translate the model so its bottom sits at y=0. Default true. */
  groundAlign?: boolean;
}) {
  const { scene } = useGLTF(gltfPath);

  // Compute (or read cached) bounding box. Done once per gltfPath —
  // model geometry doesn't change, so neither does its native size.
  const { autoScale, yOffset } = useMemo(() => {
    let bbox = _bboxCache.get(gltfPath);
    if (!bbox) {
      const box = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      bbox = { height: size.y || 1, minY: box.min.y };
      _bboxCache.set(gltfPath, bbox);
    }
    const auto = targetHeightM != null && bbox.height > 0
      ? targetHeightM / bbox.height
      : 1;
    // After scaling, the bottom of the model sits at minY * autoScale.
    // To put it on the ground (y=0), offset by -minY * autoScale.
    const off = groundAlign ? -bbox.minY * auto : 0;
    return { autoScale: auto, yOffset: off };
    // gltfPath is the cache key; targetHeightM/groundAlign are config.
    // scene reference is stable per gltfPath via useGLTF cache.
  }, [gltfPath, targetHeightM, groundAlign]); // eslint-disable-line react-hooks/exhaustive-deps

  useMemo(() => {
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }, [scene]);

  const finalScale = autoScale * userScale;
  return (
    <group position={[0, yOffset * userScale, 0]} rotation={[0, rotY, 0]}>
      <Clone object={scene} scale={finalScale} />
    </group>
  );
}

// ─── HEAD-check cache for Sketchfab GLB availability ─────────────
// We can't synchronously know if a file exists. The naive approach
// (let useGLTF try and 404) makes the Next.js dev overlay scream every
// render. So we HEAD-fetch once per path on first use, cache the
// result, and only show the PBR component if the file is confirmed
// present. While pending we render the styled-Kenney fallback; when
// the HEAD resolves to 200 the component re-renders and swaps in.
const _gltfAvailable = new Map<string, boolean>();
const _gltfPending = new Map<string, Promise<boolean>>();
const _gltfWaiters = new Map<string, Set<() => void>>();

function useGltfAvailable(path: string | undefined): boolean {
  // Hook order must be stable across renders — call useState + useEffect
  // unconditionally, branch INSIDE them.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    if (_gltfAvailable.has(path)) return;     // already known
    if (!_gltfPending.has(path)) {
      const p = fetch(path, { method: "HEAD" })
        .then(r => { _gltfAvailable.set(path, r.ok); return r.ok; })
        .catch(() => { _gltfAvailable.set(path, false); return false; });
      _gltfPending.set(path, p);
      p.then(() => {
        const set = _gltfWaiters.get(path);
        if (set) { set.forEach(fn => fn()); set.clear(); }
      });
    }
    // Subscribe this component's force-render to the eventual resolve.
    let set = _gltfWaiters.get(path);
    if (!set) { set = new Set(); _gltfWaiters.set(path, set); }
    const fn = () => setTick(n => n + 1);
    set.add(fn);
    return () => { set!.delete(fn); };
  }, [path]);
  if (!path) return false;
  return _gltfAvailable.get(path) ?? false;   // pending → false
}

// Restricted technical-drawing palette. Architects pick 3-5 muted tones,
// not 30. These map asset.kind → fill colour.
function techColorForAsset(kind: string, category: string): string {
  if (category === "tree") {
    if (kind.includes("cypress") || kind.includes("pine"))    return "#4F6B47";
    if (kind.includes("olive"))                                return "#7A8A6E";
    if (kind.includes("palm"))                                 return "#5C7A52";
    if (kind.includes("maple"))                                return "#A86C5C";  // muted terracotta
    if (kind.includes("bonsai"))                               return "#4A5A40";
    return "#5B7754";  // default broadleaf
  }
  if (category === "plant") {
    if (kind.includes("flower"))                               return "#C8A8B8";  // muted mauve, all flowers
    if (kind.includes("bush"))                                 return "#6B8266";
    if (kind.includes("cactus"))                               return "#7A8E5C";
    if (kind.includes("grass"))                                return "#7C8A5A";
    return "#7A8A6E";
  }
  if (category === "rock") {
    if (kind.includes("tall") || kind.includes("stoneTall"))   return "#7E7C75";
    return "#9A9A92";
  }
  // feature
  if (kind.includes("crop"))                                   return "#7C8A5A";
  if (kind.includes("campfire"))                               return "#3F2D1E";
  if (kind.includes("fence"))                                  return "#7A6E58";
  return "#A8A39A";
}

/** Render every YardItem the user dropped on the 院子图 editor.
 *  v2 dispatch: zones first (so paving sits under everything), then
 *  singleton primitives (legacy), then prefabs (compound blocks on top). */
const EMPTY_YARD_ITEMS_3D: import("@/lib/types").YardItem[] = [];
function YardPlanItems3D() {
  const activeFloor = useDesignerStore(s => s.activeFloor);
  const items = useDesignerStore(s => s.floorPlans[activeFloor].yardPlan?.items ?? EMPTY_YARD_ITEMS_3D);

  // Render order matters for visual layering:
  //   zones (paving) → singletons → prefabs (often the largest mass)
  const zones    = items.filter(isYardZone);
  const prefabs  = items.filter(isYardPrefab);
  const singles  = items.filter(it => !isYardZone(it) && !isYardPrefab(it));

  return (
    <group>
      {/* ── Zones — flat polygon paving that all other items sit on ── */}
      {zones.map(z => <ZoneMesh key={z.id} zone={z} />)}

      {/* ── Prefabs — compound spatial blocks ── */}
      {prefabs.map(p => <PrefabMesh key={p.id} prefab={p} />)}

      {/* ── Singletons — load the actual Kenney GLB through the technical
            -drawing wrapper (flat-shaded fill + back-face outline). The
            same low-poly mesh that previously read as "Minecraft toy" now
            reads as "architectural model" because (a) the geometry is
            real, not a primitive cap, and (b) the flat-shaded muted fill
            + black outline is the canonical Vectorworks / SketchUp Style
            Builder vocabulary. Suspense fallback is a tiny grey post so
            users see SOMETHING during GLB load. ── */}
      {singles.map(it => (
        <SingletonItem key={it.id} item={it as import("@/lib/types").YardSingleton} />
      ))}
    </group>
  );
}

// ─── Procedural outdoor furniture — photo-quality PBR materials ─────────────
// Used as fallback when the Sketchfab GLTF isn't downloaded yet. The geometry
// is accurate in scale and proportion; materials are crafted to read as luxury
// outdoor pieces under ACES filmic tonemapping + HDR IBL.
function ProceduralFurnitureMesh({ kind }: { kind: string }) {
  if (kind === "furniture.chaiseLounger" || kind === "furniture.swimmingLounger") {
    // Teak-framed lounger with thick ecru cushion + adjustable backrest
    const isPool = kind === "furniture.swimmingLounger";
    const cushionColor = isPool ? "#F0EDE0" : "#F5F0E8";
    return (
      <group>
        {/* Teak frame base */}
        <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.05, 0.07, 0.76]} />
          <meshStandardMaterial color="#7A5C38" roughness={0.75} metalness={0.0} />
        </mesh>
        {/* Four legs */}
        {([-0.88, 0.88] as number[]).flatMap(lx =>
          ([-0.28, 0.28] as number[]).map((lz, j) => (
            <mesh key={`${lx}${lz}`} position={[lx, 0.06, lz]} castShadow>
              <boxGeometry args={[0.06, 0.12, 0.06]} />
              <meshStandardMaterial color="#6A4C28" roughness={0.8} />
            </mesh>
          ))
        )}
        {/* Thick cushion */}
        <mesh position={[0, 0.225, 0]} castShadow>
          <boxGeometry args={[1.88, 0.09, 0.64]} />
          <meshStandardMaterial color={cushionColor} roughness={0.88} metalness={0.0} />
        </mesh>
        {/* Adjustable backrest (raised ~35°) */}
        <mesh position={[-0.60, 0.34, 0]} rotation={[0, 0, 0.60]} castShadow>
          <boxGeometry args={[0.68, 0.07, 0.64]} />
          <meshStandardMaterial color="#7A5C38" roughness={0.75} />
        </mesh>
        <mesh position={[-0.60, 0.40, 0]} rotation={[0, 0, 0.60]} castShadow>
          <boxGeometry args={[0.60, 0.07, 0.56]} />
          <meshStandardMaterial color={cushionColor} roughness={0.88} />
        </mesh>
        {/* Headrest pillow */}
        <mesh position={[-0.93, 0.50, 0]} castShadow>
          <boxGeometry args={[0.28, 0.07, 0.44]} />
          <meshStandardMaterial color={cushionColor} roughness={0.90} />
        </mesh>
      </group>
    );
  }

  if (kind === "furniture.outdoorSofa") {
    // 3-seat outdoor sectional — powder-coated aluminium frame + thick cushions
    return (
      <group>
        {/* Base frame */}
        <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.40, 0.36, 0.90]} />
          <meshStandardMaterial color="#3A3A3A" roughness={0.35} metalness={0.70} />
        </mesh>
        {/* Seat cushion */}
        <mesh position={[0, 0.42, 0]} castShadow>
          <boxGeometry args={[2.20, 0.14, 0.72]} />
          <meshStandardMaterial color="#E8E2D4" roughness={0.86} metalness={0.0} />
        </mesh>
        {/* Backrest frame */}
        <mesh position={[0, 0.72, -0.35]} castShadow receiveShadow>
          <boxGeometry args={[2.40, 0.58, 0.12]} />
          <meshStandardMaterial color="#3A3A3A" roughness={0.35} metalness={0.70} />
        </mesh>
        {/* Back cushion */}
        <mesh position={[0, 0.70, -0.28]} castShadow>
          <boxGeometry args={[2.20, 0.50, 0.14]} />
          <meshStandardMaterial color="#E8E2D4" roughness={0.86} metalness={0.0} />
        </mesh>
        {/* Armrests */}
        {([-1.14, 1.14] as number[]).map((ax, i) => (
          <mesh key={i} position={[ax, 0.55, -0.04]} castShadow>
            <boxGeometry args={[0.12, 0.26, 0.82]} />
            <meshStandardMaterial color="#3A3A3A" roughness={0.35} metalness={0.70} />
          </mesh>
        ))}
      </group>
    );
  }

  if (kind === "furniture.parasol") {
    // Market-style canvas parasol — octagonal canopy, aluminium pole
    return (
      <group>
        {/* Base weight */}
        <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.28, 0.32, 0.16, 12]} />
          <meshStandardMaterial color="#484848" roughness={0.5} metalness={0.6} />
        </mesh>
        {/* Pole */}
        <mesh position={[0, 1.38, 0]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 2.76, 8]} />
          <meshStandardMaterial color="#B0B0B0" roughness={0.25} metalness={0.85} />
        </mesh>
        {/* Hub */}
        <mesh position={[0, 2.55, 0]}>
          <sphereGeometry args={[0.06, 8, 6]} />
          <meshStandardMaterial color="#909090" roughness={0.3} metalness={0.8} />
        </mesh>
        {/* 8 ribs */}
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2;
          const rx = Math.cos(a) * 1.55, rz = Math.sin(a) * 1.55;
          const mx = rx / 2, mz = rz / 2;
          const len = Math.sqrt(rx*rx + 1.1*1.1 + rz*rz);
          const angleX = Math.atan2(1.1, Math.sqrt(rx*rx+rz*rz));
          return (
            <mesh key={i} position={[mx, 2.55 - 0.55, mz]}
              rotation={[-angleX * (Math.cos(a) > 0 ? 1 : -1) * 0.5, a + Math.PI / 2, angleX * 0.5]}
              castShadow>
              <cylinderGeometry args={[0.012, 0.012, 1.72, 4]} />
              <meshStandardMaterial color="#909090" roughness={0.3} metalness={0.8} />
            </mesh>
          );
        })}
        {/* Canvas canopy — ecru with slight translucency */}
        <mesh position={[0, 2.46, 0]} rotation={[Math.PI * 0.04, 0, 0]} castShadow>
          <coneGeometry args={[1.72, 0.46, 8, 1, true]} />
          <meshStandardMaterial color="#F2ECD8" roughness={0.92} metalness={0.0} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 2.22, 0]}>
          <coneGeometry args={[1.68, 0.05, 8, 1, false]} />
          <meshStandardMaterial color="#F2ECD8" roughness={0.92} metalness={0.0} />
        </mesh>
      </group>
    );
  }

  if (kind === "furniture.coffeeTable") {
    // Stone-topped coffee table — marble-look top + brushed steel legs
    return (
      <group>
        {/* Marble-look tabletop */}
        <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.10, 0.05, 0.65]} />
          <meshStandardMaterial color="#E8E4DC" roughness={0.18} metalness={0.08} envMapIntensity={1.2} />
        </mesh>
        {/* Apron */}
        <mesh position={[0, 0.38, 0]} castShadow>
          <boxGeometry args={[1.00, 0.04, 0.55]} />
          <meshStandardMaterial color="#C0BCBA" roughness={0.4} metalness={0.5} />
        </mesh>
        {/* 4 legs */}
        {([-0.42, 0.42] as number[]).flatMap(lx =>
          ([-0.22, 0.22] as number[]).map((lz, j) => (
            <mesh key={`${lx}${lz}`} position={[lx, 0.20, lz]} castShadow>
              <cylinderGeometry args={[0.025, 0.025, 0.40, 8]} />
              <meshStandardMaterial color="#B8B4B0" roughness={0.2} metalness={0.85} />
            </mesh>
          ))
        )}
      </group>
    );
  }

  if (kind === "furniture.diningSet") {
    // Outdoor dining set — 4-seat rattan table + chairs
    return (
      <group>
        {/* Dining table */}
        <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.60, 0.05, 0.90]} />
          <meshStandardMaterial color="#E2DDD0" roughness={0.55} metalness={0.05} envMapIntensity={0.8} />
        </mesh>
        {/* Table legs */}
        {([-0.65, 0.65] as number[]).flatMap(lx =>
          ([-0.35, 0.35] as number[]).map((lz) => (
            <mesh key={`${lx}${lz}`} position={[lx, 0.36, lz]} castShadow>
              <cylinderGeometry args={[0.028, 0.028, 0.72, 8]} />
              <meshStandardMaterial color="#5A5048" roughness={0.6} metalness={0.3} />
            </mesh>
          ))
        )}
        {/* 4 chairs — 2 each side, slightly outside table */}
        {([[-0.58, -0.68], [0.58, -0.68], [-0.58, 0.68], [0.58, 0.68]] as [number,number][]).map(([cx, cz], i) => (
          <group key={i} position={[cx, 0, cz]} rotation={[0, cz > 0 ? Math.PI : 0, 0]}>
            {/* Seat */}
            <mesh position={[0, 0.44, 0]} castShadow>
              <boxGeometry args={[0.46, 0.06, 0.42]} />
              <meshStandardMaterial color="#D8C8A8" roughness={0.80} />
            </mesh>
            {/* Seat cushion */}
            <mesh position={[0, 0.51, 0.02]}>
              <boxGeometry args={[0.40, 0.05, 0.36]} />
              <meshStandardMaterial color="#F0EAD8" roughness={0.88} />
            </mesh>
            {/* Backrest */}
            <mesh position={[0, 0.74, -0.18]} castShadow>
              <boxGeometry args={[0.44, 0.42, 0.06]} />
              <meshStandardMaterial color="#D8C8A8" roughness={0.80} />
            </mesh>
            {/* Legs */}
            {([-0.18, 0.18] as number[]).flatMap(lx =>
              ([-0.16, 0.16] as number[]).map(lz => (
                <mesh key={`${lx}${lz}`} position={[lx, 0.22, lz]} castShadow>
                  <cylinderGeometry args={[0.015, 0.015, 0.44, 6]} />
                  <meshStandardMaterial color="#5A5048" roughness={0.6} metalness={0.3} />
                </mesh>
              ))
            )}
          </group>
        ))}
      </group>
    );
  }

  if (kind === "furniture.fireplace") {
    // Bioethanol outdoor fireplace — black steel cube with glass front + flame
    return (
      <group>
        {/* Steel body */}
        <mesh position={[0, 0.50, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.90, 1.00, 0.35]} />
          <meshStandardMaterial color="#1E1E1E" roughness={0.20} metalness={0.85} />
        </mesh>
        {/* Glass front panel */}
        <mesh position={[0, 0.55, 0.18]}>
          <boxGeometry args={[0.72, 0.52, 0.01]} />
          <meshPhysicalMaterial color="#88CCEE" transparent opacity={0.28} roughness={0.0} metalness={0.0} envMapIntensity={3.0} />
        </mesh>
        {/* Flame glow */}
        <mesh position={[0, 0.48, 0.12]}>
          <planeGeometry args={[0.30, 0.28]} />
          <meshStandardMaterial color="#FF7820" emissive="#FF5810" emissiveIntensity={2.5} transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
        {/* Base plinth */}
        <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.00, 0.10, 0.45]} />
          <meshStandardMaterial color="#1E1E1E" roughness={0.20} metalness={0.85} />
        </mesh>
      </group>
    );
  }

  if (kind === "furniture.planter") {
    // Tall concrete/ceramic planter with tropical plant inside
    return (
      <group>
        {/* Pot body */}
        <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.28, 0.22, 0.64, 14]} />
          <meshStandardMaterial color="#B0A898" roughness={0.88} metalness={0.0} />
        </mesh>
        {/* Soil top */}
        <mesh position={[0, 0.64, 0]}>
          <cylinderGeometry args={[0.26, 0.26, 0.02, 14]} />
          <meshStandardMaterial color="#5A4030" roughness={1.0} />
        </mesh>
        {/* Plant stem */}
        <mesh position={[0, 0.90, 0]} castShadow>
          <cylinderGeometry args={[0.025, 0.03, 0.52, 6]} />
          <meshStandardMaterial color="#4A6030" roughness={0.9} />
        </mesh>
        {/* Leaf cluster */}
        {Array.from({ length: 7 }).map((_, i) => {
          const a = (i / 7) * Math.PI * 2;
          const tilt = 0.7 + Math.random() * 0.5;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.18, 1.10 + i * 0.04, Math.sin(a) * 0.18]}
              rotation={[tilt, a, 0]} castShadow>
              <planeGeometry args={[0.32, 0.10]} />
              <meshStandardMaterial color="#3A6830" roughness={0.85} side={THREE.DoubleSide} />
            </mesh>
          );
        })}
      </group>
    );
  }

  // Generic fallback for unknown furniture kinds
  return (
    <mesh position={[0, 0.3, 0]} castShadow>
      <boxGeometry args={[0.8, 0.6, 0.8]} />
      <meshStandardMaterial color="#C0B8A8" roughness={0.7} metalness={0.1} />
    </mesh>
  );
}

// One yard singleton — pulled out as its own component so we can call
// useGltfAvailable (a hook) without violating the rules of hooks
// (would otherwise be inside .map). HEAD-checks the customGltfPath; if
// the file is present, render PBR. If 404 / missing / pending, render
// the styled-Kenney fallback. No ErrorBoundary needed — we never
// attempt to load a known-missing file.
function SingletonItem({ item: it }: { item: import("@/lib/types").YardSingleton }) {
  const asset = getOutdoorAssetByKind(it.kind);
  // ALWAYS call hooks unconditionally — pass undefined when not applicable
  const sketchfabReady = useGltfAvailable(asset?.customGltfPath);
  if (!asset) return null;
  const wx  = it.x / 100;
  const wz  = it.z / 100;
  const s   = it.scale ?? 1;
  const rot = it.rot ?? 0;
  const h1 = treeHash(it.x, it.z, 1);
  const h2 = treeHash(it.x, it.z, 7);
  // Furniture: no organic tilt/jitter — placed items should be perfectly upright
  const isFurniture = asset.category === "furniture";
  const tilt = isFurniture ? 0 : (h1 - 0.5) * 0.04;
  const yawJitter = isFurniture ? 0 : (h2 - 0.5) * 0.4;
  const sJitter = isFurniture ? 1 : (0.92 + h1 * 0.16);
  const kenneyScale = asset.scale * s * sJitter;
  const sketchfabUserScale = s * sJitter;
  const fillColor = techColorForAsset(it.kind, asset.category);

  // Only render if a real PBR model is confirmed present.
  // No Kenney fallback, no procedural fallback — fake geometry is worse than nothing.
  if (!asset.customGltfPath) return null;

  return (
    <group position={[wx, -0.5, wz]} rotation={[tilt, rot + yawJitter, 0]}>
      <Suspense fallback={null}>
        {sketchfabReady ? (
          <PbrSketchfabAsset
            key={`pbr:${asset.customGltfPath}`}
            gltfPath={asset.customGltfPath}
            targetHeightM={asset.customTargetHeightM}
            userScale={isFurniture ? s : sketchfabUserScale}
            groundAlign={asset.customGroundAlign ?? true}
          />
        ) : null}
      </Suspense>
    </group>
  );
}

function Tree({ x, z, type = "round", scale = 1 }: {
  x: number; z: number;
  type?: "round" | "pine" | "palm" | "cypress" | "olive" | "topiary" | "boxwood";
  scale?: number;
}) {
  const s = scale;
  // Per-tree deterministic variation — adds organic asymmetry without
  // making every tree visibly different (formal landscapes need rhythm).
  const h1 = treeHash(x, z, 0);
  const h2 = treeHash(x, z, 1);
  const h3 = treeHash(x, z, 2);

  // SketchUp Free aesthetic: flat-shaded technical preview geometry.
  // Kenney GLBs read as "kids' game" not "design tool" — disabled in
  // favor of the simple procedural variants below (muted colors, clean
  // silhouettes, no textures).
  void KENNEY_TREE_MAP; void KENNEY_TREE_BASE_SCALE; // keep refs alive

  if (type === "olive") {
    // Olive — silvery-green sparse foliage on a gnarled trunk. Signature
    // Mediterranean / luxury villa tree.
    const trunkH = 1.4 + h1 * 0.3;
    const foliageY = trunkH + 0.6;
    return (
      <group position={[x, 0, z]} scale={[s, s, s]} rotation={[0, h2 * Math.PI * 2, 0]}>
        {/* Gnarled multi-segment trunk */}
        <mesh position={[0, trunkH * 0.45, 0]} castShadow>
          <cylinderGeometry args={[0.18, 0.28, trunkH, 8]} />
          <meshStandardMaterial color="#7A6450" roughness={0.95} />
        </mesh>
        <mesh position={[0.05, trunkH * 0.85, 0.04]} rotation={[0.1, 0, 0.15]} castShadow>
          <cylinderGeometry args={[0.14, 0.18, 0.5, 7]} />
          <meshStandardMaterial color="#7A6450" roughness={0.95} />
        </mesh>
        {/* Sparse silvery-green canopy — multiple overlapping spheres */}
        {[
          [0, 0, 0, 0.95],
          [0.55, 0.05, 0.2, 0.7],
          [-0.5, -0.05, -0.15, 0.75],
          [0.15, 0.2, -0.4, 0.6],
          [-0.2, 0.15, 0.45, 0.65],
        ].map(([dx, dy, dz, r], i) => (
          <mesh key={i} position={[dx, foliageY + (dy as number), dz as number]} castShadow>
            <sphereGeometry args={[r as number, 11, 9]} />
            <meshStandardMaterial color={i % 2 === 0 ? "#8FA078" : "#9FB088"} roughness={0.95} />
          </mesh>
        ))}
      </group>
    );
  }

  if (type === "topiary") {
    // Perfectly clipped sphere on a tidy short trunk. Formal entryway.
    return (
      <group position={[x, 0, z]} scale={[s, s, s]}>
        <mesh position={[0, 0.4, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.10, 0.8, 8]} />
          <meshStandardMaterial color="#5A4028" roughness={0.95} />
        </mesh>
        <mesh position={[0, 1.45, 0]} castShadow>
          <sphereGeometry args={[0.65, 16, 14]} />
          <meshStandardMaterial color="#2E5C26" roughness={0.95} />
        </mesh>
        {/* Inner shadow tone for depth */}
        <mesh position={[0, 1.45, 0]} castShadow>
          <sphereGeometry args={[0.55, 12, 10]} />
          <meshStandardMaterial color="#1F4818" roughness={0.95} transparent opacity={0.3} />
        </mesh>
      </group>
    );
  }

  if (type === "boxwood") {
    // Formal cuboid hedge — used in repeated rows along driveways / borders.
    return (
      <group position={[x, 0, z]} scale={[s, s, s]}>
        <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.8, 0.9]} />
          <meshStandardMaterial color="#2C5A22" roughness={0.95} />
        </mesh>
        {/* Top tone for soft highlight */}
        <mesh position={[0, 0.81, 0]} castShadow>
          <boxGeometry args={[0.85, 0.04, 0.85]} />
          <meshStandardMaterial color="#3A6E2C" roughness={0.95} />
        </mesh>
      </group>
    );
  }

  if (type === "pine") {
    // Slightly less uniform: jitter trunk + foliage colours per instance.
    const tint = (base: number) => `hsl(125, 40%, ${base + h1 * 4}%)`;
    return (
      <group position={[x, 0, z]} scale={[s, s, s]} rotation={[0, h2 * Math.PI * 2, 0]}>
        <mesh position={[0, 0.7, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.15, 1.4, 7]} />
          <meshStandardMaterial color="#5A3A1A" roughness={0.9} />
        </mesh>
        <mesh position={[0, 2.8, 0]} castShadow>
          <coneGeometry args={[1.0, 2.2, 8]} />
          <meshStandardMaterial color={tint(22)} roughness={0.9} />
        </mesh>
        <mesh position={[0, 2.1, 0]} castShadow>
          <coneGeometry args={[1.3, 1.6, 8]} />
          <meshStandardMaterial color={tint(26)} roughness={0.9} />
        </mesh>
        <mesh position={[0, 1.5, 0]} castShadow>
          <coneGeometry args={[1.5, 1.2, 8]} />
          <meshStandardMaterial color={tint(30)} roughness={0.9} />
        </mesh>
      </group>
    );
  }
  if (type === "palm") {
    return (
      <group position={[x, 0, z]} scale={[s, s, s]}>
        <mesh position={[0, 1.5, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.18, 3.0, 7]} />
          <meshStandardMaterial color="#8B6A30" roughness={0.9} />
        </mesh>
        {[0, 60, 120, 180, 240, 300].map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          return (
            <mesh key={i} position={[Math.cos(rad) * 0.8, 3.3, Math.sin(rad) * 0.8]}
              rotation={[0.4, rad, 0]} castShadow>
              <boxGeometry args={[1.8, 0.05, 0.35]} />
              <meshStandardMaterial color="#3A8040" roughness={0.9} />
            </mesh>
          );
        })}
      </group>
    );
  }
  if (type === "cypress") {
    // Italian Cypress — very tall, very narrow, columnar dark green
    return (
      <group position={[x, 0, z]} scale={[s, s, s]}>
        {/* Trunk */}
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.12, 1.0, 6]} />
          <meshStandardMaterial color="#3A2210" roughness={0.9} />
        </mesh>
        {/* Lower tier */}
        <mesh position={[0, 1.5, 0]} castShadow>
          <coneGeometry args={[0.38, 2.0, 7]} />
          <meshStandardMaterial color="#1A4A20" roughness={0.9} />
        </mesh>
        {/* Mid tier */}
        <mesh position={[0, 2.8, 0]} castShadow>
          <coneGeometry args={[0.26, 2.0, 7]} />
          <meshStandardMaterial color="#1C5224" roughness={0.9} />
        </mesh>
        {/* Top tier */}
        <mesh position={[0, 4.1, 0]} castShadow>
          <coneGeometry args={[0.14, 1.6, 6]} />
          <meshStandardMaterial color="#1E5826" roughness={0.9} />
        </mesh>
        {/* Tip */}
        <mesh position={[0, 5.1, 0]} castShadow>
          <coneGeometry args={[0.06, 0.7, 5]} />
          <meshStandardMaterial color="#1A4820" roughness={0.9} />
        </mesh>
      </group>
    );
  }
  // default round — organic deciduous canopy via overlapping spheres
  const greenTone = 26 + h1 * 6;        // 26..32 lightness
  const trunkH    = 1.5 + h2 * 0.3;
  return (
    <group position={[x, 0, z]} scale={[s, s, s]} rotation={[0, h3 * Math.PI * 2, 0]}>
      <mesh position={[0, trunkH * 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.20, trunkH, 8]} />
        <meshStandardMaterial color="#6B4A28" roughness={0.95} />
      </mesh>
      {/* Layered canopy — 4 spheres at slight offsets for organic silhouette */}
      {[
        [0,    2.5,  0,    1.05, greenTone],
        [0.55, 2.45, 0.20, 0.70, greenTone - 2],
        [-0.45,2.50,-0.30, 0.75, greenTone + 2],
        [0.10, 2.95, 0.05, 0.65, greenTone + 4],
      ].map(([dx, dy, dz, r, l], i) => (
        <mesh key={i} position={[dx as number, dy as number, dz as number]} castShadow>
          <sphereGeometry args={[r as number, 12, 9]} />
          <meshStandardMaterial color={`hsl(120, 35%, ${l}%)`} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Hedge / bush ────────────────────────────────────────────
function Bush({ x, z, scale = 1 }: { x: number; z: number; scale?: number }) {
  return (
    <group position={[x, 0, z]} scale={[scale, scale, scale]}>
      <mesh position={[0, 0.4, 0]} castShadow>
        <sphereGeometry args={[0.55, 11, 8]} />
        <meshStandardMaterial color="#3A8030" roughness={0.95} />
      </mesh>
      <mesh position={[0.4, 0.35, 0.2]} castShadow>
        <sphereGeometry args={[0.4, 10, 7]} />
        <meshStandardMaterial color="#3E8838" roughness={0.95} />
      </mesh>
    </group>
  );
}

// ─── Flower bed ───────────────────────────────────────────────
function FlowerBed({ x, z, w = 2, d = 0.8 }: { x: number; z: number; w?: number; d?: number }) {
  const flowers = useMemo(() => {
    const pts: { fx: number; fz: number; color: string }[] = [];
    const colors = ["#FF6090", "#FFD030", "#FF8030", "#CC60FF", "#FF4060"];
    for (let i = 0; i < 10; i++) {
      pts.push({
        fx: x + (Math.random() - 0.5) * w,
        fz: z + (Math.random() - 0.5) * d,
        color: colors[i % colors.length],
      });
    }
    return pts;
  }, [x, z, w, d]);
  return (
    <group>
      {/* Soil */}
      <mesh position={[x, -0.48, z]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w + 0.2, d + 0.2]} />
        <meshStandardMaterial color="#6B4A28" roughness={0.99} />
      </mesh>
      {flowers.map((f, i) => (
        <group key={i} position={[f.fx, 0, f.fz]}>
          <mesh position={[0, 0.22, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.45, 5]} />
            <meshStandardMaterial color="#50A050" />
          </mesh>
          <mesh position={[0, 0.45, 0]}>
            <sphereGeometry args={[0.1, 6, 5]} />
            <meshStandardMaterial color={f.color} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ─── Garden path ─────────────────────────────────────────────
function GardenPath({ W, D }: { W: number; D: number }) {
  return (
    <group>
      {/* Front path to door */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.499, -(D / 2 + 3.0)]} receiveShadow>
        <planeGeometry args={[1.4, 6.5]} />
        <meshStandardMaterial color="#C8BEA8" roughness={0.9} />
      </mesh>
      {/* Stepping stones */}
      {[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((offset, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}
          position={[
            (i % 2 === 0 ? -0.3 : 0.3),
            -0.498,
            -(D / 2 + 0.8 + i * 0.9),
          ]} receiveShadow>
          <circleGeometry args={[0.28, 7]} />
          <meshStandardMaterial color="#A8A090" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Outdoor element interaction (furniture-like) ───────────
/**
 * Wraps an outdoor element so it behaves like 2D furniture:
 * - Click → select (shows action panel with rotate / remove)
 * - Drag → move (raw DOM pointermove + plane raycasting, no orbit conflict)
 * - Rotate button → 45° steps
 * - Remove button → reset to default position
 * - Click elsewhere → deselect
 */
function DraggableGroup({
  posKey, label, defaultX, defaultZ, hitW = 8, hitD = 8,
  orbitRef, selectedKey, onSelect, children,
}: {
  posKey: string;
  label: string;
  defaultX: number;
  defaultZ: number;
  hitW?: number;
  hitD?: number;
  orbitRef: React.MutableRefObject<any>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  children: React.ReactNode;
}) {
  const { gl, camera } = useThree();
  const setOutdoorPosition  = useDesignerStore(s => s.setOutdoorPosition);
  const rotateOutdoor       = useDesignerStore(s => s.rotateOutdoor);
  const resetOutdoorPosition = useDesignerStore(s => s.resetOutdoorPosition);
  const savedState = useDesignerStore(s => s.exterior.outdoorPositions?.[posKey]);

  const pos = { x: savedState?.x ?? defaultX, z: savedState?.z ?? defaultZ };
  const rotDeg = savedState?.rot ?? 0;
  const rotRad = rotDeg * (Math.PI / 180);

  const isSelected = selectedKey === posKey;
  const isDragging = useRef(false);
  const didDrag    = useRef(false);           // distinguish click vs drag
  const [hovered, setHovered] = useState(false);
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

  // Panel float height above element centre
  const panelY = Math.max(hitW, hitD) * 0.35 + 2.5;
  const ringR  = Math.max(hitW, hitD) / 2;

  useEffect(() => {
    const canvas = gl.domElement;

    const onMove = (e: PointerEvent) => {
      if (!isDragging.current) return;
      didDrag.current = true;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(groundPlane, hit)) {
        setOutdoorPosition(posKey, { x: hit.x, z: hit.z });
      }
    };

    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      if (orbitRef.current) orbitRef.current.enabled = true;
      canvas.style.cursor = hovered ? "grab" : "default";
    };

    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup",   onUp);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup",   onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera, posKey, hovered]);

  return (
    <group position={[pos.x, 0, pos.z]} rotation={[0, rotRad, 0]}>

      {/* ── Hit surface (pointer events) ── */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e) => {
          e.stopPropagation();
          didDrag.current = false;
          isDragging.current = true;
          if (orbitRef.current) orbitRef.current.enabled = false;
          gl.domElement.style.cursor = "grabbing";
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          // Only toggle selection when it was a click (not a drag)
          if (!didDrag.current) {
            onSelect(isSelected ? null : posKey);
          }
        }}
        onPointerEnter={() => { setHovered(true);  gl.domElement.style.cursor = "grab"; }}
        onPointerLeave={() => { if (!isDragging.current) { setHovered(false); gl.domElement.style.cursor = "default"; } }}
      >
        <planeGeometry args={[hitW, hitD]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* ── Selection / hover ring ── */}
      {(isSelected || hovered) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
          <ringGeometry args={[ringR + 0.05, ringR + 0.55, 64]} />
          <meshBasicMaterial
            color={isSelected ? "#007AFF" : "#60A5FA"}
            transparent opacity={isSelected ? 0.85 : 0.45}
            side={THREE.DoubleSide} depthWrite={false}
          />
        </mesh>
      )}

      {/* ── Selected: solid border + fill tint ── */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <circleGeometry args={[ringR + 0.04, 64]} />
          <meshBasicMaterial color="#007AFF" transparent opacity={0.08} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}

      {/* ── Floating action panel (Html overlay) ── */}
      {isSelected && (
        <Html
          position={[0, panelY, 0]}
          center
          distanceFactor={12}
          zIndexRange={[100, 200]}
          style={{ pointerEvents: "auto" }}
        >
          <div
            onPointerDown={e => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 14,
              padding: "6px 8px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.22)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              userSelect: "none",
              whiteSpace: "nowrap",
              border: "1px solid #E5E7EB",
              minWidth: 0,
            }}
          >
            {/* Label */}
            <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", padding: "0 4px" }}>
              {label}
            </span>
            <div style={{ width: 1, height: 16, background: "#E5E7EB", margin: "0 2px" }} />
            {/* Rotate button */}
            <button
              onClick={(e) => { e.stopPropagation(); rotateOutdoor(posKey); }}
              style={{
                fontSize: 15, cursor: "pointer", border: "none", background: "transparent",
                padding: "3px 6px", borderRadius: 8, color: "#374151",
                display: "flex", alignItems: "center", gap: 3,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#F3F4F6")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              title="旋转 45°"
            >
              ↻ <span style={{ fontSize: 10 }}>45°</span>
            </button>
            {/* Reset position */}
            <button
              onClick={(e) => { e.stopPropagation(); resetOutdoorPosition(posKey); onSelect(null); }}
              style={{
                fontSize: 13, cursor: "pointer", border: "none", background: "transparent",
                padding: "3px 6px", borderRadius: 8, color: "#6B7280",
                display: "flex", alignItems: "center",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#FEF2F2")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              title="重置位置"
            >
              ↺
            </button>
            {/* Deselect / close */}
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(null); }}
              style={{
                fontSize: 13, cursor: "pointer", border: "none", background: "transparent",
                padding: "3px 6px", borderRadius: 8, color: "#9CA3AF",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "#111827")}
              onMouseLeave={e => (e.currentTarget.style.color = "#9CA3AF")}
              title="取消选中"
            >
              ✕
            </button>
          </div>
        </Html>
      )}

      {children}
    </group>
  );
}

// ─── Swimming pool water ─────────────────────────────────────
// Uses drei's MeshReflectorMaterial (real-time mirror reflection of the
// scene, plus distortion + blur for a wet-glass look) layered on top of a
// turquoise pool floor. The whole thing sits ~22cm below the coping so
// the surface lines up with the infinity-edge lip.
export function AnimatedWater({ w, d }: { w: number; d: number }) {
  const surfaceRef = useRef<THREE.Mesh>(null);
  // Procedural ripple normal map — generated once via canvas. Cheap, no
  // network request, and animates by sliding the offset each frame.
  const rippleNormal = useMemo(() => {
    const SIZE = 256;
    const c = document.createElement("canvas");
    c.width = c.height = SIZE;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        // Two interfering sine waves → soft cellular pattern
        const a = Math.sin(x * 0.18) * Math.cos(y * 0.21);
        const b = Math.sin((x + y) * 0.10) * 0.7;
        const v = (a + b) * 0.4 + 0.5;
        const i = (y * SIZE + x) * 4;
        // Encode as a tangent-space normal: flat (0.5, 0.5, 1.0) plus tiny xy
        img.data[i + 0] = Math.min(255, Math.max(0, 128 + v * 30));
        img.data[i + 1] = Math.min(255, Math.max(0, 128 + (1 - v) * 30));
        img.data[i + 2] = 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w / 1.5, d / 1.5);
    tex.anisotropy = 4;
    return tex;
  }, [w, d]);

  useFrame((_, delta) => {
    // Drift the normal map in the +X / +Z direction to fake water flow
    rippleNormal.offset.x += delta * 0.04;
    rippleNormal.offset.y += delta * 0.025;
    if (surfaceRef.current) {
      // Tiny vertical bob so the surface isn't dead-still
      surfaceRef.current.position.y = -0.12 + Math.sin(Date.now() * 0.0011) * 0.003;
    }
  });

  return (
    <group>
      {/* Pool bottom — turquoise tile, lit by sun + sky to give that
          unmistakable 'lit pool' colour through the water surface */}
      <mesh position={[0, -0.42, 0]} receiveShadow>
        <boxGeometry args={[w + 0.02, 0.04, d + 0.02]} />
        <meshStandardMaterial color="#3FBFD9" roughness={0.35} metalness={0.05} />
      </mesh>
      {/* Reflective water surface */}
      <mesh ref={surfaceRef} position={[0, -0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d, 1, 1]} />
        <MeshReflectorMaterial
          blur={[160, 80]}
          resolution={512}
          mixBlur={0.7}
          mixStrength={1.2}
          mirror={0.55}
          mixContrast={1.1}
          roughness={0.08}
          metalness={0.1}
          color="#5DC8E0"
          normalMap={rippleNormal}
          normalScale={new THREE.Vector2(0.18, 0.18)}
          transparent
          opacity={0.92}
        />
      </mesh>
    </group>
  );
}

// Luxury infinity-edge pool with travertine deck, spa, loungers, cabana
export function Pool({ x, z, w = 9, d = 5 }: { x: number; z: number; w?: number; d?: number }) {
  // Travertine deck tiles
  const deckTiles = useMemo(() => {
    const tiles: { tx: number; tz: number }[] = [];
    const deckW = w + 3.0;
    const deckD = d + 3.0;
    const tileSize = 0.9;
    const cols = Math.ceil(deckW / tileSize);
    const rows = Math.ceil(deckD / tileSize);
    for (let ci = 0; ci < cols; ci++) {
      for (let ri = 0; ri < rows; ri++) {
        const tx = -deckW / 2 + ci * tileSize + tileSize / 2;
        const tz = -deckD / 2 + ri * tileSize + tileSize / 2;
        // Skip over pool area
        if (Math.abs(tx) < w / 2 + 0.1 && Math.abs(tz) < d / 2 + 0.1) continue;
        tiles.push({ tx, tz });
      }
    }
    return tiles;
  }, [w, d]);

  return (
    <group position={[x, 0, z]}>
      {/* ── Travertine deck ── */}
      {deckTiles.map((t, i) => (
        <mesh key={i} position={[t.tx, -0.02, t.tz]} receiveShadow>
          <boxGeometry args={[0.86, 0.04, 0.86]} />
          <meshStandardMaterial color="#EDE8D8" roughness={0.75} metalness={0.02} />
        </mesh>
      ))}

      {/* ── Pool shell (travertine coping surround) ── */}
      <mesh position={[0, -0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.7, 0.6, d + 0.7]} />
        <meshStandardMaterial color="#E2DDD0" roughness={0.7} />
      </mesh>

      {/* ── Pool interior walls (blue plaster) ── */}
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[w - 0.05, 0.55, d - 0.05]} />
        <meshStandardMaterial color="#85C8E0" roughness={0.25} />
      </mesh>

      {/* ── Water surface ── */}
      <AnimatedWater w={w - 0.15} d={d - 0.15} />

      {/* ── Infinity edge: +z side overflow lip (slightly lower) ── */}
      <mesh position={[0, -0.06, d / 2 + 0.18]} castShadow>
        <boxGeometry args={[w + 0.7, 0.04, 0.36]} />
        <meshStandardMaterial color="#C8C2B0" roughness={0.6} />
      </mesh>
      {/* Infinity wall below — dark, suggests water cascade */}
      <mesh position={[0, -0.55, d / 2 + 0.36]}>
        <boxGeometry args={[w + 0.7, 0.6, 0.12]} />
        <meshStandardMaterial color="#1A3A50" roughness={0.4} metalness={0.15} />
      </mesh>
      {/* Thin water sheet on infinity wall */}
      <mesh position={[0, -0.4, d / 2 + 0.43]}>
        <boxGeometry args={[w + 0.5, 0.45, 0.03]} />
        <meshPhysicalMaterial color="#0AACCC" transparent opacity={0.45} roughness={0.01} envMapIntensity={2.0} />
      </mesh>

      {/* ── Coping tiles (rim) — travertine ── */}
      {([
        { pos: [0, 0.02, -(d / 2 + 0.3)] as [number,number,number], args: [w + 0.8, 0.06, 0.55] as [number,number,number] },
        { pos: [0, 0.02,  (d / 2 + 0.3)] as [number,number,number], args: [w + 0.8, 0.06, 0.55] as [number,number,number] },
        { pos: [-(w / 2 + 0.3), 0.02, 0] as [number,number,number], args: [0.55, 0.06, d] as [number,number,number] },
        { pos: [ (w / 2 + 0.3), 0.02, 0] as [number,number,number], args: [0.55, 0.06, d] as [number,number,number] },
      ] as { pos: [number,number,number]; args: [number,number,number] }[]).map((t, i) => (
        <mesh key={i} position={t.pos} receiveShadow>
          <boxGeometry args={t.args} />
          <meshStandardMaterial color="#F0EAD8" roughness={0.55} metalness={0.05} />
        </mesh>
      ))}

      {/* ── Spa / hot tub (adjacent corner, slightly elevated) ── */}
      <group position={[w / 2 + 1.8, 0.15, -(d / 2 + 0.5)]}>
        {/* Spa shell */}
        <mesh position={[0, -0.1, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[1.35, 1.45, 0.55, 18]} />
          <meshStandardMaterial color="#E2DDD0" roughness={0.7} />
        </mesh>
        {/* Spa water */}
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[1.2, 1.2, 0.1, 18]} />
          <meshPhysicalMaterial color="#30C8E0" transparent opacity={0.88} roughness={0.01} envMapIntensity={3.0} />
        </mesh>
        {/* Jets bubbles hint */}
        {[0, 72, 144, 216, 288].map((deg, i) => {
          const r = (deg * Math.PI) / 180;
          return (
            <mesh key={i} position={[Math.cos(r) * 0.75, 0.22, Math.sin(r) * 0.75]}>
              <sphereGeometry args={[0.07, 6, 5]} />
              <meshStandardMaterial color="#AAEEFF" transparent opacity={0.6} roughness={0.05} />
            </mesh>
          );
        })}
      </group>

      {/* ── Lounger pairs with side tables and umbrellas ── */}
      {/* Pair A — far side of pool */}
      {([-1.0, 1.0] as number[]).map((lz, i) => (
        <group key={i} position={[w / 2 + 2.6, 0, lz * 1.6]}>
          {/* Lounger frame */}
          <mesh position={[0, -0.38, 0]} castShadow>
            <boxGeometry args={[2.1, 0.08, 0.72]} />
            <meshStandardMaterial color="#F5EDD8" roughness={0.75} />
          </mesh>
          {/* Cushion */}
          <mesh position={[0, -0.31, 0]}>
            <boxGeometry args={[2.0, 0.06, 0.62]} />
            <meshStandardMaterial color="#FFFFF0" roughness={0.9} />
          </mesh>
          {/* Backrest raised */}
          <mesh position={[-0.7, -0.22, 0]} rotation={[0, 0, -0.35]} castShadow>
            <boxGeometry args={[0.65, 0.06, 0.62]} />
            <meshStandardMaterial color="#F5EDD8" roughness={0.75} />
          </mesh>
        </group>
      ))}
      {/* Side table A */}
      <mesh position={[w / 2 + 2.6, -0.32, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, 0.06, 10]} />
        <meshStandardMaterial color="#C8C0A8" roughness={0.6} metalness={0.1} />
      </mesh>
      {/* Umbrella A */}
      <group position={[w / 2 + 2.6, 0, 0]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 2.0, 6]} />
          <meshStandardMaterial color="#D8D0B8" roughness={0.8} />
        </mesh>
        <mesh position={[0, 1.45, 0]} rotation={[0.15, 0, 0]} castShadow>
          <coneGeometry args={[1.4, 0.5, 16, 1, true]} />
          <meshStandardMaterial color="#F8F4E8" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Pair B — near side of pool */}
      {([-1.0, 1.0] as number[]).map((lz, i) => (
        <group key={i} position={[-(w / 2 + 2.6), 0, lz * 1.6]}>
          <mesh position={[0, -0.38, 0]} castShadow>
            <boxGeometry args={[2.1, 0.08, 0.72]} />
            <meshStandardMaterial color="#F5EDD8" roughness={0.75} />
          </mesh>
          <mesh position={[0, -0.31, 0]}>
            <boxGeometry args={[2.0, 0.06, 0.62]} />
            <meshStandardMaterial color="#FFFFF0" roughness={0.9} />
          </mesh>
          <mesh position={[0.7, -0.22, 0]} rotation={[0, 0, 0.35]} castShadow>
            <boxGeometry args={[0.65, 0.06, 0.62]} />
            <meshStandardMaterial color="#F5EDD8" roughness={0.75} />
          </mesh>
        </group>
      ))}
      {/* Side table B */}
      <mesh position={[-(w / 2 + 2.6), -0.32, 0]} castShadow>
        <cylinderGeometry args={[0.28, 0.28, 0.06, 10]} />
        <meshStandardMaterial color="#C8C0A8" roughness={0.6} metalness={0.1} />
      </mesh>
      {/* Umbrella B */}
      <group position={[-(w / 2 + 2.6), 0, 0]}>
        <mesh position={[0, 0.5, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.04, 2.0, 6]} />
          <meshStandardMaterial color="#D8D0B8" roughness={0.8} />
        </mesh>
        <mesh position={[0, 1.45, 0]} rotation={[-0.15, 0, 0]} castShadow>
          <coneGeometry args={[1.4, 0.5, 16, 1, true]} />
          <meshStandardMaterial color="#F8F4E8" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* ── Pool cabana / pool house ── */}
      <group position={[0, 0, -(d / 2 + 4.5)]}>
        {/* Flat roof slab */}
        <mesh position={[0, 2.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[5.5, 0.18, 3.2]} />
          <meshStandardMaterial color="#E8E2D0" roughness={0.8} />
        </mesh>
        {/* 4 slim columns */}
        {([ [-2.3, -1.3], [2.3, -1.3], [-2.3, 1.3], [2.3, 1.3] ] as [number,number][]).map(([cx, cz], i) => (
          <mesh key={i} position={[cx, 1.3, cz]} castShadow>
            <cylinderGeometry args={[0.1, 0.1, 2.6, 10]} />
            <meshStandardMaterial color="#F0EAD8" roughness={0.7} />
          </mesh>
        ))}
        {/* Curtain panels (translucent vertical planes) */}
        {([ [-1.0, 0], [1.0, 0] ] as [number,number][]).map(([cx, cz], i) => (
          <mesh key={i} position={[cx, 1.3, cz]}>
            <boxGeometry args={[1.2, 2.4, 0.04]} />
            <meshStandardMaterial color="#FFFFF8" transparent opacity={0.35} roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
        ))}
        {/* Floor slab */}
        <mesh position={[0, 0.02, 0]} receiveShadow>
          <boxGeometry args={[5.3, 0.04, 3.0]} />
          <meshStandardMaterial color="#EDE8D8" roughness={0.75} />
        </mesh>
      </group>
    </group>
  );
}

// ─── Pergola (replaces Gazebo) ───────────────────────────────
export function Pergola({ x, z }: { x: number; z: number }) {
  // Architect-grade pergola: dark steel / aluminium frame on slim columns,
  // closely-spaced overhead slats (rhythmic shadow), integrated LED strip
  // along long beams, teak deck floor. Replaces the all-white-cream colour
  // scheme that read as cake topper.
  const pW = 5.0;
  const pD = 4.0;
  const colH = 2.8;

  // Wood-deck flooring texture for the platform — matches private zone
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getOutdoorTexture, outdoorTileSize } = require("@/lib/textures") as typeof import("@/lib/textures");
  const deckTex = useMemo(() => {
    const src = getOutdoorTexture("outdoor-wood-deck");
    if (!src) return null;
    const t = src.clone();
    const [tw, th] = outdoorTileSize("outdoor-wood-deck");
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set((pW + 0.3) / tw, (pD + 0.3) / th);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }, [pW, pD]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only 4 corner columns (no mid columns — opens up the space). Slim
  // 8cm-square anodised aluminium feels modern.
  const columns: [number, number][] = [
    [-pW / 2, -pD / 2], [pW / 2, -pD / 2],
    [-pW / 2,  pD / 2], [pW / 2,  pD / 2],
  ];

  // Longitudinal beams (along X) — fewer, deeper for rhythm
  const longBeams: number[] = [-pD / 2, pD / 2];
  // Slats (along Z) — many, narrow, evenly spaced for that signature
  // banded sunset shadow on the deck below
  const SLAT_COUNT = 22;
  const slatPitch = pW / SLAT_COUNT;
  const STEEL = "#3A3F45";
  const STEEL_HI = "#52585F";
  const TEAK = "#5A3F1E";

  return (
    <group position={[x, 0, z]}>
      {/* Teak deck floor */}
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <boxGeometry args={[pW + 0.3, 0.08, pD + 0.3]} />
        {deckTex
          ? <meshStandardMaterial map={deckTex} color="#FFFFFF" roughness={0.85} />
          : <meshStandardMaterial color={TEAK} roughness={0.85} />}
      </mesh>
      {/* Subtle stone curb edging the deck */}
      {([
        [-pW / 2 - 0.18, 0, 0, 0.10, 0.08, pD + 0.46],
        [ pW / 2 + 0.18, 0, 0, 0.10, 0.08, pD + 0.46],
        [0, 0, -pD / 2 - 0.18, pW + 0.46, 0.08, 0.10],
        [0, 0,  pD / 2 + 0.18, pW + 0.46, 0.08, 0.10],
      ] as [number,number,number,number,number,number][]).map((c, i) => (
        <mesh key={i} position={[c[0], 0.04, c[2]]} receiveShadow>
          <boxGeometry args={[c[3], c[4], c[5]]} />
          <meshStandardMaterial color="#9C9A92" roughness={0.85} />
        </mesh>
      ))}

      {/* Columns — slim square anodised aluminium */}
      {columns.map(([cx, cz], i) => (
        <mesh key={i} position={[cx, colH / 2, cz]} castShadow receiveShadow>
          <boxGeometry args={[0.10, colH, 0.10]} />
          <meshStandardMaterial color={STEEL} roughness={0.45} metalness={0.65} />
        </mesh>
      ))}

      {/* Longitudinal beams — deeper, dark steel */}
      {longBeams.map((bz, i) => (
        <mesh key={i} position={[0, colH + 0.12, bz]} castShadow>
          <boxGeometry args={[pW + 0.30, 0.22, 0.10]} />
          <meshStandardMaterial color={STEEL} roughness={0.5} metalness={0.55} />
        </mesh>
      ))}

      {/* LED strip — emissive thin plane under each long beam */}
      {longBeams.map((bz, i) => (
        <mesh key={`led-${i}`} position={[0, colH + 0.005, bz]}>
          <boxGeometry args={[pW + 0.20, 0.02, 0.04]} />
          <meshStandardMaterial color="#FFE8B0" emissive="#FFE8B0" emissiveIntensity={0.9} />
        </mesh>
      ))}

      {/* Roof slats — closely spaced for the signature shadow rhythm */}
      {Array.from({ length: SLAT_COUNT }).map((_, i) => {
        const bx = -pW / 2 + slatPitch * (i + 0.5);
        return (
          <mesh key={i} position={[bx, colH + 0.27, 0]} castShadow>
            <boxGeometry args={[0.06, 0.04, pD + 0.05]} />
            <meshStandardMaterial color={STEEL_HI} roughness={0.5} metalness={0.55} />
          </mesh>
        );
      })}

      {/* Dining table — dark stone slab */}
      <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.1, 1.2]} />
        <meshStandardMaterial color="#3A3A3A" roughness={0.5} metalness={0.1} />
      </mesh>
      {/* Table legs */}
      {([ [-1.1, -0.45], [1.1, -0.45], [-1.1, 0.45], [1.1, 0.45] ] as [number,number][]).map(([tx, tz], i) => (
        <mesh key={i} position={[tx, 0.36, tz]} castShadow>
          <boxGeometry args={[0.08, 0.72, 0.08]} />
          <meshStandardMaterial color="#2A2A2A" roughness={0.6} />
        </mesh>
      ))}

      {/* 6 chairs — wicker / charcoal matching the dark frame */}
      {([ [-1.35,0], [1.35,0], [-0.5,-0.75], [0.5,-0.75], [-0.5,0.75], [0.5,0.75] ] as [number,number][]).map(([cx, cz], i) => (
        <group key={i} position={[cx, 0.46, cz]}>
          <mesh castShadow>
            <boxGeometry args={[0.48, 0.08, 0.48]} />
            <meshStandardMaterial color="#4A4540" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.3, -0.18]} castShadow>
            <boxGeometry args={[0.44, 0.55, 0.06]} />
            <meshStandardMaterial color="#4A4540" roughness={0.95} />
          </mesh>
          {/* Cream cushion on seat */}
          <mesh position={[0, 0.06, 0]} castShadow>
            <boxGeometry args={[0.42, 0.04, 0.42]} />
            <meshStandardMaterial color="#E8DDC9" roughness={0.92} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ─── Outdoor Kitchen ─────────────────────────────────────────
export function OutdoorKitchen({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* L-shape counter — long arm */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 1.0, 0.85]} />
        <meshStandardMaterial color="#555555" roughness={0.7} />
      </mesh>
      {/* Marble top — long arm */}
      <mesh position={[0, 1.02, 0]} castShadow>
        <boxGeometry args={[3.2, 0.06, 0.85]} />
        <meshStandardMaterial color="#E8E8E0" roughness={0.35} metalness={0.05} />
      </mesh>

      {/* L-shape counter — short arm */}
      <mesh position={[1.4, 0.5, 0.8]} castShadow receiveShadow>
        <boxGeometry args={[0.85, 1.0, 1.65]} />
        <meshStandardMaterial color="#555555" roughness={0.7} />
      </mesh>
      {/* Marble top — short arm */}
      <mesh position={[1.4, 1.02, 0.8]} castShadow>
        <boxGeometry args={[0.85, 0.06, 1.65]} />
        <meshStandardMaterial color="#E8E8E0" roughness={0.35} metalness={0.05} />
      </mesh>

      {/* Built-in grill grate */}
      {([-0.5, 0, 0.5] as number[]).map((gx, i) => (
        <mesh key={i} position={[gx, 1.07, 0]} castShadow>
          <boxGeometry args={[0.22, 0.04, 0.55]} />
          <meshStandardMaterial color="#444444" roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
      {([-0.18, 0.18] as number[]).map((gz, i) => (
        <mesh key={i} position={[0, 1.07, gz]} castShadow>
          <boxGeometry args={[1.0, 0.04, 0.04]} />
          <meshStandardMaterial color="#444444" roughness={0.5} metalness={0.6} />
        </mesh>
      ))}

      {/* Small overhead pergola — 2 posts */}
      {([ [-1.4, 0], [1.4, 0] ] as [number,number][]).map(([px, pz], i) => (
        <mesh key={i} position={[px, 1.35, pz - 0.5]} castShadow>
          <cylinderGeometry args={[0.08, 0.08, 1.7, 8]} />
          <meshStandardMaterial color="#C8C0A8" roughness={0.75} />
        </mesh>
      ))}
      {/* Pergola beam */}
      <mesh position={[0, 2.22, -0.5]} castShadow>
        <boxGeometry args={[3.0, 0.12, 0.14]} />
        <meshStandardMaterial color="#D8D0B8" roughness={0.75} />
      </mesh>
      {/* Cross slats */}
      {([-0.9, 0, 0.9] as number[]).map((bx, i) => (
        <mesh key={i} position={[bx, 2.3, -0.5]} castShadow>
          <boxGeometry args={[0.08, 0.08, 1.1]} />
          <meshStandardMaterial color="#D8D0B8" roughness={0.75} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Fountain ────────────────────────────────────────────────
export function Fountain({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* Basin */}
      <mesh position={[0, 0.0, 0]} receiveShadow>
        <cylinderGeometry args={[1.2, 1.3, 0.4, 16]} />
        <meshStandardMaterial color="#D8D0C0" roughness={0.9} />
      </mesh>
      {/* Water */}
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[1.0, 1.0, 0.08, 16]} />
        <meshStandardMaterial color="#60B8E0" transparent opacity={0.8} roughness={0.05} />
      </mesh>
      {/* Center pillar */}
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.14, 0.8, 10]} />
        <meshStandardMaterial color="#C0B890" roughness={0.85} />
      </mesh>
      {/* Top spray */}
      <mesh position={[0, 1.05, 0]}>
        <sphereGeometry args={[0.18, 8, 7]} />
        <meshStandardMaterial color="#A0DAEE" transparent opacity={0.75} roughness={0.1} />
      </mesh>
    </group>
  );
}

// ─── Lawn area ────────────────────────────────────────────────
function Lawn({ x, z, w = 6, d = 5 }: { x: number; z: number; w?: number; d?: number }) {
  return (
    <mesh position={[x, -0.495, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial color="#5CBF40" roughness={0.98} />
    </mesh>
  );
}

// ─── Car ──────────────────────────────────────────────────
function Car({ x, z, color = "#2255AA" }: { x: number; z: number; color?: string }) {
  return (
    <group position={[x, 0, z]}>
      {/* Main body */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <boxGeometry args={[1.85, 0.62, 4.3]} />
        <meshStandardMaterial color={color} metalness={0.55} roughness={0.38} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 0.82, 0.18]} castShadow>
        <boxGeometry args={[1.65, 0.52, 2.1]} />
        <meshStandardMaterial color={color} metalness={0.45} roughness={0.45} />
      </mesh>
      {/* Windshield (dark glass) */}
      <mesh position={[0, 0.82, -0.9]}>
        <boxGeometry args={[1.55, 0.44, 0.06]} />
        <meshStandardMaterial color="#111122" metalness={0.1} roughness={0.05} transparent opacity={0.85} />
      </mesh>
      {/* Wheels */}
      {([ [-0.88,-1.45], [0.88,-1.45], [-0.88,1.45], [0.88,1.45] ] as [number,number][]).map(([wx,wz],i) => (
        <mesh key={i} position={[wx, 0.2, wz]} rotation={[0,0,Math.PI/2]} castShadow>
          <cylinderGeometry args={[0.34, 0.34, 0.24, 14]} />
          <meshStandardMaterial color="#1A1A1A" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Circular luxury driveway ────────────────────────────────
// Renders relative to its own origin (z=0 = house-front edge).
// Wrap in DraggableGroup at defaultZ=D/2 for world positioning.
function DrivewayAndParking() {
  // All z-coords are relative to house-front (z=0 here).
  const circleZ = 11.0; // center of circular driveway, 11 m from house front
  const outerR = 5.5;
  const innerR = 3.2;
  const roadW = outerR - innerR;
  const SEGS = 36;

  const ringSegments = useMemo(() => {
    const segs: { pos: [number,number,number]; rot: number; w: number; len: number }[] = [];
    for (let i = 0; i < SEGS; i++) {
      const a0 = (i / SEGS) * Math.PI * 2;
      const a1 = ((i + 1) / SEGS) * Math.PI * 2;
      const midA = (a0 + a1) / 2;
      const midR = (outerR + innerR) / 2;
      segs.push({
        pos: [Math.cos(midA) * midR, -0.492, circleZ + Math.sin(midA) * midR],
        rot: midA + Math.PI / 2,
        w: roadW - 0.05,
        len: (2 * Math.PI * midR) / SEGS + 0.05,
      });
    }
    return segs;
  }, []);

  const islandPavers = useMemo(() => {
    const pvs: { px: number; pz: number }[] = [];
    const step = 0.55;
    for (let xi = -Math.ceil(innerR / step); xi <= Math.ceil(innerR / step); xi++) {
      for (let zi = -Math.ceil(innerR / step); zi <= Math.ceil(innerR / step); zi++) {
        const px = xi * step, pz = zi * step;
        if (px * px + pz * pz < (innerR - 0.3) * (innerR - 0.3)) pvs.push({ px, pz });
      }
    }
    return pvs;
  }, []);

  const carportX = outerR + 5.0;

  return (
    <group>
      {/* ── Straight approach from origin (house front) to circle ── */}
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -0.492, 5.5]} receiveShadow>
        <planeGeometry args={[4.2, 11.0]} />
        <meshStandardMaterial color="#C9C2B5" roughness={0.85} />
      </mesh>

      {/* ── Ring road segments ── */}
      {ringSegments.map((seg, i) => (
        <mesh key={i} rotation={[-Math.PI/2, seg.rot, 0]} position={seg.pos} receiveShadow>
          <planeGeometry args={[seg.w, seg.len]} />
          <meshStandardMaterial color="#C9C2B5" roughness={0.85} />
        </mesh>
      ))}

      {/* ── Center island: grass ── */}
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -0.494, circleZ]} receiveShadow>
        <circleGeometry args={[innerR - 0.15, 32]} />
        <meshStandardMaterial color="#5CBF40" roughness={0.98} />
      </mesh>

      {/* ── Center island ornamental topiary ── */}
      <group position={[0, 0, circleZ]}>
        <mesh position={[0, 0.6, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.16, 1.2, 8]} />
          <meshStandardMaterial color="#5A3A1A" roughness={0.9} />
        </mesh>
        <mesh position={[0, 2.0, 0]} castShadow>
          <sphereGeometry args={[1.05, 10, 8]} />
          <meshStandardMaterial color="#2E7020" roughness={0.9} />
        </mesh>
      </group>

      {/* ── Bollard lights along approach ── */}
      {([-1.5, 1.5] as number[]).map((bx, side) =>
        [2.0, 5.0, 8.0].map((bz, j) => (
          <group key={`${side}-${j}`} position={[bx, 0, bz]}>
            <mesh position={[0, 0.3, 0]} castShadow>
              <cylinderGeometry args={[0.07, 0.09, 0.6, 8]} />
              <meshStandardMaterial color="#C8C0A0" roughness={0.6} metalness={0.3} />
            </mesh>
            <mesh position={[0, 0.64, 0]}>
              <sphereGeometry args={[0.1, 8, 7]} />
              <meshStandardMaterial color="#FFFFDD" emissive="#FFFFAA" emissiveIntensity={0.6} roughness={0.3} />
            </mesh>
          </group>
        ))
      )}

      {/* ── Bollard lights around ring ── */}
      {Array.from({ length: 12 }).map((_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return (
          <group key={i} position={[Math.cos(a) * (outerR + 0.5), 0, circleZ + Math.sin(a) * (outerR + 0.5)]}>
            <mesh position={[0, 0.3, 0]} castShadow>
              <cylinderGeometry args={[0.07, 0.09, 0.6, 8]} />
              <meshStandardMaterial color="#C8C0A0" roughness={0.6} metalness={0.3} />
            </mesh>
            <mesh position={[0, 0.64, 0]}>
              <sphereGeometry args={[0.1, 8, 7]} />
              <meshStandardMaterial color="#FFFFDD" emissive="#FFFFAA" emissiveIntensity={0.6} roughness={0.3} />
            </mesh>
          </group>
        );
      })}

      {/* ── Carport with 4 columns + flat roof ── */}
      <group position={[carportX, 0, circleZ]}>
        <mesh position={[0, 2.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[6.5, 0.18, 5.5]} />
          <meshStandardMaterial color="#D8D2C0" roughness={0.8} />
        </mesh>
        {([ [-2.8, -2.2], [2.8, -2.2], [-2.8, 2.2], [2.8, 2.2] ] as [number,number][]).map(([cx, cz], i) => (
          <mesh key={i} position={[cx, 1.3, cz]} castShadow>
            <cylinderGeometry args={[0.14, 0.14, 2.6, 10]} />
            <meshStandardMaterial color="#F0EAD8" roughness={0.7} />
          </mesh>
        ))}
        <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -0.492, 0]} receiveShadow>
          <planeGeometry args={[6.2, 5.2]} />
          <meshStandardMaterial color="#B8A888" roughness={0.88} />
        </mesh>
        <Car x={-1.8} z={0} color="#E8E8E8" />
        <Car x={ 1.8} z={0} color="#1A1A2E" />
        <Car x={0}    z={4.0} color="#8B4513" />
      </group>
    </group>
  );
}

// ─── Yard presets ─────────────────────────────────────────────
// LEGACY: kept for back-compat with the ExteriorSettings.yardPreset
// dropdown. NEW preferred path = drag Pool / Pergola / etc as Prefab
// items in the YardPlan editor (BLOCKS library tab). When the user has
// any structural prefab in their yardPlan.items, this whole legacy
// function returns null to avoid double-rendering them.
function YardElements({ W, D, yardPreset, parking = false, orbitRef, selectedKey, onSelect }: {
  W: number; D: number; yardPreset: string; parking?: boolean;
  orbitRef: React.MutableRefObject<any>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  // Skip the entire legacy auto-place when user-driven yardPlan already
  // contains a structural prefab (pool / pergola_classic / outdoor_kitchen
  // / fountain). The user explicitly chose to compose the structures via
  // the YardPlan editor — respect that and don't shadow them.
  const activeFloor = useDesignerStore(s => s.activeFloor);
  const yardItems = useDesignerStore(s => s.floorPlans[activeFloor].yardPlan?.items);
  const hasUserStructure = useMemo(() => {
    if (!yardItems) return false;
    return yardItems.some(it =>
      it.type === "prefab" &&
      ["pool", "pergola_classic", "outdoor_kitchen", "fountain"].includes(it.prefabKind)
    );
  }, [yardItems]);
  if (hasUserStructure) return null;

  const xOff = W / 2 + 7.5;   // right side (more room for luxury pool)

  if (yardPreset === "minimal") {
    return (
      <>
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} scale={1.1} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} scale={1.1} />
        <Tree x={-(W / 2 + 3.5)} z={  D / 2 + 1.8}  scale={0.9} />
        <Tree x={  W / 2 + 3.5}  z={  D / 2 + 1.8}  scale={0.9} />
        <GardenPath W={W} D={D} />
        <FlowerBed x={W / 2 + 1.5} z={-(D / 2 - 0.5)} w={2} d={0.8} />
        {parking && (
          <DraggableGroup posKey="driveway" label="🚗 停车场" defaultX={0} defaultZ={D / 2} hitW={28} hitD={30} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
            <DrivewayAndParking />
          </DraggableGroup>
        )}
      </>
    );
  }

  if (yardPreset === "garden") {
    return (
      <>
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} scale={1.2} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} scale={1.0} type="pine" />
        <Tree x={-(W / 2 + 3.0)} z={  D / 2 + 2.0}  scale={0.9} />
        <Tree x={  W / 2 + 3.5}  z={  D / 2 + 2.0}  scale={1.1} type="pine" />
        <Tree x={0}               z={  D / 2 + 5.0}  scale={1.3} />
        <Tree x={-(W / 2 + 5.5)} z={-(D / 2 + 2.0)} type="cypress" scale={1.0} />
        <Tree x={  W / 2 + 5.5}  z={-(D / 2 + 2.0)} type="cypress" scale={1.0} />
        <Tree x={-(W / 2 + 5.5)} z={  D / 2 + 2.5}  type="cypress" scale={0.9} />
        <Tree x={  W / 2 + 5.5}  z={  D / 2 + 2.5}  type="cypress" scale={0.9} />
        {[-D/4, 0, D/4].map((hz, i) => (
          <Bush key={i} x={-(W / 2 + 1.2)} z={hz} scale={0.9} />
        ))}
        <FlowerBed x={-(W / 2 - 0.5)} z={-(D / 2 + 2.0)} w={3} d={0.9} />
        <FlowerBed x={  W / 2 - 0.5}  z={-(D / 2 + 2.0)} w={3} d={0.9} />
        <FlowerBed x={0}              z={  D / 2 + 2.5}   w={4} d={1.0} />
        <Lawn x={0} z={D / 2 + 5} w={W + 4} d={4} />
        <GardenPath W={W} D={D} />
        <DraggableGroup posKey="fountain" label="⛲ 喷泉" defaultX={0} defaultZ={-(D / 2 + 6.5)} hitW={5} hitD={5} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <Fountain x={0} z={0} />
        </DraggableGroup>
        {parking && (
          <DraggableGroup posKey="driveway" label="🚗 停车场" defaultX={0} defaultZ={D / 2} hitW={28} hitD={30} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
            <DrivewayAndParking />
          </DraggableGroup>
        )}
      </>
    );
  }

  if (yardPreset === "pool") {
    return (
      <>
        <DraggableGroup posKey="pool" label="🏊 泳池" defaultX={xOff} defaultZ={0} hitW={16} hitD={13} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <Pool x={0} z={0} w={9} d={5} />
          <Tree x={-1.5} z={-(5 / 2 + 3.5)} type="cypress" scale={1.1} />
          <Tree x={ 1.5} z={-(5 / 2 + 3.5)} type="cypress" scale={1.1} />
          <Tree x={-1.5} z={ 5 / 2 + 3.5}  type="cypress" scale={1.0} />
          <Tree x={ 1.5} z={ 5 / 2 + 3.5}  type="cypress" scale={1.0} />
        </DraggableGroup>
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} scale={1.1} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} type="palm" scale={1.0} />
        <Tree x={xOff + 9.5}   z={-3.5} type="palm" scale={0.9} />
        <Tree x={xOff + 9.5}   z={ 3.5} type="palm" scale={0.9} />
        <DraggableGroup posKey="outdoor_kitchen" label="🍳 户外厨房" defaultX={xOff - 3.0} defaultZ={-(5 / 2 + 6.5)} hitW={8} hitD={6} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <OutdoorKitchen x={0} z={0} />
        </DraggableGroup>
        <Bush x={xOff - 0.8} z={-3.5} scale={0.8} />
        <Bush x={xOff - 0.8} z={ 3.5} scale={0.8} />
        <Lawn x={xOff + 1.0} z={0} w={10} d={12} />
        <GardenPath W={W} D={D} />
        <FlowerBed x={-(W / 2 + 1.5)} z={D / 2 + 1.5} w={3} d={0.8} />
        {parking && (
          <DraggableGroup posKey="driveway" label="🚗 停车场" defaultX={0} defaultZ={D / 2} hitW={28} hitD={30} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
            <DrivewayAndParking />
          </DraggableGroup>
        )}
      </>
    );
  }

  if (yardPreset === "full") {
    return (
      <>
        {/* Symmetrical olive trees flanking the front entrance — Mediterranean villa signature */}
        <Tree x={-(W / 2 + 2.5)} z={-(D / 2 + 1.5)} type="olive"   scale={1.15} />
        <Tree x={  W / 2 + 2.5}  z={-(D / 2 + 1.5)} type="olive"   scale={1.15} />
        {/* Cypress pillars further out — formal sentinels */}
        <Tree x={-(W / 2 + 6.0)} z={-(D / 2 + 2.5)} type="cypress" scale={1.1} />
        <Tree x={  W / 2 + 6.0}  z={-(D / 2 + 2.5)} type="cypress" scale={1.1} />
        {/* Side garden round trees */}
        <Tree x={-(W / 2 + 4.5)} z={  0}             scale={1.05} />
        <Tree x={  W / 2 + 4.5}  z={  0}             scale={1.0} />
        <Tree x={-(W / 2 + 3.5)} z={  D / 2 + 2.5}  scale={0.9} />
        <Tree x={  W / 2 + 3.5}  z={  D / 2 + 2.5}  scale={1.0} />
        {/* Centerpiece tree behind fountain */}
        <Tree x={0}               z={  D / 2 + 7.0}  scale={1.3} />
        {/* Palm pair near pool — tropical accent */}
        <Tree x={xOff + 9.5}      z={-4.0} type="palm"  scale={0.9} />
        <Tree x={xOff + 9.5}      z={ 4.0} type="palm"  scale={0.9} />
        {/* Driveway: cypress columns + boxwood hedge along the edges */}
        {parking && ([8.0, 12.0, 16.0] as number[]).map((cz, i) => (
          <Fragment key={i}>
            <Tree x={-2.8} z={D / 2 + cz} type="cypress" scale={1.0} />
            <Tree x={ 2.8} z={D / 2 + cz} type="cypress" scale={1.0} />
          </Fragment>
        ))}
        {parking && ([6.0, 10.0, 14.0, 18.0] as number[]).map((cz, i) => (
          <Fragment key={`bx-${i}`}>
            <Tree x={-3.6} z={D / 2 + cz} type="boxwood" scale={0.7} />
            <Tree x={ 3.6} z={D / 2 + cz} type="boxwood" scale={0.7} />
          </Fragment>
        ))}
        <DraggableGroup posKey="pool" label="🏊 泳池" defaultX={xOff} defaultZ={0} hitW={16} hitD={13} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <Pool x={0} z={0} w={9} d={5} />
          {/* Topiary spheres — formal pool corners */}
          <Tree x={-4.0} z={-(5 / 2 + 0.8)} type="topiary" scale={1.1} />
          <Tree x={ 4.0} z={-(5 / 2 + 0.8)} type="topiary" scale={1.1} />
          <Tree x={-4.0} z={ 5 / 2 + 0.8}  type="topiary" scale={1.1} />
          <Tree x={ 4.0} z={ 5 / 2 + 0.8}  type="topiary" scale={1.1} />
          {/* Cypress backdrop */}
          <Tree x={-1.8} z={-(5 / 2 + 3.5)} type="cypress" scale={1.05} />
          <Tree x={ 1.8} z={-(5 / 2 + 3.5)} type="cypress" scale={1.05} />
          <Tree x={-1.8} z={ 5 / 2 + 3.5}  type="cypress" scale={1.0} />
          <Tree x={ 1.8} z={ 5 / 2 + 3.5}  type="cypress" scale={1.0} />
        </DraggableGroup>
        <DraggableGroup posKey="pergola" label="🏛 凉亭" defaultX={-(xOff - 2)} defaultZ={D / 2 + 5} hitW={10} hitD={9} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <Pergola x={0} z={0} />
        </DraggableGroup>
        <DraggableGroup posKey="fountain" label="⛲ 喷泉" defaultX={0} defaultZ={-(D / 2 + 7.0)} hitW={5} hitD={5} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <Fountain x={0} z={0} />
        </DraggableGroup>
        <DraggableGroup posKey="outdoor_kitchen" label="🍳 户外厨房" defaultX={xOff - 3.0} defaultZ={-(5 / 2 + 7.0)} hitW={8} hitD={6} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
          <OutdoorKitchen x={0} z={0} />
        </DraggableGroup>
        <FlowerBed x={-(W / 2 - 0.5)} z={-(D / 2 + 2.0)} w={2.5} d={0.9} />
        <FlowerBed x={  W / 2 - 0.5}  z={-(D / 2 + 2.0)} w={2.5} d={0.9} />
        <FlowerBed x={0}              z={  D / 2 + 2.5}   w={5} d={1.0} />
        {[-D/3, 0, D/3].map((hz, i) => (
          <Bush key={i} x={-(W / 2 + 1.6)} z={hz} scale={1.0} />
        ))}
        <Lawn x={xOff + 1.0} z={0} w={10} d={14} />
        <Lawn x={0} z={D / 2 + 5.5} w={W + 6} d={5} />
        <GardenPath W={W} D={D} />
        {parking && (
          <DraggableGroup posKey="driveway" label="🚗 停车场" defaultX={0} defaultZ={D / 2} hitW={28} hitD={30} orbitRef={orbitRef} selectedKey={selectedKey} onSelect={onSelect}>
            <DrivewayAndParking />
          </DraggableGroup>
        )}
      </>
    );
  }

  return null;
}

// ─── Ground ─────────────────────────────────────────────────
// ─── PBR texture set loader ─────────────────────────────────
// Maps a /public/textures/<dir>/<asset>_{diff,nor_gl,arm}_1k.jpg PolyHaven
// triple to a configured material props object. `repeat` tiles the texture
// over the surface — pass the world dimensions in meters for natural scale.
function usePbrSet(dir: string, asset: string, repeat: [number, number]): {
  map: THREE.Texture; normalMap: THREE.Texture; aoMap: THREE.Texture; roughnessMap: THREE.Texture;
} {
  const base = `/textures/${dir}/${asset}`;
  const [diff, nor, arm] = useLoader(THREE.TextureLoader, [
    `${base}_diff_1k.jpg`,
    `${base}_nor_gl_1k.jpg`,
    `${base}_arm_1k.jpg`,
  ]);
  return useMemo(() => {
    for (const t of [diff, nor, arm]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
      t.anisotropy = 8;
    }
    diff.colorSpace = THREE.SRGBColorSpace;
    return { map: diff, normalMap: nor, aoMap: arm, roughnessMap: arm };
  }, [diff, nor, arm, repeat]);
}

// PBR-textured grass ground — loads the aerial_grass_rock PolyHaven set.
// In Suspense so the flat-color fallback shows while textures fetch.
function GrassGroundTextured({ size }: { size: number }) {
  const rep: [number, number] = [size * 1.8, size * 1.8];
  const grass = usePbrSet("ground", "aerial_grass_rock", rep);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.499, 0]} receiveShadow>
      <planeGeometry args={[size, size, 6, 6]} />
      <meshStandardMaterial
        {...grass}
        roughness={0.92}
        metalness={0.0}
        envMapIntensity={0.4}
      />
    </mesh>
  );
}

// Cobblestone entry path — always shown as a visual anchor connecting
// the front door to the property edge. Uses cobblestone_05 PBR texture.
function EntryPathTextured({ W, D }: { W: number; D: number }) {
  const { map, normalMap, roughnessMap } = usePbrSet("driveway", "cobblestone_05", [2, 5]);
  const pathLen = D * 0.5 + 4.5;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.498, D / 2 + pathLen / 2 - 0.1]} receiveShadow>
        <planeGeometry args={[1.5, pathLen]} />
        <meshStandardMaterial map={map} normalMap={normalMap} roughnessMap={roughnessMap}
          color="#D8D0C0" roughness={0.88} metalness={0.0} />
      </mesh>
    </group>
  );
}

function EntryPath({ W, D }: { W: number; D: number }) {
  const pathLen = D * 0.5 + 4.5;
  return (
    <Suspense fallback={
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.498, D / 2 + pathLen / 2 - 0.1]} receiveShadow>
        <planeGeometry args={[1.5, pathLen]} />
        <meshStandardMaterial color="#C8BEA8" roughness={0.9} />
      </mesh>
    }>
      <EntryPathTextured W={W} D={D} />
    </Suspense>
  );
}

function Ground({ W, D }: { W: number; D: number }) {
  const yardSize = Math.max(W, D) * 2.0;
  const sizeX = W + yardSize * 2;
  const sizeZ = D + yardSize * 2;
  const lawnSize = Math.max(W, D) * 2.2;
  return (
    <>
      {/* Far ground — neutral tone, fades into horizon */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.501, 0]} receiveShadow>
        <planeGeometry args={[sizeX, sizeZ, 1, 1]} />
        <meshStandardMaterial color="#BDB8A8" roughness={1.0} />
      </mesh>
      {/* Inset lawn — PBR grass texture. Suspense boundary falls back to
          flat sage while the texture loads over the network. */}
      <Suspense fallback={
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.499, 0]} receiveShadow>
          <planeGeometry args={[lawnSize, lawnSize, 1, 1]} />
          <meshStandardMaterial color="#9DAD8C" roughness={1.0} />
        </mesh>
      }>
        <GrassGroundTextured size={lawnSize} />
      </Suspense>
    </>
  );
}

// ─── Instanced grass-blade carpet ────────────────────────────
// Scatters thousands of thin tapered triangles across the lawn. Skips
// blades that fall inside the house footprint or pool footprint so they
// don't poke through hard surfaces.
function GrassCarpet({ W, D, count, radius }: { W: number; D: number; count: number; radius: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geom = useMemo(() => {
    // 2-tri tapered blade: rectangular base narrowing to a point
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array([
      // base-left, base-right, tip
      -0.025, 0,    0,
       0.025, 0,    0,
       0,     0.18, 0,
    ]);
    g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    return g;
  }, []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const halfW = W / 2 + 0.5;
    const halfD = D / 2 + 0.5;
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 4) {
      attempts++;
      // Sample within a ring around the house
      const r = Math.sqrt(Math.random()) * radius;
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Skip house footprint (with margin)
      if (Math.abs(x) < halfW && Math.abs(z) < halfD) continue;
      dummy.position.set(x, -0.49, z);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      const s = 0.7 + Math.random() * 0.7;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      // Color variation: lighter / darker greens
      const tint = 0.55 + Math.random() * 0.35;
      const col = new THREE.Color(0.30 * tint + 0.10, 0.55 * tint, 0.18 * tint);
      mesh.setColorAt(placed, col);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count, radius, W, D]);

  return (
    <instancedMesh ref={meshRef} args={[geom, undefined, count]} castShadow={false} receiveShadow>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={1.0} />
    </instancedMesh>
  );
}

// ─── Distant tree ring (skybox horizon mask) ─────────────────
// Cheap low-detail conifer cones placed in a wide circle around the
// property, well past the lawn edge. Hides the abrupt end of the ground
// plane and adds depth to the horizon.
function DistantTreeRing({ radius, count }: { radius: number; count: number }) {
  const trees = useMemo(() => {
    const out: { x: number; z: number; h: number; tint: number }[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.06;
      const r = radius + Math.random() * radius * 0.18;
      out.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        h: 4 + Math.random() * 5,
        tint: 0.6 + Math.random() * 0.35,
      });
    }
    return out;
  }, [radius, count]);
  return (
    <group>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]}>
          {/* Trunk */}
          <mesh position={[0, t.h * 0.18, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.25, t.h * 0.36, 5]} />
            <meshStandardMaterial color="#3a2812" roughness={0.95} />
          </mesh>
          {/* Foliage cone */}
          <mesh position={[0, t.h * 0.65, 0]} castShadow>
            <coneGeometry args={[t.h * 0.42, t.h * 0.95, 7]} />
            <meshStandardMaterial color={new THREE.Color(30 * t.tint / 255, 80 * t.tint / 255, 40 * t.tint / 255)} roughness={0.95} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ─── Slat fence (technical-preview perimeter line) ───────────
// Plain monochrome posts + horizontal rails, low-fi but legible — reads
// as a site-plan boundary line, not a real fence model.
function SlatFence({ W, D, insetX, insetZ }: { W: number; D: number; insetX: number; insetZ: number }) {
  const halfX = insetX;
  const halfZ = insetZ;
  const POST_SPACING = 2.5;
  const FENCE_H = 1.4;
  const FENCE_COLOR = "#8C8678";   // muted khaki
  const POST_COLOR = "#5C5648";
  const drivewayGap = 3.0;

  const sides: Array<{ key: string; cx: number; cz: number; len: number; angle: number; gap?: boolean }> = [
    { key: "front", cx: 0,        cz:  halfZ, len: halfX * 2, angle: 0,            gap: true },
    { key: "back",  cx: 0,        cz: -halfZ, len: halfX * 2, angle: 0 },
    { key: "left",  cx: -halfX,   cz: 0,      len: halfZ * 2, angle: Math.PI / 2 },
    { key: "right", cx:  halfX,   cz: 0,      len: halfZ * 2, angle: Math.PI / 2 },
  ];

  return (
    <group>
      {sides.map(side => {
        const halfLen = side.len / 2;
        const posts: number[] = [];
        for (let t = -halfLen; t <= halfLen + 0.001; t += POST_SPACING) {
          if (side.gap && Math.abs(t) < drivewayGap) continue;
          posts.push(t);
        }
        // Top + middle rails; punched by driveway gap on the front side
        const railRows = [FENCE_H * 0.85, FENCE_H * 0.45].map(yLocal => {
          if (!side.gap) return [{ cx: 0, len: side.len, y: yLocal }];
          const segLen = halfLen - drivewayGap;
          return [
            { cx: -(drivewayGap + segLen / 2), len: segLen, y: yLocal },
            { cx:   drivewayGap + segLen / 2, len: segLen, y: yLocal },
          ];
        });
        return (
          <group key={side.key} position={[side.cx, -0.5, side.cz]} rotation={[0, side.angle, 0]}>
            {posts.map((t, i) => (
              <mesh key={`p-${i}`} position={[t, FENCE_H / 2, 0]} castShadow>
                <boxGeometry args={[0.08, FENCE_H, 0.08]} />
                <meshStandardMaterial color={POST_COLOR} roughness={0.85} />
              </mesh>
            ))}
            {railRows.flat().map((r, i) => (
              <mesh key={`r-${i}`} position={[r.cx, r.y, 0]} castShadow>
                <boxGeometry args={[r.len, 0.06, 0.05]} />
                <meshStandardMaterial color={FENCE_COLOR} roughness={0.9} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

// ─── House body ──────────────────────────────────────────────
function HouseBody({ W, D, settings }: { W: number; D: number; settings: ExteriorSettings }) {
  const { floors, roofStyle, roofColor, accentColor } = settings;
  const totalH = floors * FLOOR_H;
  // 架空层 (pilotis) — lift the entire house body by this many metres.
  // Default 0 = slab on grade. >0 = stilted / modernist pilotis / Chinese
  // raised platform. Adds 4 corner support columns automatically.
  const pilotisH = Math.max(0, settings.pilotisHeightM ?? 0);
  // Check: does any indoor room have a non-rect polygon shape? If so, we
  // bypass the bbox-based FloorShell and render per-room polygon walls
  // so L型/凸字型 notches show up correctly on the exterior.
  const activeFloor    = useDesignerStore(s => s.activeFloor);
  const enabledRooms   = useDesignerStore(s => s.floorPlans[activeFloor].enabledRooms);
  const roomShapes     = useDesignerStore(s => s.floorPlans[activeFloor].roomShapes);
  const hasPolygonRoom = enabledRooms.some(r =>
    !ROOM_DEFS[r].isOutdoor && roomShapes?.[r] && roomShapes[r]!.preset !== "rect"
  );

  // Corner column positions (4 corners of the house bbox) — only rendered
  // when pilotisH > 0. Slim 30×30cm concrete columns matching the
  // technical-drawing palette.
  const columnPositions: [number, number][] = [
    [-(W / 2 - 0.2), -(D / 2 - 0.2)],
    [ (W / 2 - 0.2), -(D / 2 - 0.2)],
    [-(W / 2 - 0.2),  (D / 2 - 0.2)],
    [ (W / 2 - 0.2),  (D / 2 - 0.2)],
  ];

  return (
    <group>
      {/* Foundation only when NOT pilotis — pilotis means the house
          floats and there's no foundation slab. */}
      {pilotisH === 0 && <Foundation W={W} D={D} color={accentColor} />}

      {/* Pilotis support columns — only when lifted */}
      {pilotisH > 0 && columnPositions.map(([cx, cz], i) => (
        <mesh key={`pillar-${i}`} position={[cx, pilotisH / 2, cz]} castShadow receiveShadow>
          <boxGeometry args={[0.30, pilotisH, 0.30]} />
          <meshStandardMaterial color="#C8C5BE" roughness={0.85} />
        </mesh>
      ))}
      {/* Floor slab UNDER the lifted house — visual ceiling for the
          pilotis space below. Travertine-cream so it matches the deck
          aesthetic of social Prefabs. */}
      {pilotisH > 0 && (
        <mesh position={[0, pilotisH - 0.05, 0]} castShadow receiveShadow>
          <boxGeometry args={[W + 0.4, 0.10, D + 0.4]} />
          <meshStandardMaterial color="#D8D0C0" roughness={0.85} />
        </mesh>
      )}

      {/* Lift the entire house body (walls + floors + roof) by pilotisH */}
      <group position={[0, pilotisH, 0]}>
        {hasPolygonRoom ? (
          <PolygonHouseShell floors={floors} settings={settings} />
        ) : (
          Array.from({ length: floors }).map((_, i) => (
            <FloorShell key={i} floorIndex={i} W={W} D={D} settings={settings} totalFloors={floors} />
          ))
        )}
        <group position={[0, totalH, 0]}>
          {hasPolygonRoom && roofStyle === "flat"
            ? <PolygonFlatRoof color={roofColor} />
            : <RoofSwitch W={W} D={D} roofStyle={roofStyle} roofColor={roofColor} />}
        </group>
      </group>
    </group>
  );
}

/** Flat roof that follows the (per-room) polygon footprint so L 型 房间的
 *  缺角在屋顶上也是镂空的。Per-room slabs overlap where rooms are adjacent
 *  — same visual strategy as PolygonHouseShell's floors. Non-flat roof
 *  styles (gable/hip/mansard/chinese) still use the bbox approximation
 *  (acceptable: those are already stylized). */
function PolygonFlatRoof({ color }: { color: string }) {
  const activeFloor    = useDesignerStore(s => s.activeFloor);
  const enabledRooms   = useDesignerStore(s => s.floorPlans[activeFloor].enabledRooms);
  const roomLayout     = useDesignerStore(s => s.floorPlans[activeFloor].roomLayout);
  const roomDimensions = useDesignerStore(s => s.floorPlans[activeFloor].roomDimensions);
  const roomShapes     = useDesignerStore(s => s.floorPlans[activeFloor].roomShapes);

  const { minX, minZ, W: houseW, D: houseD } = useMemo(() => {
    const indoor = enabledRooms.filter(r => !ROOM_DEFS[r].isOutdoor);
    if (!indoor.length) return { minX: 0, minZ: 0, W: 8, D: 6 };
    const xs = indoor.flatMap(r => [roomLayout[r].x, roomLayout[r].x + roomDimensions[r].width]);
    const zs = indoor.flatMap(r => [roomLayout[r].y, roomLayout[r].y + roomDimensions[r].depth]);
    return {
      minX: Math.min(...xs), minZ: Math.min(...zs),
      W: (Math.max(...xs) - Math.min(...xs)) / 100,
      D: (Math.max(...zs) - Math.min(...zs)) / 100,
    };
  }, [enabledRooms, roomLayout, roomDimensions]);

  const slabs = useMemo(() => {
    const out: Array<{ shape: THREE.Shape }> = [];
    for (const room of enabledRooms) {
      if (ROOM_DEFS[room].isOutdoor) continue;
      const dims = roomDimensions[room];
      const lay  = roomLayout[room];
      const s = roomShapes?.[room];
      const cmPts: Array<[number, number]> =
        s && s.preset !== "rect"
          ? s.points
          : [[0, 0], [dims.width, 0], [dims.width, dims.depth], [0, dims.depth]];
      const shp = new THREE.Shape();
      cmPts.forEach(([lx, lz], i) => {
        const wx = (lay.x + lx - minX) / 100 - houseW / 2;
        const wz = (lay.y + lz - minZ) / 100 - houseD / 2;
        i === 0 ? shp.moveTo(wx, wz) : shp.lineTo(wx, wz);
      });
      shp.closePath();
      out.push({ shape: shp });
    }
    return out;
  }, [enabledRooms, roomLayout, roomDimensions, roomShapes, minX, minZ, houseW, houseD]);

  return (
    <group>
      {slabs.map(({ shape }, i) => (
        <mesh key={i} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.11, 0]} castShadow receiveShadow>
          <shapeGeometry args={[shape]} />
          <meshStandardMaterial color={color} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

/** Renders the house exterior by iterating every indoor room and drawing
 *  walls along that room's polygon edges (rect rooms → 4 walls; L/convex
 *  → N walls along the polygon). Floors get a polygon floor slab each.
 *  Inter-room shared walls end up coinciding geometrically, which is
 *  visually fine (z-fighting mitigated by a tiny +0.002 m wall thickness
 *  offset between neighbors; box thickness WT handles most of it anyway).
 *
 *  Coords: uses the same "house centered on world origin" convention as
 *  FloorShell — computed from roomLayout + roomDimensions bounds. */
function PolygonHouseShell({ floors, settings }: { floors: number; settings: ExteriorSettings }) {
  const { wallColor } = settings;
  const activeFloor    = useDesignerStore(s => s.activeFloor);
  const enabledRooms   = useDesignerStore(s => s.floorPlans[activeFloor].enabledRooms);
  const roomLayout     = useDesignerStore(s => s.floorPlans[activeFloor].roomLayout);
  const roomDimensions = useDesignerStore(s => s.floorPlans[activeFloor].roomDimensions);
  const roomShapes     = useDesignerStore(s => s.floorPlans[activeFloor].roomShapes);

  const { minX, minZ, W: houseW, D: houseD } = useMemo(() => {
    const indoor = enabledRooms.filter(r => !ROOM_DEFS[r].isOutdoor);
    if (!indoor.length) return { minX: 0, minZ: 0, W: 8, D: 6 };
    const xs = indoor.flatMap(r => [roomLayout[r].x, roomLayout[r].x + roomDimensions[r].width]);
    const zs = indoor.flatMap(r => [roomLayout[r].y, roomLayout[r].y + roomDimensions[r].depth]);
    return {
      minX: Math.min(...xs), minZ: Math.min(...zs),
      W: (Math.max(...xs) - Math.min(...xs)) / 100,
      D: (Math.max(...zs) - Math.min(...zs)) / 100,
    };
  }, [enabledRooms, roomLayout, roomDimensions]);

  // Per-room polygon points (use rect fallback when no shape is set)
  const roomPolys = useMemo(() => {
    const result: Array<{
      room: import("@/lib/types").RoomType;
      // world-space edge segments (cm → meters, centered)
      edges: Array<{ x1: number; z1: number; x2: number; z2: number }>;
      // polygon in world meters for the floor slab
      shapePoints: Array<[number, number]>;
    }> = [];
    for (const room of enabledRooms) {
      if (ROOM_DEFS[room].isOutdoor) continue;
      const dims = roomDimensions[room];
      const lay  = roomLayout[room];
      const shape = roomShapes?.[room];
      // cm polygon (room-local, origin = back-left)
      const cmPts: Array<[number, number]> =
        shape && shape.preset !== "rect"
          ? shape.points
          : [[0, 0], [dims.width, 0], [dims.width, dims.depth], [0, dims.depth]];
      // Convert to world meters (house centered on origin)
      const toWorld = ([lx, lz]: [number, number]): [number, number] => [
        (lay.x + lx - minX) / 100 - houseW / 2,
        (lay.y + lz - minZ) / 100 - houseD / 2,
      ];
      const worldPts = cmPts.map(toWorld);
      const edges: Array<{ x1: number; z1: number; x2: number; z2: number }> = [];
      for (let i = 0; i < worldPts.length; i++) {
        const [x1, z1] = worldPts[i];
        const [x2, z2] = worldPts[(i + 1) % worldPts.length];
        edges.push({ x1, z1, x2, z2 });
      }
      result.push({ room, edges, shapePoints: worldPts });
    }
    return result;
  }, [enabledRooms, roomLayout, roomDimensions, roomShapes, minX, minZ, houseW, houseD]);

  return (
    <group>
      {roomPolys.map(({ room, edges, shapePoints }) => (
        <group key={room}>
          {/* Floor slabs — one per storey */}
          {Array.from({ length: floors }).map((_, f) => {
            const shp = new THREE.Shape();
            shapePoints.forEach(([x, z], i) => {
              i === 0 ? shp.moveTo(x, z) : shp.lineTo(x, z);
            });
            shp.closePath();
            return (
              <mesh
                key={`floor-${f}`}
                rotation={[Math.PI / 2, 0, 0]}
                position={[0, f * FLOOR_H + 0.02, 0]}
                receiveShadow
              >
                <shapeGeometry args={[shp]} />
                <meshStandardMaterial color="#D0CABB" roughness={0.95} side={THREE.DoubleSide} />
              </mesh>
            );
          })}
          {/* Walls along each polygon edge, per floor */}
          {Array.from({ length: floors }).map((_, f) => (
            <group key={`walls-${f}`} position={[0, f * FLOOR_H, 0]}>
              {edges.map(({ x1, z1, x2, z2 }, i) => {
                const dx = x2 - x1, dz = z2 - z1;
                const lenM = Math.hypot(dx, dz);
                if (lenM < 0.01) return null;
                const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
                const angle = Math.atan2(-dz, dx);
                return (
                  <mesh
                    key={i}
                    position={[cx, FLOOR_H / 2, cz]}
                    rotation={[0, angle, 0]}
                    castShadow receiveShadow
                  >
                    <boxGeometry args={[lenM, FLOOR_H, WT]} />
                    <meshStandardMaterial color={wallColor} roughness={0.85} />
                  </mesh>
                );
              })}
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

// ─── Deselect plane (click empty ground to clear selection) ──
function DeselectPlane({ onDeselect }: { onDeselect: () => void }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.502, 0]}
      onPointerDown={(e) => { e.stopPropagation(); onDeselect(); }}
    >
      <planeGeometry args={[2000, 2000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

// ─── Sun Analysis: continuous time-of-day with real-time shadow ──────────────
// getSunPosition3D (SunCalc-based) is imported from @/lib/sunAnalysis.
// The slider drives sunHour in the global store so AiRenderModal can
// read the same value when building the exterior render prompt.

type SkyPhase = "night" | "dawn" | "day" | "dusk";

interface SkyTheme {
  phase:        SkyPhase;
  sunColor:     string;  sunIntensity: number;
  fillColor:    string;  fillIntensity: number;
  hemiSky:      string;  hemiGround: string; hemiIntensity: number;
  ambient:      number;
  fogColor:     string;  fogNear: number; fogFar: number;
  exposure:     number;
  hdr:          string;
  skyRgb:       [number, number, number];
}

function _lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const s = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
}
function _rgbHex(c: [number, number, number]) {
  return "#" + c.map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("");
}

function getSkyTheme(hour: number): SkyTheme {
  const t    = Math.max(0, Math.min(1, (hour - 6) / 13));
  const elev = Math.sin(t * Math.PI);

  if (hour < 5.5 || hour > 19.5) return {
    phase: "night",
    sunColor: "#B8C4D8", sunIntensity: 0.45,
    fillColor: "#3A4258", fillIntensity: 0.22,
    hemiSky: "#252D3F", hemiGround: "#10131C", hemiIntensity: 0.32,
    ambient: 0.20, fogColor: "#181C28", fogNear: 80, fogFar: 240,
    exposure: 0.82, hdr: "/hdr/venice_sunset_1k.hdr",
    skyRgb: [10, 15, 30],
  };

  if (hour < 8) {
    const p: number = (hour - 5.5) / 2.5;
    return {
      phase: "dawn",
      sunColor: "#F8C870", sunIntensity: 0.8 + elev * 1.4,
      fillColor: "#9090C8", fillIntensity: 0.32,
      hemiSky: "#D07050", hemiGround: "#503020", hemiIntensity: 0.50,
      ambient: 0.22 + elev * 0.10,
      fogColor: "#C08060", fogNear: 35, fogFar: 150,
      exposure: 0.92 + p * 0.12,
      hdr: "/hdr/venice_sunset_1k.hdr",
      skyRgb: _lerpRgb([20, 10, 40], [130, 185, 220], p),
    };
  }

  if (hour > 17) {
    const p: number = (hour - 17) / 2.5;
    return {
      phase: "dusk",
      sunColor: "#F89830", sunIntensity: 0.7 + elev * 1.6,
      fillColor: "#8898C0", fillIntensity: 0.38,
      hemiSky: "#C86040", hemiGround: "#503020", hemiIntensity: 0.55,
      ambient: 0.26 + elev * 0.08,
      fogColor: "#C08050", fogNear: 50, fogFar: 200,
      exposure: 1.06 + (1 - elev) * 0.06,
      hdr: "/hdr/venice_sunset_1k.hdr",
      skyRgb: _lerpRgb([78, 145, 216], [20, 15, 40], p),
    };
  }

  // Daytime 8–17: elevation drives colour saturation
  return {
    phase: "day",
    sunColor: "#FFF8F0", sunIntensity: 1.6 + elev * 0.9,
    fillColor: "#C8E0F8", fillIntensity: 0.45 + elev * 0.12,
    hemiSky: "#C8DDEF", hemiGround: "#A8A070", hemiIntensity: 0.58 + elev * 0.10,
    ambient: 0.28 + elev * 0.10,
    fogColor: "#4E8FCC", fogNear: 28, fogFar: 90,
    exposure: 1.02 + elev * 0.08,
    hdr: "/hdr/potsdamer_platz_1k.hdr",
    skyRgb: _lerpRgb([130, 185, 220], [60, 130, 200], elev),
  };
}

function _formatHour(h: number) {
  const hh   = Math.floor(h);
  const mm   = Math.round((h - hh) * 60);
  const ampm = hh < 12 ? "AM" : "PM";
  return `${hh % 12 || 12}:${mm.toString().padStart(2, "0")} ${ampm}`;
}

// ─── Villa yard: lawn + terrace + pool + loungers (modern preset) ────────────
function VillaYard({ W, D }: { W: number; D: number }) {
  // Pool dimensions — wide & long, like the luxury villa reference photos
  const pw  = Math.min(W * 0.88, 9.5);   // pool width ≈ 88% of building width
  const pd  = Math.max(pw * 1.9, 11.0);  // pool length — long rectangular
  const gap = 0.65;                       // terrace gap between building face and pool start
  const deckSide = 2.2;                   // wide travertine deck on near side for loungers
  const poolBackZ  = D / 2 + gap;        // where pool starts (back edge, closest to building)
  const pz  = poolBackZ + pd / 2;        // pool center

  // Terrace dimensions
  const terrD = gap + 0.4;              // stone patio depth

  // Lawn extends wide on both sides and beyond pool
  const lawnTotalD = terrD + pd + deckSide + 6;

  return (
    <group position={[0, 0, 0]}>
      {/* ── Green lawn (sides + foreground) ── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.496, D / 2 + lawnTotalD / 2 - 1.5]} receiveShadow>
        <planeGeometry args={[W * 3.5, lawnTotalD]} />
        <meshStandardMaterial color="#548A38" roughness={0.96} metalness={0.0} envMapIntensity={0.55} />
      </mesh>

      {/* ── Travertine terrace — individual 600×900 mm tiles with visible seam lines.
          The tile joints give ControlNet Canny strong ground-plane line conditioning,
          guiding SDXL to reproduce travertine paving rather than a plain slab. ── */}
      {(() => {
        const TW = 0.60, TD = 0.90, GAP = 0.013;
        const deckW  = W + 1.0;
        const cols   = Math.ceil(deckW / (TW + GAP)) + 1;
        const rows   = Math.ceil(terrD / (TD + GAP)) + 1;
        const startX = -(cols * (TW + GAP)) / 2 + TW / 2;
        const startZ = D / 2 + TD / 2;
        return Array.from({ length: cols }).flatMap((_, c) =>
          Array.from({ length: rows }).map((_, r) => {
            const brightness = ((c + r) % 2 === 0) ? "#E8DBC8" : "#EDE2D0";
            return (
              <mesh key={`tr-${c}-${r}`}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[startX + c * (TW + GAP), -0.490, startZ + r * (TD + GAP)]}
                receiveShadow>
                <planeGeometry args={[TW, TD]} />
                <meshStandardMaterial color={brightness} roughness={0.80} metalness={0.02} />
              </mesh>
            );
          })
        );
      })()}

      {/* ── Pool surround deck — same 600×900 tiles, slightly warmer tone ── */}
      {(() => {
        const TW = 0.60, TD = 0.90, GAP = 0.013;
        const dW = pw + deckSide * 2 + 0.5;
        const dD = pd + deckSide * 2;
        const cols   = Math.ceil(dW / (TW + GAP)) + 1;
        const rows   = Math.ceil(dD / (TD + GAP)) + 1;
        const startX = -(cols * (TW + GAP)) / 2 + TW / 2;
        const startZ = pz - dD / 2 + TD / 2;
        return Array.from({ length: cols }).flatMap((_, c) =>
          Array.from({ length: rows }).map((_, r) => {
            const brightness = ((c + r) % 2 === 0) ? "#EDE0C8" : "#F2E8D5";
            return (
              <mesh key={`pd-${c}-${r}`}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[startX + c * (TW + GAP), -0.488, startZ + r * (TD + GAP)]}
                receiveShadow>
                <planeGeometry args={[TW, TD]} />
                <meshStandardMaterial color={brightness} roughness={0.78} metalness={0.02} />
              </mesh>
            );
          })
        );
      })()}

      {/* ── Entry steps — 3 shallow stone steps descending from terrace to pool level.
          Strong horizontal shadow lines for Canny conditioning. ── */}
      {[0, 1, 2].map(s => (
        <mesh key={`step-${s}`}
          position={[0, -0.12 + s * 0.06, D / 2 + terrD + s * 0.32]}
          castShadow receiveShadow>
          <boxGeometry args={[pw * 0.55, 0.07, 0.30]} />
          <meshStandardMaterial color="#D8CEBC" roughness={0.72} metalness={0.04} />
        </mesh>
      ))}

      {/* ── Pool shell — organic shape: rectangle body + one semicircular far end.
          The curved end gives Canny/Depth a distinctive organic line that distinguishes
          a luxury pool from a plain rectangle. ── */}
      {(() => {
        const poolDepth = 0.56;
        const shellY    = -0.28;
        // Straight rectangular body (full length — the semicircle overlaps at the end)
        return (
          <group>
            <mesh position={[0, shellY, pz]} receiveShadow castShadow>
              <boxGeometry args={[pw + 0.36, poolDepth, pd + 0.36]} />
              <meshStandardMaterial color="#D8CEBC" roughness={0.70} />
            </mesh>
            {/* Semicircular rounded far end — half-cylinder radius = (pw+0.36)/2 */}
            <mesh position={[0, shellY, pz + pd / 2 + 0.18]}
              rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[(pw + 0.36) / 2, (pw + 0.36) / 2, poolDepth, 28, 1, false, 0, Math.PI]} />
              <meshStandardMaterial color="#D8CEBC" roughness={0.70} />
            </mesh>
          </group>
        );
      })()}

      {/* ── Pool interior (turquoise plaster) — matching organic rounded far end ── */}
      {(() => {
        const iy = -0.05, depth = 0.50;
        return (
          <group>
            <mesh position={[0, iy, pz]}>
              <boxGeometry args={[pw, depth, pd]} />
              <meshStandardMaterial color="#0E6B7A" roughness={0.15} metalness={0.0} />
            </mesh>
            {/* Semicircular interior end */}
            <mesh position={[0, iy, pz + pd / 2]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[pw / 2, pw / 2, depth, 28, 1, false, 0, Math.PI]} />
              <meshStandardMaterial color="#0E6B7A" roughness={0.15} metalness={0.0} />
            </mesh>
          </group>
        );
      })()}

      {/* ── Water surface ── */}
      <mesh position={[0, 0.03, pz]}>
        <boxGeometry args={[pw - 0.04, 0.06, pd - 0.04]} />
        <meshPhysicalMaterial
          color="#38B4D8"
          transmission={0.62}
          roughness={0.01}
          ior={1.33}
          metalness={0.0}
          thickness={1.4}
          envMapIntensity={8.0}
        />
      </mesh>
      {/* Water rounded end */}
      <mesh position={[0, 0.03, pz + pd / 2 - 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[(pw - 0.04) / 2, (pw - 0.04) / 2, 0.06, 28, 1, false, 0, Math.PI]} />
        <meshPhysicalMaterial color="#38B4D8" transmission={0.62} roughness={0.01} ior={1.33} metalness={0.0} thickness={1.4} envMapIntensity={8.0} />
      </mesh>

      {/* ── Coping edge strips (3 straight sides — no coping on rounded end) ── */}
      {([[-1,0],[1,0],[0,-1]] as [number,number][]).map(([sx, sz], i) => {
        const horiz = sz === 0;
        const len = horiz ? pd + 0.5 : pw + 0.5;
        return (
          <mesh key={i}
            position={[sx*(pw/2+0.22), 0.04, pz + sz*(pd/2+0.22)]}
            castShadow receiveShadow>
            <boxGeometry args={horiz ? [0.35,0.06,len] : [len,0.06,0.35]} />
            <meshStandardMaterial color="#F2EAD8" roughness={0.62} />
          </mesh>
        );
      })}
      {/* Curved coping on rounded end */}
      <mesh position={[0, 0.04, pz + pd / 2 + 0.22]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[(pw + 0.5) / 2, (pw + 0.5) / 2, 0.06, 28, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#F2EAD8" roughness={0.62} />
      </mesh>

      {/* ── Sun loungers — 4 along pool near edge, like reference photos ── */}
      {([-0.60, -0.20, 0.20, 0.60] as number[]).map((xFrac, i) => {
        const lx = xFrac * pw;
        const lz = pz + pd / 2 + deckSide * 0.45;
        return (
          <group key={i} position={[lx, 0, lz]}>
            {/* Frame */}
            <mesh position={[0, 0.20, 0]} castShadow>
              <boxGeometry args={[0.60, 0.05, 1.80]} />
              <meshStandardMaterial color="#B8A878" roughness={0.78} metalness={0.08} />
            </mesh>
            {/* Cushion */}
            <mesh position={[0, 0.25, 0]}>
              <boxGeometry args={[0.52, 0.08, 1.65]} />
              <meshStandardMaterial color="#F5EFDF" roughness={0.90} />
            </mesh>
            {/* Legs */}
            {([-0.7, 0.7] as number[]).map((lzOff, j) => (
              <mesh key={j} position={[0, 0.10, lzOff]} castShadow>
                <boxGeometry args={[0.52, 0.20, 0.04]} />
                <meshStandardMaterial color="#C0A868" roughness={0.80} metalness={0.06} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

// ─── Main export ────────────────────────────────────────────
export default function HouseCanvas() {
  const exterior      = useDesignerStore(s => s.exterior);
  const { W, D }      = useFootprint();
  const { floors }    = exterior;
  const orbitRef      = useRef<any>(null);
  const [selectedOutdoorKey, setSelectedOutdoorKey] = useState<string | null>(null);
  // Sun analysis — read from global store so AiRenderModal + YardPlan share the value
  const sunHour     = useDesignerStore(s => s.sunHour);
  const setSunHour  = useDesignerStore(s => s.setSunHour);
  const siteLatLng  = useDesignerStore(s => s.siteLatLng);
  const sunPos = getSunPosition3D(sunHour, siteLatLng);
  const theme  = getSkyTheme(sunHour);
  const skyHex = _rgbHex(theme.skyRgb);

  return (
    <div className="w-full h-full relative">
      {/* ── Sun Analysis Slider ── bottom-centre, draggable 0-24h ── */}
      <div
        className="absolute bottom-4 left-1/2 z-10 flex items-center gap-3 select-none"
        style={{
          transform: "translateX(-50%)",
          background: "rgba(8,10,20,0.80)",
          backdropFilter: "blur(14px)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 28,
          padding: "8px 18px",
          boxShadow: "0 4px 28px rgba(0,0,0,0.45)",
        }}
      >
        {/* Phase icon — updates as you drag */}
        <span style={{ fontSize: 15, lineHeight: 1 }}>
          {theme.phase === "night" ? "🌙" : theme.phase === "dawn" ? "🌅" : theme.phase === "dusk" ? "🌇" : "☀️"}
        </span>

        {/* Time readout */}
        <span style={{
          color: "#fff", fontSize: 12, fontFamily: "monospace",
          minWidth: 62, fontWeight: 700, letterSpacing: "0.03em",
          opacity: 0.92,
        }}>
          {sunFormatHour(sunHour)}
        </span>

        {/* Gradient track + invisible range input */}
        <div style={{ position: "relative", width: 200, height: 20, display: "flex", alignItems: "center" }}>
          {/* Colour gradient representing the day arc */}
          <div style={{
            position: "absolute", left: 0, right: 0, top: "50%", transform: "translateY(-50%)",
            height: 5, borderRadius: 3,
            background: "linear-gradient(to right, #0A0F1E 0%, #1A0C28 8%, #D87850 22%, #87CEEB 42%, #4E8FCC 55%, #87CEEB 68%, #C86840 82%, #1A0C28 92%, #0A0F1E 100%)",
          }} />
          {/* Sun thumb dot */}
          <div style={{
            position: "absolute",
            left: `${(sunHour / 24) * 100}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: 14, height: 14,
            borderRadius: "50%",
            background: theme.phase === "night" ? "#B0C0FF" : "#F8C04A",
            boxShadow: `0 0 8px 2px ${theme.phase === "night" ? "#B0C0FF55" : "#F8C04A88"}`,
            pointerEvents: "none",
            transition: "background 0.4s, box-shadow 0.4s",
          }} />
          {/* Transparent range input — captures all drag events */}
          <input
            type="range" min={0} max={24} step={0.25} value={sunHour}
            onChange={e => setSunHour(Number(e.target.value))}
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              opacity: 0, cursor: "ew-resize", margin: 0, padding: 0,
            }}
            aria-label="Time of day"
          />
        </div>

        {/* Label */}
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          SHADOW
        </span>
      </div>

      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        gl={{
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: theme.exposure,
          // Required for canvas.toDataURL() (AI render screenshot)
          preserveDrawingBuffer: true,
          antialias: false, // SMAA effect handles AA below
        }}
        camera={{ fov: 58, near: 0.1, far: 300 }}
        dpr={[1, 2]}
      >
        <fog attach="fog" args={[theme.fogColor, theme.fogNear, theme.fogFar]} />
        <ExteriorCaptureSetup />
        <CameraRig W={W} D={D} floors={floors} />
        <OrbitControls
          ref={orbitRef}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0}
          maxPolarAngle={Math.PI / 2.1}
          minDistance={2}
          maxDistance={50}
          panSpeed={0.6}
          target={[0, floors * FLOOR_H * 0.35, 0]}
        />
        {/* HDR as both IBL lighting AND photorealistic sky background.
            backgroundBlurriness softens the HDR to remove distracting detail
            while keeping the sky colour/gradient. Night mode keeps a dark
            sphere instead since the night HDR is just a coloured gradient. */}
        {/* Sky sphere — colour interpolates continuously with sun position */}
        {theme.phase !== "night" && (
          <>
            <color attach="background" args={[skyHex]} />
            <mesh scale={[260, 260, 260]}>
              <sphereGeometry args={[1, 32, 20]} />
              <meshBasicMaterial color={skyHex} side={THREE.BackSide} depthWrite={false} fog={false} />
            </mesh>
          </>
        )}
        <HouseEnvironmentFallback>
          <Suspense fallback={null}>
            <Environment
              files={theme.hdr}
              background={false}
              backgroundBlurriness={0.06}
              backgroundIntensity={theme.phase === "day" ? 0.50 : 0.75}
            />
          </Suspense>
        </HouseEnvironmentFallback>
        {/* Night sky sphere */}
        {theme.phase === "night" && (
          <mesh scale={[280, 280, 280]}>
            <sphereGeometry args={[1, 32, 24]} />
            <meshBasicMaterial color="#0A0F1E" side={THREE.BackSide} depthWrite={false} />
          </mesh>
        )}
        {/* Hemisphere light — sky/ground bounce */}
        <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity]} />
        <ambientLight intensity={theme.ambient} />
        {/* Primary sun — position updates every render frame as slider moves */}
        <directionalLight
          position={sunPos} intensity={theme.sunIntensity} color={theme.sunColor} castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={100}
          shadow-camera-left={-30} shadow-camera-right={30}
          shadow-camera-top={30} shadow-camera-bottom={-30}
          shadow-bias={-0.0008}
          shadow-normalBias={0.04}
        />
        {/* Sky fill from opposite side (fill tracks opposite of sun) */}
        <directionalLight
          position={[-sunPos[0] * 0.4, 20, -sunPos[2] * 0.4]}
          intensity={theme.fillIntensity}
          color={theme.fillColor}
        />

        {/* Click empty ground to deselect */}
        <DeselectPlane onDeselect={() => {
          setSelectedOutdoorKey(null);
          useDesignerStore.getState().setSelectedExteriorDecor(null);
        }} />
        <Ground W={W} D={D} />
        <EntryPath W={W} D={D} />
        <HouseBody W={W} D={D} settings={exterior} />
        <WallDecorLayer W={W} D={D} orbitRef={orbitRef} />
        {/* User-drawn yardPlan items (院子图 editor). Structural prefabs compose
            on top of the ambient landscape above. */}
        <YardPlanItems3D />
        {/* Modern villa yard: lawn + terrace + pool + loungers */}
        {exterior.roofStyle === "flat" && <VillaYard W={W} D={D} />}

        {/* ── Postprocessing — photorealistic architectural visualization ──
           SSAO: deep contact shadows ground objects convincingly.
           Bloom: subtle sun/sky glow for day/sunset; stronger for night lamps.
           BrightnessContrast: slight contrast lift for that "rendered" punch.
           SMAA: temporal anti-aliasing for clean edges. */}
        <EffectComposer multisampling={0} enableNormalPass>
          <SSAO
            blendFunction={BlendFunction.MULTIPLY}
            samples={28}
            radius={6}
            intensity={theme.phase === "night" ? 48 : 35}
            luminanceInfluence={0.6}
            worldDistanceThreshold={1.5}
            worldDistanceFalloff={3.0}
            worldProximityThreshold={0.5}
            worldProximityFalloff={1.0}
          />
          {/* Bloom — subtle sun glow for day, stronger for night lamps */}
          <Bloom
            intensity={theme.phase === "night" ? 0.55 : theme.phase === "dusk" ? 0.32 : 0.14}
            luminanceThreshold={theme.phase === "night" ? 0.92 : 0.88}
            luminanceSmoothing={0.30}
            mipmapBlur
          />
          <BrightnessContrast brightness={0.02} contrast={0.10} />
          <SMAA />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
