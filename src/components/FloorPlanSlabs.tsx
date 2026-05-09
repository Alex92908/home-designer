"use client";

/**
 * FloorPlanSlabs
 * 把每层平面图烘焙成 Canvas 纹理（房间颜色/墙/图标/尺寸），贴在 BoxGeometry 顶面。
 * 侧面用楼层颜色区分，可拖动旋转，右侧面板控制显隐。
 */

import { useMemo, useState, useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, RoomType } from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────
const WALL    = 14;    // wall thickness cm (matches FloorPlanAll)
const CM      = 0.01;  // 1 cm → 1 Three.js unit
const SLAB_T  = 0.22;  // slab thickness
const GAP     = 3.8;   // vertical gap between slab bases
const TEX_RES = 2048;  // texture pixel resolution

const FLOOR_ACCENT = ["#2563EB", "#7C3AED", "#059669", "#D97706"];

// ── Canvas texture baker ──────────────────────────────────────
interface Baked {
  tex:   THREE.CanvasTexture;
  planW: number;   // cm
  planD: number;   // cm
  minX:  number;
  minY:  number;
}

function bake(
  rooms:      RoomType[],
  layout:     Record<string, { x: number; y: number }>,
  dims:       Record<string, { width: number; depth: number }>,
  roomStates: Record<string, { materials?: { floor?: { color?: string }; wall?: { color?: string } } }>,
  customMeta: Record<string, { name?: string; icon?: string } | undefined>,
): Baked | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) {
    const p = layout[r]; const d = dims[r];
    if (!p || !d) continue;
    minX = Math.min(minX, p.x);          minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + d.width); maxY = Math.max(maxY, p.y + d.depth);
  }
  if (!isFinite(minX)) return null;

  const planW = maxX - minX;
  const planD = maxY - minY;

  const aspect = planW / planD;
  const cw = aspect >= 1 ? TEX_RES : Math.round(TEX_RES * aspect);
  const ch = aspect >= 1 ? Math.round(TEX_RES / aspect) : TEX_RES;
  const scale = cw / planW;

  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d")!;

  // ── Background ──
  ctx.fillStyle = "#EEEAE2";
  ctx.fillRect(0, 0, cw, ch);

  // ── Light grid ──
  ctx.strokeStyle = "rgba(0,0,0,0.05)";
  ctx.lineWidth   = 1;
  for (let gx = 0; gx < planW; gx += 100) {
    ctx.beginPath(); ctx.moveTo(gx * scale, 0); ctx.lineTo(gx * scale, ch); ctx.stroke();
  }
  for (let gy = 0; gy < planD; gy += 100) {
    ctx.beginPath(); ctx.moveTo(0, gy * scale); ctx.lineTo(cw, gy * scale); ctx.stroke();
  }

  // ── Rooms ──
  for (const r of rooms) {
    const p = layout[r]; const d = dims[r];
    if (!p || !d) continue;
    const def   = ROOM_DEFS[r];
    const state = (roomStates as any)[r];

    const rx = (p.x - minX) * scale;
    const ry = (p.y - minY) * scale;
    const rw = d.width  * scale;
    const rh = d.depth  * scale;
    const wt = WALL * scale;

    // Wall fill
    const wallClr  = state?.materials?.wall?.color  ?? def?.defaultWallColor  ?? "#6E7080";
    ctx.fillStyle  = wallClr;
    ctx.fillRect(rx, ry, rw, rh);

    // Floor fill
    const floorClr = state?.materials?.floor?.color ?? def?.defaultFloorColor ?? "#C8B890";
    ctx.fillStyle  = floorClr;
    ctx.fillRect(rx + wt, ry + wt, rw - wt * 2, rh - wt * 2);

    const innerW = rw - wt * 2;
    const innerH = rh - wt * 2;
    const cx2    = rx + wt + innerW / 2;
    const cy2    = ry + wt + innerH / 2;

    if (innerW < 4 || innerH < 4) continue;

    const name = customMeta[r]?.name ?? def?.name ?? r;
    const icon = customMeta[r]?.icon ?? def?.icon ?? "";
    const fs   = Math.min(innerW * 0.13, innerH * 0.17, 64);

    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";

    if (icon && fs >= 14) {
      // Icon
      ctx.font      = `${fs * 1.25}px serif`;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.fillText(icon, cx2, cy2 - fs * 0.5);
      // Name
      ctx.font      = `bold ${fs * 0.82}px system-ui, sans-serif`;
      ctx.fillStyle = "#18182a";
      ctx.fillText(name, cx2, cy2 + fs * 0.55);
    } else if (fs >= 9) {
      ctx.font      = `bold ${fs}px system-ui, sans-serif`;
      ctx.fillStyle = "#18182a";
      ctx.fillText(name, cx2, cy2);
    }

    // Dimensions
    if (innerW > 90 && innerH > 54 && fs >= 12) {
      ctx.font      = `${fs * 0.58}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(24,24,42,0.45)";
      ctx.fillText(
        `${(d.width / 100).toFixed(1)}×${(d.depth / 100).toFixed(1)}m`,
        cx2, cy2 + fs * 1.4,
      );
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  tex.flipY = true;         // matches Three.js BoxGeometry UV orientation

  return { tex, planW, planD, minX, minY };
}

// ── One slab ──────────────────────────────────────────────────
function FloorSlab({ floorIndex }: { floorIndex: number }) {
  const fp         = useDesignerStore(s => s.floorPlans[floorIndex]);
  const customMeta = useDesignerStore(s => s.customRoomMeta);

  const baked = useMemo<Baked | null>(() => {
    if (!fp) return null;
    const rooms = (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor) as RoomType[];
    return bake(
      rooms,
      fp.roomLayout     ?? {},
      fp.roomDimensions ?? {},
      (fp.rooms         ?? {}) as any,
      customMeta,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp?.enabledRooms, fp?.roomLayout, fp?.roomDimensions, fp?.rooms, customMeta]);

  if (!baked) return null;

  const { tex, planW, planD, minX, minY } = baked;
  const W3 = planW * CM;
  const D3 = planD * CM;
  const cx = (minX + planW / 2) * CM;
  const cz = (minY + planD / 2) * CM;
  const yMid = floorIndex * GAP + SLAB_T / 2;

  const accent = FLOOR_ACCENT[floorIndex % FLOOR_ACCENT.length];
  // Slightly darker shade for side faces
  const side   = new THREE.Color(accent).multiplyScalar(0.82);

  return (
    <mesh position={[cx, yMid, cz]} castShadow receiveShadow>
      <boxGeometry args={[W3, SLAB_T, D3]} />
      {/* BoxGeometry face order: +X, -X, +Y(top), -Y(bot), +Z, -Z */}
      <meshStandardMaterial attach="material-0" color={side} roughness={0.75} />
      <meshStandardMaterial attach="material-1" color={side} roughness={0.75} />
      <meshStandardMaterial attach="material-2" map={tex}   roughness={0.65} metalness={0} />
      <meshStandardMaterial attach="material-3" color="#C0BCB4" roughness={0.9} />
      <meshStandardMaterial attach="material-4" color={accent} roughness={0.70} />
      <meshStandardMaterial attach="material-5" color={side} roughness={0.75} />
    </mesh>
  );
}

// ── Auto-fit camera ───────────────────────────────────────────
function CameraFit({ floorCount }: { floorCount: number }) {
  const fitted = useRef(false);
  useFrame(({ camera, controls }) => {
    if (fitted.current) return;
    const ctrl = controls as any;
    if (!ctrl) return;
    const totalH = (floorCount - 1) * GAP + SLAB_T;
    const targetY = totalH / 2;
    ctrl.target.set(0, targetY, 0);
    camera.position.set(10, targetY + 8 + floorCount * 2, 12);
    ctrl.update();
    fitted.current = true;
  });
  return null;
}

// ── Scene ─────────────────────────────────────────────────────
function Scene({ floorCount, floorVisible }: { floorCount: number; floorVisible: boolean[] }) {
  return (
    <>
      <ambientLight intensity={1.8} />
      <directionalLight position={[10, 18, 8]} intensity={2.2} castShadow
        shadow-mapSize={[2048, 2048]} shadow-camera-far={80}
        shadow-camera-left={-20} shadow-camera-right={20}
        shadow-camera-top={20}   shadow-camera-bottom={-20} />
      <directionalLight position={[-6, 10, -5]} intensity={0.8} />

      {Array.from({ length: floorCount }, (_, fi) =>
        floorVisible[fi] && <FloorSlab key={fi} floorIndex={fi} />,
      )}

      {/* Shadow receiver ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#B8B4AC" roughness={0.92} />
      </mesh>
    </>
  );
}

// ── Main export ───────────────────────────────────────────────
export interface FloorPlanSlabsProps {
  floorVisible?:  boolean[];
  onToggleFloor?: (fi: number) => void;
}

export default function FloorPlanSlabs({
  floorVisible: extVisible,
  onToggleFloor,
}: FloorPlanSlabsProps = {}) {
  const exteriorFloors = useDesignerStore(s => s.exterior.floors);
  const floorCount = Math.max(exteriorFloors, 1);

  const [intVisible, setIntVisible] = useState<boolean[]>(() =>
    Array(floorCount).fill(true),
  );
  useEffect(() => {
    setIntVisible(prev =>
      Array.from({ length: floorCount }, (_, i) => prev[i] ?? true),
    );
  }, [floorCount]);

  const floorVisible = extVisible ?? intVisible;
  const toggleFloor  = onToggleFloor
    ?? ((fi: number) => setIntVisible(prev => prev.map((v, i) => (i === fi ? !v : v))));

  return (
    <div
      className="w-full h-full relative"
      style={{ background: "linear-gradient(170deg,#C0C8D2 0%,#888FA0 100%)" }}
    >
      <Canvas shadows camera={{ position: [10, 10, 14], fov: 42 }} gl={{ antialias: true }}>
        <Scene floorCount={floorCount} floorVisible={floorVisible} />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={2} maxDistance={60} />
        <CameraFit floorCount={floorCount} />
      </Canvas>

      {/* Hint */}
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-[11px] font-bold pointer-events-none select-none shadow"
        style={{ background: "rgba(255,255,255,0.92)", color: "#374151" }}
      >
        🏠 拖动旋转 · 滚轮缩放 · 右键平移
      </div>

      {/* Floor panel */}
      <div
        className="absolute top-14 right-3 z-20 flex flex-col gap-1.5 select-none"
        style={{
          background: "rgba(255,255,255,0.93)",
          backdropFilter: "blur(10px)",
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 14,
          padding: "10px 8px",
          minWidth: 96,
          boxShadow: "0 4px 16px rgba(0,0,0,0.13)",
        }}
      >
        <div className="text-[9px] font-bold text-gray-400 tracking-widest mb-0.5 px-1">楼层</div>
        {Array.from({ length: floorCount }, (_, fi) => {
          const on = floorVisible[fi];
          const c  = FLOOR_ACCENT[fi % FLOOR_ACCENT.length];
          return (
            <button
              key={fi}
              onClick={() => toggleFloor(fi)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
              style={{
                background: on ? c + "18" : "#F3F4F6",
                color:      on ? c        : "#9CA3AF",
                border:     `1.5px solid ${on ? c + "55" : "#E5E7EB"}`,
              }}
            >
              <span style={{ fontSize: 9, opacity: on ? 1 : 0.4 }}>{on ? "●" : "○"}</span>
              {fi + 1}F
            </button>
          );
        })}
      </div>
    </div>
  );
}
