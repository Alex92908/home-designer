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
 * L 型 / 凸字型房间暂未支持（仍按矩形渲染）——留给下一轮的多边形数据模型。
 */

import { useMemo, useRef, useState, Suspense } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, Html } from "@react-three/drei";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, RoomType } from "@/lib/types";
import { ALL_POSSIBLE_ROOMS } from "@/lib/store";
import { PlacedItemMesh } from "./RoomCanvas";

const CM = 0.01; // cm → m

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

function RoomGroup({
  room, originX, originZ, onPick, isActive, isHover, setHover,
}: {
  room: RoomType;
  originX: number;   // meters, world coord of back-left corner
  originZ: number;
  onPick: () => void;
  isActive: boolean;
  isHover: boolean;
  setHover: (r: RoomType | null) => void;
}) {
  const def = ROOM_DEFS[room];
  const dims = useDesignerStore(s => s.floorPlans[s.activeFloor].roomDimensions[room]);
  const state = useDesignerStore(s => s.floorPlans[s.activeFloor].rooms[room]);
  const shape = useDesignerStore(s => s.floorPlans[s.activeFloor].roomShapes?.[room]);
  const label = useDesignerStore(s => s.customRoomMeta[room]?.name) ?? def.name;
  const icon = useDesignerStore(s => s.customRoomMeta[room]?.icon) ?? def.icon;

  const W = dims.width * CM;
  const D = dims.depth * CM;
  const H = def.height * CM;
  const WALL = 0.08; // 8cm thick visual wall
  const WALL_H = H * 0.55; // shorter walls so we can peek in from above

  const floorColor = state.materials.floor?.color ?? def.defaultFloorColor;
  const wallColor  = state.materials.wall?.color  ?? def.defaultWallColor;

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

  return (
    <group position={[cx, 0, cz]}
      onPointerOver={(e) => { e.stopPropagation(); setHover(room); }}
      onPointerOut={() => setHover(null)}
      onClick={(e) => { e.stopPropagation(); onPick(); }}
    >
      {/* Floor (polygon-aware). Uses +π/2 X rotation so shape.y maps to
          world.z matching wall positions — -π/2 flips Z and pokes floor
          out past walls on L 型/凸字型 rooms. DoubleSide so back-face
          culling doesn't hide it once we rotate the other way. */}
      <mesh position={[0, 0.001, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <shapeGeometry args={[floorShape]} />
        <meshStandardMaterial
          color={isActive ? "#BAE6FD" : (isHover ? "#DBEAFE" : floorColor)}
          roughness={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Walls — one box per polygon edge (4 for rect, 6 for L型, 8 for 凸字) */}
      {wallBoxes.map((w, i) => (
        <mesh key={i} position={[w.cx, WALL_H / 2, w.cz]} rotation={[0, w.angle, 0]} castShadow receiveShadow>
          <boxGeometry args={[w.len, WALL_H, WALL]} />
          <meshStandardMaterial color={wallColor} roughness={0.85} />
        </mesh>
      ))}

      {/* Furniture — reuse RoomCanvas PlacedItemMesh so you get real GLTF
          models (sofa, bed, …) + procedural meshes. PlacedItemMesh
          centers items on the room's origin using roomW/roomD (meters).
          `room={room}` ensures per-room light dimmer reads the right id. */}
      <Suspense fallback={null}>
        {state.placedItems.map(p => (
          <PlacedItemMesh key={p.instanceId} placed={p} def={def} roomW={W} roomD={D} room={room} />
        ))}
      </Suspense>

      {/* Cheap per-room light: emissive bulb + single non-shadow pointLight.
          The full LightFixture with shadow-casting spots/points would blow
          past MAX_TEXTURE_IMAGE_UNITS=16 once multiplied across all rooms
          (WebGL shader compile fails). The single-room 3D view still uses
          the full fixture; global view gets this simplified stand-in. */}
      <GlobalRoomLight
        room={room}
        H={WALL_H}
        color={state.materials.light?.color ?? "#FFE8A0"}
      />

      {/* Floating label */}
      <Html position={[0, WALL_H + 0.15, 0]} center distanceFactor={8} style={{ pointerEvents: "none" }}>
        <div style={{
          background: isActive ? "#1D4ED8" : "rgba(31,41,55,0.82)",
          color: "white",
          padding: "2px 8px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 700,
          whiteSpace: "nowrap",
          fontFamily: "system-ui, sans-serif",
          boxShadow: isHover ? "0 0 0 2px #60A5FA" : undefined,
        }}>
          {icon} {label}
        </div>
      </Html>
    </group>
  );
}

function Scene() {
  const enabledRooms = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const layout       = useDesignerStore(s => s.floorPlans[s.activeFloor].roomLayout);
  const dims         = useDesignerStore(s => s.floorPlans[s.activeFloor].roomDimensions);
  const activeRoom   = useDesignerStore(s => s.activeRoom);
  const setActiveRoom = useDesignerStore(s => s.setActiveRoom);
  const setViewMode  = useDesignerStore(s => s.setViewMode);

  const [hover, setHover] = useState<RoomType | null>(null);

  // Compute bounding box of all rooms, then shift so the cluster is
  // centered on the world origin.
  const visible = ALL_POSSIBLE_ROOMS.filter(r => enabledRooms.includes(r));
  const { cx, cz, extent } = useMemo(() => {
    if (!visible.length) return { cx: 0, cz: 0, extent: 10 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of visible) {
      const l = layout[r]; const d = dims[r];
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + d.width);
      maxY = Math.max(maxY, l.y + d.depth);
    }
    return {
      cx: ((minX + maxX) / 2) * CM,
      cz: ((minY + maxY) / 2) * CM,
      extent: Math.max(maxX - minX, maxY - minY) * CM,
    };
  }, [visible, layout, dims]);

  return (
    <>
      <color attach="background" args={["#E5E7EB"]} />
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <hemisphereLight args={["#E0E7FF", "#A1A1AA", 0.5]} />
      <directionalLight
        position={[extent * 0.6, extent * 1.2, extent * 0.6]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
      />

      {/* Ground plane (context for shadows) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[extent * 3, extent * 3]} />
        <meshStandardMaterial color="#D4D4D8" roughness={1} />
      </mesh>

      {/* Rooms — shifted so cluster centroid is at origin */}
      <group position={[-cx, 0, -cz]}>
        {visible.map(r => (
          <RoomGroup
            key={r} room={r}
            originX={layout[r].x * CM}
            originZ={layout[r].y * CM}
            isActive={r === activeRoom}
            isHover={r === hover}
            setHover={setHover}
            onPick={() => { setActiveRoom(r); setViewMode("3d"); }}
          />
        ))}
      </group>

      <Suspense fallback={null}>
        <Environment preset="city" background={false} />
      </Suspense>
    </>
  );
}

/** Camera controller: fit view to room cluster on first render. */
function CameraFit() {
  const enabledRooms = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const layout       = useDesignerStore(s => s.floorPlans[s.activeFloor].roomLayout);
  const dims         = useDesignerStore(s => s.floorPlans[s.activeFloor].roomDimensions);
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
    camera.position.set(extent * 0.9, extent * 1.1, extent * 0.9);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controls.current?.update();
    fittedRef.current = true;
  });

  return (
    <OrbitControls
      ref={controls}
      enableDamping
      dampingFactor={0.08}
      minDistance={2}
      maxDistance={80}
      maxPolarAngle={Math.PI / 2.05}
      target={[0, 0, 0]}
    />
  );
}

export default function GlobalCanvas() {
  const enabledRooms = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);

  if (enabledRooms.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gray-100">
        <div className="text-5xl opacity-20">🏗️</div>
        <div className="text-sm font-bold text-gray-400">暂无房间</div>
        <div className="text-xs text-gray-300">先在「全局」视图中添加房间</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative bg-gray-200">
      <Canvas
        shadows
        camera={{ position: [12, 14, 12], fov: 45 }}
        gl={{ antialias: true }}
      >
        <Scene />
        <CameraFit />
      </Canvas>

      {/* Hint overlay */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-[11px] font-bold shadow"
        style={{ background: "rgba(255,255,255,0.92)", color: "#374151" }}>
        🏘️ 全局 3D · 点击房间进入详细视图
      </div>
    </div>
  );
}
