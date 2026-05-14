"use client";

import { useRef, useMemo, useEffect, useState, Fragment, Suspense, Component, type ReactElement, type ReactNode } from "react";
import { Canvas, useThree, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls, Environment, Html, MeshReflectorMaterial, useGLTF, Clone, Sky, Stars } from "@react-three/drei";
import { EffectComposer, SSAO, Bloom, Vignette, BrightnessContrast, SMAA, HueSaturation } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { useDesignerStore } from "@/lib/store";
import { getLayerOffset, overlayMaterialProps } from "@/lib/zLayer";

// ─── three-mesh-bvh: 全局加速射线检测 ────────────────────────────────────────
// 替换 THREE.Mesh.raycast 为 BVH 版本，复杂场景下点击响应快 5-10×
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
import { hasWebGPUSupport } from "@/lib/webgpuRenderer";
import { HouseStairs } from "./StairGeometry";
import { SSGIPostProcessing } from "./SSGIPostProcessing";
import { getSunPosition3D, formatHour as sunFormatHour } from "@/lib/sunAnalysis";
import { ROOM_DEFS, ExteriorSettings, ExteriorWall, isYardPrefab, isYardZone } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { getOutdoorAssetByKind } from "@/lib/outdoorAssets";
import { DetailedDecor } from "./DetailedDecor";
import { PrefabMesh } from "./PrefabRenderer";
import { ZoneMesh } from "./ZoneRenderer";
import FloorPlanBuilding from "./FloorPlanExterior";

// ─── Constants ─────────────────────────────────────────────
const FLOOR_H = 2.8;
const WT      = 0.24;
const OV      = 0.55;   // overhang for pitched roofs
const FLAT_OV = 1.6;    // deep cantilever overhang for modern flat roof

// ─── InstancedBoxes — 用一个 InstancedMesh 代替 N 个 mesh，大幅减少 draw call ─
/**
 * 渲染多个相同尺寸、相同材质的 Box，positions 中每项为 [x,y,z]。
 * 可选传入每个实例的旋转四元数 (rotations)。
 * 典型用途：柱子阵列、屋顶板条、楼板带等重复几何。
 */
function InstancedBoxes({
  boxArgs, positions, color, roughness = 0.7, metalness = 0,
  emissive, emissiveIntensity = 0,
  envMapIntensity = 0.3,
  castShadow = false, receiveShadow = false,
}: {
  boxArgs: [number, number, number];
  positions: Array<[number, number, number]>;
  color: string;
  roughness?: number; metalness?: number;
  emissive?: string; emissiveIntensity?: number;
  envMapIntensity?: number;
  castShadow?: boolean; receiveShadow?: boolean;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = positions.length;
  const geo = useMemo(() => new THREE.BoxGeometry(...boxArgs), [boxArgs[0], boxArgs[1], boxArgs[2]]); // eslint-disable-line react-hooks/exhaustive-deps
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color, roughness, metalness,
    emissive: emissive ?? color, emissiveIntensity,
    envMapIntensity,
  }), [color, roughness, metalness, emissive, emissiveIntensity, envMapIntensity]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions, count]); // eslint-disable-line react-hooks/exhaustive-deps

  if (count === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[geo, mat, count]}
      castShadow={castShadow} receiveShadow={receiveShadow} />
  );
}

// ─── MergedSlats — BufferGeometryUtils.mergeGeometries 合并板条为单 mesh ─────
/**
 * 把 N 根相同截面的板条合并成一个 BufferGeometry，用一个 draw call 渲染。
 * 适合屋顶木格栅、遮阳百叶等密集重复条状几何。
 */
function MergedSlats({
  slatW, slatH, slatD, count, axis, spacing, offset = [0, 0, 0],
  color, roughness = 0.5, metalness = 0,
  castShadow = false, receiveShadow = false,
}: {
  slatW: number; slatH: number; slatD: number;
  count: number; axis: "x" | "z"; spacing: number;
  offset?: [number, number, number];
  color: string; roughness?: number; metalness?: number;
  castShadow?: boolean; receiveShadow?: boolean;
}) {
  const geo = useMemo(() => {
    if (count <= 0) return new THREE.BufferGeometry();
    const template = new THREE.BoxGeometry(slatW, slatH, slatD);
    const geos: THREE.BufferGeometry[] = [];
    const span = (count - 1) * spacing;
    for (let i = 0; i < count; i++) {
      const t = i * spacing - span / 2;
      const m = new THREE.Matrix4().makeTranslation(
        axis === "x" ? t + offset[0] : offset[0],
        offset[1],
        axis === "z" ? t + offset[2] : offset[2],
      );
      const g = template.clone();
      g.applyMatrix4(m);
      geos.push(g);
    }
    template.dispose();
    return mergeGeometries(geos, false);
  }, [slatW, slatH, slatD, count, axis, spacing, offset[0], offset[1], offset[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <mesh geometry={geo} castShadow={castShadow} receiveShadow={receiveShadow}>
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

// ─── Glass interior canvas texture ──────────────────────────────────────────
// Industry-standard approach for architectural visualization: bake the
// "warm interior visible through glass" look into a canvas texture.
// Created once as a module singleton — reused across all glass panels.
// Version token — bump this to force texture regeneration after canvas changes
const GLASS_TEX_VERSION = 8;
let _glassTex: THREE.CanvasTexture | null = null;
let _glassTexVersion = 0;

function getGlassInteriorTex(): THREE.CanvasTexture {
  if (_glassTex && _glassTexVersion === GLASS_TEX_VERSION) return _glassTex;
  if (_glassTex) { _glassTex.dispose(); _glassTex = null; }

  const W = 512, H = 1024;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;

  // ① Reference photo interior: nearly WHITE cream ceiling, light warm walls, mid-tone floor.
  //    Key insight: the reference is a DAYLIT room — wall color is OFF-WHITE / light taupe,
  //    not saturated amber. Furniture silhouettes are dark against the bright walls.
  //    Emissive will be LOW (0.85) so this looks like natural light, not a lamp.
  const room = g.createLinearGradient(0, 0, 0, H);
  room.addColorStop(0.00, "#FDFAF5"); // near-white ceiling (recessed wash)
  room.addColorStop(0.10, "#F7F0E4"); // warm white upper zone
  room.addColorStop(0.28, "#EDE2CE"); // cream wall — lit upper zone
  room.addColorStop(0.50, "#E2D4BA"); // warm beige / taupe — main wall
  room.addColorStop(0.65, "#C8B898"); // warm sand — lower lit zone
  room.addColorStop(0.78, "#907055"); // furniture / lower shadow zone
  room.addColorStop(1.00, "#503018"); // dark walnut floor
  g.fillStyle = room;
  g.fillRect(0, 0, W, H);

  // ② Recessed ceiling LED downlights — soft warm wash, not a single hot spot
  const glow1 = g.createRadialGradient(W / 2, H * 0.05, 5, W / 2, H * 0.05, W * 0.90);
  glow1.addColorStop(0,    "rgba(255,240,215,0.92)");
  glow1.addColorStop(0.22, "rgba(255,225,190,0.65)");
  glow1.addColorStop(0.55, "rgba(248,215,175,0.30)");
  glow1.addColorStop(1,    "rgba(240,210,170,0.00)");
  g.fillStyle = glow1;
  g.fillRect(0, 0, W, H * 0.72);

  // ③ Second ceiling fixture — subtle fill, warm neutral
  const glow2 = g.createRadialGradient(W * 0.62, H * 0.10, 3, W * 0.62, H * 0.10, W * 0.40);
  glow2.addColorStop(0,    "rgba(255,242,220,0.75)");
  glow2.addColorStop(0.40, "rgba(250,228,200,0.35)");
  glow2.addColorStop(1,    "rgba(245,220,190,0.00)");
  g.fillStyle = glow2;
  g.fillRect(0, 0, W, H * 0.55);

  // ④ Sheer ivory curtain drapes — soft vertical waves
  for (let cx = 18; cx < W - 12; cx += 28) {
    const primary = cx % 56 < 28;
    g.strokeStyle = `rgba(255,250,240,${primary ? 0.55 : 0.30})`;
    g.lineWidth = primary ? 8 : 4.5;
    g.beginPath();
    g.moveTo(cx, H * 0.12);
    for (let y = H * 0.12; y < H * 0.88; y += 8) {
      g.lineTo(cx + Math.sin(y * 0.10 + cx * 0.05) * 5, y);
    }
    g.stroke();
  }

  // ⑤ Furniture dark zone — sofa / table silhouette near floor
  const furn = g.createLinearGradient(0, H * 0.62, 0, H);
  furn.addColorStop(0,    "rgba(60,40,20,0.00)");
  furn.addColorStop(0.12, "rgba(60,40,20,0.42)");
  furn.addColorStop(0.48, "rgba(48,30,14,0.68)");
  furn.addColorStop(1,    "rgba(36,22,10,0.85)");
  g.fillStyle = furn;
  g.fillRect(0, H * 0.62, W, H * 0.38);

  // ⑥ Warm table-top / coffee table highlight (horizontal amber strip)
  const tbl = g.createLinearGradient(0, H * 0.68, 0, H * 0.75);
  tbl.addColorStop(0,   "rgba(220,180,100,0.00)");
  tbl.addColorStop(0.3, "rgba(220,180,100,0.55)");
  tbl.addColorStop(0.7, "rgba(220,180,100,0.55)");
  tbl.addColorStop(1,   "rgba(220,180,100,0.00)");
  g.fillStyle = tbl;
  g.fillRect(W * 0.08, H * 0.68, W * 0.84, H * 0.075);

  // ⑦ Additional warm highlight at ceiling edge — LED cove lighting effect
  const coveLight = g.createLinearGradient(0, 0, 0, H * 0.08);
  coveLight.addColorStop(0, "rgba(255,240,200,0.80)");
  coveLight.addColorStop(1, "rgba(255,235,195,0.00)");
  g.fillStyle = coveLight;
  g.fillRect(0, 0, W, H * 0.08);

  // ⑧ Soft diagonal warm highlight — natural daylight entering from left
  const spec = g.createLinearGradient(0, H * 0.05, W * 0.45, H * 0.55);
  spec.addColorStop(0,    "rgba(255,248,235,0.00)");
  spec.addColorStop(0.28, "rgba(255,248,235,0.22)");
  spec.addColorStop(0.52, "rgba(255,242,225,0.32)");
  spec.addColorStop(0.72, "rgba(255,238,215,0.12)");
  spec.addColorStop(1,    "rgba(255,235,210,0.00)");
  g.fillStyle = spec;
  g.fillRect(0, 0, W, H);

  _glassTex = new THREE.CanvasTexture(cv);
  _glassTex.needsUpdate = true;
  _glassTexVersion = GLASS_TEX_VERSION;
  return _glassTex;
}

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

/** Footprint always computed from floor 0 (ground floor) so the exterior
 *  camera doesn't reset when the user switches floors. */
function useGroundFloorFootprint() {
  const enabledRooms   = useDesignerStore(s => s.floorPlans[0]?.enabledRooms ?? s.floorPlans[s.activeFloor].enabledRooms);
  const roomLayout     = useDesignerStore(s => s.floorPlans[0]?.roomLayout    ?? s.floorPlans[s.activeFloor].roomLayout);
  const roomDimensions = useDesignerStore(s => s.floorPlans[0]?.roomDimensions ?? s.floorPlans[s.activeFloor].roomDimensions);
  const indoor = enabledRooms.filter(r => !ROOM_DEFS[r].isOutdoor);
  if (!indoor.length) return { W: 8, D: 6 };
  const xs = indoor.flatMap(r => [roomLayout[r].x, roomLayout[r].x + roomDimensions[r].width]);
  const zs = indoor.flatMap(r => [roomLayout[r].y, roomLayout[r].y + roomDimensions[r].depth]);
  return {
    W: Math.max(4, (Math.max(...xs) - Math.min(...xs)) / 100),
    D: Math.max(3, (Math.max(...zs) - Math.min(...zs)) / 100),
  };
}

/** Returns an array of { x, z, W, D } box specs for the building footprint. */
function useFootprintVolumes(W: number, D: number, settings: ExteriorSettings) {
  const shape = settings.footprintShape ?? "rect";
  const wr    = settings.wingRatio ?? 0.5;

  if (shape === "rect") return [{ x: 0, z: 0, W, D }];

  if (shape === "L") {
    const w1 = W, d1 = D * (1 - wr);
    const w2 = W * wr, d2 = D;
    return [
      { x: 0,           z: -(D - d1) / 2, W: w1, D: d1 },
      { x: -(W - w2)/2, z: (D - d2) / 2,  W: w2, D: d2 - d1 },
    ];
  }

  if (shape === "U") {
    const wingD = D * wr;
    const mainD = D * (1 - wr);
    const wingW = W * 0.35;
    return [
      { x: 0,              z: (D - mainD)/2,  W, D: mainD },
      { x: -(W - wingW)/2, z: -(D - wingD)/2, W: wingW, D: wingD },
      { x:  (W - wingW)/2, z: -(D - wingD)/2, W: wingW, D: wingD },
    ];
  }

  if (shape === "T") {
    const stemW = W * wr;
    const stemD = D * 0.55;
    return [
      { x: 0, z:  (D - stemD) / 2, W, D: D - stemD },
      { x: 0, z: -(D - stemD) / 2, W: stemW, D: stemD },
    ];
  }

  return [{ x: 0, z: 0, W, D }];
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
function CameraRig({ W, D, floors, buildingType }: {
  W: number; D: number; floors: number; buildingType?: string;
}) {
  const { camera } = useThree();
  // Use a ref to track whether we've done the one-time initialisation.
  // We rely on useFrame (not useEffect) so the code runs AFTER OrbitControls
  // has registered itself as `controls` in the R3F store via makeDefault.
  // Without this, OrbitControls would initialise from the default camera pos
  // [0,0,5] and override whatever useEffect set on the next render cycle.
  const initialized = useRef(false);

  useFrame(({ controls }) => {
    if (initialized.current) return;

    const h    = floors * FLOOR_H;
    const isRichVilla      = buildingType === "rich-glass-villa";
    const isFloorPlanDriven = buildingType === "floor-plan-driven";

    if (isFloorPlanDriven) {
      // Floor-plan-driven exterior: south glass facade faces -Z.
      // Camera: south-west corner, lower angle so pool+terrace visible in foreground.
      const diag  = Math.sqrt(W * W + D * D);
      const dist  = diag * 1.15 + 5;
      // Keep camera low enough that the pool deck (y≈0) is in the lower third of the frame.
      const camY  = h * 0.65 + 1.8;   // ~ 1–2 floors elevation, not above the roof
      const camZ  = -(dist * 0.78);
      const camX  = -(dist * 0.48);

      camera.position.set(camX, camY, camZ);
      (camera as THREE.PerspectiveCamera).fov = 52;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();

      if (controls) {
        const ctrl = controls as any;
        // Look at mid-height of building — this pulls the horizon line into the
        // upper half of the frame, leaving room for pool/terrace in lower half.
        ctrl.target.set(0, h * 0.30, 0);
        ctrl.update();
      } else {
        return;
      }
    } else if (isRichVilla) {
      // Luxury villa architectural perspective.
      // CRITICAL: The front glass curtain wall FACES SOUTH (−Z direction).
      // Camera must be on the SOUTH side (negative Z) to see the glass facade.
      const BAY_CAM  = 1.50;
      const MAIN_W_C = W + BAY_CAM * 4;
      const EXT_W_C  = BAY_CAM * 3;
      const visWidth = MAIN_W_C + EXT_W_C;
      const fDist    = visWidth * 1.28 + 8;

      const camX = -fDist * 0.14;
      const camY = 1.6;
      const camZ = -fDist;
      const tgtX = EXT_W_C * 0.25;
      const tgtY = 4.5;
      const tgtZ = -3;

      camera.position.set(camX, camY, camZ);
      (camera as THREE.PerspectiveCamera).fov = 55;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();

      // CRITICAL: push the same target into OrbitControls so it doesn't
      // fight with our camera position on subsequent frames.
      if (controls) {
        const ctrl = controls as any;
        ctrl.target.set(tgtX, tgtY, tgtZ);
        ctrl.update();   // recalculates internal spherical coords from new pos+target
      } else {
        // OrbitControls not yet registered — retry next frame
        return;
      }
    } else {
      const diag = Math.sqrt(W * W + D * D);
      const dist = diag * 1.65 + 5;
      camera.position.set(-dist * 0.32, Math.max(h * 0.85, 5.5), dist * 1.15);
      (camera as THREE.PerspectiveCamera).fov = 45;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();

      if (controls) {
        const ctrl = controls as any;
        ctrl.target.set(0, h * 0.35, 0);
        ctrl.update();
      } else {
        return;
      }
    }

    initialized.current = true;
  });

  // Re-initialise if building params change
  useEffect(() => {
    initialized.current = false;
  }, [W, D, floors, buildingType]);

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
      {/* Wood soffit — 合并为单 mesh（MergedSlats），原来每根都是独立 draw call */}
      {(() => {
        const SLAT_W   = 0.090;
        const SLAT_GAP = 0.022;
        const SLAT_T   = 0.048;
        const step     = SLAT_W + SLAT_GAP;
        const numSlats = Math.floor((slabD - 0.04) / step);
        return (
          <MergedSlats
            slatW={slabW - 0.06} slatH={SLAT_T} slatD={SLAT_W}
            count={numSlats} axis="z" spacing={step}
            offset={[0, -0.21, 0]}
            color="#8B5A2B" roughness={0.38} metalness={0}
            castShadow receiveShadow
          />
        );
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
/** Single-zone wall slab. Handles glass specially via meshPhysicalMaterial. */
function WallSlab({ width, height, color, wallMaterial, yOffset = 0 }: {
  width: number; height: number; color: string;
  wallMaterial: import("@/lib/types").WallMaterialType;
  yOffset?: number;
}) {
  const WALL_REPEAT: [number, number] = [2.0, 1.5];
  const { map, normalMap, roughnessMap } = usePbrSet("wall", "concrete_wall_007", WALL_REPEAT);
  const useTexture = wallMaterial === "concrete";
  const normalStr  = wallMaterial === "concrete" ? 1.0 : 0.35;
  const roughness  = wallMaterial === "concrete" ? 0.72 : wallMaterial === "render" ? 0.76 : wallMaterial === "wood" ? 0.82 : wallMaterial === "brick" ? 0.88 : 0.84;
  const envMap     = wallMaterial === "render" ? 0.55 : wallMaterial === "concrete" ? 0.45 : 0.18;

  if (wallMaterial === "glass") {
    return (
      <mesh position={[0, yOffset, 0]} receiveShadow castShadow>
        <boxGeometry args={[width, height, WT * 0.5]} />
        <meshPhysicalMaterial
          color="#CBE8F5"
          transmission={0.82}
          ior={1.52}
          roughness={0.04}
          metalness={0.05}
          thickness={0.12}
          envMapIntensity={4.0}
          emissive="#FFF4CC"
          emissiveIntensity={0.08}
          side={THREE.DoubleSide}
        />
      </mesh>
    );
  }

  return (
    <mesh position={[0, yOffset, 0]} receiveShadow castShadow>
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

/**
 * Renders a wall body — either a single material or multiple stacked zones.
 * When `zones` has 2+ entries the wall is split bottom→top, e.g.
 * brick (40%) + glass (60%).
 */
function WallBodyTextured({ width, height, color, wallMaterial, zones }: {
  width: number; height: number; color: string;
  wallMaterial: import("@/lib/types").WallMaterialType;
  zones?: import("@/lib/types").WallZone[];
}) {
  if (zones && zones.length >= 2) {
    // Split-zone rendering: stack from bottom (-height/2) to top
    let cumFrac = 0;
    return (
      <group>
        {zones.map((zone, i) => {
          const zH = height * zone.heightFraction;
          const yOff = -height / 2 + cumFrac * height + zH / 2;
          cumFrac += zone.heightFraction;
          return (
            <WallSlab
              key={i}
              width={width}
              height={zH}
              color={zone.color}
              wallMaterial={zone.material}
              yOffset={yOff}
            />
          );
        })}
      </group>
    );
  }
  // Single zone fallback
  return <WallSlab width={width} height={height} color={color} wallMaterial={wallMaterial} />;
}

// ─── Component-based segmented facade ──────────────────────
/**
 * Renders a wall face as independent typed strips (glass curtain, solid, window, door, column).
 * This is the new component-by-component facade builder.
 */
function SegmentedWallFace({ width, height, facade, accentColor, flip = false }: {
  width: number; height: number;
  facade: import("@/lib/types").FloorFacade;
  accentColor: string;
  /** When true, glass/protrusions go toward local -Z (back wall rotated 180°) */
  flip?: boolean;
}) {
  const { segments } = facade;
  const totalFrac = segments.reduce((s, seg) => s + seg.widthFraction, 0) || 1;
  let cumFrac = 0;
  // For flipped walls (back wall), glass protrudes toward -Z so it faces outward
  const zDir = flip ? -1 : 1;

  return (
    <group>
      {segments.map((seg) => {
        const segW = (seg.widthFraction / totalFrac) * width;
        const x = -width / 2 + (cumFrac / totalFrac) * width + segW / 2;
        cumFrac += seg.widthFraction;
        const frameColor = seg.frameColor ?? "#1A1A1A";
        const segColor = seg.color ?? accentColor;
        const mat = seg.material ?? "render";

        if (seg.type === "glass") {
          // ── CANVAS-TEXTURE GLASS PANELS ─────────────────────────────────
          // Industry-standard approach: baked interior look on opaque plane.
          // No transparency sorting issues. Warm interior always visible.
          const tex = getGlassInteriorTex();
          const panels = seg.panelCount ?? Math.max(2, Math.round(segW / 1.2));
          const mullionW = 0.095;   // dark aluminum vertical mullion width
          const hRailH   = 0.045;   // horizontal rail between panels (if needed)
          const glassH   = height * 0.975;
          const totalGlassW = segW * 0.99;
          const panelW = (totalGlassW - (panels - 1) * mullionW) / panels;
          const startPX = -(totalGlassW / 2) + panelW / 2;
          const extZ = zDir * (WT / 2 + 0.006);  // glass sits just proud of wall
          return (
            <group key={seg.id} position={[x, 0, 0]}>
              {/* Structural wall body behind glass */}
              <mesh receiveShadow castShadow>
                <boxGeometry args={[segW, height, WT]} />
                <meshStandardMaterial color="#1C2028" roughness={0.85} />
              </mesh>
              {Array.from({ length: panels }).map((_, pi) => {
                const px = startPX + pi * (panelW + mullionW);
                return (
                  <group key={pi} position={[px, 0, extZ]}>
                    {/* ① Dark aluminum frame — slightly wider/taller than glass */}
                    <mesh castShadow>
                      <boxGeometry args={[panelW + mullionW, glassH + 0.06, 0.055]} />
                      <meshStandardMaterial
                        color={frameColor}
                        roughness={0.16} metalness={0.90} envMapIntensity={2.5}
                      />
                    </mesh>
                    {/* ② Canvas-textured glass panel — warm interior baked in + subtle emissive glow */}
                    <mesh position={[0, 0, zDir * 0.034]} castShadow>
                      <boxGeometry args={[panelW - 0.008, glassH - 0.008, 0.004]} />
                      <meshStandardMaterial
                        map={tex}
                        roughness={0.06}
                        metalness={0.05}
                        envMapIntensity={0.6}
                        emissive="#D8A84A"
                        emissiveIntensity={0.38}
                        side={THREE.DoubleSide}
                      />
                    </mesh>
                    {/* ③ Glass surface sheen — thin reflective overlay on top of texture */}
                    <mesh position={[0, 0, zDir * 0.044]}>
                      <boxGeometry args={[panelW - 0.008, glassH - 0.008, 0.002]} />
                      <meshStandardMaterial
                        color="#D8EEF8"
                        roughness={0.02}
                        metalness={0.45}
                        envMapIntensity={3.0}
                        transparent opacity={0.18}
                        depthWrite={false}
                        side={THREE.DoubleSide}
                      />
                    </mesh>
                    {/* ④ Horizontal mid-rail (sliding door handle zone) */}
                    <mesh position={[0, -glassH * 0.22, zDir * 0.038]}>
                      <boxGeometry args={[panelW + mullionW, hRailH, 0.028]} />
                      <meshStandardMaterial
                        color={frameColor} roughness={0.18} metalness={0.85}
                      />
                    </mesh>
                  </group>
                );
              })}
            </group>
          );
        }

        if (seg.type === "column") {
          return (
            <group key={seg.id} position={[x, 0, 0]}>
              <WallSlab width={segW} height={height} color={segColor} wallMaterial={mat} />
            </group>
          );
        }

        if (seg.type === "window") {
          const winH = Math.min(height * 0.58, 1.6);
          const winW = segW * 0.72;
          const winY = height * 0.08;
          return (
            <group key={seg.id} position={[x, 0, 0]}>
              <WallSlab width={segW} height={height} color={segColor} wallMaterial={mat} />
              <group position={[0, winY, zDir * (WT / 2 + 0.01)]}>
                <mesh>
                  <boxGeometry args={[winW + 0.10, winH + 0.10, 0.065]} />
                  <meshStandardMaterial color={frameColor} roughness={0.25} metalness={0.68} envMapIntensity={1.4} />
                </mesh>
                <mesh position={[0, 0, 0.042]}>
                  <boxGeometry args={[winW, winH, 0.042]} />
                  <meshPhysicalMaterial color="#C8E8F8" transmission={0.90} ior={1.52} roughness={0.02} metalness={0.0} thickness={0.08} envMapIntensity={3.8} emissive="#FFF4CC" emissiveIntensity={0.06} side={THREE.DoubleSide} />
                </mesh>
                {/* Horizontal divider rail */}
                <mesh position={[0, 0, 0.052]}>
                  <boxGeometry args={[winW + 0.02, 0.038, 0.025]} />
                  <meshStandardMaterial color={frameColor} roughness={0.25} metalness={0.68} />
                </mesh>
              </group>
            </group>
          );
        }

        if (seg.type === "door") {
          const doorH = Math.min(2.35, height * 0.86);
          const doorW = Math.min(segW * 0.68, 1.50);
          return (
            <group key={seg.id} position={[x, 0, 0]}>
              <WallSlab width={segW} height={height} color={segColor} wallMaterial={mat} />
              {/* Door surround */}
              <group position={[0, doorH / 2 - height / 2, zDir * (WT / 2 + 0.01)]}>
                {/* Frame */}
                <mesh castShadow>
                  <boxGeometry args={[doorW + 0.16, doorH + 0.10, 0.065]} />
                  <meshStandardMaterial color={frameColor} roughness={0.22} metalness={0.72} envMapIntensity={1.6} />
                </mesh>
                {/* Glass sidelight panels — makes entrance feel transparent/inviting */}
                <mesh position={[0, 0, 0.038]}>
                  <boxGeometry args={[doorW, doorH, 0.030]} />
                  <meshPhysicalMaterial
                    color="#C8E8F8" transmission={0.78} ior={1.50}
                    roughness={0.010} metalness={0.0} thickness={0.06}
                    envMapIntensity={4.0} emissive="#2848A8" emissiveIntensity={0.12}
                    side={THREE.DoubleSide}
                  />
                </mesh>
                {/* Horizontal door rail */}
                <mesh position={[0, -doorH * 0.28, 0.055]}>
                  <boxGeometry args={[doorW + 0.04, 0.04, 0.025]} />
                  <meshStandardMaterial color={frameColor} roughness={0.22} metalness={0.72} />
                </mesh>
                {/* Centre vertical mullion */}
                <mesh position={[0, 0, 0.058]}>
                  <boxGeometry args={[0.04, doorH, 0.025]} />
                  <meshStandardMaterial color={frameColor} roughness={0.22} metalness={0.72} />
                </mesh>
                {/* Pull handles */}
                {[-1, 1].map((side, hi) => (
                  <mesh key={hi} position={[side * doorW * 0.20, -doorH * 0.10, 0.075]}>
                    <boxGeometry args={[0.028, 0.18, 0.028]} />
                    <meshStandardMaterial color="#D0C8A8" roughness={0.16} metalness={0.88} />
                  </mesh>
                ))}
              </group>
              {/* Slim entrance canopy above door */}
              <mesh position={[0, height / 2 - 0.08, WT / 2 + 0.55]} castShadow>
                <boxGeometry args={[segW + 0.20, 0.06, 1.10]} />
                <meshStandardMaterial color={frameColor} roughness={0.18} metalness={0.80} />
              </mesh>
            </group>
          );
        }

        // "solid" — default
        return (
          <group key={seg.id} position={[x, 0, 0]}>
            <WallSlab width={segW} height={height} color={segColor} wallMaterial={mat} />
          </group>
        );
      })}
    </group>
  );
}

function WallFace({ width, height, color, accentColor, wallMaterial = "render", hasDoor = false, winCount, glassFacade = false, glassFlip = false, zones, facade }: {
  width: number; height: number; color: string; accentColor: string;
  wallMaterial?: import("@/lib/types").WallMaterialType;
  hasDoor?: boolean; winCount: number;
  glassFacade?: boolean;
  /** flip=true: glass protrudes toward local -Z (for walls rotated 180°, so glass faces outward) */
  glassFlip?: boolean;
  /** Optional split-zone override for this specific wall face. */
  zones?: import("@/lib/types").WallZone[];
  /** Component-based facade — overrides everything else when set. */
  facade?: import("@/lib/types").FloorFacade;
}) {
  // Component facade takes priority over all other rendering modes
  if (facade && facade.segments.length > 0) {
    return <SegmentedWallFace width={width} height={height} facade={facade} accentColor={accentColor} flip={glassFlip} />;
  }
  // If zones are present and the top zone is glass, treat as glass facade automatically
  const hasGlassZone = zones && zones.some(z => z.material === "glass");
  if (!glassFacade && hasGlassZone) {
    glassFacade = zones![zones!.length - 1].material === "glass";
  }
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
        <WallBodyTextured width={width} height={height} color={color} wallMaterial={wallMaterial ?? "render"} zones={zones} />
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
  const { wallColor, accentColor, wallMaterial, roofStyle, preset } = settings;
  const fm  = settings.faceMaterials ?? {};
  const fmt = settings.faceMaterialTypes ?? {};
  const fz  = settings.faceZones ?? {};
  const globalZones = settings.wallZones;
  const frontColor    = fm.front  ?? wallColor;
  const backColor     = fm.back   ?? wallColor;
  const leftColor     = fm.left   ?? wallColor;
  const rightColor    = fm.right  ?? wallColor;
  const frontMat      = fmt.front ?? wallMaterial;
  const backMat       = fmt.back  ?? wallMaterial;
  const leftMat       = fmt.left  ?? wallMaterial;
  const rightMat      = fmt.right ?? wallMaterial;
  // Per-face zones fall back to global zones
  const frontZones = fz.front ?? globalZones;
  const backZones  = fz.back  ?? globalZones;
  const leftZones  = fz.left  ?? globalZones;
  const rightZones = fz.right ?? globalZones;
  // Component-based facade per face per floor
  const ff = settings.facades;
  const frontFacade = ff?.front?.[floorIndex];
  const backFacade  = ff?.back?.[floorIndex];
  const leftFacade  = ff?.left?.[floorIndex];
  const rightFacade = ff?.right?.[floorIndex];
  const H = FLOOR_H;
  const isGround  = floorIndex === 0;
  const isFlatRoof = roofStyle === "flat";
  // Full glass curtain wall: ONLY "modern" or "minimalist" + flat roof.
  // Contemporary / industrial / mediterranean flat-roof → solid walls with big windows,
  // so the detected wallColor and accentColor (wood tones etc.) actually show.
  const isModern = isFlatRoof && (preset === "modern" || preset === "minimalist");
  // All flat-roof styles get the larger window grid (contemporary still has big openings)
  const winCountFront = isFlatRoof
    ? Math.max(2, Math.floor(W / 1.8))
    : Math.max(1, Math.floor(W / 2.6) - (isGround ? 1 : 0));
  const winCountSide  = isFlatRoof
    ? Math.max(1, Math.floor(D / 1.8))
    : Math.max(1, Math.floor(D / 2.6));

  // Slab band color — light concrete for all flat-roof styles
  const slabColor = isFlatRoof ? "#F2EDE8" : "#C8C0B0";

  return (
    <group position={[0, floorIndex * H, 0]}>
      {/* Floor slab */}
      <mesh receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[W, 0.18, D]} />
        <meshStandardMaterial color="#D0CABB" roughness={0.95} />
      </mesh>
      {/* Front wall */}
      <group position={[0, H / 2, -(D / 2 - WT / 2)]}>
        <WallFace width={W} height={H} color={frontColor} accentColor={accentColor} wallMaterial={frontMat}
          hasDoor={isGround} winCount={winCountFront} glassFacade={isModern} zones={frontZones}
          facade={frontFacade} />
      </group>
      {/* Back wall */}
      <group position={[0, H / 2, D / 2 - WT / 2]} rotation={[0, Math.PI, 0]}>
        <WallFace width={W} height={H} color={backColor} accentColor={accentColor} wallMaterial={backMat}
          winCount={winCountFront} glassFacade={isModern} glassFlip={isModern} zones={backZones}
          facade={backFacade} />
      </group>
      {/* Left side wall */}
      <group position={[-(W / 2 - WT / 2), H / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <WallFace width={D} height={H} color={leftColor} accentColor={accentColor} wallMaterial={leftMat}
          winCount={winCountSide} glassFacade={isModern} zones={leftZones}
          facade={leftFacade} />
      </group>
      {/* Right side wall */}
      <group position={[W / 2 - WT / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <WallFace width={D} height={H} color={rightColor} accentColor={accentColor} wallMaterial={rightMat}
          winCount={winCountSide} glassFacade={isModern} zones={rightZones}
          facade={rightFacade} />
      </group>
      {/* Exposed slab band between floors */}
      {(() => {
        // Use prominent slab style when facade is active OR preset is modern
        const hasFacade = !!(ff?.front?.length || ff?.back?.length || ff?.left?.length || ff?.right?.length);
        const slabStyle = isModern || hasFacade;
        const slabW = W + (slabStyle ? 0.18 : 0);
        const slabD = D + (slabStyle ? 0.18 : 0);
        const slabH = slabStyle ? 0.44 : 0.18;   // thicker slab band: prominent horizontal layering like ref
        const slabC = slabStyle ? "#F0EDE6" : slabColor;  // bright white-cream
        const slabR = slabStyle ? 0.65 : 0.95;
        return (
          <>
            {floorIndex < totalFloors - 1 && (
              <mesh position={[0, H, 0]} castShadow receiveShadow>
                <boxGeometry args={[slabW, slabH, slabD]} />
                <meshStandardMaterial color={slabC} roughness={slabR} metalness={0.02} envMapIntensity={slabStyle ? 0.5 : 0.1} />
              </mesh>
            )}
            {floorIndex > 0 && (
              <mesh position={[0, 0.16, 0]} castShadow>
                <boxGeometry args={[slabW, slabStyle ? 0.32 : 0.22, slabD]} />
                <meshStandardMaterial color={slabC} roughness={slabR} metalness={0.02} envMapIntensity={slabStyle ? 0.5 : 0.1} />
              </mesh>
            )}
          </>
        );
      })()}
      {/* Contemporary wood cladding — vertical timber slats on front wall upper section.
          Applied only when preset=contemporary + flat roof + NOT full glass curtain wall.
          Uses accentColor so imported reference photo's wood tone (e.g. #D9570E) shows. */}
      {!isModern && isFlatRoof && preset === "contemporary" && floorIndex > 0 && (() => {
        const SLAT_W = 0.08, SLAT_GAP = 0.018, SLAT_T = 0.038;
        const step   = SLAT_W + SLAT_GAP;
        const panelW = W * 0.40;                           // cladding spans ~40% of wall width (right side)
        const panelH = H * 0.68;
        const offsetX = W * 0.22;                          // right-biased
        const numSlats = Math.floor(panelW / step);
        const startX = offsetX - (numSlats * step) / 2 + SLAT_W / 2;
        const warm1 = accentColor;
        const warm2 = accentColor;                         // slight variation handled by roughness
        return (
          <group position={[0, 0, -(D / 2 - WT / 2 - SLAT_T)]}>
            {Array.from({ length: numSlats }).map((_, i) => (
              <mesh key={i} position={[startX + i * step, panelH / 2 - H / 2 + H * 0.15, 0]} castShadow>
                <boxGeometry args={[SLAT_W, panelH, SLAT_T]} />
                <meshStandardMaterial
                  color={i % 2 === 0 ? warm1 : warm2}
                  roughness={0.38 + (i % 3) * 0.04}
                  metalness={0.0}
                  envMapIntensity={0.55}
                />
              </mesh>
            ))}
          </group>
        );
      })()}

      {/* Glass balcony railing on front face — modern style OR component facade, upper floors */}
      {(isModern || !!(ff?.front?.length)) && floorIndex > 0 && (
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
    <mesh position={[0, 0, 0.005 + getLayerOffset("exteriorDecor")]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} side={THREE.DoubleSide} {...overlayMaterialProps()} />
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

/** Wraps a single yard singleton (GLB model) so a corrupt / missing .bin
 *  file silently renders nothing instead of crashing the whole Canvas. */
class SingletonErrorBoundary extends Component<
  { id: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error) {
    console.warn(`[HouseCanvas.SingletonItem id=${this.props.id}] GLB load error — hiding item: ${err.message}`);
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

// ─── PBR asset error boundary ─────────────────────────────────────
// Silently hides any single 3-D asset that fails to load (e.g. truncated
// .bin, corrupt mesh data, CORS error) without crashing the whole scene.
class PbrErrorBoundary extends Component<
  { gltfPath: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error) {
    // Poison both caches so we never retry this broken file.
    _gltfAvailable.set(this.props.gltfPath, false);
    _gltfPending.delete(this.props.gltfPath);
    console.warn(`[PbrSketchfabAsset] Skipping broken model ${this.props.gltfPath}: ${err.message}`);
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
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
        <SingletonErrorBoundary key={it.id} id={it.id}>
          <SingletonItem item={it as import("@/lib/types").YardSingleton} />
        </SingletonErrorBoundary>
      ))}
    </group>
  );
}

// ─── Yard path strips (walkways / driveways) ─────────────────────────────────
// Renders each path as a flat extruded strip following a polyline.
// Points are in world-cm, Y is ground level (0).
const EMPTY_YARD_PATHS_3D: NonNullable<import("@/lib/types").YardPlan["paths"]> = [];
function YardPathItems3D() {
  const activeFloor = useDesignerStore(s => s.activeFloor);
  const paths = useDesignerStore(s => s.floorPlans[activeFloor].yardPlan?.paths ?? EMPTY_YARD_PATHS_3D);

  return (
    <group>
      {paths.map(path => {
        if (path.points.length < 2) return null;
        const halfW = (path.widthCm / 100) / 2;
        const H = 0.04; // flat slab height
        // Build quads between consecutive points
        const quads: React.ReactElement[] = [];
        for (let i = 0; i < path.points.length - 1; i++) {
          const [ax, az] = path.points[i];
          const [bx, bz] = path.points[i + 1];
          const dx = bx - ax, dz = bz - az;
          const len = Math.sqrt(dx * dx + dz * dz) / 100; // metres
          const angle = Math.atan2(dz, dx);
          const mx = (ax + bx) / 200;  // world metres
          const mz = (az + bz) / 200;
          quads.push(
            <mesh key={i} position={[mx, H / 2, mz]} rotation={[0, -angle, 0]} receiveShadow>
              <boxGeometry args={[len, H, halfW * 2]} />
              <meshStandardMaterial
                color={path.material === "stone" ? "#C8BFAF" : "#D4C8A8"}
                roughness={0.88} metalness={0.0}
              />
            </mesh>
          );
          // Rounded cap at each vertex
          if (i === 0) quads.push(
            <mesh key={`cap-${i}`} position={[ax / 100, H / 2, az / 100]} receiveShadow>
              <cylinderGeometry args={[halfW, halfW, H, 12]} />
              <meshStandardMaterial color="#C8BFAF" roughness={0.88} />
            </mesh>
          );
          quads.push(
            <mesh key={`cap-e-${i}`} position={[bx / 100, H / 2, bz / 100]} receiveShadow>
              <cylinderGeometry args={[halfW, halfW, H, 12]} />
              <meshStandardMaterial color="#C8BFAF" roughness={0.88} />
            </mesh>
          );
        }
        return <group key={path.id}>{quads}</group>;
      })}
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
      {/* PbrErrorBoundary is OUTSIDE Suspense so it catches errors that
          propagate through async GLTF resolution (e.g. truncated .bin). */}
      <PbrErrorBoundary gltfPath={asset.customGltfPath}>
        <Suspense fallback={isFurniture ? <ProceduralFurnitureMesh kind={it.kind} /> : null}>
          {sketchfabReady ? (
            <PbrSketchfabAsset
              key={`pbr:${asset.customGltfPath}`}
              gltfPath={asset.customGltfPath}
              targetHeightM={asset.customTargetHeightM}
              userScale={isFurniture ? s : sketchfabUserScale}
              groundAlign={asset.customGroundAlign ?? true}
            />
          ) : (
            isFurniture ? <ProceduralFurnitureMesh kind={it.kind} /> : null
          )}
        </Suspense>
      </PbrErrorBoundary>
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
    // Italian Cypress — very tall, very narrow, columnar evergreen.
    // Built from 6 tightly-stacked cone tiers, each narrowing toward the apex,
    // with alternating shade tones for the side vs front facing light.
    // hash-based height variation [5.2, 6.5] for organic rhythm in rows.
    const cyH = 5.2 + h1 * 1.3;
    const tiers = [
      { y: cyH * 0.10, r: 0.34, h: cyH * 0.20, c: "#183E18" },
      { y: cyH * 0.25, r: 0.30, h: cyH * 0.22, c: "#1A4A1C" },
      { y: cyH * 0.40, r: 0.25, h: cyH * 0.22, c: "#1C5220" },
      { y: cyH * 0.55, r: 0.18, h: cyH * 0.22, c: "#1E5824" },
      { y: cyH * 0.70, r: 0.12, h: cyH * 0.18, c: "#1C5020" },
      { y: cyH * 0.84, r: 0.06, h: cyH * 0.18, c: "#1A4C1E" },
    ];
    return (
      <group position={[x, 0, z]} scale={[s, s, s]} rotation={[0, h2 * Math.PI * 2, 0]}>
        {/* Trunk — thin, barely visible below lowest tier */}
        <mesh position={[0, cyH * 0.04, 0]} castShadow>
          <cylinderGeometry args={[0.075, 0.10, cyH * 0.08, 6]} />
          <meshStandardMaterial color="#2A1A0A" roughness={0.92} />
        </mesh>
        {tiers.map((t, ti) => (
          <mesh key={ti} position={[0, t.y, 0]} castShadow>
            <coneGeometry args={[t.r, t.h, 8]} />
            <meshStandardMaterial
              color={t.c}
              roughness={0.90}
              // subtle envMap so the tree catches ambient sky colour
              envMapIntensity={0.25}
            />
          </mesh>
        ))}
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
      {/* Short woody stem */}
      <mesh position={[0, 0.10, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.08, 0.20, 6]} />
        <meshStandardMaterial color="#5A3818" roughness={0.95} />
      </mesh>
      {/* Main dome — three overlapping spheres for organic silhouette */}
      <mesh position={[0, 0.44, 0]} castShadow>
        <sphereGeometry args={[0.56, 12, 9]} />
        <meshStandardMaterial color="#386C28" roughness={0.94} />
      </mesh>
      <mesh position={[0.38, 0.38, 0.20]} castShadow>
        <sphereGeometry args={[0.40, 10, 8]} />
        <meshStandardMaterial color="#3E7830" roughness={0.94} />
      </mesh>
      <mesh position={[-0.30, 0.36, -0.18]} castShadow>
        <sphereGeometry args={[0.36, 10, 7]} />
        <meshStandardMaterial color="#345C24" roughness={0.95} />
      </mesh>
      {/* Top highlight lobe — lighter tip for light-catching silhouette */}
      <mesh position={[0.10, 0.72, 0.05]} castShadow>
        <sphereGeometry args={[0.24, 9, 7]} />
        <meshStandardMaterial color="#4A8838" roughness={0.93} />
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
      {/* Pool bottom — deep turquoise mosaic tile.
          Deeper hue (#1A9AAE) gives that "infinite pool depth" look.
          Sun + sky + underwater LEDs light this through the water surface. */}
      <mesh position={[0, -0.42, 0]} receiveShadow>
        <boxGeometry args={[w + 0.02, 0.04, d + 0.02]} />
        <meshStandardMaterial color="#1A9AAE" roughness={0.28} metalness={0.06} />
      </mesh>
      {/* Reflective water surface */}
      <mesh ref={surfaceRef} position={[0, -0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d, 1, 1]} />
        <MeshReflectorMaterial
          blur={[120, 60]}
          resolution={512}
          mixBlur={0.55}
          mixStrength={1.55}
          mirror={0.70}
          mixContrast={1.15}
          roughness={0.06}
          metalness={0.12}
          color="#5CCCE6"
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

      {/* Columns — InstancedMesh，所有柱子 1 个 draw call */}
      <InstancedBoxes
        boxArgs={[0.10, colH, 0.10]}
        positions={columns.map(([cx, cz]) => [cx, colH / 2, cz])}
        color={STEEL} roughness={0.45} metalness={0.65}
        castShadow receiveShadow
      />

      {/* Longitudinal beams — InstancedMesh */}
      <InstancedBoxes
        boxArgs={[pW + 0.30, 0.22, 0.10]}
        positions={longBeams.map(bz => [0, colH + 0.12, bz])}
        color={STEEL} roughness={0.5} metalness={0.55}
        castShadow
      />

      {/* LED strips — InstancedMesh（发光色作 emissive）*/}
      <InstancedBoxes
        boxArgs={[pW + 0.20, 0.02, 0.04]}
        positions={longBeams.map(bz => [0, colH + 0.005, bz])}
        color="#FFE8B0" emissive="#FFE8B0" emissiveIntensity={0.9}
      />

      {/* Roof slats — MergedSlats，N 根合并为 1 个 draw call */}
      <group position={[0, colH + 0.27, 0]}>
        <MergedSlats
          slatW={0.06} slatH={0.04} slatD={pD + 0.05}
          count={SLAT_COUNT} axis="x" spacing={slatPitch}
          color={STEEL_HI} roughness={0.5} metalness={0.55}
          castShadow
        />
      </group>

      {/* Dining table — dark stone slab */}
      <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.1, 1.2]} />
        <meshStandardMaterial color="#3A3A3A" roughness={0.5} metalness={0.1} />
      </mesh>
      {/* Table legs — InstancedMesh */}
      <InstancedBoxes
        boxArgs={[0.08, 0.72, 0.08]}
        positions={[ [-1.1, 0.36, -0.45], [1.1, 0.36, -0.45], [-1.1, 0.36, 0.45], [1.1, 0.36, 0.45] ]}
        color="#2A2A2A" roughness={0.6}
        castShadow
      />

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
    `${base}_diff_1k.webp`,
    `${base}_nor_gl_1k.webp`,
    `${base}_arm_1k.webp`,
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

// Procedural grass texture — generated on a canvas so there are zero seam
// artifacts: no external file, no tiling repeat, no grid pattern.
// The 1024×1024 canvas is created once via useMemo and handed to Three.js.
// Module-level singleton — generated once for the entire app lifetime,
// not recreated on every HouseCanvas mount (saves ~80–120ms on mobile).
let _grassTex: THREE.CanvasTexture | null = null;
function getProceduralGrassTexture(): THREE.CanvasTexture {
  if (_grassTex) return _grassTex;
  const RES = 512; // halved from 1024 — indistinguishable at ground-plane scale
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = RES;
  const ctx = canvas.getContext("2d")!;

  // ── 1. Base fill ────────────────────────────────────────────
  ctx.fillStyle = "#3B5E1E";
  ctx.fillRect(0, 0, RES, RES);

  // ── 2. Organic patches — 160 blobs (halved, still realistic) ──
  for (let i = 0; i < 160; i++) {
    const x   = Math.random() * RES;
    const y   = Math.random() * RES;
    const rx  = 12 + Math.random() * 55;
    const ry  = rx * (0.55 + Math.random() * 0.9);
    const rot = Math.random() * Math.PI;
    const isLight = Math.random() > 0.42;
    const alpha   = 0.07 + Math.random() * 0.11;
    const col = isLight ? `rgba(78,118,28,${alpha})` : `rgba(18,42,5,${alpha})`;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    grad.addColorStop(0, col);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(rx, ry), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── 3. Per-pixel fine noise ─────────────────────────────────
  const imgData = ctx.getImageData(0, 0, RES, RES);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 24;
    d[i]     = Math.max(0, Math.min(255, d[i]     + n * 0.35));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.75));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.20));
  }
  ctx.putImageData(imgData, 0, 0);

  _grassTex = new THREE.CanvasTexture(canvas);
  _grassTex.colorSpace = THREE.SRGBColorSpace;
  return _grassTex;
}
function useProceduralGrassTexture(): THREE.CanvasTexture {
  return useMemo(() => getProceduralGrassTexture(), []);
}

function GrassGroundTextured({ size }: { size: number }) {
  const texture = useProceduralGrassTexture();
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.499, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial
        map={texture}
        roughness={0.95}
        metalness={0.0}
        envMapIntensity={0.12}
      />
    </mesh>
  );
}

// Cobblestone entry path — always shown as a visual anchor connecting
// the front door to the property edge. Uses cobblestone_05 PBR texture.
function EntryPathTextured({ W, D }: { W: number; D: number }) {
  const { map, normalMap, roughnessMap } = usePbrSet("driveway", "cobblestone_05", [4, 8]);
  const pathLen = D * 0.5 + 5.5;
  const pathW   = 2.8;  // wider driveway — fits one car comfortably
  return (
    <group>
      {/* Main cobblestone driveway */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.496, D / 2 + pathLen / 2 - 0.1]} receiveShadow>
        <planeGeometry args={[pathW, pathLen]} />
        <meshStandardMaterial map={map} normalMap={normalMap} roughnessMap={roughnessMap}
          color="#D0C8B8" roughness={0.85} metalness={0.01} />
      </mesh>
      {/* Kerb / edging strips — low concrete borders */}
      {([-pathW / 2 - 0.065, pathW / 2 + 0.065] as number[]).map((kx, ki) => (
        <mesh key={ki} position={[kx, -0.490, D / 2 + pathLen / 2 - 0.1]} castShadow receiveShadow>
          <boxGeometry args={[0.12, 0.045, pathLen]} />
          <meshStandardMaterial color="#C0BAB0" roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

function EntryPath({ W, D }: { W: number; D: number }) {
  const pathLen = D * 0.5 + 5.5;
  const pathW   = 2.8;
  return (
    <Suspense fallback={
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.498, D / 2 + pathLen / 2 - 0.1]} receiveShadow>
        <planeGeometry args={[pathW, pathLen]} />
        <meshStandardMaterial color="#C8BEA8" roughness={0.9} />
      </mesh>
    }>
      <EntryPathTextured W={W} D={D} />
    </Suspense>
  );
}

function Ground({ W, D }: { W: number; D: number }) {
  // Single large plane — no seam between "far" and "near" zones.
  // Sized to fill the camera frustum; PBR texture loads async via Suspense.
  const size = Math.max(W, D) * 7 + 40;
  const grassRadius = Math.max(W, D) * 3.5 + 16;
  return (
    <>
      <Suspense fallback={
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.500, 0]} receiveShadow>
          <planeGeometry args={[size, size]} />
          <meshStandardMaterial color="#3E6020" roughness={0.96} />
        </mesh>
      }>
        <GrassGroundTextured size={size} />
      </Suspense>
      {/* Instanced grass blades around building — skips building footprint */}
      <GrassCarpet W={W} D={D} count={2800} radius={grassRadius} />
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
    // Slightly taller (0.22m) and wider (0.030m) for lusher ground coverage
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array([
      // base-left, base-right, tip
      -0.030, 0,    0,
       0.030, 0,    0,
       0,     0.22, 0,
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
    // Pool deck exclusion zone (glass villa south yard)
    // Pool deck: center at pz = -D/2 - deckBW - poolL/2 - 0.80, total width & depth
    const deckBW = 2.80;
    const poolL  = Math.min(D * 0.70, 9.50);
    const poolW  = Math.min(W * 0.78, 11.0);
    const deckHalfX = (poolW + deckBW * 2) / 2 + 0.30;  // with margin
    const deckZN    = -D / 2 - 0.80;                     // deck north edge (building side)
    const deckZS    = -D / 2 - deckBW * 2 - poolL - 0.80;// deck south edge (far side)
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
      // Skip pool deck area so blades don't poke through travertine
      if (Math.abs(x) < deckHalfX && z > deckZS && z < deckZN) continue;
      dummy.position.set(x, -0.49, z);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      const s = 0.7 + Math.random() * 0.7;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      // Colour variation: rich natural lawn greens with subtle warm/cool shift
      const tint = 0.45 + Math.random() * 0.50;
      const warmth = Math.random() * 0.08; // occasional warm yellow-green blade
      const col = new THREE.Color(
        0.14 * tint + 0.04 + warmth * 0.5,
        0.36 * tint + 0.06 + warmth * 0.3,
        0.08 * tint,
      );
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
  // Merge all tree geometry into two meshes (trunks + foliage) to halve draw calls.
  // Uses a deterministic seed derived from (radius, count) for SSR safety.
  const { trunkGeo, foliageGeo } = useMemo(() => {
    const trunkGeos:   THREE.BufferGeometry[] = [];
    const foliageGeos: THREE.BufferGeometry[] = [];
    // Simple xorshift seeded from radius+count — no Math.random() so SSR safe
    let seed = Math.round(radius * 100 + count * 31337);
    const rand = () => {
      seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
      return ((seed >>> 0) / 0xFFFFFFFF);
    };
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.14;
      const r = radius + rand() * radius * 0.20;
      const h = 4.5 + rand() * 5.5;
      const tint = 0.55 + rand() * 0.38;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;

      // Trunk (low-poly cylinder proxy via box)
      const tH  = h * 0.30;
      const tg   = new THREE.CylinderGeometry(0.14, 0.22, tH, 5);
      tg.applyMatrix4(new THREE.Matrix4().makeTranslation(x, tH / 2, z));
      trunkGeos.push(tg);

      // Foliage cone (2 stacked cones for silhouette depth)
      const fg1 = new THREE.ConeGeometry(h * 0.38, h * 0.78, 7);
      fg1.applyMatrix4(new THREE.Matrix4().makeTranslation(x, h * 0.65, z));
      const fg2 = new THREE.ConeGeometry(h * 0.22, h * 0.42, 6);
      fg2.applyMatrix4(new THREE.Matrix4().makeTranslation(x, h * 0.88, z));
      foliageGeos.push(fg1, fg2);
      void tint; // tint used for color below
    }
    const merged = (geos: THREE.BufferGeometry[]) =>
      geos.length > 0 ? mergeGeometries(geos, false) : new THREE.BufferGeometry();
    return { trunkGeo: merged(trunkGeos), foliageGeo: merged(foliageGeos) };
  }, [radius, count]);

  return (
    <group>
      <mesh geometry={trunkGeo} castShadow>
        <meshStandardMaterial color="#3A2812" roughness={0.95} />
      </mesh>
      <mesh geometry={foliageGeo} castShadow>
        {/* Muted mid-green with a touch of blue-green for atmospheric depth */}
        <meshStandardMaterial color="#2A5A28" roughness={0.94} envMapIntensity={0.18} />
      </mesh>
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

// ─── GLB Villa Building — Loads villa_pbr.glb PBR model ─────────────────────
// Used when buildingType === "rich-glass-villa" and the file is present.
// The model is centred at origin, scaled so its longest dimension equals W*1.6.

function GlbVillaMesh({ W, D }: { W: number; D: number }) {
  const { scene } = useGLTF("/models/villa_pbr.glb");
  const cloned = useMemo(() => {
    const c = scene.clone(true);
    // Compute bounding box and auto-scale + centre
    const box = new THREE.Box3().setFromObject(c);
    const size = box.getSize(new THREE.Vector3());
    const targetW = W * 1.58;          // target world width ≈ main block + wings
    const scale = targetW / Math.max(size.x, size.z, 0.01);
    c.scale.setScalar(scale);
    // After scaling, shift so bottom sits on y=0 and model is centred in XZ
    const scaledBox = new THREE.Box3().setFromObject(c);
    const scaledCentre = scaledBox.getCenter(new THREE.Vector3());
    c.position.set(-scaledCentre.x, -scaledBox.min.y, -scaledCentre.z);

    // ── Fix PBR materials ──
    // Boost envMapIntensity so the IBL from <Environment> activates reflections.
    // Also ensure texture color space is correct for Three.js r152+.
    c.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m: THREE.Material) => {
        if (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhysicalMaterial) {
          m.envMapIntensity = 2.2;
          // Fix color-space for all map textures so colors don't look washed/clay
          const texMaps: (THREE.Texture | null)[] = [
            m.map, m.emissiveMap, (m as THREE.MeshPhysicalMaterial).sheenColorMap ?? null,
          ];
          texMaps.forEach(t => {
            if (t) t.colorSpace = THREE.SRGBColorSpace;
          });
          m.needsUpdate = true;
        }
      });
    });

    return c;
  }, [scene, W, D]);
  return <primitive object={cloned} castShadow receiveShadow />;
}

function GlbVillaBuilding({ W, D }: { W: number; D: number }) {
  return (
    <Suspense fallback={
      // While GLB loads, show a simple placeholder so the scene isn't blank
      <mesh position={[0, 3, 0]}>
        <boxGeometry args={[W * 1.5, 6, D]} />
        <meshStandardMaterial color="#F0EDE8" roughness={0.7} wireframe />
      </mesh>
    }>
      <GlbVillaMesh W={W} D={D} />
    </Suspense>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ARCHITECTURAL BUILDING KIT — Procedural Volume & Material System
// ═══════════════════════════════════════════════════════════════════════════════
//
// Design philosophy: a building is built up in 6 layers (from macro → micro):
//   Site → Volume → Plate → Bay → Face → Detail
//
// Every geometric element is a deterministic React component — no Math.random()
// in render paths (so React StrictMode double-invoke is safe).
// Textures are canvas-baked module singletons (generated once, shared by all meshes).
//
// Inspired by:
//  • Metabolism (Kurokawa / Tange) — buildings as assemblies of interchangeable pods
//  • Le Corbusier's Modulor — 1.5 m structural bay grid governs all proportions
//  • CSG (Constructive Solid Geometry) — boolean union/difference of volumes
//  • Curtain Wall systems — column grid → floor plate → mullion unit → glass infill
// ───────────────────────────────────────────────────────────────────────────────

// ─── Procedural Material Textures (module singletons) ────────────────────────
// All generated from HTML Canvas — no external files needed.
// Deterministic (no Math.random in the render path) for React StrictMode safety.

let _STONE_TEX: THREE.CanvasTexture | null = null;
/** Travertine limestone — warm cream with horizontal strata bands */
function getStoneTex(): THREE.CanvasTexture {
  if (_STONE_TEX) return _STONE_TEX;
  const S = 512;
  const cv = document.createElement("canvas"); cv.width = S; cv.height = S;
  const g = cv.getContext("2d")!;
  // warm travertine base
  g.fillStyle = "#E4DDD0"; g.fillRect(0, 0, S, S);
  // horizontal strata bands — deterministic widths
  const bands = [8,14,6,18,10,5,16,9,12,7,15,11,8,17,6,13,10,9,14,7];
  let y = 0, bi = 0;
  while (y < S) {
    const lh = bands[bi % bands.length]; bi++;
    const alpha = 0.04 + (bi * 0.037 % 0.10);
    g.fillStyle = `rgba(148,132,108,${alpha})`; g.fillRect(0, y, S, lh * 0.4);
    y += lh;
  }
  // pore / void inclusions (halton-ish sequence)
  const hx=[0.10,0.60,0.35,0.85,0.22,0.72,0.48,0.98,0.12,0.62,0.37,0.87,0.25,0.75,0.50,0.05,0.55,0.30,0.80,0.18,0.68,0.43,0.93,0.07,0.57,0.32,0.82,0.20,0.70,0.45];
  const hy=[0.08,0.58,0.33,0.83,0.21,0.71,0.46,0.96,0.13,0.63,0.38,0.88,0.26,0.76,0.51,0.04,0.54,0.29,0.79,0.17,0.67,0.42,0.92,0.06,0.56,0.31,0.81,0.19,0.69,0.44];
  hx.forEach((xf, i) => {
    g.fillStyle = "rgba(110,98,80,0.07)";
    g.beginPath(); g.ellipse(xf*S, hy[i]*S, 1+hy[i]*4, 0.6, 0, 0, Math.PI*2); g.fill();
  });
  _STONE_TEX = new THREE.CanvasTexture(cv);
  _STONE_TEX.wrapS = _STONE_TEX.wrapT = THREE.RepeatWrapping;
  return _STONE_TEX;
}

let _WOOD_TEX: THREE.CanvasTexture | null = null;
/** Ipe/teak hardwood — dark brown with longitudinal grain */
function getWoodTex(): THREE.CanvasTexture {
  if (_WOOD_TEX) return _WOOD_TEX;
  const W = 128, H = 512;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  // base — warm dark teak gradient across width
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0.0, "#5A3010"); grad.addColorStop(0.35, "#7A4820");
  grad.addColorStop(0.65, "#6B3E18"); grad.addColorStop(1.0, "#522C0E");
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // longitudinal grain — sin-wave based, fully deterministic
  for (let x = 0; x < W; x++) {
    const v = Math.sin(x * 0.78) * 0.5 + Math.sin(x * 2.14) * 0.25 + Math.sin(x * 5.33) * 0.12;
    if (Math.abs(v) < 0.42) {
      const a = 0.05 + Math.abs(v) * 0.14;
      g.strokeStyle = `rgba(22,8,2,${a})`; g.lineWidth = 0.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
  }
  // sapwood lighter streak at edge
  g.strokeStyle = "rgba(180,130,80,0.06)"; g.lineWidth = 4;
  g.beginPath(); g.moveTo(W*0.82, 0); g.lineTo(W*0.84, H); g.stroke();
  _WOOD_TEX = new THREE.CanvasTexture(cv);
  _WOOD_TEX.wrapS = _WOOD_TEX.wrapT = THREE.RepeatWrapping;
  return _WOOD_TEX;
}

let _CONCRETE_TEX: THREE.CanvasTexture | null = null;
/** Board-form concrete — off-white with subtle vertical form-board seams */
function getConcreteTex(): THREE.CanvasTexture {
  if (_CONCRETE_TEX) return _CONCRETE_TEX;
  const S = 512;
  const cv = document.createElement("canvas"); cv.width = S; cv.height = S;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#EAE6DC"; g.fillRect(0, 0, S, S);
  // form-board vertical seams (fixed positions)
  [48, 138, 215, 298, 375, 442].forEach(x => {
    g.strokeStyle = "rgba(172,165,150,0.16)"; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x+1.5, S); g.stroke();
  });
  // aggregate speckle — halton positions
  const hx=[0.10,0.60,0.35,0.85,0.22,0.72,0.48,0.98,0.12,0.62,0.37,0.87,0.25,0.75,0.50,0.05,0.55,0.30,0.80,0.18,0.68,0.43,0.93,0.07,0.57,0.32,0.82,0.20,0.70,0.45,0.15,0.65,0.40,0.90,0.28,0.78];
  const hy=[0.08,0.58,0.33,0.83,0.21,0.71,0.46,0.96,0.13,0.63,0.38,0.88,0.26,0.76,0.51,0.04,0.54,0.29,0.79,0.17,0.67,0.42,0.92,0.06,0.56,0.31,0.81,0.19,0.69,0.44,0.11,0.61,0.36,0.86,0.23,0.73];
  hx.forEach((xf, i) => {
    g.fillStyle = `rgba(158,150,136,0.07)`;
    g.beginPath(); g.arc(xf*S, hy[i%hy.length]*S, 0.8+hy[i%hy.length]*2.5, 0, Math.PI*2); g.fill();
  });
  _CONCRETE_TEX = new THREE.CanvasTexture(cv);
  _CONCRETE_TEX.wrapS = _CONCRETE_TEX.wrapT = THREE.RepeatWrapping;
  return _CONCRETE_TEX;
}

// ─── Kit-of-Parts Components ──────────────────────────────────────────────────

/** Horizontal concrete floor/roof plate */
function ConcreteSlab({ W, D, T = 0.28, color = "#ECEAE2", repeat = 4 }: {
  W: number; D: number; T?: number; color?: string; repeat?: number;
}) {
  const tex = getConcreteTex();
  tex.repeat.set(repeat, repeat);
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[W, T, D]} />
      <meshStandardMaterial map={tex} color={color} roughness={0.78} metalness={0.02} envMapIntensity={0.4} />
    </mesh>
  );
}

/** Stone travertine plinth / base cladding */
function StoneCladding({ W, H, D = WT, repeat = 2 }: { W: number; H: number; D?: number; repeat?: number }) {
  const tex = getStoneTex();
  tex.repeat.set(repeat, repeat * (H / W));
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[W, H, D]} />
      <meshStandardMaterial map={tex} color="#E0D8C8" roughness={0.82} metalness={0.0} envMapIntensity={0.3} />
    </mesh>
  );
}

/** Round steel column — used under cantilever to support deep overhangs */
function SteelColumn({ H, radius = 0.055 }: { H: number; radius?: number }) {
  return (
    <mesh position={[0, H / 2, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, H, 16]} />
      <meshStandardMaterial color="#2A2A2E" roughness={0.18} metalness={0.92} envMapIntensity={2.5} />
    </mesh>
  );
}

/** Wood soffit slat panel — visible underside of a cantilever roof
 *  Slats run along Z (depth direction). `W` = total width, `D` = total depth. */
function WoodSoffit({ W, D, T = 0.042 }: { W: number; D: number; T?: number }) {
  const woodTex = getWoodTex();
  const SLAT_W   = 0.175;  // wide ipe deck board — reference shows ~18cm face width
  const SLAT_GAP = 0.018;
  const step     = SLAT_W + SLAT_GAP;
  const count    = Math.floor(D / step);
  const startZ   = -(count * step) / 2 + SLAT_W / 2;
  return (
    <group>
      {Array.from({ length: count }).map((_, i) => {
        const shade = i % 3 === 0 ? "#8B4E1A" : i % 3 === 1 ? "#9C5E28" : "#8A5018";
        return (
          <mesh key={i} position={[0, 0, startZ + i * step]} castShadow receiveShadow>
            <boxGeometry args={[W - 0.04, T, SLAT_W]} />
            <meshStandardMaterial map={woodTex} color={shade} roughness={0.30} metalness={0.0}
              envMapIntensity={0.8} emissive="#7A3C10" emissiveIntensity={0.12} />
          </mesh>
        );
      })}
    </group>
  );
}

/** White concrete fascia band wrapping a slab edge (matches reference: bright white slab edges) */
function FasciaBand({ W, D, H = 0.38, color = "#F2F0EA" }: {
  W: number; D: number; H?: number; color?: string;
}) {
  const edges: Array<{p:[number,number,number]; a:[number,number,number]}> = [
    { p: [0, 0, -D/2], a: [W+0.02, H, 0.060] },
    { p: [0, 0,  D/2], a: [W+0.02, H, 0.060] },
    { p: [-W/2, 0, 0], a: [0.060, H, D] },
    { p: [ W/2, 0, 0], a: [0.060, H, D] },
  ];
  return (
    <group>
      {edges.map((e, i) => (
        <mesh key={i} position={e.p} castShadow>
          <boxGeometry args={e.a} />
          <meshStandardMaterial color={color} roughness={0.62} metalness={0.02} />
        </mesh>
      ))}
    </group>
  );
}

// ─── Rich Glass Villa Building — Custom multi-volume architecture ────────────
// Composes the above kit-of-parts into a 3-volume luxury villa.
// Volume layout (seen from above, camera at +Z):
//   ┌──────┬────────────────────┬──────┐
//   │ LEFT │   MAIN BLOCK (2F)  │RIGHT │
//   │ WING │  glass curtain     │ WING │
//   │  1F  │  wall front+sides  │  1F  │
//   └──────┴────────────────────┴──────┘
//        pool / terrace at front (−Z)


/** Reusable glass curtain wall — dark aluminum frames + TRUE transmission glass.
 *  NO opaque backing here; the actual interior room geometry behind is visible
 *  through the transmission. */
function GlassCurtainWallFace({
  W, H, panelCount, flip = false, glassOpacity = 0.45,
}: { W: number; H: number; panelCount?: number; flip?: boolean; glassOpacity?: number }) {
  const panels   = panelCount ?? Math.max(2, Math.round(W / 1.35));
  const mullionW = 0.095;
  const glassH   = H * 0.978;
  const panelW   = (W * 0.99 - (panels - 1) * mullionW) / panels;
  const startPX  = -(W * 0.99 / 2) + panelW / 2;
  const zDir     = flip ? 1 : -1;
  const extZ     = zDir * (WT / 2 + 0.006);
  const frame    = "#181A1E";   // near-black anodized aluminum

  return (
    <group>
      {/* NOTE: No spandrel/backing slab here — the building interior room geometry
          (RichGlassInterior) provides back walls visible through transmission glass. */}

      {/* ── Head rail (top) + Sill rail (bottom) — run full wall width ── */}
      <group position={[0, 0, extZ]}>
        <mesh castShadow position={[0, glassH / 2 + 0.04, 0]}>
          <boxGeometry args={[W, 0.08, 0.062]} />
          <meshStandardMaterial color={frame} roughness={0.10} metalness={0.96} envMapIntensity={2.8} />
        </mesh>
        <mesh castShadow position={[0, -(glassH / 2 + 0.04), 0]}>
          <boxGeometry args={[W, 0.08, 0.062]} />
          <meshStandardMaterial color={frame} roughness={0.10} metalness={0.96} envMapIntensity={2.8} />
        </mesh>
        {/* Mid rail (horizontal divide running full width) */}
        <mesh castShadow position={[0, -glassH * 0.22, 0]}>
          <boxGeometry args={[W, 0.042, 0.040]} />
          <meshStandardMaterial color={frame} roughness={0.14} metalness={0.90} />
        </mesh>
      </group>

      {/* ── Per-panel: vertical mullion + glass only (NO solid box frame) ── */}
      {Array.from({ length: panels }).map((_, pi) => {
        const px = startPX + pi * (panelW + mullionW);
        const isFirst = pi === 0;
        return (
          <group key={pi} position={[px, 0, extZ]}>
            {/* Vertical mullion on the RIGHT edge of this panel */}
            <mesh castShadow position={[panelW / 2 + mullionW / 4, 0, 0]}>
              <boxGeometry args={[mullionW / 2, glassH + 0.08, 0.060]} />
              <meshStandardMaterial color={frame} roughness={0.10} metalness={0.96} envMapIntensity={2.8} />
            </mesh>
            {/* Left edge mullion — only for first panel */}
            {isFirst && (
              <mesh castShadow position={[-(panelW / 2 + mullionW / 4), 0, 0]}>
                <boxGeometry args={[mullionW / 2, glassH + 0.08, 0.060]} />
                <meshStandardMaterial color={frame} roughness={0.10} metalness={0.96} />
              </mesh>
            )}
            {/* GLASS — low-reflection architectural glass; interior visible, no env-map muddiness */}
            <mesh position={[0, 0, zDir * 0.025]} renderOrder={10}>
              <boxGeometry args={[panelW - 0.004, glassH, 0.008]} />
              <meshStandardMaterial
                color="#C8E0EA"
                transparent
                opacity={glassOpacity}
                depthWrite={false}
                roughness={0.06}
                metalness={0.04}
                envMapIntensity={0.35}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Interior rooms for RichGlassVillaBuilding — visible through transmission glass.
 *  Provides the warm cream walls / dark wood floors / furniture silhouettes seen
 *  through the curtain wall, exactly like the reference photo. */
function RichGlassInterior({
  W, D, GF_H, UF_H, SLAB_T,
}: { W: number; D: number; GF_H: number; UF_H: number; SLAB_T: number }) {
  const wallC  = "#EDE6D8";   // warm cream interior wall
  const ceilC  = "#F3EEE4";   // bright warm ceiling
  const floorC = "#4A3018";   // dark walnut floor
  const tableC = "#2A1A08";   // dark walnut table
  const chairC = "#3E2810";   // dark chair
  const sofaC  = "#9A8870";   // beige sofa

  // Interior geometry Z range: front glass is at -(D/2), back wall is at +(D/2).
  // Structural concrete back wall center is at D/2 - WT/2 = D/2 - 0.12.
  // Keep all interior surfaces 1m+ away from structural walls to avoid z-fighting.
  // Interior room spans from zFront (just inside front glass) to zBack (1m inside back).
  const zFront = -(D / 2 - 0.35);    // 0.35m south from center, just inside glass
  const zBack  =  (D / 2 - WT - 0.20);  // just 0.20m inside the structural back wall's south face
  const roomD  = zBack - zFront;      // room depth (all interior surfaces span this)
  const roomCZ = (zFront + zBack) / 2; // center Z of room

  return (
    <group>

      {/* ══ GROUND FLOOR INTERIOR ══════════════════════════════ */}
      <group position={[0, GF_H / 2, 0]}>
        {/* BACK WALL — primary warm surface, clearly 1m inside structural back wall */}
        <mesh position={[0, 0, zBack]}>
          <boxGeometry args={[W * 0.92, GF_H - 0.06, 0.22]} />
          <meshStandardMaterial color={wallC} roughness={0.82}
            emissive="#F0D8A8" emissiveIntensity={0.42} />
        </mesh>

        {/* Floor — dark walnut parquet */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -(GF_H / 2 - 0.04), roomCZ]}>
          <planeGeometry args={[W * 0.92, roomD]} />
          <meshStandardMaterial color={floorC} roughness={0.55} />
        </mesh>

        {/* Ceiling — bright warm recessed LEDs */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, GF_H / 2 - 0.05, roomCZ]}>
          <planeGeometry args={[W * 0.92, roomD]} />
          <meshStandardMaterial color={ceilC}
            emissive="#F5E880" emissiveIntensity={0.18} roughness={0.94} side={THREE.DoubleSide} />
        </mesh>

        {/* Side walls — emissive warm fill */}
        <mesh position={[-(W * 0.46), 0, roomCZ]}>
          <boxGeometry args={[0.14, GF_H - 0.06, roomD]} />
          <meshStandardMaterial color={wallC} roughness={0.82} emissive="#D8B060" emissiveIntensity={0.06} />
        </mesh>
        <mesh position={[ (W * 0.46), 0, roomCZ]}>
          <boxGeometry args={[0.14, GF_H - 0.06, roomD]} />
          <meshStandardMaterial color={wallC} roughness={0.82} emissive="#D8B060" emissiveIntensity={0.06} />
        </mesh>

        {/* Dining table — clearly visible from glass */}
        <mesh position={[W * 0.08, -(GF_H / 2) + 0.42, roomCZ + roomD * 0.15]}>
          <boxGeometry args={[3.0, 0.08, 1.1]} />
          <meshStandardMaterial color={tableC} roughness={0.40} />
        </mesh>
        {/* Dining chairs — 3 each side */}
        {([-0.90, 0, 0.90] as number[]).map((x, i) => (
          <mesh key={`cn${i}`} position={[W * 0.08 + x, -(GF_H / 2) + 0.28, roomCZ + roomD * 0.22]}>
            <boxGeometry args={[0.48, 0.46, 0.48]} />
            <meshStandardMaterial color={chairC} roughness={0.58} />
          </mesh>
        ))}
        {([-0.90, 0, 0.90] as number[]).map((x, i) => (
          <mesh key={`cs${i}`} position={[W * 0.08 + x, -(GF_H / 2) + 0.28, roomCZ + roomD * 0.08]}>
            <boxGeometry args={[0.48, 0.46, 0.48]} />
            <meshStandardMaterial color={chairC} roughness={0.58} />
          </mesh>
        ))}
        {/* Living area sofa */}
        <mesh position={[-W * 0.22, -(GF_H / 2) + 0.32, zFront + roomD * 0.30]}>
          <boxGeometry args={[2.4, 0.60, 0.90]} />
          <meshStandardMaterial color={sofaC} roughness={0.82} />
        </mesh>
        {/* Coffee table */}
        <mesh position={[-W * 0.22, -(GF_H / 2) + 0.20, zFront + roomD * 0.42]}>
          <boxGeometry args={[1.1, 0.06, 0.55]} />
          <meshStandardMaterial color={tableC} roughness={0.42} />
        </mesh>
        {/* Pendant lamp above dining — glowing sphere */}
        <mesh position={[W * 0.08, GF_H / 2 - 0.55, roomCZ + roomD * 0.15]}>
          <sphereGeometry args={[0.15, 12, 8]} />
          <meshStandardMaterial color="#FFDF80" emissive="#FFD040"
            emissiveIntensity={2.0} roughness={0.50} />
        </mesh>
      </group>

      {/* ══ UPPER FLOOR INTERIOR ═══════════════════════════════ */}
      <group position={[0, GF_H + SLAB_T + UF_H / 2, 0]}>
        {/* Back wall — bright warm */}
        <mesh position={[0, 0, zBack]}>
          <boxGeometry args={[W * 0.92, UF_H - 0.06, 0.22]} />
          <meshStandardMaterial color={wallC} roughness={0.82}
            emissive="#F0E0C0" emissiveIntensity={0.22} />
        </mesh>
        {/* Floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -(UF_H / 2 - 0.04), roomCZ]}>
          <planeGeometry args={[W * 0.92, roomD]} />
          <meshStandardMaterial color={floorC} roughness={0.55} />
        </mesh>
        {/* Ceiling — bright warm */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, UF_H / 2 - 0.05, roomCZ]}>
          <planeGeometry args={[W * 0.92, roomD]} />
          <meshStandardMaterial color={ceilC}
            emissive="#F0E060" emissiveIntensity={0.06} roughness={0.94} side={THREE.DoubleSide} />
        </mesh>
        {/* Side walls */}
        <mesh position={[-(W * 0.46), 0, roomCZ]}>
          <boxGeometry args={[0.14, UF_H - 0.06, roomD]} />
          <meshStandardMaterial color={wallC} roughness={0.82} emissive="#D8B060" emissiveIntensity={0.06} />
        </mesh>
        <mesh position={[ (W * 0.46), 0, roomCZ]}>
          <boxGeometry args={[0.14, UF_H - 0.06, roomD]} />
          <meshStandardMaterial color={wallC} roughness={0.82} emissive="#D8B060" emissiveIntensity={0.06} />
        </mesh>
        {/* Bedroom sofa/daybed */}
        <mesh position={[W * 0.06, -(UF_H / 2) + 0.34, roomCZ + roomD * 0.18]}>
          <boxGeometry args={[2.0, 0.62, 0.95]} />
          <meshStandardMaterial color={sofaC} roughness={0.80} />
        </mesh>
        {/* Desk */}
        <mesh position={[-W * 0.28, -(UF_H / 2) + 0.40, roomCZ + roomD * 0.15]}>
          <boxGeometry args={[1.4, 0.06, 0.75]} />
          <meshStandardMaterial color={tableC} roughness={0.40} />
        </mesh>
      </group>

    </group>
  );
}

/** Wing face — solid white stucco + horizontal window band + optional wood cladding accent */
function WingFaceWall({
  W, H, woodAccent = true, windowBand = true,
}: { W: number; H: number; woodAccent?: boolean; windowBand?: boolean }) {
  const wallColor  = "#F4F2EE";
  const woodDark   = "#7A4E22";
  const woodMid    = "#8B5A2B";
  const frameColor = "#1A1A1A";
  const winH  = H * 0.42;
  const winY  = H * 0.05;     // slightly above floor
  const winW  = W * 0.64;
  const woodW = W * 0.36;
  const woodX = W / 2 - woodW / 2;   // right-side accent panel
  return (
    <group>
      {/* Base white wall */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[W, H, WT]} />
        <meshStandardMaterial color={wallColor} roughness={0.72} metalness={0.01} />
      </mesh>
      {/* Wood cladding accent panel */}
      {woodAccent && (() => {
        const SLAT_W = 0.088; const SLAT_GAP = 0.018; const SLAT_T = 0.040;
        const step = SLAT_W + SLAT_GAP;
        const numSlats = Math.floor(woodW / step);
        const startX = woodX - woodW / 2 + SLAT_W / 2;
        return (
          <group position={[0, 0, WT / 2 + SLAT_T / 2]}>
            {Array.from({ length: numSlats }).map((_, i) => (
              <mesh key={i} position={[startX + i * step, 0, 0]} castShadow>
                <boxGeometry args={[SLAT_W, H - 0.04, SLAT_T]} />
                <meshStandardMaterial
                  color={i % 3 === 0 ? woodDark : i % 3 === 1 ? woodMid : "#96622F"}
                  roughness={0.38} metalness={0.0} envMapIntensity={0.55}
                />
              </mesh>
            ))}
          </group>
        );
      })()}
      {/* Horizontal window band */}
      {windowBand && (
        <group position={[-(W - winW) / 2 * 0.5, winY, WT / 2 + 0.008]}>
          {/* Frame */}
          <mesh castShadow>
            <boxGeometry args={[winW + 0.10, winH + 0.10, 0.065]} />
            <meshStandardMaterial color={frameColor} roughness={0.25} metalness={0.68} />
          </mesh>
          {/* Glass */}
          <mesh position={[0, 0, 0.038]}>
            <boxGeometry args={[winW, winH, 0.030]} />
            <meshStandardMaterial
              color="#D0EAF8" roughness={0.04} metalness={0.08}
              emissive="#C8A030" emissiveIntensity={0.22}
              transparent opacity={0.82} depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Vertical dividers */}
          {[-winW * 0.28, 0, winW * 0.28].map((dx, i) => (
            <mesh key={i} position={[dx, 0, 0.055]}>
              <boxGeometry args={[0.038, winH + 0.08, 0.022]} />
              <meshStandardMaterial color={frameColor} roughness={0.25} metalness={0.68} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/** Upper-floor glass balustrade — slim steel posts + frameless glass panels */
function GlassBalustrade({ W, side = "front" }: { W: number; side?: "front" | "side" }) {
  const postH   = 1.08;
  const postSpacing = 1.80;
  const numPosts = Math.max(2, Math.round(W / postSpacing));
  const actualSpacing = W / (numPosts - 1);
  const posts = Array.from({ length: numPosts }, (_, i) => -W / 2 + i * actualSpacing);
  return (
    <group>
      {/* Steel posts */}
      {posts.map((px, i) => (
        <mesh key={i} position={[px, postH / 2, 0]} castShadow>
          <boxGeometry args={[0.038, postH, 0.038]} />
          <meshStandardMaterial color="#C8C8D0" roughness={0.22} metalness={0.78} />
        </mesh>
      ))}
      {/* Frameless glass panel (one slab) */}
      <mesh position={[0, postH * 0.52, 0]}>
        <boxGeometry args={[W - 0.04, postH * 0.78, 0.012]} />
        <meshStandardMaterial color="#C8E8F8" roughness={0.02} metalness={0.10}
          transparent opacity={0.28} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      {/* Top rail */}
      <mesh position={[0, postH + 0.025, 0]} castShadow>
        <boxGeometry args={[W + 0.04, 0.048, 0.060]} />
        <meshStandardMaterial color="#D0D0D8" roughness={0.18} metalness={0.82} />
      </mesh>
    </group>
  );
}

/**
 * RichGlassVillaBuilding — reference-matched contemporary luxury villa.
 *
 * Object-by-object analysis of reference photo → procedural components:
 *
 *  ① Wide 2-story glass curtain wall main block (GlassCurtainWallFace × 4 faces)
 *  ② Massive 4 m front roof cantilever with wood soffit (WoodSoffit + ConcreteSlab)
 *  ③ Bright white 52 cm thick interfloor slab band projecting 55 cm forward (ConcreteSlab)
 *  ④ Glass balustrade on upper balcony projecting 1.8 m in front (GlassBalustrade)
 *  ⑤ Right-side single-storey step-down wing, wood-clad (WingFaceWall)
 *  ⑥ Slim round steel columns at glazing line (SteelColumn)
 *  ⑦ Stone plinth at grade (StoneCladding)
 *  ⑧ Dark anodized steel fascia on roof edges (FasciaBand)
 *
 * Plan layout — L+Z footprint (camera at –Z, looking north):
 *
 *  ┌─ L_ARM_W ─┬──────────── MAIN_W - L_ARM_W ───────────────┐  ← +Z rear
 *  │  L-ARM    │  (open — back wall only covers right portion) │
 *  │  (rear    │                                               │
 *  │  extn)    │                                               │
 *  ├───────────┴──────── MAIN BLOCK (2F glass) ───────────────┼── EXT_W ──┐
 *  │                                                           │  Z-WING   │
 *  └───────────────────────────────────────────────────────────┴───────────┘  ← –Z front
 *                         terrace (–Z, camera)
 */
/**
 * RichGlassVillaBuilding — floor-plan-driven luxury villa.
 *
 * Uses the ACTUAL W×D from useFootprint() — no fake extra bays.
 * Each exterior face is declared independently (world-space approach):
 *
 *  SOUTH face (−Z, front):
 *    GF = open covered loggia (no front wall, just columns)  ← reference photo
 *    UF = glass curtain wall
 *  NORTH face (+Z, back): solid concrete wall
 *  EAST  face (+X):       solid concrete wall
 *  WEST  face (−X):       GF concrete / UF wood cladding
 *
 *  2F can cover a different (smaller) footprint than 1F — controlled by
 *  UF_W and UF_D props (default = same as W, D).
 */
function RichGlassVillaBuilding({ W, D, settings }: {
  W: number; D: number; settings: ExteriorSettings;
}) {
  // ── Heights ─────────────────────────────────────────────────
  const GF_H    = 3.10;   // ground floor clear height
  const SLAB_T  = 0.50;   // interfloor slab thickness (white band)
  const UF_H    = 3.10;   // upper floor clear height
  const TOTAL_H = GF_H + SLAB_T + UF_H;

  // ── 2F footprint — typically same width, slightly less depth ─
  // (garage + rear utility rooms only on 1F in the reference plan)
  const UF_W    = W;              // full width on 2F
  const UF_D    = D * 0.72;       // ~72% depth — 2F doesn't cover rear (garage) zone
  const UF_ZOFF = (UF_D - D) / 2; // offset so 2F south face aligns with 1F south face

  // ── Face coordinates (building centered at world origin) ────
  // 1F box
  const zS1 = -D / 2;   // south face of GF
  const zN1 = +D / 2;   // north face of GF
  const xE  = +W / 2;   // east face
  const xW  = -W / 2;   // west face
  // 2F box (south face = same as GF, north face set back)
  const zS2 = zS1;                  // 2F south aligns with 1F south
  const zN2 = zS2 + UF_D;           // 2F north face (set back from 1F north)

  // ── Materials ────────────────────────────────────────────────
  const wallC  = "#F0EDE6";   // warm off-white concrete
  const slabC  = "#F6F3EE";   // bright white slab
  const woodC  = "#8B6340";   // warm walnut cladding

  // ── Slab ─────────────────────────────────────────────────────
  const SLAB_PF = 0.55;       // interfloor slab projects south beyond glass
  const SLAB_PS = 0.30;       // east/west side projection

  // ── Roof ─────────────────────────────────────────────────────
  const OV_FRONT = 2.20;      // large south cantilever
  const OV_SIDE  = 0.40;
  const OV_BACK  = 0.40;
  const ROOF_T   = 0.28;
  const roofW    = W + OV_SIDE * 2;
  const roofD    = D + OV_FRONT + OV_BACK;

  // ── Panels ───────────────────────────────────────────────────
  const frontPanels = Math.max(5, Math.round(W / 1.5));
  const sidePanels  = Math.max(3, Math.round(UF_D / 1.5));

  // ── Columns along south GF edge ─────────────────────────────
  const numCols = Math.max(4, Math.round(W / 3.0));
  const colXs   = Array.from({ length: numCols }, (_, i) =>
    xW + (W / (numCols - 1)) * i
  );

  return (
    <group>

      {/* ════════════════════════════════════════════════════
          GROUND PLANE / SLAB AT GRADE
          ════════════════════════════════════════════════ */}
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <boxGeometry args={[W + 0.20, 0.08, D + 0.20]} />
        <meshStandardMaterial color="#E0D8C8" roughness={0.88} />
      </mesh>

      {/* ════════════════════════════════════════════════════
          SOUTH FACE (−Z)
          GF = OPEN loggia (no wall — matches reference photo)
          UF = Glass curtain wall
          ════════════════════════════════════════════════ */}

      {/* GF south: slim 60 cm concrete base (threshold step only) */}
      <mesh position={[0, 0.30, zS1 + WT / 2]} castShadow receiveShadow>
        <boxGeometry args={[W, 0.60, WT]} />
        <meshStandardMaterial color={wallC} roughness={0.78} />
      </mesh>

      {/* UF south: GLASS curtain wall — the signature facade element */}
      <group position={[0, GF_H + SLAB_T + UF_H / 2, zS2 + WT / 2]}>
        <GlassCurtainWallFace W={UF_W} H={UF_H} panelCount={frontPanels} />
      </group>

      {/* ════════════════════════════════════════════════════
          NORTH FACE (+Z) — solid concrete back wall, both floors
          ════════════════════════════════════════════════ */}
      {/* GF north */}
      <mesh position={[0, GF_H / 2, zN1 - WT / 2]} castShadow receiveShadow>
        <boxGeometry args={[W, GF_H, WT]} />
        <meshStandardMaterial map={getConcreteTex()} color={wallC} roughness={0.74} />
      </mesh>
      {/* UF north (shorter depth) */}
      <mesh position={[0, GF_H + SLAB_T + UF_H / 2, zN2 - WT / 2]} castShadow receiveShadow>
        <boxGeometry args={[UF_W, UF_H, WT]} />
        <meshStandardMaterial map={getConcreteTex()} color={wallC} roughness={0.74} />
      </mesh>

      {/* ════════════════════════════════════════════════════
          EAST FACE (+X) — concrete both floors
          ════════════════════════════════════════════════ */}
      {/* GF east */}
      <mesh position={[xE - WT / 2, GF_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[WT, GF_H, D]} />
        <meshStandardMaterial map={getConcreteTex()} color={wallC} roughness={0.74} />
      </mesh>
      {/* UF east */}
      <mesh position={[xE - WT / 2, GF_H + SLAB_T + UF_H / 2, UF_ZOFF / 2]} castShadow receiveShadow>
        <boxGeometry args={[WT, UF_H, UF_D]} />
        <meshStandardMaterial map={getConcreteTex()} color={wallC} roughness={0.74} />
      </mesh>

      {/* ════════════════════════════════════════════════════
          WEST FACE (−X) — GF concrete / UF wood cladding
          (Left rear wood wing from reference photo)
          ════════════════════════════════════════════════ */}
      {/* GF west */}
      <mesh position={[xW + WT / 2, GF_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[WT, GF_H, D]} />
        <meshStandardMaterial map={getConcreteTex()} color={wallC} roughness={0.74} />
      </mesh>
      {/* UF west: horizontal wood plank cladding */}
      {(() => {
        const PLANK_H = 0.12;
        const PLANK_G = 0.018;
        const step    = PLANK_H + PLANK_G;
        const num     = Math.floor(UF_H / step);
        return Array.from({ length: num }, (_, i) => (
          <mesh key={i}
            position={[xW + WT / 2 + 0.008, GF_H + SLAB_T + i * step + PLANK_H / 2, UF_ZOFF / 2]}
            castShadow receiveShadow>
            <boxGeometry args={[0.016, PLANK_H, UF_D - 0.04]} />
            <meshStandardMaterial color={woodC} roughness={0.62} />
          </mesh>
        ));
      })()}
      {/* UF west backing (behind planks) */}
      <mesh position={[xW + WT / 2, GF_H + SLAB_T + UF_H / 2, UF_ZOFF / 2]} castShadow receiveShadow>
        <boxGeometry args={[WT, UF_H, UF_D]} />
        <meshStandardMaterial color="#7A5530" roughness={0.85} />
      </mesh>

      {/* ════════════════════════════════════════════════════
          INTERFLOOR SLAB — white band, projects south + sides
          ════════════════════════════════════════════════ */}
      <group position={[0, GF_H + SLAB_T / 2, -SLAB_PF / 2]}>
        <ConcreteSlab
          W={W + SLAB_PS * 2}
          D={D + SLAB_PF}
          T={SLAB_T}
          color={slabC}
          repeat={6}
        />
        {/* Dark shadow reveal line at slab underside */}
        <mesh position={[0, -SLAB_T / 2 + 0.010, 0]} receiveShadow>
          <boxGeometry args={[W + SLAB_PS * 2, 0.020, D + SLAB_PF]} />
          <meshStandardMaterial color="#1E1E1E" roughness={0.55} />
        </mesh>
      </group>

      {/* ════════════════════════════════════════════════════
          COLUMNS — slim steel, south GF edge, support slab
          ════════════════════════════════════════════════ */}
      {colXs.map((cx, i) => (
        <group key={i} position={[cx, 0, zS1 + 0.12]}>
          <SteelColumn H={GF_H + SLAB_T + 0.05} radius={0.062} />
        </group>
      ))}

      {/* ════════════════════════════════════════════════════
          INTERIOR — warm fill visible through UF glass
          ════════════════════════════════════════════════ */}
      <RichGlassInterior W={UF_W} D={UF_D} GF_H={GF_H} UF_H={UF_H} SLAB_T={SLAB_T} />
      {/* Interior lights — upper floor only (GF is open loggia).
          castShadow=true prevents light from bleeding through concrete walls.
          distance is clamped to stay inside the UF glass box.            */}
      <pointLight
        position={[0, GF_H + SLAB_T + UF_H * 0.65, UF_ZOFF / 2]}
        color="#FFF8F0" intensity={12} distance={UF_H * 1.6} decay={1.6}
        castShadow shadow-mapSize-width={512} shadow-mapSize-height={512}
        shadow-camera-near={0.1} shadow-camera-far={UF_H * 1.8}
      />
      <pointLight
        position={[UF_W * 0.28, GF_H + SLAB_T + UF_H * 0.65, UF_ZOFF / 2 + 0.4]}
        color="#FFF4E8" intensity={7} distance={UF_H * 1.1} decay={1.8}
        castShadow shadow-mapSize-width={256} shadow-mapSize-height={256}
      />
      <pointLight
        position={[-UF_W * 0.28, GF_H + SLAB_T + UF_H * 0.65, UF_ZOFF / 2 + 0.4]}
        color="#FFF4E8" intensity={7} distance={UF_H * 1.1} decay={1.8}
        castShadow shadow-mapSize-width={256} shadow-mapSize-height={256}
      />

      {/* ════════════════════════════════════════════════════
          ROOF — large flat slab, south cantilever, wood soffit
          ════════════════════════════════════════════════ */}
      <group position={[0, TOTAL_H + ROOF_T / 2, (OV_BACK - OV_FRONT) / 2]}>
        {/* White concrete slab */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[roofW, ROOF_T, roofD]} />
          <meshStandardMaterial color="#F3F1EB" roughness={0.72} metalness={0.01} />
        </mesh>
        {/* Dark membrane on top */}
        <mesh position={[0, ROOF_T / 2 + 0.010, 0]}>
          <boxGeometry args={[roofW - 0.04, 0.018, roofD - 0.04]} />
          <meshStandardMaterial color="#2A2A2C" roughness={0.92} />
        </mesh>
        {/* Wood soffit on underside — visible from terrace/pool */}
        <group position={[0, -ROOF_T / 2 - 0.042 / 2, 0]}>
          <WoodSoffit W={roofW - 0.06} D={roofD - 0.06} T={0.042} />
        </group>
        {/* White fascia band */}
        <FasciaBand W={roofW} D={roofD} H={0.26} />
      </group>

      {/* ════════════════════════════════════════════════════
          FRONT TERRACE — travertine stone at grade
          ════════════════════════════════════════════════ */}
      <mesh position={[0, 0.06, zS1 - 1.20]} receiveShadow>
        <boxGeometry args={[W + 0.60, 0.12, 2.40]} />
        <meshStandardMaterial color="#E8DFC8" roughness={0.74} />
      </mesh>

    </group>
  );
}

// ─── House body ──────────────────────────────────────────────
function HouseBody({ W, D, settings, insideBuilding = false, wallXray = false, onEnterRoom }: {
  W: number; D: number; settings: ExteriorSettings;
  insideBuilding?: boolean; wallXray?: boolean;
  onEnterRoom?: (room: import("@/lib/types").RoomType, floorIndex: number, worldPos: [number, number, number]) => void;
}) {
  // ── Rich Glass Villa shortcut ──────────────────────────────────────────
  // When buildingType is set, bypass the generic floor-shell system entirely
  // and render the specialized multi-volume building component.
  const buildingTypeHB = (settings as ExteriorSettings & { buildingType?: string }).buildingType;
  if (buildingTypeHB === "rich-glass-villa") {
    return <RichGlassVillaBuilding W={W} D={D} settings={settings} />;
  }
  if (buildingTypeHB === "floor-plan-driven") {
    return <FloorPlanBuilding insideBuilding={insideBuilding} wallXray={wallXray} onEnterRoom={onEnterRoom} />;
  }

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

  // Footprint volumes — composite boxes for L/U/T shapes
  const footprintVolumes = useFootprintVolumes(W, D, settings);

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

      {/* Pilotis support columns — InstancedMesh，N 根柱子 1 个 draw call */}
      {pilotisH > 0 && (
        <InstancedBoxes
          boxArgs={[0.30, pilotisH, 0.30]}
          positions={columnPositions.map(([cx, cz]) => [cx, pilotisH / 2, cz])}
          color="#C8C5BE" roughness={0.85}
          castShadow receiveShadow
        />
      )}
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
          footprintVolumes.flatMap((vol, vi) =>
            Array.from({ length: floors }).map((_, fi) => (
              <group key={`${vi}-${fi}`} position={[vol.x, 0, vol.z]}>
                <FloorShell floorIndex={fi} W={vol.W} D={vol.D} settings={settings} totalFloors={floors} />
              </group>
            ))
          )
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
          {/* Floor slabs — one per storey.
              楼梯井：stair 房间在第二层及以上不渲染楼板，让楼梯从下层
              透过来。地面层照常画（楼梯基座的地面）。多层别墅这样
              处理后，上下楼时视线不会撞到"楼板挡住的楼梯"。 */}
          {Array.from({ length: floors }).map((_, f) => {
            if (room === "stair" && f > 0) return null;   // 上层楼板挖洞
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
      fogColor: "#D89868", fogNear: 42, fogFar: 170,  // warm amber haze for dawn
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
      fogColor: "#C87840", fogNear: 55, fogFar: 220,  // orange dusk haze
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
    fogColor: "#C0D4E8", fogNear: 55, fogFar: 210,  // clear daytime air — crisp distant view
    exposure: 1.02 + elev * 0.08,
    hdr: "/hdr/lebombo_1k.hdr",
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
function VillaYard({ W, D, overrideW, xOff = 0 }: {
  W: number; D: number;
  overrideW?: number;   // for rich-glass-villa — use expanded visual width
  xOff?: number;        // x-offset to centre pool under main block
}) {
  const effW = overrideW ?? W;

  // ── Pool in FRONT of building (−Z, between camera and glass facade) ──────
  // Reference photo: pool is between viewer and building, terrace closest to building.
  const pw       = Math.min(effW * 0.62, 10.0);  // pool width ~62% of building — matches reference photo
  const pd       = Math.max(pw * 1.65, 14.5);   // pool length toward camera
  const gap      = 0.55;                         // gap between building front glass and terrace
  const deckSide = 2.4;                          // travertine deck border around pool
  const terrD    = 1.8;                          // stone terrace depth between building and pool

  // All Z values NEGATIVE — pool is south of building (toward camera)
  // Building front glass is at z = -(D/2). Terrace starts just beyond that.
  const terrFrontZ = -(D / 2 + gap);             // terrace front edge (south face, touching building)
  const terrBackZ  = terrFrontZ - terrD;         // terrace far edge (toward camera)
  const poolBuildZ = terrBackZ - 0.20;           // pool north edge (closest to building)
  const pz         = poolBuildZ - pd / 2;        // pool center Z
  const poolFarZ   = pz - pd / 2;               // pool south edge (closest to camera)
  const loungerZ   = poolFarZ - deckSide * 0.5; // loungers south of pool

  return (
    <group position={[xOff, 0, 0]}>

      {/* ── Travertine terrace — stone patio between building glass and pool ── */}
      {(() => {
        const TW = 0.60, TD = 0.90, GAP = 0.012;
        const deckW = effW + 1.2;
        const cols  = Math.ceil(deckW / (TW + GAP)) + 1;
        const rows  = Math.ceil(terrD  / (TD + GAP)) + 1;
        const x0    = -(cols * (TW + GAP)) / 2 + TW / 2;
        // startZ: northernmost tile centre (closest to building, most negative Z goes further out)
        const z0    = terrFrontZ - TD / 2;
        return Array.from({ length: cols }).flatMap((_, c) =>
          Array.from({ length: rows }).map((_, r) => {
            const bright = ((c + r) % 2 === 0) ? "#EAE0CC" : "#EFE5D4";
            return (
              <mesh key={`tr-${c}-${r}`}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[x0 + c * (TW + GAP), -0.490, z0 - r * (TD + GAP)]}
                receiveShadow>
                <planeGeometry args={[TW, TD]} />
                <meshStandardMaterial color={bright} roughness={0.80} metalness={0.02} />
              </mesh>
            );
          })
        );
      })()}

      {/* ── Entry steps — 2 risers stepping from terrace down to pool deck ── */}
      {[0, 1].map(s => (
        <mesh key={`step-${s}`}
          position={[0, -s * 0.12, terrBackZ - 0.20 - s * 0.38]}
          castShadow receiveShadow>
          <boxGeometry args={[effW * 0.55, 0.13, 0.38]} />
          <meshStandardMaterial color="#D8CEBC" roughness={0.70} metalness={0.04} />
        </mesh>
      ))}

      {/* ── Pool surround deck — large travertine platform around the pool ── */}
      {(() => {
        const TW = 0.60, TD = 0.90, GAP = 0.012;
        const dW = pw + deckSide * 2 + 0.4;
        const dD = pd + deckSide * 2;
        const cols  = Math.ceil(dW / (TW + GAP)) + 1;
        const rows  = Math.ceil(dD / (TD + GAP)) + 1;
        const x0    = -(cols * (TW + GAP)) / 2 + TW / 2;
        const z0    = poolBuildZ + TD / 2;  // start just north of pool
        return Array.from({ length: cols }).flatMap((_, c) =>
          Array.from({ length: rows }).map((_, r) => {
            const bright = ((c + r) % 2 === 0) ? "#EDE0C6" : "#F3E8D2";
            return (
              <mesh key={`pd-${c}-${r}`}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[x0 + c * (TW + GAP), -0.488, z0 - r * (TD + GAP)]}
                receiveShadow>
                <planeGeometry args={[TW, TD]} />
                <meshStandardMaterial color={bright} roughness={0.78} metalness={0.02} />
              </mesh>
            );
          })
        );
      })()}

      {/* ── Pool shell — concrete basin ── */}
      <mesh position={[0, -0.30, pz]} receiveShadow castShadow>
        <boxGeometry args={[pw + 0.38, 0.60, pd + 0.38]} />
        <meshStandardMaterial color="#D4CABC" roughness={0.70} />
      </mesh>

      {/* ── Pool water — animated ripple reflector surface ── */}
      {/* AnimatedWater provides its own turquoise bottom + animated reflective surface */}
      <group position={[0, 0.08, pz]}>
        <AnimatedWater w={pw - 0.06} d={pd - 0.06} />
      </group>
      {/* ── Pool underwater glow — turquoise point lights simulate submerged LEDs ── */}
      <pointLight position={[0,            -0.10, pz]} intensity={7.0} distance={pw * 1.8 + 5} decay={1.6} color="#20C8DC" />
      <pointLight position={[pw * 0.35,    -0.10, pz + pd * 0.28]} intensity={4.5} distance={pw * 1.4} decay={1.8} color="#18B4CC" />
      <pointLight position={[-pw * 0.35,   -0.10, pz - pd * 0.28]} intensity={4.5} distance={pw * 1.4} decay={1.8} color="#18B4CC" />

      {/* ── Pool coping — cream stone edge strips on all 4 sides ── */}
      {/* ── Pool coping — 3 straight sides; south side handled by rounded cap ── */}
      {([[-1,0],[1,0],[0,1]] as [number,number][]).map(([sx, sz], i) => {
        const horiz = sz === 0;
        const len   = horiz ? pd + 0.52 : pw + 0.52;
        return (
          <mesh key={i}
            position={[sx * (pw/2 + 0.24), 0.05, pz + sz * (pd/2 + 0.24)]}
            castShadow receiveShadow>
            <boxGeometry args={horiz ? [0.38, 0.06, len] : [len, 0.06, 0.38]} />
            <meshStandardMaterial color="#F0E8D8" roughness={0.60} />
          </mesh>
        );
      })}

      {/* ── Smooth rounded south cap — half-cylinder, camera-near end ── */}
      {(() => {
        const r  = pw / 2;
        const capZ = poolFarZ;  // southernmost Z = pool south end
        return (
          <group position={[0, 0, capZ]}>
            {/* Pool interior half-cylinder (turquoise plaster) */}
            <mesh rotation={[0, Math.PI, 0]}>
              <cylinderGeometry args={[r, r, 0.52, 40, 1, false, 0, Math.PI]} />
              <meshStandardMaterial color="#0A6470" roughness={0.12} metalness={0.0} />
            </mesh>
            {/* Water surface half-disc */}
            <mesh position={[0, 0.09, 0]} rotation={[0, Math.PI, 0]}>
              <cylinderGeometry args={[r - 0.04, r - 0.04, 0.04, 40, 1, false, 0, Math.PI]} />
              <meshStandardMaterial color="#5DC8E0" roughness={0.04} metalness={0.0} envMapIntensity={6.0}
                emissive="#1A8AA0" emissiveIntensity={0.12} />
            </mesh>
            {/* Coping arc (cream stone) */}
            <mesh position={[0, 0.06, 0]} rotation={[0, Math.PI, 0]}>
              <cylinderGeometry args={[r + 0.24, r + 0.24, 0.06, 40, 1, false, 0, Math.PI]} />
              <meshStandardMaterial color="#F0E8D8" roughness={0.60} />
            </mesh>
          </group>
        );
      })()}

      {/* ── Modern steel pergola — shades the terrace between building and pool ── */}
      {(() => {
        const pgW   = effW * 0.72;   // pergola width (east-west)
        const pgD   = terrD * 0.90;  // pergola depth (north-south)
        const pgH   = 2.65;          // height of top beams
        const pgCX  = 0;
        const pgCZ  = (terrFrontZ + terrBackZ) / 2; // centred over terrace
        const POST  = 0.085;         // post section
        const BEAM  = 0.090;         // main beam height
        const PURLIN = 0.055;        // purlin height
        const purlinCount = Math.max(5, Math.round(pgW / 0.65));
        const steelMat = { color: "#1E2028" as const, roughness: 0.14, metalness: 0.92, envMapIntensity: 2.0 as const };
        return (
          <group position={[pgCX, 0, pgCZ]}>
            {/* 4 corner posts */}
            {([-pgW/2+POST/2, pgW/2-POST/2] as number[]).flatMap(px2 =>
              ([-pgD/2+POST/2, pgD/2-POST/2] as number[]).map((pz2, i) => (
                <mesh key={`pp-${px2}-${i}`} position={[px2, pgH / 2, pz2]} castShadow>
                  <boxGeometry args={[POST, pgH, POST]} />
                  <meshStandardMaterial {...steelMat} />
                </mesh>
              ))
            )}
            {/* 2 main longitudinal beams (east-west) */}
            {([-pgD/2, pgD/2] as number[]).map((bz2, i) => (
              <mesh key={`pb-${i}`} position={[0, pgH, bz2]} castShadow>
                <boxGeometry args={[pgW, BEAM, 0.050]} />
                <meshStandardMaterial {...steelMat} />
              </mesh>
            ))}
            {/* Purlins — parallel slats running north-south */}
            {Array.from({ length: purlinCount }, (_, pi) => {
              const px2 = -pgW/2 + (pi + 0.5) * (pgW / purlinCount);
              return (
                <mesh key={`pur-${pi}`} position={[px2, pgH + PURLIN / 2, 0]} castShadow>
                  <boxGeometry args={[0.040, PURLIN, pgD + 0.06]} />
                  <meshStandardMaterial {...steelMat} />
                </mesh>
              );
            })}
          </group>
        );
      })()}

      {/* ── Sun loungers — 5 chairs on the BUILDING SIDE of pool (between pool + terrace) ── */}
      {/* Reference: chairs face toward pool, backs toward building — terrace zone */}
      {([-0.60, -0.30, 0, 0.30, 0.60] as number[]).map((xFrac, i) => {
        const lx = xFrac * (pw - 1.0);
        const lz = poolBuildZ + deckSide * 0.48;   // between pool north edge and terrace
        // Alternate towel colors for visual variety
        const towelColors = ["#1E6CB5", "#C84040", "#3A9650", "#D49030", "#7A3090"];
        const towelColor = towelColors[i % towelColors.length];
        return (
          <group key={i} position={[lx, 0, lz]} rotation={[0, Math.PI, 0]}>
            {/* Frame / mattress base */}
            <mesh position={[0, 0.19, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.62, 0.06, 1.85]} />
              <meshStandardMaterial color="#BEB080" roughness={0.75} metalness={0.10} />
            </mesh>
            {/* Cushion */}
            <mesh position={[0, 0.26, 0]}>
              <boxGeometry args={[0.54, 0.09, 1.68]} />
              <meshStandardMaterial color="#F6F0E4" roughness={0.88} metalness={0.0} />
            </mesh>
            {/* Reclined head section */}
            <mesh position={[0, 0.36, 0.55]} rotation={[-0.28, 0, 0]}>
              <boxGeometry args={[0.52, 0.07, 0.65]} />
              <meshStandardMaterial color="#F2EBD8" roughness={0.88} />
            </mesh>
            {/* 4 slim aluminium legs */}
            {([-0.26, 0.26] as number[]).flatMap(lx2 =>
              ([-0.78, 0.78] as number[]).map((lz2, li) => (
                <mesh key={`${lx2}-${lz2}`} position={[lx2, 0.09, lz2]} castShadow>
                  <boxGeometry args={[0.040, 0.18, 0.040]} />
                  <meshStandardMaterial color="#B0B0B8" roughness={0.25} metalness={0.85} />
                </mesh>
              ))
            )}
            {/* Rolled towel at foot of lounger — colorful hotel-style accent */}
            <mesh position={[0, 0.325, -0.72]}>
              <cylinderGeometry args={[0.088, 0.088, 0.46, 10]} />
              <meshStandardMaterial color={towelColor} roughness={0.90} />
            </mesh>
            {/* Towel fold end cap */}
            <mesh position={[0, 0.325, -0.72]} rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.088, 10]} />
              <meshStandardMaterial color={towelColor} roughness={0.90} />
            </mesh>
          </group>
        );
      })}

      {/* ── Potted palm — accent planting flanking the spa ── */}
      <group position={[pw * 0.50 + 3.8, 0, (poolBuildZ + terrBackZ) / 2]}>
        {/* Large terracotta planter */}
        <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.30, 0.22, 0.56, 12]} />
          <meshStandardMaterial color="#C06840" roughness={0.78} metalness={0.02} />
        </mesh>
        {/* Soil top */}
        <mesh position={[0, 0.57, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[0.29, 12]} />
          <meshStandardMaterial color="#4A321C" roughness={0.98} />
        </mesh>
        {/* Palm trunk */}
        <mesh position={[0, 1.50, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.13, 1.88, 7]} />
          <meshStandardMaterial color="#9A7040" roughness={0.88} />
        </mesh>
        {/* 6 palm fronds radiating from top */}
        {[0, 60, 120, 180, 240, 300].map((deg, pi) => {
          const rad = (deg * Math.PI) / 180;
          return (
            <mesh key={pi}
              position={[Math.cos(rad) * 0.60, 2.60, Math.sin(rad) * 0.60]}
              rotation={[0.50, rad, 0]}
              castShadow>
              <boxGeometry args={[1.40, 0.040, 0.28]} />
              <meshStandardMaterial color="#2A6E34" roughness={0.88} />
            </mesh>
          );
        })}
      </group>

      {/* ── Floating pool ring — colorful inflatable, adds life to the pool ── */}
      <group position={[pw * 0.25, 0.10, pz + pd * 0.20]}>
        <mesh rotation={[-Math.PI / 2, 0, 0.4]}>
          <torusGeometry args={[0.55, 0.13, 10, 24]} />
          <meshStandardMaterial color="#FF6040" roughness={0.70} metalness={0.0} />
        </mesh>
        {/* Shadow under ring on water */}
        <pointLight position={[0, -0.15, 0]} intensity={0.6} distance={1.5} decay={2} color="#40B8D0" />
      </group>

      {/* ── Raised spa / water feature — right side of terrace, between building and pool ── */}
      <group position={[pw * 0.50 + 1.8, 0, (poolBuildZ + terrBackZ) / 2]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.2, 0.55, 2.2]} />
          <meshStandardMaterial map={getStoneTex()} color="#D8D0C0" roughness={0.65} />
        </mesh>
        <mesh position={[0, 0.30, 0]}>
          <boxGeometry args={[1.85, 0.08, 1.85]} />
          <meshPhysicalMaterial color="#50C8E0" transmission={0.60} roughness={0.02} ior={1.33} thickness={0.5} envMapIntensity={6.0} />
        </mesh>
        {/* Spa underwater LED glow */}
        <pointLight position={[0, 0.10, 0]} intensity={4.5} distance={5.5} decay={1.8} color="#20C0DC" />
      </group>

      {/* ── Side tables between loungers (alternating) — polished concrete ── */}
      {([0, 2] as number[]).map(i => {
        const lx = (i - 1) * (pw - 1.0) * 0.30;  // every 2 loungers
        const lz = poolBuildZ + deckSide * 0.48;
        return (
          <group key={`tbl-${i}`} position={[lx, 0, lz]}>
            <mesh position={[0, 0.40, 0]} castShadow>
              <cylinderGeometry args={[0.24, 0.22, 0.04, 12]} />
              <meshStandardMaterial color="#E0DCD4" roughness={0.60} metalness={0.06} />
            </mesh>
            <mesh position={[0, 0.20, 0]} castShadow>
              <cylinderGeometry args={[0.03, 0.03, 0.40, 8]} />
              <meshStandardMaterial color="#B0B0B8" roughness={0.18} metalness={0.90} />
            </mesh>
          </group>
        );
      })}

      {/* ── Terrace fire bowl — accent feature, warm evening focal point ── */}
      <group position={[-pw * 0.40, 0, terrBackZ + deckSide * 0.55]}>
        {/* Pedestal column */}
        <mesh position={[0, 0.28, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.06, 0.55, 8]} />
          <meshStandardMaterial color="#3A3840" roughness={0.28} metalness={0.82} envMapIntensity={1.8} />
        </mesh>
        {/* Bowl (travertine dish) */}
        <mesh position={[0, 0.60, 0]} castShadow>
          <cylinderGeometry args={[0.34, 0.22, 0.14, 14]} />
          <meshStandardMaterial color="#D4CCBA" roughness={0.68} />
        </mesh>
        {/* Fire / embers glow */}
        <mesh position={[0, 0.70, 0]}>
          <sphereGeometry args={[0.14, 10, 8]} />
          <meshStandardMaterial color="#FF9030" emissive="#FF5800" emissiveIntensity={3.5} roughness={0.9} />
        </mesh>
        {/* Warm fire point light — orange glow on surroundings */}
        <pointLight position={[0, 0.82, 0]} intensity={6.5} distance={10} decay={2.0} color="#FF8020" />
      </group>

      {/* ── Low terrace hedge border — formal clipped hedge along pool edge ── */}
      <mesh position={[0, 0.20, terrBackZ - 0.30]} castShadow receiveShadow>
        <boxGeometry args={[effW * 0.55, 0.40, 0.35]} />
        <meshStandardMaterial color="#2A5820" roughness={0.94} />
      </mesh>

      {/* ── Formal boxwood hedges — long sides of pool (east + west), classic garden framing ── */}
      {([-1, 1] as const).map((side) => {
        const hx = side * (pw / 2 + deckSide * 0.55);
        return (
          <group key={side} position={[hx, 0, pz]}>
            {/* Clipped box hedge strip */}
            <mesh castShadow receiveShadow>
              <boxGeometry args={[0.38, 0.65, pd + 0.30]} />
              <meshStandardMaterial color="#2E6428" roughness={0.96} />
            </mesh>
            {/* Hedge top — slightly lighter for clipped flat-top effect */}
            <mesh position={[0, 0.34, 0]} receiveShadow>
              <boxGeometry args={[0.42, 0.05, pd + 0.32]} />
              <meshStandardMaterial color="#367230" roughness={0.90} />
            </mesh>
          </group>
        );
      })}

      {/* ── Pool wet bar — swim-up counter along east pool edge ── */}
      {(() => {
        const barX  = pw / 2 - 0.60;  // east side, inside pool coping
        const barZ  = pz + pd * 0.28; // north third of pool
        const barW  = 0.50;            // counter depth (east-west)
        const barL  = Math.min(pw * 0.48, 3.8); // counter length
        const barH  = 0.78;            // bar surface height above pool bottom
        const ctrColor = "#D8D4C8";
        const seatCount = 4;
        return (
          <group position={[barX, -0.25, barZ]}>
            {/* Bar counter slab — travertine top */}
            <mesh position={[barW / 2, barH, 0]} castShadow>
              <boxGeometry args={[barW + 0.08, 0.08, barL]} />
              <meshStandardMaterial color={ctrColor} roughness={0.60} metalness={0.04} envMapIntensity={0.8} />
            </mesh>
            {/* Counter body */}
            <mesh position={[barW / 2, barH / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[barW, barH, barL]} />
              <meshStandardMaterial color="#C8C4B8" roughness={0.78} />
            </mesh>
            {/* Submerged bar stools — concrete discs at water level */}
            {Array.from({ length: seatCount }, (_, si) => {
              const sz = -barL / 2 + (si + 0.5) * (barL / seatCount);
              return (
                <group key={si} position={[-0.55, 0.52, sz]}>
                  {/* Stool seat */}
                  <mesh castShadow>
                    <cylinderGeometry args={[0.18, 0.18, 0.04, 12]} />
                    <meshStandardMaterial color="#D0CCBC" roughness={0.68} />
                  </mesh>
                  {/* Stool pedestal */}
                  <mesh position={[0, -0.24, 0]} castShadow>
                    <cylinderGeometry args={[0.04, 0.06, 0.48, 8]} />
                    <meshStandardMaterial color="#B8B4AC" roughness={0.55} metalness={0.22} />
                  </mesh>
                </group>
              );
            })}
            {/* Under-counter LED bar light strip */}
            <mesh position={[barW / 2 + 0.002, barH - 0.05, 0]}>
              <boxGeometry args={[0.012, 0.018, barL * 0.88]} />
              <meshStandardMaterial color="#FFF6DC" emissive="#FFE880" emissiveIntensity={2.5} />
            </mesh>
            <pointLight position={[barW / 2 - 0.05, barH - 0.12, 0]} intensity={3.0} distance={5.0} decay={2.0} color="#FFE090" />
          </group>
        );
      })()}

      {/* ── Recessed deck step lights — warm amber strips along pool coping ── */}
      {Array.from({ length: 5 }, (_, li) => {
        const lz = pz - pd * 0.40 + li * (pd * 0.80 / 4);
        return (
          <group key={li}>
            {/* West coping light */}
            <mesh position={[-pw / 2 - 0.18, 0.03, lz]}>
              <boxGeometry args={[0.06, 0.018, 0.18]} />
              <meshStandardMaterial color="#FFE8B0" emissive="#FFD860" emissiveIntensity={1.8} />
            </mesh>
            {/* East coping light */}
            <mesh position={[pw / 2 + 0.18, 0.03, lz]}>
              <boxGeometry args={[0.06, 0.018, 0.18]} />
              <meshStandardMaterial color="#FFE8B0" emissive="#FFD860" emissiveIntensity={1.8} />
            </mesh>
          </group>
        );
      })}

    </group>
  );
}

// ─── Inside-building camera animator ───────────────────────
/** When `active`, smoothly lerps camera + OrbitControls target inside the building. */
/** Compact 2D AABB used for both room footprints and movement clamping.
 *  All values in metres, world-space. */
type AABB = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Virtual joystick (DOM widget, not inside Canvas). Outputs normalized
 *  axis values in [-1, 1] on each axis (X = strafe right, Z = forward
 *  push so +Z = up on screen = forward in WASD-equivalent terms).
 *  Works with both touch and mouse drag. */
function TouchJoystick({ onChange }: { onChange: (axisX: number, axisZ: number) => void }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const activeRef = useRef<number | null>(null);
  const radius = 48;     // base radius px
  const knobR = 22;
  const onDown = (e: React.PointerEvent) => {
    activeRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e);
  };
  const onMove = (e: React.PointerEvent) => {
    if (activeRef.current !== e.pointerId) return;
    update(e);
  };
  const onUp = (e: React.PointerEvent) => {
    if (activeRef.current !== e.pointerId) return;
    activeRef.current = null;
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  };
  const update = (e: React.PointerEvent) => {
    const rect = baseRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const r = Math.hypot(dx, dy);
    if (r > radius) { dx *= radius / r; dy *= radius / r; }
    setKnob({ x: dx, y: dy });
    onChange(dx / radius, -dy / radius);  // y flipped: screen-up = forward
  };
  return (
    <div
      ref={baseRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="absolute bottom-32 left-6 z-20 select-none"
      style={{
        width: radius * 2, height: radius * 2,
        borderRadius: "50%",
        background: "rgba(0,0,0,0.32)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(255,255,255,0.18)",
        touchAction: "none",
      }}
    >
      {/* Knob */}
      <div style={{
        position: "absolute",
        left: radius - knobR + knob.x,
        top: radius - knobR + knob.y,
        width: knobR * 2,
        height: knobR * 2,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.55)",
        border: "1px solid rgba(255,255,255,0.5)",
        pointerEvents: "none",
        transition: activeRef.current === null ? "all 0.18s" : "none",
      }} />
    </div>
  );
}

/** First-person walkthrough controller. Mounts inside <Canvas>:
 *  - WASD / arrow keys move camera at ~3 m/s walking speed (Shift = run).
 *  - Drag-to-look: pointerdown + drag rotates the camera (no pointer-lock,
 *    works in iframes / mobile). Right-click or two-finger drag avoids
 *    interfering with the WASD listener.
 *  - Floor-snap: raycast straight down each frame, sets camera.y to
 *    floor.y + 1.6m. Handles stairs and multi-storey houses implicitly —
 *    walk onto stairs and the camera rides up.
 *  - Wall collision: per-frame sweep test against room bbox edges; if
 *    movement would cross a wall, slide along it instead.
 *  - Mobile joystick: an external state can inject {axisX,axisZ}.
 *  - When `spawnPos` changes, teleports the camera there. */
function WalkthroughController({
  active, spawnPos, bbox, onExit, walls, joystick, noClip,
}: {
  active: boolean;
  spawnPos: [number, number, number] | null;
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
  onExit: () => void;
  /** Room footprints in world coords. Movement is blocked by any of these
   *  rect's perimeter — when crossed, we slide. */
  walls: AABB[];
  /** Live touch joystick output, -1..1 on each axis. Forward = -axisZ. */
  joystick: { axisX: number; axisZ: number };
  /** When true, internal wall collision is disabled (still clamps to
   *  outer bbox so user can't fly outside the property). "Ghost mode". */
  noClip: boolean;
}) {
  const { camera, scene } = useThree();
  const keysRef = useRef<Record<string, boolean>>({});
  const spawnedRef = useRef<string | null>(null);
  /** Y of the floor surface the player last stood on (world space).
   *  Updated by the downward raycast; used as fallback when mid-air
   *  (e.g. between stair steps or stepping off the top landing). */
  const floorYRef = useRef(0);
  // Yaw/pitch tracked separately for drag-look (more reliable than mutating
  // camera.rotation directly).
  const yawRef   = useRef(0);
  const pitchRef = useRef(0);
  const dragRef  = useRef<{ x: number; y: number } | null>(null);

  // Teleport on spawnPos change
  useEffect(() => {
    if (!active || !spawnPos) return;
    const key = spawnPos.join(",");
    if (spawnedRef.current === key) return;
    spawnedRef.current = key;
    // Push near clip out to avoid black jagged artifacts from near geometry.
    const cam2 = camera as THREE.PerspectiveCamera;
    if (cam2.isPerspectiveCamera) { cam2.near = 0.3; cam2.updateProjectionMatrix(); }
    camera.position.set(spawnPos[0], spawnPos[1], spawnPos[2]);
    // Initialise floor tracker to spawn floor (eye height − 1.6 m)
    floorYRef.current = spawnPos[1] - 1.6;
    yawRef.current = 0;
    pitchRef.current = 0;
    camera.lookAt(spawnPos[0], spawnPos[1] - 0.1, spawnPos[2] + 1);
  }, [active, spawnPos, camera]);
  useEffect(() => {
    if (!active) {
      spawnedRef.current = null;
      // Restore near clip and FOV when exiting walkthrough.
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera) { cam.fov = 50; cam.near = 0.1; cam.updateProjectionMatrix(); }
    }
  }, [active, camera]);

  // Keyboard + drag-look + ESC listener
  useEffect(() => {
    if (!active) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onExit(); return; }
      keysRef.current[e.key.toLowerCase()] = true;
    };
    const onUp = (e: KeyboardEvent) => { keysRef.current[e.key.toLowerCase()] = false; };
    const onPDown = (e: PointerEvent) => {
      // Only initiate drag on left-click on canvas
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target?.tagName === "CANVAS") {
        dragRef.current = { x: e.clientX, y: e.clientY };
        target.setPointerCapture?.(e.pointerId);
      }
    };
    const onPMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      yawRef.current   -= dx * 0.0025;
      pitchRef.current -= dy * 0.0025;
      pitchRef.current = Math.max(-Math.PI / 2.6, Math.min(Math.PI / 2.6, pitchRef.current));
      dragRef.current = { x: e.clientX, y: e.clientY };
    };
    const onPUp = () => { dragRef.current = null; };
    // Wheel-zoom: changes camera FOV (narrower = zoom in, wider = zoom out).
    // FOV-based zoom is more natural than moving the camera forward (which
    // would clip through walls). Clamped 25°–80°.
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      if (target?.tagName !== "CANVAS") return;
      e.preventDefault();
      const cam = camera as THREE.PerspectiveCamera;
      const cur = cam.fov ?? 50;
      const next = Math.max(25, Math.min(80, cur + (e.deltaY > 0 ? 3 : -3)));
      if (next !== cur) {
        cam.fov = next;
        cam.updateProjectionMatrix();
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("pointerdown", onPDown);
    window.addEventListener("pointermove", onPMove);
    window.addEventListener("pointerup", onPUp);
    window.addEventListener("pointercancel", onPUp);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("pointerdown", onPDown);
      window.removeEventListener("pointermove", onPMove);
      window.removeEventListener("pointerup", onPUp);
      window.removeEventListener("pointercancel", onPUp);
      window.removeEventListener("wheel", onWheel);
      keysRef.current = {};
      dragRef.current = null;
    };
  }, [active, onExit, camera]);

  const fwd = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const downV = useMemo(() => new THREE.Vector3(0, -1, 0), []);

  /** Returns true if the segment (x1,z1)→(x2,z2) crosses any wall edge
   *  (perimeter of an AABB). Movement that crosses → blocked. Allow if
   *  user is moving INTO a room (both endpoints inside the same rect)
   *  or staying outside all rects. */
  const blocksMovement = (x1: number, z1: number, x2: number, z2: number): boolean => {
    // If either endpoint is inside a room AND the other isn't in the SAME
    // room (i.e. they're in different rooms with a wall between, or one is
    // outside any room), then the segment crosses a wall.
    let curRoom = -1, newRoom = -1;
    for (let i = 0; i < walls.length; i++) {
      const r = walls[i];
      if (x1 >= r.minX && x1 <= r.maxX && z1 >= r.minZ && z1 <= r.maxZ) curRoom = i;
      if (x2 >= r.minX && x2 <= r.maxX && z2 >= r.minZ && z2 <= r.maxZ) newRoom = i;
    }
    if (curRoom === -1 && newRoom === -1) return false;  // both in hallway — allow
    if (curRoom === newRoom)              return false;  // same room — allow
    return true;                                          // crossed wall
  };

  useFrame((_, delta) => {
    if (!active) return;

    // ── 1. Compose movement input (keys + joystick) ──
    const keys = keysRef.current;
    let dz = 0, dx = 0;
    if (keys.w || keys.arrowup)    dz += 1;
    if (keys.s || keys.arrowdown)  dz -= 1;
    if (keys.a || keys.arrowleft)  dx -= 1;
    if (keys.d || keys.arrowright) dx += 1;
    // Joystick (-1..1 on each axis). -axisZ because forward = stick up = negative Y in screen space.
    dx += joystick.axisX;
    dz += -joystick.axisZ;

    // ── 2. Apply yaw/pitch to camera rotation ──
    const yaw = yawRef.current, pitch = pitchRef.current;
    camera.rotation.order = "YXZ";
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    camera.rotation.z = 0;

    if (dx === 0 && dz === 0) {
      // Still floor-snap so y stays right even without movement
      raycastFloor(delta);
      return;
    }
    const magnitude = Math.min(1, Math.hypot(dx, dz));
    const speed = (keys.shift ? 6 : 3) * delta * magnitude;
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));    // camera forward in XZ
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const mvX = fwd.x * dz / Math.hypot(dx, dz) * speed + right.x * dx / Math.hypot(dx, dz) * speed;
    const mvZ = fwd.z * dz / Math.hypot(dx, dz) * speed + right.z * dx / Math.hypot(dx, dz) * speed;

    // ── 3. Wall collision: try full move, then X-only, then Z-only, else block ──
    const cx = camera.position.x, cz = camera.position.z;
    let nx = cx + mvX, nz = cz + mvZ;
    const m = 0.25;
    nx = Math.min(bbox.maxX - m, Math.max(bbox.minX + m, nx));
    nz = Math.min(bbox.maxZ - m, Math.max(bbox.minZ + m, nz));
    if (!noClip && blocksMovement(cx, cz, nx, nz)) {
      // Try sliding on X only
      const sx = Math.min(bbox.maxX - m, Math.max(bbox.minX + m, cx + mvX));
      if (!blocksMovement(cx, cz, sx, cz)) { nx = sx; nz = cz; }
      else {
        const sz = Math.min(bbox.maxZ - m, Math.max(bbox.minZ + m, cz + mvZ));
        if (!blocksMovement(cx, cz, cx, sz)) { nx = cx; nz = sz; }
        else                                  { nx = cx; nz = cz; }
      }
    }
    camera.position.x = nx;
    camera.position.z = nz;

    // ── 4. Floor snap: raycast straight down to find walkable surface,
    //      set camera.y = floor.y + 1.6m. Handles stairs and multi-storey. ──
    raycastFloor(delta);
  });

  function raycastFloor(dt: number) {
    // Cast from just above the camera (not from the ceiling) so a lower floor's
    // FrontSide plane doesn't accidentally get hit when standing on an upper floor.
    raycaster.set(
      new THREE.Vector3(camera.position.x, camera.position.y + 0.5, camera.position.z),
      downV
    );
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const h of hits) {
      const hy = h.point.y;
      // Accept only surfaces that are:
      //   • below the camera eye level (not a ceiling/shelf above)
      //   • within 2.5 m below — covers one full floor height (2.8 m) + step approach
      //   • above the basement floor (avoid terrain/sky far below)
      if (hy < camera.position.y - 0.1 && hy > camera.position.y - 2.5 && hy > bbox.minY - 1) {
        const target = hy + 1.6;
        const diff   = target - camera.position.y;
        // Climb stairs faster (6/s) than descend (10/s) — rising feels responsive,
        // descending snaps to avoid floating off a landing. Uses real frame dt.
        const rate = diff > 0 ? 6 : 10;
        camera.position.y += diff * Math.min(1, rate * dt);
        floorYRef.current = hy;   // remember this floor for the fallback
        return;
      }
    }
    // No floor detected (mid-step gap, transition off stair landing, etc.).
    // Gently float back to last-known floor + eye height rather than
    // slamming to global minY, which would drop the player from the 2nd floor.
    const fallbackEye = floorYRef.current + 1.6;
    const diff = fallbackEye - camera.position.y;
    camera.position.y += diff * Math.min(1, 6 * dt);
    camera.position.y = Math.max(bbox.minY, Math.min(bbox.maxY, camera.position.y));
  }

  return null;
}

function InsideCameraAnimator({ active, camPos, lookAt, teleport = false }: {
  active: boolean;
  camPos: [number, number, number];
  lookAt: [number, number, number];
  teleport?: boolean;
}) {
  const { camera } = useThree();
  const controls = useThree(s => s.controls) as any;
  const camV  = useMemo(() => new THREE.Vector3(...camPos),  [camPos[0], camPos[1], camPos[2]]);
  const lookV = useMemo(() => new THREE.Vector3(...lookAt), [lookAt[0], lookAt[1], lookAt[2]]);
  // done=true once we've finished the transition — after that OrbitControls takes over freely
  const done = useRef(false);
  useEffect(() => {
    if (!active) { done.current = false; }
  }, [active]);
  useFrame(() => {
    if (!active || done.current) return;
    if (teleport) {
      // Instant teleport: jump on first frame, then stop animating entirely
      camera.position.copy(camV);
      if (controls?.target) { controls.target.copy(lookV); controls.update?.(); }
      done.current = true;
      return;
    }
    // Smooth lerp (for return-to-outside): keep going until close enough
    camera.position.lerp(camV, 0.08);
    if (controls?.target) { controls.target.lerp(lookV, 0.08); controls.update?.(); }
    if (camera.position.distanceTo(camV) < 0.05) {
      camera.position.copy(camV);
      if (controls?.target) { controls.target.copy(lookV); controls.update?.(); }
      done.current = true;
    }
  });
  return null;
}

/** Smoothly flies camera to a preset position. Calls onDone when animation completes. */
function CameraFlyTo({ pos, tgt, onDone }: {
  pos: THREE.Vector3;
  tgt: THREE.Vector3;
  onDone: () => void;
}) {
  const { camera } = useThree();
  const controls = useThree(s => s.controls) as any;
  const doneRef = useRef(false);
  const posRef = useRef(pos);
  const tgtRef = useRef(tgt);
  posRef.current = pos;
  tgtRef.current = tgt;
  useFrame(() => {
    if (doneRef.current) return;
    const p = posRef.current, t = tgtRef.current;
    camera.position.lerp(p, 0.08);
    if (controls?.target) { controls.target.lerp(t, 0.08); controls.update?.(); }
    if (camera.position.distanceTo(p) < 0.12) {
      camera.position.copy(p);
      if (controls?.target) { controls.target.copy(t); controls.update?.(); }
      doneRef.current = true;
      onDone();
    }
  });
  return null;
}

// ─── Main export ────────────────────────────────────────────
export default function HouseCanvas() {
  const exterior      = useDesignerStore(s => s.exterior);
  // Use ground-floor footprint so CameraRig doesn't reset when user switches floors
  const { W, D }      = useGroundFloorFootprint();
  const { floors }    = exterior;
  const orbitRef      = useRef<any>(null);
  const [selectedOutdoorKey, setSelectedOutdoorKey] = useState<string | null>(null);
  // First-person walkthrough state — replaces the legacy "bird's-eye from
  // inside" mode. Active when user clicks 「进入室内漫游」 or 「点击进入 XXX」
  // on a room block. `walkthroughSpawn` is the camera teleport target in
  // world coords (eye height); null = building centre at eye height.
  // `insideBuilding` mirrors `walkthrough` so downstream fog / lighting
  // branches still flip correctly.
  const [walkthrough, setWalkthrough] = useState(false);
  const insideBuilding = walkthrough;
  const [walkthroughSpawn, setWalkthroughSpawn] = useState<[number, number, number] | null>(null);
  const [wallXray, setWallXray] = useState(false);
  // tick-based fly-to: 0=idle, >0 top-view, <0 reset-view
  const [flyTick, setFlyTick] = useState(0);
  const zoomTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const exitWalkthrough = () => { setWalkthrough(false); setWalkthroughSpawn(null); };

  // Build room AABBs in world coords for collision. Reads layout/dims from
  // store, mirrors FloorPlanBuilding's coord system (Y axis flipped to -Z).
  const floorPlansForWalk = useDesignerStore(s => s.floorPlans);
  const wallAABBs = useMemo<AABB[]>(() => {
    const out: AABB[] = [];
    // House-wide bbox so each room's local center can be world-translated.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let fi = 0; fi < floorPlansForWalk.length; fi++) {
      const fp = floorPlansForWalk[fi]; if (!fp) continue;
      for (const r of (fp.enabledRooms ?? []).filter(rr => !ROOM_DEFS[rr]?.isOutdoor)) {
        const p = fp.roomLayout?.[r]; const d = fp.roomDimensions?.[r];
        if (!p || !d) continue;
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + d.width); maxY = Math.max(maxY, p.y + d.depth);
      }
    }
    if (!isFinite(minX)) return out;
    const CM_local = 0.01;
    const Wh = (maxX - minX) * CM_local;
    const Dh = (maxY - minY) * CM_local;
    for (const fp of floorPlansForWalk) {
      if (!fp) continue;
      for (const r of (fp.enabledRooms ?? []).filter(rr => !ROOM_DEFS[rr]?.isOutdoor)) {
        const p = fp.roomLayout?.[r]; const d = fp.roomDimensions?.[r];
        if (!p || !d) continue;
        // World rect: x∈[(p.x-minX)*CM - W/2, (p.x+w-minX)*CM - W/2]
        //             z∈[-((p.y+d-minY)*CM) + D/2, -((p.y-minY)*CM) + D/2]
        out.push({
          minX: (p.x - minX) * CM_local - Wh / 2,
          maxX: (p.x + d.width - minX) * CM_local - Wh / 2,
          minZ: -((p.y + d.depth - minY) * CM_local) + Dh / 2,
          maxZ: -((p.y - minY) * CM_local) + Dh / 2,
        });
      }
    }
    return out;
  }, [floorPlansForWalk]);

  // ── Listen for "enterWalkthrough" event from ExteriorRoomList (left panel) ──
  // ExteriorRoomList dispatches this when the user clicks a room item.
  // We compute the room centre in world coords and teleport the camera there.
  const WALK_FLOOR_H = 2.8; // metres per storey — must match FloorPlanExterior
  useEffect(() => {
    const CM_local = 0.01;
    const handler = (e: Event) => {
      const { room, fi } = (e as CustomEvent<{ room: import("@/lib/types").RoomType; fi: number }>).detail;
      // Compute building-wide bounding box (all floors) for coord transform
      let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
      for (const fp of floorPlansForWalk) {
        if (!fp) continue;
        for (const r of (fp.enabledRooms ?? []).filter(rr => !ROOM_DEFS[rr]?.isOutdoor)) {
          const p = fp.roomLayout?.[r]; const d = fp.roomDimensions?.[r];
          if (!p || !d) continue;
          bMinX = Math.min(bMinX, p.x); bMinY = Math.min(bMinY, p.y);
          bMaxX = Math.max(bMaxX, p.x + d.width); bMaxY = Math.max(bMaxY, p.y + d.depth);
        }
      }
      if (!isFinite(bMinX)) return;
      const Wh = (bMaxX - bMinX) * CM_local;
      const Dh = (bMaxY - bMinY) * CM_local;
      const fp = floorPlansForWalk[fi];
      if (!fp) return;
      type RT = import("@/lib/types").RoomType;
      const p = fp.roomLayout?.[room as RT];
      const d = fp.roomDimensions?.[room as RT];
      if (!p || !d) return;
      // Convert plan coords (cm, Y-down) → world coords (m, Z-forward)
      const worldX = (p.x + d.width  / 2 - bMinX) * CM_local - Wh / 2;
      const worldZ = -((p.y + d.depth / 2 - bMinY) * CM_local) + Dh / 2;
      const worldY = fi * WALK_FLOOR_H + 1.6;  // eye height on this floor
      setWalkthrough(true);
      setWalkthroughSpawn([worldX, worldY, worldZ]);
    };
    window.addEventListener("enterWalkthrough", handler);
    return () => window.removeEventListener("enterWalkthrough", handler);
  }, [floorPlansForWalk]); // eslint-disable-line react-hooks/exhaustive-deps

  // Joystick state for touch devices — bound to a HUD widget below.
  const [joystick, setJoystick] = useState({ axisX: 0, axisZ: 0 });
  // "Ghost mode": disable internal wall collision so user can walk through
  // walls. Default ON — rooms share walls so AABB-based collision traps the
  // player immediately when trying to move between adjacent rooms. The outer
  // bbox clamp still prevents leaving the building footprint.
  const [walkNoClip, setWalkNoClip] = useState(true);
  // Sun analysis — read from global store so AiRenderModal + YardPlan share the value
  const sunHour     = useDesignerStore(s => s.sunHour);
  const setSunHour  = useDesignerStore(s => s.setSunHour);
  const siteLatLng  = useDesignerStore(s => s.siteLatLng);
  const sunPos = getSunPosition3D(sunHour, siteLatLng);
  const theme  = getSkyTheme(sunHour);
  void _rgbHex; // skyHex no longer needed — Sky component handles gradient
  const _buildingType    = (exterior as ExteriorSettings & { buildingType?: string }).buildingType;
  const isRichGlassVilla = _buildingType === "rich-glass-villa" || _buildingType === "floor-plan-driven";

  // Camera positions for inside vs outside
  const FLOOR_H_M = 3.0;
  // Inside: bird-eye overview from above the building, angled down so user can
  // see the full floor plan interior and rotate from there. Avoids spawning
  // inside furniture when rooms are tall or contain large objects.
  const diag = Math.sqrt(W * W + D * D);
  const insideCamPos:  [number, number, number] = [-diag * 0.55, floors * FLOOR_H_M + diag * 0.7, -diag * 0.45];
  const insideLookAt:  [number, number, number] = [0, FLOOR_H_M * 0.4, 0];
  // Match the CameraRig low-angle position for floor-plan-driven (pool visible in fg)
  const _fpdDist = diag * 1.15 + 5;
  const outsideCamPos: [number, number, number] = _buildingType === "floor-plan-driven"
    ? [-_fpdDist * 0.48, floors * FLOOR_H_M * 0.65 + 1.8, -_fpdDist * 0.78]
    : [-Math.sqrt(W*W+D*D)*0.30, floors*FLOOR_H_M*0.5+Math.sqrt(W*W+D*D)*0.28*1.6, -Math.sqrt(W*W+D*D)*1.6*0.90];
  const outsideLookAt: [number, number, number] = [0, floors * FLOOR_H_M * (_buildingType === "floor-plan-driven" ? 0.30 : 0.5), 0];

  return (
    <div className="w-full h-full relative">
      {/* ── Enter / Exit walkthrough button + wall X-ray toggle ── */}
      {isRichGlassVilla && (
        <div className="absolute top-3 left-1/2 z-20 flex items-center gap-2" style={{ transform: "translateX(-50%)" }}>
          <button
            onClick={() => {
              if (walkthrough) { exitWalkthrough(); }
              else {
                // Spawn at the centre of the largest room (by area) so the
                // camera lands inside a room rather than in a structural wall.
                let bestX = 0, bestZ = 0, bestArea = -1;
                for (const aabb of wallAABBs) {
                  const area = (aabb.maxX - aabb.minX) * (aabb.maxZ - aabb.minZ);
                  if (area > bestArea) {
                    bestArea = area;
                    bestX = (aabb.minX + aabb.maxX) / 2;
                    bestZ = (aabb.minZ + aabb.maxZ) / 2;
                  }
                }
                setWalkthrough(true);
                setWalkthroughSpawn([bestX, 1.6, bestZ]);
              }
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-xs font-semibold shadow-xl transition-all active:scale-95 select-none"
            style={{
              background: walkthrough
                ? "linear-gradient(135deg,rgba(16,185,129,0.92),rgba(5,150,105,0.92))"
                : "linear-gradient(135deg,rgba(30,58,138,0.92),rgba(59,130,246,0.92))",
              backdropFilter: "blur(12px)",
              border: `1px solid ${walkthrough ? "rgba(110,231,183,0.4)" : "rgba(147,197,253,0.4)"}`,
            }}
          >
            {walkthrough ? "↩ 退出漫游" : "🚶 进入室内漫游"}
          </button>
          {walkthrough && (
            <>
              <button
                onClick={() => setWallXray(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-xs font-semibold shadow-xl transition-all active:scale-95 select-none"
                style={{
                  background: wallXray
                    ? "linear-gradient(135deg,rgba(168,85,247,0.92),rgba(109,40,217,0.92))"
                    : "linear-gradient(135deg,rgba(55,65,81,0.88),rgba(31,41,55,0.88))",
                  backdropFilter: "blur(12px)",
                  border: `1px solid ${wallXray ? "rgba(216,180,254,0.5)" : "rgba(255,255,255,0.15)"}`,
                }}
              >
                🔮 {wallXray ? "取消透视" : "墙体透视"}
              </button>
              <button
                onClick={() => setWalkNoClip(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-xs font-semibold shadow-xl transition-all active:scale-95 select-none"
                title="碰撞模式：开启后内墙会阻挡移动（默认关闭，建议保持默认）"
                style={{
                  background: walkNoClip
                    ? "linear-gradient(135deg,rgba(245,158,11,0.92),rgba(217,119,6,0.92))"
                    : "linear-gradient(135deg,rgba(55,65,81,0.88),rgba(31,41,55,0.88))",
                  backdropFilter: "blur(12px)",
                  border: `1px solid ${walkNoClip ? "rgba(254,215,170,0.5)" : "rgba(255,255,255,0.15)"}`,
                }}
              >
                🧱 {walkNoClip ? "碰撞关" : "碰撞开"}
              </button>
            </>
          )}
        </div>
      )}
      {/* Walkthrough HUD: crosshair + key hints + touch joystick */}
      {walkthrough && (
        <>
          {/* Centre crosshair */}
          <div className="absolute top-1/2 left-1/2 z-10 pointer-events-none select-none"
            style={{ transform: "translate(-50%, -50%)", width: 14, height: 14 }}
          >
            <div style={{ position: "absolute", left: 6, top: 0, width: 2, height: 14, background: "rgba(255,255,255,0.65)" }} />
            <div style={{ position: "absolute", left: 0, top: 6, width: 14, height: 2, background: "rgba(255,255,255,0.65)" }} />
          </div>
          {/* Key hints */}
          <div className="absolute bottom-20 left-1/2 z-10 pointer-events-none select-none px-3 py-1 rounded-full"
            style={{
              transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.42)",
              backdropFilter: "blur(8px)",
              color: "rgba(255,255,255,0.9)",
              fontSize: 11,
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
            }}>
            🖱 左键拖动转视角 · 滚轮缩放 · WASD / 方向键 行走 · Shift 加速 · ESC 退出
          </div>
          {/* Touch joystick — bottom-left, only useful with finger but
              always rendered (mouse drag also works on it). */}
          <TouchJoystick onChange={(x, z) => setJoystick({ axisX: x, axisZ: z })} />
        </>
      )}

      {/* ── Zoom + view buttons ── bottom-right ── */}
      {!walkthrough && (
        <div className="absolute bottom-20 right-4 z-20 flex flex-col gap-1 select-none">
          {([
            { label: "+", title: "放大", factor: 0.88 },
            { label: "−", title: "缩小", factor: 1.14 },
            { label: "⊙", title: "俯视", factor: 0 },
            { label: "⌂", title: "重置视角", factor: 0 },
          ] as { label: string; title: string; factor: number }[]).map(({ label, title, factor }) => {
            const stopZoom = () => {
              if (zoomTimerRef.current) { clearInterval(zoomTimerRef.current); zoomTimerRef.current = null; }
            };
            const applyZoom = (f: number) => {
              const ctrl = orbitRef.current;
              if (!ctrl) return;
              const cam = ctrl.object as THREE.Camera;
              const tgt = ctrl.target as THREE.Vector3;
              const offset = cam.position.clone().sub(tgt);
              const r = Math.max(ctrl.minDistance, Math.min(ctrl.maxDistance, offset.length() * f));
              offset.setLength(r);
              cam.position.copy(tgt).add(offset);
              ctrl.update();
            };
            return (
              <button
                key={label}
                title={title}
                onPointerDown={e => {
                  e.stopPropagation();
                  if (factor === 0) {
                    if (label === "⊙") setFlyTick(t => t > 0 ? t + 1 : 1);
                    else setFlyTick(t => t < 0 ? t - 1 : -1);
                    return;
                  }
                  stopZoom();
                  applyZoom(factor);
                  zoomTimerRef.current = setInterval(() => applyZoom(factor), 80);
                }}
                onPointerUp={stopZoom}
                onPointerLeave={stopZoom}
                onPointerCancel={stopZoom}
                style={{
                  width: 36, height: 36,
                  borderRadius: 10,
                  background: "rgba(8,10,20,0.80)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff",
                  fontSize: label === "⊙" || label === "⌂" ? 16 : 20,
                  lineHeight: 1,
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(30,40,60,0.92)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(8,10,20,0.80)")}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

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
        style={{ touchAction: "none" }}
        shadows={{ type: THREE.PCFSoftShadowMap, enabled: true }}
        gl={{
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: theme.exposure,
          // Required for canvas.toDataURL() (AI render screenshot)
          preserveDrawingBuffer: true,
          antialias: false,
          // Pixel ratio cap — 2× delivers Retina sharpness without performance cliff
          powerPreference: "high-performance",
        }}
        camera={(() => {
          // Set initial camera position HERE (before OrbitControls mounts) so it
          // never gets overridden by OrbitControls' default [0,0,5] initialisation.
          if (_buildingType === "rich-glass-villa") {
            // Camera on south side (-Z), slightly left to show west wood face
            const fDist = W * 0.95 + 6;
            return {
              fov: 50, near: 0.1, far: 300,
              position: [-W * 0.22, 4.5, -fDist] as [number, number, number],
            };
          }
          if (_buildingType === "floor-plan-driven") {
            // South-west corner, lower angle — shows glass south face, west side, AND pool/terrace in fg
            const diag = Math.sqrt(W * W + D * D);
            const dist = diag * 1.15 + 5;
            const camY = floors * FLOOR_H * 0.65 + 1.8;
            return {
              fov: 52, near: 0.1, far: 300,
              position: [-dist * 0.48, camY, -dist * 0.78] as [number, number, number],
            };
          }
          return { fov: 58, near: 0.1, far: 300 };
        })()}
        dpr={[1, 2]}
      >
        {/* Fog disabled when inside — would darken interior surfaces */}
        {!insideBuilding && <fog attach="fog" args={[theme.fogColor, theme.fogNear, theme.fogFar]} />}
        {!walkthrough && flyTick !== 0 && (() => {
          const h = floors * FLOOR_H;
          const done = () => setFlyTick(0);
          if (flyTick > 0) {
            const dist = Math.max(W, D) * 1.1 + h * 0.8 + 10;
            return <CameraFlyTo key="top"
              pos={new THREE.Vector3(0, dist + h, 0.5)}
              tgt={new THREE.Vector3(0, h * 0.1, 0)}
              onDone={done} />;
          }
          const diag = Math.sqrt(W * W + D * D);
          const dist = diag * 1.15 + 5;
          const camY = h * 0.65 + 1.8;
          return <CameraFlyTo key="reset"
            pos={new THREE.Vector3(-dist * 0.48, camY, -dist * 0.78)}
            tgt={new THREE.Vector3(0, h * 0.30, 0)}
            onDone={done} />;
        })()}
        <ExteriorCaptureSetup />
        {!walkthrough && <CameraRig W={W} D={D} floors={floors} buildingType={_buildingType} />}
        <InsideCameraAnimator
          active={!walkthrough && _buildingType === "floor-plan-driven"}
          camPos={outsideCamPos}
          lookAt={outsideLookAt}
        />
        {/* OrbitControls — disabled during first-person walkthrough so
            PointerLockControls owns mouse + drag rotation. */}
        {!walkthrough && (
          <OrbitControls
            ref={orbitRef}
            makeDefault
            enableDamping
            dampingFactor={0.08}
            minPolarAngle={0}
            maxPolarAngle={Math.PI * 0.58}
            rotateSpeed={1.2}
            zoomSpeed={1.2}
            minDistance={2}
            maxDistance={80}
            panSpeed={0.6}
            target={
              _buildingType === "rich-glass-villa"
                ? [-W * 0.05, 5.0, -D * 0.25] as [number, number, number]
                : _buildingType === "floor-plan-driven"
                ? [0, floors * FLOOR_H * 0.30, 0] as [number, number, number]
                : [0, floors * FLOOR_H * 0.35, 0] as [number, number, number]
            }
          />
        )}
        {/* Walkthrough = WASD + PointerLockControls. bbox is the house's
            ground-floor footprint with floors * FLOOR_H_M ceiling cap. */}
        <WalkthroughController
          active={walkthrough}
          spawnPos={walkthroughSpawn ?? [0, 1.6, 0]}
          bbox={{
            minX: -W / 2 + 0.3, maxX: W / 2 - 0.3,
            minZ: -D / 2 + 0.3, maxZ: D / 2 - 0.3,
            minY: 1.6,
            maxY: exterior.hasRooftop
              ? (floors + 1) * FLOOR_H_M + 1.2  // allow standing on rooftop
              : floors * FLOOR_H_M - 0.4,
          }}
          walls={wallAABBs}
          joystick={joystick}
          noClip={walkNoClip}
          onExit={exitWalkthrough}
        />
        {/* HDR as both IBL lighting AND photorealistic sky background.
            backgroundBlurriness softens the HDR to remove distracting detail
            while keeping the sky colour/gradient. Night mode keeps a dark
            sphere instead since the night HDR is just a coloured gradient. */}
        {/* Sky — physically-based Preetham atmospheric scattering (day/dawn/dusk).
            Hidden during walkthrough — causes visual artifacts from inside. */}
        {!insideBuilding && theme.phase !== "night" && (
          <Sky
            sunPosition={sunPos}
            turbidity={theme.phase === "day" ? 4.5 : 9.0}
            rayleigh={theme.phase === "day" ? 1.6 : 0.7}
            mieCoefficient={theme.phase === "day" ? 0.005 : 0.008}
            mieDirectionalG={0.85}
            distance={450000}
          />
        )}
        {insideBuilding && <color attach="background" args={["#D8D4CC"]} />}
        <HouseEnvironmentFallback>
          <Suspense fallback={null}>
            <Environment
              files={theme.hdr}
              background={false}
              backgroundBlurriness={0.04}
              backgroundIntensity={theme.phase === "day" ? 0.65 : 0.80}
            />
          </Suspense>
        </HouseEnvironmentFallback>
        {/* Night sky sphere + star field */}
        {theme.phase === "night" && (
          <>
            <mesh scale={[280, 280, 280]}>
              <sphereGeometry args={[1, 32, 24]} />
              <meshBasicMaterial color="#060810" side={THREE.BackSide} depthWrite={false} />
            </mesh>
            {/* Procedural star field — 3500 stars, radius 180m */}
            <Stars radius={180} depth={60} count={3500} factor={5.5} saturation={0.55} fade speed={0.6} />
            {/* Moon — off to the side, bright white sphere */}
            <mesh position={[-40, 55, -120]}>
              <sphereGeometry args={[3.2, 18, 14]} />
              <meshBasicMaterial color="#FFFEF8" />
            </mesh>
            {/* Moon glow point light */}
            <pointLight position={[-40, 55, -120]} intensity={1.8} distance={300} color="#E8F0FF" decay={1} />
          </>
        )}
        {/* Hemisphere light — sky/ground bounce */}
        <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity]} />
        <ambientLight intensity={insideBuilding ? 0.82 : theme.ambient} />
        {/* Interior ceiling lights — warm downlights active when camera is inside */}
        {insideBuilding && (
          <>
            <pointLight position={[0,          FLOOR_H_M * 0.90, 0]}         intensity={5.0} distance={W * 2.5} decay={1.8} color="#FFF8E8" />
            <pointLight position={[-W * 0.30,  FLOOR_H_M * 0.90, 0]}         intensity={3.5} distance={W * 2.0} decay={1.8} color="#FFFAEC" />
            <pointLight position={[ W * 0.30,  FLOOR_H_M * 0.90, 0]}         intensity={3.5} distance={W * 2.0} decay={1.8} color="#FFFAEC" />
            <pointLight position={[0,          FLOOR_H_M * 0.90, -D * 0.28]} intensity={3.0} distance={W * 1.8} decay={1.8} color="#FFFBF0" />
            <pointLight position={[0,          FLOOR_H_M * 0.90,  D * 0.28]} intensity={3.0} distance={W * 1.8} decay={1.8} color="#FFFBF0" />
            {/* 地板高度补光 */}
            <pointLight position={[0, 0.6, 0]} intensity={1.8} distance={W * 1.6} decay={2} color="#FFF4E0" />
          </>
        )}
        {/* Primary sun — position updates every render frame as slider moves */}
        <directionalLight
          position={sunPos} intensity={theme.sunIntensity} color={theme.sunColor} castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-camera-far={120}
          shadow-camera-left={-35} shadow-camera-right={35}
          shadow-camera-top={35} shadow-camera-bottom={-35}
          shadow-bias={-0.0006}
          shadow-normalBias={0.06}
        />
        {/* Sky fill from opposite side (fill tracks opposite of sun) */}
        <directionalLight
          position={[-sunPos[0] * 0.4, 20, -sunPos[2] * 0.4]}
          intensity={theme.fillIntensity}
          color={theme.fillColor}
        />

        {/* 玻璃幕墙建筑：室外补光点灯（从南面和西面打亮玻璃，增强立面质感）*/}
        {_buildingType === "floor-plan-driven" && !insideBuilding && (
          <>
            <pointLight position={[0, floors * FLOOR_H * 0.6, -D * 1.2]} intensity={8} distance={D * 4 + W * 2} decay={1.5} color="#FFF8F0" />
            <pointLight position={[-W * 0.8, floors * FLOOR_H * 0.5, -D * 0.6]} intensity={5} distance={W * 3} decay={1.8} color="#FFF4E8" />
            {/* Facade ground-wash uplights — dramatic upward wash on south glass curtain wall */}
            {[-W * 0.35, 0, W * 0.35].map((lx, li) => (
              <pointLight key={li} position={[lx, 0.2, -D / 2 - 0.6]} intensity={4.5} distance={floors * FLOOR_H + 3} decay={1.6} color="#FFF6E8" />
            ))}
            {/* Side facade wash — east/west edges */}
            <pointLight position={[-W / 2 - 0.5, 0.2,  D * 0.10]} intensity={3.0} distance={floors * FLOOR_H + 2} decay={1.8} color="#FFF2E0" />
            <pointLight position={[ W / 2 + 0.5, 0.2, -D * 0.10]} intensity={3.0} distance={floors * FLOOR_H + 2} decay={1.8} color="#FFF2E0" />
            {/* Pool water bounce light — cool blue fill reflected from pool surface onto
                building south face. Approximates the real pool position (D*1.8 south). */}
            <pointLight position={[0, 1.2, -D * 1.8]} intensity={3.5} distance={D * 4 + W * 1.5} decay={1.6} color="#4AACCC" />
            {/* Stone deck reflected fill — warm from travertine deck between building and pool */}
            <pointLight position={[0, 0.5, -D * 0.85]} intensity={2.2} distance={D * 2 + W} decay={2.0} color="#E8D8B0" />
          </>
        )}
        {/* Click empty ground to deselect */}
        <DeselectPlane onDeselect={() => {
          setSelectedOutdoorKey(null);
          useDesignerStore.getState().setSelectedExteriorDecor(null);
        }} />
        {/* ── Ground environment — hidden during walkthrough to prevent Z-fighting ── */}
        {!insideBuilding && _buildingType === "floor-plan-driven" && <Ground W={W} D={D} />}
        {!insideBuilding && !isRichGlassVilla && <Ground W={W} D={D} />}
        {!insideBuilding && !isRichGlassVilla && <EntryPath W={W} D={D} />}
        {/* rich-glass-villa (non-FPD): minimal stone plaza only */}
        {!insideBuilding && isRichGlassVilla && _buildingType !== "floor-plan-driven" && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
            <planeGeometry args={[120, 120]} />
            <meshStandardMaterial color="#D8D0BC" roughness={0.88} metalness={0.0} />
          </mesh>
        )}
        {/* 楼层驱动外观下的"自动景观"全部移除 ——
            包括硬编码的柏树/橄榄树/松树/球形树/石头入户台/花坛/门柱/
            绿篱/远景树环/外周栅栏/树木 uplight/喷泉/驱车 bollard 灯。
            理由：这些元素位置/尺寸全部硬编码到建筑 W/D，用户没法在
            floor plan / yard plan 里精确定位或换 GLB。后续应归纳到房间
            结构（room-driven prefab + 可换 GLB），现在先去掉避免假景。
            院子里需要的东西用户用 YardPlan 自己摆。 */}
        <HouseBody
          W={W} D={D} settings={exterior}
          insideBuilding={insideBuilding} wallXray={wallXray}
          onEnterRoom={(_room, _fi, worldPos) => {
            // Teleport into walkthrough mode at the clicked room's centre.
            setWalkthrough(true);
            setWalkthroughSpawn(worldPos);
          }}
        />
        {/* Wall decor + yard items — hidden during walkthrough (exterior elements) */}
        {!insideBuilding && (!isRichGlassVilla || _buildingType === "floor-plan-driven") && <WallDecorLayer W={W} D={D} orbitRef={orbitRef} />}
        {!insideBuilding && (!isRichGlassVilla || _buildingType === "floor-plan-driven") && <YardPlanItems3D />}
        {!insideBuilding && (!isRichGlassVilla || _buildingType === "floor-plan-driven") && <YardPathItems3D />}
        {/* VillaYard 自动院（池 + 露台 + 躺椅）已移除 ——
            尺寸全部锚定建筑 W/D，用户不能调整也不能换 GLB。
            院子家具走 YardPlan（用户自由摆放）。 */}

        {/* NOTE: Stairs are interior elements — not rendered in the exterior 3D
            view. The 2D floor plan shows a stair symbol when floors > 1.
            To see stairs in 3D, add a 楼梯间 room and view it in 室内3D. */}

        {/* ── SSGI (WebGPU only) — replaces SSAO with global illumination ── */}
        <SSGIPostProcessing />

        {/* ── Postprocessing (WebGL path) — photorealistic architectural visualization ──
           SSAO: deep contact shadows ground objects convincingly.
           Bloom: subtle sun/sky glow for day/sunset; stronger for night lamps.
           BrightnessContrast: slight contrast lift for that "rendered" punch.
           SMAA: temporal anti-aliasing for clean edges. */}
        {/* Skip heavy post-processing when inside — SSAO with empty depth buffer causes white washout */}
        {!insideBuilding && (
          <EffectComposer multisampling={0} enableNormalPass>
            <SSAO
              blendFunction={BlendFunction.MULTIPLY}
              samples={32}
              radius={theme.phase === "day" ? 4 : 7}
              intensity={theme.phase === "night" ? 52 : theme.phase === "day" ? 22 : 35}
              luminanceInfluence={0.55}
              worldDistanceThreshold={1.8}
              worldDistanceFalloff={3.5}
              worldProximityThreshold={0.4}
              worldProximityFalloff={1.2}
            />
            {/* Bloom — warm halos for pool water, glass, and night emissives */}
            <Bloom
              intensity={theme.phase === "night" ? 0.80 : theme.phase === "dusk" ? 0.48 : 0.28}
              luminanceThreshold={theme.phase === "night" ? 0.84 : theme.phase === "dusk" ? 0.82 : 0.85}
              luminanceSmoothing={0.30}
              mipmapBlur
            />
            {/* HueSaturation — vivid architectural renders with rich pool/sky blues */}
            <HueSaturation
              saturation={theme.phase === "night" ? -0.05 : theme.phase === "day" ? 0.18 : 0.10}
              hue={0}
            />
            <BrightnessContrast
              brightness={theme.phase === "night" ? 0.0 : theme.phase === "day" ? 0.005 : 0.010}
              contrast={theme.phase === "night" ? 0.15 : theme.phase === "day" ? 0.14 : 0.10}
            />
            {/* Vignette — lighter during day for clean look, dark at night */}
            <Vignette offset={0.42} darkness={theme.phase === "night" ? 0.62 : theme.phase === "day" ? 0.28 : 0.40} eskil={false} />
            <SMAA />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}
