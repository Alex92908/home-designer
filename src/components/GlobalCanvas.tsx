"use client";

/**
 * GlobalCanvas — "全局 3D 视图"：在同一个 3D 场景中并置所有房间。
 *
 * 与 RoomCanvas 的区别：
 *  - 没有天花板，所以能从上方俯瞰看到每间房的内部。
 *  - 每间房按 `roomLayout` 在地板平面上拼贴，保留非正方形尺寸。
 *  - 家具使用简化的彩色 box（color 取自 FurnitureItem.color），
 *    避免在大场景里加载大量 GLTF 造成卡顿。
 *  - 鼠标悬停 / 点击：单击某间房 → 切到 3D 单房间视图。
 *
 * L 型 / 凸字型房间：地板和墙体均已按真实多边形渲染（THREE.Shape + 边缘 boxwall）。
 */

import { useMemo, useRef, useState, useEffect, Suspense } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html, useGLTF, Clone } from "@react-three/drei";
import { useDesignerStore } from "@/lib/store";
import { RoomState } from "@/lib/store";
import { ROOM_DEFS, RoomType } from "@/lib/types";
import { ALL_POSSIBLE_ROOMS } from "@/lib/store";
const EMPTY_ROOM_STATE_GC: RoomState = { materials: {}, placedItems: [] };
import { PlacedItemMesh } from "./RoomCanvas";
import PerfTelemetry from "./PerfTelemetry";
import { useT } from "@/lib/i18n";
import type { RoofStyle } from "@/lib/types";

const CM = 0.01;       // cm → m
const FLOOR_H = 2.8;  // metres per storey (matches HouseCanvas)

// ── Rooftop 3D model paths (all bins verified OK) ────────────────────
const RT_LOUNGER_PATH  = "/models/outdoor_furniture/sun_lounger/sun_lounger.gltf";
const RT_SOFA_PATH     = "/models/outdoor_furniture/outdoor_sofa/outdoor_sofa.gltf";
const RT_TABLE_PATH    = "/models/outdoor_furniture/garden_coffee_table/garden_coffee_table.gltf";
const RT_CHAIR_PATH    = "/models/dining_chair/dining_chair_02/dining_chair_02_1k.gltf";
const RT_BONSAI_PATH   = "/models/outdoor_tree/bonsai_lowpoly/bonsai_lowpoly.gltf";
const RT_PALM_PATH     = "/models/outdoor_tree/palm_tree_lowpoly/palm_tree_lowpoly.gltf";
const RT_SHRUB_PATH    = "/models/outdoor_shrub/shrub_02/shrub_02_1k.gltf";
const RT_BOXWOOD_PATH  = "/models/outdoor_plant/boxwood_bush/boxwood_bush.gltf";
const RT_HEDGE_PATH    = "/models/outdoor_plant/hedge_generic/hedge_generic.gltf";
// anthurium + all potted_plant bins are truncated — use cypress (healthy) as accent
const RT_CYPRESS_PATH   = "/models/outdoor_tree/cypress_tree_lowpoly/cypress_tree_lowpoly.gltf";

const _rtBboxCache = new Map<string, { h: number; minY: number }>();
function GltfMini({ path, targetH = 1, rotY = 0, scaleX = 1, scaleZ = 1 }: {
  path: string; targetH?: number; rotY?: number; scaleX?: number; scaleZ?: number;
}) {
  const { scene } = useGLTF(path);
  const { yOff, s } = useMemo(() => {
    let cached = _rtBboxCache.get(path);
    if (!cached) {
      const box = new THREE.Box3().setFromObject(scene);
      const sz  = new THREE.Vector3(); box.getSize(sz);
      cached = { h: sz.y || 1, minY: box.min.y };
      _rtBboxCache.set(path, cached);
    }
    const sc = targetH / cached.h;
    return { yOff: -cached.minY * sc, s: sc };
  }, [path, targetH, scene]); // eslint-disable-line react-hooks/exhaustive-deps
  useMemo(() => {
    scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  }, [scene]);
  return (
    <group position={[0, yOff, 0]} rotation={[0, rotY, 0]} scale={[s * scaleX, s, s * scaleZ]}>
      <Clone object={scene} />
    </group>
  );
}

/** One room: floor + 4 walls (no ceiling) + furniture + label. */
/** Lightweight per-room light for global view. Reads the same
 *  on/off + brightness + color state as LightFixture (so the per-fixture
 *  toggle still works), but renders only a single non-shadow pointLight
 *  + an emissive sphere — no shadow maps = no MAX_TEXTURE_IMAGE_UNITS
 *  blowup when multiplied across many rooms. */
function GlobalRoomLight({ room, H, color }: { room: RoomType; H: number; color: string }) {
  const isOn = useDesignerStore(s => s.lightsOnByRoom[room] !== false);
  const brightness = useDesignerStore(s => s.lightBrightnessByRoom[room] ?? 1);
  const colorOverride = useDesignerStore(s => s.lightColorByRoom[room]);
  const toggle = useDesignerStore(s => s.toggleRoomLights);
  const finalColor = colorOverride ?? color;
  const mul = isOn ? brightness : 0;
  return (
    <group position={[0, H - 0.25, 0]}>
      <mesh onClick={(e) => { e.stopPropagation(); toggle(room); }}>
        <sphereGeometry args={[0.12, 12, 8]} />
        <meshStandardMaterial
          color={finalColor}
          emissive={finalColor}
          emissiveIntensity={0.9 * mul}
          roughness={0.3}
          transparent
          opacity={0.85}
        />
      </mesh>
      <pointLight
        visible={mul > 0}
        intensity={5 * mul}
        color={finalColor}
        distance={5}
        decay={2}
      />
    </group>
  );
}

/**
 * StaircaseGeom — 3D staircase that honours the floor's stairConfig.
 * Supports three shapes: straight, L-shaped, spiral.
 */
export function StaircaseGeom({
  W, D, color,
  shape = "straight",
  stairRotation = 0,
}: {
  W: number; D: number; color: string;
  shape?: "straight" | "L-shaped" | "spiral";
  stairRotation?: 0 | 90 | 180 | 270;
}) {
  const treadT  = 0.06;
  const railH   = FLOOR_H * 0.95;
  const railMat = <meshStandardMaterial color="#A0A0A8" roughness={0.5} />;
  // Convert stairRotation degrees → radians for the Y axis
  const rotY = (stairRotation * Math.PI) / 180;

  // ── Straight run ───────────────────────────────────────────
  // 金属杆式楼梯：金属踏步 + 两侧斜扶手杆（顶端封在楼板处）+ 竖栏杆
  function StraightRun({ runW, runD, baseY = 0, height = FLOOR_H }: {
    runW: number; runD: number; baseY?: number; height?: number;
  }) {
    const STEPS      = 12;
    const treadDepth = runD / STEPS;
    const riserH     = height / STEPS;
    const treadW2    = runW - 0.08;
    const ROD_R      = 0.020;   // 扶手杆半径
    const BAL_R      = 0.013;   // 竖栏杆半径
    const railH      = 0.90;   // 底部扶手离地高度

    // 踏步中心坐标
    const treads = useMemo(() => Array.from({ length: STEPS }, (_, i) => ({
      midY:   baseY + (i + 1) * riserH - treadT / 2,
      midZ:   i * treadDepth + treadDepth / 2 - runD / 2,
      topY:   baseY + (i + 1) * riserH,
      frontZ: i * treadDepth - runD / 2,
    })), [runD, riserH, treadDepth, baseY]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── 扶手几何（顶端封在 baseY+height，不超出楼板）──
    // 起点: (z=-runD/2, y=baseY+railH)
    // 终点: (z=+runD/2, y=baseY+height)  ← 正好是上层楼板高度
    // 方向向量: (0, height-railH, runD)
    const railDY  = height - railH;                           // 扶手垂直高差
    const railLen = Math.sqrt(railDY * railDY + runD * runD); // 扶手圆柱长度
    // 绕 X 轴旋转 θ，使圆柱轴 → (0, railDY, runD) 方向
    const cylRotX  = Math.atan2(runD, railDY);
    const railMidY = baseY + (railH + height) / 2;            // 扶手圆柱中心 y（两端点中点）

    // ── 竖栏杆高度（各阶不同，因扶手坡角略小于踏步坡角）──
    // 扶手在步骤 i 前沿处的 y:  y_rail_i = baseY + railH + i * (railDY/STEPS)
    // 踏步顶面 y:               y_top_i  = baseY + (i+1) * riserH
    // 竖杆高度:                  balH_i   = y_rail_i - y_top_i
    //                                     = railH + i*railDY/STEPS - (i+1)*riserH
    // 靠近顶端几阶 balH<0 → 不渲染（扶手已封在楼板处，顶端无需竖杆）
    const balHOf = (i: number) =>
      railH + i * (railDY / STEPS) - (i + 1) * riserH;

    const metalMat = <meshStandardMaterial color="#7c8fa0" metalness={0.85} roughness={0.15} />;
    const treadMat = <meshStandardMaterial color="#6a7d8e" metalness={0.80} roughness={0.20} />;

    return (
      <group>
        {/* 踏步 */}
        {treads.map((t, i) => (
          <mesh key={i} position={[0, t.midY, t.midZ]} castShadow receiveShadow>
            <boxGeometry args={[treadW2, treadT, treadDepth]} />
            {treadMat}
          </mesh>
        ))}

        {/* 两侧斜扶手杆：起点 (baseY+railH, -runD/2)，终点 (baseY+height, +runD/2) */}
        {([-1, 1] as const).map(side => {
          const xSide = side * (treadW2 / 2 - ROD_R);
          return (
            <mesh key={`rail-${side}`}
              position={[xSide, railMidY, 0]}
              rotation={[cylRotX, 0, 0]}
              castShadow
            >
              <cylinderGeometry args={[ROD_R, ROD_R, railLen, 8]} />
              {metalMat}
            </mesh>
          );
        })}

        {/* 竖栏杆：只渲染 balH>0 的阶（顶端几阶 balH 趋近 0，自然消隐） */}
        {treads.map((t, i) => {
          const bH = balHOf(i);
          if (bH <= 0.02) return null;
          return ([-1, 1] as const).map(side => {
            const xSide = side * (treadW2 / 2 - ROD_R * 2);
            return (
              <mesh key={`bal-${i}-${side}`}
                position={[xSide, t.topY + bH / 2, t.frontZ]}
                castShadow
              >
                <cylinderGeometry args={[BAL_R, BAL_R, bH, 6]} />
                {metalMat}
              </mesh>
            );
          });
        })}
      </group>
    );
  }

  // ── L-shaped: two half-height runs at 90° ──────────────────
  function LShapedRun() {
    const halfH   = FLOOR_H / 2;
    const run1D   = D * 0.55;   // first run depth
    const run1W   = W;
    const run2D   = W * 0.55;   // second run depth (perpendicular)
    const run2W   = D;
    // Landing platform
    const landW   = W;
    const landD   = D * 0.45;
    const landY   = halfH;
    const LSTEPS  = 6;
    const tD1     = run1D / LSTEPS;
    const rH1     = halfH / LSTEPS;
    const tD2     = run2D / LSTEPS;
    const rH2     = halfH / LSTEPS;
    const tW1     = run1W - 0.08;
    const tW2     = run2W - 0.08;
    const treadMat = <meshStandardMaterial color={color} roughness={0.7} />;
    const landMat  = <meshStandardMaterial color={color} roughness={0.8} />;
    // Run 1: bottom half, going along Z (front to back)
    const run1Treads = useMemo(() => Array.from({ length: LSTEPS }, (_, i) => ({
      y: i * rH1 + treadT / 2,
      z: i * tD1 + tD1 / 2 - run1D / 2,
    })), []); // eslint-disable-line react-hooks/exhaustive-deps
    // Run 2: top half, going along X (left to right), starting from back
    const run2Treads = useMemo(() => Array.from({ length: LSTEPS }, (_, i) => ({
      x: i * tD2 + tD2 / 2 - run2D / 2,
      y: landY + i * rH2 + treadT / 2,
    })), []); // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <group>
        {/* Run 1 — going in Z direction */}
        {run1Treads.map((t, i) => (
          <mesh key={`r1-${i}`} position={[0, t.y, t.z]} castShadow receiveShadow>
            <boxGeometry args={[tW1, treadT, tD1 + 0.01]} />
            {treadMat}
          </mesh>
        ))}
        {/* Landing platform */}
        <mesh position={[0, landY - treadT / 2, D / 2 - landD / 2]} receiveShadow>
          <boxGeometry args={[landW - 0.1, treadT, landD]} />
          {landMat}
        </mesh>
        {/* Run 2 — going in X direction */}
        {run2Treads.map((t, i) => (
          <mesh key={`r2-${i}`} position={[t.x, t.y, D / 2 - landD / 2]} castShadow receiveShadow>
            <boxGeometry args={[tD2 + 0.01, treadT, tW2]} />
            {treadMat}
          </mesh>
        ))}
        {/* Side rails */}
        <mesh position={[-(tW1 / 2 + 0.04), FLOOR_H * 0.95 / 2, 0]} castShadow>
          <boxGeometry args={[0.08, FLOOR_H * 0.95, run1D * 0.95]} />
          {railMat}
        </mesh>
        <mesh position={[tW1 / 2 + 0.04, FLOOR_H * 0.95 / 2, 0]} castShadow>
          <boxGeometry args={[0.08, FLOOR_H * 0.95, run1D * 0.95]} />
          {railMat}
        </mesh>
      </group>
    );
  }

  // ── Spiral ─────────────────────────────────────────────────
  function SpiralRun() {
    const r     = Math.min(W, D) / 2 - 0.1;
    const poleR = Math.max(0.1, r * 0.15);
    const STEPS = 14;
    const dTheta = (Math.PI * 1.5) / STEPS;  // 270° sweep
    const treadLen = r - poleR - 0.05;

    const spiralTreads = useMemo(() => Array.from({ length: STEPS }, (_, i) => {
      const theta = -Math.PI / 2 + i * dTheta;
      const riseY = (i / STEPS) * FLOOR_H;
      const midR  = poleR + treadLen / 2;
      return {
        x: Math.cos(theta) * midR,
        z: Math.sin(theta) * midR,
        y: riseY + treadT / 2,
        rot: theta,
      };
    }), []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
      <group>
        {/* Center pole */}
        <mesh position={[0, FLOOR_H / 2, 0]} castShadow>
          <cylinderGeometry args={[poleR, poleR, FLOOR_H, 12]} />
          <meshStandardMaterial color="#8A8890" roughness={0.6} />
        </mesh>
        {/* Tread slabs */}
        {spiralTreads.map((t, i) => (
          <mesh key={i} position={[t.x, t.y, t.z]} rotation={[0, -t.rot, 0]} castShadow receiveShadow>
            <boxGeometry args={[treadLen, treadT, Math.min(W, D) * 0.22]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
        ))}
        {/* Outer curved rail (approximated with thin boxes) */}
        {spiralTreads.map((t, i) => {
          const outerX = Math.cos(t.rot) * (r - 0.04);
          const outerZ = Math.sin(t.rot) * (r - 0.04);
          return (
            <mesh key={`rail-${i}`} position={[outerX, t.y + railH * 0.5, outerZ]}>
              <boxGeometry args={[0.06, 0.15, 0.06]} />
              {railMat}
            </mesh>
          );
        })}
      </group>
    );
  }

  // When rotated 90° or 270°, the local Z axis (running direction) maps
  // to world X, so W and D must be swapped to keep the stair within its room.
  const isTransposed = stairRotation === 90 || stairRotation === 270;
  return (
    <group rotation={[0, rotY, 0]}>
      {shape === "straight"  && <StraightRun runW={isTransposed ? D : W} runD={isTransposed ? W : D} />}
      {shape === "L-shaped"  && <LShapedRun />}
      {shape === "spiral"    && <SpiralRun />}
    </group>
  );
}

function RoomGroup({
  room, originX, originZ, onPick, isActive, isHover, setHover, showFurniture, floorIndex,
}: {
  room: RoomType;
  originX: number;   // meters, world coord of back-left corner
  originZ: number;
  floorIndex: number;
  onPick: () => void;
  isActive: boolean;
  isHover: boolean;
  setHover: (r: RoomType | null) => void;
  /** When false, skip rendering placedItems (家具). Used to progressively
   *  fill the scene: active room's furniture first frame, others later. */
  showFurniture: boolean;
}) {
  const def = ROOM_DEFS[room];
  const t = useT();
  const dims = useDesignerStore(s => s.floorPlans[floorIndex]?.roomDimensions?.[room]);
  const state = useDesignerStore(s => s.floorPlans[floorIndex]?.rooms[room] ?? EMPTY_ROOM_STATE_GC);
  const shape = useDesignerStore(s => s.floorPlans[floorIndex]?.roomShapes?.[room]);
  // Read stairConfig from THIS floor (not always activeFloor) so each floor's
  // staircase reflects that floor's shape/rotation setting.
  const stairCfg = useDesignerStore(s => s.floorPlans[floorIndex]?.stairConfig);
  const label = useDesignerStore(s => s.customRoomMeta[room]?.name) ?? t.roomNames[room] ?? def.name;
  const icon = useDesignerStore(s => s.customRoomMeta[room]?.icon) ?? def.icon;

  const W = dims.width * CM;
  const D = dims.depth * CM;
  const H = def.height * CM;
  const WALL = 0.08; // 8cm thick visual wall
  const WALL_H = H * 0.40; // shorter walls so we can peek in from above

  const floorColor = state?.materials?.floor?.color ?? def.defaultFloorColor;
  const wallColor  = state?.materials?.wall?.color  ?? def.defaultWallColor;

  // Polygon points (cm, room-local back-left origin). Rect fallback when
  // no shape override is set.
  const polyPts: Array<[number, number]> =
    shape && shape.preset !== "rect"
      ? shape.points
      : [[0, 0], [dims.width, 0], [dims.width, dims.depth], [0, dims.depth]];

  // THREE.Shape for the floor — convert each cm point to meters, and
  // center on room's world origin (subtract W/2, D/2).
  const floorShape = useMemo(() => {
    const s = new THREE.Shape();
    polyPts.forEach(([px, pz], i) => {
      const wx = px * CM - W / 2;
      const wz = pz * CM - D / 2;
      i === 0 ? s.moveTo(wx, wz) : s.lineTo(wx, wz);
    });
    s.closePath();
    return s;
    // polyPts reference is stable as long as shape/dims don't change, but
    // we still include them as deps to be safe.
  }, [polyPts, W, D]);

  // Polygon edge segments → wall boxes
  const wallBoxes = useMemo(() => {
    const ws: Array<{ cx: number; cz: number; len: number; angle: number }> = [];
    for (let i = 0; i < polyPts.length; i++) {
      const [x1, z1] = polyPts[i];
      const [x2, z2] = polyPts[(i + 1) % polyPts.length];
      const wx1 = x1 * CM - W / 2, wz1 = z1 * CM - D / 2;
      const wx2 = x2 * CM - W / 2, wz2 = z2 * CM - D / 2;
      const dx = wx2 - wx1, dz = wz2 - wz1;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      ws.push({
        cx: (wx1 + wx2) / 2,
        cz: (wz1 + wz2) / 2,
        len,
        angle: Math.atan2(-dz, dx),
      });
    }
    return ws;
  }, [polyPts, W, D]);

  // Center of the room's bounding box, in world coords
  const cx = originX + W / 2;
  const cz = originZ + D / 2;
  // Vertical offset: each storey sits at floorIndex * FLOOR_H
  const yBase = floorIndex * FLOOR_H;
  const isStair = room === "stair";

  return (
    <group position={[cx, yBase, cz]}
      onPointerOver={(e) => { e.stopPropagation(); setHover(room); }}
      onPointerOut={() => setHover(null)}
      onClick={(e) => { e.stopPropagation(); onPick(); }}
    >
      {/* Floor slab (polygon-aware). DoubleSide so back-face culling doesn't
          hide it when viewed from slightly below in dollhouse mode.
          楼梯间在 fi>0 跳过：上层楼梯间是楼梯井开口，没楼板才能让下层
          楼梯上来；楼梯本身的"顶端平台"已经在踏步级末端提供了齐平 2F
          楼面的小平台。 */}
      {!(isStair && floorIndex > 0) && (
        <mesh position={[0, 0.001, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
          <shapeGeometry args={[floorShape]} />
          <meshStandardMaterial
            color={isStair ? "#C8C8D0" : (isActive ? "#BAE6FD" : (isHover ? "#DBEAFE" : floorColor))}
            roughness={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* 每层楼梯间都渲染一套楼梯几何体（fi=0 → 1F→2F，fi=1 → 2F→3F …）。
          扶手顶端已封在 baseY+FLOOR_H，不会超出上层楼板，无 X 形交叉。 */}
      {isStair && (
        <StaircaseGeom
          W={W} D={D} color={wallColor}
          shape={stairCfg?.shape ?? "straight"}
          stairRotation={(stairCfg?.rotation ?? 0) as 0 | 90 | 180 | 270}
        />
      )}

      {/* Walls — skip for stair rooms (StaircaseGeom provides the geometry) */}
      {!isStair && wallBoxes.map((w, i) => (
        <mesh key={i} position={[w.cx, WALL_H / 2, w.cz]} rotation={[0, w.angle, 0]} castShadow receiveShadow>
          <boxGeometry args={[w.len, WALL_H, WALL]} />
          <meshStandardMaterial color={wallColor} roughness={0.85} />
        </mesh>
      ))}

      {/* Furniture — reuse RoomCanvas PlacedItemMesh (其自身已包每个 GLTF
          一层 Suspense + 程序化 fallback)。不再套外层 Suspense，让已加载
          完的家具立即出现而不被慢的那件拖住 —— 上一版外层 Suspense 只
          要有 1 件没加载好，整间房全部 gone。
          showFurniture=false 时直接跳过（用于首帧只渲染激活房间家具）。*/}
      {/* Furniture — skip for stair rooms */}
      {showFurniture && !isStair && (state?.placedItems ?? []).map(p => (
        <PlacedItemMesh key={p.instanceId} placed={p} def={def} roomW={W} roomD={D} room={room} />
      ))}

      {/* Cheap per-room light: emissive bulb + single non-shadow pointLight.
          The full LightFixture with shadow-casting spots/points would blow
          past MAX_TEXTURE_IMAGE_UNITS=16 once multiplied across all rooms
          (WebGL shader compile fails). The single-room 3D view still uses
          the full fixture; global view gets this simplified stand-in. */}
      {!isStair && (
        <GlobalRoomLight
          room={room}
          H={WALL_H}
          color={state?.materials?.light?.color ?? "#FFE8A0"}
        />
      )}

      {/* Floating label — stair shows floor transition arrow */}
      <Html
        position={[0, (isStair ? FLOOR_H * 0.6 : WALL_H + 0.15), 0]}
        center
        distanceFactor={8}
        style={{ pointerEvents: "none" }}
      >
        <div style={{
          background: isStair
            ? "rgba(99,102,241,0.9)"
            : isActive ? "#1D4ED8" : "rgba(31,41,55,0.82)",
          color: "white",
          padding: "2px 8px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 700,
          whiteSpace: "nowrap",
          fontFamily: "system-ui, sans-serif",
          boxShadow: isHover ? "0 0 0 2px #60A5FA" : undefined,
        }}>
          {isStair ? `🪜 ${label} ${floorIndex + 1}F→${floorIndex + 2}F` : `${icon} ${label}`}
        </div>
      </Html>
    </group>
  );
}

// ─── Auto stair connector ────────────────────────────────────────────────────
/**
 * Renders a staircase between two adjacent floors even when the user hasn't
 * manually added a "stair" room.  Placed at the front-right corner of the
 * building footprint so it's always visible in the default camera angle.
 *
 * Props are in metres (already converted from cm).
 */

function AutoStairConnector({
  footW, footD, fromY, posX, posZ, onDragStart,
}: { footW: number; footD: number; fromY: number; posX: number; posZ: number; onDragStart: () => void }) {
  const sw    = Math.min(footW * 0.18, 2.8);  // stair module width
  const sd    = Math.min(footD * 0.30, 4.2);  // stair module run depth
  const STEPS = 11;
  const treadD = sd / STEPS;
  const riserH = FLOOR_H / STEPS;
  const treadT = 0.055;
  const groupX = posX;
  const groupZ = posZ;

  const treads = useMemo(() => (
    Array.from({ length: STEPS }, (_, i) => ({
      // y: rising with each step, z: advancing along the run
      y: fromY + i * riserH + treadT / 2,
      z: -sd / 2 + i * treadD + treadD / 2,
    }))
  ), [fromY, sd, riserH, treadD]);

  return (
    <group position={[groupX, 0, groupZ]}
      onPointerDown={e => { e.stopPropagation(); onDragStart(); }}
    >
      {/* Treads */}
      {treads.map((t, i) => (
        <mesh key={i} position={[0, t.y, t.z]} castShadow receiveShadow>
          <boxGeometry args={[sw - 0.08, treadT, treadD + 0.01]} />
          <meshStandardMaterial color="#D8D0C8" roughness={0.65} />
        </mesh>
      ))}
      {/* Side walls spanning the full stair run */}
      {([-1, 1] as const).map(side => (
        <mesh key={side}
          position={[side * (sw / 2 - 0.04), fromY + FLOOR_H / 2, 0]}
          castShadow
        >
          <boxGeometry args={[0.07, FLOOR_H + 0.1, sd]} />
          <meshStandardMaterial color="#B8B0A8" roughness={0.7} />
        </mesh>
      ))}
      {/* Handrail top bar */}
      {([-1, 1] as const).map(side => (
        <mesh key={side}
          position={[side * (sw / 2 - 0.04), fromY + FLOOR_H + 0.06, 0]}
        >
          <boxGeometry args={[0.05, 0.05, sd]} />
          <meshStandardMaterial color="#888880" metalness={0.3} roughness={0.4} />
        </mesh>
      ))}
      {/* Floor-slab opening indicator (dark rectangle at top of stair) */}
      <mesh position={[0, fromY + FLOOR_H + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[sw, sd]} />
        <meshStandardMaterial color="#1A1A2A" opacity={0.4} transparent side={THREE.DoubleSide} />
      </mesh>
      {/* Drag grab surface — invisible but shows cursor */}
      <mesh position={[0, fromY + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[sw, sd]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

// ─── Roof ────────────────────────────────────────────────────────────────────
/**
 * Simple roof mesh placed on top of the building (topY = floorCount * FLOOR_H).
 * All coordinates are in metres, centred on the footprint.
 */
function GlobalRoof({
  footW, footD, topY, roofStyle, roofColor,
}: {
  footW: number; footD: number; topY: number;
  roofStyle: RoofStyle; roofColor: string;
}) {
  const overhang = 0.5; // eave overhang in metres
  const W = footW + overhang * 2;
  const D = footD + overhang * 2;
  const ridgeH = Math.min(footW, footD) * 0.35;  // how tall the pitch is

  if (roofStyle === "flat") {
    return (
      <mesh position={[0, topY + 0.1, 0]} receiveShadow castShadow>
        <boxGeometry args={[W, 0.2, D]} />
        <meshStandardMaterial color={roofColor} roughness={0.8} />
      </mesh>
    );
  }

  if (roofStyle === "gable") {
    // Two sloping panels + two gable triangles
    const slope = Math.sqrt((footW / 2) ** 2 + ridgeH ** 2);
    const ang   = Math.atan2(ridgeH, footW / 2);
    return (
      <group position={[0, topY, 0]}>
        {/* Left panel */}
        <mesh position={[-footW / 4, ridgeH / 2, 0]}
          rotation={[0, 0, ang]} castShadow>
          <boxGeometry args={[slope, 0.12, D]} />
          <meshStandardMaterial color={roofColor} roughness={0.75} />
        </mesh>
        {/* Right panel */}
        <mesh position={[footW / 4, ridgeH / 2, 0]}
          rotation={[0, 0, -ang]} castShadow>
          <boxGeometry args={[slope, 0.12, D]} />
          <meshStandardMaterial color={roofColor} roughness={0.75} />
        </mesh>
        {/* Ridge beam */}
        <mesh position={[0, ridgeH + 0.06, 0]}>
          <boxGeometry args={[0.2, 0.12, D + 0.2]} />
          <meshStandardMaterial color={roofColor} roughness={0.7} />
        </mesh>
      </group>
    );
  }

  if (roofStyle === "hip") {
    // Pyramid — 4 triangular faces via ConeGeometry (good enough approximation)
    return (
      <group position={[0, topY, 0]}>
        <mesh position={[0, ridgeH / 2, 0]} castShadow>
          <coneGeometry args={[Math.max(footW, footD) * 0.72, ridgeH, 4, 1]} />
          <meshStandardMaterial color={roofColor} roughness={0.75} />
        </mesh>
      </group>
    );
  }

  if (roofStyle === "chinese") {
    // Upturned gable: main ridge + curved eaves suggested via two extra panels
    const slope = Math.sqrt((footW / 2) ** 2 + ridgeH ** 2);
    const ang   = Math.atan2(ridgeH, footW / 2);
    return (
      <group position={[0, topY, 0]}>
        <mesh position={[-footW / 4, ridgeH / 2, 0]} rotation={[0, 0, ang + 0.08]} castShadow>
          <boxGeometry args={[slope, 0.14, D]} />
          <meshStandardMaterial color={roofColor} roughness={0.6} />
        </mesh>
        <mesh position={[footW / 4, ridgeH / 2, 0]} rotation={[0, 0, -ang - 0.08]} castShadow>
          <boxGeometry args={[slope, 0.14, D]} />
          <meshStandardMaterial color={roofColor} roughness={0.6} />
        </mesh>
        {/* Upturned corner accentuators */}
        {([[- footW / 2, 0, -D / 2],[footW / 2, 0, -D / 2],[-footW / 2, 0, D / 2],[footW / 2, 0, D / 2]] as [number,number,number][]).map(([x,,z], i) => (
          <mesh key={i} position={[x, 0.3, z]} rotation={[0, i * Math.PI / 2, 0.3]} castShadow>
            <boxGeometry args={[0.6, 0.12, 0.6]} />
            <meshStandardMaterial color={roofColor} roughness={0.5} />
          </mesh>
        ))}
        {/* Ridge */}
        <mesh position={[0, ridgeH + 0.06, 0]}>
          <boxGeometry args={[0.25, 0.18, D * 0.7]} />
          <meshStandardMaterial color={roofColor} roughness={0.6} />
        </mesh>
      </group>
    );
  }

  // mansard / fallback — boxy top + small gable on top
  return (
    <group position={[0, topY, 0]}>
      <mesh position={[0, ridgeH * 0.35, 0]} castShadow>
        <boxGeometry args={[W * 0.9, ridgeH * 0.7, D * 0.9]} />
        <meshStandardMaterial color={roofColor} roughness={0.8} />
      </mesh>
      <mesh position={[0, ridgeH * 0.7 + 0.25, 0]} castShadow>
        <boxGeometry args={[W * 0.5, 0.5, D * 0.5]} />
        <meshStandardMaterial color={roofColor} roughness={0.75} />
      </mesh>
    </group>
  );
}


interface SceneProps {
  floorVisible: boolean[];
  showRoof: boolean;
  showStairs: boolean;
  stairPos: { x: number; z: number } | null;
  setStairPos: (p: { x: number; z: number }) => void;
}

function Scene({ floorVisible, showRoof, showStairs, stairPos, setStairPos }: SceneProps) {
  // Read ALL floors so we can stack them in the dollhouse view.
  const floorPlans     = useDesignerStore(s => s.floorPlans);
  const exterior       = useDesignerStore(s => s.exterior);
  const exteriorFloors = exterior.floors;
  // Use activeFloor to drive the layout/dims baseline (keeps bounding-box
  // centring consistent when the user switches floors).
  const activeFloor    = useDesignerStore(s => s.activeFloor);
  const layout         = useDesignerStore(s => s.floorPlans[activeFloor].roomLayout);
  const dims           = useDesignerStore(s => s.floorPlans[activeFloor].roomDimensions);
  const activeRoom      = useDesignerStore(s => s.activeRoom);
  const setActiveRoom   = useDesignerStore(s => s.setActiveRoom);
  const setViewMode     = useDesignerStore(s => s.setViewMode);
  const setActiveFloor  = useDesignerStore(s => s.setActiveFloor);
  const updateYardItem  = useDesignerStore(s => s.updateYardItem);

  // Drag state
  const draggingYardId = useRef<string | null>(null);
  const draggingStair = useRef(false);

  // 同 FloorPlanAll 一致：首次点击房间仅激活高亮，400ms 内再点同一间
  // 才真正进入效果图，避免转场/旋转时误触。
  const lastPickRef = useRef<{ room: RoomType; floorIdx: number; t: number } | null>(null);
  const DOUBLE_MS = 400;

  const [hover, setHover] = useState<string | null>(null); // `${floorIdx}:${room}`
  // 渲染优先级：首帧只给激活房间装家具，其它房间先出墙体 + 地板，
  // 1 秒后（或 idle）再加载家具 —— 避免并发下载 10+ 个 GLTF 把
  // 主线程卡成 PPT。
  const [renderAllFurniture, setRenderAllFurniture] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRenderAllFurniture(true), 900);
    return () => clearTimeout(t);
  }, []);

  // Bounding box from the active floor's layout (all floors share the
  // same footprint, so this centres the stacked view correctly).
  const enabledBase = floorPlans[activeFloor]?.enabledRooms ?? [];
  const visibleBase = ALL_POSSIBLE_ROOMS.filter(r => enabledBase.includes(r));
  const { cx, cz, extent, footW, footD } = useMemo(() => {
    if (!visibleBase.length) return { cx: 0, cz: 0, extent: 10, footW: 10, footD: 10 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of visibleBase) {
      const l = layout[r]; const d = dims[r];
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + d.width);
      maxY = Math.max(maxY, l.y + d.depth);
    }
    const fW = (maxX - minX) * CM;
    const fD = (maxY - minY) * CM;
    return {
      cx: ((minX + maxX) / 2) * CM,
      cz: ((minY + maxY) / 2) * CM,
      extent: Math.max(fW, fD),
      footW: fW,
      footD: fD,
    };
  }, [visibleBase, layout, dims]);

  // Number of regular floors to render — after the store fix, floorPlans.length
  // is always kept in sync with exterior.floors, so these should be equal.
  // We still take the min defensively so stale persisted state can't crash.
  const floorCount = Math.min(floorPlans.length, exteriorFloors);

  return (
    <>
      <color attach="background" args={["#D4D8E0"]} />
      {/* Lighting — keep it simple; no HDR to avoid blowout */}
      <ambientLight intensity={1.2} />
      <hemisphereLight args={["#FFFFFF", "#C8D0E0", 0.8]} />
      <directionalLight
        position={[extent * 0.7, extent * 1.5 + floorCount * FLOOR_H, extent * 0.7]}
        intensity={1.4}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent + floorCount * FLOOR_H}
        shadow-camera-bottom={-extent}
      />
      {/* Fill light from opposite side */}
      <directionalLight
        position={[-extent * 0.5, extent * 0.8, -extent * 0.3]}
        intensity={0.6}
        color="#D0D8F8"
      />
      {/* Top-down fill so room floors are always lit */}
      <directionalLight position={[0, 20, 0]} intensity={0.5} />

      {/* Ground plane — also serves as the drag surface for yard items */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
        onPointerMove={e => {
          if (draggingYardId.current) {
            e.stopPropagation();
            const snap = 25;
            const nx = Math.round(e.point.x / CM / snap) * snap;
            const nz = Math.round(e.point.z / CM / snap) * snap;
            updateYardItem(draggingYardId.current, { x: nx, z: nz });
          } else if (draggingStair.current) {
            e.stopPropagation();
            // AutoStairConnector 渲染在 <group position={[-cx, 0, -cz]}> 内，
            // 所以本地坐标 = 世界坐标 + (cx, cz)。之前少了这步换算，导致
            // 拖动时楼梯整体偏移 (-cx, -cz) 看起来"飞出去"。
            // 同时把位置限制在屋占地范围内，避免拖到屋外。
            const localX = e.point.x + cx;
            const localZ = e.point.z + cz;
            const halfW  = footW / 2;
            const halfD  = footD / 2;
            const clampedX = Math.max(-halfW + 1, Math.min(halfW - 1, localX));
            const clampedZ = Math.max(-halfD + 1, Math.min(halfD - 1, localZ));
            const nx = Math.round(clampedX * 4) / 4;
            const nz = Math.round(clampedZ * 4) / 4;
            setStairPos({ x: nx, z: nz });
          }
        }}
        onPointerUp={() => { draggingYardId.current = null; draggingStair.current = false; }}
        onPointerLeave={() => { draggingYardId.current = null; draggingStair.current = false; }}
      >
        <planeGeometry args={[extent * 6, extent * 6]} />
        <meshStandardMaterial color="#C8CACF" roughness={1} />
      </mesh>

      {/* All floors stacked — shifted so centroid is at world origin */}
      <group position={[-cx, 0, -cz]}>
        {Array.from({ length: floorCount }, (_, fi) => {
          const fp = floorPlans[fi];
          if (!fp) return null;
          if (floorVisible[fi] === false) return null;
          const fpLayout = fp.roomLayout;
          const fpDims   = fp.roomDimensions;
          const enabled  = fp.enabledRooms ?? [];
          const visible  = ALL_POSSIBLE_ROOMS.filter(r => enabled.includes(r));
          const yOff     = fi * FLOOR_H;

          return (
            <group key={fi}>
              {/* Inter-floor concrete slab (except at ground level)
                  挖空楼梯井：在楼梯位置开洞，让下层楼梯能穿上来不被这
                  块大水泥板挡住。楼梯一般只配在下层（1F→2F 的 stair 房
                  间在 1F），所以查"下层有没有 stair"才正确。如果本层
                  本身也有 stair（多层连续上行），同样开洞。 */}
              {fi > 0 && (() => {
                const slabW = extent * 1.05;
                const slabD = extent * 1.05;
                const slabT = 0.12;
                // 解析楼梯井位置和尺寸：
                //  1. 优先用手动配置的 stair 房间（下层或本层 enabledRooms.stair）
                //  2. fallback 用 AutoStairConnector 的位置（neither floor 有 stair
                //     时才自动生成，位置由 stairPos state / 默认值决定）
                const sCM = 0.01;
                // 向下搜索所有层找楼梯位置（fi-1 没有时继续往下找，支持 3 层+）
                const stairSourceFp = (() => {
                  for (let k = fi; k >= 0; k--) {
                    if (floorPlans[k]?.enabledRooms?.includes("stair")) return floorPlans[k];
                  }
                  return null;
                })();
                const stairLay = stairSourceFp?.roomLayout?.["stair"] ?? null;
                const stairDim = stairSourceFp?.roomDimensions?.["stair"] ?? null;

                let sx: number, sz: number, sw: number, sd: number;
                let hasShaft = false;
                if (stairLay && stairDim) {
                  // Manual stair room
                  sx = (stairLay.x + stairDim.width / 2) * sCM - cx;
                  sz = (stairLay.y + stairDim.depth / 2) * sCM - cz;
                  sw = stairDim.width * sCM;
                  sd = stairDim.depth * sCM;
                  hasShaft = true;
                } else {
                  // AutoStairConnector fallback —— 同步它的位置/尺寸算法
                  const anyFloorHasStair = floorPlans.some(f => f?.enabledRooms?.includes("stair"));
                  if (!anyFloorHasStair) {
                    const autoSw = Math.min(footW * 0.18, 2.8);
                    const autoSd = Math.min(footD * 0.30, 4.2);
                    const autoPosX = stairPos?.x ?? (footW / 2 - autoSw / 2 - 0.15);
                    const autoPosZ = stairPos?.z ?? (footD / 2 - autoSd / 2 - 0.15);
                    sx = autoPosX;
                    sz = autoPosZ;
                    sw = autoSw;
                    sd = autoSd;
                    hasShaft = true;
                  } else {
                    sx = 0; sz = 0; sw = 0; sd = 0;
                  }
                }
                if (hasShaft) {
                  // Slab spans [cx - slabW/2, cx + slabW/2] × [cz - slabD/2, cz + slabD/2]
                  // Hole spans [sx - sw/2, sx + sw/2] × [sz - sd/2, sz + sd/2] (slab-local coords)
                  // 4 strips around the hole:
                  const yMid = yOff - slabT / 2;          // slab centre y
                  const mat = <meshStandardMaterial color="#B0B0B8" roughness={0.9} />;
                  // Convert slab-local coords (centred at cx, cz) to world by adding cx, cz back
                  // North strip (z > sz + sd/2): from sz+sd/2 to slabD/2
                  const nStripD = (slabD / 2) - (sz + sd / 2);
                  const nStripCz = cz + (sz + sd / 2) + nStripD / 2;
                  // South strip (z < sz - sd/2)
                  const sStripD = (sz - sd / 2) - (-slabD / 2);
                  const sStripCz = cz + (-slabD / 2) + sStripD / 2;
                  // East strip (x > sx + sw/2), only spans hole's z range
                  const eStripW = (slabW / 2) - (sx + sw / 2);
                  const eStripCx = cx + (sx + sw / 2) + eStripW / 2;
                  // West strip (x < sx - sw/2)
                  const wStripW = (sx - sw / 2) - (-slabW / 2);
                  const wStripCx = cx + (-slabW / 2) + wStripW / 2;
                  return (
                    <group>
                      {nStripD > 0 && (
                        <mesh position={[cx, yMid, nStripCz]} receiveShadow>
                          <boxGeometry args={[slabW, slabT, nStripD]} />{mat}
                        </mesh>
                      )}
                      {sStripD > 0 && (
                        <mesh position={[cx, yMid, sStripCz]} receiveShadow>
                          <boxGeometry args={[slabW, slabT, sStripD]} />{mat}
                        </mesh>
                      )}
                      {eStripW > 0 && (
                        <mesh position={[eStripCx, yMid, cz + sz]} receiveShadow>
                          <boxGeometry args={[eStripW, slabT, sd]} />{mat}
                        </mesh>
                      )}
                      {wStripW > 0 && (
                        <mesh position={[wStripCx, yMid, cz + sz]} receiveShadow>
                          <boxGeometry args={[wStripW, slabT, sd]} />{mat}
                        </mesh>
                      )}
                    </group>
                  );
                }
                // No stair on this floor — render solid slab as before
                return (
                  <mesh position={[cx, yOff - 0.06, cz]} receiveShadow>
                    <boxGeometry args={[slabW, slabT, slabD]} />
                    <meshStandardMaterial color="#B0B0B8" roughness={0.9} />
                  </mesh>
                );
              })()}

              {/* Floor label badge */}
              <Html
                position={[cx - extent * 0.48, yOff + 0.3, cz - extent * 0.48]}
                style={{ pointerEvents: "none" }}
              >
                <div style={{
                  background: fi === activeFloor ? "#1D4ED8" : "rgba(60,60,80,0.78)",
                  color: "#fff",
                  padding: "1px 7px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 800,
                  fontFamily: "system-ui,sans-serif",
                  letterSpacing: "0.04em",
                }}>
                  {fi + 1}F
                </div>
              </Html>

              {/* Rooms on this floor */}
              {visible.map(r => {
                const lpos = fpLayout[r];
                const ldim = fpDims[r];
                if (!lpos || !ldim) return null;
                const key = `${fi}:${r}`;
                return (
                  <RoomGroup
                    key={key}
                    room={r}
                    floorIndex={fi}
                    originX={lpos.x * CM}
                    originZ={lpos.y * CM}
                    isActive={r === activeRoom && fi === activeFloor}
                    isHover={hover === key}
                    setHover={hov => setHover(hov ? key : null)}
                    showFurniture={(r === activeRoom && fi === activeFloor) || renderAllFurniture}
                    onPick={() => {
                      const now = Date.now();
                      const last = lastPickRef.current;
                      if (last && last.room === r && last.floorIdx === fi && now - last.t < DOUBLE_MS) {
                        setActiveFloor(fi);
                        setActiveRoom(r);
                        setViewMode("3d");
                        lastPickRef.current = null;
                      } else {
                        setActiveFloor(fi);
                        setActiveRoom(r);
                        lastPickRef.current = { room: r, floorIdx: fi, t: now };
                      }
                    }}
                  />
                );
              })}
            </group>
          );
        })}
      </group>

      {/* ── Auto stair connectors ── */}
      {/* Only render AutoStairConnector for a transition when NEITHER adjacent
          floor already has a manual "stair" room — avoids double geometry. */}
      {showStairs && floorCount > 1 && Array.from({ length: floorCount - 1 }, (_, fi) => {
        // Only show stair if at least one of the two adjacent floors is visible
        const lo = floorVisible[fi] !== false;
        const hi = floorVisible[fi + 1] !== false;
        if (!lo && !hi) return null;
        // Skip if the lower or upper floor already has a manual stair room
        const loHasStair = floorPlans[fi]?.enabledRooms?.includes("stair") ?? false;
        const hiHasStair = floorPlans[fi + 1]?.enabledRooms?.includes("stair") ?? false;
        if (loHasStair || hiHasStair) return null;
        return (
          <AutoStairConnector
            key={fi}
            footW={footW}
            footD={footD}
            fromY={fi * FLOOR_H}
            posX={stairPos?.x ?? (footW / 2 - Math.min(footW * 0.18, 2.8) / 2 - 0.15)}
            posZ={stairPos?.z ?? (footD / 2 - Math.min(footD * 0.30, 4.2) / 2 - 0.15)}
            onDragStart={() => { draggingStair.current = true; }}
          />
        );
      })}

      {/* ── 屋顶层 (hasRooftop) — gated on showRoof so button controls it ── */}
      {exterior.hasRooftop && showRoof && (() => {
        const roofFp = floorPlans[exterior.floors];
        if (!roofFp) return null;
        const roofY = floorCount * FLOOR_H;
        const slabY = roofY + 0.06;
        const roofEnabled = roofFp.enabledRooms ?? [];
        // Compute rooftop bounding box for slab size
        let rtMinX = Infinity, rtMinY = Infinity, rtMaxX = -Infinity, rtMaxY = -Infinity;
        for (const r of roofEnabled) {
          const p = roofFp.roomLayout?.[r]; const d = roofFp.roomDimensions?.[r];
          if (!p || !d) continue;
          rtMinX = Math.min(rtMinX, p.x); rtMinY = Math.min(rtMinY, p.y);
          rtMaxX = Math.max(rtMaxX, p.x + d.width); rtMaxY = Math.max(rtMaxY, p.y + d.depth);
        }
        const rtCx = isFinite(rtMinX) ? ((rtMinX + rtMaxX) / 2) * CM : cx;
        const rtCz = isFinite(rtMinY) ? ((rtMinY + rtMaxY) / 2) * CM : cz;
        const slabW = Math.max(isFinite(rtMinX) ? (rtMaxX - rtMinX) * CM + 0.6 : footW + 0.4, footW + 0.4);
        const slabD2 = Math.max(isFinite(rtMinY) ? (rtMaxY - rtMinY) * CM + 0.6 : footD + 0.4, footD + 0.4);

        // Helper: lerp
        const lp = (a: number, b: number, t: number) => a + (b - a) * t;

        return (
          <group key="rooftop-global" position={[-cx, 0, -cz]}>
            {/* Rooftop slab — light concrete */}
            <mesh position={[rtCx, slabY, rtCz]} receiveShadow>
              <boxGeometry args={[slabW, 0.12, slabD2]} />
              <meshStandardMaterial color="#D8D4CE" roughness={0.85} />
            </mesh>
            {/* Parapet walls (low walls around edge) */}
            {[
              { pos: [rtCx, slabY + 0.25, rtCz - slabD2 / 2 + 0.06] as [number,number,number], size: [slabW, 0.50, 0.12] as [number,number,number] },
              { pos: [rtCx, slabY + 0.25, rtCz + slabD2 / 2 - 0.06] as [number,number,number], size: [slabW, 0.50, 0.12] as [number,number,number] },
              { pos: [rtCx - slabW / 2 + 0.06, slabY + 0.25, rtCz] as [number,number,number], size: [0.12, 0.50, slabD2] as [number,number,number] },
              { pos: [rtCx + slabW / 2 - 0.06, slabY + 0.25, rtCz] as [number,number,number], size: [0.12, 0.50, slabD2] as [number,number,number] },
            ].map(({ pos, size }, i) => (
              <mesh key={i} position={pos} castShadow receiveShadow>
                <boxGeometry args={size} />
                <meshStandardMaterial color="#C8C4BE" roughness={0.9} />
              </mesh>
            ))}
            {/* Room 3D content */}
            {roofEnabled.map(r => {
              const p = roofFp.roomLayout?.[r]; const d = roofFp.roomDimensions?.[r];
              if (!p || !d) return null;
              const rW  = d.width * CM;
              const rD  = d.depth * CM;
              const px  = (p.x + d.width  / 2) * CM;
              const pz  = (p.y + d.depth  / 2) * CM;
              const baseY = slabY + 0.12;

              if (r === "rooftop_lounge") {
                // Pergola frame (procedural) + real loungers + sofa + table
                const postH = 2.0; const postR = 0.06;
                const posts: [number,number][] = [[-rW/2+0.2, -rD/2+0.2],[ rW/2-0.2,-rD/2+0.2],[-rW/2+0.2, rD/2-0.2],[ rW/2-0.2, rD/2-0.2]];
                const slats = Math.max(3, Math.round(rW / 0.5));
                return (
                  <group key={r} position={[px, baseY, pz]}>
                    {posts.map(([ox,oz],i)=>(
                      <mesh key={i} position={[ox, postH/2, oz]} castShadow>
                        <cylinderGeometry args={[postR,postR,postH,8]}/>
                        <meshStandardMaterial color="#4A4A4A" metalness={0.5} roughness={0.4}/>
                      </mesh>
                    ))}
                    {[-rD/2+0.2, rD/2-0.2].map((oz,i)=>(
                      <mesh key={i} position={[0,postH,oz]} castShadow>
                        <boxGeometry args={[rW-0.4,0.06,0.08]}/>
                        <meshStandardMaterial color="#4A4A4A" metalness={0.5} roughness={0.4}/>
                      </mesh>
                    ))}
                    {Array.from({length:slats},(_,i)=>{
                      const t=slats>1?i/(slats-1):0.5;
                      return (
                        <mesh key={i} position={[lp(-rW/2+0.2,rW/2-0.2,t),postH+0.04,0]} castShadow>
                          <boxGeometry args={[0.05,0.04,rD-0.4]}/>
                          <meshStandardMaterial color="#5A3A1A" roughness={0.6}/>
                        </mesh>
                      );
                    })}
                    <Suspense fallback={null}>
                      <group position={[-rW*0.22, 0, rD*0.15]}>
                        <GltfMini path={RT_LOUNGER_PATH} targetH={0.38} rotY={0}/>
                      </group>
                      <group position={[ rW*0.22, 0, rD*0.15]}>
                        <GltfMini path={RT_LOUNGER_PATH} targetH={0.38} rotY={Math.PI}/>
                      </group>
                      <group position={[0, 0, -rD*0.28]}>
                        <GltfMini path={RT_SOFA_PATH} targetH={0.80}/>
                      </group>
                      <group position={[0, 0, -rD*0.05]}>
                        <GltfMini path={RT_TABLE_PATH} targetH={0.40}/>
                      </group>
                      {posts.map(([ox,oz],i)=>(
                        <group key={i} position={[ox*0.65, 0, oz*0.65]}>
                          <GltfMini path={RT_CYPRESS_PATH} targetH={0.45} rotY={i*1.3}/>
                        </group>
                      ))}
                    </Suspense>
                  </group>
                );
              }

              if (r === "rooftop_pool") {
                const wallT = 0.12; const poolH = 1.1;
                return (
                  <group key={r} position={[px, baseY, pz]}>
                    {/* pool shell */}
                    {([
                      [[0, rD/2-wallT/2, 0],[rW,poolH,wallT]],
                      [[0,-rD/2+wallT/2, 0],[rW,poolH,wallT]],
                      [[-rW/2+wallT/2,0,0],[wallT,poolH,rD]],
                      [[ rW/2-wallT/2,0,0],[wallT,poolH,rD]],
                    ] as [[number,number,number],[number,number,number]][]).map(([wp,sz],i)=>(
                      <mesh key={i} position={[wp[0],poolH/2,wp[2]]} castShadow receiveShadow>
                        <boxGeometry args={sz}/><meshStandardMaterial color="#E0DCD4" roughness={0.2}/>
                      </mesh>
                    ))}
                    {/* water */}
                    <mesh position={[0, poolH*0.82, 0]} receiveShadow>
                      <boxGeometry args={[rW-wallT*2,0.03,rD-wallT*2]}/>
                      <meshStandardMaterial color="#29B6E8" transparent opacity={0.75} roughness={0.04} metalness={0.1}/>
                    </mesh>
                    {/* coping */}
                    <mesh position={[0, poolH+0.04, 0]} castShadow>
                      <boxGeometry args={[rW+0.1,0.06,rD+0.1]}/>
                      <meshStandardMaterial color="#8A7968" roughness={0.3}/>
                    </mesh>
                    <mesh position={[0, poolH+0.07, 0]}>
                      <boxGeometry args={[rW-wallT*2-0.1,0.01,rD-wallT*2-0.1]}/>
                      <meshStandardMaterial color="#1E90C0" transparent opacity={0.4} roughness={0}/>
                    </mesh>
                    {/* poolside loungers */}
                    <Suspense fallback={null}>
                      {[-rW/2-0.55, rW/2+0.55].map((lx,i)=>(
                        <group key={i} position={[lx, 0, 0]}>
                          <GltfMini path={RT_LOUNGER_PATH} targetH={0.38} rotY={i===0?-Math.PI/2:Math.PI/2}/>
                        </group>
                      ))}
                    </Suspense>
                  </group>
                );
              }

              if (r === "rooftop_garden") {
                const shrubPaths = [RT_SHRUB_PATH, RT_BOXWOOD_PATH, RT_HEDGE_PATH];
                const cols = Math.max(1, Math.round(rW/1.6));
                const rows = Math.max(1, Math.round(rD/1.6));
                return (
                  <group key={r} position={[px, baseY, pz]}>
                    {/* grass slab */}
                    <mesh receiveShadow>
                      <boxGeometry args={[rW,0.08,rD]}/>
                      <meshStandardMaterial color="#3C7A4E" roughness={0.95}/>
                    </mesh>
                    {/* real shrubs */}
                    <Suspense fallback={null}>
                      {Array.from({length:rows*cols},(_,idx)=>{
                        const row=Math.floor(idx/cols); const col=idx%cols;
                        const ox=lp(-rW/2+0.4, rW/2-0.4, cols>1?col/(cols-1):0.5);
                        const oz=lp(-rD/2+0.4, rD/2-0.4, rows>1?row/(rows-1):0.5);
                        const h=0.45+(idx%3)*0.15;
                        return (
                          <group key={idx} position={[ox,0.08,oz]}>
                            <GltfMini path={shrubPaths[idx%shrubPaths.length]} targetH={h} rotY={(idx*1.4)%(Math.PI*2)}/>
                          </group>
                        );
                      })}
                      {/* palm accent */}
                      <group position={[0, 0.08, -rD/2+0.8]}>
                        <GltfMini path={RT_PALM_PATH} targetH={Math.min(rD*0.5,2.5)}/>
                      </group>
                      {/* bonsai pots */}
                      {([-rW/3, rW/3] as number[]).map((bx,i)=>(
                        <group key={i} position={[bx,0.08, rD/2-0.5]}>
                          <GltfMini path={RT_BONSAI_PATH} targetH={0.50} rotY={i*Math.PI}/>
                        </group>
                      ))}
                    </Suspense>
                  </group>
                );
              }

              if (r === "rooftop_bar") {
                const cH=1.05; const cD2=0.50;
                const chairs=Math.max(2,Math.floor(rW/0.75));
                return (
                  <group key={r} position={[px, baseY, pz]}>
                    {/* counter */}
                    <mesh position={[0,cH/2,-rD/2+cD2/2]} castShadow receiveShadow>
                      <boxGeometry args={[rW*0.9,cH,cD2]}/>
                      <meshStandardMaterial color="#2C1F14" roughness={0.45}/>
                    </mesh>
                    {/* marble top */}
                    <mesh position={[0,cH+0.03,-rD/2+cD2/2]} castShadow>
                      <boxGeometry args={[rW*0.9+0.06,0.055,cD2+0.06]}/>
                      <meshStandardMaterial color="#E8E2D8" roughness={0.1} metalness={0.05}/>
                    </mesh>
                    <Suspense fallback={null}>
                      {Array.from({length:chairs},(_,i)=>{
                        const t=chairs>1?i/(chairs-1):0.5;
                        return (
                          <group key={i} position={[lp(-rW*0.4,rW*0.4,t),0,-rD/2+cD2+0.55]}>
                            <GltfMini path={RT_CHAIR_PATH} targetH={0.88} rotY={Math.PI}/>
                          </group>
                        );
                      })}
                      <group position={[0,0,rD/4]}>
                        <GltfMini path={RT_TABLE_PATH} targetH={0.72}/>
                      </group>
                    </Suspense>
                    <pointLight position={[0,cH+0.6,-rD/2+cD2]} intensity={0.4} distance={Math.max(rW,rD)*1.4} color="#FFD070" decay={2}/>
                  </group>
                );
              }

              if (r === "equipment_room") {
                const bH=Math.min(Math.max(rD*0.55,1.8),2.6);
                return (
                  <group key={r} position={[px, baseY, pz]}>
                    <mesh position={[0,bH/2,0]} castShadow receiveShadow>
                      <boxGeometry args={[rW*0.85,bH,rD*0.80]}/>
                      <meshStandardMaterial color="#6B7280" roughness={0.5} metalness={0.15}/>
                    </mesh>
                    {([-0.2,0,0.2] as number[]).map((oz,i)=>(
                      <mesh key={i} position={[rW*0.425,bH*0.55,oz]} castShadow>
                        <boxGeometry args={[0.025,0.15,0.05]}/>
                        <meshStandardMaterial color="#374151" roughness={0.7}/>
                      </mesh>
                    ))}
                  </group>
                );
              }

              // fallback: colored zone
              return (
                <mesh key={r} position={[px, baseY+0.02, pz]} receiveShadow>
                  <boxGeometry args={[rW-0.08,0.04,rD-0.08]}/>
                  <meshStandardMaterial color="#C8C0B0" roughness={0.75}/>
                </mesh>
              );
            })}
          </group>
        );
      })()}

      {/* ── Roof ── */}
      {showRoof && !exterior.hasRooftop && (
        <GlobalRoof
          footW={footW}
          footD={footD}
          topY={floorCount * FLOOR_H}
          roofStyle={exterior.roofStyle}
          roofColor={exterior.roofColor}
        />
      )}

    </>
  );
}

/** Camera controller: fit view to multi-floor cluster on first render. */
function CameraFit() {
  const enabledRooms   = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const layout         = useDesignerStore(s => s.floorPlans[s.activeFloor].roomLayout);
  const dims           = useDesignerStore(s => s.floorPlans[s.activeFloor].roomDimensions);
  const exteriorFloors = useDesignerStore(s => s.exterior.floors);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const fittedRef = useRef(false);

  useFrame(({ camera }) => {
    if (fittedRef.current) return;
    const visible = ALL_POSSIBLE_ROOMS.filter(r => enabledRooms.includes(r));
    if (!visible.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of visible) {
      const l = layout[r]; const d = dims[r];
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + d.width);
      maxY = Math.max(maxY, l.y + d.depth);
    }
    const extent = Math.max(maxX - minX, maxY - minY) * CM;
    if (!isFinite(extent) || extent <= 0) return;
    // For multi-floor views: back the camera up vertically too
    const totalH = exteriorFloors * FLOOR_H;
    const lookH  = totalH * 0.5;
    const d3     = Math.max(extent, totalH) * 1.1;
    camera.position.set(d3 * 0.85, lookH + d3 * 0.65, d3 * 0.85);
    camera.lookAt(0, lookH, 0);
    camera.updateProjectionMatrix();
    if (controls.current) {
      controls.current.target.set(0, lookH, 0);
      controls.current.update();
    }
    fittedRef.current = true;
  });

  return (
    <OrbitControls
      ref={controls}
      enableDamping
      dampingFactor={0.08}
      minDistance={2}
      maxDistance={80}
      maxPolarAngle={Math.PI / 1.85}
      target={[0, 0, 0]}
    />
  );
}

export interface GlobalCanvasProps {
  /** External floor-visibility array.  When provided, the component is
   *  "controlled" — the parent owns the state and receives toggle events. */
  floorVisible?:   boolean[];
  onToggleFloor?:  (fi: number) => void;
}

export default function GlobalCanvas({ floorVisible: extVisible, onToggleFloor }: GlobalCanvasProps = {}) {
  const enabledRooms   = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const exteriorFloors = useDesignerStore(s => s.exterior.floors);
  const hasRooftop     = useDesignerStore(s => s.exterior.hasRooftop);
  const floorPlansLen  = useDesignerStore(s => s.floorPlans.length);
  // After the store fix, floorPlans.length === exterior.floors always.
  // Take the min defensively so old persisted state can't cause out-of-bounds.
  const floorCount     = Math.min(floorPlansLen, exteriorFloors);
  const t = useT();

  // ── Visibility / layout state (internal fallback when no props) ───────────
  const [intVisible, setIntVisible] = useState<boolean[]>(() =>
    Array(Math.max(exteriorFloors, 1)).fill(true),
  );
  useEffect(() => {
    setIntVisible(prev => {
      if (prev.length === exteriorFloors) return prev;
      return Array.from({ length: exteriorFloors }, (_, i) => prev[i] ?? true);
    });
  }, [exteriorFloors]);

  // Use external state when provided, otherwise use internal
  const floorVisible = extVisible ?? intVisible;
  const toggleFloor  = onToggleFloor ?? ((fi: number) =>
    setIntVisible(prev => prev.map((v, i) => i === fi ? !v : v)));

  // showRoof: when hasRooftop is true it controls rooftop-slab visibility;
  // when false it controls the traditional GlobalRoof toggle.
  // Auto-enable when hasRooftop becomes true so the floor shows by default.
  const [showRoof, setShowRoof] = useState(false);
  useEffect(() => {
    if (hasRooftop) setShowRoof(true);
  }, [hasRooftop]);
  const [showStairs, setShowStairs] = useState(true);
  const [stairPos, setStairPos] = useState<{ x: number; z: number } | null>(null);

  if (enabledRooms.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gray-100">
        <div className="text-5xl opacity-20">🏗️</div>
        <div className="text-sm font-bold text-gray-400">{t.global3dEmpty}</div>
        <div className="text-xs text-gray-300">{t.global3dEmptyHint}</div>
      </div>
    );
  }

  const initY = 14 + exteriorFloors * FLOOR_H * 0.4;

  return (
    <div
      className="w-full h-full relative"
      style={{ background: "linear-gradient(180deg, #C4CAD4 0%, #969EA8 55%, #6E7684 100%)" }}
    >
      <Canvas
        shadows
        // Plan A: 静止时不渲染。OrbitControls 拖拽/setState 自动 invalidate。
        frameloop="demand"
        camera={{ position: [12, initY, 12], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
      >
        <Scene
          floorVisible={floorVisible}
          showRoof={showRoof}
          showStairs={showStairs}
          stairPos={stairPos}
          setStairPos={setStairPos}
        />
        <CameraFit />
        <PerfTelemetry label="global3d" />
      </Canvas>

      {/* ── Hint bar ── */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold shadow pointer-events-none"
        style={{ background: "rgba(255,255,255,0.92)", color: "#374151" }}>
        <span>{t.global3dHint}</span>
      </div>

      {/* ── Control panel (right side) ── */}
      <div
        className="absolute top-14 right-3 z-20 flex flex-col gap-1 select-none"
        style={{
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 14,
          padding: "10px 8px",
          minWidth: 96,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        }}
      >
        {/* ── Floors ── */}
        <div className="text-[9px] font-bold text-gray-400 tracking-widest mb-0.5 px-1">楼层</div>
        {Array.from({ length: floorCount }, (_, fi) => (
          <button
            key={fi}
            onClick={() => toggleFloor(fi)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold transition-all"
            style={{
              background: floorVisible[fi] !== false ? "#EFF6FF" : "#F3F4F6",
              color:      floorVisible[fi] !== false ? "#1D4ED8" : "#9CA3AF",
              border: `1px solid ${floorVisible[fi] !== false ? "#BFDBFE" : "#E5E7EB"}`,
            }}
          >
            <span style={{ opacity: floorVisible[fi] !== false ? 1 : 0.4 }}>
              {floorVisible[fi] !== false ? "●" : "○"}
            </span>
            {fi + 1}F
          </button>
        ))}

        <div className="h-px bg-gray-200 my-1" />

        {/* ── Roof / Rooftop floor ── */}
        <button
          onClick={() => setShowRoof(v => !v)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold transition-all"
          style={{
            background: showRoof ? (hasRooftop ? "#FFF7ED" : "#F0FDF4") : "#F3F4F6",
            color:      showRoof ? (hasRooftop ? "#C2410C" : "#15803D") : "#9CA3AF",
            border: `1px solid ${showRoof ? (hasRooftop ? "#FED7AA" : "#BBF7D0") : "#E5E7EB"}`,
          }}
        >
          <span>{showRoof ? (hasRooftop ? "🏠" : "🏠") : "○"}</span>
          {hasRooftop ? "天台" : "屋顶"}
        </button>

        {/* ── Stairs ── */}
        <button
          onClick={() => setShowStairs(v => !v)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold transition-all"
          style={{
            background: showStairs ? "#FFF7ED" : "#F3F4F6",
            color:      showStairs ? "#C2410C" : "#9CA3AF",
            border: `1px solid ${showStairs ? "#FED7AA" : "#E5E7EB"}`,
          }}
        >
          <span>{showStairs ? "🪜" : "　"}</span> 楼梯
        </button>

        {showStairs && floorCount > 1 && (
          <div className="px-2 py-0.5 text-[9px] text-orange-400 leading-tight">
            拖动楼梯可移位
          </div>
        )}
      </div>
    </div>
  );
}
