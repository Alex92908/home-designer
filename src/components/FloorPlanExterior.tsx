"use client";

/**
 * FloorPlanExterior — 从平面图自动生成外立面
 *
 * 核心思路（v3，与全局3D完全对齐）：
 *   1. 每个房间渲染一个实心 BoxGeometry（和全局3D用同一坐标系）
 *      → 建筑轮廓/凹凸形状和全局3D完全一致
 *   2. 用 computeExteriorWalls 检测外墙段，覆盖材质：
 *      南面 → 玻璃幕墙 overlay
 *      其他面 → 混凝土（带窗洞）
 *   3. 顶面加平屋顶
 *
 * 坐标系与全局3D一致：
 *   Floor plan X → Three.js X（不翻转）
 *   Floor plan Y → Three.js -Z（翻转，南=大Y → world -Z 面向摄像机）
 *   楼层 → Three.js Y（向上）
 */

import { useMemo, useCallback, useState, useRef, Suspense } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { useDesignerStore } from "@/lib/store";
import { overlayMaterialProps } from "@/lib/zLayer";
import { ROOM_DEFS, RoomType, WindowConfig, DoorConfig, PlacedItem } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { PlacedItemMesh } from "./RoomCanvas";
import { StaircaseGeom } from "./GlobalCanvas";

// ── 常量 ──────────────────────────────────────────────────────
const CM      = 0.01;
const FLOOR_H = 3.00;   // 每层净高 m
const SLAB_T  = 0.20;   // 层间楼板厚 m
const TOLE    = 10;     // 外墙相邻判定容差 cm

// ── Canvas-baked wood-grain texture (module singleton) ────────
// Vertical grain lines on a warm-brown base. Deterministic using
// seeded hash so we get repeatable grain without SSR issues.
let _woodGrainTex: THREE.CanvasTexture | null = null;
function getWoodGrainTex(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (_woodGrainTex) return _woodGrainTex;
  const W = 64, H = 512;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#7A4E2A";
  g.fillRect(0, 0, W, H);
  // Vertical grain lines (seeded, deterministic)
  let s = 0xABCD1234;
  const rng = () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return ((s >>> 0) / 0xFFFFFFFF); };
  for (let i = 0; i < 22; i++) {
    const gx = rng() * W;
    const dark = rng() > 0.5;
    g.strokeStyle = dark ? `rgba(40,20,8,${0.22 + rng() * 0.22})` : `rgba(200,140,70,${0.15 + rng() * 0.18})`;
    g.lineWidth = 0.8 + rng() * 2.4;
    g.beginPath();
    for (let y = 0; y <= H; y += 6) {
      const wave = Math.sin(y * 0.04 + i) * 2.5;
      if (y === 0) g.moveTo(gx + wave, y); else g.lineTo(gx + wave, y);
    }
    g.stroke();
  }
  // Fine highlight streak — simulates wood sheen under finish
  g.strokeStyle = "rgba(255,210,140,0.18)";
  g.lineWidth = 12;
  g.beginPath();
  g.moveTo(W * 0.38, 0);
  g.lineTo(W * 0.32, H);
  g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 2.5);
  t.needsUpdate = true;
  _woodGrainTex = t;
  return t;
}

// ── 类型 ──────────────────────────────────────────────────────
export type WallSide = "south" | "north" | "east" | "west";

export interface ExteriorWallSeg {
  floorIndex: number;
  room:       RoomType;
  side:       WallSide;
  roomX: number; roomY: number; roomW: number; roomD: number;
  segStart: number; segEnd: number;
  windows: WindowConfig[];
  doors:   DoorConfig[];
}

// ── 坐标换算 ──────────────────────────────────────────────────
interface PlanOffset { minX: number; minY: number; W: number; D: number }

/** floor-plan cm → Three.js m (南 = world -Z) */
function toWorld(fpX: number, fpY: number, o: PlanOffset): [number, number] {
  return [
    (fpX - o.minX) * CM - o.W / 2,
    -(fpY - o.minY) * CM + o.D / 2,
  ];
}

// ── 区间差集 ──────────────────────────────────────────────────
function subtractIntervals(
  base:     [number, number][],
  subtract: [number, number][],
): [number, number][] {
  let result = [...base];
  for (const [s, e] of subtract) {
    const next: [number, number][] = [];
    for (const [rs, re] of result) {
      if (e <= rs || s >= re) { next.push([rs, re]); continue; }
      if (rs < s) next.push([rs, s]);
      if (re > e) next.push([e, re]);
    }
    result = next;
  }
  return result;
}

function sideToWinWall(side: WallSide): WindowConfig["wall"] {
  // plan "south" = high plan-Y = low world-Z = "back" in 3D renderer convention
  // plan "north" = low plan-Y  = high world-Z = "front" in 3D renderer convention
  return { south: "back", north: "front", east: "right", west: "left" }[side] as WindowConfig["wall"];
}

// ── 外墙段检测 ─────────────────────────────────────────────────
export function computeExteriorWalls(
  enabledRooms: RoomType[],
  layout:   Record<string, { x: number; y: number }>,
  dims:     Record<string, { width: number; depth: number }>,
  winMap:   Record<string, WindowConfig[]>,
  floorIndex: number,
  doorMap?: Record<string, DoorConfig[]>,
): ExteriorWallSeg[] {
  const rooms = enabledRooms.filter(r => !ROOM_DEFS[r]?.isOutdoor);
  const result: ExteriorWallSeg[] = [];

  for (const room of rooms) {
    const p = layout[room]; const d = dims[room];
    if (!p || !d) continue;
    const { x: rx, y: ry } = p;
    const { width: rw, depth: rd } = d;

    const sides = [
      { side: "south" as WallSide, wallCoord: ry + rd, axis: "x" as const, wallStart: rx,     wallEnd: rx + rw },
      { side: "north" as WallSide, wallCoord: ry,      axis: "x" as const, wallStart: rx,     wallEnd: rx + rw },
      { side: "east"  as WallSide, wallCoord: rx + rw, axis: "y" as const, wallStart: ry,     wallEnd: ry + rd },
      { side: "west"  as WallSide, wallCoord: rx,      axis: "y" as const, wallStart: ry,     wallEnd: ry + rd },
    ];

    for (const { side, wallCoord, axis, wallStart, wallEnd } of sides) {
      const covered: [number, number][] = [];
      for (const other of rooms) {
        if (other === room) continue;
        const op = layout[other]; const od = dims[other];
        if (!op || !od) continue;
        let adjCoord: number, oStart: number, oEnd: number;
        if (axis === "x") {
          adjCoord = side === "south" ? op.y : op.y + od.depth;
          oStart = op.x; oEnd = op.x + od.width;
        } else {
          adjCoord = side === "east" ? op.x : op.x + od.width;
          oStart = op.y; oEnd = op.y + od.depth;
        }
        if (Math.abs(adjCoord - wallCoord) > TOLE) continue;
        const overS = Math.max(wallStart, oStart);
        const overE = Math.min(wallEnd, oEnd);
        if (overE - overS > TOLE) covered.push([overS, overE]);
      }

      const exterior = subtractIntervals([[wallStart, wallEnd]], covered);
      const winWall  = sideToWinWall(side);
      const roomWins = (winMap[room] ?? []).filter(w => w.wall === winWall);
      const allDoors = doorMap?.[room] ?? [];
      const roomDoors = allDoors.filter(d => d.wall === winWall);

      for (const [segStart, segEnd] of exterior) {
        if (segEnd - segStart < 20) continue;
        const segWins = roomWins.filter(w => {
          const wS = wallStart + (w.pos ?? 0);
          return wS + w.len > segStart && wS < segEnd;
        });
        const segDoors = roomDoors.filter(d => {
          const dS = wallStart + (d.pos ?? 0);
          return dS + d.len > segStart + 5 && dS < segEnd - 5 && d.len >= 60;
        });
        result.push({ floorIndex, room, side, roomX: rx, roomY: ry, roomW: rw, roomD: rd, segStart, segEnd, windows: segWins, doors: segDoors });
      }
    }
  }
  return result;
}

// ── 玻璃幕墙 overlay ──────────────────────────────────────────
// Deterministic hash — decides whether a given (col, row) panel has
// partially lowered blinds, without calling Math.random() at render time.
function panelBlindHash(col: number, row: number): number {
  // Returns 0..1 — treat < 0.28 as "has blinds"
  let h = (col * 2654435761 ^ row * 2246822519) >>> 0;
  h ^= h >> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >> 16;
  return (h >>> 0) / 0x100000000;
}

function GlassCurtain({
  width, height, floorH, doors = [],
}: {
  width: number; height: number; floorH: number;
  doors?: Array<{ cx: number; w: number; h: number }>;
}) {
  // 完全对齐"现代玻璃幕墙别墅"模板的 GlassCurtainWallFace：
  //  · 玻璃 #C8E0EA opacity 0.45 roughness 0.06 metalness 0.04 envMapIntensity 0.35
  //  · 黑色阳极氧化铝压条 #181A1E，金属感强但不被环境贴图染色
  //  · 模板原话："No spandrel/backing slab — interior room geometry provides
  //    back walls visible through transmission glass"——所以视觉通透感来自
  //    "玻璃 + 背后专门画的暖色奶油室内"，不是玻璃透明度本身。
  // Wider panels (1.80m) match reference image's curtain wall rhythm
  const cols  = Math.max(2, Math.round(width / 1.80));
  const panelW = width / cols;
  const mullionW = 0.075;  // refined thin-frame curtain wall (reference image style)
  const rows  = Math.round(height / floorH);
  const rowH  = height / rows;
  const frame = "#181A1E";

  return (
    <group>
      {/* 顶部 / 底部 / 中部横向压条 —— 满铺 */}
      <mesh position={[0, height / 2 - 0.04, 0.005]}>
        <boxGeometry args={[width, 0.08, 0.062]} />
        <meshStandardMaterial color={frame} roughness={0.10} metalness={0.96} envMapIntensity={2.8} />
      </mesh>
      <mesh position={[0, -height / 2 + 0.04, 0.005]}>
        <boxGeometry args={[width, 0.08, 0.062]} />
        <meshStandardMaterial color={frame} roughness={0.10} metalness={0.96} envMapIntensity={2.8} />
      </mesh>
      {Array.from({ length: rows - 1 }, (_, i) => {
        const py = -height / 2 + (i + 1) * rowH;
        return (
          <mesh key={`mid${i}`} position={[0, py, 0.005]}>
            <boxGeometry args={[width, 0.042, 0.040]} />
            <meshStandardMaterial color={frame} roughness={0.14} metalness={0.90} />
          </mesh>
        );
      })}

      {/* 每块面板：竖压条 + 玻璃 */}
      {Array.from({ length: cols }, (_, ci) => {
        const px = -width / 2 + (ci + 0.5) * panelW;
        const isFirst = ci === 0;
        return (
          <group key={`c${ci}`} position={[px, 0, 0.005]}>
            {/* 右侧竖压条 */}
            <mesh position={[panelW / 2 + mullionW / 4, 0, 0]}>
              <boxGeometry args={[mullionW / 2, height + 0.08, 0.060]} />
              <meshStandardMaterial color={frame} roughness={0.10} metalness={0.96} envMapIntensity={2.8} />
            </mesh>
            {/* 第一块左侧也补一条 */}
            {isFirst && (
              <mesh position={[-(panelW / 2 + mullionW / 4), 0, 0]}>
                <boxGeometry args={[mullionW / 2, height + 0.08, 0.060]} />
                <meshStandardMaterial color={frame} roughness={0.10} metalness={0.96} />
              </mesh>
            )}
            {/* 玻璃 + 中横档（transom bar）——每格一片玻璃，上部 62% 为主视野，
                下部 38% 为固定扇（两者之间加细横档，与竖向幕墙语言匹配）*/}
            {Array.from({ length: rows }, (_, ri) => {
              const py = -height / 2 + (ri + 0.5) * rowH;
              const hasDoor = doors.some(d => Math.abs(d.cx - px) < panelW / 2 + d.w / 2 && ri === 0);
              // Spandrel occupies bottom 20% of row — vision glass is above that.
              // Split vision zone into upper 62% / lower 38% with a transom bar.
              const spH    = Math.min(rowH * 0.200, 0.55);
              const visH   = rowH - spH;                 // vision zone height
              const topH   = visH * 0.62;                // upper vision pane
              const botH   = visH * 0.38;                // lower vision pane
              const visBot = py - rowH / 2 + spH;        // bottom of vision zone
              const transY = visBot + botH;               // transom center Y
              return (
                <group key={`p${ri}`}>
                  {/* Upper vision pane — high-clarity low-iron architectural glass */}
                  <mesh position={[0, visBot + botH + topH / 2, 0.020]} renderOrder={10}>
                    <boxGeometry args={[panelW - 0.006, topH - 0.004, 0.008]} />
                    <meshPhysicalMaterial
                      color={hasDoor ? "#D0E8F8" : "#CEE4F4"}
                      transparent opacity={hasDoor ? 0.30 : 0.25}
                      depthWrite={false} roughness={0.02} metalness={0.0}
                      reflectivity={0.55} clearcoat={0.9} clearcoatRoughness={0.04}
                      envMapIntensity={3.6} side={THREE.DoubleSide}
                      {...overlayMaterialProps(2)}
                    />
                  </mesh>
                  {/* Lower vision pane (fixed / operable bottom sash) */}
                  <mesh position={[0, visBot + botH / 2, 0.020]} renderOrder={10}>
                    <boxGeometry args={[panelW - 0.006, botH - 0.004, 0.008]} />
                    <meshPhysicalMaterial
                      color={hasDoor ? "#CCE4F6" : "#C8E0F2"}
                      transparent opacity={hasDoor ? 0.32 : 0.27}
                      depthWrite={false} roughness={0.025} metalness={0.0}
                      reflectivity={0.50} clearcoat={0.85} clearcoatRoughness={0.04}
                      envMapIntensity={3.4} side={THREE.DoubleSide}
                      {...overlayMaterialProps(2)}
                    />
                  </mesh>
                  {/* Horizontal transom bar between upper and lower pane */}
                  {!hasDoor && (
                    <mesh position={[0, transY, 0.023]} renderOrder={8}>
                      <boxGeometry args={[panelW - 0.006, 0.040, 0.014]} />
                      <meshStandardMaterial
                        color={frame} roughness={0.12} metalness={0.94} envMapIntensity={2.6}
                      />
                    </mesh>
                  )}
                  {/* ── 百叶帘（venetian blinds）—— 28% 的面板随机部分拉下 ──
                      位于玻璃内侧（z < 0），只遮住上部 Vision pane 的
                      约 55%，底部留空（日常使用场景模拟）。
                      seeded hash：不调用 Math.random(), 每帧渲染结果相同。 */}
                  {!hasDoor && panelBlindHash(ci, ri) < 0.14 && (() => {
                    const blindCoverage = 0.50 + panelBlindHash(ci + 17, ri + 3) * 0.25; // 50-75%
                    const blindH  = topH * blindCoverage;
                    const blindTop = visBot + botH + topH;       // top of vision pane
                    const blindBot = blindTop - blindH;           // bottom of blind zone
                    const slatCount = Math.max(3, Math.round(blindH / 0.055));
                    const slatH = blindH / slatCount;
                    const slatT = 0.009;
                    const slatW = panelW - 0.022;
                    return Array.from({ length: slatCount }, (_, sli) => {
                      const slatY = blindBot + (sli + 0.5) * slatH;
                      // Slight tilt: alternating 8° tilt for light-control effect
                      const tiltAngle = 0.14 + panelBlindHash(ci + sli, ri + 11) * 0.08;
                      return (
                        <mesh key={`blind-${sli}`} position={[0, slatY, -0.012]} rotation={[tiltAngle, 0, 0]} renderOrder={9}>
                          <boxGeometry args={[slatW, slatT, 0.045]} />
                          <meshStandardMaterial
                            color="#E8E2D4"
                            roughness={0.70} metalness={0.03}
                            {...overlayMaterialProps(1)}
                          />
                        </mesh>
                      );
                    });
                  })()}
                </group>
              );
            })}
          </group>
        );
      })}

      {/* ── Spandrel band — dark metal panel at floor level of each row.
          Hides the inter-floor slab and mechanical zone, as in real curtain walls.
          Sits just in front of (z > ) the glass panels so it opaquely covers that area. */}
      {Array.from({ length: rows }, (_, ri) => {
        const py = -height / 2 + ri * rowH;  // bottom of this row
        const spH = Math.min(rowH * 0.200, 0.55); // spandrel = bottom 20% of row, max 0.55m
        return (
          <mesh key={`spd-${ri}`} position={[0, py + spH / 2, 0.026]} renderOrder={9}>
            <boxGeometry args={[width - 0.004, spH, 0.008]} />
            <meshStandardMaterial color="#1A1D26" roughness={0.12} metalness={0.92} envMapIntensity={2.2} />
          </mesh>
        );
      })}

      {/* 大门 —— 推拉式玻璃门：和玻璃幕墙同款玻璃材质，只多一道细黑
          竖框做"门扇分隔"。之前是 #111 厚框 + 染色玻璃，从外面看像独立
          的木门贴在幕墙上，违和。现在融在幕墙里几乎看不出来，只有竖
          中线和地板/天花处的纤细横轨提示这里能开。 */}
      {doors.map((door, di) => (
        <group key={`door-${di}`} position={[door.cx, -height / 2 + door.h / 2, 0.005]}>
          {/* 两扇门玻璃 —— 和主玻璃同色同透明度 */}
          {[-door.w / 4, door.w / 4].map((ox, si) => (
            <mesh key={si} position={[ox, 0, 0.020]} renderOrder={10}>
              <boxGeometry args={[door.w / 2 - 0.020, door.h - 0.05, 0.008]} />
              <meshStandardMaterial
                color="#C8E0EA"
                transparent
                opacity={0.45}
                depthWrite={false}
                roughness={0.06}
                metalness={0.04}
                envMapIntensity={0.35}
                side={THREE.DoubleSide}
                {...overlayMaterialProps(2)}
              />
            </mesh>
          ))}
          {/* 门框 —— 顶/底细横轨 + 左/中/右细竖框，全部用 #181A1E */}
          {[
            [0, door.h / 2,  door.w, 0.035] as const,
            [0, -door.h / 2, door.w, 0.035] as const,
            [-door.w / 2, 0, 0.035, door.h] as const,
            [0, 0,           0.035, door.h] as const,
            [door.w / 2, 0,  0.035, door.h] as const,
          ].map(([bx, by, bw, bh], bi) => (
            <mesh key={bi} position={[bx, by, 0]}>
              <boxGeometry args={[bw, bh, 0.045]} />
              <meshStandardMaterial color="#181A1E" metalness={0.92} roughness={0.16} envMapIntensity={2.4} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}


// ── 混凝土外墙面（带板缝线条，建筑感） ──────────────────────────────
function ConcreteFacade({
  width, height, windows = [], windowGlow = 0,
}: {
  width: number; height: number;
  windows?: Array<{ localX: number; winLen: number; winH: number; winSill: number }>;
  /** Night-mode interior glow (0 = off, 0.9+ = full night). */
  windowGlow?: number;
}) {
  // 水平板缝：每 90cm 一道（模拟预制混凝土挂板分割）
  const hGrooveStep  = 0.90;
  const hGrooveCount = Math.max(1, Math.round(height / hGrooveStep) - 1);
  // 竖向板缝：每 120cm 一道
  const vGrooveStep  = 1.20;
  const vGrooveCount = Math.max(1, Math.round(width / vGrooveStep) - 1);
  const grooveColor  = "#C0BAB2";   // subtle groove shadow
  const baseColor    = "#E6E0D8";   // crisp warm-white render (matches reference image)

  return (
    <group>
      {/* ── 底板（整面）── */}
      <mesh>
        <boxGeometry args={[width, height, 0.08]} />
        <meshStandardMaterial color={baseColor} roughness={0.78} metalness={0.02} envMapIntensity={0.35} />
      </mesh>
      {/* ── 竖向分板阴影面（每 vGrooveStep 一块，交替略暗，模拟预制挂板微差）── */}
      {Array.from({ length: Math.round(width / vGrooveStep) }, (_, vi) => {
        const panelX = -width / 2 + (vi + 0.5) * vGrooveStep;
        if (panelX > width / 2) return null;
        const panelW2 = Math.min(vGrooveStep - 0.020, width - Math.abs(panelX) * 2);
        if (panelW2 <= 0) return null;
        const shade = vi % 2 === 0 ? "#CBC7BF" : "#C3BFB7";  // subtle alternating tone
        return (
          <mesh key={`pnl-${vi}`} position={[panelX, 0, 0.041]}>
            <boxGeometry args={[panelW2, height - 0.002, 0.004]} />
            <meshStandardMaterial color={shade} roughness={0.88} metalness={0.01} />
          </mesh>
        );
      })}

      {/* ── 水平板缝线 ── */}
      {Array.from({ length: hGrooveCount }, (_, i) => {
        const gy = -height / 2 + (i + 1) * hGrooveStep;
        return (
          <mesh key={`hg-${i}`} position={[0, gy, 0.042]}>
            <boxGeometry args={[width + 0.01, 0.018, 0.006]} />
            <meshStandardMaterial color={grooveColor} roughness={0.92} />
          </mesh>
        );
      })}

      {/* ── 竖向板缝线 ── */}
      {Array.from({ length: vGrooveCount }, (_, i) => {
        const vx = -width / 2 + (i + 1) * vGrooveStep;
        return (
          <mesh key={`vg-${i}`} position={[vx, 0, 0.042]}>
            <boxGeometry args={[0.018, height + 0.01, 0.006]} />
            <meshStandardMaterial color={grooveColor} roughness={0.92} />
          </mesh>
        );
      })}

      {/* ── 窗洞 ── */}
      {windows.map((w, wi) => {
        // Per-window deterministic glow style:
        // 70% warm amber (bedroom/living), 18% cool blue-white (bathroom LED),
        // 12% dark / off (unoccupied / blackout blind)
        const glowRand = panelBlindHash(wi * 11 + 3, wi + 7);
        const isWarm  = glowRand < 0.70;
        const isCool  = glowRand < 0.88 && !isWarm;  // 70-88 range = cool
        // isOff = glowRand >= 0.88 (12%)
        const litMult = isWarm ? 1.0 : isCool ? 0.80 : 0.0;
        const glowColor  = isWarm ? "#F4D890" : "#B8E4FF";
        const bgColor    = isWarm ? "#F5E8C8" : isCool ? "#E8F4FF" : "#161A20";
        const glassGlow  = isWarm ? "#F4C860" : "#A0D4F0";
        const glassColor = windowGlow > 0.5 ? (isWarm ? "#D8C8A0" : isCool ? "#B8D8F0" : "#B8D4E8") : "#B8D4E8";
        return (
        <group key={`ww-${wi}`} position={[w.localX, -height / 2 + w.winSill + w.winH / 2, 0]}>
          {/* 室内衬底 — 白天深邃，夜间按房间类型发光 */}
          <mesh position={[0, 0, -0.04]}>
            <boxGeometry args={[w.winLen - 0.02, w.winH - 0.02, 0.10]} />
            <meshStandardMaterial
              color={windowGlow > 0.5 ? bgColor : "#161A20"}
              emissive={windowGlow > 0.5 && litMult > 0 ? glowColor : "#000000"}
              emissiveIntensity={windowGlow > 0.5 ? windowGlow * 0.90 * litMult : 0}
              roughness={0.9}
            />
          </mesh>
          {/* 玻璃（浅蓝透明，带反射；夜间略带暖色透射）*/}
          <mesh position={[0, 0, 0.018]}>
            <planeGeometry args={[w.winLen - 0.04, w.winH - 0.04]} />
            <meshPhysicalMaterial
              color={glassColor}
              transmission={windowGlow > 0.5 ? 0.22 : 0.35}
              roughness={0.04} metalness={0.08}
              transparent opacity={windowGlow > 0.5 ? 0.82 : 0.72}
              emissive={windowGlow > 0.5 && litMult > 0 ? glassGlow : "#000000"}
              emissiveIntensity={windowGlow > 0.5 ? windowGlow * 0.24 * litMult : 0}
              side={THREE.FrontSide}
            />
          </mesh>
          {/* 窗框 — 暗铝合金色，4 条压条 */}
          {([
            [-w.winLen / 2 + 0.025, 0,               0.028, w.winH  ] as [number,number,number,number],
            [ w.winLen / 2 - 0.025, 0,               0.028, w.winH  ] as [number,number,number,number],
            [0,  w.winH / 2 - 0.025, w.winLen, 0.052] as [number,number,number,number],
            [0, -w.winH / 2 + 0.025, w.winLen, 0.052] as [number,number,number,number],
          ]).map(([fx, fy, fw, fh], k) => (
            <mesh key={k} position={[fx, fy, 0.022]}>
              <planeGeometry args={[fw, fh]} />
              <meshStandardMaterial color="#2E3540" roughness={0.35} metalness={0.62} />
            </mesh>
          ))}
          {/* 窗台板 + 滴水线（drip-edge metal cap on sill） */}
          <mesh position={[0, -w.winH / 2 - 0.040, 0.055]} castShadow>
            <boxGeometry args={[w.winLen + 0.10, 0.065, 0.130]} />
            <meshStandardMaterial color="#B8B4AC" roughness={0.86} metalness={0.02} />
          </mesh>
          {/* Drip-edge metal cap on sill face */}
          <mesh position={[0, -w.winH / 2 - 0.048, 0.116]}>
            <boxGeometry args={[w.winLen + 0.12, 0.010, 0.010]} />
            <meshStandardMaterial color="#2A2E38" roughness={0.20} metalness={0.92} envMapIntensity={1.8} />
          </mesh>
          {/* 窗楣（concrete lintel above window） */}
          <mesh position={[0, w.winH / 2 + 0.030, 0.050]}>
            <boxGeometry args={[w.winLen + 0.04, 0.048, 0.095]} />
            <meshStandardMaterial color="#C0BCB4" roughness={0.88} metalness={0.01} />
          </mesh>
          {/* 侧边窗口竖向内衬（jamb reveals — adds visual depth to the reveal） */}
          {([-w.winLen / 2, w.winLen / 2] as number[]).map((jx, ji) => (
            <mesh key={`jamb-${ji}`} position={[jx + (ji === 0 ? 0.040 : -0.040), 0, -0.025]}>
              <boxGeometry args={[0.080, w.winH - 0.04, 0.090]} />
              <meshStandardMaterial color="#BCBAB2" roughness={0.90} metalness={0.01} />
            </mesh>
          ))}
          {/* 窗台花箱（window flower box）—— 70% 的窗户下加一个铁艺花箱，带土壤和灌木
              用确定性 hash 决定哪些窗有花箱，避免 Math.random() */}
          {panelBlindHash(wi * 7, wi * 3 + 1) < 0.70 && (
            <group position={[0, -w.winH / 2 - 0.095, 0.065]}>
              {/* Box body — wrought iron / dark charcoal */}
              <mesh castShadow>
                <boxGeometry args={[w.winLen + 0.04, 0.18, 0.18]} />
                <meshStandardMaterial color="#2A2C34" roughness={0.55} metalness={0.52} envMapIntensity={1.2} />
              </mesh>
              {/* Soil surface */}
              <mesh position={[0, 0.095, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[w.winLen + 0.02, 0.16]} />
                <meshStandardMaterial color="#2A1A0E" roughness={0.98} />
              </mesh>
              {/* Plant foliage — green base mound */}
              {Array.from({ length: Math.max(2, Math.round(w.winLen / 0.55)) }, (_, pi) => {
                const px3 = -w.winLen / 2 + 0.28 + pi * (w.winLen / Math.max(1, Math.round(w.winLen / 0.55) - 0));
                const greenTone = panelBlindHash(wi + pi * 5, wi * 2 + pi) < 0.5 ? "#2E6820" : "#4A8030";
                return (
                  <mesh key={pi} position={[px3, 0.12, 0]} castShadow>
                    <sphereGeometry args={[0.10 + panelBlindHash(pi, wi + 3) * 0.05, 6, 5]} />
                    <meshStandardMaterial color={greenTone} roughness={0.96} />
                  </mesh>
                );
              })}
              {/* Flower blooms — colorful dots above foliage */}
              {Array.from({ length: Math.max(3, Math.round(w.winLen / 0.38)) }, (_, fi) => {
                const fx3 = -w.winLen / 2 + 0.18 + fi * (w.winLen - 0.16) / Math.max(2, Math.round(w.winLen / 0.38) - 1);
                // Deterministic flower color: geranium red, bougainvillea pink, petunia purple, white
                const flHash = panelBlindHash(wi * 13 + fi * 7, wi + fi * 3);
                const flColor = flHash < 0.30 ? "#E83040" : flHash < 0.55 ? "#E85090" : flHash < 0.75 ? "#9940CC" : "#F0F0F0";
                return (
                  <mesh key={`fl-${fi}`} position={[fx3, 0.195, 0.012]} castShadow>
                    <sphereGeometry args={[0.040 + flHash * 0.018, 5, 4]} />
                    <meshStandardMaterial color={flColor} roughness={0.92} emissive={flColor} emissiveIntensity={0.08} />
                  </mesh>
                );
              })}
            </group>
          )}
        </group>
        );
      })}
    </group>
  );
}

// ── 合并相邻共面外墙段 ────────────────────────────────────────────
interface FacadeBlock {
  floorIndex: number;
  side: WallSide;
  wallCoord: number;   // plan-Y for south/north; plan-X for east/west
  mergedStart: number; // plan-axis start of merged span
  mergedEnd:   number;
  primaryRoom: RoomType;  // first room in the merged block (for glass click)
  rooms: RoomType[];      // distinct rooms covered by this merged block
  doorEntries: Array<{ roomWallStart: number; d: DoorConfig; room: RoomType }>;
  winEntries:  Array<{ roomWallStart: number; w: WindowConfig; room: RoomType }>;
}

function buildFacadeBlocks(segs: ExteriorWallSeg[]): FacadeBlock[] {
  // Group by (floorIndex, side, wallCoord)
  const planes = new Map<string, { fi: number; side: WallSide; wc: number; segs: ExteriorWallSeg[] }>();
  for (const seg of segs) {
    const wc = seg.side === "south" ? seg.roomY + seg.roomD
             : seg.side === "north" ? seg.roomY
             : seg.side === "east"  ? seg.roomX + seg.roomW
             :                        seg.roomX;
    const key = `${seg.floorIndex}:${seg.side}:${wc}`;
    if (!planes.has(key)) planes.set(key, { fi: seg.floorIndex, side: seg.side, wc, segs: [] });
    planes.get(key)!.segs.push(seg);
  }

  const result: FacadeBlock[] = [];
  for (const { fi, side, wc, segs: pSegs } of planes.values()) {
    const sorted = [...pSegs].sort((a, b) => a.segStart - b.segStart);
    const groups: ExteriorWallSeg[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const last = groups[groups.length - 1];
      const lastEnd = Math.max(...last.map(s => s.segEnd));
      if (sorted[i].segStart - lastEnd <= TOLE * 3) {
        last.push(sorted[i]);
      } else {
        groups.push([sorted[i]]);
      }
    }
    const isHoriz = side === "south" || side === "north";
    for (const grp of groups) {
      const mergedStart = Math.min(...grp.map(s => s.segStart));
      const mergedEnd   = Math.max(...grp.map(s => s.segEnd));
      const doorEntries = grp.flatMap(seg => {
        const rws = isHoriz ? seg.roomX : seg.roomY;
        return seg.doors.map(d => ({ roomWallStart: rws, d, room: seg.room }));
      });
      const winEntries = grp.flatMap(seg => {
        const rws = isHoriz ? seg.roomX : seg.roomY;
        return seg.windows.map(w => ({ roomWallStart: rws, w, room: seg.room }));
      });
      const primaryRoom = grp[0].room;
      const rooms = Array.from(new Set(grp.map(s => s.room)));
      result.push({ floorIndex: fi, side, wallCoord: wc, mergedStart, mergedEnd, primaryRoom, rooms, doorEntries, winEntries });
    }
  }
  return result;
}

// ── 平屋顶 ────────────────────────────────────────────────────
function FlatRoof({ W, D, roofY, nightGlow = 0 }: { W: number; D: number; roofY: number; nightGlow?: number }) {
  const OV = 0.45;   // 悬挑
  const OV_S = 0.75; // 南向多悬挑
  const PH = 0.30;   // 女儿墙高度
  const PT = 0.12;   // 女儿墙厚度
  const roofColor    = "#F0EDE8";
  const parapetColor = "#E8E4DE";
  const roofSlab     = roofY + 0.05;  // 屋面板中心Y
  return (
    <group>
      {/* 屋面板 */}
      <mesh position={[0, roofSlab, -(OV_S - OV) / 2]} castShadow receiveShadow>
        <boxGeometry args={[W + OV * 2, 0.10, D + OV_S + OV]} />
        <meshStandardMaterial color={roofColor} roughness={0.88} />
      </mesh>
      {/* 女儿墙 — 四边 */}
      <mesh position={[0,   roofSlab + 0.05 + PH / 2,  D / 2]} castShadow>
        <boxGeometry args={[W, PH, PT]} />
        <meshStandardMaterial color={parapetColor} roughness={0.85} />
      </mesh>
      <mesh position={[0,   roofSlab + 0.05 + PH / 2, -D / 2]} castShadow>
        <boxGeometry args={[W, PH, PT]} />
        <meshStandardMaterial color={parapetColor} roughness={0.85} />
      </mesh>
      <mesh position={[ W / 2, roofSlab + 0.05 + PH / 2, 0]} castShadow>
        <boxGeometry args={[PT, PH, D]} />
        <meshStandardMaterial color={parapetColor} roughness={0.85} />
      </mesh>
      <mesh position={[-W / 2, roofSlab + 0.05 + PH / 2, 0]} castShadow>
        <boxGeometry args={[PT, PH, D]} />
        <meshStandardMaterial color={parapetColor} roughness={0.85} />
      </mesh>
      {/* 屋顶边缘影线 */}
      <mesh position={[0, roofY - 0.005, -(OV_S - OV) / 2]}>
        <boxGeometry args={[W + OV * 2 + 0.005, 0.01, D + OV_S + OV + 0.005]} />
        <meshStandardMaterial color="#D8D4CE" roughness={0.85} />
      </mesh>
      {/* 女儿墙顶面金属压盖（parapet cap flashing — dark anodized aluminum） */}
      {[
        { w: W + 0.02,  d: PT + 0.02, x: 0,        z:  D / 2 },
        { w: W + 0.02,  d: PT + 0.02, x: 0,        z: -D / 2 },
        { w: PT + 0.02, d: D + 0.02,  x:  W / 2,   z: 0 },
        { w: PT + 0.02, d: D + 0.02,  x: -W / 2,   z: 0 },
      ].map((c, i) => (
        <mesh key={i} position={[c.x, roofSlab + 0.05 + PH + 0.005, c.z]}>
          <boxGeometry args={[c.w, 0.012, c.d]} />
          <meshStandardMaterial color="#2E3240" roughness={0.22} metalness={0.90} envMapIntensity={2.0} />
        </mesh>
      ))}
      {/* ── 女儿墙顶部玻璃护栏（parapet-top glass balustrade）──
           Frameless glass panels on stainless-steel mini-posts sit on top of
           the concrete parapet, extending the effective railing height to ~0.72m
           above the parapet cap. Panels face inward (toward roof terrace).
           Posts are square 40mm brushed steel, spaced ~1.2m on all four sides. */}
      {(() => {
        const parapetTopY  = roofSlab + 0.05 + PH + 0.012;  // top of parapet cap flashing
        const glassH       = 0.42;    // glass panel height above parapet cap
        const glassT       = 0.010;   // glass panel thickness
        const postS        = 0.040;   // post cross-section
        const postH        = glassH + 0.055;  // post stands above glass top rail
        const topRailT     = 0.030;
        const glassEmi     = nightGlow > 0.4 ? 0.10 : 0.0;

        // Generate posts along N, S, E, W sides
        function sideRailing(len: number, posX: number, posZ: number, axisX: boolean) {
          const inset = PT / 2 + postS / 2;   // post stands on parapet top, inset from outer edge
          const postCount = Math.max(3, Math.round(len / 1.20));
          return Array.from({ length: postCount }, (_, pi) => {
            const t = pi / (postCount - 1);
            const off = -len / 2 + t * len;
            const px = axisX ? off : posX;
            const pz = axisX ? posZ : off;
            return { px, pz };
          });
        }

        const sidesData = [
          { len: W, posX: 0,         posZ:  D / 2 - PT / 2, axisX: true  },  // north
          { len: W, posX: 0,         posZ: -D / 2 + PT / 2, axisX: true  },  // south
          { len: D, posX:  W / 2 - PT / 2, posZ: 0,         axisX: false },  // east
          { len: D, posX: -W / 2 + PT / 2, posZ: 0,         axisX: false },  // west
        ] as { len: number; posX: number; posZ: number; axisX: boolean }[];

        return (
          <group>
            {sidesData.flatMap((side, si) => {
              const posts = sideRailing(side.len, side.posX, side.posZ, side.axisX);
              const glassSegCount = posts.length - 1;
              return [
                // Posts
                ...posts.map(({ px, pz }, pi) => (
                  <mesh key={`post-${si}-${pi}`} position={[px, parapetTopY + postH / 2, pz]} castShadow>
                    <boxGeometry args={[side.axisX ? postS : postS, postH, side.axisX ? postS : postS]} />
                    <meshStandardMaterial color="#9AA0A8" roughness={0.18} metalness={0.88} envMapIntensity={2.5} />
                  </mesh>
                )),
                // Glass panels between posts
                ...Array.from({ length: glassSegCount }, (_, gi) => {
                  const p0 = posts[gi];
                  const p1 = posts[gi + 1];
                  const mx = (p0.px + p1.px) / 2;
                  const mz = (p0.pz + p1.pz) / 2;
                  const segLen = side.axisX
                    ? Math.abs(p1.px - p0.px) - postS - 0.01
                    : Math.abs(p1.pz - p0.pz) - postS - 0.01;
                  return (
                    <mesh key={`glass-${si}-${gi}`} position={[mx, parapetTopY + glassH / 2 + 0.01, mz]} renderOrder={12}>
                      <boxGeometry args={side.axisX
                        ? [segLen, glassH, glassT]
                        : [glassT, glassH, segLen]} />
                      <meshStandardMaterial
                        color="#C8DCE8"
                        transparent opacity={0.25}
                        roughness={0.02} metalness={0.06}
                        envMapIntensity={5.0}
                        emissive="#A0C4DC" emissiveIntensity={glassEmi}
                        side={THREE.DoubleSide}
                        depthWrite={false}
                      />
                    </mesh>
                  );
                }),
                // Top handrail
                <mesh key={`rail-${si}`}
                  position={[side.posX, parapetTopY + postH - topRailT / 2, side.posZ]}
                  castShadow
                >
                  <boxGeometry args={side.axisX
                    ? [side.len, topRailT, topRailT]
                    : [topRailT, topRailT, side.len]} />
                  <meshStandardMaterial color="#B8C0C8" roughness={0.14} metalness={0.92} envMapIntensity={3.0} />
                </mesh>,
              ];
            })}
          </group>
        );
      })()}

      {/* ── 女儿墙内侧 LED 灯槽（parapet interior cove light）——
           现代平屋顶标配：屋顶有人使用时，女儿墙内侧 LED 提供弥散照明。
           材质：薄铝槽 + 白色 LED 条 + 向上泛光 */}
      {(() => {
        const coveH  = 0.032;   // LED strip height
        const coveT  = 0.015;   // strip depth
        const coveY  = roofSlab + 0.05 + 0.04;  // just above slab surface, at parapet base
        const coveColor = "#E8F4FF";
        const coveEmi   = "#D0E8FF";
        // Parapet cove light: subtle during day, bright at night
        const coveI = 0.25 + nightGlow * 0.70;
        return (
          <group>
            {/* South inner parapet cove */}
            <mesh position={[0, coveY, D / 2 - 0.08]}>
              <boxGeometry args={[W - 0.28, coveH, coveT]} />
              <meshStandardMaterial color={coveColor} emissive={coveEmi} emissiveIntensity={coveI} roughness={0.6} />
            </mesh>
            {/* East inner parapet cove */}
            <mesh position={[W / 2 - 0.08, coveY, 0]}>
              <boxGeometry args={[coveT, coveH, D - 0.28]} />
              <meshStandardMaterial color={coveColor} emissive={coveEmi} emissiveIntensity={coveI} roughness={0.6} />
            </mesh>
            {/* West inner parapet cove */}
            <mesh position={[-W / 2 + 0.08, coveY, 0]}>
              <boxGeometry args={[coveT, coveH, D - 0.28]} />
              <meshStandardMaterial color={coveColor} emissive={coveEmi} emissiveIntensity={coveI} roughness={0.6} />
            </mesh>
            {/* North inner parapet cove */}
            <mesh position={[0, coveY, -D / 2 + 0.08]}>
              <boxGeometry args={[W - 0.28, coveH, coveT]} />
              <meshStandardMaterial color={coveColor} emissive={coveEmi} emissiveIntensity={coveI} roughness={0.6} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 屋顶排水口（roof drain scupper）—— 东西女儿墙各一个穿墙排水管 ── */}
      {([[ W / 2 + 0.04, D * 0.15], [-W / 2 - 0.04, -D * 0.15]] as [number,number][]).map(([sx, sz], si) => (
        <group key={`scupper-${si}`} position={[sx, roofSlab + 0.05 + 0.08, sz]}>
          {/* Scupper tube */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.042, 0.042, 0.18, 8]} />
            <meshStandardMaterial color="#5A6070" roughness={0.55} metalness={0.45} />
          </mesh>
          {/* Drip lip */}
          <mesh position={[si === 0 ? 0.092 : -0.092, -0.022, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.052, 0.052, 0.018, 8]} />
            <meshStandardMaterial color="#484E5C" roughness={0.50} metalness={0.48} />
          </mesh>
        </group>
      ))}

      {/* ── 屋顶绿化区（intensive green roof zone + boardwalk）──
           North-west quadrant of roof: sedum/grass carpet, mixed ornamental
           plants, wooden boardwalk path, and planters. */}
      {(() => {
        const grX   = -W * 0.18;   // centre of green zone (west of skylight)
        const grZ   =  D * 0.14;   // north half
        const grW   = Math.min(W * 0.42, 5.50);
        const grD   = Math.min(D * 0.38, 4.20);
        const grY   = roofSlab + 0.05;
        return (
          <group position={[grX, grY, grZ]}>
            {/* ── Green substrate (sedum carpet) ── */}
            <mesh position={[0, 0.045, 0]} receiveShadow>
              <boxGeometry args={[grW, 0.090, grD]} />
              <meshStandardMaterial color="#3A6420" roughness={0.98} metalness={0.0} />
            </mesh>
            {/* Surface texture — lighter green patches */}
            {Array.from({ length: 16 }, (_, gi) => {
              const gHash = (gi * 17 + 5) % 13;
              const gx = -grW / 2 + 0.30 + (gi % 4) * (grW - 0.60) / 3;
              const gz = -grD / 2 + 0.30 + Math.floor(gi / 4) * (grD - 0.60) / 3;
              return (
                <mesh key={gi} position={[gx + (gHash - 6) * 0.08, 0.092, gz + (gHash % 4 - 2) * 0.08]}>
                  <sphereGeometry args={[0.28 + (gHash % 3) * 0.07, 5, 3]} />
                  <meshStandardMaterial color={gHash % 2 === 0 ? "#4A7828" : "#2E5A14"} roughness={0.98} />
                </mesh>
              );
            })}

            {/* ── Wooden boardwalk — 5 deck boards crossing E-W ── */}
            {Array.from({ length: 5 }, (_, bi) => {
              const bz = -grD / 2 + 0.35 + bi * (grD - 0.70) / 4;
              return (
                <mesh key={bi} position={[0, 0.115, bz]} castShadow>
                  <boxGeometry args={[grW * 0.70, 0.028, 0.14]} />
                  <meshStandardMaterial color="#8B6240" roughness={0.80} metalness={0.05}
                    emissive="#4A2C10" emissiveIntensity={0.04} />
                </mesh>
              );
            })}
            {/* Boardwalk side stringers */}
            {([-grW * 0.355, grW * 0.355] as number[]).map((sx, si) => (
              <mesh key={si} position={[sx, 0.112, 0]} castShadow>
                <boxGeometry args={[0.040, 0.022, grD * 0.70]} />
                <meshStandardMaterial color="#6A4828" roughness={0.75} metalness={0.06} />
              </mesh>
            ))}

            {/* ── Rectangular raised planter boxes at corners ── */}
            {([[-grW * 0.38, -grD * 0.38], [grW * 0.38, -grD * 0.38]] as [number,number][]).map(([px, pz], pi) => (
              <group key={pi} position={[px, 0.092, pz]}>
                {/* Planter body — weathering steel */}
                <mesh castShadow>
                  <boxGeometry args={[0.80, 0.32, 0.44]} />
                  <meshStandardMaterial color="#6A4830" roughness={0.65} metalness={0.38} />
                </mesh>
                {/* Soil surface */}
                <mesh position={[0, 0.155, 0]}>
                  <boxGeometry args={[0.76, 0.010, 0.40]} />
                  <meshStandardMaterial color="#2A1A08" roughness={0.98} />
                </mesh>
                {/* 3 small ornamental plants */}
                {[-0.22, 0, 0.22].map((ox, oi) => (
                  <mesh key={oi} position={[ox, 0.30, 0]}>
                    <sphereGeometry args={[0.14 + (oi % 2) * 0.04, 5, 4]} />
                    <meshStandardMaterial color={oi === 1 ? "#8090A0" : "#3A5A28"} roughness={0.90} />
                  </mesh>
                ))}
              </group>
            ))}

            {/* ── 4 ornamental grasses along boardwalk edge ── */}
            {[[-grW * 0.20, 0], [grW * 0.20, 0], [0, -grD * 0.28], [0, grD * 0.28]].map(([ox, oz], oi) => (
              <group key={oi} position={[ox as number, 0.10, oz as number]}>
                {Array.from({ length: 7 }, (_, gi) => {
                  const ga = (gi * Math.PI * 2) / 7;
                  return (
                    <mesh key={gi} position={[Math.cos(ga) * 0.08, 0.28, Math.sin(ga) * 0.08]}
                      rotation={[Math.sin(ga) * 0.35, 0, Math.cos(ga) * 0.35]}>
                      <boxGeometry args={[0.012, 0.55, 0.006]} />
                      <meshStandardMaterial color="#8AAA40" roughness={0.90} />
                    </mesh>
                  );
                })}
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 线性天窗（linear skylight）— 南向采光，钢框 + 夹胶玻璃 ── */}
      {(() => {
        const slW = Math.min(W * 0.45, 5.0);  // skylight width
        const slD = 0.90;                       // skylight depth (north-south)
        const slY = roofSlab + 0.055;          // sits on roof slab
        const slZ = -D * 0.18;                 // south-leaning position
        return (
          <group position={[0, slY, slZ]}>
            {/* Frame curb — dark aluminum channel */}
            <mesh position={[0, 0.045, 0]} castShadow>
              <boxGeometry args={[slW + 0.06, 0.09, slD + 0.06]} />
              <meshStandardMaterial color="#1E2028" roughness={0.20} metalness={0.92} envMapIntensity={2.2} />
            </mesh>
            {/* Glass infill — laminated glass, slight blue-green tint */}
            <mesh position={[0, 0.094, 0]}>
              <boxGeometry args={[slW - 0.02, 0.012, slD - 0.02]} />
              <meshStandardMaterial
                color="#AACCD8"
                transparent opacity={0.58}
                roughness={0.04} metalness={0.06}
                envMapIntensity={3.5}
                emissive="#60B0C8" emissiveIntensity={0.06}
              />
            </mesh>
            {/* Interior glow — simulates light shaft from below */}
            <pointLight position={[0, -0.30, 0]} intensity={2.0} distance={4.0} decay={2.0} color="#D8F0FF" />
            {/* Longitudinal mullion dividers (3 sections) */}
            {([-slW * 0.28, 0, slW * 0.28] as number[]).map((mx, mi) => (
              <mesh key={mi} position={[mx, 0.094, 0]}>
                <boxGeometry args={[0.028, 0.016, slD - 0.02]} />
                <meshStandardMaterial color="#1E2028" roughness={0.18} metalness={0.94} envMapIntensity={2.0} />
              </mesh>
            ))}
          </group>
        );
      })()}

      {/* ── HVAC 冷凝器组（2 台并排，带风扇格栅）── */}
      {([[-W * 0.30, D * 0.18], [-W * 0.16, D * 0.18]] as [number,number][]).map(([hvx, hvz], hi) => (
        <group key={`hv-${hi}`} position={[hvx, roofSlab + 0.04, hvz]}>
          {/* 机体箱 — 浅灰色蒙皮，略带金属感 */}
          <mesh castShadow>
            <boxGeometry args={[0.90, 0.68, 0.90]} />
            <meshStandardMaterial color="#C4C0B8" roughness={0.70} metalness={0.18} envMapIntensity={0.8} />
          </mesh>
          {/* 顶部风扇圆格栅 */}
          <mesh position={[0, 0.346, 0]}>
            <cylinderGeometry args={[0.30, 0.30, 0.012, 16]} />
            <meshStandardMaterial color="#888480" roughness={0.40} metalness={0.60} />
          </mesh>
          {/* 格栅线（叶片感）*/}
          {Array.from({ length: 6 }, (_, gi) => {
            const ga = (gi / 6) * Math.PI;
            return (
              <mesh key={gi} position={[Math.cos(ga) * 0.14, 0.352, Math.sin(ga) * 0.14]} rotation={[0, ga, 0]}>
                <boxGeometry args={[0.56, 0.008, 0.025]} />
                <meshStandardMaterial color="#606060" roughness={0.50} metalness={0.55} />
              </mesh>
            );
          })}
          {/* 侧面百叶（前面板） */}
          {Array.from({ length: 6 }, (_, li) => (
            <mesh key={li} position={[0, -0.24 + li * 0.090, 0.458]}>
              <boxGeometry args={[0.80, 0.022, 0.045]} />
              <meshStandardMaterial color="#AEAAA4" roughness={0.72} metalness={0.14} />
            </mesh>
          ))}
        </group>
      ))}
      {/* ── 光伏板阵列（solar PV array）— 朝南倾斜 18°，3×5 矩阵 ── */}
      {(() => {
        const pvCols = 5, pvRows = 3;
        const pvW = 1.08, pvH = 1.70, pvGap = 0.06;
        const pvTilt = 0.32;   // tilt angle (radians, ≈ 18°)
        const arrW = pvCols * (pvW + pvGap) - pvGap;
        const arrDepth = pvRows * (pvH + pvGap) - pvGap;  // total depth along tilt axis
        const arrX = W * 0.22;
        const arrZ = D * 0.24;
        const arrY = roofSlab + 0.14;
        return (
          <group position={[arrX, arrY, arrZ]} rotation={[pvTilt, 0, 0]}>
            {/* Racking rails — 2 horizontal aluminium beams spanning full array width */}
            {[pvH * 0.25 - arrDepth / 2, pvH * 0.75 - arrDepth / 2 + (pvRows - 1) * (pvH + pvGap) * 0.5].map((rz, ri) => (
              <mesh key={ri} position={[0, 0, rz]} castShadow>
                <boxGeometry args={[arrW + 0.12, 0.04, 0.055]} />
                <meshStandardMaterial color="#4A5060" roughness={0.42} metalness={0.62} />
              </mesh>
            ))}
            {/* PV panels grid — 3 rows × 5 columns, each row offset along Z */}
            {Array.from({ length: pvRows }, (_, ri) =>
              Array.from({ length: pvCols }, (_, ci) => {
                const px = -arrW / 2 + ci * (pvW + pvGap) + pvW / 2;
                const pz = -arrDepth / 2 + ri * (pvH + pvGap) + pvH / 2;
                return (
                  <group key={`pv-${ri}-${ci}`} position={[px, 0, pz]}>
                    {/* Panel frame — dark anodized aluminium */}
                    <mesh castShadow>
                      <boxGeometry args={[pvW, pvH, 0.032]} />
                      <meshStandardMaterial color="#2C3040" roughness={0.35} metalness={0.55} />
                    </mesh>
                    {/* Glass cell surface — dark blue monocrystalline silicon */}
                    <mesh position={[0, 0, 0.018]}>
                      <boxGeometry args={[pvW - 0.04, pvH - 0.04, 0.008]} />
                      <meshStandardMaterial
                        color="#1A1E2E"
                        roughness={0.08} metalness={0.18}
                        envMapIntensity={3.0}
                        emissive="#0E1422" emissiveIntensity={0.06}
                      />
                    </mesh>
                    {/* Cell grid lines — 5 horizontal busbars */}
                    {Array.from({ length: 5 }, (_, li) => {
                      const ly = -pvH / 2 + (li + 1) * (pvH / 6);
                      return (
                        <mesh key={li} position={[0, ly, 0.023]}>
                          <boxGeometry args={[pvW - 0.05, 0.008, 0.004]} />
                          <meshStandardMaterial color="#3A4260" roughness={0.28} metalness={0.42} />
                        </mesh>
                      );
                    })}
                  </group>
                );
              })
            )}
          </group>
        );
      })()}
      {/* ── 通风管道组（3 根，高度不一，北侧机房区）── */}
      {([
        [W * 0.10, -D * 0.10, 0.50, 0.08, 0.10],
        [W * 0.14, -D * 0.08, 0.70, 0.055, 0.065],
        [W * 0.06, -D * 0.14, 0.40, 0.065, 0.075],
      ] as [number,number,number,number,number][]).map(([ex, ez, eH, rt, rb], ei) => (
        <group key={`exhaust-${ei}`} position={[ex, roofSlab + 0.05 + eH / 2, ez]}>
          {/* Main stack */}
          <mesh castShadow>
            <cylinderGeometry args={[rt, rb, eH, 8]} />
            <meshStandardMaterial color="#606468" roughness={0.60} metalness={0.30} />
          </mesh>
          {/* Cap cowl */}
          <mesh position={[0, eH / 2 + 0.04, 0]}>
            <cylinderGeometry args={[rt + 0.025, rt + 0.006, 0.080, 8]} />
            <meshStandardMaterial color="#484C52" roughness={0.55} metalness={0.38} />
          </mesh>
        </group>
      ))}

      {/* ── 屋顶避雷针 + 铜接地带（lightning rod + copper earthing tape）──
           Galvanised steel rod (0.5m) at roof NW corner + two copper
           tape strips running along parapet top to down-conductors. */}
      {(() => {
        const lrX = -W / 2 + 0.10;
        const lrZ = -D / 2 + 0.10;
        const lrY = roofSlab + 0.05 + 0.05 / 2 + 0.30;
        return (
          <group>
            {/* Rod base clamp */}
            <mesh position={[lrX, roofSlab + 0.05 + 0.020, lrZ]}>
              <boxGeometry args={[0.055, 0.040, 0.055]} />
              <meshStandardMaterial color="#607080" roughness={0.35} metalness={0.72} />
            </mesh>
            {/* Rod shaft */}
            <mesh position={[lrX, lrY, lrZ]} castShadow>
              <cylinderGeometry args={[0.007, 0.010, 0.60, 6]} />
              <meshStandardMaterial color="#9AAAB4" roughness={0.25} metalness={0.82} />
            </mesh>
            {/* Tip ball */}
            <mesh position={[lrX, lrY + 0.32, lrZ]}>
              <sphereGeometry args={[0.012, 6, 4]} />
              <meshStandardMaterial color="#C0D0D8" roughness={0.18} metalness={0.88} envMapIntensity={2.5} />
            </mesh>
            {/* Copper earthing tape along south parapet top */}
            <mesh position={[0, roofSlab + 0.05 + 0.302, -D / 2 + 0.02]}>
              <boxGeometry args={[W - 0.06, 0.006, 0.014]} />
              <meshStandardMaterial color="#B87040" roughness={0.28} metalness={0.80} envMapIntensity={2.0} />
            </mesh>
            {/* Copper tape along west parapet top */}
            <mesh position={[-W / 2 + 0.02, roofSlab + 0.05 + 0.302, 0]}>
              <boxGeometry args={[0.014, 0.006, D - 0.06]} />
              <meshStandardMaterial color="#B87040" roughness={0.28} metalness={0.80} envMapIntensity={2.0} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 通信天线杆（roof communication antenna mast）── */}
      {(() => {
        const antX = -W * 0.38;
        const antZ =  D * 0.30;   // north-west, away from terrace
        const antY = roofSlab + 0.05;
        const mH   = 1.60;   // mast height
        return (
          <group position={[antX, antY, antZ]}>
            {/* Base flange plate */}
            <mesh position={[0, 0.015, 0]}>
              <boxGeometry args={[0.14, 0.030, 0.14]} />
              <meshStandardMaterial color="#484C58" roughness={0.40} metalness={0.72} />
            </mesh>
            {/* Mast pole */}
            <mesh position={[0, mH / 2 + 0.03, 0]} castShadow>
              <cylinderGeometry args={[0.016, 0.020, mH, 6]} />
              <meshStandardMaterial color="#3C4050" roughness={0.30} metalness={0.80} />
            </mesh>
            {/* Small dish — tilted 20° south */}
            <group position={[0, mH + 0.05, 0]} rotation={[0.35, 0, 0]}>
              <mesh>
                <cylinderGeometry args={[0.18, 0.18, 0.012, 12]} />
                <meshStandardMaterial color="#B8C0CC" roughness={0.45} metalness={0.52} side={THREE.DoubleSide} />
              </mesh>
              {/* Dish arm */}
              <mesh position={[0, 0.10, -0.10]}>
                <cylinderGeometry args={[0.008, 0.008, 0.22, 6]} />
                <meshStandardMaterial color="#8A9098" roughness={0.40} metalness={0.65} />
              </mesh>
            </group>
            {/* 3 guy-wire lines (thin boxes — cylinder would need many segments) */}
            {([0, 120, 240] as number[]).map((deg, gi) => {
              const radians = (deg * Math.PI) / 180;
              const wireX = Math.sin(radians) * 0.55;
              const wireZ = Math.cos(radians) * 0.55;
              const wireLen = Math.sqrt(wireX * wireX + (mH * 0.65) * (mH * 0.65) + wireZ * wireZ);
              const wireAngle = Math.atan2(mH * 0.65, 0.55);
              return (
                <mesh key={gi}
                  position={[wireX / 2, mH * 0.35, wireZ / 2]}
                  rotation={[wireAngle, radians, 0]}>
                  <boxGeometry args={[0.006, wireLen, 0.006]} />
                  <meshStandardMaterial color="#505860" roughness={0.60} metalness={0.55} />
                </mesh>
              );
            })}
          </group>
        );
      })()}

      {/* ── 屋顶气象站（rooftop weather station）──
           Professional AWS tower near north-east corner of roof.
           Equipment: cup anemometer, wind vane, tipping bucket rain gauge,
           solar radiation shield with temperature sensor, data logger box.
           Mounted on a galvanised pole with equipment cross-arm. */}
      {(() => {
        const wsX = W * 0.42;
        const wsZ = D * 0.35;    // north-east, away from PV array and helipad
        const wsY = roofSlab + 0.05;
        const poleH = 1.80;
        return (
          <group position={[wsX, wsY, wsZ]}>
            {/* ── Base mounting bracket plate ── */}
            <mesh position={[0, 0.018, 0]}>
              <boxGeometry args={[0.16, 0.036, 0.16]} />
              <meshStandardMaterial color="#505860" roughness={0.40} metalness={0.70} />
            </mesh>
            {/* ── Main galvanised pole ── */}
            <mesh position={[0, poleH / 2 + 0.036, 0]} castShadow>
              <cylinderGeometry args={[0.018, 0.022, poleH, 6]} />
              <meshStandardMaterial color="#9AAAB4" roughness={0.28} metalness={0.78} />
            </mesh>

            {/* ── Equipment cross-arm (horizontal boom) ── */}
            <mesh position={[0, poleH * 0.72, 0]}>
              <boxGeometry args={[0.65, 0.018, 0.018]} />
              <meshStandardMaterial color="#8A9AA4" roughness={0.30} metalness={0.75} />
            </mesh>

            {/* ── Cup anemometer (east arm tip) ── */}
            <group position={[0.30, poleH * 0.72 + 0.15, 0]}>
              {/* Vertical shaft */}
              <mesh>
                <cylinderGeometry args={[0.008, 0.008, 0.22, 6]} />
                <meshStandardMaterial color="#606870" roughness={0.35} metalness={0.70} />
              </mesh>
              {/* 3 horizontal spokes + cups */}
              {([0, 120, 240] as number[]).map((deg, ci) => {
                const rad = (deg * Math.PI) / 180;
                const sx = Math.cos(rad) * 0.060;
                const sz = Math.sin(rad) * 0.060;
                return (
                  <group key={ci}>
                    {/* Spoke */}
                    <mesh position={[sx / 2, 0.055, sz / 2]} rotation={[0, -rad, 0]}>
                      <boxGeometry args={[0.12, 0.006, 0.006]} />
                      <meshStandardMaterial color="#707880" roughness={0.30} metalness={0.72} />
                    </mesh>
                    {/* Cup (truncated hemisphere approximated as half-sphere by scaling) */}
                    <mesh position={[sx * 1.7, 0.055, sz * 1.7]}>
                      <sphereGeometry args={[0.028, 6, 4]} />
                      <meshStandardMaterial color="#C8D0D8" roughness={0.20} metalness={0.80} />
                    </mesh>
                  </group>
                );
              })}
            </group>

            {/* ── Wind vane (west arm tip) ── */}
            <group position={[-0.28, poleH * 0.72 + 0.08, 0]}>
              {/* Pivot shaft */}
              <mesh position={[0, 0.060, 0]}>
                <cylinderGeometry args={[0.007, 0.007, 0.12, 6]} />
                <meshStandardMaterial color="#606870" roughness={0.35} metalness={0.70} />
              </mesh>
              {/* Arrow tail fin */}
              <mesh position={[0.055, 0.120, 0]} rotation={[0, 0, 0.12]}>
                <boxGeometry args={[0.16, 0.008, 0.05]} />
                <meshStandardMaterial color="#D0D8E0" roughness={0.22} metalness={0.80} />
              </mesh>
              {/* Arrow head (small triangle) */}
              <mesh position={[-0.044, 0.120, 0]}>
                <coneGeometry args={[0.022, 0.055, 4]} />
                <meshStandardMaterial color="#B0B8C4" roughness={0.22} metalness={0.80} />
              </mesh>
            </group>

            {/* ── Tipping-bucket rain gauge (mid-pole) ── */}
            <group position={[0.04, poleH * 0.50, 0.04]}>
              {/* Mounting bracket stub */}
              <mesh position={[0, 0, 0]}>
                <boxGeometry args={[0.045, 0.010, 0.045]} />
                <meshStandardMaterial color="#707880" roughness={0.40} metalness={0.68} />
              </mesh>
              {/* Gauge funnel cylinder */}
              <mesh position={[0, 0.065, 0]}>
                <cylinderGeometry args={[0.042, 0.055, 0.085, 10]} />
                <meshStandardMaterial color="#E0E4E8" roughness={0.20} metalness={0.60} />
              </mesh>
              {/* Gauge body */}
              <mesh position={[0, 0.018, 0]}>
                <cylinderGeometry args={[0.032, 0.032, 0.040, 8]} />
                <meshStandardMaterial color="#B8C0CC" roughness={0.25} metalness={0.65} />
              </mesh>
            </group>

            {/* ── Solar radiation shield (temperature sensor housing) ── */}
            <group position={[-0.04, poleH * 0.38, -0.04]}>
              {/* Stack of louvred discs */}
              {[0, 0.026, 0.052].map((dy, di) => (
                <mesh key={di} position={[0, dy, 0]}>
                  <cylinderGeometry args={[0.050, 0.062, 0.018, 10]} />
                  <meshStandardMaterial color="#F0F0EC" roughness={0.35} metalness={0.25} />
                </mesh>
              ))}
              {/* Sensor rod inside */}
              <mesh position={[0, 0.035, 0]}>
                <cylinderGeometry args={[0.005, 0.005, 0.10, 5]} />
                <meshStandardMaterial color="#808890" roughness={0.40} metalness={0.60} />
              </mesh>
            </group>

            {/* ── Data logger / transmitter box ── */}
            <mesh position={[0, poleH * 0.22, 0.060]} castShadow>
              <boxGeometry args={[0.110, 0.075, 0.060]} />
              <meshStandardMaterial color="#2A2E38" roughness={0.50} metalness={0.45} />
            </mesh>
            {/* Logger status LED */}
            <mesh position={[0.020, poleH * 0.22 + 0.020, 0.092]}>
              <sphereGeometry args={[0.006, 5, 4]} />
              <meshStandardMaterial
                color="#00FF60"
                emissive="#00FF60"
                emissiveIntensity={nightGlow > 0 ? 2.5 : 0.40}
                roughness={0.20} metalness={0.10}
              />
            </mesh>

            {/* ── Cable conduit running down mast ── */}
            <mesh position={[0.024, poleH * 0.30, 0]} rotation={[0, 0, 0]}>
              <cylinderGeometry args={[0.007, 0.007, poleH * 0.60, 4]} />
              <meshStandardMaterial color="#303840" roughness={0.65} metalness={0.25} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 屋顶露台区域（南向，阳光充足）── */}
      {/* 两把日光浴躺椅 — 淡米色，南向摆放，供远处视角可见 */}
      {([[-W * 0.15, 0], [W * 0.15, 0]] as [number,number][]).map(([lx, _lz], li) => (
        <group key={`rl-${li}`} position={[lx, roofSlab + 0.05, -D * 0.28]}>
          {/* 躺椅框架 */}
          <mesh position={[0, 0.19, 0]} castShadow>
            <boxGeometry args={[0.58, 0.06, 1.75]} />
            <meshStandardMaterial color="#B0A888" roughness={0.75} metalness={0.12} />
          </mesh>
          {/* 垫子 */}
          <mesh position={[0, 0.26, 0]}>
            <boxGeometry args={[0.50, 0.09, 1.58]} />
            <meshStandardMaterial color="#F4EEE0" roughness={0.88} />
          </mesh>
          {/* 靠背（略微倾斜）*/}
          <mesh position={[0, 0.35, 0.52]} rotation={[-0.30, 0, 0]}>
            <boxGeometry args={[0.48, 0.07, 0.62]} />
            <meshStandardMaterial color="#F0E8D4" roughness={0.88} />
          </mesh>
          {/* 4 细铝腿 */}
          {([-0.24, 0.24] as number[]).flatMap(lx2 =>
            ([-0.74, 0.74] as number[]).map((lz2, ki) => (
              <mesh key={`${lx2}-${ki}`} position={[lx2, 0.09, lz2]} castShadow>
                <boxGeometry args={[0.036, 0.18, 0.036]} />
                <meshStandardMaterial color="#B0B0B8" roughness={0.22} metalness={0.88} />
              </mesh>
            ))
          )}
        </group>
      ))}
      {/* 躺椅之间的小边桌 — 铝合金 + 玻璃台面 */}
      <group position={[0, roofSlab + 0.05, -D * 0.28]}>
        {/* Table frame */}
        <mesh position={[0, 0.38, 0]}>
          <cylinderGeometry args={[0.28, 0.28, 0.015, 12]} />
          <meshStandardMaterial color="#B8C0CC" roughness={0.20} metalness={0.88} envMapIntensity={2.0} />
        </mesh>
        {/* Pedestal */}
        <mesh position={[0, 0.20, 0]}>
          <cylinderGeometry args={[0.030, 0.040, 0.36, 8]} />
          <meshStandardMaterial color="#A8B0BC" roughness={0.30} metalness={0.78} />
        </mesh>
        {/* Frosted glass top */}
        <mesh position={[0, 0.392, 0]}>
          <cylinderGeometry args={[0.265, 0.265, 0.008, 12]} />
          <meshStandardMaterial color="#C8D8E0" transparent opacity={0.70} roughness={0.04} metalness={0.08} envMapIntensity={3.0} />
        </mesh>
        {/* Drinks — 2 small cylinders (glasses) */}
        {([-0.11, 0.11] as number[]).map((gx, gi) => (
          <mesh key={gi} position={[gx, 0.43, 0]}>
            <cylinderGeometry args={[0.028, 0.022, 0.090, 8]} />
            <meshStandardMaterial color="#A8C8E0" transparent opacity={0.60} roughness={0.04} metalness={0.04} envMapIntensity={2.0} />
          </mesh>
        ))}
      </group>
      {/* ── 屋顶遮阳棚架（pergola）— 铝合金结构，横向遮阳板 ── */}
      {(() => {
        const pgW = Math.min(W * 0.48, 5.8);  // pergola width
        const pgD = 2.40;                       // pergola depth (N-S)
        const pgH = 2.20;                       // height above roof slab
        const pgY = roofSlab + 0.05;            // base Y
        const pgZ = -D * 0.28;                  // south-leaning terrace
        const pgX = -W * 0.13;                  // slightly west of center
        const postColor  = "#3A3C44";
        const louverColor = "#50545E";
        const postW = 0.065, postD = 0.065;
        const louverW = pgW, louverH = 0.042, louverD = 0.014;
        const louverCount = Math.round(pgD / 0.165);
        return (
          <group position={[pgX, pgY, pgZ]}>
            {/* 4 立柱 */}
            {([ [-pgW/2+postW/2, -pgD/2+postD/2],
                [ pgW/2-postW/2, -pgD/2+postD/2],
                [-pgW/2+postW/2,  pgD/2-postD/2],
                [ pgW/2-postW/2,  pgD/2-postD/2],
            ] as [number,number][]).map(([px2, pz2], pi) => (
              <mesh key={pi} position={[px2, pgH / 2, pz2]} castShadow>
                <boxGeometry args={[postW, pgH, postD]} />
                <meshStandardMaterial color={postColor} roughness={0.28} metalness={0.70} envMapIntensity={1.5} />
              </mesh>
            ))}
            {/* 顶部纵梁 (2 条) */}
            {([-pgW/2 + 0.12, pgW/2 - 0.12] as number[]).map((bx, bi) => (
              <mesh key={bi} position={[bx, pgH + 0.04, 0]} castShadow>
                <boxGeometry args={[0.07, 0.08, pgD + 0.12]} />
                <meshStandardMaterial color={postColor} roughness={0.28} metalness={0.70} />
              </mesh>
            ))}
            {/* 横向遮阳条（louvers）*/}
            {Array.from({ length: louverCount }, (_, li) => {
              const lz = -pgD / 2 + li * (pgD / (louverCount - 1));
              return (
                <mesh key={li} position={[0, pgH + 0.08, lz]} castShadow>
                  <boxGeometry args={[louverW, louverH, louverD]} />
                  <meshStandardMaterial color={louverColor} roughness={0.32} metalness={0.62} envMapIntensity={1.2} />
                </mesh>
              );
            })}
            {/* 张拉遮阳膜（tensile shade sail）— 横跨廊架顶部，白色微透明聚酯布 */}
            <mesh position={[0, pgH + 0.094, 0]} renderOrder={10}>
              <boxGeometry args={[pgW - 0.10, 0.008, pgD - 0.10]} />
              <meshStandardMaterial
                color="#F8F4EC"
                transparent opacity={0.52}
                depthWrite={false}
                roughness={0.82}
                metalness={0.01}
                side={THREE.DoubleSide}
                {...overlayMaterialProps(1)}
              />
            </mesh>
            {/* 廊架垂挂紫藤 / 绿植（hanging wisteria vines from pergola beams）
                Small sphere clusters hang from underside of louvers for lush effect. */}
            {Array.from({ length: 10 }, (_, vi) => {
              const vHash = (vi * 7 + 3) % 11;
              const vx = -pgW * 0.40 + vi * (pgW * 0.80 / 9);
              const vz = -pgD * 0.30 + (vHash % 3) * (pgD * 0.30);
              const vLen = 0.22 + (vHash % 5) * 0.045;
              const vCol = vHash % 4 === 0 ? "#9966BB" : vHash % 4 === 1 ? "#AA77CC" : vHash % 4 === 2 ? "#3A7028" : "#2E6022";
              return (
                <group key={`vine-${vi}`} position={[vx, pgH + 0.08, vz]}>
                  {/* Hanging stem */}
                  <mesh position={[0, -vLen / 2, 0]}>
                    <cylinderGeometry args={[0.006, 0.005, vLen, 4]} />
                    <meshStandardMaterial color="#3A2810" roughness={0.92} />
                  </mesh>
                  {/* Foliage/flower cluster at bottom */}
                  <mesh position={[0, -vLen - 0.060, 0]}>
                    <sphereGeometry args={[0.060, 7, 5]} />
                    <meshStandardMaterial color={vCol} roughness={0.95} />
                  </mesh>
                  {/* Secondary cluster */}
                  <mesh position={[0.05, -vLen - 0.038, 0.03]}>
                    <sphereGeometry args={[0.040, 6, 4]} />
                    <meshStandardMaterial color={vCol} roughness={0.96} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })()}
      {/* 屋顶种植箱 — 长方形黑钢槽，搭配多株造型植物 */}
      {([[-W * 0.36, -D * 0.18], [W * 0.36, -D * 0.18]] as [number,number][]).map(([ppx, ppz], pi) => (
        <group key={`rp-${pi}`} position={[ppx, roofSlab + 0.05, ppz]}>
          {/* Planter box — dark steel trough */}
          <mesh position={[0, 0.26, 0]} castShadow>
            <boxGeometry args={[1.20, 0.52, 0.44]} />
            <meshStandardMaterial color="#282A32" roughness={0.55} metalness={0.42} envMapIntensity={1.4} />
          </mesh>
          {/* Soil surface */}
          <mesh position={[0, 0.525, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.14, 0.38]} />
            <meshStandardMaterial color="#2A1A0E" roughness={0.98} />
          </mesh>
          {/* Main rounded shrub */}
          <mesh position={[0, 0.80, 0]} castShadow>
            <sphereGeometry args={[0.30, 10, 8]} />
            <meshStandardMaterial color={pi === 0 ? "#2A6020" : "#224E18"} roughness={0.96} />
          </mesh>
          {/* Secondary cluster — offset for asymmetry */}
          <mesh position={[0.32, 0.68, 0.05]} castShadow>
            <sphereGeometry args={[0.22, 8, 6]} />
            <meshStandardMaterial color="#1E4A14" roughness={0.97} />
          </mesh>
          {/* Small accent cluster */}
          <mesh position={[-0.28, 0.64, -0.05]} castShadow>
            <sphereGeometry args={[0.18, 7, 5]} />
            <meshStandardMaterial color={pi === 0 ? "#2E6022" : "#284E1C"} roughness={0.96} />
          </mesh>
          {/* Tall spiky accent (ornamental grass / agave form) */}
          <mesh position={[0.06, 0.88, 0]} castShadow>
            <cylinderGeometry args={[0.04, 0.08, 0.52, 6]} />
            <meshStandardMaterial color="#3A7028" roughness={0.94} />
          </mesh>
        </group>
      ))}

      {/* ── 楼梯间出入口小屋（stair penthouse）— 北侧混凝土体量 ── */}
      {(() => {
        const spW  = 2.10;   // east-west width
        const spD  = 1.60;   // north-south depth
        const spH  = 2.55;   // height above roof slab
        const spX  = -W * 0.34;
        const spZ  =  D * 0.26;   // north portion of roof
        const spY  = roofSlab + 0.05 + spH / 2;
        const bodyColor  = "#E4E0D8";  // matches concrete facade
        const roofCapCol = "#CCCAC4";
        // Door dims
        const doorW = 0.82, doorH = 2.05, doorZ = spD / 2 + 0.004;
        return (
          <group position={[spX, spY, spZ]}>
            {/* Main concrete body */}
            <mesh castShadow receiveShadow>
              <boxGeometry args={[spW, spH, spD]} />
              <meshStandardMaterial color={bodyColor} roughness={0.86} metalness={0.03} />
            </mesh>
            {/* Flat roof cap — slightly darker with metal edging */}
            <mesh position={[0, spH / 2 + 0.032, 0]}>
              <boxGeometry args={[spW + 0.06, 0.065, spD + 0.06]} />
              <meshStandardMaterial color={roofCapCol} roughness={0.78} metalness={0.06} />
            </mesh>
            {/* Cap edge flashing — dark anodized aluminium */}
            <mesh position={[0, spH / 2 + 0.067, 0]}>
              <boxGeometry args={[spW + 0.08, 0.014, spD + 0.08]} />
              <meshStandardMaterial color="#2E3240" roughness={0.22} metalness={0.90} envMapIntensity={2.0} />
            </mesh>
            {/* Steel door — dark charcoal, south-facing */}
            <mesh position={[0, (-spH / 2) + doorH / 2, doorZ]} castShadow>
              <boxGeometry args={[doorW, doorH, 0.055]} />
              <meshStandardMaterial color="#1C1E26" roughness={0.30} metalness={0.78} envMapIntensity={1.6} />
            </mesh>
            {/* Door frame — stainless reveal */}
            <mesh position={[0, (-spH / 2) + doorH / 2, doorZ + 0.006]}>
              <boxGeometry args={[doorW + 0.055, doorH + 0.055, 0.028]} />
              <meshStandardMaterial color="#6C7280" roughness={0.25} metalness={0.82} envMapIntensity={1.8} />
            </mesh>
            {/* Door handle */}
            <mesh position={[doorW / 2 - 0.09, (-spH / 2) + doorH * 0.52, doorZ + 0.044]}>
              <boxGeometry args={[0.022, 0.12, 0.022]} />
              <meshStandardMaterial color="#8A9BA8" roughness={0.20} metalness={0.90} />
            </mesh>
            {/* Small clerestory window on south face — frosted glass strip */}
            <mesh position={[0, spH / 2 - 0.28, doorZ + 0.004]}>
              <boxGeometry args={[spW * 0.60, 0.22, 0.018]} />
              <meshStandardMaterial
                color="#B8D4E0"
                transparent opacity={0.55}
                roughness={0.06} metalness={0.08}
                envMapIntensity={2.5}
              />
            </mesh>
            {/* Horizontal concrete joint line */}
            <mesh position={[0, 0.02, spD / 2 + 0.002]}>
              <boxGeometry args={[spW + 0.002, 0.012, 0.010]} />
              <meshStandardMaterial color="#C8C4BC" roughness={0.88} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 电梯机房玻璃塔（elevator overrun glass tower）──
           Slender glass-and-steel lift overrun penthouse, east of stair core.
           Premium residential feature: frameless glass curtain panels on 3
           sides, steel corner posts, aluminium cap band, interior cable drum
           visible through glass, and cool-blue night illumination. */}
      {(() => {
        const epW  = 1.60;    // E-W
        const epD  = 1.40;    // N-S
        const epH  = 2.80;    // height above roofSlab
        const epX  = -W * 0.34 + 1.85;    // east of stair penthouse
        const epZ  =  D * 0.26;
        const epY  = roofSlab + 0.05;
        const isNightEP = nightGlow > 0;
        const postM = { color: "#1E2028", roughness: 0.20, metalness: 0.90, envMapIntensity: 2.5 };
        return (
          <group position={[epX, epY, epZ]}>
            {/* ── 4 corner steel posts ── */}
            {([-epW / 2 + 0.04, epW / 2 - 0.04] as number[]).flatMap(px =>
              ([-epD / 2 + 0.04, epD / 2 - 0.04] as number[]).map((pz, pzi) => (
                <mesh key={`${px}-${pzi}`} position={[px, epH / 2, pz]} castShadow>
                  <boxGeometry args={[0.065, epH, 0.065]} />
                  <meshStandardMaterial {...postM} />
                </mesh>
              ))
            )}
            {/* ── Glass curtain panels — east, west, south faces ── */}
            {/* East face */}
            <mesh position={[epW / 2, epH / 2, 0]} {...overlayMaterialProps(1)}>
              <boxGeometry args={[0.012, epH - 0.06, epD - 0.06]} />
              <meshPhysicalMaterial color="#B8D0E0" transparent opacity={0.38}
                roughness={0.03} metalness={0.06} transmission={0.40}
                emissive="#8AB4CC" emissiveIntensity={isNightEP ? 0.22 : 0.04} side={2} />
            </mesh>
            {/* West face */}
            <mesh position={[-epW / 2, epH / 2, 0]} {...overlayMaterialProps(1)}>
              <boxGeometry args={[0.012, epH - 0.06, epD - 0.06]} />
              <meshPhysicalMaterial color="#B8D0E0" transparent opacity={0.38}
                roughness={0.03} metalness={0.06} transmission={0.40}
                emissive="#8AB4CC" emissiveIntensity={isNightEP ? 0.22 : 0.04} side={2} />
            </mesh>
            {/* South face (glass) */}
            <mesh position={[0, epH / 2, -epD / 2]} {...overlayMaterialProps(1)}>
              <boxGeometry args={[epW - 0.06, epH - 0.06, 0.012]} />
              <meshPhysicalMaterial color="#B8D0E0" transparent opacity={0.38}
                roughness={0.03} metalness={0.06} transmission={0.40}
                emissive="#8AB4CC" emissiveIntensity={isNightEP ? 0.22 : 0.04} side={2} />
            </mesh>
            {/* North face — solid steel (machine room back) */}
            <mesh position={[0, epH / 2, epD / 2]}>
              <boxGeometry args={[epW - 0.06, epH - 0.06, 0.055]} />
              <meshStandardMaterial color="#24262E" roughness={0.35} metalness={0.72} />
            </mesh>

            {/* ── Interior cable drum (visible through glass) ── */}
            <mesh position={[0, epH * 0.62, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.22, 0.22, 0.28, 10]} />
              <meshStandardMaterial color="#303844" roughness={0.40} metalness={0.68} />
            </mesh>
            {/* Cable wrap lines on drum */}
            {[0, 0.06, 0.12].map((dy, di) => (
              <mesh key={di} position={[0, epH * 0.62 - 0.06 + dy, 0]} rotation={[0, 0, Math.PI / 2]}>
                <torusGeometry args={[0.23, 0.008, 4, 10]} />
                <meshStandardMaterial color="#505870" roughness={0.30} metalness={0.72} />
              </mesh>
            ))}

            {/* ── Aluminium top cap band ── */}
            <mesh position={[0, epH + 0.022, 0]}>
              <boxGeometry args={[epW + 0.04, 0.045, epD + 0.04]} />
              <meshStandardMaterial color="#505868" roughness={0.22} metalness={0.88} envMapIntensity={2.2} />
            </mesh>
            {/* Cap edge angled drip */}
            <mesh position={[0, epH + 0.046, 0]}>
              <boxGeometry args={[epW + 0.06, 0.012, epD + 0.06]} />
              <meshStandardMaterial color="#3E4458" roughness={0.18} metalness={0.92} envMapIntensity={2.4} />
            </mesh>

            {/* ── Night glow light ── */}
            {isNightEP && (
              <pointLight position={[0, epH * 0.50, 0]}
                intensity={nightGlow * 2.5} distance={3.0} decay={2.0}
                color="#80C0E8" castShadow={false} />
            )}
          </group>
        );
      })()}

      {/* ── 太阳能热水器真空管集热器（solar thermal vacuum-tube collector array）──
           Tilted south at 35° for optimal thermal gain.  Placed east quadrant
           of roof, clear of PV panels, helipad, and pergola.
           Each collector: aluminium header manifold + 12 borosilicate vacuum
           tubes with selective absorber inner coating (deep blue). */}
      {(() => {
        const tcX    =  W * 0.38;         // east side of roof
        const tcZ    =  D * 0.08;         // slightly north of centre
        const tcY    =  roofSlab + 0.05;
        const tilt   =  0.61;             // ≈ 35° south-facing tilt
        const nCollectors = 2;            // two side-by-side banks
        const tubeCount   = 12;
        const tubeR   = 0.035;            // tube outer radius (m)
        const tubeL   = 1.80;             // tube length (m)
        const tubeGap = 0.065;            // centre-to-centre spacing
        const bankW   = tubeCount * tubeGap;

        return Array.from({ length: nCollectors }, (_, ci) => {
          const bx = tcX + (ci - 0.5) * (bankW + 0.18);
          return (
            <group key={`stc-${ci}`} position={[bx, tcY, tcZ]} rotation={[tilt, 0, 0]}>
              {/* ── Mounting frame — two aluminium crossbars ── */}
              {[-tubeL * 0.28, tubeL * 0.28].map((fz, fi) => (
                <mesh key={fi} position={[0, 0, fz]} castShadow>
                  <boxGeometry args={[bankW + 0.08, 0.040, 0.035]} />
                  <meshStandardMaterial color="#B0B8C0" roughness={0.28} metalness={0.75} />
                </mesh>
              ))}
              {/* ── Header manifold (top connection pipe) ── */}
              <mesh position={[0, tubeL * 0.38, 0]} castShadow>
                <boxGeometry args={[bankW + 0.06, 0.080, 0.080]} />
                <meshStandardMaterial color="#8892A0" roughness={0.35} metalness={0.68} />
              </mesh>
              {/* ── End cap covers ── */}
              {[-bankW / 2 - 0.025, bankW / 2 + 0.025].map((ex, ei) => (
                <mesh key={ei} position={[ex, tubeL * 0.38, 0]}>
                  <boxGeometry args={[0.04, 0.09, 0.09]} />
                  <meshStandardMaterial color="#606870" roughness={0.40} metalness={0.55} />
                </mesh>
              ))}
              {/* ── Vacuum tubes ── */}
              {Array.from({ length: tubeCount }, (_, ti) => {
                const tx = -bankW / 2 + ti * tubeGap + tubeGap / 2;
                return (
                  <group key={`tube-${ti}`} position={[tx, 0, 0]}>
                    {/* Outer borosilicate glass tube — pale blue-grey */}
                    <mesh castShadow>
                      <cylinderGeometry args={[tubeR, tubeR, tubeL, 10]} />
                      <meshPhysicalMaterial
                        color="#C8D8E4"
                        transparent
                        opacity={0.55}
                        roughness={0.04}
                        metalness={0.05}
                        transmission={0.30}
                        side={2}
                      />
                    </mesh>
                    {/* Inner absorber tube — selective black/dark-blue coating */}
                    <mesh>
                      <cylinderGeometry args={[tubeR * 0.55, tubeR * 0.55, tubeL - 0.02, 10]} />
                      <meshStandardMaterial
                        color="#142030"
                        roughness={0.18}
                        metalness={0.55}
                        emissive="#0A1820"
                        emissiveIntensity={0.10}
                      />
                    </mesh>
                    {/* Copper heat-pipe tip stub at top */}
                    <mesh position={[0, tubeL / 2 - 0.015, 0]}>
                      <cylinderGeometry args={[0.010, 0.010, 0.06, 6]} />
                      <meshStandardMaterial color="#C87844" roughness={0.40} metalness={0.70} />
                    </mesh>
                  </group>
                );
              })}
              {/* ── Insulated return pipe running down from manifold ── */}
              <mesh position={[bankW / 2 - 0.03, tubeL * 0.10, -0.055]} castShadow>
                <cylinderGeometry args={[0.022, 0.022, tubeL * 0.58, 6]} />
                <meshStandardMaterial color="#404850" roughness={0.60} metalness={0.20} />
              </mesh>
            </group>
          );
        });
      })()}

      {/* ── 屋顶直升机停机坪标志（helipad markings）──
           Painted on west-south quadrant of roof, away from HVAC / solar.
           Standard ICAO visual: white outer circle, yellow "H" lettering,
           orange corner triangles, and a night-time perimeter lighting ring. */}
      {(() => {
        const hpR  = Math.min(W * 0.18, 2.60);  // helipad circle radius
        const hpX  = -W * 0.28;
        const hpZ  = -D * 0.26;
        const hpY  = roofSlab + 0.055;           // sits on roof slab surface
        const segments = 32;
        return (
          <group position={[hpX, hpY, hpZ]} rotation={[-Math.PI / 2, 0, 0]}>
            {/* Base concrete patch — slightly lighter than roof */}
            <mesh>
              <circleGeometry args={[hpR + 0.10, segments]} />
              <meshStandardMaterial color="#E8E4DE" roughness={0.88} />
            </mesh>
            {/* White outer border ring */}
            <mesh position={[0, 0, 0.002]}>
              <ringGeometry args={[hpR - 0.18, hpR, segments]} />
              <meshStandardMaterial color="#EFEFEF" roughness={0.85} />
            </mesh>
            {/* Yellow infill circle */}
            <mesh position={[0, 0, 0.003]}>
              <circleGeometry args={[hpR - 0.18, segments]} />
              <meshStandardMaterial color="#E8C830" roughness={0.86} />
            </mesh>
            {/* "H" letter — three bars: left vertical, right vertical, crossbar */}
            {/* Left vertical */}
            <mesh position={[-hpR * 0.26, 0, 0.006]}>
              <planeGeometry args={[hpR * 0.16, hpR * 0.72]} />
              <meshStandardMaterial color="#EFEFEF" roughness={0.84} />
            </mesh>
            {/* Right vertical */}
            <mesh position={[ hpR * 0.26, 0, 0.006]}>
              <planeGeometry args={[hpR * 0.16, hpR * 0.72]} />
              <meshStandardMaterial color="#EFEFEF" roughness={0.84} />
            </mesh>
            {/* Crossbar */}
            <mesh position={[0, 0, 0.006]}>
              <planeGeometry args={[hpR * 0.52 + hpR * 0.16, hpR * 0.16]} />
              <meshStandardMaterial color="#EFEFEF" roughness={0.84} />
            </mesh>
            {/* 4 corner orientation triangles (orange) at N/S/E/W */}
            {([0, Math.PI / 2, Math.PI, -Math.PI / 2] as number[]).map((ang, ti) => {
              const tx = Math.sin(ang) * (hpR - 0.08);
              const ty = Math.cos(ang) * (hpR - 0.08);
              return (
                <mesh key={ti} position={[tx, ty, 0.005]} rotation={[0, 0, -ang]}>
                  <planeGeometry args={[0.15, 0.24]} />
                  <meshStandardMaterial color="#FF6020" roughness={0.85} />
                </mesh>
              );
            })}
          </group>
        );
      })()}

      {/* ── 屋顶浅水景观池（rooftop shallow reflecting pool）──
           Dark slate-tiled basin 3m × 1.2m with reflective water skin.
           Placed on east side of roof terrace, creates a mirror effect
           reflecting the pergola and sky, glows cool blue at night. */}
      {(() => {
        const rpW = Math.min(W * 0.36, 3.20);   // pool width E-W
        const rpL = 1.20;                         // pool depth N-S
        const rpDp = 0.18;                        // water depth (shallow)
        const rpX = W * 0.22;
        const rpZ =  D * 0.06;                   // centre-east of roof
        const rpY = roofSlab + 0.05;
        return (
          <group position={[rpX, rpY, rpZ]}>
            {/* Basin coping rim — dark slate */}
            <mesh position={[0, rpDp / 2, 0]} castShadow>
              <boxGeometry args={[rpW + 0.14, rpDp + 0.04, rpL + 0.14]} />
              <meshStandardMaterial color="#282A30" roughness={0.45} metalness={0.35} envMapIntensity={1.4} />
            </mesh>
            {/* Basin floor — dark basalt mosaic */}
            <mesh position={[0, 0.008, 0]}>
              <boxGeometry args={[rpW, 0.016, rpL]} />
              <meshStandardMaterial color="#1A1C22" roughness={0.55} metalness={0.12} />
            </mesh>
            {/* Water surface — highly reflective, slight blue tint */}
            <mesh position={[0, rpDp - 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
              <planeGeometry args={[rpW - 0.02, rpL - 0.02]} />
              <meshStandardMaterial
                color="#4898C0"
                transparent opacity={0.88}
                depthWrite={false}
                roughness={0.02}
                metalness={0.15}
                envMapIntensity={6.0}
                emissive="#2070A0" emissiveIntensity={nightGlow * 0.6 + 0.04}
              />
            </mesh>
            {/* Coping top surface edge detail — lighter cap */}
            <mesh position={[0, rpDp + 0.022, 0]}>
              <boxGeometry args={[rpW + 0.16, 0.014, rpL + 0.16]} />
              <meshStandardMaterial color="#484C58" roughness={0.22} metalness={0.78} envMapIntensity={2.0} />
            </mesh>
            {/* Underwater fill light — cool blue, only active at night */}
            <pointLight
              position={[0, 0.06, 0]}
              intensity={nightGlow * 2.0}
              distance={rpW * 1.2}
              decay={2.0}
              color="#40B0D8"
              castShadow={false}
            />
          </group>
        );
      })()}

      {/* ── 屋顶休闲家具（rooftop terrace sun loungers + dining）──
           Two teak-framed sun loungers with white cushions, a side table
           and a 4-seat outdoor dining set under the pergola / shade sail. */}
      {(() => {
        const furY = roofSlab + 0.05;
        const loungeColor = "#F0ECD8";  // off-white cushion
        const teak = "#8B5E3C";          // teak frame
        const metal = "#5A6070";         // dark metal legs/frames
        // Sun lounger — simplified as reclining platform
        function Lounger({ x, z, rotY }: { x: number; z: number; rotY: number }) {
          return (
            <group position={[x, furY, z]} rotation={[0, rotY, 0]}>
              {/* Frame rail — teak */}
              <mesh position={[0, 0.16, 0]} castShadow>
                <boxGeometry args={[1.95, 0.040, 0.68]} />
                <meshStandardMaterial color={teak} roughness={0.72} metalness={0.04} />
              </mesh>
              {/* Cushion */}
              <mesh position={[0, 0.20, 0]} castShadow>
                <boxGeometry args={[1.85, 0.065, 0.60]} />
                <meshStandardMaterial color={loungeColor} roughness={0.85} />
              </mesh>
              {/* Head rest — slightly elevated */}
              <mesh position={[-0.72, 0.28, 0]} rotation={[0.22, 0, 0]} castShadow>
                <boxGeometry args={[0.48, 0.055, 0.60]} />
                <meshStandardMaterial color={loungeColor} roughness={0.85} />
              </mesh>
              {/* 4 legs */}
              {([-0.80, 0.80] as number[]).flatMap(lx => ([-0.26, 0.26] as number[]).map(lz => (
                <mesh key={`${lx}-${lz}`} position={[lx, 0.07, lz]}>
                  <cylinderGeometry args={[0.016, 0.016, 0.14, 6]} />
                  <meshStandardMaterial color={metal} roughness={0.38} metalness={0.72} />
                </mesh>
              )))}
            </group>
          );
        }
        return (
          <group>
            {/* Two sun loungers, side-by-side facing south */}
            <Lounger x={-W * 0.05} z={-D * 0.32} rotY={0} />
            <Lounger x={-W * 0.05} z={-D * 0.16} rotY={0} />
            {/* Side table between loungers */}
            <group position={[-W * 0.05, furY, -D * 0.24]}>
              <mesh position={[1.20, 0.35, 0]}>
                <cylinderGeometry args={[0.25, 0.25, 0.016, 10]} />
                <meshStandardMaterial color="#E0D8C8" roughness={0.35} metalness={0.10} envMapIntensity={2.0} />
              </mesh>
              <mesh position={[1.20, 0.16, 0]}>
                <cylinderGeometry args={[0.020, 0.020, 0.34, 6]} />
                <meshStandardMaterial color={metal} roughness={0.38} metalness={0.72} />
              </mesh>
              {/* Drinks / book on table */}
              <mesh position={[1.20, 0.365, -0.05]}>
                <cylinderGeometry args={[0.030, 0.025, 0.12, 8]} />
                <meshStandardMaterial color="#80A8C0" roughness={0.30} metalness={0.20} envMapIntensity={3.0} />
              </mesh>
            </group>
            {/* Rooftop dining set — 4 chairs around round table under pergola */}
            {(() => {
              const dtX = -W * 0.13;
              const dtZ = -D * 0.28 + 0.40;  // inside pergola zone
              // Round table
              return (
                <group position={[dtX, furY, dtZ]}>
                  <mesh position={[0, 0.76, 0]}>
                    <cylinderGeometry args={[0.65, 0.65, 0.020, 14]} />
                    <meshStandardMaterial color="#E4DCcC" roughness={0.32} metalness={0.12} envMapIntensity={2.2} />
                  </mesh>
                  <mesh position={[0, 0.38, 0]}>
                    <cylinderGeometry args={[0.028, 0.028, 0.74, 6]} />
                    <meshStandardMaterial color={metal} roughness={0.36} metalness={0.72} />
                  </mesh>
                  {/* 4 chairs at cardinal points */}
                  {([0, Math.PI / 2, Math.PI, -Math.PI / 2] as number[]).map((ang, ci) => {
                    const cx3 = Math.sin(ang) * 0.85;
                    const cz3 = Math.cos(ang) * 0.85;
                    return (
                      <group key={ci} position={[cx3, 0, cz3]} rotation={[0, ang, 0]}>
                        {/* Chair seat */}
                        <mesh position={[0, 0.46, 0]} castShadow>
                          <boxGeometry args={[0.44, 0.040, 0.44]} />
                          <meshStandardMaterial color={teak} roughness={0.74} metalness={0.04} />
                        </mesh>
                        {/* Chair back */}
                        <mesh position={[0, 0.70, -0.20]} rotation={[-0.12, 0, 0]} castShadow>
                          <boxGeometry args={[0.44, 0.42, 0.028]} />
                          <meshStandardMaterial color={teak} roughness={0.72} metalness={0.04} />
                        </mesh>
                        {/* Seat cushion */}
                        <mesh position={[0, 0.49, 0]}>
                          <boxGeometry args={[0.40, 0.040, 0.40]} />
                          <meshStandardMaterial color={loungeColor} roughness={0.88} />
                        </mesh>
                        {/* 4 legs */}
                        {([-0.16, 0.16] as number[]).flatMap(lx4 => ([-0.16, 0.16] as number[]).map(lz4 => (
                          <mesh key={`${lx4}${lz4}`} position={[lx4, 0.22, lz4]}>
                            <cylinderGeometry args={[0.014, 0.014, 0.44, 6]} />
                            <meshStandardMaterial color={metal} roughness={0.38} metalness={0.70} />
                          </mesh>
                        )))}
                      </group>
                    );
                  })}
                </group>
              );
            })()}
          </group>
        );
      })()}

      {/* ── 屋顶冲浪按摩浴缸（rooftop hot tub, near loungers）──
           Sunken square hot tub with teak surround, blue water surface
           and underwater glow. 2m × 2m, 0.65m deep. */}
      {(() => {
        const htX = W * 0.10;
        const htZ = -D * 0.05;   // open east area of roof
        const htY = roofSlab + 0.05;
        const htW = 1.90;  // hot tub width
        const htH = 0.65;  // depth
        const teakW = 0.28;  // teak surround width
        const glowI2 = nightGlow > 0.4 ? nightGlow : 0.05;
        return (
          <group position={[htX, htY, htZ]}>
            {/* Teak surround deck — warm brown platform */}
            <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
              <boxGeometry args={[htW + teakW * 2, 0.075, htW + teakW * 2]} />
              <meshStandardMaterial color="#7A5030" roughness={0.72} metalness={0.03} />
            </mesh>
            {/* Teak plank grooves on surround */}
            {Array.from({ length: 5 }, (_, pi) => (
              <mesh key={pi} position={[0, 0.078, -htW / 2 - teakW / 2 - 0.002 + pi * ((htW + teakW * 2) / 5)]}>
                <boxGeometry args={[htW + teakW * 2, 0.006, 0.008]} />
                <meshStandardMaterial color="#5A3820" roughness={0.85} />
              </mesh>
            ))}
            {/* Hot tub shell — white acrylic walls */}
            <mesh position={[0, htH / 2, 0]}>
              <boxGeometry args={[htW, htH, htW]} />
              <meshStandardMaterial color="#E8E4E0" roughness={0.35} metalness={0.08} side={THREE.DoubleSide} />
            </mesh>
            {/* Dark interior tile base */}
            <mesh position={[0, 0.035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[htW - 0.06, htW - 0.06]} />
              <meshStandardMaterial color="#1A2A40" roughness={0.52} metalness={0.15} />
            </mesh>
            {/* Water surface */}
            <mesh position={[0, htH - 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={12}>
              <planeGeometry args={[htW - 0.06, htW - 0.06]} />
              <meshStandardMaterial
                color="#2870B8"
                transparent opacity={0.85}
                roughness={0.02} metalness={0.10}
                envMapIntensity={5.0}
                emissive="#1858A0" emissiveIntensity={glowI2 * 1.2}
                depthWrite={false}
              />
            </mesh>
            {/* Jets — small white dots on interior walls */}
            {Array.from({ length: 4 }, (_, ji) => {
              const ang = (ji / 4) * Math.PI * 2;
              const jx2 = Math.sin(ang) * (htW * 0.44);
              const jz2 = Math.cos(ang) * (htW * 0.44);
              return (
                <mesh key={ji} position={[jx2, htH * 0.45, jz2]} rotation={[0, ang, 0]}>
                  <cylinderGeometry args={[0.030, 0.030, 0.025, 8]} />
                  <meshStandardMaterial color="#C8D0D8" roughness={0.25} metalness={0.80} envMapIntensity={2.0} />
                </mesh>
              );
            })}
            {/* Corner folded towel on surround */}
            <mesh position={[htW / 2 + teakW * 0.55, 0.090, -htW / 2 - teakW * 0.55]} rotation={[0.05, 0.3, 0.05]}>
              <boxGeometry args={[0.28, 0.040, 0.22]} />
              <meshStandardMaterial color="#F0EBE0" roughness={0.88} />
            </mesh>
            {/* Underwater glow light */}
            <pointLight
              position={[0, 0.08, 0]}
              intensity={nightGlow * 3.0 + 0.05}
              distance={htW * 1.8}
              decay={2.0}
              color="#3080D0"
              castShadow={false}
            />
          </group>
        );
      })()}

      {/* ── 屋顶 BBQ 台（rooftop BBQ station near pergola）── */}
      {(() => {
        // Placed near roof terrace sun loungers and dining set
        const bbqX = W * 0.28;
        const bbqZ = -D * 0.22;
        const bbqY = roofSlab + 0.05;
        return (
          <group position={[bbqX, bbqY, bbqZ]}>
            {/* Granite counter surface */}
            <mesh position={[0, 0.90, 0]} castShadow>
              <boxGeometry args={[0.80, 0.035, 0.52]} />
              <meshStandardMaterial color="#1C1E24" roughness={0.15} metalness={0.35} envMapIntensity={2.2} />
            </mesh>
            {/* Cabinet body */}
            <mesh position={[0, 0.45, 0]} castShadow>
              <boxGeometry args={[0.80, 0.87, 0.50]} />
              <meshStandardMaterial color="#2A2E38" roughness={0.50} metalness={0.38} />
            </mesh>
            {/* Grill lid */}
            <mesh position={[0.15, 0.94, 0]}>
              <boxGeometry args={[0.42, 0.04, 0.44]} />
              <meshStandardMaterial color="#383C44" roughness={0.40} metalness={0.60} />
            </mesh>
            {/* Grill body */}
            <mesh position={[0.15, 0.88, 0]} castShadow>
              <boxGeometry args={[0.42, 0.08, 0.40]} />
              <meshStandardMaterial color="#2C3038" roughness={0.45} metalness={0.55} />
            </mesh>
            {/* Smoke stack */}
            <mesh position={[0.28, 1.02, -0.12]}>
              <cylinderGeometry args={[0.022, 0.022, 0.20, 6]} />
              <meshStandardMaterial color="#484C56" roughness={0.50} metalness={0.45} />
            </mesh>
            {/* Small propane tank (cylinder on side) */}
            <mesh position={[-0.30, 0.28, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.070, 0.070, 0.32, 10]} />
              <meshStandardMaterial color="#60A060" roughness={0.55} metalness={0.30} />
            </mesh>
          </group>
        );
      })()}
      {/* ── 屋顶冷水泳池（rooftop cold plunge pool, NE area）──
           A sleek 2.0m × 1.2m stainless-steel cold plunge pool recessed into
           the rooftop slab, adjacent to the hot tub for contrast therapy.
           Glass viewing panel on south face, ladder handles, underwater LED. */}
      {(() => {
        const cpX  = -W * 0.22;    // NE quadrant, clear of elevator overrun
        const cpZ  =  D * 0.12;
        const cpY  = roofSlab + 0.05;
        const cpW  = 2.00;   // pool width (E-W)
        const cpD  = 1.20;   // pool depth (N-S)
        const cpH  = 0.90;   // pool wall height
        const wallT_cp = 0.06;
        const isNightCP = nightGlow > 0.4;
        const isDuskCP  = nightGlow > 0.15 && nightGlow <= 0.4;
        const cpGlowI = isNightCP ? 1.8 : isDuskCP ? 0.7 : 0.04;
        const cpLI    = isNightCP ? 3.0 : isDuskCP ? 1.5 : 0.0;

        return (
          <group position={[cpX, cpY, cpZ]}>
            {/* Pool shell — dark slate grey steel */}
            <mesh position={[0, cpH / 2, 0]} castShadow>
              <boxGeometry args={[cpW + wallT_cp * 2, cpH + wallT_cp, cpD + wallT_cp * 2]} />
              <meshStandardMaterial color="#282C36" roughness={0.22} metalness={0.70} envMapIntensity={2.5} />
            </mesh>
            {/* Interior liner — brushed stainless */}
            <mesh position={[0, cpH / 2, 0]}>
              <boxGeometry args={[cpW, cpH, cpD]} />
              <meshStandardMaterial color="#8A9298" roughness={0.18} metalness={0.90} envMapIntensity={3.0} side={THREE.BackSide} />
            </mesh>
            {/* Water surface */}
            <mesh position={[0, cpH - 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={12}>
              <planeGeometry args={[cpW - 0.02, cpD - 0.02]} />
              <meshStandardMaterial
                color="#3888B0" transparent opacity={0.88}
                roughness={0.01} metalness={0.08}
                envMapIntensity={6.0}
                emissive="#206898" emissiveIntensity={cpGlowI}
                depthWrite={false}
              />
            </mesh>
            {/* South-face glass viewing panel */}
            <mesh position={[0, cpH * 0.46, -cpD / 2 - wallT_cp * 0.5]} renderOrder={11}>
              <boxGeometry args={[cpW * 0.70, cpH * 0.80, 0.014]} />
              <meshStandardMaterial
                color="#A0D0E8" transparent opacity={0.25}
                roughness={0.02} metalness={0.06}
                envMapIntensity={5.0}
                emissive="#70B8D8" emissiveIntensity={cpGlowI * 0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            {/* Top coping — polished black granite surround */}
            {([
              [0, cpD / 2 + wallT_cp, cpW + wallT_cp * 4, wallT_cp * 2 + 0.06],
              [0, -cpD / 2 - wallT_cp, cpW + wallT_cp * 4, wallT_cp * 2 + 0.06],
              [cpW / 2 + wallT_cp, 0, wallT_cp * 2 + 0.06, cpD + wallT_cp * 4 + 0.06],
              [-cpW / 2 - wallT_cp, 0, wallT_cp * 2 + 0.06, cpD + wallT_cp * 4 + 0.06],
            ] as [number, number, number, number][]).map(([x, z, w, d], ci) => (
              <mesh key={ci} position={[x, cpH + wallT_cp * 0.5 + 0.006, z]}>
                <boxGeometry args={[w, 0.018, d]} />
                <meshStandardMaterial color="#1A1C20" roughness={0.10} metalness={0.65} envMapIntensity={3.0} />
              </mesh>
            ))}
            {/* Ladder handles — 2 stainless bars on east side */}
            {([-0.10, 0.10] as number[]).map((hx, hi) => (
              <group key={hi} position={[cpW / 2 + wallT_cp + 0.02, 0, hx]}>
                <mesh position={[0, cpH * 0.55, 0]}>
                  <cylinderGeometry args={[0.016, 0.016, cpH * 1.06, 6]} />
                  <meshStandardMaterial color="#C0C8D0" roughness={0.16} metalness={0.92} envMapIntensity={2.5} />
                </mesh>
                {/* Rung */}
                <mesh position={[0, cpH * 0.28, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.012, 0.012, 0.20, 6]} />
                  <meshStandardMaterial color="#B8C0C8" roughness={0.18} metalness={0.90} />
                </mesh>
              </group>
            ))}
            {/* Underwater LED light */}
            {cpLI > 0 && (
              <pointLight position={[0, 0.15, 0]} intensity={cpLI} distance={cpW * 1.5} decay={2} color="#20A0D0" />
            )}
            {/* "COLD PLUNGE" label placard — small stainless plate */}
            <mesh position={[0, cpH + 0.025, cpD / 2 + wallT_cp + 0.04]}>
              <boxGeometry args={[0.55, 0.030, 0.018]} />
              <meshStandardMaterial color="#9AA0A8" roughness={0.18} metalness={0.88} envMapIntensity={2.0} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 屋顶露天酒吧台（rooftop sky bar, SE corner）──
           Polished-concrete bar counter in an L-shape, black steel base,
           5 bar stools, backbar with bottle display + wine rack, under-
           counter LED strip. Night: warm amber glow activates. */}
      {(() => {
        const barX  =  W * 0.32;
        const barZ  = -D * 0.38;
        const barY  = roofSlab + 0.05;
        const isNightBar = nightGlow > 0.4;
        const barEmi  = isNightBar ? 2.8 : 0.30;
        const barLI   = isNightBar ? 4.0 : 0.0;
        const ctopCol = "#2C3040";   // dark charcoal concrete top
        const bodyCol = "#1A1C22";   // near-black steel cabinet
        const teak    = "#7A4E28";   // warm teak accents

        return (
          <group position={[barX, barY, barZ]}>
            {/* ── Main bar counter body (E-W oriented, 2.20m long) ── */}
            <mesh position={[0, 0.90, 0]} castShadow>
              <boxGeometry args={[2.20, 0.040, 0.65]} />
              <meshStandardMaterial color={ctopCol} roughness={0.10} metalness={0.50} envMapIntensity={3.5} />
            </mesh>
            {/* Counter waterfall edge — thin steel nose */}
            <mesh position={[0, 0.872, -0.33]}>
              <boxGeometry args={[2.20, 0.020, 0.018]} />
              <meshStandardMaterial color="#303848" roughness={0.18} metalness={0.88} envMapIntensity={2.5} />
            </mesh>
            {/* Bar cabinet */}
            <mesh position={[0, 0.44, 0]} castShadow>
              <boxGeometry args={[2.20, 0.88, 0.62]} />
              <meshStandardMaterial color={bodyCol} roughness={0.30} metalness={0.60} envMapIntensity={2.0} />
            </mesh>
            {/* Under-counter LED strip */}
            <mesh position={[0, 0.040, -0.32]}>
              <boxGeometry args={[2.10, 0.010, 0.012]} />
              <meshStandardMaterial color="#FFE4A0" emissive="#FFD060" emissiveIntensity={barEmi} roughness={0.60} />
            </mesh>
            {barLI > 0 && (
              <pointLight position={[0, 0.06, -0.35]} intensity={barLI} distance={3.5} decay={2} color="#FFE090" />
            )}

            {/* ── Return leg of L-shape (N-S oriented, 1.40m long) ── */}
            <mesh position={[1.10, 0.90, 0.52]} castShadow>
              <boxGeometry args={[0.65, 0.040, 1.40]} />
              <meshStandardMaterial color={ctopCol} roughness={0.10} metalness={0.50} envMapIntensity={3.5} />
            </mesh>
            <mesh position={[1.10, 0.44, 0.52]} castShadow>
              <boxGeometry args={[0.62, 0.88, 1.40]} />
              <meshStandardMaterial color={bodyCol} roughness={0.30} metalness={0.60} envMapIntensity={2.0} />
            </mesh>
            {/* LED on return */}
            <mesh position={[0.79, 0.040, 0.52]}>
              <boxGeometry args={[0.012, 0.010, 1.30]} />
              <meshStandardMaterial color="#FFE4A0" emissive="#FFD060" emissiveIntensity={barEmi} roughness={0.60} />
            </mesh>

            {/* ── 5 bar stools — front of main counter ── */}
            {Array.from({ length: 5 }, (_, si) => {
              const sx = -0.88 + si * 0.44;
              return (
                <group key={si} position={[sx, 0, -0.76]}>
                  {/* Seat */}
                  <mesh position={[0, 0.75, 0]}>
                    <cylinderGeometry args={[0.18, 0.17, 0.048, 10]} />
                    <meshStandardMaterial color="#1A1C22" roughness={0.24} metalness={0.82} envMapIntensity={2.0} />
                  </mesh>
                  {/* Seat cushion */}
                  <mesh position={[0, 0.778, 0]}>
                    <cylinderGeometry args={[0.16, 0.16, 0.030, 10]} />
                    <meshStandardMaterial color="#383050" roughness={0.80} metalness={0.02} />
                  </mesh>
                  {/* Stem */}
                  <mesh position={[0, 0.38, 0]}>
                    <cylinderGeometry args={[0.022, 0.028, 0.74, 8]} />
                    <meshStandardMaterial color="#505868" roughness={0.22} metalness={0.84} envMapIntensity={1.8} />
                  </mesh>
                  {/* Base ring */}
                  <mesh position={[0, 0.025, 0]}>
                    <cylinderGeometry args={[0.22, 0.24, 0.025, 12]} />
                    <meshStandardMaterial color="#404858" roughness={0.28} metalness={0.80} envMapIntensity={1.6} />
                  </mesh>
                </group>
              );
            })}

            {/* ── Back bar (against east parapet) ── */}
            <group position={[1.42, 0, 0]}>
              {/* Back bar shelf unit */}
              <mesh position={[0, 1.05, 0.15]} castShadow>
                <boxGeometry args={[0.12, 1.80, 0.80]} />
                <meshStandardMaterial color="#161820" roughness={0.45} metalness={0.40} />
              </mesh>
              {/* Three glass shelves */}
              {[0.80, 1.18, 1.52].map((sy, si) => (
                <mesh key={si} position={[0.065, sy, 0.15]}>
                  <boxGeometry args={[0.020, 0.012, 0.70]} />
                  <meshStandardMaterial color="#B0C8D8" transparent opacity={0.55} roughness={0.04} metalness={0.10} envMapIntensity={4.0} />
                </mesh>
              ))}
              {/* Bottle array — 6 bottles on middle shelf */}
              {Array.from({ length: 6 }, (_, bi) => {
                const bz = -0.30 + bi * 0.12;
                return (
                  <group key={bi} position={[0.065, 1.24, bz]}>
                    <mesh position={[0, 0, 0]} castShadow>
                      <cylinderGeometry args={[0.030, 0.028, 0.28, 7]} />
                      <meshStandardMaterial
                        color={bi % 3 === 0 ? "#3A5020" : bi % 3 === 1 ? "#6A3010" : "#1A2840"}
                        roughness={0.08} metalness={0.08} envMapIntensity={3.0}
                        transparent opacity={0.85}
                      />
                    </mesh>
                    {/* Bottle neck */}
                    <mesh position={[0, 0.17, 0]}>
                      <cylinderGeometry args={[0.012, 0.020, 0.10, 6]} />
                      <meshStandardMaterial color="#C0A060" roughness={0.20} metalness={0.60} />
                    </mesh>
                  </group>
                );
              })}
              {/* Wine rack (lower section) — 4 horizontally stored bottles */}
              {Array.from({ length: 4 }, (_, wi) => (
                <mesh key={wi} position={[0.065, 0.70 - wi * 0.14, wi % 2 === 0 ? 0.05 : -0.05]}
                  rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.033, 0.033, 0.30, 7]} />
                  <meshStandardMaterial
                    color={wi % 2 === 0 ? "#4A2840" : "#2A4820"}
                    transparent opacity={0.82} roughness={0.06} metalness={0.06} envMapIntensity={2.5}
                  />
                </mesh>
              ))}
              {/* Mirror back panel — reflects bottles */}
              <mesh position={[-0.002, 1.05, 0.15]}>
                <boxGeometry args={[0.006, 1.78, 0.78]} />
                <meshStandardMaterial color="#C8D4DC" roughness={0.04} metalness={0.96} envMapIntensity={5.0} />
              </mesh>
              {/* Backbar LED strip */}
              <mesh position={[0.060, 1.88, 0.15]}>
                <boxGeometry args={[0.012, 0.010, 0.72]} />
                <meshStandardMaterial color="#FFF0D0" emissive="#FFE090" emissiveIntensity={barEmi} roughness={0.60} />
              </mesh>
              {barLI > 0 && (
                <pointLight position={[0, 1.20, 0.15]} intensity={barLI * 0.7} distance={2.0} decay={2} color="#FFE8B0" />
              )}
            </group>

            {/* ── Small decorative plant on bar corner ── */}
            <group position={[-1.08, 0.94, -0.18]}>
              <mesh position={[0, 0.06, 0]}>
                <cylinderGeometry args={[0.075, 0.065, 0.12, 8]} />
                <meshStandardMaterial color="#D0A878" roughness={0.72} metalness={0.06} />
              </mesh>
              <mesh position={[0, 0.18, 0]}>
                <sphereGeometry args={[0.08, 8, 6]} />
                <meshStandardMaterial color="#2E6020" roughness={0.95} metalness={0.01} />
              </mesh>
            </group>
          </group>
        );
      })()}

    </group>
  );
}

// ── 楼梯间围栏（上层开口处安全栏杆） ─────────────────────────
function StairwellRailing({ rW, rD }: { rW: number; rD: number }) {
  const RH   = 0.92;   // 栏杆高度 m
  const POST = 0.06;   // 立柱截面 m
  const RAIL = 0.045;  // 横杆截面 m
  const postMat = <meshStandardMaterial color="#8A9BA8" metalness={0.55} roughness={0.35} />;
  const railMat = <meshStandardMaterial color="#B0C0CC" metalness={0.45} roughness={0.40} />;
  const glassMat = <meshStandardMaterial color="#A8D4F5" transparent opacity={0.28} roughness={0.05} metalness={0.15} />;

  // 每侧的立柱位置（间距约 0.9m）
  function sidePosts(len: number, axis: "x" | "z", fixed: number): Array<[number, number, number]> {
    const n = Math.max(2, Math.round(len / 0.9));
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1);
      const v = -len / 2 + POST / 2 + t * (len - POST);
      return axis === "x" ? [v, 0, fixed] : [fixed, 0, v];
    });
  }

  const allSides: Array<{ axis: "x" | "z"; len: number; fixed: number; railAxis: "x" | "z" }> = [
    { axis: "x", len: rW, fixed: -rD / 2 + POST / 2, railAxis: "x" },
    { axis: "x", len: rW, fixed:  rD / 2 - POST / 2, railAxis: "x" },
    { axis: "z", len: rD, fixed: -rW / 2 + POST / 2, railAxis: "z" },
    { axis: "z", len: rD, fixed:  rW / 2 - POST / 2, railAxis: "z" },
  ];

  return (
    <group position={[0, 0, 0]}>
      {allSides.map((s, si) => (
        <group key={si}>
          {/* 立柱 */}
          {sidePosts(s.axis === "x" ? rW : rD, s.axis, s.fixed).map(([px, , pz], pi) => (
            <mesh key={pi} position={[px, RH / 2, pz]}>
              <boxGeometry args={[POST, RH, POST]} />
              {postMat}
            </mesh>
          ))}
          {/* 顶部横杆 */}
          <mesh position={
            s.railAxis === "x"
              ? [0, RH - RAIL / 2, s.fixed]
              : [s.fixed, RH - RAIL / 2, 0]
          }>
            <boxGeometry args={s.railAxis === "x" ? [rW, RAIL, RAIL] : [RAIL, RAIL, rD]} />
            {railMat}
          </mesh>
          {/* 中部横杆 */}
          <mesh position={
            s.railAxis === "x"
              ? [0, RH * 0.50, s.fixed]
              : [s.fixed, RH * 0.50, 0]
          }>
            <boxGeometry args={s.railAxis === "x" ? [rW, RAIL * 0.8, RAIL * 0.8] : [RAIL * 0.8, RAIL * 0.8, rD]} />
            {railMat}
          </mesh>
          {/* 玻璃填充板（半透明） */}
          <mesh position={
            s.railAxis === "x"
              ? [0, RH * 0.48, s.fixed + (s.fixed < 0 ? 0.02 : -0.02)]
              : [s.fixed + (s.fixed < 0 ? 0.02 : -0.02), RH * 0.48, 0]
          }>
            <boxGeometry args={s.railAxis === "x" ? [rW - POST, RH * 0.90, 0.01] : [0.01, RH * 0.90, rD - POST]} />
            {glassMat}
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ── 动态泳池焦散灯光（animated underwater caustic lights）────────────────────
/**
 * Simulates the shimmering caustic light patterns that appear on the bottom and
 * walls of a sunlit pool. Three point-lights orbit slowly at different phases and
 * radii to create organic, non-repeating motion. Intensity scales with pool glow.
 */
function AnimatedPoolCaustics({
  poolW, poolL, poolDp, poolGlowI,
}: {
  poolW: number; poolL: number; poolDp: number; poolGlowI: number;
}) {
  const t = useRef(0);
  const lightsRef = useRef<THREE.PointLight[]>([]);

  useFrame((_, delta) => {
    t.current += delta;
    const tc = t.current;
    // Three caustic lights move on different Lissajous-like paths inside the pool
    const configs = [
      { ax: poolW * 0.28, az: poolL * 0.22, fx: 0.31, fz: 0.19, phase: 0.0, baseI: 1.8 },
      { ax: poolW * 0.35, az: poolL * 0.30, fx: 0.19, fz: 0.27, phase: 2.1, baseI: 1.4 },
      { ax: poolW * 0.22, az: poolL * 0.38, fx: 0.25, fz: 0.15, phase: 4.2, baseI: 1.6 },
    ];
    lightsRef.current.forEach((light, i) => {
      if (!light) return;
      const cfg = configs[i];
      light.position.x = Math.sin(tc * cfg.fx + cfg.phase) * cfg.ax;
      light.position.z = Math.cos(tc * cfg.fz + cfg.phase) * cfg.az;
      light.position.y = -poolDp * 0.55;
      // Gently pulse each light independently
      const pulse = 0.80 + 0.20 * Math.sin(tc * 1.3 + cfg.phase);
      light.intensity = cfg.baseI * poolGlowI * pulse;
    });
  });

  return (
    <>
      {[0, 1, 2].map((i) => (
        <pointLight
          key={i}
          ref={(el) => { if (el) lightsRef.current[i] = el; }}
          distance={poolW * 1.2}
          decay={1.8}
          color="#50D8F0"
          castShadow={false}
        />
      ))}
    </>
  );
}

// ── 主组件 ────────────────────────────────────────────────────
export default function FloorPlanBuilding({
  insideBuilding = false, wallXray = false,
  onEnterRoom,
}: {
  insideBuilding?: boolean;
  wallXray?: boolean;
  /** When provided, clicking a room block / window enters first-person
   *  walkthrough mode at that room's center (handled by HouseCanvas
   *  parent), instead of switching to the single-room 3D view. */
  onEnterRoom?: (room: RoomType, floorIndex: number, worldPos: [number, number, number]) => void;
}) {
  const floorPlans     = useDesignerStore(s => s.floorPlans);
  const exterior       = useDesignerStore(s => s.exterior);
  const floorCount     = Math.max(exterior.floors, 1);
  const setActiveRoom  = useDesignerStore(s => s.setActiveRoom);
  const setViewMode    = useDesignerStore(s => s.setViewMode);
  const setActiveFloor = useDesignerStore(s => s.setActiveFloor);
  const sunHour        = useDesignerStore(s => s.sunHour);

  // ── Interior emissive intensity driven by time-of-day ──────────────────
  // Night/late evening → rooms glow warm from within (high emissive).
  // Full day → minimal emissive (interior looks lit by natural light).
  const interiorGlowWall: number = sunHour < 6 || sunHour > 20
    ? 2.10   // night — strong warm interior glow visible through clear glass
    : sunHour < 8 || sunHour > 18
    ? 1.55   // dawn/dusk — warm amber glow
    : 1.15;  // day — visible but not overpowering (more transparent glass shows this)
  const interiorGlowCeil: number = sunHour < 6 || sunHour > 20
    ? 1.10   // night ceiling — warm downlight wash
    : sunHour < 8 || sunHour > 18
    ? 0.85   // dawn/dusk ceiling
    : 0.72;  // day ceiling — warm ambient

  /** Click door/window on exterior →
   *  - if onEnterRoom prop given: walkthrough mode at this room's centre
   *  - else: legacy behaviour (switch to single-room RoomCanvas view) */
  const enterRoom = useCallback((room: RoomType, floorIndex: number) => {
    setActiveFloor(floorIndex);
    setActiveRoom(room);
    if (onEnterRoom) {
      // Compute world-space room centre (matches the building's coord system).
      const fp = floorPlans[floorIndex];
      const dims = fp?.roomDimensions?.[room];
      const lay  = fp?.roomLayout?.[room];
      if (dims && lay) {
        // planOffset is computed below at first render — for this callback we
        // re-compute a fresh bounding box (cheap; happens on every click).
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let fi = 0; fi < floorPlans.length; fi++) {
          const f2 = floorPlans[fi]; if (!f2) continue;
          for (const r of (f2.enabledRooms ?? []).filter(rr => !ROOM_DEFS[rr]?.isOutdoor)) {
            const p = f2.roomLayout?.[r]; const d = f2.roomDimensions?.[r];
            if (!p || !d) continue;
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x + d.width); maxY = Math.max(maxY, p.y + d.depth);
          }
        }
        const W = (maxX - minX) * CM;
        const D = (maxY - minY) * CM;
        const cx = ((lay.x + dims.width / 2 - minX) * CM) - W / 2;
        const cz = -(((lay.y + dims.depth / 2 - minY) * CM)) + D / 2;
        const cy = floorIndex * FLOOR_H + 1.6;   // eye height
        onEnterRoom(room, floorIndex, [cx, cy, cz]);
        return;
      }
    }
    setViewMode("3d");
  }, [setActiveFloor, setActiveRoom, setViewMode, onEnterRoom, floorPlans]);

  /** Track which block is hovered for tooltip */
  const [hoveredRoom, setHoveredRoom] = useState<{ room: RoomType; fi: number } | null>(null);

  // 全局包围盒（所有楼层取并集）
  const planOffset = useMemo<PlanOffset>(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let fi = 0; fi < floorCount; fi++) {
      const fp = floorPlans[fi];
      if (!fp) continue;
      for (const r of (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor)) {
        const p = fp.roomLayout?.[r]; const d = fp.roomDimensions?.[r];
        if (!p || !d) continue;
        minX = Math.min(minX, p.x);           minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + d.width); maxY = Math.max(maxY, p.y + d.depth);
      }
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, W: 10, D: 8 };
    return { minX, minY, W: (maxX - minX) * CM, D: (maxY - minY) * CM };
  }, [floorPlans, floorCount]);

  const { W, D } = planOffset;
  const wallColor  = exterior.wallColor ?? "#F0EDE6";
  const buildingType = (exterior as any).buildingType ?? "";
  const isGlassVilla = buildingType === "rich-glass-villa" || buildingType === "floor-plan-driven";

  // ── 每层世界坐标包围盒（共用于外墙段 + 室内渲染）──────────────────────────
  const floorBoundsArr = useMemo(() => {
    const arr: Array<{ minX: number; maxX: number; minZ: number; maxZ: number } | null> = [];
    for (let fi = 0; fi < floorCount; fi++) {
      const fp2 = floorPlans[fi];
      if (!fp2) { arr.push(null); continue; }
      let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
      for (const r of (fp2.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor)) {
        const p2 = fp2.roomLayout?.[r]; const d2 = fp2.roomDimensions?.[r];
        if (!p2 || !d2) continue;
        bMinX = Math.min(bMinX, p2.x); bMinY = Math.min(bMinY, p2.y);
        bMaxX = Math.max(bMaxX, p2.x + d2.width); bMaxY = Math.max(bMaxY, p2.y + d2.depth);
      }
      if (!isFinite(bMinX)) { arr.push(null); continue; }
      arr.push({
        minX: (bMinX - planOffset.minX) * CM - W / 2,
        maxX: (bMaxX - planOffset.minX) * CM - W / 2,
        minZ: -((bMaxY - planOffset.minY) * CM) + D / 2,
        maxZ: -((bMinY - planOffset.minY) * CM) + D / 2,
      });
    }
    return arr;
  }, [floorPlans, floorCount, planOffset, W, D]);

  // ── 自动门 / 窗户方向修正工具（外墙段 + 室内共用）──────────────────────────
  const AUTO_DOOR_W = 80; // cm
  const WIN_EPS = 0.25;   // metres: wall is "on exterior" if distance < this

  function calcWallDists(
    cx: number, cz: number, rW: number, rD: number,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  ) {
    return {
      back:  (cz - rD / 2) - bounds.minZ,
      front: bounds.maxZ   - (cz + rD / 2),
      left:  (cx - rW / 2) - bounds.minX,
      right: bounds.maxX   - (cx + rW / 2),
    };
  }

  function pickAutoDoor(
    fi: number, room: RoomType,
    cx: number, cz: number, rW: number, rD: number, rWcm: number, rDcm: number,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  ): DoorConfig {
    const d = calcWallDists(cx, cz, rW, rD, bounds);
    const EPS = 0.25; // metres: wall is "on exterior" if distance < this

    // 一楼客厅：大门朝向阳侧外墙（最小距离 = 最接近外边界）
    if (fi === 0 && room === "living") {
      const all: [DoorConfig["wall"], number, number][] = [
        ["back",  d.back,  Math.max(0, (rWcm - AUTO_DOOR_W) / 2)],
        ["front", d.front, Math.max(0, (rWcm - AUTO_DOOR_W) / 2)],
        ["left",  d.left,  Math.max(0, (rDcm - AUTO_DOOR_W) / 2)],
        ["right", d.right, Math.max(0, (rDcm - AUTO_DOOR_W) / 2)],
      ];
      all.sort((a, b) => a[1] - b[1]); // ascending → most exterior first
      const [wall, , pos] = all[0];
      return { id: `auto-${fi}-${room}-${wall}`, wall, pos, len: AUTO_DOOR_W, h: 200 };
    }

    // 其他房间：走廊侧门
    // 优先 Y 轴方向（back/front）的内墙 — 水平走廊布局中这两面墙朝向走廊
    // 若 Y 轴两面墙都是外墙，则回退到 X 轴内墙
    const yWalls: [DoorConfig["wall"], number, number][] = (
      [["back",  d.back,  Math.max(0, (rWcm - AUTO_DOOR_W) / 2)],
       ["front", d.front, Math.max(0, (rWcm - AUTO_DOOR_W) / 2)]] as [DoorConfig["wall"], number, number][]
    ).filter(([, dist]) => (dist as number) >= EPS);

    const xWalls: [DoorConfig["wall"], number, number][] = (
      [["left",  d.left,  Math.max(0, (rDcm - AUTO_DOOR_W) / 2)],
       ["right", d.right, Math.max(0, (rDcm - AUTO_DOOR_W) / 2)]] as [DoorConfig["wall"], number, number][]
    ).filter(([, dist]) => (dist as number) >= EPS);

    const candidates = yWalls.length > 0 ? yWalls : xWalls;
    if (candidates.length > 0) {
      // 在候选中选最大距离（走廊侧通常是离外边界最远的内墙）
      candidates.sort((a, b) => b[1] - a[1]);
      const [wall, , pos] = candidates[0];
      return { id: `auto-${fi}-${room}-${wall}`, wall, pos, len: AUTO_DOOR_W, h: 200 };
    }

    // 回退：全外墙房间，用最近外墙（角落房间）
    const all: [DoorConfig["wall"], number, number][] = [
      ["back",  d.back,  Math.max(0, (rWcm - AUTO_DOOR_W) / 2)],
      ["front", d.front, Math.max(0, (rWcm - AUTO_DOOR_W) / 2)],
      ["left",  d.left,  Math.max(0, (rDcm - AUTO_DOOR_W) / 2)],
      ["right", d.right, Math.max(0, (rDcm - AUTO_DOOR_W) / 2)],
    ];
    all.sort((a, b) => a[1] - b[1]);
    const [wall, , pos] = all[0];
    return { id: `auto-${fi}-${room}-${wall}`, wall, pos, len: AUTO_DOOR_W, h: 200 };
  }

  function adjustWindowWall(
    win: WindowConfig,
    cx: number, cz: number, rW: number, rD: number, rWcm: number, rDcm: number,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    doorWall?: DoorConfig["wall"]
  ): WindowConfig {
    const d = calcWallDists(cx, cz, rW, rD, bounds);
    const configuredDist = d[win.wall as keyof typeof d] ?? Infinity;

    // If configured wall is on the exterior (dist < WIN_EPS) and not the door wall,
    // keep it there — only clamp the position within the wall to avoid overflow.
    if (configuredDist < WIN_EPS && win.wall !== doorWall) {
      const wallLen = (win.wall === "left" || win.wall === "right") ? rDcm : rWcm;
      const safePos = Math.max(5, Math.min(win.pos ?? 0, wallLen - (win.len ?? 80) - 5));
      return { ...win, pos: safePos, len: Math.min(win.len, Math.round(wallLen * 0.70)) };
    }

    // Configured wall is interior or is the door wall — pick best exterior wall.
    const ranked = (["back", "front", "left", "right"] as const)
      .map(w => ({ w, dist: d[w] ?? Infinity }))
      .sort((a, b) => a.dist - b.dist);

    const target = ranked.find(({ w, dist }) => dist < WIN_EPS && w !== doorWall)
      ?? ranked.find(({ w }) => w !== doorWall)
      ?? ranked[0];

    const extWall = target.w;
    const wallLen = (extWall === "left" || extWall === "right") ? rDcm : rWcm;
    return { ...win, wall: extWall, pos: Math.round(wallLen * 0.15), len: Math.min(win.len, Math.round(wallLen * 0.65)) };
  }

  // 外墙段检测（用于覆盖材质）
  const allSegs = useMemo<ExteriorWallSeg[]>(() => {
    const result: ExteriorWallSeg[] = [];
    for (let fi = 0; fi < floorCount; fi++) {
      const fp = floorPlans[fi];
      if (!fp) continue;
      const rooms = (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor) as RoomType[];
      const bounds = floorBoundsArr[fi];

      // ── 逐房间计算自动门 + 窗户修正 ──
      const mergedDoors: Record<string, DoorConfig[]> = {};
      const mergedWindows: Record<string, WindowConfig[]> = {};

      for (const r of rooms) {
        if (r === "stair" || r === "hallway") continue;
        const p = fp.roomLayout?.[r]; const dd = fp.roomDimensions?.[r];
        if (!p || !dd) continue;
        const rW = dd.width * CM; const rD = dd.depth * CM;
        const cx = (p.x + dd.width  / 2 - planOffset.minX) * CM - W / 2;
        const cz = -((p.y + dd.depth / 2 - planOffset.minY) * CM) + D / 2;

        // 门：有配置门用配置门，否则用自动门
        const configuredDoors = fp.roomDoors?.[r] ?? [];
        if (configuredDoors.length > 0) {
          mergedDoors[r] = configuredDoors;
        } else if (bounds) {
          mergedDoors[r] = [pickAutoDoor(fi, r, cx, cz, rW, rD, dd.width, dd.depth, bounds)];
        }

        // 窗：修正到外墙，且不与门在同一面墙
        const wins = fp.roomWindows?.[r] ?? [];
        const doorWall0 = mergedDoors[r]?.[0]?.wall;
        if (wins.length > 0 && bounds) {
          mergedWindows[r] = wins.map(w => adjustWindowWall(w, cx, cz, rW, rD, dd.width, dd.depth, bounds, doorWall0));
        } else {
          mergedWindows[r] = wins;
        }
      }

      result.push(...computeExteriorWalls(rooms, fp.roomLayout ?? {}, fp.roomDimensions ?? {}, mergedWindows, fi, mergedDoors));
    }
    return result;
  }, [floorPlans, floorCount, floorBoundsArr, planOffset, W, D]);

  const usedFloors = allSegs.length > 0 ? Math.max(...allSegs.map(s => s.floorIndex)) + 1 : 1;
  const totalH     = usedFloors * (FLOOR_H + SLAB_T) - SLAB_T;

  // 把相邻共面段合并 → 玻璃幕墙不再出现双框缝
  const facadeBlocks = useMemo(() => buildFacadeBlocks(allSegs), [allSegs]);

  // 哪些房间最终会被渲染成玻璃幕墙？复刻外墙渲染那段判玻璃的逻辑
  // （显式 override > auto-detected glass coverage > isGlassVilla 南面），
  // 然后把这些房间收集到 Set 里。下面"房间盒子 / 低 LOD 家具 / 背景填充板"
  // 都用这个 Set 做条件，自动判玻璃的房间也能得到暖色发光内饰，不必靠
  // 用户手动切到"玻璃幕墙"。
  const glassRooms = useMemo(() => {
    const set = new Set<string>();
    for (const block of facadeBlocks) {
      const fp = floorPlans[block.floorIndex];
      if (!fp) continue;
      const styles = block.rooms.map(r => fp.roomExteriorStyle?.[r] ?? "auto");
      const forceGlass    = styles.some(s => s === "glass");
      const forceConcrete = !forceGlass && styles.some(s => s === "concrete");
      const segLen = (block.mergedEnd - block.mergedStart) * CM;
      const totalWinLen = block.winEntries.reduce((s, e) => s + e.w.len, 0);
      const winCoverage = segLen > 0 ? (totalWinLen * CM) / segLen : 0;
      const isSouth = block.side === "south";
      const isGlassWall = winCoverage > 0.42 || (isGlassVilla && (isSouth || winCoverage > 0.28));
      // 阳台默认开放：自动判玻璃（实际上半透明栏杆效果，不再像实墙包房间）
      const hasBalcony = block.rooms.some(r => r === "balcony" || r === "balcony2");
      let isGlass: boolean;
      if (forceGlass) isGlass = true;
      else if (forceConcrete) isGlass = false;
      else if (hasBalcony) isGlass = true;
      else if (isGlassVilla) isGlass = isGlassWall;
      else isGlass = false;
      if (isGlass) {
        for (const r of block.rooms) set.add(`${block.floorIndex}:${r}`);
      }
    }
    return set;
  }, [facadeBlocks, floorPlans, isGlassVilla]);

  // ── 室内渲染数据（地板 + 墙面材质 + 天花板 + 家具）────────────────────────────
  const interiorRooms = useMemo(() => {
    const result: Array<{
      room: RoomType; fi: number;
      cx: number; cz: number; yBase: number;
      rW: number; rD: number; rWcm: number; rDcm: number;
      floorColor: string; wallColor: string;
      placedItems: PlacedItem[];
      doors: DoorConfig[];
      windows: WindowConfig[];
      isStair: boolean;
      isHallway: boolean;
      autoDoor: DoorConfig | null;
      stairShape: "straight" | "L-shaped" | "spiral";
      stairRotation: 0 | 90 | 180 | 270;
    }> = [];

    for (let fi = 0; fi < floorCount; fi++) {
      const fp = floorPlans[fi];
      if (!fp) continue;
      for (const room of (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor) as RoomType[]) {
        const p = fp.roomLayout?.[room]; const d = fp.roomDimensions?.[room];
        if (!p || !d) continue;
        const rW = d.width * CM; const rD = d.depth * CM;
        const rWcm = d.width; const rDcm = d.depth;
        const cx = (p.x + d.width  / 2 - planOffset.minX) * CM - W / 2;
        const cz = -((p.y + d.depth / 2 - planOffset.minY) * CM) + D / 2;
        const yBase = fi * (FLOOR_H + SLAB_T);
        const mats = fp.rooms?.[room]?.materials;
        const floorColor = mats?.floor?.color ?? ROOM_DEFS[room]?.defaultFloorColor ?? "#C8A882";
        const wallColor  = mats?.wall?.color  ?? ROOM_DEFS[room]?.defaultWallColor  ?? "#EDE8E0";
        const placedItems = fp.rooms?.[room]?.placedItems ?? [];
        const doors = fp.roomDoors?.[room] ?? [];
        const windows = fp.roomWindows?.[room] ?? [];
        const isStair = room === "stair";
        const isHallway = room === "hallway";
        const stairCfg = fp.stairConfig;
        const stairShape  = stairCfg?.shape ?? "straight";
        const stairRotation = stairCfg?.rotation ?? 0;
        const bounds = floorBoundsArr[fi];

        // 自动门（共用 pickAutoDoor）
        const autoDoor: DoorConfig | null =
          (!isStair && !isHallway && doors.length === 0 && bounds)
            ? pickAutoDoor(fi, room, cx, cz, rW, rD, rWcm, rDcm, bounds)
            : null;

        // 窗户方向修正：强制到不同于门的外墙，彻底避免门窗同墙重叠
        const doorWallForRoom = autoDoor?.wall ?? doors[0]?.wall;
        const adjustedWindows = (bounds && windows.length > 0)
          ? windows.map(w => adjustWindowWall(w, cx, cz, rW, rD, rWcm, rDcm, bounds, doorWallForRoom))
          : windows;

        result.push({ room, fi, cx, cz, yBase, rW, rD, rWcm, rDcm, floorColor, wallColor, placedItems, doors, windows: adjustedWindows, isStair, isHallway, autoDoor, stairShape, stairRotation });
      }
    }
    return result;
  }, [floorPlans, floorCount, floorBoundsArr, planOffset, W, D]);

  return (
    <group>
      {/* 地面基座 — 浅色石灰石平台（建筑基层）*/}
      <mesh position={[0, -0.04, 0]} receiveShadow>
        <boxGeometry args={[W + 0.55, 0.10, D + 0.55]} />
        <meshStandardMaterial color="#D4CCBA" roughness={0.72} metalness={0.03} envMapIntensity={0.35} />
      </mesh>

      {/* ── 北面室外空调冷凝器（outdoor HVAC condensing units）—— 背面服务区 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const unitH = 0.90, unitW = 0.70, unitD = 0.28;
        const unitY = unitH / 2 + 0.004;
        const northZ = D / 2 + 0.18;
        // 2-3 units depending on building width
        const count = Math.min(3, Math.max(2, Math.round(W / 4.5)));
        const spacing = Math.min(W * 0.22, 1.80);
        const isNight4 = sunHour < 6 || sunHour > 20;
        const isDusk4  = !isNight4 && (sunHour < 8 || sunHour > 18);
        const fanI = isNight4 ? 0.9 : isDusk4 ? 0.7 : 0.5;
        return (
          <group>
            {Array.from({ length: count }, (_, ui) => {
              const ux = -spacing * (count - 1) / 2 + ui * spacing;
              return (
                <group key={ui} position={[ux, unitY, northZ]}>
                  {/* Main casing */}
                  <mesh castShadow>
                    <boxGeometry args={[unitW, unitH, unitD]} />
                    <meshStandardMaterial color="#B8B4AC" roughness={0.72} metalness={0.14} />
                  </mesh>
                  {/* Front grille */}
                  <mesh position={[0, 0, -unitD / 2 - 0.005]}>
                    <boxGeometry args={[unitW - 0.04, unitH - 0.06, 0.012]} />
                    <meshStandardMaterial color="#989490" roughness={0.80} metalness={0.08} />
                  </mesh>
                  {/* Fan disc */}
                  <mesh position={[0, 0.10, -unitD / 2 - 0.012]}>
                    <cylinderGeometry args={[0.22, 0.22, 0.010, 12]} />
                    <meshStandardMaterial color="#707070" emissive="#505050" emissiveIntensity={fanI} roughness={0.45} metalness={0.55} />
                  </mesh>
                  {/* Piping connection */}
                  <mesh position={[unitW / 2 - 0.06, -unitH / 2 + 0.14, 0]} rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.018, 0.018, 0.40, 6]} />
                    <meshStandardMaterial color="#888480" roughness={0.60} metalness={0.40} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 建筑周边铺装台地（perimeter paved terrace）——
              紧贴建筑基座向外延伸 1.6m，浅色石灰华板，
              分割草坪与建筑体量，并提供服务通道视觉。
              南侧由入口广场覆盖，此处仅渲染东/西/北三边。 */}
      {!insideBuilding && isGlassVilla && (() => {
        const apronW = 1.60;   // terrace width (building-outward)
        const apronH = 0.005;  // almost flush with grade
        const apronY = -0.002; // just above grass
        const terrColor = "#D8D0BC";
        const edgeColor = "#3A3E48";
        const isNight5 = sunHour < 6 || sunHour > 20;
        const isDusk5  = !isNight5 && (sunHour < 8 || sunHour > 18);
        const ledI = isNight5 ? 1.6 : isDusk5 ? 0.8 : 0.0;
        return (
          <group position={[0, apronY, 0]}>
            {/* East terrace strip */}
            <mesh position={[W / 2 + apronW / 2 + 0.05, 0, 0]} receiveShadow>
              <boxGeometry args={[apronW, apronH, D + apronW * 2]} />
              <meshStandardMaterial color={terrColor} roughness={0.68} metalness={0.02} />
            </mesh>
            {/* West terrace strip */}
            <mesh position={[-W / 2 - apronW / 2 - 0.05, 0, 0]} receiveShadow>
              <boxGeometry args={[apronW, apronH, D + apronW * 2]} />
              <meshStandardMaterial color={terrColor} roughness={0.68} metalness={0.02} />
            </mesh>
            {/* North terrace strip */}
            <mesh position={[0, 0, D / 2 + apronW / 2 + 0.05]} receiveShadow>
              <boxGeometry args={[W + 0.10, apronH, apronW]} />
              <meshStandardMaterial color={terrColor} roughness={0.68} metalness={0.02} />
            </mesh>
            {/* Terrace edge line (metal strip at grass boundary) */}
            {[
              { w: apronW + 0.02, d: 0.025, x:  W / 2 + apronW + 0.05, z: 0 },
              { w: apronW + 0.02, d: 0.025, x: -W / 2 - apronW - 0.05, z: 0 },
              { w: 0.025, d: W + apronW * 2 + 0.14, x: 0, z: D / 2 + apronW + 0.06 },
            ].map((e, ei) => (
              <mesh key={ei} position={[e.x, 0.008, e.z]}>
                <boxGeometry args={[e.w, 0.016, e.d]} />
                <meshStandardMaterial color={edgeColor} roughness={0.28} metalness={0.82} envMapIntensity={1.6} />
              </mesh>
            ))}
            {/* LED ground marker lights at terrace edge (east + west sides) */}
            {ledI > 0 && [
              ...Array.from({ length: Math.round(D / 1.8) }, (_, gi) => ({
                x: W / 2 + apronW - 0.05, z: -D / 2 + 0.9 + gi * 1.8,
              })),
              ...Array.from({ length: Math.round(D / 1.8) }, (_, gi) => ({
                x: -W / 2 - apronW + 0.05, z: -D / 2 + 0.9 + gi * 1.8,
              })),
            ].map(({ x, z }, mi) => (
              <group key={mi} position={[x, 0.012, z]}>
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[0.040, 8]} />
                  <meshStandardMaterial color="#C0C8D0" emissive="#A0C8E8" emissiveIntensity={ledI} roughness={0.5} />
                </mesh>
                <pointLight position={[0, 0.04, 0]} intensity={ledI * 0.5} distance={1.2} decay={2.5} color="#B8E0F8" />
              </group>
            ))}
          </group>
        );
      })()}
      {/* 建筑基座 — 两段式：下部黑花岗岩脚踢 + 上部深色抛光石材 */}
      {!insideBuilding && (
        <>
          {/* 下段：黑色花岗岩（低粗糙度，轻微抛光反射）*/}
          <mesh position={[0, 0.10, 0]} castShadow>
            <boxGeometry args={[W + 0.10, 0.20, D + 0.10]} />
            <meshStandardMaterial color="#1A1C22" roughness={0.42} metalness={0.28} envMapIntensity={1.4} />
          </mesh>
          {/* 上段：深灰玄武岩（稍浅，形成两段阴影层次）*/}
          <mesh position={[0, 0.30, 0]} castShadow>
            <boxGeometry args={[W + 0.06, 0.20, D + 0.06]} />
            <meshStandardMaterial color="#272B33" roughness={0.55} metalness={0.18} envMapIntensity={1.0} />
          </mesh>
          {/* 基座顶面金属压边（薄钢条，视觉分割线）*/}
          <mesh position={[0, 0.405, 0]}>
            <boxGeometry args={[W + 0.07, 0.010, D + 0.07]} />
            <meshStandardMaterial color="#3A3E48" roughness={0.18} metalness={0.92} envMapIntensity={2.0} />
          </mesh>
        </>
      )}
      {/* ── 基座悬浮灯带（floating building LED gap）——
           A continuous thin warm LED strip in the shadow gap between ground
           and building base. Creates the "floating box" silhouette effect
           popular in luxury contemporary architecture. Night-mode only. */}
      {!insideBuilding && (() => {
        const isNightFL = sunHour < 6 || sunHour > 20;
        const isDuskFL  = !isNightFL && (sunHour < 8 || sunHour > 18);
        const floatEmi  = isNightFL ? 3.0 : isDuskFL ? 1.5 : 0.0;
        const floatLI   = isNightFL ? 4.5 : isDuskFL ? 2.2 : 0.0;
        if (floatEmi === 0.0) return null;
        const gapY   = 0.072;   // top of granite base lower section
        const gapH   = 0.018;   // gap height
        const gapT   = 0.015;   // strip depth
        const bW     = W + 0.12;
        const bD     = D + 0.12;
        const color  = "#FFE4A0";
        return (
          <group position={[0, gapY, 0]}>
            {/* South strip */}
            <mesh position={[0, 0, -bD / 2]}>
              <boxGeometry args={[bW, gapH, gapT]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={floatEmi} roughness={0.70} />
            </mesh>
            {/* North strip */}
            <mesh position={[0, 0, bD / 2]}>
              <boxGeometry args={[bW, gapH, gapT]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={floatEmi} roughness={0.70} />
            </mesh>
            {/* East strip */}
            <mesh position={[bW / 2, 0, 0]}>
              <boxGeometry args={[gapT, gapH, bD]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={floatEmi} roughness={0.70} />
            </mesh>
            {/* West strip */}
            <mesh position={[-bW / 2, 0, 0]}>
              <boxGeometry args={[gapT, gapH, bD]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={floatEmi} roughness={0.70} />
            </mesh>
            {/* Corner point lights for volumetric halo */}
            {floatLI > 0 && ([
              [ bW / 2, 0,  bD / 2],
              [-bW / 2, 0,  bD / 2],
              [ bW / 2, 0, -bD / 2],
              [-bW / 2, 0, -bD / 2],
            ] as [number,number,number][]).map(([lx, ly, lz], li) => (
              <pointLight key={li} position={[lx, ly, lz]} intensity={floatLI * 0.25} distance={bW * 0.7} decay={2.2} color="#FFE880" castShadow={false} />
            ))}
          </group>
        );
      })()}

      {/* ── 入口雨棚 —— 1F 顶端向南悬挑（现代建筑标志性元素） ── */}
      {!insideBuilding && isGlassVilla && (() => {
        // 悬挑雨棚：在南立面 1F 顶端（y = FLOOR_H）向南伸出 2.0m
        // 起始于建筑南面外 20cm（避开层间楼板），向外延伸 2m
        const canopyW  = Math.min(W * 0.62, 8.0);
        const canopyD  = 2.0;   // 向南悬挑深度
        const canopyT  = 0.075; // 雨棚厚度（薄板）
        const canopyY  = FLOOR_H - 0.02;  // 紧贴 1F 顶端（略低于楼板）
        // 南立面外墙在 world-z ≈ -D/2。再向南 0.25m 开始，延伸 canopyD
        const southFaceZ = -D / 2 - 0.20;  // 玻璃幕墙平面约在此处
        const canopyZ    = southFaceZ - canopyD / 2;  // 雨棚中心
        const isNightC = sunHour < 6 || sunHour > 20;
        const isDuskC  = !isNightC && (sunHour < 8 || sunHour > 18);
        const soffitEmi = isNightC ? 3.5 : isDuskC ? 2.2 : 0.8;
        const soffitLI  = isNightC ? 5.0 : isDuskC ? 3.0 : 0.0;
        return (
          <group>
            {/* 雨棚板面（顶面浅色，底面深色）*/}
            <mesh position={[0, canopyY, canopyZ]} castShadow receiveShadow>
              <boxGeometry args={[canopyW, canopyT, canopyD]} />
              <meshStandardMaterial color="#ECEAE4" roughness={0.82} metalness={0.02} />
            </mesh>
            {/* 雨棚底面暗色 (soffit — dark painted concrete) */}
            <mesh position={[0, canopyY - canopyT / 2 - 0.002, canopyZ]}>
              <boxGeometry args={[canopyW + 0.01, 0.004, canopyD + 0.01]} />
              <meshStandardMaterial color="#1E222C" roughness={0.90} />
            </mesh>
            {/* Canopy fascia edge — aluminum C-profile on all 3 outer edges */}
            {([
              [0, canopyZ + canopyD / 2,  canopyW + 0.02, 0.040, 0.008],  // south edge
              [-canopyW / 2, canopyZ, 0.008, 0.040, canopyD],             // west edge
              [ canopyW / 2, canopyZ, 0.008, 0.040, canopyD],             // east edge
            ] as [number, number, number, number, number][]).map(([ex, ez, ew, eh, ed], ei) => (
              <mesh key={ei} position={[ex, canopyY + canopyT / 2 + eh / 2 - 0.001, ez]}>
                <boxGeometry args={[ew, eh, ed]} />
                <meshStandardMaterial color="#28303C" roughness={0.20} metalness={0.90} envMapIntensity={2.2} />
              </mesh>
            ))}
            {/* 三根方钢柱（左/中/右，等间距）—— 比圆柱更现代，与转角柱语言统一 */}
            {[-canopyW / 2 + 0.15, 0, canopyW / 2 - 0.15].map((cpx, ci) => (
              <group key={ci} position={[cpx, 0, southFaceZ + 0.06]}>
                {/* Column shaft */}
                <mesh position={[0, canopyY / 2, 0]} castShadow>
                  <boxGeometry args={[0.090, canopyY, 0.090]} />
                  <meshStandardMaterial color="#18181E" roughness={0.20} metalness={0.92} envMapIntensity={2.4} />
                </mesh>
                {/* Base plate — wider, sits on granite plaza */}
                <mesh position={[0, 0.020, 0]}>
                  <boxGeometry args={[0.160, 0.040, 0.160]} />
                  <meshStandardMaterial color="#28303C" roughness={0.28} metalness={0.80} envMapIntensity={2.0} />
                </mesh>
                {/* Capital plate — transitions into canopy soffit */}
                <mesh position={[0, canopyY - 0.020, 0]}>
                  <boxGeometry args={[0.140, 0.040, 0.140]} />
                  <meshStandardMaterial color="#22262E" roughness={0.22} metalness={0.88} envMapIntensity={2.2} />
                </mesh>
              </group>
            ))}
            {/* 嵌入式线型灯槽 — 软体底面 3 条（时间感知发光） */}
            {Array.from({ length: 3 }, (_, li) => {
              const slotX = -canopyW * 0.30 + li * canopyW * 0.30;
              return (
                <group key={li} position={[slotX, canopyY - canopyT / 2 - 0.005, canopyZ - 0.06]}>
                  {/* Recessed slot channel — dark recess */}
                  <mesh position={[0, 0, 0]}>
                    <boxGeometry args={[0.040, 0.010, canopyD * 0.72]} />
                    <meshStandardMaterial color="#14161C" roughness={0.95} />
                  </mesh>
                  {/* LED strip inside slot */}
                  <mesh position={[0, -0.003, 0]}>
                    <boxGeometry args={[0.028, 0.006, canopyD * 0.70]} />
                    <meshStandardMaterial
                      color="#FFF8E0"
                      emissive="#FFEE90"
                      emissiveIntensity={soffitEmi}
                      roughness={0.5}
                    />
                  </mesh>
                </group>
              );
            })}
            {/* 点光源（时间感知）*/}
            {soffitLI > 0 && (
              <pointLight
                position={[0, canopyY - canopyT / 2 - 0.10, canopyZ - 0.05]}
                intensity={soffitLI}
                distance={5.5}
                decay={1.6}
                color="#FFF6D8"
              />
            )}
          </group>
        );
      })()}

      {/* ── 入口雨棚两侧玻璃挡风屏（canopy side glass wind-screens）──
           Each end of the portico is enclosed with a framed glass screen:
           steel top/bottom rails + 3 vertical mullions + clear glass panels.
           The screens shelter the entrance from wind while maintaining openness. */}
      {!insideBuilding && isGlassVilla && (() => {
        const canopyW_sw  = Math.min(W * 0.62, 8.0);
        const canopyD_sw  = 2.0;
        const canopyT_sw  = 0.075;
        const canopyY_sw  = FLOOR_H - 0.02;   // top of canopy slab
        const southFaceZ_sw = -D / 2 - 0.20;
        const canopyZ_sw    = southFaceZ_sw - canopyD_sw / 2;
        const isNightSW  = sunHour < 6 || sunHour > 20;
        const isDuskSW   = !isNightSW && (sunHour < 8 || sunHour > 18);
        const glassEmiSW = isNightSW ? 0.12 : isDuskSW ? 0.04 : 0.0;

        // Screen height: ground (0) to canopy soffit
        const screenH  = canopyY_sw - canopyT_sw / 2 - 0.04;
        const screenD  = canopyD_sw - 0.04;          // depth of screen (Z)
        const frameT   = 0.028;                      // steel frame thickness
        const mullionCount = 3;
        const panelW_sw = (screenD - frameT * (mullionCount + 1)) / mullionCount;

        return (
          <group>
            {([-canopyW_sw / 2, canopyW_sw / 2] as number[]).map((sx, si) => (
              <group key={`sw-${si}`} position={[sx, 0, canopyZ_sw]}>
                {/* Top rail */}
                <mesh position={[0, screenH + frameT / 2, 0]}>
                  <boxGeometry args={[frameT, frameT, screenD]} />
                  <meshStandardMaterial color="#20242C" roughness={0.22} metalness={0.90} envMapIntensity={2.5} />
                </mesh>
                {/* Bottom rail */}
                <mesh position={[0, frameT / 2, 0]}>
                  <boxGeometry args={[frameT, frameT, screenD]} />
                  <meshStandardMaterial color="#20242C" roughness={0.22} metalness={0.90} envMapIntensity={2.5} />
                </mesh>
                {/* Vertical mullions */}
                {Array.from({ length: mullionCount + 1 }, (_, mi) => {
                  const mz = -screenD / 2 + mi * (screenD / mullionCount);
                  return (
                    <mesh key={mi} position={[0, screenH / 2, mz]}>
                      <boxGeometry args={[frameT, screenH, frameT]} />
                      <meshStandardMaterial color="#20242C" roughness={0.22} metalness={0.90} envMapIntensity={2.5} />
                    </mesh>
                  );
                })}
                {/* Glass panels between mullions */}
                {Array.from({ length: mullionCount }, (_, pi) => {
                  const gz = -screenD / 2 + frameT + (pi + 0.5) * panelW_sw + pi * frameT;
                  return (
                    <mesh key={`gp-${pi}`} position={[0, screenH / 2 + frameT, gz]} renderOrder={11}>
                      <boxGeometry args={[0.010, screenH - frameT, panelW_sw - 0.004]} />
                      <meshPhysicalMaterial
                        color="#C8E8F4"
                        transparent opacity={0.22}
                        roughness={0.02} metalness={0.04}
                        transmission={0.78}
                        envMapIntensity={4.0}
                        emissive="#90C8E0" emissiveIntensity={glassEmiSW}
                        side={THREE.DoubleSide}
                        depthWrite={false}
                      />
                    </mesh>
                  );
                })}
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 入口台阶 + 入口广场 + 水景线 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const southFaceZ2 = -D / 2 - 0.20;
        const stepW = Math.min(W * 0.50, 5.5);  // step width
        const nSteps = 3;
        const stepRise = 0.14;  // each step rise (m)
        const stepRun  = 0.38;  // each step run (m)
        const baseY = -nSteps * stepRise;  // ground level depression (building base is at 0.40)
        const plazaW = stepW + 2.8;
        const plazaD = nSteps * stepRun + 0.60;
        const plazaZ = southFaceZ2 - plazaD / 2;

        return (
          <group>
            {/* 入口广场地面 — 深灰色抛光花岗岩 */}
            <mesh position={[0, -0.002, plazaZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[plazaW + 0.40, plazaD + 0.20]} />
              <meshStandardMaterial color="#28292E" roughness={0.28} metalness={0.12} envMapIntensity={1.6} />
            </mesh>
            {/* 广场地面刻线（格栅效果）*/}
            {Array.from({ length: 5 }, (_, gi) => {
              const gx = -plazaW / 2 + gi * (plazaW / 4);
              return (
                <mesh key={gi} position={[gx, 0.001, plazaZ]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[0.012, plazaD + 0.22]} />
                  <meshStandardMaterial color="#1A1B20" roughness={0.40} metalness={0.08} />
                </mesh>
              );
            })}

            {/* 台阶（3 级，从广场升至建筑入口）*/}
            {Array.from({ length: nSteps }, (_, si) => {
              const sy = si * stepRise + 0.005;
              const sz = southFaceZ2 - si * stepRun - stepRun / 2;
              const sw = stepW - si * 0.12;  // slight tapering for elegance
              const isNightStep = sunHour < 6 || sunHour > 20;
              const isDuskStep  = !isNightStep && (sunHour < 8 || sunHour > 18);
              const riserEmi    = isNightStep ? 1.8 : isDuskStep ? 0.9 : 0.0;
              return (
                <group key={si}>
                  <mesh position={[0, sy, sz]} castShadow receiveShadow>
                    <boxGeometry args={[sw, stepRise, stepRun]} />
                    <meshStandardMaterial color="#D8D4CC" roughness={0.45} metalness={0.06} envMapIntensity={0.9} />
                  </mesh>
                  {/* LED riser strip — warm amber light under each tread */}
                  {riserEmi > 0 && (
                    <>
                      <mesh position={[0, sy - stepRise * 0.30, sz - stepRun / 2 - 0.005]}>
                        <boxGeometry args={[sw - 0.08, 0.010, 0.012]} />
                        <meshStandardMaterial color="#FFE8B0" emissive="#FFD880" emissiveIntensity={riserEmi} roughness={0.70} />
                      </mesh>
                      <pointLight position={[0, sy - stepRise * 0.30, sz - stepRun / 2 - 0.02]} intensity={riserEmi * 0.8} distance={sw * 0.8} decay={2.0} color="#FFE080" />
                    </>
                  )}
                </group>
              );
            })}

            {/* ── 线型水景（horizontal water blade）—— 紧贴建筑基座南面，
                 玻璃幕墙的反射映在水面上，强化建筑感 ── */}
            {(() => {
              const wbW   = Math.min(W * 0.70, 9.0);
              const wbZ   = southFaceZ2 + 0.28;   // just south of the south face
              const wbY   = 0.02;                  // water surface at ground level
              return (
                <group>
                  {/* Stone trough rim (2 sides) */}
                  {([-wbW / 2 - 0.10, wbW / 2 + 0.10] as number[]).map((rx2, ri) => (
                    <mesh key={ri} position={[rx2, wbY + 0.02, wbZ]}>
                      <boxGeometry args={[0.14, 0.06, 0.60]} />
                      <meshStandardMaterial color="#D0CCBE" roughness={0.68} />
                    </mesh>
                  ))}
                  {/* Trough back wall (against building) */}
                  <mesh position={[0, wbY + 0.02, wbZ + 0.28]}>
                    <boxGeometry args={[wbW + 0.30, 0.06, 0.10]} />
                    <meshStandardMaterial color="#D0CCBE" roughness={0.68} />
                  </mesh>
                  {/* Water surface — reflective turquoise blue */}
                  <mesh position={[0, wbY, wbZ]} rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[wbW, 0.55]} />
                    <meshStandardMaterial
                      color="#78B8CC" roughness={0.02} metalness={0.04}
                      envMapIntensity={6.5}
                      emissive="#3090A8" emissiveIntensity={0.06}
                      transparent opacity={0.90}
                    />
                  </mesh>
                  {/* LED strip along water (glows at night) */}
                  <mesh position={[0, wbY + 0.025, wbZ + 0.24]}>
                    <boxGeometry args={[wbW, 0.012, 0.014]} />
                    <meshStandardMaterial color="#80D8F0" emissive="#40C8E8" emissiveIntensity={1.4} />
                  </mesh>
                  <pointLight position={[0, wbY + 0.05, wbZ]} intensity={2.0} distance={wbW} decay={2.0} color="#40C8E8" castShadow={false} />
                  {/* Stone coping on far (south) side of water trough */}
                  <mesh position={[0, wbY + 0.02, wbZ - 0.30]}>
                    <boxGeometry args={[wbW + 0.30, 0.055, 0.12]} />
                    <meshStandardMaterial color="#D4CCBA" roughness={0.72} metalness={0.02} />
                  </mesh>
                </group>
              );
            })()}

            {/* ── 水景喷射水柱（water jet arcs from trough）——
                 5 thin parabolic arcs emerge from the trough back-wall,
                 simulated as angled thin cylinders. Glowing at night. */}
            {(() => {
              const wbW_j = Math.min(W * 0.70, 9.0);
              const wbZ_j = southFaceZ2 + 0.28;
              const isNightJ = sunHour < 6 || sunHour > 20;
              const isDuskJ  = !isNightJ && (sunHour < 8 || sunHour > 18);
              const jetGlowI = isNightJ ? 1.8 : isDuskJ ? 0.8 : 0.06;
              const jetCount = 5;
              const jetStep  = wbW_j / (jetCount - 1);
              // Each jet: origin at back wall of trough, angle ~30° south-down
              const jetLen  = 0.42;  // arc segment length
              const jetAngle = Math.PI * 0.22;  // 40° below horizontal
              return (
                <group>
                  {Array.from({ length: jetCount }, (_, ji) => {
                    const jx = -wbW_j / 2 + ji * jetStep;
                    const jOriginZ = wbZ_j + 0.22;  // at back wall
                    const jOriginY = 0.06;
                    // Position the jet mid-point between origin and arc tip
                    const midX = jx;
                    const midY = jOriginY + Math.cos(jetAngle) * jetLen / 2;
                    const midZ = jOriginZ - Math.sin(jetAngle) * jetLen / 2;
                    return (
                      <group key={`jet-${ji}`} position={[midX, midY, midZ]}
                        rotation={[jetAngle, 0, 0]}>
                        <mesh>
                          <cylinderGeometry args={[0.012, 0.014, jetLen, 6]} />
                          <meshStandardMaterial
                            color="#80D8F0"
                            transparent opacity={0.72}
                            roughness={0.04} metalness={0.02}
                            emissive="#40B8E0" emissiveIntensity={jetGlowI}
                          />
                        </mesh>
                      </group>
                    );
                  })}
                </group>
              );
            })()}

            {/* ── 入口步道路灯柱（bollard lights）—— 水景两侧 4 盏，等间距 ── */}
            {(() => {
              const wbW2 = Math.min(W * 0.70, 9.0);
              const wbZ2 = southFaceZ2 + 0.28;
              const bCount = 4;
              const bSpacing = wbW2 / (bCount - 1);
              const bollardH = 0.68;
              const isNight3 = sunHour < 6 || sunHour > 20;
              const isDusk3  = !isNight3 && (sunHour < 8 || sunHour > 18);
              const bollardEmi = isNight3 ? 2.8 : isDusk3 ? 1.4 : 0.3;
              const bollardLI  = isNight3 ? 3.0 : isDusk3 ? 1.5 : 0.0;
              return (
                <group>
                  {Array.from({ length: bCount }, (_, bi) => {
                    const bx = -wbW2 / 2 + bi * bSpacing;
                    const bz = wbZ2 - 0.35;   // in front of water trough
                    return (
                      <group key={bi} position={[bx, 0, bz]}>
                        {/* Bollard post — brushed steel cylinder */}
                        <mesh position={[0, bollardH / 2, 0]} castShadow>
                          <cylinderGeometry args={[0.038, 0.042, bollardH, 8]} />
                          <meshStandardMaterial color="#485060" roughness={0.28} metalness={0.80} envMapIntensity={1.6} />
                        </mesh>
                        {/* Bollard head — wider cap with frosted diffuser */}
                        <mesh position={[0, bollardH + 0.045, 0]}>
                          <cylinderGeometry args={[0.066, 0.055, 0.090, 8]} />
                          <meshStandardMaterial color="#D8E0E8" emissive="#FFF8E8" emissiveIntensity={bollardEmi} roughness={0.50} />
                        </mesh>
                        {/* Point light when lit */}
                        {bollardLI > 0 && (
                          <pointLight position={[0, bollardH + 0.06, 0]} intensity={bollardLI} distance={2.5} decay={2} color="#FFF4E0" />
                        )}
                      </group>
                    );
                  })}
                </group>
              );
            })()}

            {/* 两侧种植槽（黑色钢制树箱 + 修剪球形灌木）*/}
            {([-stepW / 2 - 1.0, stepW / 2 + 1.0] as number[]).map((bx, bi) => (
              <group key={bi} position={[bx, 0.02, southFaceZ2 - 0.50]}>
                {/* Steel planter box */}
                <mesh position={[0, 0.22, 0]} castShadow>
                  <boxGeometry args={[0.60, 0.44, 0.60]} />
                  <meshStandardMaterial color="#1C1E24" roughness={0.28} metalness={0.70} envMapIntensity={1.5} />
                </mesh>
                {/* Soil top */}
                <mesh position={[0, 0.455, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[0.58, 0.58]} />
                  <meshStandardMaterial color="#2A1A0E" roughness={0.98} />
                </mesh>
                {/* Clipped box topiary sphere */}
                <mesh position={[0, 0.75, 0]} castShadow>
                  <sphereGeometry args={[0.28, 12, 9]} />
                  <meshStandardMaterial color="#2E6830" roughness={0.92} />
                </mesh>
              </group>
            ))}

            {/* ── 入口两侧毛竹列（ornamental bamboo columns，点缀于台阶外侧）──
                 各 3 根细竹竿 + 顶部叶簇球，增加东亚现代建筑氛围 */}
            {([-stepW / 2 - 2.4, stepW / 2 + 2.4] as number[]).map((bx, bi) => (
              <group key={`bamboo-${bi}`} position={[bx, 0, southFaceZ2 - 0.80]}>
                {/* 3 竹竿，错开 ~0.16m */}
                {([[-0.08, 4.50], [0, 5.20], [0.10, 4.85]] as [number,number][]).map(([ox, bH], ci) => (
                  <group key={ci} position={[ox, 0, 0]}>
                    {/* Bamboo culm — tapered cylinder */}
                    <mesh castShadow>
                      <cylinderGeometry args={[0.026, 0.038, bH, 6]} />
                      <meshStandardMaterial color="#7A9040" roughness={0.80} metalness={0.02} />
                    </mesh>
                    {/* Node rings (every ~0.40m) */}
                    {Array.from({ length: Math.floor(bH / 0.42) }, (_, ni) => (
                      <mesh key={ni} position={[0, -bH / 2 + (ni + 1) * 0.42, 0]}>
                        <cylinderGeometry args={[0.030, 0.030, 0.022, 6]} />
                        <meshStandardMaterial color="#5E7030" roughness={0.88} />
                      </mesh>
                    ))}
                    {/* Leaf cluster at top */}
                    <mesh position={[ox * 0.8, bH / 2 + 0.28, 0]} castShadow>
                      <sphereGeometry args={[0.35, 8, 6]} />
                      <meshStandardMaterial color="#3A6820" roughness={0.96} />
                    </mesh>
                  </group>
                ))}
              </group>
            ))}

            {/* ── 台阶侧翼叠水槽（stepped cascade channels）——
                 台阶左右各一条石砌叠水槽，水流从建筑基础沿台阶逐级跌落到广场 ── */}
            {(() => {
              const isNightCasc  = sunHour < 6 || sunHour > 20;
              const isDuskCasc   = !isNightCasc && (sunHour < 8 || sunHour > 18);
              const cascW        = 0.30;  // runnel interior width
              const wallT        = 0.06;  // stone wall thickness
              const wallH        = 0.10;  // stone side-wall height above step tread
              const cascOffX     = stepW / 2 + wallT + cascW / 2;  // offset from step edge
              const waterGlowI   = isNightCasc ? 1.6 : isDuskCasc ? 0.7 : 0.05;
              const underLightI  = isNightCasc ? 2.8 : isDuskCasc ? 1.2 : 0.0;

              return (
                <group>
                  {([-cascOffX, cascOffX] as number[]).map((cx, ci) => (
                    <group key={`casc-${ci}`}>
                      {/* Per-step cascade segments */}
                      {Array.from({ length: nSteps }, (_, si) => {
                        const stepTopY  = (si + 1) * stepRise;  // top face of this step
                        const stepBotY  = si * stepRise;        // bottom of this step
                        const stepFaceZ = southFaceZ2 - si * stepRun;  // front face of step
                        const treadZ    = stepFaceZ - stepRun / 2;
                        const slabY     = stepBotY + 0.008;     // channel floor just above step tread

                        return (
                          <group key={si}>
                            {/* Stone channel floor (same granite as steps) */}
                            <mesh position={[cx, slabY, treadZ]} receiveShadow>
                              <boxGeometry args={[cascW, 0.018, stepRun]} />
                              <meshStandardMaterial color="#C8C4BC" roughness={0.55} metalness={0.04} />
                            </mesh>
                            {/* Inner side wall (toward steps) */}
                            <mesh position={[cx + (ci === 0 ? cascW / 2 : -cascW / 2), slabY + wallH / 2, treadZ]}>
                              <boxGeometry args={[wallT, wallH, stepRun + wallT]} />
                              <meshStandardMaterial color="#B8B4AC" roughness={0.65} metalness={0.03} />
                            </mesh>
                            {/* Outer side wall */}
                            <mesh position={[cx - (ci === 0 ? cascW / 2 : -cascW / 2), slabY + wallH / 2, treadZ]}>
                              <boxGeometry args={[wallT, wallH, stepRun + wallT]} />
                              <meshStandardMaterial color="#B8B4AC" roughness={0.65} metalness={0.03} />
                            </mesh>
                            {/* Water surface — reflective cyan-blue */}
                            <mesh position={[cx, slabY + 0.022, treadZ]} rotation={[-Math.PI / 2, 0, 0]}>
                              <planeGeometry args={[cascW - 0.04, stepRun - 0.02]} />
                              <meshStandardMaterial
                                color="#7AC8DC"
                                transparent opacity={0.84}
                                roughness={0.02} metalness={0.06}
                                envMapIntensity={5.0}
                                emissive="#28A8C4" emissiveIntensity={waterGlowI}
                                side={THREE.DoubleSide}
                              />
                            </mesh>
                            {/* Waterfall curtain at leading edge (thin angled strip) */}
                            {si > 0 && (
                              <mesh
                                position={[cx, stepBotY + stepRise * 0.5, stepFaceZ + 0.008]}
                                rotation={[Math.PI * 0.08, 0, 0]}
                              >
                                <planeGeometry args={[cascW - 0.06, stepRise * 0.88]} />
                                <meshStandardMaterial
                                  color="#A8DDF0"
                                  transparent opacity={0.52}
                                  roughness={0.04}
                                  emissive="#50C0E0" emissiveIntensity={waterGlowI * 0.7}
                                  side={THREE.DoubleSide}
                                />
                              </mesh>
                            )}
                            {/* Submerged LED strip — underwater night glow */}
                            {underLightI > 0 && (
                              <pointLight
                                position={[cx, slabY + 0.01, treadZ]}
                                intensity={underLightI * 0.6}
                                distance={0.9}
                                decay={2}
                                color="#30C0E8"
                              />
                            )}
                          </group>
                        );
                      })}

                      {/* Splash pool at base — small basin where water collects */}
                      {(() => {
                        const poolFloorY  = -0.004;
                        const poolZ       = southFaceZ2 - nSteps * stepRun - 0.12;
                        const poolD       = 0.30;
                        return (
                          <group>
                            {/* Basin floor */}
                            <mesh position={[cx, poolFloorY, poolZ]} receiveShadow>
                              <boxGeometry args={[cascW + wallT * 2, 0.022, poolD]} />
                              <meshStandardMaterial color="#B0ACA4" roughness={0.60} metalness={0.04} />
                            </mesh>
                            {/* Basin front lip */}
                            <mesh position={[cx, poolFloorY + 0.038, poolZ - poolD / 2 - 0.030]}>
                              <boxGeometry args={[cascW + wallT * 2 + 0.04, 0.060, 0.055]} />
                              <meshStandardMaterial color="#C4C0B8" roughness={0.55} metalness={0.03} />
                            </mesh>
                            {/* Water surface in basin */}
                            <mesh position={[cx, poolFloorY + 0.028, poolZ]} rotation={[-Math.PI / 2, 0, 0]}>
                              <planeGeometry args={[cascW - 0.02, poolD - 0.04]} />
                              <meshStandardMaterial
                                color="#60C0D8"
                                transparent opacity={0.78}
                                roughness={0.01} metalness={0.08}
                                envMapIntensity={6.0}
                                emissive="#20A8CC" emissiveIntensity={waterGlowI * 0.9}
                                side={THREE.DoubleSide}
                              />
                            </mesh>
                            {underLightI > 0 && (
                              <pointLight
                                position={[cx, poolFloorY + 0.04, poolZ]}
                                intensity={underLightI}
                                distance={1.2}
                                decay={2}
                                color="#28B8E0"
                              />
                            )}
                          </group>
                        );
                      })()}
                    </group>
                  ))}
                </group>
              );
            })()}

            {/* ── 门牌号码（house number plate）—— 东侧基座上，不锈钢底板 + LED 背光 ── */}
            {(() => {
              const plateX = stepW / 2 + 0.38;  // east of steps
              const plateZ = southFaceZ2 - 0.05;
              const plateY = 1.20;
              return (
                <group position={[plateX, plateY, plateZ]}>
                  {/* Stainless backing plate */}
                  <mesh>
                    <boxGeometry args={[0.18, 0.28, 0.018]} />
                    <meshStandardMaterial color="#8A9BA8" roughness={0.20} metalness={0.88} envMapIntensity={2.0} />
                  </mesh>
                  {/* Frosted acrylic face — backlit warm white */}
                  <mesh position={[0, 0, 0.016]}>
                    <boxGeometry args={[0.14, 0.24, 0.008]} />
                    <meshStandardMaterial
                      color="#F8F4EC"
                      emissive="#FFF0D0"
                      emissiveIntensity={interiorGlowWall > 1.0 ? 1.4 : 0.4}
                      roughness={0.60}
                      transparent opacity={0.95}
                    />
                  </mesh>
                  {/* Subtle point light from plate (night) */}
                  {interiorGlowWall > 1.0 && (
                    <pointLight position={[0, 0, 0.10]} intensity={0.8} distance={1.2} decay={2} color="#FFF4E0" />
                  )}
                </group>
              );
            })()}
          </group>
        );
      })()}

      {/* ── 入口大型装饰花盆（entry plaza ornamental urns）——
               台阶顶端两侧各一只黑花岗岩大盆，搭配修剪球形灌木 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const southFaceZ6 = -D / 2 - 0.20;
        const stepW6 = Math.min(W * 0.50, 5.5);
        const urnX   = stepW6 / 2 + 0.55;
        const urnZ   = southFaceZ6 + 0.05;   // level with building face
        const urnY   = 3 * 0.14;              // top of 3 steps
        return (
          <group>
            {([-urnX, urnX] as number[]).map((ux, ui) => (
              <group key={ui} position={[ux, urnY, urnZ]}>
                {/* Pedestal base */}
                <mesh position={[0, 0.06, 0]} castShadow>
                  <boxGeometry args={[0.36, 0.12, 0.36]} />
                  <meshStandardMaterial color="#1A1C22" roughness={0.42} metalness={0.28} envMapIntensity={1.4} />
                </mesh>
                {/* Urn body — tapered cylinder */}
                <mesh position={[0, 0.40, 0]} castShadow>
                  <cylinderGeometry args={[0.22, 0.14, 0.56, 10]} />
                  <meshStandardMaterial color="#222428" roughness={0.40} metalness={0.30} envMapIntensity={1.2} />
                </mesh>
                {/* Rim flange */}
                <mesh position={[0, 0.70, 0]}>
                  <cylinderGeometry args={[0.25, 0.22, 0.040, 10]} />
                  <meshStandardMaterial color="#1A1C22" roughness={0.38} metalness={0.32} />
                </mesh>
                {/* Soil */}
                <mesh position={[0, 0.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[0.22, 10]} />
                  <meshStandardMaterial color="#2A1A0E" roughness={0.98} />
                </mesh>
                {/* Main shrub globe */}
                <mesh position={[0, 1.04, 0]} castShadow>
                  <sphereGeometry args={[0.26, 10, 8]} />
                  <meshStandardMaterial color="#2A5C1E" roughness={0.96} metalness={0.01} />
                </mesh>
                {/* Small accent cluster */}
                <mesh position={[ui === 0 ? 0.14 : -0.14, 0.94, 0.08]} castShadow>
                  <sphereGeometry args={[0.16, 8, 6]} />
                  <meshStandardMaterial color="#1E4A14" roughness={0.97} />
                </mesh>
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 车道边缘低矮灯柱（driveway side bollards）——
               从大门向建筑入口沿车道两侧布置，每侧 4 盏，时间感知 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndS7   = -D / 2 - 14.50;
        const gateW7  = Math.min(W * 0.30, 3.8);
        const driveZ1 = bndS7 + 0.5;             // near gate
        const driveZ2 = -D / 2 - 3.0;            // near building steps
        const bollardCount = 4;
        const bollardH7 = 0.60;
        const bxOffset  = gateW7 + 0.45;         // lateral offset from centre line
        const isNight7  = sunHour < 6 || sunHour > 20;
        const isDusk7   = !isNight7 && (sunHour < 8 || sunHour > 18);
        const bEmi7 = isNight7 ? 3.0 : isDusk7 ? 1.8 : 0.2;
        const bLI7  = isNight7 ? 2.5 : isDusk7 ? 1.2 : 0.0;
        return (
          <group>
            {Array.from({ length: bollardCount }, (_, bi) => {
              const bz = driveZ1 + bi * (driveZ2 - driveZ1) / (bollardCount - 1);
              return ([-bxOffset, bxOffset] as number[]).map((bx, side) => (
                <group key={`drv-${bi}-${side}`} position={[bx, 0, bz]}>
                  {/* Bollard post */}
                  <mesh position={[0, bollardH7 / 2, 0]} castShadow>
                    <cylinderGeometry args={[0.030, 0.034, bollardH7, 8]} />
                    <meshStandardMaterial color="#3A3E48" roughness={0.30} metalness={0.78} envMapIntensity={1.4} />
                  </mesh>
                  {/* Bollard cap + diffuser */}
                  <mesh position={[0, bollardH7 + 0.038, 0]}>
                    <cylinderGeometry args={[0.058, 0.048, 0.076, 8]} />
                    <meshStandardMaterial color="#D8E2EA" emissive="#FFF4D8" emissiveIntensity={bEmi7} roughness={0.48} />
                  </mesh>
                  {bLI7 > 0 && (
                    <pointLight position={[0, bollardH7 + 0.05, 0]} intensity={bLI7} distance={2.2} decay={2.2} color="#FFF2E0" />
                  )}
                </group>
              ));
            })}
          </group>
        );
      })()}

      {/* ── 外墙壁灯（南立面）—— 每层 2 盏，对称布置，随时间调光 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const isNight2 = sunHour < 6 || sunHour > 20;
        const isDusk2  = !isNight2 && (sunHour < 8 || sunHour > 18);
        // Emissive and point light intensity scaled by time of day
        const sconceEmi  = isNight2 ? 3.8 : isDusk2 ? 2.0 : 0.6;
        const lightInt   = isNight2 ? 4.0 : isDusk2 ? 2.0 : 0.0;
        const lightDist  = 5.0;
        const wallZ = -D / 2 - 0.18;
        return Array.from({ length: usedFloors }, (_, fi) => {
          const wallY  = fi * (FLOOR_H + SLAB_T) + 2.2;
          return [-W * 0.28, W * 0.28].map((lx, li) => (
            <group key={`sconce-${fi}-${li}`} position={[lx, wallY, wallZ]}>
              {/* 壁灯托架（细矩形）*/}
              <mesh>
                <boxGeometry args={[0.06, 0.06, 0.14]} />
                <meshStandardMaterial color="#282830" roughness={0.30} metalness={0.88} />
              </mesh>
              {/* 灯头（发光方盒）*/}
              <mesh position={[0, 0, -0.10]}>
                <boxGeometry args={[0.10, 0.10, 0.08]} />
                <meshStandardMaterial color="#E8E0C0" emissive="#FFE4A0" emissiveIntensity={sconceEmi} roughness={0.40} />
              </mesh>
              {/* 点光源（夜间/黄昏才开启）*/}
              {lightInt > 0 && (
                <pointLight position={[0, -0.05, -0.22]} intensity={lightInt} distance={lightDist} decay={2} color="#FFF0D0" />
              )}
            </group>
          ));
        });
      })()}

      {/* ── 4a-extra. 全幅铝合金水平腰线（每层交接处）—— 统一立面语言 ──
               Modern curtain-wall buildings use continuous horizontal
               aluminum spandrel bands at each floor plate. This strip
               runs full width across east + south + west faces. */}
      {!insideBuilding && isGlassVilla && (() => {
        const bandH  = 0.060;   // band height
        const bandT  = 0.055;   // band protrusion from wall face
        const bandColor = "#28303C";
        // Positions: at each inter-floor level (top of each floor)
        return Array.from({ length: usedFloors - 1 }, (_, fi) => {
          const bandY = (fi + 1) * (FLOOR_H + SLAB_T) - SLAB_T / 2;
          return (
            <group key={`band-${fi}`}>
              {/* South face band */}
              <mesh position={[0, bandY, -D / 2 - bandT / 2 - 0.002]}>
                <boxGeometry args={[W + 0.004, bandH, bandT]} />
                <meshStandardMaterial color={bandColor} roughness={0.20} metalness={0.90} envMapIntensity={2.0} />
              </mesh>
              {/* East face band */}
              <mesh position={[W / 2 + bandT / 2 + 0.002, bandY, 0]}>
                <boxGeometry args={[bandT, bandH, D + 0.004]} />
                <meshStandardMaterial color={bandColor} roughness={0.20} metalness={0.90} envMapIntensity={2.0} />
              </mesh>
              {/* West face band */}
              <mesh position={[-W / 2 - bandT / 2 - 0.002, bandY, 0]}>
                <boxGeometry args={[bandT, bandH, D + 0.004]} />
                <meshStandardMaterial color={bandColor} roughness={0.20} metalness={0.90} envMapIntensity={2.0} />
              </mesh>
              {/* North face band */}
              <mesh position={[0, bandY, D / 2 + bandT / 2 + 0.002]}>
                <boxGeometry args={[W + 0.004, bandH, bandT]} />
                <meshStandardMaterial color={bandColor} roughness={0.20} metalness={0.90} envMapIntensity={2.0} />
              </mesh>
            </group>
          );
        });
      })()}

      {/* ── 南/东/西立面水平遮阳铝合金百叶翼（brise-soleil fins）──
           Horizontal aluminum sun-shading blades projecting from the south,
           east and west facades. Each floor has a set of 5 fins distributed
           across the window zone. Fins are angled 18° upward to admit diffuse
           sky light while blocking direct overhead summer sun.
           Material: brushed anodised aluminium with low roughness + high metal. */}
      {!insideBuilding && isGlassVilla && (() => {
        const finW    = W + 0.06;    // full width of south face fins
        const finD    = 0.50;        // projection depth from face (shadow reach)
        const finT    = 0.020;       // blade thickness
        const finAngle = -Math.PI * 0.05;   // 9° tilt upward
        const finsPerFloor = 4;
        const southFaceZF = -D / 2 - 0.18;
        const eastFaceXF  =  W / 2 + 0.18;
        const westFaceXF  = -W / 2 - 0.18;

        return (
          <group>
            {Array.from({ length: usedFloors }, (_, fi) => {
              const floorBaseY = fi * (FLOOR_H + SLAB_T);
              // Skip ground floor (fi=0) — canopy already covers south; fins start from floor 1
              if (fi === 0) return null;
              const windowZoneH = FLOOR_H * 0.80;
              const finSpacing  = windowZoneH / (finsPerFloor + 1);

              return (
                <group key={`fins-fl-${fi}`}>
                  {Array.from({ length: finsPerFloor }, (_, ni) => {
                    const finY = floorBaseY + SLAB_T * 0.5 + (ni + 1) * finSpacing;
                    return (
                      <group key={ni}>
                        {/* South facade fin */}
                        <mesh
                          position={[0, finY, southFaceZF - finD / 2]}
                          rotation={[finAngle, 0, 0]}
                          castShadow
                        >
                          <boxGeometry args={[finW, finT, finD]} />
                          <meshStandardMaterial
                            color="#B8C0CA"
                            roughness={0.12} metalness={0.88}
                            envMapIntensity={3.0}
                          />
                        </mesh>
                        {/* East facade fin */}
                        <mesh
                          position={[eastFaceXF + finD / 2, finY, 0]}
                          rotation={[finAngle, Math.PI / 2, 0]}
                          castShadow
                        >
                          <boxGeometry args={[D + 0.06, finT, finD]} />
                          <meshStandardMaterial
                            color="#B8C0CA"
                            roughness={0.12} metalness={0.88}
                            envMapIntensity={3.0}
                          />
                        </mesh>
                        {/* West facade fin */}
                        <mesh
                          position={[westFaceXF - finD / 2, finY, 0]}
                          rotation={[finAngle, -Math.PI / 2, 0]}
                          castShadow
                        >
                          <boxGeometry args={[D + 0.06, finT, finD]} />
                          <meshStandardMaterial
                            color="#B8C0CA"
                            roughness={0.12} metalness={0.88}
                            envMapIntensity={3.0}
                          />
                        </mesh>
                      </group>
                    );
                  })}
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 外立面转角柱（4 角）— 黑色阳极氧化铝方柱，给建筑立面明确边界，
              现代玻璃幕墙建筑标配转角细节 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const colW   = 0.22;   // column cross-section (wider for visual weight matching reference)
        const colH   = totalH + SLAB_T + 0.06; // full building height + small overshoot
        const colY   = colH / 2;
        const colMat = { color: "#181A1E" as const, roughness: 0.10 as const, metalness: 0.95 as const, envMapIntensity: 2.6 as const };
        const camH   = totalH - 0.10;   // CCTV camera mount height (near top of building)
        return (
          <>
            {([[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]] as [number,number][]).map(([cx2, cz2], ci) => {
              // Camera orientation: always points inward (toward building centre)
              const camFaceX = cx2 > 0 ? -1 : 1;
              const camFaceZ = cz2 > 0 ? -1 : 1;
              const camAngleY = Math.atan2(camFaceX, camFaceZ);
              return (
                <group key={ci}>
                  {/* Corner column */}
                  <mesh position={[cx2, colY, cz2]} castShadow>
                    <boxGeometry args={[colW, colH, colW]} />
                    <meshStandardMaterial {...colMat} />
                  </mesh>
                  {/* CCTV camera bracket + dome — mounts on corner column face */}
                  <group position={[cx2 + camFaceX * (colW / 2 + 0.04), camH, cz2 + camFaceZ * (colW / 2 + 0.04)]}
                    rotation={[0, camAngleY, 0]}>
                    {/* Wall bracket */}
                    <mesh position={[0, 0, 0]}>
                      <boxGeometry args={[0.030, 0.030, 0.080]} />
                      <meshStandardMaterial color="#2A2C34" roughness={0.38} metalness={0.72} />
                    </mesh>
                    {/* Camera body */}
                    <mesh position={[0, -0.028, 0.065]}>
                      <boxGeometry args={[0.048, 0.036, 0.072]} />
                      <meshStandardMaterial color="#1C1E24" roughness={0.32} metalness={0.68} />
                    </mesh>
                    {/* Lens ring */}
                    <mesh position={[0, -0.028, 0.098]} rotation={[Math.PI / 2, 0, 0]}>
                      <cylinderGeometry args={[0.013, 0.013, 0.020, 8]} />
                      <meshStandardMaterial color="#0A0A10" roughness={0.10} metalness={0.20} />
                    </mesh>
                    {/* IR LED ring (tiny red emissive ring) */}
                    <mesh position={[0, -0.028, 0.090]} rotation={[Math.PI / 2, 0, 0]}>
                      <torusGeometry args={[0.016, 0.004, 6, 8]} />
                      <meshStandardMaterial color="#FF2020" emissive="#FF1010" emissiveIntensity={0.9} roughness={0.6} />
                    </mesh>
                  </group>
                </group>
              );
            })}
          </>
        );
      })()}

      {/* ── 1. 每层背景填充板（消除房间间微小缝隙，视觉统一） ──
              当本层有任何 "glass" 房间时跳过：这块大背景板会从内部挡住
              玻璃幕墙后面的视线。房间盒子各自覆盖自己的足迹，房间间
              的小缝隙可以忽略。 */}
      {Array.from({ length: usedFloors }, (_, fi) => {
        const fp = floorPlans[fi];
        if (!fp) return null;
        const hasGlassRoom = (fp.enabledRooms ?? [])
          .some(r => glassRooms.has(`${fi}:${r}`));
        if (hasGlassRoom) return null;
        // 计算本层实际包围盒
        let lMinX = Infinity, lMinY = Infinity, lMaxX = -Infinity, lMaxY = -Infinity;
        for (const r of (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor)) {
          const p = fp.roomLayout?.[r]; const d = fp.roomDimensions?.[r];
          if (!p || !d) continue;
          lMinX = Math.min(lMinX, p.x); lMinY = Math.min(lMinY, p.y);
          lMaxX = Math.max(lMaxX, p.x + d.width); lMaxY = Math.max(lMaxY, p.y + d.depth);
        }
        if (!isFinite(lMinX)) return null;
        const lW = (lMaxX - lMinX) * CM;
        const lD = (lMaxY - lMinY) * CM;
        const lcx = (lMinX + lMaxX) / 2;
        const lcy = (lMinY + lMaxY) / 2;
        const wcx = (lcx - planOffset.minX) * CM - W / 2;
        const wcz = -((lcy - planOffset.minY) * CM) + D / 2;
        const yBase = fi * (FLOOR_H + SLAB_T);
        if (insideBuilding) return null; // hidden inside — visible=false still intercepts raycasting
        return (
          <mesh key={`bg-${fi}`} position={[wcx, yBase + FLOOR_H / 2, wcz]} receiveShadow>
            <boxGeometry args={[lW + 0.02, FLOOR_H + 0.01, lD + 0.02]} />
            <meshStandardMaterial color={wallColor} roughness={0.82} metalness={0.01} />
          </mesh>
        );
      })}

      {/* ── 2. 实心房间盒子（和全局3D完全对应，覆盖在背景板上形成凹凸轮廓） ──
              玻璃幕墙的房间：只画楼板和天花板，省掉 4 面墙 —— 否则盒子的
              不透明外墙面挡住了玻璃幕墙后面的视线（用户："是被内墙挡住了
              吗"）。相邻房间的盒子会替本房间盖住共享的内墙面。 */}
      {Array.from({ length: usedFloors }, (_, fi) => {
        const fp = floorPlans[fi];
        if (!fp) return null;
        const yBase = fi * (FLOOR_H + SLAB_T);
        if (insideBuilding) return null; // hide when inside — avoids blocking raycasting
        return (fp.enabledRooms ?? [])
          .filter(r => !ROOM_DEFS[r]?.isOutdoor)
          .map(room => {
            const p = fp.roomLayout?.[room]; const d = fp.roomDimensions?.[room];
            if (!p || !d) return null;
            const rW = d.width * CM;
            const rD = d.depth * CM;
            const cx = (p.x + d.width / 2 - planOffset.minX) * CM - W / 2;
            const cz = -((p.y + d.depth / 2 - planOffset.minY) * CM) + D / 2;
            // Glass-curtain room: drop the opaque box and stage a "warm
            // emissive interior" exactly like the template's RichGlassInterior.
            // Key trick: walls/ceiling SELF-EMIT (emissive map) so the
            // room reads as lit-from-within through the glass — visual
            // depth comes from emissive surfaces, NOT from glass opacity
            // or external point lights.
            // We use the precomputed glassRooms set (built from facadeBlocks)
            // so auto-detected glass walls also get the emissive interior,
            // not only the explicit "glass" UI override.
            if (glassRooms.has(`${fi}:${room}`)) {
              // 玻璃幕墙房间室内：5 块独立发光平面（4 墙 + 天花板）+ 地板。
              // 之前用 BackSide 盒子，但盒子的侧墙在斜角下会产生奇怪的
              // "立柱状"剪影（用户："2F 有几个深色立柱状物体"）。
              // 拆成 5 块独立 plane，每块法线朝向房间内部（FrontSide 默
              // 认即可），从玻璃外看到的就是连续的发光奶油墙面。
              const wallC     = "#EDE6D8";
              const ceilC     = "#F3EEE4";
              const mats      = fp.rooms?.[room]?.materials;
              const floorC    = mats?.floor?.color ?? ROOM_DEFS[room]?.defaultFloorColor ?? "#6B4C2A";
              const emissiveW = "#F4DDB0";
              const inset   = 0.08;
              const iW = rW - inset * 2;
              const iD = rD - inset * 2;
              const wallH = FLOOR_H - 0.04;
              const cy = yBase + FLOOR_H / 2;
              const isLarge = iW * iD > 12;

              const wallMat = (
                <meshStandardMaterial
                  color={wallC}
                  roughness={0.78}
                  metalness={0.02}
                  emissive={emissiveW}
                  emissiveIntensity={interiorGlowWall}
                  side={THREE.FrontSide}
                />
              );

              return (
                <group key={`gbox-${fi}-${room}`} position={[cx, cy, cz]}>
                  {/* 后墙（+Z 方向，朝 -Z 即朝室内）*/}
                  <mesh position={[0, 0,  iD / 2 - 0.005]} rotation={[0, Math.PI, 0]}>
                    <planeGeometry args={[iW, wallH]} />
                    {wallMat}
                  </mesh>
                  {/* 前墙（-Z 方向，朝 +Z 即朝室内）*/}
                  <mesh position={[0, 0, -iD / 2 + 0.005]}>
                    <planeGeometry args={[iW, wallH]} />
                    {wallMat}
                  </mesh>
                  {/* 左墙（-X 方向，朝 +X 即朝室内）*/}
                  <mesh position={[-iW / 2 + 0.005, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
                    <planeGeometry args={[iD, wallH]} />
                    {wallMat}
                  </mesh>
                  {/* 右墙（+X 方向，朝 -X 即朝室内）*/}
                  <mesh position={[ iW / 2 - 0.005, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
                    <planeGeometry args={[iD, wallH]} />
                    {wallMat}
                  </mesh>

                  {/* 天花板 —— DoubleSide emissive */}
                  <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, FLOOR_H / 2 - 0.05, 0]}>
                    <planeGeometry args={[iW, iD]} />
                    <meshStandardMaterial
                      color={ceilC}
                      emissive="#FFF0A0"
                      emissiveIntensity={interiorGlowCeil}
                      roughness={0.92}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                  {/* 地板 —— 胡桃木 */}
                  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -FLOOR_H / 2 + 0.04, 0]} receiveShadow>
                    <planeGeometry args={[iW, iD]} />
                    <meshStandardMaterial color={floorC} roughness={0.55} />
                  </mesh>

                  {/* 大房间家具剪影（仅在外观模式下渲染，通过玻璃可见）
                      不渲染 GLTF — 只是简单的几何体轮廓，给室内视觉深度
                      放在后墙（+Z）附近，从南面玻璃幕墙外看到 */}
                  {/* Sheer curtain panels — thin semi-transparent planes hanging from
                      ceiling, visible from outside through glass. Added to both large
                      and medium rooms for visual layering behind the glass. */}
                  {!insideBuilding && (
                    <>
                      {/* Left curtain panel (partially drawn) */}
                      <mesh position={[-iW * 0.38, 0, -iD / 2 + 0.028]} renderOrder={8}>
                        <boxGeometry args={[iW * 0.18, FLOOR_H * 0.92, 0.006]} />
                        <meshStandardMaterial
                          color="#F4F0E8"
                          transparent opacity={0.35}
                          depthWrite={false}
                          roughness={0.88}
                          side={THREE.DoubleSide}
                          emissive="#FFF8F0"
                          emissiveIntensity={interiorGlowWall * 0.08}
                        />
                      </mesh>
                      {/* Right curtain panel (partially drawn) */}
                      <mesh position={[iW * 0.38, 0, -iD / 2 + 0.028]} renderOrder={8}>
                        <boxGeometry args={[iW * 0.18, FLOOR_H * 0.92, 0.006]} />
                        <meshStandardMaterial
                          color="#F4F0E8"
                          transparent opacity={0.35}
                          depthWrite={false}
                          roughness={0.88}
                          side={THREE.DoubleSide}
                          emissive="#FFF8F0"
                          emissiveIntensity={interiorGlowWall * 0.08}
                        />
                      </mesh>
                      {/* Curtain rod — thin dark bar */}
                      <mesh position={[0, FLOOR_H / 2 - 0.06, -iD / 2 + 0.030]}>
                        <boxGeometry args={[iW - 0.04, 0.018, 0.018]} />
                        <meshStandardMaterial color="#282830" roughness={0.28} metalness={0.72} />
                      </mesh>
                    </>
                  )}

                  {isLarge && !insideBuilding && (
                    <>
                      {/* Bookshelf — dark walnut, against back wall */}
                      <mesh position={[iW * 0.35, 0, iD / 2 - 0.22]}>
                        <boxGeometry args={[0.90, FLOOR_H * 0.72, 0.32]} />
                        <meshStandardMaterial color="#3A2418" roughness={0.82} metalness={0.02}
                          emissive="#2A1A0C" emissiveIntensity={interiorGlowWall * 0.08} />
                      </mesh>
                      {/* Sofa — low & wide, towards centre */}
                      <mesh position={[-iW * 0.15, -FLOOR_H / 2 + 0.52, iD * 0.10]}>
                        <boxGeometry args={[Math.min(iW * 0.55, 2.4), 0.40, 0.88]} />
                        <meshStandardMaterial color="#7A6850" roughness={0.90} metalness={0.01} />
                      </mesh>
                      {/* Sofa back cushion */}
                      <mesh position={[-iW * 0.15, -FLOOR_H / 2 + 0.85, iD * 0.10 + 0.32]}>
                        <boxGeometry args={[Math.min(iW * 0.55, 2.4), 0.45, 0.24]} />
                        <meshStandardMaterial color="#6E5E4A" roughness={0.92} metalness={0.01} />
                      </mesh>
                      {/* Low coffee table */}
                      <mesh position={[-iW * 0.15, -FLOOR_H / 2 + 0.40, iD * 0.10 - 0.62]}>
                        <boxGeometry args={[0.80, 0.050, 0.50]} />
                        <meshStandardMaterial color="#B0A080" roughness={0.55} metalness={0.10} envMapIntensity={1.2} />
                      </mesh>
                      {/* Large format artwork — abstract canvas, centred on back wall */}
                      <group position={[-iW * 0.08, 0.20, iD / 2 - 0.038]}>
                        {/* Canvas frame — thin dark wood */}
                        <mesh>
                          <boxGeometry args={[Math.min(iW * 0.42, 1.80), 1.05, 0.022]} />
                          <meshStandardMaterial color="#2A1E14" roughness={0.80} metalness={0.04} />
                        </mesh>
                        {/* Canvas surface — abstract warm-on-dark art */}
                        <mesh position={[0, 0, 0.016]}>
                          <boxGeometry args={[Math.min(iW * 0.42, 1.80) - 0.04, 1.01, 0.006]} />
                          <meshStandardMaterial
                            color="#0E1018"
                            emissive="#C85020"
                            emissiveIntensity={interiorGlowWall * 0.25}
                            roughness={0.95}
                          />
                        </mesh>
                        {/* Art accent stripe (abstract composition) */}
                        <mesh position={[-Math.min(iW * 0.08, 0.34), 0.12, 0.020]}>
                          <boxGeometry args={[Math.min(iW * 0.10, 0.45), 0.70, 0.004]} />
                          <meshStandardMaterial
                            color="#E8A030"
                            emissive="#D88020"
                            emissiveIntensity={interiorGlowWall * 0.18}
                            roughness={0.94}
                          />
                        </mesh>
                      </group>
                      {/* Floor lamp — arc lamp near sofa side */}
                      <group position={[-iW * 0.38, -FLOOR_H / 2, iD * 0.08]}>
                        {/* Stand */}
                        <mesh position={[0, 0.90, 0]}>
                          <cylinderGeometry args={[0.012, 0.016, 1.80, 6]} />
                          <meshStandardMaterial color="#4A4850" roughness={0.28} metalness={0.78} />
                        </mesh>
                        {/* Shade */}
                        <mesh position={[0.36, 1.75, 0]}>
                          <cylinderGeometry args={[0.18, 0.10, 0.28, 8]} />
                          <meshStandardMaterial
                            color="#F8F0E0"
                            emissive="#FFE8A0"
                            emissiveIntensity={interiorGlowWall > 0.6 ? interiorGlowWall * 1.2 : 0.2}
                            roughness={0.85}
                            side={THREE.DoubleSide}
                          />
                        </mesh>
                      </group>
                      {/* TV wall / media unit — opposite to artwork wall
                          Full-width low dark console + large dark TV panel + LED backlight */}
                      <group position={[iW * 0.18, -FLOOR_H / 2 + 0.10, -iD / 2 + 0.10]}>
                        {/* Media console — dark walnut, low-profile */}
                        <mesh position={[0, 0.22, 0]} castShadow>
                          <boxGeometry args={[Math.min(iW * 0.55, 2.40), 0.44, 0.45]} />
                          <meshStandardMaterial color="#201A14" roughness={0.55} metalness={0.08} />
                        </mesh>
                        {/* TV panel — ultra-thin dark screen */}
                        <mesh position={[0, 0.44 + 0.48, 0.05]}>
                          <boxGeometry args={[Math.min(iW * 0.50, 2.20), 0.96, 0.022]} />
                          <meshStandardMaterial
                            color="#0A0A0C"
                            roughness={0.04}
                            metalness={0.30}
                            envMapIntensity={1.5}
                            emissive="#1A2040"
                            emissiveIntensity={interiorGlowWall > 0.5 ? interiorGlowWall * 0.35 : 0.05}
                          />
                        </mesh>
                        {/* TV LED backlight — blue-ish glow behind panel */}
                        <mesh position={[0, 0.44 + 0.48, -0.014]}>
                          <boxGeometry args={[Math.min(iW * 0.50, 2.20) + 0.06, 0.96 + 0.06, 0.006]} />
                          <meshStandardMaterial
                            color="#3060A0"
                            emissive="#2050C0"
                            emissiveIntensity={interiorGlowWall > 0.5 ? interiorGlowWall * 0.55 : 0.0}
                            roughness={0.80}
                          />
                        </mesh>
                      </group>
                      {/* Decorative side table next to sofa */}
                      <group position={[iW * 0.22, -FLOOR_H / 2, iD * 0.10]}>
                        {/* Side table */}
                        <mesh position={[0, 0.48, 0]}>
                          <cylinderGeometry args={[0.22, 0.22, 0.022, 10]} />
                          <meshStandardMaterial color="#806040" roughness={0.50} metalness={0.12} />
                        </mesh>
                        <mesh position={[0, 0.24, 0]}>
                          <cylinderGeometry args={[0.020, 0.020, 0.46, 6]} />
                          <meshStandardMaterial color="#5A3820" roughness={0.70} metalness={0.04} />
                        </mesh>
                        {/* Table lamp */}
                        <mesh position={[0, 0.68, 0]}>
                          <cylinderGeometry args={[0.12, 0.08, 0.24, 8]} />
                          <meshStandardMaterial
                            color="#F0E8D8"
                            emissive="#FFE8A0"
                            emissiveIntensity={interiorGlowWall > 0.5 ? interiorGlowWall * 1.0 : 0.12}
                            roughness={0.85}
                            side={THREE.DoubleSide}
                          />
                        </mesh>
                      </group>
                    </>
                  )}

                  {/* 吊灯（仅 ≥12㎡ 的房间）— emissive 随时间动态增强 */}
                  {isLarge && (
                    <>
                      <pointLight
                        position={[0, FLOOR_H / 2 - 0.50, 0]}
                        intensity={interiorGlowWall > 1.20 ? 5.5 : 3.5}
                        distance={Math.max(iW, iD) * 2.5}
                        decay={1.8}
                        color="#FFF4D8"
                      />
                      {/* Pendant cord */}
                      <mesh position={[0, FLOOR_H / 2 - 0.40, 0]}>
                        <cylinderGeometry args={[0.006, 0.006, 0.32, 6]} />
                        <meshStandardMaterial color="#1A1A1A" roughness={0.6} />
                      </mesh>
                      {/* Pendant globe */}
                      <mesh position={[0, FLOOR_H / 2 - 0.62, 0]}>
                        <sphereGeometry args={[0.14, 16, 10]} />
                        <meshStandardMaterial
                          color="#FFE0A0"
                          emissive="#FFC060"
                          emissiveIntensity={interiorGlowWall > 1.20 ? 3.5 : 2.4}
                          roughness={0.35}
                        />
                      </mesh>
                      {/* Second smaller pendant offset for large rooms */}
                      {Math.max(iW, iD) > 5 && (
                        <>
                          <pointLight
                            position={[iW * 0.30, FLOOR_H / 2 - 0.50, iD * 0.25]}
                            intensity={interiorGlowWall > 1.20 ? 3.5 : 2.2}
                            distance={Math.max(iW, iD) * 1.8}
                            decay={2.0}
                            color="#FFF4D8"
                          />
                          <mesh position={[iW * 0.30, FLOOR_H / 2 - 0.56, iD * 0.25]}>
                            <sphereGeometry args={[0.10, 12, 8]} />
                            <meshStandardMaterial
                              color="#FFE0A0"
                              emissive="#FFB840"
                              emissiveIntensity={interiorGlowWall > 1.20 ? 3.0 : 1.8}
                              roughness={0.38}
                            />
                          </mesh>
                        </>
                      )}
                    </>
                  )}

                  {/* ── 餐厅桌椅（中等以上房间可见，reference 图参考）──
                      Rectangular dining table + 3 chairs visible through south glass.
                      Positioned toward back of room so not to block the glass view,
                      yet still clearly visible as architectural interior depth. */}
                  {!insideBuilding && iW > 2.5 && iD > 2.5 && !isLarge && (
                    <group position={[0, -FLOOR_H / 2, iD * 0.15]}>
                      {/* Dining table — dark walnut rectangular slab */}
                      <mesh position={[0, 0.75, 0]} castShadow>
                        <boxGeometry args={[Math.min(iW * 0.62, 2.20), 0.040, Math.min(iD * 0.42, 1.05)]} />
                        <meshStandardMaterial color="#3A2418" roughness={0.58} metalness={0.08} envMapIntensity={1.0}
                          emissive="#2A1A0C" emissiveIntensity={interiorGlowWall * 0.06} />
                      </mesh>
                      {/* Table base/pedestal */}
                      <mesh position={[0, 0.375, 0]}>
                        <boxGeometry args={[0.08, 0.75, 0.08]} />
                        <meshStandardMaterial color="#2A1A0C" roughness={0.65} metalness={0.10} />
                      </mesh>
                      {/* Chairs — 3 visible from south (front) */}
                      {([-0.75, 0, 0.75] as number[]).map((cx3, ci) => (
                        <group key={ci} position={[cx3, 0, -Math.min(iD * 0.32, 0.90)]}>
                          <mesh position={[0, 0.47, 0]}>
                            <boxGeometry args={[0.44, 0.040, 0.44]} />
                            <meshStandardMaterial color="#EDE6D8" roughness={0.88} />
                          </mesh>
                          <mesh position={[0, 0.76, 0.20]}>
                            <boxGeometry args={[0.40, 0.40, 0.040]} />
                            <meshStandardMaterial color="#EDE6D8" roughness={0.88} />
                          </mesh>
                        </group>
                      ))}
                    </group>
                  )}
                </group>
              );
            }
            // 本层若有任何玻璃房间：跳过 *所有* 不透明房间盒子。
            // 否则相邻小房间（卫生间/衣帽间）的盒子会从玻璃外透出来
            // 当"立柱"。外墙的 ConcreteFacade overlay 已经提供了非玻璃
            // 面的可见表面，interiorRooms.map 的 BackSide 内墙处理了
            // 从室内看，不会因为跳过这个 bulk box 失去任何东西。
            const floorHasGlass = (fp.enabledRooms ?? [])
              .some(r => glassRooms.has(`${fi}:${r}`));
            if (floorHasGlass) return null;
            return (
              <mesh key={`box-${fi}-${room}`} position={[cx, yBase + FLOOR_H / 2, cz]} castShadow receiveShadow>
                <boxGeometry args={[rW, FLOOR_H, rD]} />
                <meshStandardMaterial color={wallColor} roughness={0.82} metalness={0.01} />
              </mesh>
            );
          });
      })}

      {/* ── 3. 层间楼板（室内模式下隐藏）── */}
      {/* 楼梯井贯穿楼板，用4块矩形绕开开口，避免堵住楼梯 */}
      {!insideBuilding && (() => {
        // 楼梯井位置（取 fi=0 的楼梯间，各层水平位置相同）
        const stairEntry = interiorRooms.find(r => r.isStair && r.fi === 0);
        // 层间楼板颜色：略深于外墙，产生分层阴影感（precast concrete）
        const slabColor  = "#DDD8D0";

        return Array.from({ length: usedFloors - 1 }, (_, fi) => {
          const slabY = (fi + 1) * (FLOOR_H + SLAB_T) - SLAB_T / 2;

          // 用上层楼（fi+1）的实际占地范围计算楼板尺寸，支持各层不同面积
          const upperFp = floorPlans[fi + 1];
          let totalW = W + 0.30, totalD = D + 0.30, slabCX = 0, slabCZ = 0;
          if (upperFp) {
            let lMinX = Infinity, lMinY = Infinity, lMaxX = -Infinity, lMaxY = -Infinity;
            for (const r of (upperFp.enabledRooms ?? []).filter(r2 => !ROOM_DEFS[r2]?.isOutdoor)) {
              const p2 = upperFp.roomLayout?.[r]; const d2 = upperFp.roomDimensions?.[r];
              if (!p2 || !d2) continue;
              lMinX = Math.min(lMinX, p2.x); lMinY = Math.min(lMinY, p2.y);
              lMaxX = Math.max(lMaxX, p2.x + d2.width); lMaxY = Math.max(lMaxY, p2.y + d2.depth);
            }
            if (isFinite(lMinX)) {
              totalW = (lMaxX - lMinX) * CM + 0.30;
              totalD = (lMaxY - lMinY) * CM + 0.30;
              slabCX = ((lMinX + lMaxX) / 2 - planOffset.minX) * CM - W / 2;
              slabCZ = -(((lMinY + lMaxY) / 2 - planOffset.minY) * CM) + D / 2;
            }
          }
          // Glass villa: add south cantilever so upper floor dramatically
          // projects over the ground-floor glass facade, as in the reference image.
          // Extend slab 1.50m further south (-Z direction) and narrow the north side.
          if (isGlassVilla) {
            const cantilever = 1.50;      // m of south projection beyond ground floor
            totalD  += cantilever;
            slabCZ  -= cantilever / 2;    // shift slab centre south to keep north edge fixed
          }
          const halfW = totalW / 2;
          const halfD = totalD / 2;

          // Wood soffit helper — horizontal teak battens on slab underside (glass villa only)
          const WoodSoffit = ({ cx, cz, sW, sD, yBot }: { cx: number; cz: number; sW: number; sD: number; yBot: number }) => {
            if (!isGlassVilla) return null;
            const PLANK_W  = 0.275;   // batten width along Z (depth)
            const PLANK_GAP = 0.013;  // gap between battens
            const PLANK_T  = 0.022;   // batten thickness
            const step     = PLANK_W + PLANK_GAP;
            const count    = Math.ceil(sD / step);
            const isNightSft = sunHour < 6 || sunHour > 20;
            const isDuskSft  = !isNightSft && (sunHour < 8 || sunHour > 18);
            const emi = isNightSft ? 0.18 : isDuskSft ? 0.07 : 0.0;
            return (
              <>
                {/* Dark backing channel between battens */}
                <mesh position={[cx, yBot - 0.002, cz]} receiveShadow>
                  <boxGeometry args={[sW - 0.02, 0.005, sD - 0.02]} />
                  <meshStandardMaterial color="#2A1A0C" roughness={0.95} />
                </mesh>
                {Array.from({ length: count }, (_, pi) => {
                  const pz = cz - sD / 2 + PLANK_W / 2 + pi * step;
                  if (pz > cz + sD / 2 + PLANK_W * 0.5) return null;
                  const actualW = Math.min(PLANK_W, (cz + sD / 2) - (pz - PLANK_W / 2));
                  if (actualW < 0.02) return null;
                  // 3-tone walnut/teak variation — matches real timber ceiling boards
                  const tone = pi % 3 === 0 ? "#6B3A1C" : pi % 3 === 1 ? "#7E4E28" : "#8C5E34";
                  return (
                    <mesh key={pi} position={[cx, yBot - PLANK_T / 2, pz - (PLANK_W - actualW) / 2]} receiveShadow>
                      <boxGeometry args={[sW - 0.04, PLANK_T, actualW - 0.004]} />
                      <meshStandardMaterial
                        color={tone} roughness={0.38} metalness={0.05}
                        envMapIntensity={0.85}
                        emissive={tone} emissiveIntensity={emi}
                      />
                    </mesh>
                  );
                })}
              </>
            );
          };

          if (!stairEntry) {
            return (
              <group key={`slab-${fi}`}>
                <mesh position={[slabCX, slabY, slabCZ]} castShadow receiveShadow>
                  <boxGeometry args={[totalW, SLAB_T, totalD]} />
                  <meshStandardMaterial color={slabColor} roughness={0.85} metalness={0.02} />
                </mesh>
                {/* 楼板底面：玻璃别墅→实木格栅吊顶，其他→深色阴影缝 */}
                {isGlassVilla
                  ? <WoodSoffit cx={slabCX} cz={slabCZ} sW={totalW} sD={totalD} yBot={slabY - SLAB_T / 2} />
                  : <mesh position={[slabCX, slabY - SLAB_T / 2 - 0.015, slabCZ]}>
                      <boxGeometry args={[totalW + 0.01, 0.030, totalD + 0.01]} />
                      <meshStandardMaterial color="#8A8680" roughness={0.9} />
                    </mesh>
                }
                {/* 楼板顶面金属压边（metal flashing cap）*/}
                <mesh position={[slabCX, slabY + SLAB_T / 2 + 0.004, slabCZ]}>
                  <boxGeometry args={[totalW + 0.01, 0.008, totalD + 0.01]} />
                  <meshStandardMaterial color="#3A3E48" roughness={0.28} metalness={0.82} envMapIntensity={1.8} />
                </mesh>
              </group>
            );
          }

          const { cx: scx, cz: scz, rW: srW, rD: srD } = stairEntry;
          const fL = slabCX - halfW, fR = slabCX + halfW;
          const fN = slabCZ - halfD, fS = slabCZ + halfD;
          const sL = scx - srW / 2, sR = scx + srW / 2;
          const sN = scz - srD / 2, sSouth = scz + srD / 2;

          type Piece = { key: string; w: number; d: number; x: number; z: number };
          const pieces: Piece[] = [];
          if (sN   - fN > 0.01) pieces.push({ key: "N", w: totalW, d: sN - fN,     x: slabCX,          z: (fN + sN) / 2     });
          if (fS   - sSouth > 0.01) pieces.push({ key: "S", w: totalW, d: fS - sSouth, x: slabCX,       z: (sSouth + fS) / 2  });
          if (sL   - fL > 0.01) pieces.push({ key: "W", w: sL - fL, d: srD,         x: (fL + sL) / 2,  z: scz               });
          if (fR   - sR > 0.01) pieces.push({ key: "E", w: fR - sR, d: srD,         x: (sR + fR) / 2,  z: scz               });

          return (
            <group key={`slab-${fi}`}>
              {pieces.map(p => (
                <mesh key={p.key} position={[p.x, slabY, p.z]} castShadow receiveShadow>
                  <boxGeometry args={[p.w, SLAB_T, p.d]} />
                  <meshStandardMaterial color={slabColor} roughness={0.85} />
                </mesh>
              ))}
              {/* 楼板底面：玻璃别墅→实木格栅吊顶，其他→深色阴影缝 */}
              {isGlassVilla
                ? <WoodSoffit cx={slabCX} cz={slabCZ} sW={totalW} sD={totalD} yBot={slabY - SLAB_T / 2} />
                : <mesh position={[slabCX, slabY - SLAB_T / 2 - 0.015, slabCZ]}>
                    <boxGeometry args={[totalW + 0.01, 0.030, totalD + 0.01]} />
                    <meshStandardMaterial color="#7C7870" roughness={0.90} />
                  </mesh>
              }
              {/* 楼板顶面金属压边（metal flashing cap — modern detail）*/}
              <mesh position={[slabCX, slabY + SLAB_T / 2 + 0.004, slabCZ]}>
                <boxGeometry args={[totalW + 0.01, 0.008, totalD + 0.01]} />
                <meshStandardMaterial color="#3A3E48" roughness={0.28} metalness={0.82} envMapIntensity={1.8} />
              </mesh>
            </group>
          );
        });
      })()}

      {/* ── 4. 外墙 facade overlay（基于合并块，无双框缝）── 室内模式下隐藏外墙 */}
      {!insideBuilding && facadeBlocks.map((block, bi) => {
        const { floorIndex, side, wallCoord, mergedStart, mergedEnd, doorEntries, winEntries } = block;
        const segLen  = (mergedEnd - mergedStart) * CM;
        const yBase   = floorIndex * (FLOOR_H + SLAB_T);
        const yMid    = yBase + FLOOR_H / 2;
        const isSouth = side === "south";
        // X轴翻转：south/east 的旋转使 local+X 方向反转
        const flipX   = side === "south" || side === "east";

        // Facade treatment — per-room override has highest priority, then
        // data-driven auto:
        //  · Any room in this merged block set to "glass"    → glass curtain
        //  · Any room set to "concrete" (and none to glass)  → concrete facade
        //  · Otherwise: auto — windows >55% coverage ⇒ glass, else concrete.
        const styleFP   = floorPlans[floorIndex];
        const blockRoomStyles = block.rooms.map(r => styleFP?.roomExteriorStyle?.[r] ?? "auto");
        const forceGlass    = blockRoomStyles.some(s => s === "glass");
        const forceConcrete = !forceGlass && blockRoomStyles.some(s => s === "concrete");

        const totalWinLen = winEntries.reduce((s, e) => s + e.w.len, 0);
        const winCoverage = segLen > 0 ? (totalWinLen * CM) / segLen : 0;
        const isGlassWall = winCoverage > 0.42 || (isGlassVilla && (isSouth || winCoverage > 0.28));

        let facade: "glass" | "concrete" | "wood";
        if (forceGlass) {
          facade = "glass";
        } else if (forceConcrete) {
          facade = "concrete";
        } else if (isGlassVilla) {
          facade = isGlassWall ? "glass"
                 : side === "west" && floorIndex > 0 ? "wood"
                 : "concrete";
        } else {
          facade = "concrete";
        }

        // ── 位置 & 旋转（使用合并块中心坐标）──
        const midCoord = mergedStart + (mergedEnd - mergedStart) / 2;
        let px: number, pz: number, rot: [number, number, number];
        if (isSouth) {
          [px] = toWorld(midCoord, wallCoord, planOffset);
          [, pz] = toWorld(0, wallCoord, planOffset);
          rot = [0, Math.PI, 0]; pz -= 0.12;
        } else if (side === "north") {
          [px] = toWorld(midCoord, wallCoord, planOffset);
          [, pz] = toWorld(0, wallCoord, planOffset);
          rot = [0, 0, 0]; pz += 0.12;
        } else if (side === "east") {
          [px] = toWorld(wallCoord, 0, planOffset);
          [, pz] = toWorld(0, midCoord, planOffset);
          rot = [0, -Math.PI / 2, 0]; px += 0.12;
        } else {
          [px] = toWorld(wallCoord, 0, planOffset);
          [, pz] = toWorld(0, midCoord, planOffset);
          rot = [0, Math.PI / 2, 0]; px -= 0.12;
        }

        // ── 门坐标换算（基于合并块起点）──
        const doorInfos = doorEntries.map(({ roomWallStart, d }) => {
          const dPos    = d.pos ?? 0;
          const dLen    = d.len;
          const rawX    = (roomWallStart + dPos + dLen / 2 - mergedStart) * CM - segLen / 2;
          const flipped = flipX ? -rawX : rawX;
          const dLenM   = dLen * CM;
          return {
            cx: Math.max(-segLen / 2 + dLenM / 2, Math.min(segLen / 2 - dLenM / 2, flipped)),
            w:  dLenM,
            h:  Math.min((d.h ?? 210) * CM, FLOOR_H - 0.05),
          };
        });

        // ── 窗坐标换算（基于合并块起点）──
        const winInfos = winEntries.map(({ roomWallStart, w }) => {
          const rawX    = (roomWallStart + (w.pos ?? 0) + w.len / 2 - mergedStart) * CM - segLen / 2;
          const localX  = flipX ? -rawX : rawX;
          return {
            localX,
            winLen:  w.len * CM,
            winH:    (w.h ?? 150) * CM,
            winSill: (w.sill ?? 90) * CM,
          };
        });

        // ── 玻璃幕墙 ──
        // 不再有 onClick 进入房间 —— 用户在左侧房间列表/顶部漫游按钮
        // 显式进入。3D 玻璃幕墙仅作展示。
        if (facade === "glass") {
          // Upper floors get a Juliet balcony glass railing along the facade base
          const showRailing = floorIndex > 0 && segLen > 0.8;
          // South-facing upper floors get external horizontal sunshade fins
          const showSunshade = floorIndex > 0 && isSouth && segLen > 1.2;
          const finCount2 = showSunshade ? Math.max(3, Math.round(segLen / 0.90)) : 0;
          return (
            <group key={`gl-${bi}`} position={[px, yMid, pz]} rotation={rot}>
              <GlassCurtain width={segLen} height={FLOOR_H} floorH={FLOOR_H} doors={floorIndex === 0 ? doorInfos : []} />
              {/* External horizontal sunshade fins — upper-floor south facade detail */}
              {showSunshade && (() => {
                const shadeY = FLOOR_H / 2 - 0.18;   // near top of glass panel
                const shadeD = 0.55;   // depth of each fin (projection from wall)
                const shadeH = 0.040;  // fin thickness
                const shadeSpacing = segLen / (finCount2 + 1);
                const shadeMat = { color: "#2E3240" as const, roughness: 0.20 as const, metalness: 0.88 as const, envMapIntensity: 2.2 as const };
                return (
                  <group position={[0, shadeY, 0.040]}>
                    {/* Continuous top rail */}
                    <mesh position={[0, shadeH / 2, shadeD / 2]}>
                      <boxGeometry args={[segLen - 0.04, 0.025, shadeD + 0.04]} />
                      <meshStandardMaterial {...shadeMat} />
                    </mesh>
                    {/* Individual fins */}
                    {Array.from({ length: finCount2 }, (_, fi2) => {
                      const fx = -segLen / 2 + (fi2 + 1) * shadeSpacing;
                      return (
                        <mesh key={fi2} position={[fx, 0, shadeD / 2]} castShadow>
                          <boxGeometry args={[0.028, shadeH, shadeD]} />
                          <meshStandardMaterial {...shadeMat} />
                        </mesh>
                      );
                    })}
                  </group>
                );
              })()}
              {showRailing && (() => {
                /* Premium glass Juliet balcony railing:
                   • Frameless tempered glass panels between steel posts
                   • Steel bottom channel + mid rail + top handrail
                   • LED night strip under handrail
                   • Intermediate posts every ~1.2m */
                const railH    = 1.05;   // railing height
                const nPosts   = Math.max(2, Math.ceil(segLen / 1.20));
                const postStep = (segLen - 0.08) / (nPosts - 1);
                const isNightR = sunHour < 6 || sunHour > 20;
                const isDuskR  = !isNightR && (sunHour < 8 || sunHour > 18);
                const ledEmi   = isNightR ? 1.4 : isDuskR ? 0.7 : 0.0;
                return (
                  <group position={[0, -FLOOR_H / 2 + 0.005, 0.052]}>
                    {/* Bottom channel — stainless steel base shoe */}
                    <mesh position={[0, 0.020, 0]}>
                      <boxGeometry args={[segLen - 0.04, 0.040, 0.032]} />
                      <meshStandardMaterial color="#181A1E" roughness={0.12} metalness={0.95} envMapIntensity={2.4} />
                    </mesh>
                    {/* Glass panels between posts — 2 tiers */}
                    {/* Lower glass panel */}
                    <mesh position={[0, railH * 0.35, 0.004]} renderOrder={11}>
                      <boxGeometry args={[segLen - 0.06, railH * 0.62, 0.010]} />
                      <meshStandardMaterial
                        color="#C8DDE8" transparent opacity={0.30}
                        depthWrite={false} roughness={0.02} metalness={0.12}
                        envMapIntensity={2.8} side={THREE.DoubleSide}
                      />
                    </mesh>
                    {/* Mid rail */}
                    <mesh position={[0, railH * 0.58, 0]}>
                      <boxGeometry args={[segLen - 0.06, 0.022, 0.028]} />
                      <meshStandardMaterial color="#222630" roughness={0.12} metalness={0.94} envMapIntensity={2.4} />
                    </mesh>
                    {/* Vertical posts */}
                    {Array.from({ length: nPosts }, (_, pi) => {
                      const px2 = -segLen / 2 + 0.04 + pi * postStep;
                      return (
                        <mesh key={pi} position={[px2, railH / 2, 0]}>
                          <boxGeometry args={[0.038, railH, 0.038]} />
                          <meshStandardMaterial color="#181A1E" roughness={0.10} metalness={0.96} envMapIntensity={2.5} />
                        </mesh>
                      );
                    })}
                    {/* Top handrail — brushed stainless flat bar */}
                    <mesh position={[0, railH + 0.010, 0]}>
                      <boxGeometry args={[segLen - 0.04, 0.040, 0.055]} />
                      <meshStandardMaterial color="#1C1E26" roughness={0.08} metalness={0.97} envMapIntensity={3.0} />
                    </mesh>
                    {/* LED strip under handrail (night glow) */}
                    <mesh position={[0, railH - 0.006, 0.020]}>
                      <boxGeometry args={[segLen - 0.08, 0.010, 0.008]} />
                      <meshStandardMaterial
                        color="#FFF8E0"
                        emissive="#FFF4C0"
                        emissiveIntensity={ledEmi}
                        roughness={0.60} metalness={0.10}
                      />
                    </mesh>
                    {ledEmi > 0 && (
                      <pointLight
                        position={[0, railH - 0.010, 0.040]}
                        intensity={ledEmi * 0.8}
                        distance={2.5} decay={2.0}
                        color="#FFF4D0" castShadow={false}
                      />
                    )}
                  </group>
                );
              })()}
            </group>
          );
        }

        // ── 木饰面（侧墙）—— 竖向木条板（charred wood / 碳化木）──
        if (facade === "wood") {
          const SLAT_W   = 0.118;  // 木条宽度
          const SLAT_GAP = 0.010;  // 缝隙（稍宽，阴影更清晰）
          const SLAT_T   = 0.052;  // 木条厚度
          const slatStep  = SLAT_W + SLAT_GAP;
          const slatCount = Math.max(3, Math.ceil(segLen / slatStep));
          const grooveColor2 = "#2A1508";  // 深碳化木缝隙
          const woodTex = getWoodGrainTex();
          return (
            <group key={`wd-${bi}`} position={[px, yMid, pz]} rotation={rot}>
              {/* 背板 — 深碳化底色 */}
              <mesh castShadow receiveShadow>
                <boxGeometry args={[segLen, FLOOR_H, 0.018]} />
                <meshStandardMaterial color={grooveColor2} roughness={0.95} />
              </mesh>
              {/* 顶 / 底部金属压条 */}
              {[-FLOOR_H / 2 + 0.016, FLOOR_H / 2 - 0.016].map((capY, ci) => (
                <mesh key={`cap-${ci}`} position={[0, capY, 0.032]}>
                  <boxGeometry args={[segLen, 0.032, 0.012]} />
                  <meshStandardMaterial color="#1E2028" roughness={0.20} metalness={0.90} envMapIntensity={2.0} />
                </mesh>
              ))}
              {/* 竖向木条 — grain texture + 3-tone colour variation
                  木条绕开窗洞：凡与窗洞重叠的木条跳过 */}
              {Array.from({ length: slatCount }, (_, si) => {
                const sx = -segLen / 2 + SLAT_W / 2 + si * slatStep;
                if (sx > segLen / 2 + 0.01) return null;
                // Skip slats that overlap any window opening
                const overlapsWindow = winInfos.some(w =>
                  Math.abs(sx - w.localX) < w.winLen / 2 + SLAT_W / 2 + 0.01
                );
                if (overlapsWindow) return null;
                // 3-way alternating tone for natural wood rhythm
                const col = si % 3 === 1 ? "#8B5C38" : si % 3 === 2 ? "#6C4022" : "#7A4E2A";
                return (
                  <mesh key={si} position={[sx, 0, 0.018 + SLAT_T / 2]} castShadow>
                    <boxGeometry args={[SLAT_W, FLOOR_H - 0.06, SLAT_T]} />
                    {woodTex
                      ? <meshStandardMaterial map={woodTex} color={col} roughness={0.78} metalness={0.0} />
                      : <meshStandardMaterial color={col} roughness={0.80} metalness={0.0} />
                    }
                  </mesh>
                );
              })}
              {/* 木饰面窗洞 — 渲染窗玻璃 + 金属窗框 + 室内底色，
                  与 ConcreteFacade 保持一致语言 */}
              {winInfos.map((w, wi) => (
                <group key={`ww-${wi}`} position={[w.localX, -FLOOR_H / 2 + w.winSill + w.winH / 2, 0]}>
                  {/* 室内背衬（夜间暖色发光） */}
                  <mesh position={[0, 0, -0.020]}>
                    <boxGeometry args={[w.winLen - 0.02, w.winH - 0.02, 0.06]} />
                    <meshStandardMaterial
                      color={interiorGlowWall > 0.5 ? "#F5E8C8" : "#1A1410"}
                      emissive={interiorGlowWall > 0.5 ? "#F4D890" : "#000000"}
                      emissiveIntensity={interiorGlowWall > 0.5 ? interiorGlowWall * 0.90 : 0}
                      roughness={0.9}
                    />
                  </mesh>
                  {/* 深色铝合金窗框 */}
                  {([
                    [-w.winLen / 2 + 0.025, 0,               0.028, w.winH  ] as [number,number,number,number],
                    [ w.winLen / 2 - 0.025, 0,               0.028, w.winH  ] as [number,number,number,number],
                    [0,  w.winH / 2 - 0.025, w.winLen, 0.052] as [number,number,number,number],
                    [0, -w.winH / 2 + 0.025, w.winLen, 0.052] as [number,number,number,number],
                  ]).map(([fx, fy, fw, fh], k) => (
                    <mesh key={k} position={[fx, fy, 0.022]}>
                      <planeGeometry args={[fw, fh]} />
                      <meshStandardMaterial color="#1E2028" roughness={0.25} metalness={0.88} envMapIntensity={2.2} />
                    </mesh>
                  ))}
                  {/* 玻璃 */}
                  <mesh position={[0, 0, 0.018]}>
                    <planeGeometry args={[w.winLen - 0.04, w.winH - 0.04]} />
                    <meshPhysicalMaterial
                      color={interiorGlowWall > 0.5 ? "#D8C8A0" : "#B0C8E0"}
                      transparent opacity={interiorGlowWall > 0.5 ? 0.80 : 0.60}
                      roughness={0.04} metalness={0.10}
                      emissive={interiorGlowWall > 0.5 ? "#F4C860" : "#000000"}
                      emissiveIntensity={interiorGlowWall > 0.5 ? interiorGlowWall * 0.22 : 0}
                      side={THREE.FrontSide}
                    />
                  </mesh>
                  {/* 窗台板 */}
                  <mesh position={[0, -w.winH / 2 - 0.030, 0.055]} castShadow>
                    <boxGeometry args={[w.winLen + 0.08, 0.050, 0.110]} />
                    <meshStandardMaterial color="#2A1E14" roughness={0.82} metalness={0.04} />
                  </mesh>
                </group>
              ))}
            </group>
          );
        }

        // ── 混凝土（含窗） ──
        return (
          <group key={`co-${bi}`} position={[px, yMid, pz]} rotation={rot}>
            <ConcreteFacade width={segLen} height={FLOOR_H} windows={winInfos} windowGlow={interiorGlowWall} />
            {/* 底部石材腰线（ground floor only）— 仿石灰岩腰线覆盖在混凝土底部，
                高度 0.55m（窗台 0.90m 以下，不遮窗），增加基座感与立面层次。*/}
            {floorIndex === 0 && (
              <group position={[0, -FLOOR_H / 2 + 0.275, 0.050]}>
                {/* Main cladding slab */}
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[segLen + 0.004, 0.55, 0.016]} />
                  <meshStandardMaterial color="#D8D0BE" roughness={0.64} metalness={0.02} envMapIntensity={0.55} />
                </mesh>
                {/* Ashlar horizontal rustication joints — 3 stone courses */}
                {[0.13, 0, -0.13].map((jy, ji) => (
                  <mesh key={ji} position={[0, jy, 0.009]}>
                    <boxGeometry args={[segLen + 0.005, 0.008, 0.006]} />
                    <meshStandardMaterial color="#B8B0A0" roughness={0.88} />
                  </mesh>
                ))}
                {/* Top edge flashing strip */}
                <mesh position={[0, 0.278, 0.010]}>
                  <boxGeometry args={[segLen + 0.006, 0.010, 0.012]} />
                  <meshStandardMaterial color="#3A3E48" roughness={0.22} metalness={0.90} envMapIntensity={1.6} />
                </mesh>
              </group>
            )}
            {/* ── 车库门（garage door）——宽门（≥ 2m）渲染为高精度分节卷帘车库门 ──
                 Modern raised-panel sectional garage door:
                 • 8 narrow horizontal slat panels with 3D raised ridges
                 • Top window strip — 4 frosted acrylic lite panels
                 • Perimeter aluminium frame + side vertical tracks
                 • Central T-handle bar + keypad box
                 • Overhead opener motor rail unit
                 • Bottom weather seal rubber strip
                 • LED soffit strip at night */}
            {floorIndex === 0 && doorInfos.filter(d => d.w >= 2.0).map((d, di) => {
              const gdW      = d.w;
              const gdH      = Math.min(d.h, FLOOR_H * 0.85);
              const gdY      = -FLOOR_H / 2 + gdH / 2;
              const slats    = 8;
              // Reserve top 18% for window strip
              const winStripH = gdH * 0.18;
              const slatZone  = gdH - winStripH;
              const slatH     = slatZone / slats;
              const gdColor   = "#22262E";   // dark anodized aluminium
              const gdMid     = "#2E3340";   // mid tone slat face
              const gdLight   = "#3A4052";   // highlight ridge
              const gdReveal  = "#181B22";   // reveal shadow
              const gdMetal   = { roughness: 0.20, metalness: 0.88, envMapIntensity: 2.4 };
              const isNightGD = sunHour < 6 || sunHour > 20;
              const isDuskGD  = !isNightGD && (sunHour < 8 || sunHour > 18);

              return (
                <group key={`gd-${di}`} position={[d.cx, gdY, 0.065]}>
                  {/* ── Perimeter frame ── */}
                  <mesh position={[0, 0, -0.010]} castShadow>
                    <boxGeometry args={[gdW + 0.07, gdH + 0.07, 0.045]} />
                    <meshStandardMaterial color={gdColor} {...gdMetal} />
                  </mesh>

                  {/* ── 8 slat panels (lower zone) ── */}
                  {Array.from({ length: slats }, (_, pi) => {
                    const pyOffset = -gdH / 2 + winStripH + (pi + 0.5) * slatH;
                    return (
                      <group key={`slat-${pi}`} position={[0, pyOffset, 0]}>
                        {/* Main panel face */}
                        <mesh castShadow>
                          <boxGeometry args={[gdW - 0.05, slatH - 0.010, 0.028]} />
                          <meshStandardMaterial color={pi % 2 === 0 ? gdMid : gdColor} {...gdMetal} />
                        </mesh>
                        {/* Top raised ridge */}
                        <mesh position={[0, slatH / 2 - 0.012, 0.018]}>
                          <boxGeometry args={[gdW - 0.06, 0.014, 0.018]} />
                          <meshStandardMaterial color={gdLight} roughness={0.16} metalness={0.92} envMapIntensity={2.6} />
                        </mesh>
                        {/* Bottom shadow reveal */}
                        <mesh position={[0, -slatH / 2 + 0.004, 0.016]}>
                          <boxGeometry args={[gdW - 0.06, 0.008, 0.012]} />
                          <meshStandardMaterial color={gdReveal} roughness={0.35} metalness={0.80} />
                        </mesh>
                        {/* 3 vertical embossed lines per slat */}
                        {[-gdW * 0.28, 0, gdW * 0.28].map((vx, vi) => (
                          <mesh key={vi} position={[vx, 0, 0.016]}>
                            <boxGeometry args={[0.012, slatH - 0.018, 0.010]} />
                            <meshStandardMaterial color={gdReveal} roughness={0.30} metalness={0.82} />
                          </mesh>
                        ))}
                      </group>
                    );
                  })}

                  {/* ── Top window strip — 4 frosted acrylic lites ── */}
                  {(() => {
                    const winY = -gdH / 2 + winStripH / 2;
                    const liteW = (gdW - 0.12) / 4;
                    return (
                      <group position={[0, winY, 0]}>
                        {/* Window strip frame */}
                        <mesh position={[0, 0, -0.002]} castShadow>
                          <boxGeometry args={[gdW - 0.05, winStripH - 0.010, 0.030]} />
                          <meshStandardMaterial color={gdColor} {...gdMetal} />
                        </mesh>
                        {/* 4 acrylic lites */}
                        {Array.from({ length: 4 }, (_, li) => {
                          const lx = -((gdW - 0.12) / 2) + li * liteW + liteW / 2;
                          return (
                            <mesh key={li} position={[lx, 0, 0.016]}>
                              <boxGeometry args={[liteW - 0.025, winStripH - 0.030, 0.010]} />
                              <meshPhysicalMaterial
                                color="#C8D8E8"
                                transparent opacity={0.42}
                                roughness={0.12} metalness={0.05}
                                transmission={0.25}
                                emissive="#A8C0D8"
                                emissiveIntensity={isNightGD ? 0.18 : 0.04}
                              />
                            </mesh>
                          );
                        })}
                      </group>
                    );
                  })()}

                  {/* ── Central T-handle pull bar ── */}
                  <mesh position={[0, -gdH * 0.30, 0.024]}>
                    <boxGeometry args={[gdW * 0.18, 0.022, 0.024]} />
                    <meshStandardMaterial color="#C0C8D4" roughness={0.15} metalness={0.94} envMapIntensity={2.6} />
                  </mesh>
                  {/* Handle grip shaft */}
                  <mesh position={[0, -gdH * 0.30 - 0.032, 0.026]}>
                    <boxGeometry args={[0.028, 0.055, 0.022]} />
                    <meshStandardMaterial color="#B0B8C4" roughness={0.18} metalness={0.92} envMapIntensity={2.4} />
                  </mesh>

                  {/* ── Keypad box (right of door) ── */}
                  <mesh position={[gdW / 2 + 0.045, -gdH * 0.18, 0]}>
                    <boxGeometry args={[0.060, 0.110, 0.045]} />
                    <meshStandardMaterial color="#282C36" roughness={0.45} metalness={0.42} />
                  </mesh>
                  <mesh position={[gdW / 2 + 0.045, -gdH * 0.18, 0.024]}>
                    <boxGeometry args={[0.040, 0.085, 0.006]} />
                    <meshStandardMaterial color="#10121A" roughness={0.60} metalness={0.20}
                      emissive="#003060" emissiveIntensity={isNightGD ? 0.80 : 0.08} />
                  </mesh>

                  {/* ── Vertical side tracks ── */}
                  {([-gdW / 2 - 0.018, gdW / 2 + 0.018] as number[]).map((tx, ti) => (
                    <mesh key={ti} position={[tx, gdH * 0.10, -0.022]} castShadow>
                      <boxGeometry args={[0.032, gdH * 0.80, 0.024]} />
                      <meshStandardMaterial color={gdColor} roughness={0.28} metalness={0.86} />
                    </mesh>
                  ))}

                  {/* ── Overhead opener motor rail (above door, projecting inward) ── */}
                  <mesh position={[0, gdH / 2 + 0.045, -0.28]} castShadow>
                    <boxGeometry args={[0.060, 0.060, 0.55]} />
                    <meshStandardMaterial color="#404850" roughness={0.50} metalness={0.50} />
                  </mesh>
                  {/* Motor head unit */}
                  <mesh position={[0, gdH / 2 + 0.050, -0.08]}>
                    <boxGeometry args={[0.22, 0.14, 0.28]} />
                    <meshStandardMaterial color="#303840" roughness={0.45} metalness={0.55} />
                  </mesh>
                  {/* Opener light lens */}
                  <mesh position={[0, gdH / 2 + 0.010, -0.12]}>
                    <boxGeometry args={[0.080, 0.040, 0.060]} />
                    <meshPhysicalMaterial
                      color="#FFF8E0" transparent opacity={0.70}
                      emissive="#FFF4C0"
                      emissiveIntensity={isNightGD ? 2.5 : 0.06}
                      roughness={0.10} metalness={0.05}
                    />
                  </mesh>

                  {/* ── Bottom weather seal rubber strip ── */}
                  <mesh position={[0, -gdH / 2 - 0.006, 0.012]}>
                    <boxGeometry args={[gdW - 0.05, 0.014, 0.016]} />
                    <meshStandardMaterial color="#101214" roughness={0.90} metalness={0.02} />
                  </mesh>

                  {/* ── LED soffit strip (night) ── */}
                  {isNightGD && (
                    <pointLight
                      position={[0, -gdH * 0.45, 0.18]}
                      intensity={isNightGD ? 3.0 : isDuskGD ? 1.5 : 0.0}
                      distance={3.5} decay={2.0}
                      color="#FFF4D0"
                      castShadow={false}
                    />
                  )}
                </group>
              );
            })}
          </group>
        );
      })}

      {/* ── 4a-extra2. 建筑基础 LED 地埋射灯（inground uplight fixtures）──
           Small recessed inground uplights placed just outside the building
           base on all 4 sides, spaced ~2.4m apart. At night they cast warm
           amber beams upward, dramatically illuminating the facade and corner
           columns. Each fixture: small dark housing flush with ground + lens
           + spotLight aimed straight up at the wall. */}
      {!insideBuilding && isGlassVilla && (() => {
        const isNightUL = sunHour < 6 || sunHour > 20;
        const isDuskUL  = !isNightUL && (sunHour < 8 || sunHour > 18);
        const ulI  = isNightUL ? 5.0 : isDuskUL ? 2.5 : 0.0;
        const ulEm = isNightUL ? 3.2 : isDuskUL ? 1.5 : 0.20;
        const ulOffset = 0.32;  // m from building face

        if (ulI === 0 && ulEm < 0.3) return null;

        // Generate fixtures along all 4 faces
        const spacing = 2.40;
        const fixtures: Array<{x: number; y: number; z: number; rY: number}> = [];

        // South face (negative Z)
        const nSouth = Math.max(2, Math.round(W / spacing));
        for (let i = 0; i < nSouth; i++) {
          const fx = -W / 2 + (i + 0.5) * (W / nSouth);
          fixtures.push({ x: fx, y: 0, z: -D / 2 - ulOffset, rY: 0 });
        }
        // North face (positive Z)
        for (let i = 0; i < nSouth; i++) {
          const fx = -W / 2 + (i + 0.5) * (W / nSouth);
          fixtures.push({ x: fx, y: 0, z: D / 2 + ulOffset, rY: Math.PI });
        }
        // East face (positive X)
        const nEast = Math.max(2, Math.round(D / spacing));
        for (let i = 0; i < nEast; i++) {
          const fz = -D / 2 + (i + 0.5) * (D / nEast);
          fixtures.push({ x: W / 2 + ulOffset, y: 0, z: fz, rY: -Math.PI / 2 });
        }
        // West face (negative X)
        for (let i = 0; i < nEast; i++) {
          const fz = -D / 2 + (i + 0.5) * (D / nEast);
          fixtures.push({ x: -W / 2 - ulOffset, y: 0, z: fz, rY: Math.PI / 2 });
        }

        return (
          <group>
            {fixtures.map((f, fi) => (
              <group key={`ul-${fi}`} position={[f.x, f.y, f.z]}>
                {/* Inground housing — flush dark disc */}
                <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[0.055, 8]} />
                  <meshStandardMaterial color="#282C34" roughness={0.38} metalness={0.78} />
                </mesh>
                {/* Lens — frosted warm-white */}
                <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[0.038, 8]} />
                  <meshStandardMaterial
                    color="#FFF8E0"
                    emissive="#FFE880" emissiveIntensity={ulEm}
                    roughness={0.55} transparent opacity={0.92}
                  />
                </mesh>
                {/* SpotLight aimed upward at wall */}
                {ulI > 0 && (
                  <spotLight
                    position={[0, 0.10, 0]}
                    intensity={ulI}
                    distance={8.0}
                    angle={Math.PI * 0.14}
                    penumbra={0.55}
                    decay={1.8}
                    color="#FFF2D0"
                    castShadow={false}
                  />
                )}
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 4b. 东西立面竖向遮阳翅片（brise-soleil fins）——
               铝合金竖向矩形截面板，均匀分布于东西两侧外墙
               · 只在 isGlassVilla 楼（floor-plan-driven）下渲染
               · 多层：每层独立组，翅片从楼板升至楼顶
               · 材质：深色阳极氧化铝，高金属感 */}
      {!insideBuilding && isGlassVilla && (() => {
        const finColor  = "#1E2128";
        const finW      = 0.035;  // fin thickness (E-W)
        const finD      = 0.38;   // fin depth (N-S protrusion)
        const finCount  = Math.max(4, Math.round(D / 0.90));  // fins per floor along N-S
        const finSpacing = D / (finCount + 1);
        const xEast  =  W / 2 + finD / 2 + 0.01;
        const xWest  = -W / 2 - finD / 2 - 0.01;
        return (
          <group>
            {Array.from({ length: usedFloors }, (_, fi) => {
              const yBase = fi * (FLOOR_H + SLAB_T);
              const fH    = FLOOR_H - 0.02;
              return [xEast, xWest].flatMap((fx, side) =>
                Array.from({ length: finCount }, (_, fi2) => {
                  const fz = -D / 2 + (fi2 + 1) * finSpacing;
                  return (
                    <mesh key={`fin-${fi}-${side}-${fi2}`}
                      position={[fx, yBase + fH / 2, fz]}
                      castShadow>
                      <boxGeometry args={[finD, fH, finW]} />
                      <meshStandardMaterial color={finColor} roughness={0.18} metalness={0.88} envMapIntensity={2.2} />
                    </mesh>
                  );
                })
              );
            })}
          </group>
        );
      })()}

      {/* ── 4c. 建筑周边绿化带（基础种植床）—— 紧贴东/西/北面建筑基座 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const bedW = 0.45;  // planting bed width
        const bedH = 0.12;  // raised bed height
        const plantH = 0.55; // ornamental grass height
        const grassColor = "#3A6A2A";
        const bedColor  = "#8A6848";  // terracotta/earth
        return (
          <group>
            {/* East bed */}
            <mesh position={[W / 2 + bedW / 2 + 0.02, bedH / 2 + 0.002, 0]} castShadow receiveShadow>
              <boxGeometry args={[bedW, bedH, D - 0.20]} />
              <meshStandardMaterial color={bedColor} roughness={0.92} />
            </mesh>
            {/* West bed */}
            <mesh position={[-W / 2 - bedW / 2 - 0.02, bedH / 2 + 0.002, 0]} castShadow receiveShadow>
              <boxGeometry args={[bedW, bedH, D - 0.20]} />
              <meshStandardMaterial color={bedColor} roughness={0.92} />
            </mesh>
            {/* North bed */}
            <mesh position={[0, bedH / 2 + 0.002, D / 2 + bedW / 2 + 0.02]} castShadow receiveShadow>
              <boxGeometry args={[W + 0.04, bedH, bedW]} />
              <meshStandardMaterial color={bedColor} roughness={0.92} />
            </mesh>
            {/* Ornamental grass clumps along east bed */}
            {Array.from({ length: Math.round(D / 1.6) }, (_, gi) => {
              const gz = -D / 2 + 0.8 + gi * 1.6;
              return (
                <mesh key={gi} position={[W / 2 + bedW / 2 + 0.02, bedH + plantH / 2, gz]} castShadow>
                  <sphereGeometry args={[0.18, 8, 6]} />
                  <meshStandardMaterial color={grassColor} roughness={0.96} />
                </mesh>
              );
            })}
            {/* Ornamental grass clumps along west bed */}
            {Array.from({ length: Math.round(D / 1.6) }, (_, gi) => {
              const gz = -D / 2 + 0.8 + gi * 1.6;
              return (
                <mesh key={gi} position={[-W / 2 - bedW / 2 - 0.02, bedH + plantH / 2, gz]} castShadow>
                  <sphereGeometry args={[0.18, 8, 6]} />
                  <meshStandardMaterial color={gi % 2 === 0 ? grassColor : "#2E5820"} roughness={0.95} />
                </mesh>
              );
            })}
            {/* Ornamental grass clumps along north bed */}
            {Array.from({ length: Math.round(W / 1.6) }, (_, gi) => {
              const gx = -W / 2 + 0.8 + gi * 1.6;
              return (
                <mesh key={gi} position={[gx, bedH + plantH * 0.45, D / 2 + bedW / 2 + 0.02]} castShadow>
                  <sphereGeometry args={[0.15, 8, 6]} />
                  <meshStandardMaterial color={gi % 3 === 0 ? "#2A5C1E" : gi % 3 === 1 ? grassColor : "#3E7030"} roughness={0.96} />
                </mesh>
              );
            })}
          </group>
        );
      })()}

      {/* ── 4d. 屋顶露台玻璃栏杆（南向露台内侧，安全围护）──
               沿女儿墙内侧布置，仅在南侧和东西短边各一段
               材质：夹胶玻璃 + 黑色阳极氧化铝竖框 */}
      {!insideBuilding && (() => {
        const railY = totalH + 0.30 + 0.48;  // parapet top + railing base
        const PH = 0.30;          // parapet height (same as FlatRoof)
        const OV = 0.45;          // roof overhang
        const rH  = 0.92;         // railing glass height
        const rT  = 0.012;        // glass panel thickness
        const postW = 0.038;      // post cross-section
        const frameColor = "#1C1E26";
        const terW = Math.min(W * 0.60, 7.0);  // terrace railing span (south only, centered)
        const railZ = -D / 2 - OV + 0.20;  // inset from south parapet inner face
        // Number of glass panels (each ~1.2m wide)
        const panelCount = Math.max(2, Math.round(terW / 1.2));
        const postPositions = Array.from({ length: panelCount + 1 }, (_, i) => -terW / 2 + i * (terW / panelCount));
        return (
          <group position={[0, railY, railZ]}>
            {/* Glass panels */}
            {Array.from({ length: panelCount }, (_, i) => {
              const cx2 = -terW / 2 + (i + 0.5) * (terW / panelCount);
              const pW  = terW / panelCount - postW - 0.008;
              return (
                <mesh key={i} position={[cx2, rH / 2, 0]} renderOrder={11}>
                  <boxGeometry args={[pW, rH - 0.06, rT]} />
                  <meshStandardMaterial
                    color="#C8DCE8"
                    transparent opacity={0.38}
                    depthWrite={false}
                    roughness={0.04} metalness={0.10}
                    envMapIntensity={2.4}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              );
            })}
            {/* Vertical posts */}
            {postPositions.map((px2, pi) => (
              <mesh key={pi} position={[px2, rH / 2, 0]} castShadow>
                <boxGeometry args={[postW, rH, postW]} />
                <meshStandardMaterial color={frameColor} roughness={0.12} metalness={0.92} envMapIntensity={2.2} />
              </mesh>
            ))}
            {/* Top handrail */}
            <mesh position={[0, rH + 0.018, 0]}>
              <boxGeometry args={[terW + 0.04, 0.038, 0.060]} />
              <meshStandardMaterial color={frameColor} roughness={0.12} metalness={0.94} envMapIntensity={2.4} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5. 平屋顶（室内视角下隐藏） ── */}
      {/* ── 5a-rain. 雨链（rain chains）— 从屋顶排水口沿东西墙面垂直下挂 ──
               Decorative copper/steel chains; typical on Japanese-style or
               contemporary luxury architecture. */}
      {!insideBuilding && isGlassVilla && (() => {
        // Rain chain positions match the scupper locations in FlatRoof:
        // East: [W/2 + 0.04, roofSlab + 0.05 + 0.08, D*0.15]
        // West: [-W/2 - 0.04, roofSlab + 0.05 + 0.08, -D*0.15]
        const chainPositions: Array<[number, number]> = [
          [ W / 2, D * 0.15],
          [-W / 2, -D * 0.15],
        ];
        const chainTop = totalH + 0.08;   // roof scupper height
        const chainLen = chainTop;         // chain runs from roof to grade
        const linkCount = Math.round(chainLen / 0.12);
        const chainColor = "#7A6858";      // aged copper / patinated steel
        return (
          <group>
            {chainPositions.map(([cx2, cz2], ci) => (
              <group key={ci} position={[cx2, chainTop / 2, cz2]}>
                {/* Main chain column (thin cylinder stand-in for chain texture) */}
                <mesh castShadow>
                  <cylinderGeometry args={[0.010, 0.010, chainLen, 5]} />
                  <meshStandardMaterial color={chainColor} roughness={0.70} metalness={0.48} />
                </mesh>
                {/* Ring links spaced every 0.12m — visible as ring torus elements */}
                {Array.from({ length: Math.min(linkCount, 24) }, (_, li) => {
                  const ly = chainLen / 2 - li * (chainLen / Math.max(linkCount, 1));
                  return (
                    <mesh key={li} position={[0, ly, 0]}>
                      <torusGeometry args={[0.014, 0.004, 4, 6]} />
                      <meshStandardMaterial color={chainColor} roughness={0.62} metalness={0.52} />
                    </mesh>
                  );
                })}
                {/* Splash basin at grade — small dark dish */}
                <mesh position={[0, -chainLen / 2 + 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.12, 0.15, 0.08, 10]} />
                  <meshStandardMaterial color="#4A4840" roughness={0.60} metalness={0.30} />
                </mesh>
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 5a-stone. 东立面地层石材装饰墙板（ground-floor stone accent strip）──
               Adds a contrasting natural stone strip (travertine-look) along
               the east and north concrete facade at grade — a common luxury
               exterior detail that breaks up the monolithic concrete base. */}
      {!insideBuilding && isGlassVilla && (() => {
        const stoneH  = 1.10;   // height of the stone strip
        const stoneT  = 0.015;  // protrusion from concrete base
        const stoneY  = stoneH / 2 + 0.40;  // centre Y (above granite base at 0.40)
        const stoneColA = "#C8C0A8";  // warm travertine base
        const stoneColB = "#B8B0A0";  // darker vein / joint
        const jointStep = 0.55;        // vertical joint spacing
        return (
          <group>
            {/* East stone strip */}
            <mesh position={[W / 2 + stoneT / 2 + 0.12 + 0.002, stoneY, 0]} castShadow>
              <boxGeometry args={[stoneT, stoneH, D - 0.08]} />
              <meshStandardMaterial color={stoneColA} roughness={0.74} metalness={0.02} envMapIntensity={0.6} />
            </mesh>
            {/* East stone joint lines */}
            {Array.from({ length: Math.round((D - 0.08) / jointStep) }, (_, ji) => {
              const jz = -D / 2 + 0.04 + (ji + 1) * jointStep;
              return (
                <mesh key={ji} position={[W / 2 + stoneT + 0.12 + 0.003, stoneY, jz]}>
                  <boxGeometry args={[0.002, stoneH - 0.01, 0.010]} />
                  <meshStandardMaterial color={stoneColB} roughness={0.90} />
                </mesh>
              );
            })}
            {/* North stone strip */}
            <mesh position={[0, stoneY, D / 2 + stoneT / 2 + 0.12 + 0.002]} castShadow>
              <boxGeometry args={[W - 0.08, stoneH, stoneT]} />
              <meshStandardMaterial color={stoneColA} roughness={0.74} metalness={0.02} envMapIntensity={0.6} />
            </mesh>
            {/* North stone joint lines */}
            {Array.from({ length: Math.round((W - 0.08) / jointStep) }, (_, ji) => {
              const jx = -W / 2 + 0.04 + (ji + 1) * jointStep;
              return (
                <mesh key={ji} position={[jx, stoneY, D / 2 + stoneT + 0.12 + 0.003]}>
                  <boxGeometry args={[0.010, stoneH - 0.01, 0.002]} />
                  <meshStandardMaterial color={stoneColB} roughness={0.90} />
                </mesh>
              );
            })}
            {/* Horizontal top trim — separates stone strip from concrete above */}
            <mesh position={[W / 2 + stoneT / 2 + 0.12 + 0.002, stoneY + stoneH / 2 + 0.006, 0]}>
              <boxGeometry args={[stoneT + 0.010, 0.012, D - 0.06]} />
              <meshStandardMaterial color="#3A3E48" roughness={0.22} metalness={0.90} envMapIntensity={1.8} />
            </mesh>
            <mesh position={[0, stoneY + stoneH / 2 + 0.006, D / 2 + stoneT / 2 + 0.12 + 0.002]}>
              <boxGeometry args={[W - 0.06, 0.012, stoneT + 0.010]} />
              <meshStandardMaterial color="#3A3E48" roughness={0.22} metalness={0.90} envMapIntensity={1.8} />
            </mesh>
            {/* South facade stone accent strip (match east/north) */}
            <mesh position={[0, stoneY, -D / 2 - stoneT / 2 - 0.12 - 0.002]} castShadow>
              <boxGeometry args={[W - 0.08, stoneH, stoneT]} />
              <meshStandardMaterial color={stoneColA} roughness={0.74} metalness={0.02} envMapIntensity={0.6} />
            </mesh>
            {Array.from({ length: Math.round((W - 0.08) / jointStep) }, (_, ji) => {
              const jx = -W / 2 + 0.04 + (ji + 1) * jointStep;
              return (
                <mesh key={`sj-${ji}`} position={[jx, stoneY, -D / 2 - stoneT - 0.12 - 0.003]}>
                  <boxGeometry args={[0.010, stoneH - 0.01, 0.002]} />
                  <meshStandardMaterial color={stoneColB} roughness={0.90} />
                </mesh>
              );
            })}
            <mesh position={[0, stoneY + stoneH / 2 + 0.006, -D / 2 - stoneT / 2 - 0.12 - 0.002]}>
              <boxGeometry args={[W - 0.06, 0.012, stoneT + 0.010]} />
              <meshStandardMaterial color="#3A3E48" roughness={0.22} metalness={0.90} envMapIntensity={1.8} />
            </mesh>
            {/* West facade stone accent strip */}
            <mesh position={[-W / 2 - stoneT / 2 - 0.12 - 0.002, stoneY, 0]} castShadow>
              <boxGeometry args={[stoneT, stoneH, D - 0.08]} />
              <meshStandardMaterial color={stoneColA} roughness={0.74} metalness={0.02} envMapIntensity={0.6} />
            </mesh>
            {Array.from({ length: Math.round((D - 0.08) / jointStep) }, (_, ji) => {
              const jz = -D / 2 + 0.04 + (ji + 1) * jointStep;
              return (
                <mesh key={`wj-${ji}`} position={[-W / 2 - stoneT - 0.12 - 0.003, stoneY, jz]}>
                  <boxGeometry args={[0.002, stoneH - 0.01, 0.010]} />
                  <meshStandardMaterial color={stoneColB} roughness={0.90} />
                </mesh>
              );
            })}
            <mesh position={[-W / 2 - stoneT / 2 - 0.12 - 0.002, stoneY + stoneH / 2 + 0.006, 0]}>
              <boxGeometry args={[stoneT + 0.010, 0.012, D - 0.06]} />
              <meshStandardMaterial color="#3A3E48" roughness={0.22} metalness={0.90} envMapIntensity={1.8} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5a-base. 建筑基部种植（foundation planting — ornamental grass + shrubs）──
           A strip of low ornamental grasses and mounding shrubs along the
           south and east/west faces, softening building-meets-ground transition.
           Standard luxury exterior finish — usually boxwood, liriope, or grasses. */}
      {!insideBuilding && isGlassVilla && (() => {
        const bedW = 0.55;    // planting bed depth from building face
        const bedY = bedW / 2;
        // South facade plant strip
        const southZ = -D / 2 - bedW / 2 - 0.004;
        const plantCount = Math.round(W / 0.65);
        const plants: Array<{ x: number; z: number; type: number }> = [];
        // South face
        for (let pi = 0; pi < plantCount; pi++) {
          const px = -W / 2 + 0.32 + pi * (W / (plantCount - 1));
          plants.push({ x: px, z: southZ, type: pi % 3 });
        }
        // East face strip (partial, towards south)
        const eastX = W / 2 + bedW / 2 + 0.004;
        const eastCount = Math.round(D * 0.55 / 0.65);
        for (let pi = 0; pi < eastCount; pi++) {
          const pz = -D / 2 + 0.32 + pi * (D * 0.55 / (eastCount - 1));
          plants.push({ x: eastX, z: pz, type: pi % 3 });
        }
        // West face strip (partial)
        const westX = -W / 2 - bedW / 2 - 0.004;
        for (let pi = 0; pi < eastCount; pi++) {
          const pz = -D / 2 + 0.32 + pi * (D * 0.55 / (eastCount - 1));
          plants.push({ x: westX, z: pz, type: (pi + 1) % 3 });
        }
        return (
          <group>
            {/* Dark mulch / gravel bed along south face */}
            <mesh position={[0, 0.006, southZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[W, bedW]} />
              <meshStandardMaterial color="#2A1E14" roughness={0.96} metalness={0.01} />
            </mesh>
            {/* East bed */}
            <mesh position={[eastX, 0.006, -D / 2 + D * 0.28]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[bedW, D * 0.55]} />
              <meshStandardMaterial color="#2A1E14" roughness={0.96} metalness={0.01} />
            </mesh>
            {/* West bed */}
            <mesh position={[westX, 0.006, -D / 2 + D * 0.28]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[bedW, D * 0.55]} />
              <meshStandardMaterial color="#2A1E14" roughness={0.96} metalness={0.01} />
            </mesh>
            {/* Plants: type 0 = liriope grass, type 1 = boxwood mound, type 2 = ornamental grass */}
            {plants.map(({ x, z, type }, pi) => {
              const pHash = (pi * 17 + 3) % 13;
              if (type === 0) {
                // Liriope / ground cover — low dense spheres
                return (
                  <mesh key={pi} position={[x, 0.10, z]} castShadow>
                    <sphereGeometry args={[0.12 + (pHash % 3) * 0.030, 6, 5]} />
                    <meshStandardMaterial color={pHash % 2 === 0 ? "#3A6828" : "#2E5A20"} roughness={0.96} />
                  </mesh>
                );
              } else if (type === 1) {
                // Boxwood mound
                return (
                  <mesh key={pi} position={[x, 0.16, z]} castShadow>
                    <sphereGeometry args={[0.18 + (pHash % 3) * 0.040, 7, 5]} />
                    <meshStandardMaterial color={pHash % 2 === 0 ? "#1E4A18" : "#244E1C"} roughness={0.97} />
                  </mesh>
                );
              } else {
                // Ornamental grass clump — elongated cylinder with fanned top
                return (
                  <group key={pi} position={[x, 0, z]}>
                    {Array.from({ length: 5 }, (_, gi) => {
                      const ga = (gi / 5) * Math.PI * 2;
                      const gr = 0.05 + (pHash % 3) * 0.018;
                      const gh = 0.32 + (pHash % 3) * 0.060;
                      const gTiltX = Math.cos(ga) * 0.18;
                      const gTiltZ = Math.sin(ga) * 0.18;
                      return (
                        <mesh key={gi} position={[gTiltX * 0.3, gh / 2, gTiltZ * 0.3]} rotation={[gTiltZ * 0.5, 0, -gTiltX * 0.5]}>
                          <cylinderGeometry args={[0.006, 0.018, gh, 4]} />
                          <meshStandardMaterial color="#5A7840" roughness={0.88} />
                        </mesh>
                      );
                    })}
                  </group>
                );
              }
            })}
          </group>
        );
      })()}

      {/* ── 5a-screen. 东侧立面竖向金属格栅屏（vertical louvre privacy screen）──
           A full-height architectural louvre screen at the east end of the south
           facade — provides shade, privacy, and strong design character. Dark
           anodized aluminum blades, spaced at 120mm. */}
      {!insideBuilding && isGlassVilla && (() => {
        const screenX  = W / 2 + 0.14;   // just proud of east facade face
        const screenZ  = -D / 2 + D * 0.30;  // south-east area
        const screenH  = totalH;           // full building height
        const screenD  = Math.min(D * 0.40, 3.80);  // depth along Z
        const bladeW   = 0.025;  // blade thickness
        const bladeH   = screenH + 0.08;
        const bladeStep = 0.120;  // spacing
        const bladeCount = Math.round(screenD / bladeStep) + 1;
        const bladeAngle = 0.35;  // ~20° rotation for privacy
        const bladeColor = "#2A2E38";
        const frameColor = "#1E2028";
        return (
          <group position={[screenX, screenH / 2, screenZ]}>
            {/* Top and bottom frame rails */}
            {([-screenH / 2 + 0.020, screenH / 2 - 0.020] as number[]).map((fy, fi) => (
              <mesh key={fi} position={[0, fy, 0]} castShadow>
                <boxGeometry args={[0.040, 0.040, screenD]} />
                <meshStandardMaterial color={frameColor} roughness={0.22} metalness={0.88} envMapIntensity={2.0} />
              </mesh>
            ))}
            {/* Vertical louvre blades */}
            {Array.from({ length: bladeCount }, (_, bi) => {
              const bz = -screenD / 2 + bi * bladeStep;
              return (
                <mesh key={bi} position={[bladeW / 2, 0, bz]} rotation={[0, bladeAngle, 0]} castShadow>
                  <boxGeometry args={[bladeW, bladeH, 0.095]} />
                  <meshStandardMaterial color={bladeColor} roughness={0.24} metalness={0.82} envMapIntensity={2.5} />
                </mesh>
              );
            })}
            {/* Mounting bracket at mid-height */}
            <mesh position={[0.025, 0, 0]}>
              <boxGeometry args={[0.050, 0.030, screenD + 0.04]} />
              <meshStandardMaterial color={frameColor} roughness={0.28} metalness={0.82} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5a-eave. 屋檐下沿 LED 灯带（eave soffit LED downlight strip）──
           Linear warm-white LED strip runs under all 4 eaves (roof overhang
           underside). Adds strong night ambience and defines the roofline. */}
      {!insideBuilding && isGlassVilla && (() => {
        const OV5  = 0.45;     // roof overhang (matches FlatRoof)
        const OV_S5 = 0.75;   // south overhang
        const eaveY  = totalH + 0.04;   // underside of roof slab
        const isNightE = sunHour < 6 || sunHour > 20;
        const isDuskE  = !isNightE && (sunHour < 8 || sunHour > 18);
        const eaveEmi  = isNightE ? 2.8 : isDuskE ? 1.4 : 0.20;
        const eaveLI   = isNightE ? 8.0 : isDuskE ? 4.0 : 0.0;
        const eaveCol  = "#FFE8C0";
        const eaveW  = 0.018;  // strip width
        const eaveH  = 0.010;  // strip thickness
        const eaveInset = 0.12; // inset from eave edge
        return (
          <group>
            {/* South eave strip */}
            <mesh position={[0, eaveY, -D / 2 - OV_S5 + eaveInset]}>
              <boxGeometry args={[W + OV5 * 2 - 0.10, eaveH, eaveW]} />
              <meshStandardMaterial color={eaveCol} emissive={eaveCol} emissiveIntensity={eaveEmi} roughness={0.70} />
            </mesh>
            {/* North eave strip */}
            <mesh position={[0, eaveY, D / 2 + OV5 - eaveInset]}>
              <boxGeometry args={[W + OV5 * 2 - 0.10, eaveH, eaveW]} />
              <meshStandardMaterial color={eaveCol} emissive={eaveCol} emissiveIntensity={eaveEmi} roughness={0.70} />
            </mesh>
            {/* East eave strip */}
            <mesh position={[W / 2 + OV5 - eaveInset, eaveY, -(OV_S5 - OV5) / 2]}>
              <boxGeometry args={[eaveW, eaveH, D + OV_S5 + OV5 - 0.10]} />
              <meshStandardMaterial color={eaveCol} emissive={eaveCol} emissiveIntensity={eaveEmi} roughness={0.70} />
            </mesh>
            {/* West eave strip */}
            <mesh position={[-W / 2 - OV5 + eaveInset, eaveY, -(OV_S5 - OV5) / 2]}>
              <boxGeometry args={[eaveW, eaveH, D + OV_S5 + OV5 - 0.10]} />
              <meshStandardMaterial color={eaveCol} emissive={eaveCol} emissiveIntensity={eaveEmi} roughness={0.70} />
            </mesh>
            {/* Point lights at eave corners for volumetric glow */}
            {eaveLI > 0 && ([
              [ W / 2 + OV5 * 0.60, eaveY, -D / 2 - OV_S5 * 0.60],
              [-W / 2 - OV5 * 0.60, eaveY, -D / 2 - OV_S5 * 0.60],
              [ W / 2 + OV5 * 0.60, eaveY,  D / 2 + OV5 * 0.60],
              [-W / 2 - OV5 * 0.60, eaveY,  D / 2 + OV5 * 0.60],
            ] as [number,number,number][]).map(([lx, ly, lz], li) => (
              <pointLight key={li} position={[lx, ly, lz]} intensity={eaveLI * 0.35} distance={W * 0.8} decay={2.0} color="#FFE4B0" castShadow={false} />
            ))}
          </group>
        );
      })()}

      {!insideBuilding && <FlatRoof W={W} D={D} roofY={totalH} nightGlow={interiorGlowWall > 1.20 ? 1.0 : interiorGlowWall > 0.92 ? 0.5 : 0} />}

      {/* ── 5a-conservatory. 北侧温室 / 冬季花园（glass conservatory, north facade）──
           A Victorian-style steel-and-glass conservatory attached to the north wall.
           Width = W × 0.38, depth = 2.4m, height = 3.2m at ridge.
           Dark anodized steel frame + laminated glass panels.
           At night: warm amber glow from interior plants / lighting. */}
      {!insideBuilding && isGlassVilla && (() => {
        const cW2 = Math.min(W * 0.38, 5.0);   // conservatory width
        const cD2 = 2.40;                        // depth (north from building wall)
        const cH2 = 2.80;                        // wall height (eave)
        const cRH = 0.70;                        // ridge height above eave
        const cX2 = 0;                           // centred
        const cZ2 = D / 2 + cD2 / 2;            // centre Z (north of building)
        const cY2 = 0;                           // ground level
        const frameCol = "#1E2028";
        const glassCol2 = "#B0D4E0";
        const glowI = interiorGlowCeil * 0.8;
        const glowLI = interiorGlowWall > 0.5 ? 2.5 : 0.0;
        return (
          <group position={[cX2, cY2, cZ2]}>
            {/* Floor slab — dark slate */}
            <mesh position={[0, 0.020, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[cW2, cD2]} />
              <meshStandardMaterial color="#282C34" roughness={0.52} metalness={0.12} />
            </mesh>
            {/* 4 corner columns */}
            {([[-cW2/2, -cD2/2], [cW2/2, -cD2/2], [-cW2/2, cD2/2], [cW2/2, cD2/2]] as [number,number][]).map(([cx2, cz2], ci) => (
              <mesh key={ci} position={[cx2, cH2 / 2, cz2]} castShadow>
                <boxGeometry args={[0.045, cH2, 0.045]} />
                <meshStandardMaterial color={frameCol} roughness={0.22} metalness={0.88} envMapIntensity={2.0} />
              </mesh>
            ))}
            {/* Intermediate mullion columns — east/west walls */}
            {([[-cW2/2, 0], [cW2/2, 0]] as [number,number][]).map(([mx, mz], mi) => (
              <mesh key={`mid-${mi}`} position={[mx, cH2 / 2, mz]} castShadow>
                <boxGeometry args={[0.035, cH2, 0.035]} />
                <meshStandardMaterial color={frameCol} roughness={0.22} metalness={0.88} />
              </mesh>
            ))}
            {/* Eave rail — perimeter horizontal frame at top of walls */}
            {[
              [0, cH2, -cD2/2, cW2 + 0.05, 0.040, 0.040],
              [0, cH2,  cD2/2, cW2 + 0.05, 0.040, 0.040],
              [-cW2/2, cH2, 0, 0.040, 0.040, cD2],
              [ cW2/2, cH2, 0, 0.040, 0.040, cD2],
            ].map(([ex, ey, ez, ew, eh, ed], ei) => (
              <mesh key={`eave-${ei}`} position={[ex, ey, ez]}>
                <boxGeometry args={[ew, eh, ed]} />
                <meshStandardMaterial color={frameCol} roughness={0.22} metalness={0.88} />
              </mesh>
            ))}
            {/* Ridge beam */}
            <mesh position={[0, cH2 + cRH, 0]}>
              <boxGeometry args={[cW2 + 0.05, 0.040, 0.040]} />
              <meshStandardMaterial color={frameCol} roughness={0.22} metalness={0.88} />
            </mesh>
            {/* Glass side panels — north and south eave walls */}
            {([-cD2/2, cD2/2] as number[]).map((gz2, gi) => (
              <mesh key={gi} position={[0, cH2 / 2, gz2]}>
                <boxGeometry args={[cW2 - 0.05, cH2, 0.010]} />
                <meshStandardMaterial
                  color={glassCol2} transparent opacity={0.45}
                  roughness={0.04} metalness={0.08}
                  emissive="#60C0D8" emissiveIntensity={glowI * 0.3}
                  envMapIntensity={4.0}
                  side={THREE.DoubleSide}
                />
              </mesh>
            ))}
            {/* Glass east/west side walls */}
            {([-cW2/2, cW2/2] as number[]).map((gx2, gi) => (
              <mesh key={`ew-${gi}`} position={[gx2, cH2 / 2, 0]}>
                <boxGeometry args={[0.010, cH2, cD2 - 0.05]} />
                <meshStandardMaterial
                  color={glassCol2} transparent opacity={0.45}
                  roughness={0.04} metalness={0.08}
                  emissive="#60C0D8" emissiveIntensity={glowI * 0.3}
                  envMapIntensity={4.0}
                  side={THREE.DoubleSide}
                />
              </mesh>
            ))}
            {/* Pitched glass roof — two lean-to panels */}
            {([-1, 1] as number[]).map((side, si) => {
              const rx = side * cW2 / 4;
              const rz = 0;
              const tiltAngle = side * Math.atan2(cRH, cW2 / 2);
              return (
                <mesh key={si} position={[rx, cH2 + cRH / 2, 0]} rotation={[0, 0, tiltAngle]}>
                  <boxGeometry args={[cW2 / 2, Math.sqrt(cRH * cRH + (cW2 / 2) * (cW2 / 2)) + 0.01, cD2 - 0.05]} />
                  <meshStandardMaterial
                    color="#A8CCE0"
                    transparent opacity={0.40}
                    roughness={0.03} metalness={0.10}
                    emissive="#80D0E8" emissiveIntensity={glowI * 0.2}
                    envMapIntensity={5.0}
                    side={THREE.DoubleSide}
                  />
                </mesh>
              );
            })}
            {/* Interior plants — visible through glass */}
            {Array.from({ length: 6 }, (_, pi) => {
              const px3 = -cW2 * 0.35 + pi * (cW2 * 0.70 / 5);
              const pType = pi % 3;
              const pHash2 = (pi * 11 + 7) % 13;
              if (pType === 0) {
                return (
                  <group key={pi} position={[px3, 0, cD2 * 0.10]}>
                    <mesh position={[0, 0.40, 0]} castShadow>
                      <cylinderGeometry args={[0.06, 0.08, 0.40, 8]} />
                      <meshStandardMaterial color="#2A1808" roughness={0.88} />
                    </mesh>
                    <mesh position={[0, 0.85, 0]}>
                      <sphereGeometry args={[0.28, 8, 6]} />
                      <meshStandardMaterial color={pHash2 % 2 === 0 ? "#2A6020" : "#1E5018"} roughness={0.96} />
                    </mesh>
                  </group>
                );
              } else if (pType === 1) {
                // Tall tropical plant
                return (
                  <mesh key={pi} position={[px3, 0.80, 0]} castShadow>
                    <cylinderGeometry args={[0.06, 0.10, 1.60, 6]} />
                    <meshStandardMaterial color="#2E6828" roughness={0.94} />
                  </mesh>
                );
              } else {
                // Low spreading plant
                return (
                  <mesh key={pi} position={[px3, 0.20, 0]} castShadow>
                    <sphereGeometry args={[0.24, 7, 5]} />
                    <meshStandardMaterial color="#3A7830" roughness={0.96} />
                  </mesh>
                );
              }
            })}
            {/* Interior grow light — warm amber */}
            {glowLI > 0 && (
              <pointLight position={[0, cH2 - 0.30, 0]} intensity={glowLI} distance={cW2 * 1.2} decay={2.0} color="#FFE890" castShadow={false} />
            )}
          </group>
        );
      })()}

      {/* ── 5b. 建筑立面泛光灯（夜间效果）——根据 sunHour 自动调强度 ──
               夜间：墙面泛光灯打亮外立面，池边及入口处暖光渗出。
               白天：不发光，完全隐藏。 */}
      {!insideBuilding && (() => {
        // Intensity curve: 0 during full day, ramps up at dusk/dawn, max at night
        const isNight  = sunHour < 6 || sunHour > 20;
        const isDusk   = (!isNight) && (sunHour < 8 || sunHour > 18);
        const uplightI = isNight ? 12 : isDusk ? 6 : 0;
        if (uplightI === 0) return null;
        const uplightColor = "#FFF4D8";
        // Ground-level uplights: 4 along south facade, 2 per side
        const uplightPositions: Array<[number, number, number]> = [
          [-W * 0.35, -0.20, D / 2 + 0.60],
          [-W * 0.12, -0.20, D / 2 + 0.60],
          [ W * 0.12, -0.20, D / 2 + 0.60],
          [ W * 0.35, -0.20, D / 2 + 0.60],
          [-W / 2 - 0.60, -0.20, 0],
          [ W / 2 + 0.60, -0.20, 0],
        ];
        return (
          <group>
            {uplightPositions.map(([ux, uy, uz], ui) => (
              <group key={ui} position={[ux, uy, uz]}>
                {/* In-ground fixture cap — small dark circle */}
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[0.05, 10]} />
                  <meshStandardMaterial color="#2A2A2A" roughness={0.5} metalness={0.6} />
                </mesh>
                {/* Warm upward beam (point light) */}
                <pointLight
                  intensity={uplightI}
                  distance={totalH * 1.6 + 2}
                  decay={1.4}
                  color={uplightColor}
                  castShadow={false}
                />
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 5b-2. 场地草坪面层 + 主入口花岗岩大道（lawn surface + main granite path）──
           A rich green lawn plane fills the site inside boundary walls.
           The central entry/driveway axis uses dark granite slabs. */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndS5   = -D / 2 - 14.50;
        const bndN5   =  D / 2 + 3.20;
        const bndE5   =  W / 2 + 4.50;
        const bndW5   = -W / 2 - 4.50;
        const wallT5  = 0.18;
        // Lawn fills inside boundary minus wall thickness
        const lawnW   = bndE5 - bndW5 - wallT5 * 2;
        const lawnD   = bndN5 - bndS5 - wallT5 * 2;
        const lawnMidZ = (bndN5 + bndS5) / 2;

        // Driveway / main path: 5.4m wide along centre axis
        const driveW5 = 5.40;
        const driveZ1 = bndS5 + wallT5 + 0.05;
        const driveZ2 = -D / 2 - 0.15;   // south face of building
        const driveLen = driveZ2 - driveZ1;
        const driveMidZ = (driveZ1 + driveZ2) / 2;

        return (
          <group>
            {/* Lawn surface — two toned segments for visual richness */}
            {/* South section (south of building) */}
            <mesh position={[0, 0.001, lawnMidZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[lawnW, lawnD]} />
              <meshStandardMaterial color="#3A6A28" roughness={0.95} metalness={0.00} />
            </mesh>
            {/* Lawn stripe pattern (slightly lighter bands for mow lines) */}
            {Array.from({ length: Math.round(lawnD / 1.20) }, (_, li) => {
              if (li % 2 === 0) return null;  // alternate stripes only
              const sz = bndS5 + wallT5 + (li + 0.5) * 1.20;
              return (
                <mesh key={`stripe-${li}`} position={[0, 0.002, sz]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[lawnW, 1.18]} />
                  <meshStandardMaterial color="#426E2E" roughness={0.95} metalness={0.00} />
                </mesh>
              );
            })}
            {/* Main entry path — polished dark granite slabs */}
            <mesh position={[0, 0.015, driveMidZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[driveW5, Math.abs(driveLen)]} />
              <meshStandardMaterial color="#282C34" roughness={0.28} metalness={0.18} envMapIntensity={1.5} />
            </mesh>
            {/* Path joint lines — transverse granite joints every 0.65m */}
            {Array.from({ length: Math.round(Math.abs(driveLen) / 0.65) - 1 }, (_, ji) => {
              const jz = driveZ1 + (ji + 1) * 0.65;
              return (
                <mesh key={`pj-${ji}`} position={[0, 0.018, jz]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[driveW5, 0.010]} />
                  <meshStandardMaterial color="#1A1E26" roughness={0.40} metalness={0.10} />
                </mesh>
              );
            })}
            {/* Path longitudinal joints (4 evenly spaced) */}
            {([-driveW5 * 0.28, -driveW5 * 0.07, driveW5 * 0.07, driveW5 * 0.28] as number[]).map((jx5, ji) => (
              <mesh key={`lj-${ji}`} position={[jx5, 0.018, driveMidZ]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.010, Math.abs(driveLen)]} />
                <meshStandardMaterial color="#1A1E26" roughness={0.40} metalness={0.10} />
              </mesh>
            ))}
            {/* Lawn edging — thin dark granite border strips along path edges */}
            {([-driveW5 / 2 - 0.04, driveW5 / 2 + 0.04] as number[]).map((ex5, ei) => (
              <mesh key={`edge-${ei}`} position={[ex5, 0.016, driveMidZ]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.08, Math.abs(driveLen) + 0.10]} />
                <meshStandardMaterial color="#1E2028" roughness={0.32} metalness={0.22} envMapIntensity={1.2} />
              </mesh>
            ))}
            {/* Lawn colour in north yard (lighter / different shade) */}
            <mesh position={[0, 0.003, D / 2 + 1.60]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[lawnW * 0.80, bndN5 - D / 2 - wallT5 * 2 - 0.20]} />
              <meshStandardMaterial color="#3E7030" roughness={0.94} metalness={0.00} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5b-3. 建筑南侧石板过渡露台（transition terrace between building & pool deck）──
           0.80m stone apron connecting the building south face to the pool deck.
           Same travertine as pool deck, slightly wider than building footprint.
           Small riser step at pool deck level (+0.12m) visible from south. */}
      {!insideBuilding && isGlassVilla && (() => {
        const deckBW3 = 2.80;
        const deckT3  = 0.12;
        const poolL3  = Math.min(D * 0.70, 9.50);
        const poolW3  = Math.min(W * 0.78, 11.0);
        const pz3     = -D / 2 - deckBW3 - poolL3 / 2 - 0.80;
        const deckEdgeN3 = pz3 + poolL3 / 2 + deckBW3;   // building-side edge of pool deck
        // Gap from deckEdgeN3 to building face: deckEdgeN3 = -D/2 - 0.80, bldgFace = -D/2
        const terraceZ1 = -D / 2;          // building south face
        const terraceZ2 = deckEdgeN3;      // pool deck north edge
        const terraceLen = Math.abs(terraceZ1 - terraceZ2);  // ≈ 0.80m
        const terraceCZ  = (terraceZ1 + terraceZ2) / 2;
        const terraceW   = poolW3 + deckBW3 * 2;  // same as pool deck width
        return (
          <group>
            {/* Stone apron slab — same travertine as pool deck */}
            <mesh position={[0, deckT3 / 2, terraceCZ]} receiveShadow>
              <boxGeometry args={[terraceW, deckT3, terraceLen]} />
              <meshStandardMaterial color="#D6CEBC" roughness={0.68} metalness={0.04} envMapIntensity={0.5} />
            </mesh>
            {/* Step riser (south face of step up from ground to deck level) */}
            <mesh position={[0, deckT3 / 4, deckEdgeN3]}>
              <boxGeometry args={[terraceW, deckT3 / 2, 0.025]} />
              <meshStandardMaterial color="#C8C0B0" roughness={0.72} metalness={0.04} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5b-4. 建筑南立面地面上照灯（in-ground uplight strip, south facade）──
           Row of 5 narrow-beam up-lights recessed into the transition terrace/lawn,
           aimed up at the building glass facade. Active from dusk onward.
           Warm-white 3000K spots, evenly spaced across the building width.
           Creates the dramatic "illuminated villa at night" look from the reference. */}
      {!insideBuilding && isGlassVilla && (() => {
        const isNightU = sunHour < 6 || sunHour > 20;
        const isDuskU  = !isNightU && (sunHour < 8 || sunHour > 18);
        const upLI     = isNightU ? 14.0 : isDuskU ? 7.0 : 0.0;
        if (upLI === 0.0) return null;
        const upZ = -D / 2 - 0.50;   // 0.5m south of building face (in transition terrace)
        const count = 5;
        return (
          <group>
            {Array.from({ length: count }, (_, ui) => {
              const ux = -W * 0.38 + ui * (W * 0.76 / (count - 1));
              return (
                <group key={ui} position={[ux, 0, upZ]}>
                  {/* Recessed housing — flush dark disc */}
                  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
                    <cylinderGeometry args={[0.058, 0.060, 0.018, 8]} />
                    <meshStandardMaterial color="#1A1C20" roughness={0.40} metalness={0.75} />
                  </mesh>
                  {/* LED emitter face */}
                  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]}>
                    <circleGeometry args={[0.038, 8]} />
                    <meshStandardMaterial color="#FFF8E8" emissive="#FFF0D0" emissiveIntensity={isNightU ? 4.0 : 2.0} roughness={0.60} />
                  </mesh>
                  {/* Narrow up-beam spotlight — strongly directional, hits building face */}
                  <spotLight
                    position={[0, 0.02, 0]}
                    target-position={[ux, totalH * 0.60, -D / 2]}
                    intensity={upLI}
                    distance={totalH * 2.0}
                    angle={Math.PI / 10}
                    penumbra={0.35}
                    decay={1.6}
                    color="#FFE8C8"
                    castShadow={false}
                  />
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5c. 游泳池（outdoor swimming pool, south yard）──
           Large rectangular pool with wide travertine deck matching the
           reference image: pool is the primary outdoor focal point.
           Dimensions: up to 11m wide × 9m long, 2.8m deck on building side. */}
      {!insideBuilding && isGlassVilla && (() => {
        const poolW  = Math.min(W * 0.78, 11.0);   // pool width E-W (wider = more impressive)
        const poolL  = Math.min(D * 0.70, 9.50);   // pool length N-S (proportional to building)
        const poolDp = 0.55;                         // pool depth below grade
        const deckBW = 2.80;                         // generous travertine deck on all sides
        const deckT  = 0.12;                         // deck slab thickness
        const pz     = -D / 2 - deckBW - poolL / 2 - 0.80;  // south yard, deck flush with building steps
        const isNightP = sunHour < 6 || sunHour > 20;
        const isDuskP  = !isNightP && (sunHour < 8 || sunHour > 18);
        const poolGlowI = isNightP ? 2.8 : isDuskP ? 1.2 : 0.12;
        // Travertine / limestone colours
        const deckBase  = "#D6CEBC";   // warm limestone base
        const deckLight = "#E0D8C8";   // slightly lighter alternate tile tone
        const groutC    = "#B8B0A0";   // slightly darker grout lines
        const TILE_SIZE = 0.80;        // 80cm × 80cm large format tile
        return (
          <group position={[0, 0, pz]}>
            {/* ── Continuous stone plaza base (deck + pool surround) ── */}
            <mesh position={[0, deckT / 2, 0]} receiveShadow>
              <boxGeometry args={[poolW + deckBW * 2, deckT, poolL + deckBW * 2]} />
              <meshStandardMaterial color={deckBase} roughness={0.68} metalness={0.04} envMapIntensity={0.5} />
            </mesh>
            {/* Large-format tile grid — E-W grout lines */}
            {Array.from({ length: Math.ceil((poolL + deckBW * 2) / TILE_SIZE) + 1 }, (_, gi) => {
              const gz = -(poolL / 2 + deckBW) + gi * TILE_SIZE;
              return (
                <mesh key={`gl-${gi}`} position={[0, deckT + 0.002, gz]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[poolW + deckBW * 2 - 0.02, 0.016]} />
                  <meshStandardMaterial color={groutC} roughness={0.85} />
                </mesh>
              );
            })}
            {/* Large-format tile grid — N-S grout lines */}
            {Array.from({ length: Math.ceil((poolW + deckBW * 2) / TILE_SIZE) + 1 }, (_, gi) => {
              const gx = -(poolW / 2 + deckBW) + gi * TILE_SIZE;
              return (
                <mesh key={`gt-${gi}`} position={[gx, deckT + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[0.016, poolL + deckBW * 2 - 0.02]} />
                  <meshStandardMaterial color={groutC} roughness={0.85} />
                </mesh>
              );
            })}
            {/* Pool coping — raised stone lip around pool perimeter */}
            {([
              [0,                     -(poolL / 2 + 0.06), poolW + 0.28, 0.12],
              [0,                      (poolL / 2 + 0.06), poolW + 0.28, 0.12],
              [-(poolW / 2 + 0.06),    0,                  0.12,         poolL + 0.12],
              [ (poolW / 2 + 0.06),    0,                  0.12,         poolL + 0.12],
            ] as [number, number, number, number][]).map(([dx, dz, cw, cd], ci) => (
              <mesh key={`cop-${ci}`} position={[dx, deckT + 0.035, dz]} castShadow receiveShadow>
                <boxGeometry args={[cw, 0.068, cd]} />
                <meshStandardMaterial color={deckLight} roughness={0.60} metalness={0.06} envMapIntensity={0.7} />
              </mesh>
            ))}
            {/* Wet reflection band — polished travertine ring surrounding pool (0.35m wide).
                 Simulates the perpetually wet/damp stone that forms around any pool.
                 High envMapIntensity + low roughness = strong reflective sheen.
                 Four planes: N / S / E / W edges of deck, just outside pool coping. */}
            {([
              [0,               -(poolL / 2 + 0.19),  poolW + 0.44, 0.36],
              [0,                (poolL / 2 + 0.19),  poolW + 0.44, 0.36],
              [-(poolW / 2 + 0.19), 0,  0.36, poolL + 0.44],
              [ (poolW / 2 + 0.19), 0,  0.36, poolL + 0.44],
            ] as [number,number,number,number][]).map(([dx, dz, rw, rd], ri) => (
              <mesh key={`wet-${ri}`} position={[dx, deckT + 0.001, dz]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
                <planeGeometry args={[rw, rd]} />
                <meshPhysicalMaterial
                  color="#C8C0B0"
                  transparent opacity={0.75}
                  roughness={0.08}
                  metalness={0.02}
                  reflectivity={0.65}
                  clearcoat={0.90}
                  clearcoatRoughness={0.06}
                  envMapIntensity={4.5}
                  depthWrite={false}
                />
              </mesh>
            ))}

            {/* Pool shell — dark blue-grey rendered concrete */}
            <mesh position={[0, -poolDp / 2 - deckT, 0]} receiveShadow>
              <boxGeometry args={[poolW, poolDp + deckT * 2, poolL]} />
              <meshStandardMaterial color="#2E3440" roughness={0.65} metalness={0.08} />
            </mesh>
            {/* Pool interior — vivid azure/turquoise tile (matches reference vivid blue pool) */}
            <mesh position={[0, -poolDp / 2, 0]}>
              <boxGeometry args={[poolW, poolDp - 0.02, poolL]} />
              <meshStandardMaterial
                color="#0878A8"
                emissive="#065A88"
                emissiveIntensity={Math.max(0.20, poolGlowI)}
                roughness={0.22}
                metalness={0.15}
                envMapIntensity={3.5}
              />
            </mesh>
            {/* Water surface — vivid turquoise-cyan, ultra-clear and highly reflective */}
            <mesh position={[0, 0.010, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
              <planeGeometry args={[poolW - 0.04, poolL - 0.04]} />
              <meshPhysicalMaterial
                color="#18C8E0"
                transparent opacity={0.87}
                depthWrite={false}
                roughness={0.012}
                metalness={0.04}
                reflectivity={0.80}
                clearcoat={0.99}
                clearcoatRoughness={0.010}
                envMapIntensity={7.0}
                emissive="#0898B8"
                emissiveIntensity={Math.max(0.10, poolGlowI * 0.55)}
                side={THREE.DoubleSide}
                {...overlayMaterialProps(2)}
              />
            </mesh>
            {/* Underwater night glow */}
            {isNightP && (
              <pointLight position={[0, -0.20, 0]} intensity={poolGlowI * 3.0} distance={poolW * 1.4} decay={1.6} color="#40C0F0" castShadow={false} />
            )}
            {/* ── Premium infinity overflow edge — enhanced detail ──
                Black knife-edge blade, overflow gutter with water surface,
                visible waterfall curtain cascading down the outer face,
                catch basin at grade level with underwater LED.  */}

            {/* Knife-edge overflow blade — polished black steel, very sharp */}
            <mesh position={[0, -0.006, poolL / 2 + 0.008]}>
              <boxGeometry args={[poolW + 0.04, 0.020, 0.022]} />
              <meshStandardMaterial color="#0E1218" roughness={0.08} metalness={0.92} envMapIntensity={3.5} />
            </mesh>
            {/* Overflow channel floor — dark concrete, ~0.20m behind blade */}
            <mesh position={[0, -0.048, poolL / 2 + 0.13]}>
              <boxGeometry args={[poolW + 0.06, 0.012, 0.24]} />
              <meshStandardMaterial color="#22262E" roughness={0.55} metalness={0.25} />
            </mesh>
            {/* Overflow gutter water surface — narrow cyan slot */}
            <mesh position={[0, -0.032, poolL / 2 + 0.13]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={12}>
              <planeGeometry args={[poolW - 0.04, 0.22]} />
              <meshStandardMaterial
                color="#50B8D8" transparent opacity={0.82}
                roughness={0.01} metalness={0.08}
                envMapIntensity={6.0}
                emissive="#2898B8" emissiveIntensity={poolGlowI * 0.8}
                depthWrite={false}
              />
            </mesh>
            {/* Gutter outer wall — hidden concrete retaining wall */}
            <mesh position={[0, -0.060, poolL / 2 + 0.255]}>
              <boxGeometry args={[poolW + 0.06, 0.16, 0.035]} />
              <meshStandardMaterial color="#282C32" roughness={0.60} metalness={0.20} />
            </mesh>
            {/* Waterfall curtain — full-width translucent sheet cascading down outer face of blade */}
            <mesh position={[0, -poolDp / 2 - 0.012, poolL / 2 + 0.023]} renderOrder={13}>
              <planeGeometry args={[poolW, poolDp + 0.02]} />
              <meshStandardMaterial
                color="#90D0E8"
                transparent opacity={0.44}
                roughness={0.02} metalness={0.04}
                emissive="#60B8D8" emissiveIntensity={poolGlowI * 0.65}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            {/* Waterfall shimmer layer — slightly offset for depth */}
            <mesh position={[0, -poolDp / 2 - 0.018, poolL / 2 + 0.030]} renderOrder={14}>
              <planeGeometry args={[poolW - 0.20, poolDp * 0.70]} />
              <meshStandardMaterial
                color="#C0E4F0"
                transparent opacity={0.22}
                roughness={0.01}
                emissive="#80C8E0" emissiveIntensity={poolGlowI * 0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            {/* Catch basin at grade — long trough below waterfall */}
            <mesh position={[0, -poolDp - deckT - 0.02, poolL / 2 + 0.13]}>
              <boxGeometry args={[poolW + 0.04, 0.04, 0.30]} />
              <meshStandardMaterial color="#1A1E24" roughness={0.40} metalness={0.40} envMapIntensity={2.0} />
            </mesh>
            {/* Catch basin water surface */}
            <mesh position={[0, -poolDp - deckT + 0.008, poolL / 2 + 0.13]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={12}>
              <planeGeometry args={[poolW - 0.02, 0.26]} />
              <meshStandardMaterial
                color="#3898B8" transparent opacity={0.78}
                roughness={0.01} metalness={0.10}
                envMapIntensity={7.0}
                emissive="#1878A0" emissiveIntensity={poolGlowI}
                depthWrite={false}
              />
            </mesh>
            {/* Catch basin LED (night) */}
            {poolGlowI > 0.5 && (
              <pointLight
                position={[0, -poolDp - deckT + 0.02, poolL / 2 + 0.13]}
                intensity={poolGlowI * 1.8}
                distance={poolW * 0.7}
                decay={2}
                color="#20A8D8"
              />
            )}
            {/* Pool lane markings — 2 dark blue lane lines on pool floor */}
            {Array.from({ length: 2 }, (_, li) => {
              const lx = -poolW * 0.22 + li * poolW * 0.44;
              return (
                <mesh key={`lane-${li}`} position={[lx, -poolDp + 0.012, 0]}>
                  <boxGeometry args={[0.025, 0.010, poolL - 0.10]} />
                  <meshStandardMaterial color="#1A3060" roughness={0.55} metalness={0.05} emissive="#101840" emissiveIntensity={0.4} />
                </mesh>
              );
            })}
            {/* Cross-lane T-marks at both ends */}
            {([-poolL / 2 + 0.80, poolL / 2 - 0.80] as number[]).flatMap((tz, ti) =>
              Array.from({ length: 2 }, (_, li) => {
                const lx = -poolW * 0.22 + li * poolW * 0.44;
                return (
                  <mesh key={`cross-${ti}-${li}`} position={[lx, -poolDp + 0.012, tz]}>
                    <boxGeometry args={[0.25, 0.010, 0.025]} />
                    <meshStandardMaterial color="#1A3060" roughness={0.55} metalness={0.05} />
                  </mesh>
                );
              })
            )}
            {/* Pool deck pop-up jets — 3 small arcing jets from north deck edge */}
            {Array.from({ length: 3 }, (_, ji) => {
              const jx = -poolW * 0.22 + ji * poolW * 0.22;   // evenly spaced
              const jetAngle = -0.52;  // radians, angled toward pool centre
              return (
                <group key={`jet-${ji}`} position={[jx, 0.005, -poolL / 2 - 0.12]}>
                  {/* Nozzle housing — flush dark disc */}
                  <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[0.038, 0.040, 0.018, 8]} />
                    <meshStandardMaterial color="#282C34" roughness={0.38} metalness={0.75} />
                  </mesh>
                  {/* Water arc — angled cylinder representing jet stream */}
                  <mesh position={[0, 0.18, 0.28]} rotation={[jetAngle, 0, 0]}>
                    <cylinderGeometry args={[0.014, 0.022, 0.60, 6]} />
                    <meshStandardMaterial
                      color="#80CCE8"
                      transparent opacity={0.72}
                      roughness={0.05} metalness={0.05}
                      emissive="#40B0D8" emissiveIntensity={poolGlowI * 0.55}
                    />
                  </mesh>
                  {/* Splash sphere at landing point */}
                  <mesh position={[0, 0.02, 0.68]}>
                    <sphereGeometry args={[0.045, 8, 6]} />
                    <meshStandardMaterial
                      color="#90D8F0"
                      transparent opacity={0.55}
                      roughness={0.05}
                      emissive="#60C0E0" emissiveIntensity={poolGlowI * 0.4}
                    />
                  </mesh>
                </group>
              );
            })}
            {/* Pool ladder — south-east corner, chrome steel */}
            <group position={[poolW / 2 - 0.32, 0, poolL / 2 - 0.24]}>
              {([-0.20, 0.20] as number[]).map((hx, hi) => (
                <mesh key={hi} position={[hx, -poolDp / 2, 0]}>
                  <cylinderGeometry args={[0.014, 0.014, poolDp + 0.04, 6]} />
                  <meshStandardMaterial color="#C4CCD4" roughness={0.18} metalness={0.90} />
                </mesh>
              ))}
              {[-0.14, -0.28, -0.42].map((ry, ri) => (
                <mesh key={ri} position={[0, ry, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.011, 0.011, 0.38, 6]} />
                  <meshStandardMaterial color="#B8C2CA" roughness={0.20} metalness={0.88} />
                </mesh>
              ))}
            </group>

            {/* ── Pool entry steps — NW corner, 3 wide travertine steps ──
                 Descend from deck level (y=deckT) down to poolDp in 3 equal risers.
                 Solid stone blocks: visible from above (top step) and when swimming in. */}
            {Array.from({ length: 3 }, (_, si) => {
              const stepW  = 1.60;   // E-W width of each step
              const stepD  = 0.36;   // N-S tread depth of each step
              const riseH  = (deckT + poolDp) / 3;   // ≈ 0.22m per step
              const stepsX = -poolW / 2 + stepW / 2;  // NW corner
              const blockH = (deckT + poolDp) - si * riseH;  // solid height from pool floor
              const yCtr   = -poolDp + blockH / 2;
              const zCtr   = -poolL / 2 + (si + 0.5) * stepD;
              return (
                <mesh key={`es-${si}`} position={[stepsX, yCtr, zCtr]} castShadow>
                  <boxGeometry args={[stepW, blockH, stepD]} />
                  <meshStandardMaterial color={deckLight} roughness={0.62} metalness={0.06} envMapIntensity={0.6} />
                </mesh>
              );
            })}

            {/* ── LED underwater coping strip lights (dusk/night only) ──
                 Thin emissive planes just below waterline on all four inner pool walls.
                 Creates the signature "glowing pool edge" look of luxury night pools.
                 4 strips × 2 sides: north/south horizontal + east/west vertical faces. */}
            {(isDuskP || isNightP) && (() => {
              const stripH = 0.040;  // 4cm tall LED strip
              const glowI  = isNightP ? 1.20 : 0.60;
              const yLED   = -0.040; // just below waterline
              return (
                <>
                  {/* North inner wall strip (building side) */}
                  <mesh position={[0, yLED, -poolL / 2 + 0.006]} rotation={[Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[poolW - 0.02, stripH]} />
                    <meshStandardMaterial color="#80E4FF" emissive="#40C8F8" emissiveIntensity={glowI} transparent opacity={0.95} depthWrite={false} />
                  </mesh>
                  {/* South inner wall strip (infinity edge side) */}
                  <mesh position={[0, yLED, poolL / 2 - 0.006]} rotation={[-Math.PI / 2, 0, 0]}>
                    <planeGeometry args={[poolW - 0.02, stripH]} />
                    <meshStandardMaterial color="#80E4FF" emissive="#40C8F8" emissiveIntensity={glowI} transparent opacity={0.95} depthWrite={false} />
                  </mesh>
                  {/* East inner wall strip */}
                  <mesh position={[poolW / 2 - 0.006, yLED, 0]} rotation={[Math.PI / 2, -Math.PI / 2, 0]}>
                    <planeGeometry args={[poolL - 0.02, stripH]} />
                    <meshStandardMaterial color="#80E4FF" emissive="#40C8F8" emissiveIntensity={glowI} transparent opacity={0.95} depthWrite={false} />
                  </mesh>
                  {/* West inner wall strip */}
                  <mesh position={[-poolW / 2 + 0.006, yLED, 0]} rotation={[Math.PI / 2, Math.PI / 2, 0]}>
                    <planeGeometry args={[poolL - 0.02, stripH]} />
                    <meshStandardMaterial color="#80E4FF" emissive="#40C8F8" emissiveIntensity={glowI} transparent opacity={0.95} depthWrite={false} />
                  </mesh>
                  {/* Corner point-light accents — 4 corners */}
                  {([[-1,-1],[-1,1],[1,-1],[1,1]] as [number,number][]).map(([sx, sz], ci) => (
                    <pointLight
                      key={`cl-${ci}`}
                      position={[sx * poolW * 0.42, yLED, sz * poolL * 0.42]}
                      intensity={glowI * 0.8}
                      distance={3.5}
                      decay={2.0}
                      color="#50D0FF"
                      castShadow={false}
                    />
                  ))}
                </>
              );
            })()}

            {/* ── Animated underwater caustics (day + dusk: sun refraction; night: LED shimmer) ── */}
            <AnimatedPoolCaustics
              poolW={poolW} poolL={poolL} poolDp={poolDp} poolGlowI={poolGlowI > 0.1 ? poolGlowI : 0.15}
            />
          </group>
        );
      })()}

      {/* ── 5c-2d. 泳池两侧高柏树（tall cypress trees flanking pool deck）──
           6 tall slender Italian-cypress-style trees: 3 per side, placed at the
           east and west ends of the pool deck. Dark green columns frame the pool
           composition and echo the reference image silhouette. */}
      {!insideBuilding && isGlassVilla && (() => {
        const poolL_cy = Math.min(D * 0.70, 9.50);
        const poolW_cy = Math.min(W * 0.78, 11.0);
        const deckBW_cy = 2.80;
        const pz_cy = -D / 2 - deckBW_cy - poolL_cy / 2 - 0.80;
        // Cypress positions: 3 east (x > 0), 3 west (x < 0)
        // Evenly spaced along pool length, just outside deck edge
        const deckEdgeX = poolW_cy / 2 + deckBW_cy + 0.55;  // just beyond deck E edge
        const cypressPositions: Array<[number, number]> = [
          [ deckEdgeX, pz_cy - poolL_cy * 0.35],
          [ deckEdgeX, pz_cy],
          [ deckEdgeX, pz_cy + poolL_cy * 0.30],
          [-deckEdgeX, pz_cy - poolL_cy * 0.35],
          [-deckEdgeX, pz_cy],
          [-deckEdgeX, pz_cy + poolL_cy * 0.30],
        ];
        return (
          <group>
            {cypressPositions.map(([tx, tz], ti) => {
              const tHash = (ti * 7 + 3) % 5;
              const tH = 6.50 + tHash * 0.55;   // 6.5–9m tall
              const tR = 0.34 + tHash * 0.04;   // canopy radius at widest (≈ 0.38–0.50m)
              const tSegments = 8;
              return (
                <group key={ti} position={[tx, 0, tz]}>
                  {/* Trunk — very slender dark brown */}
                  <mesh position={[0, tH * 0.28, 0]} castShadow>
                    <cylinderGeometry args={[0.055, 0.075, tH * 0.56, 6]} />
                    <meshStandardMaterial color="#4A3018" roughness={0.88} metalness={0.01} />
                  </mesh>
                  {/* Canopy — tall cone representing dense columnar foliage */}
                  <mesh position={[0, tH * 0.62, 0]} castShadow>
                    <coneGeometry args={[tR, tH * 0.75, tSegments]} />
                    <meshStandardMaterial color="#1A4010" roughness={0.97} metalness={0.00} />
                  </mesh>
                  {/* Mid-section canopy — slightly wider for realistic silhouette */}
                  <mesh position={[0, tH * 0.42, 0]}>
                    <coneGeometry args={[tR * 1.10, tH * 0.40, tSegments]} />
                    <meshStandardMaterial color="#1E4814" roughness={0.97} metalness={0.00} />
                  </mesh>
                  {/* Base foliage skirt */}
                  <mesh position={[0, tH * 0.08, 0]}>
                    <coneGeometry args={[tR * 0.80, tH * 0.18, tSegments]} />
                    <meshStandardMaterial color="#162E0E" roughness={0.97} metalness={0.00} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5c-2e. 泳池南端热带棕榈（tropical phoenix palms at pool south end）──
           4 shorter phoenix/date palms flanking the infinity overflow edge.
           Placed just beyond deck edge on E and W, at the pool's south end.
           Adds resort/tropical character — visible in foreground from camera.
           Staggered heights 3.5–5.5m for natural look. */}
      {!insideBuilding && isGlassVilla && (() => {
        const poolL_tp  = Math.min(D * 0.70, 9.50);
        const poolW_tp  = Math.min(W * 0.78, 11.0);
        const deckBW_tp = 2.80;
        const pz_tp     = -D / 2 - deckBW_tp - poolL_tp / 2 - 0.80;
        const deckEdgeX_tp = poolW_tp / 2 + deckBW_tp + 0.60;  // just outside deck E edge
        const poolSZ = pz_tp - poolL_tp / 2 - deckBW_tp;       // south deck edge
        const palmData: Array<[number, number, number]> = [
          // [x, z, scale] — 2 east, 2 west
          [ deckEdgeX_tp + 0.40, poolSZ + 0.90, 1.00],
          [ deckEdgeX_tp + 0.90, poolSZ + 2.50, 0.85],
          [-(deckEdgeX_tp + 0.40), poolSZ + 0.90, 0.95],
          [-(deckEdgeX_tp + 0.90), poolSZ + 2.50, 0.90],
        ];
        return (
          <group>
            {palmData.map(([px, pz, scale], pi) => {
              const trunkH = (3.20 + pi * 0.45) * scale;
              const trunkCurve = pi % 2 === 0 ? 0.18 : -0.12;  // lean toward/away from pool
              const frondR = (1.40 + pi * 0.12) * scale;
              const frondY = trunkH * 0.92;
              const frondCount = 10;
              const pHash = (pi * 7 + 3) % 5;
              return (
                <group key={pi} position={[px, 0, pz]}>
                  {/* Curved trunk — 3 segments */}
                  {[0, 1, 2].map((seg) => (
                    <mesh
                      key={seg}
                      position={[
                        trunkCurve * seg * 0.15,
                        trunkH * (seg / 3 + 1 / 6),
                        0,
                      ]}
                      rotation={[0, 0, trunkCurve * 0.18]}
                      castShadow
                    >
                      <cylinderGeometry args={[
                        0.055 * scale * (1 - seg * 0.12),
                        0.075 * scale * (1 - seg * 0.08),
                        trunkH / 3,
                        6,
                      ]} />
                      <meshStandardMaterial
                        color={pHash % 2 === 0 ? "#6E4A28" : "#5A3C20"}
                        roughness={0.88} metalness={0.02}
                      />
                    </mesh>
                  ))}
                  {/* Frond crown — radial blades */}
                  {Array.from({ length: frondCount }, (_, fi) => {
                    const fa = (fi / frondCount) * Math.PI * 2;
                    const fDrop = -0.25 - Math.sin((fi / frondCount) * Math.PI) * 0.10;
                    return (
                      <mesh
                        key={fi}
                        position={[
                          Math.sin(fa) * frondR * 0.40,
                          frondY + fDrop * frondR * 0.50,
                          Math.cos(fa) * frondR * 0.40,
                        ]}
                        rotation={[fDrop, fa, 0]}
                        castShadow
                      >
                        <planeGeometry args={[frondR * 0.22, frondR]} />
                        <meshStandardMaterial
                          color={fi % 3 === 0 ? "#2A6A18" : fi % 3 === 1 ? "#226014" : "#1E5010"}
                          roughness={0.92} metalness={0.00}
                          side={THREE.DoubleSide}
                        />
                      </mesh>
                    );
                  })}
                  {/* Frond crown center cap — darker sphere */}
                  <mesh position={[trunkCurve * 0.30, frondY + 0.10 * scale, 0]}>
                    <sphereGeometry args={[frondR * 0.22, 7, 5]} />
                    <meshStandardMaterial color="#1C4810" roughness={0.95} metalness={0.00} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5c-3. 北院绿篱屏障（formal clipped hedge, north boundary inside）──
           Dense clipped yew/boxwood hedge 1.2m tall runs along inside of north wall,
           providing green backdrop behind the garden sculpture and fountain. */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndN3  =  D / 2 + 3.20;
        const bndE3  =  W / 2 + 4.50;
        const bndW3  = -W / 2 - 4.50;
        const wallT3 = 0.18;
        const hedgeH = 1.20;
        const hedgeD = 0.55;
        const hedgeY = hedgeH / 2;
        const hedgeZ = bndN3 - wallT3 - hedgeD / 2 - 0.06;
        const hedgeW = bndE3 - bndW3 - wallT3 * 2 - 0.20;
        return (
          <group>
            {/* Main hedge body — dark forest green */}
            <mesh position={[0, hedgeY, hedgeZ]} castShadow receiveShadow>
              <boxGeometry args={[hedgeW, hedgeH, hedgeD]} />
              <meshStandardMaterial color="#1E4A18" roughness={0.98} metalness={0.0} />
            </mesh>
            {/* Surface texture bumps — irregular lumps for clipped hedge look */}
            {Array.from({ length: 18 }, (_, hi) => {
              const hHash = (hi * 11 + 7) % 13;
              const hx = -hedgeW / 2 + 0.30 + hi * (hedgeW - 0.60) / 17;
              const hy = hedgeH * 0.72 + (hHash % 4) * 0.040;
              const hr = 0.22 + (hHash % 3) * 0.055;
              return (
                <mesh key={hi} position={[hx, hy, hedgeZ]} castShadow>
                  <sphereGeometry args={[hr, 7, 5]} />
                  <meshStandardMaterial color={hHash % 2 === 0 ? "#224E1C" : "#1A4014"} roughness={0.98} />
                </mesh>
              );
            })}
            {/* Hedge front face lighter green accent */}
            <mesh position={[0, hedgeY, hedgeZ - hedgeD / 2 - 0.002]} {...overlayMaterialProps(1)}>
              <boxGeometry args={[hedgeW, hedgeH, 0.008]} />
              <meshStandardMaterial color="#2A5820" roughness={0.97} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5c-4. 北庭院石凳（garden stone bench near fountain）──
           A simple white marble bench with dark metal legs, placed between
           the circular fountain and hedge for a reading / resting spot. */}
      {!insideBuilding && isGlassVilla && (
        <group position={[W * 0.18, 0, D / 2 + 1.80]}>
          {/* Seat slab — white marble */}
          <mesh position={[0, 0.44, 0]} castShadow>
            <boxGeometry args={[1.60, 0.080, 0.50]} />
            <meshStandardMaterial color="#EEEAE4" roughness={0.35} metalness={0.06} envMapIntensity={1.5} />
          </mesh>
          {/* 2 end supports */}
          {([-0.62, 0.62] as number[]).map((sx, si) => (
            <group key={si} position={[sx, 0, 0]}>
              <mesh position={[0, 0.21, 0]} castShadow>
                <boxGeometry args={[0.14, 0.42, 0.44]} />
                <meshStandardMaterial color="#2A2E38" roughness={0.32} metalness={0.68} envMapIntensity={1.4} />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {/* ── 5c-5. 东侧界墙爬藤三角梅（bougainvillea climbing east boundary wall）──
           Vivid magenta bracts cascade down the inner face of the east wall,
           created as overlapping sphere clusters at random heights.
           Adds organic warmth against the hard concrete wall. */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndE5 =  W / 2 + 4.50;
        const wallH5 = 0.88;
        const wallT5 = 0.18;
        const wallX5 = bndE5 - wallT5 / 2;  // inner face of east wall
        // Vine occupies middle 60% of the east wall length
        const vineLen = (D + 7.20) * 0.60;  // portion of east wall height covered
        const vineBottom = wallH5 * 0.20;
        return (
          <group>
            {Array.from({ length: 22 }, (_, vi) => {
              const vHash = (vi * 17 + 5) % 23;
              const vy = vineBottom + (vi / 21) * (vineLen);
              const vz = -D / 2 - 3.80 + (vHash % 11) * 0.55;
              const vx = wallX5 - wallT5 / 2 - 0.01 - (vHash % 4) * 0.080;
              const vr = 0.16 + (vHash % 4) * 0.055;
              // 75% magenta bougainvillea bracts, 25% green leaves
              const vCol = vHash % 4 === 0 ? "#2A6018" : vHash % 7 < 3 ? "#CC2060" : vHash % 7 < 5 ? "#E03070" : "#D04888";
              return (
                <mesh key={vi} position={[vx, vy, vz]}>
                  <sphereGeometry args={[vr, 7, 5]} />
                  <meshStandardMaterial color={vCol} roughness={0.95} />
                </mesh>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5d. 场地边界矮墙 + 入口大门 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndN   =  D / 2 + 3.20;    // north boundary Z
        const bndS   = -D / 2 - 14.50;   // south boundary Z (beyond pool)
        const bndE   =  W / 2 + 4.50;    // east boundary X
        const bndW   = -W / 2 - 4.50;    // west boundary X
        const wallH2 = 0.88;             // wall height
        const wallT2 = 0.18;             // wall thickness
        const wallY2 = wallH2 / 2;
        const wCol   = "#D8D4CC";        // rendered plaster / light concrete
        const capCol = "#484C58";        // dark aluminum cap flashing
        const gateW2 = Math.min(W * 0.30, 3.8);  // half-width of gate opening
        const gateX2 = 0;
        const pillarS = 0.28;            // pillar square cross-section
        const pillarH = wallH2 + 0.52;  // pillars taller than wall
        const isNightG = sunHour < 6 || sunHour > 20;
        const isDuskG  = !isNightG && (sunHour < 8 || sunHour > 18);
        const pillLI   = isNightG ? 3.0 : isDuskG ? 1.5 : 0.2;

        return (
          <group>
            {/* South wall — west half (gateX2 - gateW2 to bndW) */}
            <mesh position={[(bndW + gateX2 - gateW2) / 2, wallY2, bndS]} castShadow receiveShadow>
              <boxGeometry args={[Math.abs(bndW - (gateX2 - gateW2)), wallH2, wallT2]} />
              <meshStandardMaterial color={wCol} roughness={0.84} metalness={0.01} />
            </mesh>
            {/* South wall — east half (gateX2 + gateW2 to bndE) */}
            <mesh position={[(bndE + gateX2 + gateW2) / 2, wallY2, bndS]} castShadow receiveShadow>
              <boxGeometry args={[Math.abs(bndE - (gateX2 + gateW2)), wallH2, wallT2]} />
              <meshStandardMaterial color={wCol} roughness={0.84} metalness={0.01} />
            </mesh>
            {/* North wall */}
            <mesh position={[0, wallY2, bndN]} castShadow receiveShadow>
              <boxGeometry args={[bndE - bndW, wallH2, wallT2]} />
              <meshStandardMaterial color={wCol} roughness={0.84} metalness={0.01} />
            </mesh>
            {/* East wall */}
            <mesh position={[bndE, wallY2, (bndN + bndS) / 2]} castShadow receiveShadow>
              <boxGeometry args={[wallT2, wallH2, bndN - bndS]} />
              <meshStandardMaterial color={wCol} roughness={0.84} metalness={0.01} />
            </mesh>
            {/* West wall */}
            <mesh position={[bndW, wallY2, (bndN + bndS) / 2]} castShadow receiveShadow>
              <boxGeometry args={[wallT2, wallH2, bndN - bndS]} />
              <meshStandardMaterial color={wCol} roughness={0.84} metalness={0.01} />
            </mesh>
            {/* Cap flashing — south, north, east, west */}
            {([
              [(bndW + gateX2 - gateW2) / 2, bndS, Math.abs(bndW - (gateX2 - gateW2)), wallT2],
              [(bndE + gateX2 + gateW2) / 2, bndS, Math.abs(bndE - (gateX2 + gateW2)), wallT2],
              [0, bndN, bndE - bndW, wallT2],
              [bndE, (bndN + bndS) / 2, wallT2, bndN - bndS],
              [bndW, (bndN + bndS) / 2, wallT2, bndN - bndS],
            ] as [number, number, number, number][]).map(([cx3, cz3, cw3, cd3], ci) => (
              <mesh key={ci} position={[cx3, wallH2 + 0.006, cz3]}>
                <boxGeometry args={[cw3, 0.012, cd3 + 0.010]} />
                <meshStandardMaterial color={capCol} roughness={0.22} metalness={0.88} envMapIntensity={1.8} />
              </mesh>
            ))}
            {/* Intermediate wall pilasters — square piers every ~3.2m along E/W/N walls */}
            {(() => {
              const pilasterS  = 0.22;   // pilaster section (slightly smaller than gate pillars)
              const pilasterH  = wallH2 + 0.18;  // slightly taller than wall
              const pilasterCol = "#C8C4BC";
              const pStep = 3.20;  // spacing
              // East wall
              const eWallLen  = bndN - bndS;
              const eCount    = Math.max(1, Math.floor(eWallLen / pStep) - 1);
              const eStep     = eWallLen / (eCount + 1);
              // West wall (same count)
              const nWallLen  = bndE - bndW;
              const nCount    = Math.max(1, Math.floor(nWallLen / pStep) - 1);
              const nStep     = nWallLen / (nCount + 1);
              const pilasters: Array<[number, number, number]> = [];
              // East wall pilasters
              for (let i = 0; i < eCount; i++) {
                const pz = bndS + (i + 1) * eStep;
                pilasters.push([bndE, wallH2 / 2, pz]);
              }
              // West wall pilasters
              for (let i = 0; i < eCount; i++) {
                const pz = bndS + (i + 1) * eStep;
                pilasters.push([bndW, wallH2 / 2, pz]);
              }
              // North wall pilasters
              for (let i = 0; i < nCount; i++) {
                const px = bndW + (i + 1) * nStep;
                pilasters.push([px, wallH2 / 2, bndN]);
              }
              return (
                <group>
                  {pilasters.map(([ppx, ppy, ppz], pi) => (
                    <group key={pi} position={[ppx, 0, ppz]}>
                      {/* Pilaster body */}
                      <mesh position={[0, pilasterH / 2, 0]} castShadow>
                        <boxGeometry args={[pilasterS, pilasterH, pilasterS]} />
                        <meshStandardMaterial color={pilasterCol} roughness={0.80} metalness={0.02} />
                      </mesh>
                      {/* Pilaster cap — dark flashing */}
                      <mesh position={[0, pilasterH + 0.006, 0]}>
                        <boxGeometry args={[pilasterS + 0.025, 0.014, pilasterS + 0.025]} />
                        <meshStandardMaterial color={capCol} roughness={0.22} metalness={0.88} envMapIntensity={1.6} />
                      </mesh>
                    </group>
                  ))}
                </group>
              );
            })()}

            {/* Gate pillars — 2 at entry opening */}
            {([gateX2 - gateW2 - pillarS / 2, gateX2 + gateW2 + pillarS / 2] as number[]).map((gpx, gpi) => (
              <group key={gpi} position={[gpx, 0, bndS]}>
                <mesh position={[0, pillarH / 2, 0]} castShadow>
                  <boxGeometry args={[pillarS, pillarH, pillarS]} />
                  <meshStandardMaterial color="#C4C0B8" roughness={0.76} metalness={0.04} />
                </mesh>
                <mesh position={[0, pillarH + 0.007, 0]}>
                  <boxGeometry args={[pillarS + 0.04, 0.022, pillarS + 0.04]} />
                  <meshStandardMaterial color={capCol} roughness={0.20} metalness={0.90} envMapIntensity={2.2} />
                </mesh>
                {/* Pillar top lantern sphere */}
                <mesh position={[0, pillarH + 0.072, 0]}>
                  <sphereGeometry args={[0.065, 8, 6]} />
                  <meshStandardMaterial
                    color="#FFF8D8"
                    emissive="#FFDC70"
                    emissiveIntensity={pillLI}
                    roughness={0.28}
                  />
                </mesh>
                {isNightG && (
                  <pointLight position={[0, pillarH + 0.072, 0]} intensity={1.8} distance={4.0} decay={2.0} color="#FFE890" />
                )}
                {/* Address number plaque — on west-facing side of east pillar only */}
                {gpi === 1 && (
                  <group position={[-pillarS / 2 - 0.006, pillarH * 0.52, 0]}>
                    {/* Dark backplate */}
                    <mesh rotation={[0, Math.PI / 2, 0]}>
                      <boxGeometry args={[0.18, 0.10, 0.010]} />
                      <meshStandardMaterial color="#1C1E26" roughness={0.22} metalness={0.82} envMapIntensity={2.0} />
                    </mesh>
                    {/* Number bars (simplified "8" as 3 horizontal bars + 2 verticals = house number feel) */}
                    {[0.030, -0.003, -0.035].map((ny, nii) => (
                      <mesh key={nii} position={[0, ny, -0.008]} rotation={[0, Math.PI / 2, 0]}>
                        <boxGeometry args={[0.10, 0.010, 0.004]} />
                        <meshStandardMaterial
                          color="#D4C060"
                          emissive="#C8B040"
                          emissiveIntensity={isNightG ? 1.4 : 0.4}
                          roughness={0.18} metalness={0.88} envMapIntensity={3.0}
                        />
                      </mesh>
                    ))}
                    {/* Under-plaque LED wash */}
                    {isNightG && (
                      <pointLight position={[0.08, 0, -0.02]} intensity={0.6} distance={0.8} decay={2.2} color="#F8E890" />
                    )}
                  </group>
                )}
              </group>
            ))}
            {/* ── Driveway wrought-iron gate leaves ──
                 Premium forged-iron estate gate:
                 • Heavy outer frame with top arch rail
                 • 7 spear-tip pickets per leaf
                 • 3 horizontal rails (bottom, mid, top)
                 • Diagonal diagonal brace from bottom-hinge to mid-rail
                 • Ornamental scrollwork rings between mid-pickets
                 • Hydraulic hinge stubs at pillar side */}
            {([-1, 1] as number[]).map((side) => {
              const leafX  = gateX2 + side * gateW2 / 2;
              const leafH  = wallH2 * 1.18;           // gate taller than wall
              const leafW  = gateW2 - 0.05;
              const pickN  = 7;
              const pickSpacing = (leafW - 0.10) / (pickN - 1);
              const frameMat = { color: "#1A1C24", roughness: 0.22, metalness: 0.84, envMapIntensity: 2.2 };
              const goldMat  = { color: "#B0A030", roughness: 0.16, metalness: 0.92, envMapIntensity: 3.5 };
              return (
                <group key={side} position={[leafX, 0, bndS]}>
                  {/* ── Outer frame (left/right stiles + bottom rail) ── */}
                  {/* Left stile */}
                  <mesh position={[-leafW / 2 + 0.025, leafH / 2, 0.018]} castShadow>
                    <boxGeometry args={[0.048, leafH, 0.048]} />
                    <meshStandardMaterial {...frameMat} />
                  </mesh>
                  {/* Right stile */}
                  <mesh position={[leafW / 2 - 0.025, leafH / 2, 0.018]} castShadow>
                    <boxGeometry args={[0.048, leafH, 0.048]} />
                    <meshStandardMaterial {...frameMat} />
                  </mesh>
                  {/* Bottom rail */}
                  <mesh position={[0, 0.030, 0.018]} castShadow>
                    <boxGeometry args={[leafW, 0.058, 0.044]} />
                    <meshStandardMaterial {...frameMat} />
                  </mesh>

                  {/* ── Arch top rail — bent upward at centre ── */}
                  {/* Approximated as 3 angled segments */}
                  {([-0.30, 0, 0.30] as number[]).map((ax, ai) => {
                    const archY = leafH - 0.025 + (ai === 1 ? 0.10 : 0);
                    const archTilt = ai === 0 ? 0.08 : ai === 2 ? -0.08 : 0;
                    return (
                      <mesh key={ai} position={[ax * (leafW / 0.90), archY, 0.018]} rotation={[0, 0, archTilt]}>
                        <boxGeometry args={[leafW * 0.38, 0.044, 0.044]} />
                        <meshStandardMaterial {...frameMat} />
                      </mesh>
                    );
                  })}

                  {/* ── 3 horizontal rails ── */}
                  {/* Lower rail (kick plate level) */}
                  <mesh position={[0, leafH * 0.18, 0.026]}>
                    <boxGeometry args={[leafW - 0.06, 0.028, 0.028]} />
                    <meshStandardMaterial {...frameMat} />
                  </mesh>
                  {/* Mid rail */}
                  <mesh position={[0, leafH * 0.52, 0.026]}>
                    <boxGeometry args={[leafW - 0.06, 0.028, 0.028]} />
                    <meshStandardMaterial {...frameMat} />
                  </mesh>
                  {/* Upper rail */}
                  <mesh position={[0, leafH * 0.82, 0.026]}>
                    <boxGeometry args={[leafW - 0.06, 0.022, 0.022]} />
                    <meshStandardMaterial {...frameMat} />
                  </mesh>

                  {/* ── 7 vertical pickets with spear finials ── */}
                  {Array.from({ length: pickN }, (_, pi) => {
                    const px = -leafW / 2 + 0.055 + pi * pickSpacing;
                    const pickH = leafH - 0.055;
                    // Middle pickets slightly taller
                    const extraH = (pi === 3) ? 0.12 : (pi === 2 || pi === 4) ? 0.06 : 0;
                    return (
                      <group key={pi} position={[px, pickH / 2 + 0.028, 0.024]}>
                        {/* Shaft */}
                        <mesh castShadow>
                          <boxGeometry args={[0.022, pickH + extraH, 0.022]} />
                          <meshStandardMaterial {...frameMat} />
                        </mesh>
                        {/* Spear finial — 4-sided */}
                        <mesh position={[0, (pickH + extraH) / 2 + 0.065, 0]}>
                          <coneGeometry args={[0.018, 0.130, 4]} />
                          <meshStandardMaterial {...goldMat} />
                        </mesh>
                        {/* Finial collar ring */}
                        <mesh position={[0, (pickH + extraH) / 2 - 0.008, 0]}>
                          <torusGeometry args={[0.014, 0.005, 4, 8]} />
                          <meshStandardMaterial {...goldMat} />
                        </mesh>
                      </group>
                    );
                  })}

                  {/* ── Ornamental scrollwork — C-scroll rings between mid pickets ── */}
                  {[1, 3, 5].map((ri) => {
                    const rx = -leafW / 2 + 0.055 + ri * pickSpacing + pickSpacing / 2;
                    return (
                      <group key={ri} position={[rx, leafH * 0.35, 0.030]}>
                        {/* Outer ring */}
                        <mesh>
                          <torusGeometry args={[0.052, 0.008, 5, 12]} />
                          <meshStandardMaterial {...goldMat} />
                        </mesh>
                        {/* Inner boss */}
                        <mesh>
                          <sphereGeometry args={[0.018, 6, 5]} />
                          <meshStandardMaterial {...goldMat} />
                        </mesh>
                      </group>
                    );
                  })}

                  {/* ── Diagonal brace (corner to mid-rail — only on hinge side) ── */}
                  {(() => {
                    const hx = side * (leafW / 2 - 0.025);
                    const bLen = Math.sqrt((leafW * 0.85) ** 2 + (leafH * 0.48) ** 2);
                    const bAngle = Math.atan2(leafH * 0.48, leafW * 0.85) * side;
                    return (
                      <mesh position={[-hx * 0.40, leafH * 0.25, 0.026]}
                        rotation={[0, 0, bAngle]}>
                        <boxGeometry args={[bLen * 0.55, 0.016, 0.016]} />
                        <meshStandardMaterial color="#222630" roughness={0.28} metalness={0.80} />
                      </mesh>
                    );
                  })()}

                  {/* ── Hydraulic hinge stubs (gate-side, 3 per leaf) ── */}
                  {[0.22, 0.55, 0.88].map((hy, hi) => (
                    <mesh key={hi} position={[side * (leafW / 2 - 0.012), leafH * hy, 0.040]}
                      rotation={[Math.PI / 2, 0, 0]}>
                      <cylinderGeometry args={[0.018, 0.018, 0.055, 6]} />
                      <meshStandardMaterial color="#505870" roughness={0.30} metalness={0.82} />
                    </mesh>
                  ))}
                </group>
              );
            })}

            {/* ── Central gate crest / monogram ── */}
            <group position={[gateX2, wallH2 * 0.85, bndS + 0.028]}>
              {/* Crest backing disc — polished dark */}
              <mesh>
                <cylinderGeometry args={[0.22, 0.22, 0.014, 16]} />
                <meshStandardMaterial color="#1A1C22" roughness={0.10} metalness={0.90} envMapIntensity={3.0} />
              </mesh>
              {/* Outer gold ring */}
              <mesh>
                <torusGeometry args={[0.20, 0.013, 6, 16]} />
                <meshStandardMaterial color="#B0A040" roughness={0.15} metalness={0.92} envMapIntensity={3.8} />
              </mesh>
              {/* Inner decorative star (8 spokes) */}
              {Array.from({ length: 8 }, (_, si) => {
                const sa = (si * Math.PI) / 4;
                return (
                  <mesh key={si} position={[Math.cos(sa) * 0.08, 0.010, Math.sin(sa) * 0.08]}
                    rotation={[0, sa, 0]}>
                    <boxGeometry args={[0.14, 0.010, 0.010]} />
                    <meshStandardMaterial color="#C8B060" roughness={0.15} metalness={0.92} envMapIntensity={3.5} />
                  </mesh>
                );
              })}
              {/* Centre boss sphere */}
              <mesh position={[0, 0.014, 0]}>
                <sphereGeometry args={[0.034, 8, 6]} />
                <meshStandardMaterial color="#D4C070" roughness={0.12} metalness={0.95} envMapIntensity={4.5} />
              </mesh>
            </group>

            {/* ── Intercom / keypad panel on west gate pillar inner face ── */}
            {(() => {
              const pillarX  = gateX2 - gateW2 - pillarS / 2;
              const icY      = pillarH * 0.62;
              const isNightIC = sunHour < 6 || sunHour > 20;
              return (
                <group position={[pillarX + pillarS / 2 + 0.008, icY, bndS - 0.008]}>
                  {/* Panel body */}
                  <mesh castShadow>
                    <boxGeometry args={[0.005, 0.175, 0.120]} />
                    <meshStandardMaterial color="#1E2028" roughness={0.45} metalness={0.55} />
                  </mesh>
                  {/* Speaker grille strip */}
                  <mesh position={[0.003, 0.040, 0]}>
                    <boxGeometry args={[0.005, 0.055, 0.095]} />
                    <meshStandardMaterial color="#14161E" roughness={0.70} metalness={0.30} />
                  </mesh>
                  {/* Camera lens (small dark disc) */}
                  <mesh position={[0.004, 0.068, 0.020]}>
                    <cylinderGeometry args={[0.008, 0.008, 0.004, 8]} />
                    <meshStandardMaterial color="#080A10" roughness={0.10} metalness={0.50} />
                  </mesh>
                  {/* Call button */}
                  <mesh position={[0.004, -0.020, 0.020]}>
                    <cylinderGeometry args={[0.010, 0.010, 0.006, 8]} />
                    <meshStandardMaterial color="#005080" roughness={0.25} metalness={0.55}
                      emissive="#004060" emissiveIntensity={isNightIC ? 1.2 : 0.08} />
                  </mesh>
                  {/* Keypad screen glow */}
                  <mesh position={[0.004, -0.050, 0]}>
                    <boxGeometry args={[0.004, 0.040, 0.070]} />
                    <meshStandardMaterial color="#203050" roughness={0.15} metalness={0.10}
                      emissive="#1040A0" emissiveIntensity={isNightIC ? 0.80 : 0.06} />
                  </mesh>
                </group>
              );
            })()}
            {/* Driveway paving strip (gate → building steps) */}
            {(() => {
              const dvW  = gateW2 * 2 + 0.50;
              const dvL  = Math.abs(bndS - (-D / 2 - 3.0));
              const dvZ  = (bndS + (-D / 2 - 3.0)) / 2;
              const jointStep = 0.65;   // paver module
              const nH = Math.round(dvL / jointStep);
              const nV = Math.round(dvW / jointStep);
              return (
                <group>
                  {/* Base slab */}
                  <mesh position={[gateX2, 0.003, dvZ]} receiveShadow>
                    <boxGeometry args={[dvW, 0.006, dvL]} />
                    <meshStandardMaterial color="#C4BCA8" roughness={0.82} metalness={0.02} />
                  </mesh>
                  {/* Horizontal joint lines */}
                  {Array.from({ length: nH - 1 }, (_, ji) => {
                    const jz = bndS + (ji + 1) * jointStep;
                    return (
                      <mesh key={`hjt-${ji}`} position={[gateX2, 0.007, jz]}>
                        <boxGeometry args={[dvW, 0.003, 0.012]} />
                        <meshStandardMaterial color="#A8A098" roughness={0.90} />
                      </mesh>
                    );
                  })}
                  {/* Vertical joint lines (alternating offset like running bond) */}
                  {Array.from({ length: nV - 1 }, (_, ji) => {
                    const jx = gateX2 - dvW / 2 + (ji + 1) * jointStep;
                    return (
                      <mesh key={`vjt-${ji}`} position={[jx, 0.007, dvZ]}>
                        <boxGeometry args={[0.012, 0.003, dvL]} />
                        <meshStandardMaterial color="#A8A098" roughness={0.90} />
                      </mesh>
                    );
                  })}
                  {/* Centre dividing line — emphasizes two-lane approach */}
                  <mesh position={[gateX2, 0.009, dvZ]}>
                    <boxGeometry args={[0.025, 0.003, dvL - 0.20]} />
                    <meshStandardMaterial color="#8A8880" roughness={0.86} />
                  </mesh>
                </group>
              );
            })()}
            {/* Gate intercom panel — on east-side pillar inner face */}
            {(() => {
              const icPillarX = gateX2 + gateW2 + pillarS / 2;
              const icY       = wallH2 * 0.52;
              return (
                <group position={[icPillarX - pillarS / 2 - 0.022, icY, bndS]}>
                  {/* Intercom housing — brushed stainless rectangle */}
                  <mesh>
                    <boxGeometry args={[0.014, 0.18, 0.11]} />
                    <meshStandardMaterial color="#8A9BA8" roughness={0.22} metalness={0.88} envMapIntensity={2.0} />
                  </mesh>
                  {/* Speaker grille — small dark rectangle */}
                  <mesh position={[0.008, 0.035, 0]}>
                    <boxGeometry args={[0.004, 0.055, 0.068]} />
                    <meshStandardMaterial color="#2A2E38" roughness={0.60} metalness={0.40} />
                  </mesh>
                  {/* Button × 2 — call + unlock */}
                  {([0.028, -0.022] as number[]).map((by, bti) => (
                    <mesh key={bti} position={[0.008, by, 0.020]}>
                      <boxGeometry args={[0.004, 0.020, 0.020]} />
                      <meshStandardMaterial
                        color={bti === 0 ? "#3A8AFF" : "#EEEEEC"}
                        emissive={bti === 0 ? "#2070FF" : "#CCCCCA"}
                        emissiveIntensity={0.6}
                        roughness={0.30}
                      />
                    </mesh>
                  ))}
                  {/* LED status dot */}
                  <mesh position={[0.008, -0.062, 0.016]}>
                    <sphereGeometry args={[0.005, 6, 4]} />
                    <meshStandardMaterial color="#20FF60" emissive="#10EE50" emissiveIntensity={1.5} />
                  </mesh>
                </group>
              );
            })()}
          </group>
        );
      })()}

      {/* ── 5d-0b. 车道嵌入式 LED 导向线（driveway inset LED runway lines）──
           At dusk/night, two parallel amber LED strips run the length of the
           motor court from gate to building steps. They act as runway approach
           guides and add a dramatic luxury hotel quality to the arrival sequence.
           Additional transverse LED marks every ~3m for a hotel-court grid. */}
      {!insideBuilding && isGlassVilla && (() => {
        const isNightRW = sunHour < 6 || sunHour > 20;
        const isDuskRW  = !isNightRW && (sunHour < 8 || sunHour > 18);
        if (!isNightRW && !isDuskRW) return null;  // day: invisible
        const rwEmi    = isNightRW ? 3.5 : 1.8;
        const rwLI     = isNightRW ? 2.0 : 0.8;

        const bndS_rw  = -D / 2 - 14.50;
        const rwGateZ  = bndS_rw + 0.40;     // just inside gate
        const rwBuildZ = -D / 2 - 0.50;      // near building steps
        const rwLen    = rwBuildZ - rwGateZ;
        const rwMidZ   = (rwGateZ + rwBuildZ) / 2;
        const rwLineOX = 1.60;  // X offset from centre for each guide line
        const xStep    = 2.80;  // transverse marker spacing

        return (
          <group>
            {/* Longitudinal guide lines (2, one each side of centreline) */}
            {([-rwLineOX, rwLineOX] as number[]).map((lx, li) => (
              <group key={li}>
                {/* Thin emissive strip mesh */}
                <mesh position={[lx, 0.016, rwMidZ]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[0.024, Math.abs(rwLen)]} />
                  <meshStandardMaterial color="#FFE860" emissive="#FFD030" emissiveIntensity={rwEmi} roughness={0.60} depthWrite={false} />
                </mesh>
                {/* Point lights every ~4m along the line */}
                {Array.from({ length: Math.round(Math.abs(rwLen) / 4.0) }, (_, pi) => {
                  const pz = rwGateZ + (pi + 0.5) * (Math.abs(rwLen) / Math.round(Math.abs(rwLen) / 4.0));
                  return (
                    <pointLight key={pi} position={[lx, 0.08, pz]} intensity={rwLI} distance={3.0} decay={2} color="#FFE040" />
                  );
                })}
              </group>
            ))}

            {/* Transverse accent marks (short cross strips every xStep) */}
            {Array.from({ length: Math.round(Math.abs(rwLen) / xStep) }, (_, ti) => {
              const tz = rwGateZ + (ti + 0.5) * xStep;
              return (
                <mesh key={ti} position={[0, 0.017, tz]} rotation={[-Math.PI / 2, 0, 0]}>
                  <planeGeometry args={[rwLineOX * 2 + 0.40, 0.020]} />
                  <meshStandardMaterial color="#FFE080" emissive="#FFD040" emissiveIntensity={rwEmi * 0.55} roughness={0.60} depthWrite={false} />
                </mesh>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5d-1. 界墙壁灯（wall-mounted lanterns along south boundary wall）──
           Traditional bracket lanterns spaced ~4m apart on the inner face of
           the south boundary wall, providing warm amber pathway lighting at
           dusk and night. */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndS9   = -D / 2 - 14.50;
        const bndW9   = -W / 2 - 4.50;
        const bndE9   =  W / 2 + 4.50;
        const gateW9  = Math.min(W * 0.30, 3.80);
        const wH9     = 0.88;
        const wallT9  = 0.18;
        const isNightL = sunHour < 6 || sunHour > 20;
        const isDuskL  = !isNightL && (sunHour < 8 || sunHour > 18);
        const lampEmi  = isNightL ? 3.5 : isDuskL ? 1.8 : 0.08;
        const lampLI   = isNightL ? 4.0 : isDuskL ? 2.0 : 0.0;
        const lampSpacing = 4.0;

        // West segment of south wall
        const westHalfLen = Math.abs(bndW9 - (-gateW9));
        const nWest = Math.max(1, Math.floor(westHalfLen / lampSpacing));
        const westLamps: number[] = Array.from({ length: nWest }, (_, i) =>
          bndW9 + (i + 1) * westHalfLen / (nWest + 1)
        );
        // East segment
        const eastHalfLen = Math.abs(bndE9 - gateW9);
        const nEast = Math.max(1, Math.floor(eastHalfLen / lampSpacing));
        const eastLamps: number[] = Array.from({ length: nEast }, (_, i) =>
          gateW9 + (i + 1) * eastHalfLen / (nEast + 1)
        );

        const Lantern = ({ x, facing }: { x: number; facing: number }) => (
          <group position={[x, wH9 * 0.80, bndS9 + (facing > 0 ? -wallT9 / 2 - 0.008 : wallT9 / 2 + 0.008)]}>
            {/* Wall bracket arm */}
            <mesh position={[0, 0, facing * 0.085]}>
              <boxGeometry args={[0.012, 0.012, 0.17]} />
              <meshStandardMaterial color="#282C38" roughness={0.25} metalness={0.85} />
            </mesh>
            {/* Lantern body */}
            <mesh position={[0, 0, facing * 0.175]}>
              <boxGeometry args={[0.070, 0.120, 0.070]} />
              <meshStandardMaterial color="#1C2028" roughness={0.28} metalness={0.80} />
            </mesh>
            {/* Glass pane (warm amber) */}
            <mesh position={[0, 0, facing * 0.178]}>
              <boxGeometry args={[0.055, 0.095, 0.055]} />
              <meshPhysicalMaterial
                color="#FFD070"
                transparent opacity={0.65}
                roughness={0.10} metalness={0.04}
                emissive="#FFC040"
                emissiveIntensity={lampEmi}
                transmission={0.25}
              />
            </mesh>
            {/* Cap */}
            <mesh position={[0, 0.068, facing * 0.175]}>
              <boxGeometry args={[0.080, 0.018, 0.080]} />
              <meshStandardMaterial color="#1A1E28" roughness={0.22} metalness={0.88} />
            </mesh>
            {/* Finial */}
            <mesh position={[0, 0.082, facing * 0.175]}>
              <coneGeometry args={[0.012, 0.030, 4]} />
              <meshStandardMaterial color="#303848" roughness={0.22} metalness={0.85} />
            </mesh>
            {lampLI > 0 && (
              <pointLight
                position={[0, 0, facing * 0.18]}
                intensity={lampLI}
                distance={5.0} decay={2.0}
                color="#FFC050" castShadow={false}
              />
            )}
          </group>
        );

        return (
          <group>
            {westLamps.map((lx, li) => <Lantern key={`wl-${li}`} x={lx} facing={1} />)}
            {eastLamps.map((lx, li) => <Lantern key={`el-${li}`} x={lx} facing={1} />)}
          </group>
        );
      })()}

      {/* ── 5d-2. 停车位标线 + 门卫岗亭（parking bay markings + security booth）──
           White painted parking bays alongside the driveway and a small
           modern security booth near the east gate pillar. */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndS8  = -D / 2 - 14.50;
        const bndE8  =  W / 2 + 4.50;
        const gateW8 = Math.min(W * 0.30, 3.80);
        const isNightB = sunHour < 6 || sunHour > 20;
        const isDuskB  = !isNightB && (sunHour < 8 || sunHour > 18);
        // Parking bay for sedan (X=0, Z=-D/2-7.80) and SUV (X=2.55, Z=-D/2-8.10)
        const parkZ = -D / 2 - 7.90;
        return (
          <group>
            {/* White parking bay lines — 2 bays side by side */}
            {/* Bay 1 (sedan, centred at X=0) */}
            {([-1.15, 1.15] as number[]).map((lx, li) => (
              <mesh key={`bl1-${li}`} position={[lx, 0.016, parkZ]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.10, 5.20]} />
                <meshStandardMaterial color="#E8E8E8" roughness={0.82} />
              </mesh>
            ))}
            {/* Bay 2 (SUV, offset east) */}
            {([1.15, 3.70] as number[]).map((lx, li) => (
              li === 0 ? null :
              <mesh key={`bl2-${li}`} position={[lx, 0.016, parkZ]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[0.10, 5.20]} />
                <meshStandardMaterial color="#E8E8E8" roughness={0.82} />
              </mesh>
            ))}
            {/* Bay front / back markings */}
            {[-parkZ - D / 2 - 5.30, -parkZ - D / 2 - 10.30].map((_, mi) => (
              <mesh key={`bm-${mi}`} position={[1.80, 0.016, -D / 2 - 5.30 - mi * 5.0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[5.00, 0.10]} />
                <meshStandardMaterial color="#E8E8E8" roughness={0.82} />
              </mesh>
            ))}
            {/* Security guard booth — east side of gate, inside boundary */}
            <group position={[gateW8 + 1.50, 0, bndS8 + 1.20]}>
              {/* Booth floor */}
              <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                <planeGeometry args={[1.10, 1.10]} />
                <meshStandardMaterial color="#C8C4BC" roughness={0.72} />
              </mesh>
              {/* Booth body — white painted concrete block */}
              <mesh position={[0, 1.15, 0]} castShadow>
                <boxGeometry args={[1.10, 2.30, 1.10]} />
                <meshStandardMaterial color="#E8E4DC" roughness={0.80} metalness={0.02} />
              </mesh>
              {/* Large window — front (south facing gate) */}
              <mesh position={[0, 1.30, -0.56]}>
                <boxGeometry args={[0.80, 0.90, 0.012]} />
                <meshStandardMaterial color="#B0CCD8" transparent opacity={0.50} roughness={0.04} metalness={0.08} envMapIntensity={3.0} />
              </mesh>
              {/* Door (east side) */}
              <mesh position={[0.56, 0.95, 0.10]}>
                <boxGeometry args={[0.012, 1.90, 0.60]} />
                <meshStandardMaterial color="#A8B0B8" roughness={0.40} metalness={0.30} />
              </mesh>
              {/* Flat roof with small overhang */}
              <mesh position={[0, 2.32, 0]} castShadow>
                <boxGeometry args={[1.20, 0.075, 1.20]} />
                <meshStandardMaterial color="#C8C4BC" roughness={0.82} />
              </mesh>
              {/* CCTV camera on corner */}
              <mesh position={[0.50, 2.28, -0.50]} rotation={[0.2, -Math.PI / 4, 0]}>
                <boxGeometry args={[0.055, 0.040, 0.080]} />
                <meshStandardMaterial color="#282C34" roughness={0.35} metalness={0.68} />
              </mesh>
              {/* Interior light */}
              {(isNightB || isDuskB) && (
                <pointLight position={[0, 1.40, 0]} intensity={1.2} distance={2.5} decay={2.0} color="#FFE890" castShadow={false} />
              )}
            </group>
          </group>
        );
      })()}

      {/* ── 5e. 庭院乔木（mature trees at site corners）── */}
      {!insideBuilding && isGlassVilla && (() => {
        const treeData: Array<[number, number]> = [
          [ W / 2 + 3.0,  D / 2 + 1.8],   // NE corner
          [-W / 2 - 3.0,  D / 2 + 1.8],   // NW corner
          [ W / 2 + 3.0, -D / 2 - 5.0],   // SE (south of canopy, near pool)
          [-W / 2 - 3.0, -D / 2 - 5.0],   // SW
          [ W / 2 + 3.5, -D / 2 + 1.0],   // mid-east
          [-W / 2 - 3.5, -D / 2 + 1.0],   // mid-west
        ];
        const isNightT = sunHour < 6 || sunHour > 20;
        const isDuskT  = !isNightT && (sunHour < 8 || sunHour > 18);
        const treeLI   = isNightT ? 4.5 : isDuskT ? 2.2 : 0.0;
        return (
          <group>
            {treeData.map(([tx, tz], ti) => {
              const trunkH   = 3.8 + panelBlindHash(ti * 3, 7) * 1.6;
              const trunkR   = 0.11 + panelBlindHash(ti + 3, 2) * 0.07;
              const fR       = 1.15 + panelBlindHash(ti, 11) * 0.65;
              const fY       = trunkH * 0.74;
              const gBase    = panelBlindHash(ti, 13) < 0.5 ? "#2A6020" : "#224E18";
              const gDark    = panelBlindHash(ti, 17) < 0.5 ? "#1C4A12" : "#244E18";
              return (
                <group key={ti} position={[tx, 0, tz]}>
                  {/* Trunk */}
                  <mesh position={[0, trunkH / 2, 0]} castShadow>
                    <cylinderGeometry args={[trunkR * 0.72, trunkR, trunkH, 7]} />
                    <meshStandardMaterial color="#5A3E28" roughness={0.92} metalness={0.02} />
                  </mesh>
                  {/* Main foliage */}
                  <mesh position={[0, fY, 0]} castShadow>
                    <sphereGeometry args={[fR, 8, 6]} />
                    <meshStandardMaterial color={gBase} roughness={0.96} metalness={0.01} />
                  </mesh>
                  {/* Upper cluster */}
                  <mesh position={[fR * 0.22, fY + fR * 0.52, fR * 0.08]} castShadow>
                    <sphereGeometry args={[fR * 0.62, 7, 5]} />
                    <meshStandardMaterial color={gDark} roughness={0.97} metalness={0.01} />
                  </mesh>
                  {/* Side cluster */}
                  <mesh position={[-fR * 0.46, fY - fR * 0.18, 0]} castShadow>
                    <sphereGeometry args={[fR * 0.52, 7, 5]} />
                    <meshStandardMaterial color={gBase} roughness={0.96} metalness={0.01} />
                  </mesh>
                  {/* Tree ground up-light — in-ground spot at trunk base */}
                  {isNightT && (
                    <>
                      <mesh position={[trunkR + 0.25, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                        <circleGeometry args={[0.052, 8]} />
                        <meshStandardMaterial color="#282830" roughness={0.45} metalness={0.65} />
                      </mesh>
                      <pointLight position={[trunkR + 0.25, 0.04, 0]} intensity={treeLI} distance={fY + fR + 1.5} decay={1.6} color="#FFF4D0" castShadow={false} />
                    </>
                  )}
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5d-3. 西侧行人侧门（pedestrian side gate, west boundary wall）──
           A single-leaf wrought-iron pedestrian gate set into the west boundary
           wall, approx 3m north of the south-west corner. Two flanking pillars
           (matching main gate style), a steel picket gate leaf, night lanterns,
           and a stone slab path leading east to the main driveway. */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndW_pg   = -W / 2 - 4.50;   // west boundary X
        const bndS_pg   = -D / 2 - 14.50;  // south boundary Z
        const pgZ       = bndS_pg + 3.50;   // ~3.5m north of SW corner
        const pgGateW   = 1.10;             // gate opening width
        const pgPillarS = 0.22;             // pillar cross-section
        const pgPillarH = 1.40;
        const pgWallH   = 0.88;
        const pgWallT   = 0.18;
        const wallCol   = "#D8D4CC";
        const capCol    = "#484C58";
        const isNightPG = sunHour < 6 || sunHour > 20;
        const isDuskPG  = !isNightPG && (sunHour < 8 || sunHour > 18);
        const lampI     = isNightPG ? 3.5 : isDuskPG ? 1.8 : 0.0;
        const lampEmi   = isNightPG ? 3.0 : isDuskPG ? 1.5 : 0.2;

        // Pillar centers (gate opening is between them)
        const pillarNZ = pgZ + pgGateW / 2 + pgPillarS / 2;
        const pillarSZ = pgZ - pgGateW / 2 - pgPillarS / 2;

        return (
          <group>
            {/* ── Wall gap infill sides (no mesh — gap in existing west wall) ──
                Just add pillar pair and gate. The main west wall mesh already spans
                full length; we overlay pillars on top to mark the opening. */}

            {/* North pillar */}
            <group position={[bndW_pg, 0, pillarNZ]}>
              <mesh position={[0, pgPillarH / 2, 0]} castShadow>
                <boxGeometry args={[pgPillarS, pgPillarH, pgPillarS]} />
                <meshStandardMaterial color="#1C1E24" roughness={0.22} metalness={0.38} envMapIntensity={1.6} />
              </mesh>
              {/* Cap */}
              <mesh position={[0, pgPillarH + 0.04, 0]}>
                <boxGeometry args={[pgPillarS + 0.06, 0.06, pgPillarS + 0.06]} />
                <meshStandardMaterial color="#141618" roughness={0.18} metalness={0.55} envMapIntensity={2.0} />
              </mesh>
              {/* Lantern */}
              <group position={[0, pgPillarH + 0.10, 0]}>
                <mesh position={[0, 0.10, 0]}>
                  <boxGeometry args={[0.10, 0.18, 0.10]} />
                  <meshStandardMaterial color="#1A1C22" roughness={0.25} metalness={0.80} envMapIntensity={1.8} />
                </mesh>
                {/* Glass pane */}
                <mesh position={[0, 0.10, 0]} renderOrder={11}>
                  <boxGeometry args={[0.085, 0.13, 0.085]} />
                  <meshStandardMaterial
                    color="#FFF4D0" emissive="#FFD860" emissiveIntensity={lampEmi}
                    transparent opacity={0.70} roughness={0.10} metalness={0.02}
                    side={THREE.DoubleSide} depthWrite={false}
                  />
                </mesh>
                {/* Pyramid cap */}
                <mesh position={[0, 0.205, 0]}>
                  <coneGeometry args={[0.072, 0.10, 4]} />
                  <meshStandardMaterial color="#141618" roughness={0.20} metalness={0.75} />
                </mesh>
                {lampI > 0 && (
                  <pointLight position={[0, 0.10, 0]} intensity={lampI} distance={3.0} decay={2} color="#FFE070" />
                )}
              </group>
            </group>

            {/* South pillar */}
            <group position={[bndW_pg, 0, pillarSZ]}>
              <mesh position={[0, pgPillarH / 2, 0]} castShadow>
                <boxGeometry args={[pgPillarS, pgPillarH, pgPillarS]} />
                <meshStandardMaterial color="#1C1E24" roughness={0.22} metalness={0.38} envMapIntensity={1.6} />
              </mesh>
              <mesh position={[0, pgPillarH + 0.04, 0]}>
                <boxGeometry args={[pgPillarS + 0.06, 0.06, pgPillarS + 0.06]} />
                <meshStandardMaterial color="#141618" roughness={0.18} metalness={0.55} envMapIntensity={2.0} />
              </mesh>
              {/* Lantern (south pillar) */}
              <group position={[0, pgPillarH + 0.10, 0]}>
                <mesh position={[0, 0.10, 0]}>
                  <boxGeometry args={[0.10, 0.18, 0.10]} />
                  <meshStandardMaterial color="#1A1C22" roughness={0.25} metalness={0.80} envMapIntensity={1.8} />
                </mesh>
                <mesh position={[0, 0.10, 0]} renderOrder={11}>
                  <boxGeometry args={[0.085, 0.13, 0.085]} />
                  <meshStandardMaterial
                    color="#FFF4D0" emissive="#FFD860" emissiveIntensity={lampEmi}
                    transparent opacity={0.70} roughness={0.10} metalness={0.02}
                    side={THREE.DoubleSide} depthWrite={false}
                  />
                </mesh>
                <mesh position={[0, 0.205, 0]}>
                  <coneGeometry args={[0.072, 0.10, 4]} />
                  <meshStandardMaterial color="#141618" roughness={0.20} metalness={0.75} />
                </mesh>
                {lampI > 0 && (
                  <pointLight position={[0, 0.10, 0]} intensity={lampI} distance={3.0} decay={2} color="#FFE070" />
                )}
              </group>
            </group>

            {/* ── Single-leaf gate (swings east, resting on E side, closed) ── */}
            <group position={[bndW_pg + pgPillarS / 2 + pgGateW / 2, 0, pgZ]}>
              {/* Top rail */}
              <mesh position={[0, 1.10, 0]}>
                <boxGeometry args={[0.030, 0.030, pgGateW - 0.04]} />
                <meshStandardMaterial color="#28303C" roughness={0.20} metalness={0.92} envMapIntensity={2.0} />
              </mesh>
              {/* Bottom rail */}
              <mesh position={[0, 0.20, 0]}>
                <boxGeometry args={[0.030, 0.025, pgGateW - 0.04]} />
                <meshStandardMaterial color="#28303C" roughness={0.20} metalness={0.92} envMapIntensity={2.0} />
              </mesh>
              {/* 5 pickets */}
              {Array.from({ length: 5 }, (_, pi) => {
                const pz = -(pgGateW - 0.08) / 2 + pi * ((pgGateW - 0.08) / 4);
                return (
                  <group key={pi} position={[0, 0, pz]}>
                    <mesh position={[0, 0.60, 0]} castShadow>
                      <boxGeometry args={[0.022, 1.12, 0.022]} />
                      <meshStandardMaterial color="#303848" roughness={0.24} metalness={0.88} envMapIntensity={1.8} />
                    </mesh>
                    {/* Spear tip */}
                    <mesh position={[0, 1.22, 0]}>
                      <coneGeometry args={[0.018, 0.10, 4]} />
                      <meshStandardMaterial color="#C8B060" roughness={0.20} metalness={0.85} envMapIntensity={2.5} />
                    </mesh>
                  </group>
                );
              })}
              {/* Latch handle */}
              <mesh position={[0, 0.65, (pgGateW - 0.04) / 2 - 0.06]}>
                <boxGeometry args={[0.020, 0.12, 0.014]} />
                <meshStandardMaterial color="#C8B060" roughness={0.25} metalness={0.80} envMapIntensity={2.0} />
              </mesh>
            </group>

            {/* ── Stone slab path from gate east to driveway ── */}
            {Array.from({ length: 6 }, (_, pi) => {
              const slabX = bndW_pg + pgPillarS + 0.20 + pi * 0.64;
              return (
                <mesh key={`pg-slab-${pi}`} position={[slabX, 0.008, pgZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                  <boxGeometry args={[0.50, 0.38, 0.016]} />
                  <meshStandardMaterial color="#C4C0B4" roughness={0.68} metalness={0.02} />
                </mesh>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5e-0a. 车道两侧棕榈树（palm trees flanking driveway entry）──
           4 tall fan palms (2 per side) at the gate entrance, adding a
           tropical / Beverly Hills estate feel to the approach. */}
      {!insideBuilding && isGlassVilla && (() => {
        const dvHalfW3 = 2.20;
        const gateZ3 = -D / 2 - 14.50 + 0.40;    // near gate
        const palmPositions: Array<[number, number]> = [
          [ dvHalfW3 + 1.20, gateZ3 + 1.20],   // east-near
          [ dvHalfW3 + 2.60, gateZ3 + 0.60],   // east-far
          [-dvHalfW3 - 1.20, gateZ3 + 1.20],   // west-near
          [-dvHalfW3 - 2.60, gateZ3 + 0.60],   // west-far
        ];
        return (
          <group>
            {palmPositions.map(([px, pz], pi) => {
              const pHash3 = (pi * 11 + 5) % 7;
              const trunkH3 = 5.50 + pHash3 * 0.55;   // 5.5–9m tall palms
              const tiltX = (pi % 2 === 0 ? 0.06 : -0.04);  // slight lean
              return (
                <group key={pi} position={[px, 0, pz]}>
                  {/* Trunk — segmented tapered cylinder */}
                  {Array.from({ length: 7 }, (_, si) => {
                    const segY = si * (trunkH3 / 7);
                    const segR = 0.095 - si * 0.010;
                    return (
                      <mesh key={si} position={[tiltX * si * 0.12, segY + trunkH3 / 14, tiltX * si * 0.05]} castShadow>
                        <cylinderGeometry args={[segR - 0.008, segR, trunkH3 / 7, 8]} />
                        <meshStandardMaterial color={si % 2 === 0 ? "#806040" : "#9A7050"} roughness={0.88} metalness={0.01} />
                      </mesh>
                    );
                  })}
                  {/* Frond crown — 8 angled plumes */}
                  {Array.from({ length: 8 }, (_, fi) => {
                    const fAng = (fi / 8) * Math.PI * 2;
                    const fTiltX = Math.cos(fAng) * 0.55 + tiltX * 0.3;
                    const fTiltZ = Math.sin(fAng) * 0.55;
                    const fLen = 1.80 + (fi % 3) * 0.25;
                    return (
                      <mesh key={fi} position={[fTiltX * 0.5, trunkH3 + fLen * 0.40, fTiltZ * 0.5]}
                        rotation={[-fTiltZ * 0.55, fAng, fTiltX * 0.55]}>
                        <boxGeometry args={[0.055, fLen, 0.30]} />
                        <meshStandardMaterial color="#2E6818" roughness={0.90} metalness={0.02} />
                      </mesh>
                    );
                  })}
                  {/* Coconut-like fruit clusters at frond base */}
                  {Array.from({ length: 3 }, (_, ci) => (
                    <mesh key={ci} position={[(ci - 1) * 0.18 + tiltX * 0.4, trunkH3 + 0.22, (ci % 2) * 0.14]}>
                      <sphereGeometry args={[0.065 + (ci % 2) * 0.020, 7, 5]} />
                      <meshStandardMaterial color="#704820" roughness={0.82} />
                    </mesh>
                  ))}
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5e-0. 踏石路径太阳能灯（solar path stake lights along stepping stones）──
           Small stake-style solar LED lights placed alongside the stepping stone
           paths on east and west sides of the driveway. Night-mode glow. */}
      {!insideBuilding && isGlassVilla && (() => {
        const isNightPS = sunHour < 6 || sunHour > 20;
        const isDuskPS  = !isNightPS && (sunHour < 8 || sunHour > 18);
        const pEmi      = isNightPS ? 2.8 : isDuskPS ? 1.4 : 0.0;
        const pLI       = isNightPS ? 1.2 : isDuskPS ? 0.6 : 0.0;
        if (pEmi === 0.0) return null;

        const driveHalfW3 = 2.20;
        const bndS3b    = -D / 2 - 14.50;
        const poolL3b   = Math.min(D * 0.70, 9.50);
        const deckBW3b  = 2.80;
        const poolZ3b   = -D / 2 - deckBW3b - poolL3b / 2 - 0.80;
        const bedZN3b   = poolZ3b - poolL3b / 2 - deckBW3b - 0.10;
        const bedZS3b   = bndS3b + 1.50;
        const bedLen3b  = Math.abs(bedZN3b - bedZS3b);
        const stakeSpacing = 1.40;
        const stakeCount = Math.round(bedLen3b / stakeSpacing);
        const stakeH = 0.35;  // stake height
        const pathX_E = driveHalfW3 + 0.70;
        const pathX_W = -driveHalfW3 - 0.70;

        return (
          <group>
            {Array.from({ length: stakeCount }, (_, si) => {
              const sz = bedZN3b + si * (bedLen3b / (stakeCount - 1));
              return (
                <>
                  {/* East path stake */}
                  <group key={`pse-${si}`} position={[pathX_E, 0, sz]}>
                    <mesh position={[0, stakeH / 2, 0]}>
                      <cylinderGeometry args={[0.012, 0.014, stakeH, 6]} />
                      <meshStandardMaterial color="#4A5060" roughness={0.40} metalness={0.65} />
                    </mesh>
                    <mesh position={[0, stakeH + 0.018, 0]}>
                      <cylinderGeometry args={[0.022, 0.020, 0.038, 8]} />
                      <meshStandardMaterial color="#F0F4F8" emissive="#C8E8FF" emissiveIntensity={pEmi} roughness={0.50} />
                    </mesh>
                    {pLI > 0 && <pointLight position={[0, stakeH + 0.022, 0]} intensity={pLI} distance={1.0} decay={2.5} color="#D0E8FF" />}
                  </group>
                  {/* West path stake */}
                  <group key={`psw-${si}`} position={[pathX_W, 0, sz]}>
                    <mesh position={[0, stakeH / 2, 0]}>
                      <cylinderGeometry args={[0.012, 0.014, stakeH, 6]} />
                      <meshStandardMaterial color="#4A5060" roughness={0.40} metalness={0.65} />
                    </mesh>
                    <mesh position={[0, stakeH + 0.018, 0]}>
                      <cylinderGeometry args={[0.022, 0.020, 0.038, 8]} />
                      <meshStandardMaterial color="#F0F4F8" emissive="#C8E8FF" emissiveIntensity={pEmi} roughness={0.50} />
                    </mesh>
                    {pLI > 0 && <pointLight position={[0, stakeH + 0.022, 0]} intensity={pLI} distance={1.0} decay={2.5} color="#D0E8FF" />}
                  </group>
                </>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5e-0b. 北庭院藤架拱门（garden arbor arch, north garden entry）──
           A white-painted iron arbor arch marking the transition from the
           south lawn / path into the formal north garden. Draped with
           climbing green vines and small flower clusters. */}
      {!insideBuilding && isGlassVilla && (() => {
        const arbX = 0;
        const arbZ = D / 2 + 0.20;   // just beyond building footprint edge
        const arbW = 1.60;   // arch opening width
        const arbH = 2.40;   // arch height at peak
        const postW = 0.055;
        const postD = 0.055;
        return (
          <group position={[arbX, 0, arbZ]}>
            {/* 2 side posts */}
            {([-arbW / 2, arbW / 2] as number[]).map((px, pi) => (
              <mesh key={pi} position={[px, arbH * 0.48, 0]} castShadow>
                <boxGeometry args={[postW, arbH * 0.96, postD]} />
                <meshStandardMaterial color="#F0EDE8" roughness={0.78} metalness={0.04} />
              </mesh>
            ))}
            {/* Top rail horizontal */}
            <mesh position={[0, arbH - 0.10, 0]} castShadow>
              <boxGeometry args={[arbW + postW, postW, postD]} />
              <meshStandardMaterial color="#F0EDE8" roughness={0.78} metalness={0.04} />
            </mesh>
            {/* Arch crown — semicircular look from 5 angled pickets */}
            {Array.from({ length: 5 }, (_, pi) => {
              const t = (pi / 4 - 0.5) * Math.PI * 0.6;  // -54° to +54°
              const rx = Math.sin(t) * 0.75;
              const ry = arbH - 0.10 + Math.cos(t) * 0.34;
              return (
                <mesh key={pi} position={[rx, ry, 0]} rotation={[0, 0, t]} castShadow>
                  <boxGeometry args={[0.030, 0.46, 0.030]} />
                  <meshStandardMaterial color="#F0EDE8" roughness={0.80} metalness={0.02} />
                </mesh>
              );
            })}
            {/* Vertical pickets — 4 per side */}
            {([-1, 1] as number[]).flatMap((side, si) =>
              Array.from({ length: 4 }, (_, pi) => {
                const px2 = side * (arbW / 2 - postW / 2 - 0.06 - pi * 0.10);
                return (
                  <mesh key={`${si}-${pi}`} position={[px2, arbH * 0.30, 0]}>
                    <boxGeometry args={[0.022, arbH * 0.55, 0.022]} />
                    <meshStandardMaterial color="#E8E4DC" roughness={0.82} metalness={0.02} />
                  </mesh>
                );
              })
            )}
            {/* Climbing vine foliage on arch */}
            {Array.from({ length: 14 }, (_, vi) => {
              const vHash = (vi * 13 + 5) % 11;
              const side2 = vi < 7 ? -1 : 1;
              const vy = 0.40 + (vi % 7) * (arbH / 7);
              const vx2 = side2 * (arbW / 2 + 0.06 - (vHash % 3) * 0.04);
              const vz2 = (vHash % 5 - 2) * 0.09;
              const vr = 0.10 + (vHash % 3) * 0.038;
              const vCol2 = vHash % 5 === 0 ? "#A060C0" : vHash % 5 === 1 ? "#B870D0" : vHash % 5 < 4 ? "#2E6820" : "#3A7828";
              return (
                <mesh key={vi} position={[vx2, vy, vz2]}>
                  <sphereGeometry args={[vr, 6, 4]} />
                  <meshStandardMaterial color={vCol2} roughness={0.95} />
                </mesh>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5e-0c. 北庭院日式石灯笼（yukimi-style stone lanterns, north garden）──
           6 traditional yukimi-dōrō stone lanterns scattered through the north
           garden, near the stepping stone path, fountain and arbor.
           Each: granite base disc, pedestal, belly (fire box), cap, finial sphere.
           Fire box: frosted acrylic inside — warm amber glow at dusk/night. */}
      {!insideBuilding && isGlassVilla && (() => {
        const isNightSL = sunHour < 6 || sunHour > 20;
        const isDuskSL  = !isNightSL && (sunHour < 8 || sunHour > 18);
        const lEmi      = isNightSL ? 2.8 : isDuskSL ? 1.4 : 0.08;
        const lI        = isNightSL ? 2.5 : isDuskSL ? 1.2 : 0.0;

        // Fixed lantern positions in north garden (world space)
        const lanternPositions: [number, number][] = [
          [-W * 0.30,  D / 2 + 0.55],
          [ W * 0.30,  D / 2 + 0.55],
          [-W * 0.42,  D / 2 + 1.80],
          [ W * 0.42,  D / 2 + 1.80],
          [-W * 0.18,  D / 2 + 2.80],
          [ W * 0.20,  D / 2 + 2.80],
        ];

        return (
          <group>
            {lanternPositions.map(([lx, lz], li) => (
              <group key={li} position={[lx, 0, lz]}>
                {/* Base slab — wide flat granite disc */}
                <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
                  <circleGeometry args={[0.22, 6]} />
                  <meshStandardMaterial color="#5A5850" roughness={0.85} metalness={0.04} />
                </mesh>
                {/* Pedestal column */}
                <mesh position={[0, 0.22, 0]} castShadow>
                  <cylinderGeometry args={[0.058, 0.068, 0.38, 6]} />
                  <meshStandardMaterial color="#6A6860" roughness={0.88} metalness={0.03} />
                </mesh>
                {/* Middle support disc */}
                <mesh position={[0, 0.43, 0]}>
                  <cylinderGeometry args={[0.12, 0.12, 0.032, 6]} />
                  <meshStandardMaterial color="#5A5850" roughness={0.90} metalness={0.03} />
                </mesh>
                {/* Fire box body — hexagonal */}
                <mesh position={[0, 0.60, 0]} castShadow>
                  <cylinderGeometry args={[0.115, 0.115, 0.28, 6]} />
                  <meshStandardMaterial color="#606058" roughness={0.88} metalness={0.04} />
                </mesh>
                {/* Fire box opening panels (frosted, glowing) */}
                {Array.from({ length: 6 }, (_, fi) => {
                  const fa = (fi / 6) * Math.PI * 2;
                  return (
                    <mesh key={fi} position={[Math.cos(fa) * 0.116, 0.60, Math.sin(fa) * 0.116]}
                      rotation={[0, fa + Math.PI / 2, 0]}>
                      <planeGeometry args={[0.090, 0.22]} />
                      <meshStandardMaterial
                        color="#FFF4D0" emissive="#FFD860" emissiveIntensity={lEmi}
                        transparent opacity={0.55} roughness={0.30}
                        side={THREE.DoubleSide} depthWrite={false}
                      />
                    </mesh>
                  );
                })}
                {/* Roof cap — wide hexagonal lid */}
                <mesh position={[0, 0.77, 0]} castShadow>
                  <cylinderGeometry args={[0.18, 0.12, 0.10, 6]} />
                  <meshStandardMaterial color="#5A5850" roughness={0.86} metalness={0.04} />
                </mesh>
                {/* Roof top flat */}
                <mesh position={[0, 0.825, 0]}>
                  <cylinderGeometry args={[0.175, 0.175, 0.022, 6]} />
                  <meshStandardMaterial color="#504E48" roughness={0.88} metalness={0.04} />
                </mesh>
                {/* Finial sphere */}
                <mesh position={[0, 0.870, 0]}>
                  <sphereGeometry args={[0.034, 6, 5]} />
                  <meshStandardMaterial color="#484640" roughness={0.85} metalness={0.06} />
                </mesh>
                {/* Point light from fire box */}
                {lI > 0 && (
                  <pointLight position={[0, 0.60, 0]} intensity={lI} distance={2.0} decay={2.5} color="#FFD070" />
                )}
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 5e-1. 北侧庭院艺术装置（premium garden art installation, north yard）──
           Dual polished-steel sweeping arch sculpture over a circular mirror pool.
           Each arch is a partial torus (240° sweep) of brushed mirror steel,
           leaning outward in a V shape. A floating torus ring caps the apex.
           Ground: large honed black granite pad + 4 LED uplights.
           Night: warm amber spots wash the arches, underwater LED in pool. */}
      {!insideBuilding && isGlassVilla && (() => {
        const sculX = 0;
        const sculZ = D / 2 + 1.70;
        const isNightSc  = sunHour < 6 || sunHour > 20;
        const isDuskSc   = !isNightSc && (sunHour < 8 || sunHour > 18);
        const archEmi    = isNightSc ? 0.18 : isDuskSc ? 0.06 : 0.0;
        const uplightI   = isNightSc ? 4.5  : isDuskSc ? 2.0  : 0.0;
        const poolGlowI  = isNightSc ? 1.4  : isDuskSc ? 0.6  : 0.04;
        return (
          <group position={[sculX, 0, sculZ]}>
            {/* ── Ground pad — honed black granite, octagonal ── */}
            <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <circleGeometry args={[2.40, 8]} />
              <meshStandardMaterial color="#151618" roughness={0.18} metalness={0.42} envMapIntensity={2.5} />
            </mesh>
            {/* Fine gravel ring around pad edge */}
            <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <ringGeometry args={[2.40, 3.20, 20]} />
              <meshStandardMaterial color="#A8A490" roughness={0.92} metalness={0.01} />
            </mesh>

            {/* ── Central mirror pool (circular, flush with pad) ── */}
            <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
              <circleGeometry args={[0.70, 20]} />
              <meshStandardMaterial
                color="#4890B0" roughness={0.01} metalness={0.10}
                envMapIntensity={8.0}
                emissive="#206080" emissiveIntensity={poolGlowI}
                transparent opacity={0.90}
                depthWrite={false}
              />
            </mesh>
            {/* Pool rim — thin polished steel ring */}
            <mesh position={[0, 0.016, 0]}>
              <cylinderGeometry args={[0.72, 0.72, 0.024, 20, 1, true]} />
              <meshStandardMaterial color="#C0C8D2" roughness={0.08} metalness={0.92} envMapIntensity={3.5} side={THREE.DoubleSide} />
            </mesh>

            {/* ── Arch pair — two toroidal sweeps leaning outward ──
                 Each arch: torus with outerRadius=1.55, tubeRadius=0.058,
                 cut to 220° arc, tilted 12° outward and rotated 90° to stand vertical */}
            {([
              [Math.PI * 0.30, [-Math.PI * 0.06, 0, 0]],  // north arch leans north
              [Math.PI * 0.30, [ Math.PI * 0.06, 0, 0]],  // south arch leans south
            ] as [number, [number,number,number]][]).map(([tiltX, rot], ai) => {
              const signZ = ai === 0 ? -0.30 : 0.30;  // offset along Z
              return (
                <group
                  key={`arch-${ai}`}
                  position={[0, 0, signZ]}
                  rotation={rot}
                >
                  {/* Primary arch — polished mirror steel */}
                  <mesh castShadow>
                    <torusGeometry args={[1.45, 0.055, 14, 52, Math.PI * 1.28]} />
                    <meshStandardMaterial
                      color="#D0D8E0"
                      roughness={0.04} metalness={0.97}
                      envMapIntensity={5.5}
                      emissive="#B0C0D0" emissiveIntensity={archEmi}
                    />
                  </mesh>
                  {/* Secondary inner echo ring — brushed, slightly smaller */}
                  <mesh>
                    <torusGeometry args={[1.20, 0.028, 10, 48, Math.PI * 1.28]} />
                    <meshStandardMaterial
                      color="#A8B4BE" roughness={0.14} metalness={0.90}
                      envMapIntensity={4.0}
                      emissive="#8898A8" emissiveIntensity={archEmi * 0.7}
                    />
                  </mesh>
                </group>
              );
            })}

            {/* ── Apex floating ring — horizontal torus at ~2.90m height ── */}
            <mesh position={[0, 2.88, 0]} castShadow>
              <torusGeometry args={[0.52, 0.038, 12, 36]} />
              <meshStandardMaterial
                color="#E4ECF4" roughness={0.03} metalness={0.98}
                envMapIntensity={6.0}
                emissive="#C8D8E8" emissiveIntensity={archEmi * 1.2}
              />
            </mesh>
            {/* Slender vertical pin connecting arches to ring */}
            <mesh position={[0, 1.85, 0]} castShadow>
              <cylinderGeometry args={[0.022, 0.026, 2.10, 8]} />
              <meshStandardMaterial color="#C0C8D4" roughness={0.06} metalness={0.95} envMapIntensity={4.5} />
            </mesh>

            {/* ── Base connector collars (where arches meet ground pad) ── */}
            {([-1.45, 1.45] as number[]).map((bx, bi) => (
              <group key={`collar-${bi}`}>
                <mesh position={[bx * 0.10, 0.18, bx > 0 ? 0.28 : -0.28]} castShadow>
                  <cylinderGeometry args={[0.062, 0.075, 0.36, 8]} />
                  <meshStandardMaterial color="#181A20" roughness={0.22} metalness={0.55} envMapIntensity={2.0} />
                </mesh>
              </group>
            ))}

            {/* ── 4 LED uplights at pad corners ── */}
            {([[-1.60, -1.60], [1.60, -1.60], [-1.60, 1.60], [1.60, 1.60]] as [number,number][]).map(([ux, uz], li) => (
              <group key={`upl-${li}`} position={[ux, 0.014, uz]}>
                {/* Uplight housing */}
                <mesh>
                  <cylinderGeometry args={[0.055, 0.065, 0.028, 8]} />
                  <meshStandardMaterial color="#484858" roughness={0.35} metalness={0.75} />
                </mesh>
                {/* Lens */}
                <mesh position={[0, 0.022, 0]}>
                  <cylinderGeometry args={[0.042, 0.042, 0.010, 8]} />
                  <meshStandardMaterial
                    color="#FFFAE0" emissive="#FFE880"
                    emissiveIntensity={isNightSc ? 2.8 : isDuskSc ? 1.2 : 0.2}
                    roughness={0.60} transparent opacity={0.95}
                  />
                </mesh>
                {uplightI > 0 && (
                  <spotLight
                    position={[0, 0.05, 0]}
                    target-position={[ux * -0.6, 2.0, uz * -0.6]}
                    intensity={uplightI}
                    distance={5.5}
                    angle={Math.PI * 0.16}
                    penumbra={0.55}
                    decay={2}
                    color="#FFF0C8"
                    castShadow={false}
                  />
                )}
              </group>
            ))}

            {/* Pool underwater light */}
            {uplightI > 0 && (
              <pointLight position={[0, -0.05, 0]} intensity={uplightI * 0.5} distance={1.8} decay={2} color="#20A8E0" />
            )}
          </group>
        );
      })()}

      {/* ── 5e-1b. 北庭院圆形喷泉（circular fountain in north yard）──
           Polished granite circular basin with single vertical water jet.
           Glowing at dusk/night with underwater LED. */}
      {!insideBuilding && isGlassVilla && (() => {
        const ftnX = -W * 0.28;  // slightly west to avoid sculpture
        const ftnZ =  D / 2 + 2.00;
        const ftnR = 0.72;   // basin radius
        const ftnWallH = 0.22;  // basin wall height
        const ftnWallT = 0.08;  // wall thickness
        const jetH  = 0.55;   // water jet height above water surface
        const isNightFtn = sunHour < 6 || sunHour > 20;
        const isDuskFtn  = !isNightFtn && (sunHour < 8 || sunHour > 18);
        const ftnGlowI   = isNightFtn ? 1.8 : isDuskFtn ? 0.8 : 0.04;
        const ftnLI      = isNightFtn ? 3.0 : isDuskFtn ? 1.5 : 0.0;
        return (
          <group position={[ftnX, 0, ftnZ]}>
            {/* Basin base / surround paving disc */}
            <mesh position={[0, 0.010, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <circleGeometry args={[ftnR + 0.40, 16]} />
              <meshStandardMaterial color="#C8C0A8" roughness={0.72} metalness={0.02} />
            </mesh>
            {/* Basin outer wall — dark polished granite ring */}
            <mesh position={[0, ftnWallH / 2, 0]} castShadow>
              <cylinderGeometry args={[ftnR, ftnR, ftnWallH, 16, 1, true]} />
              <meshStandardMaterial color="#1C1E24" roughness={0.14} metalness={0.55} envMapIntensity={3.0} side={THREE.DoubleSide} />
            </mesh>
            {/* Basin coping — polished top rim */}
            <mesh position={[0, ftnWallH + 0.012, 0]}>
              <cylinderGeometry args={[ftnR + 0.020, ftnR + 0.020, 0.030, 16]} />
              <meshStandardMaterial color="#2C3040" roughness={0.10} metalness={0.80} envMapIntensity={3.5} />
            </mesh>
            {/* Inner basin floor */}
            <mesh position={[0, 0.010, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[ftnR - ftnWallT, 14]} />
              <meshStandardMaterial color="#1A2028" roughness={0.45} metalness={0.25} />
            </mesh>
            {/* Water surface */}
            <mesh position={[0, ftnWallH - 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={12}>
              <circleGeometry args={[ftnR - ftnWallT - 0.01, 14]} />
              <meshStandardMaterial
                color="#60B8D8"
                transparent opacity={0.82}
                roughness={0.02} metalness={0.06}
                envMapIntensity={5.0}
                emissive="#3090B8" emissiveIntensity={ftnGlowI}
                depthWrite={false}
              />
            </mesh>
            {/* Central water jet — tapered cylinder */}
            <mesh position={[0, ftnWallH + jetH / 2, 0]}>
              <cylinderGeometry args={[0.018, 0.030, jetH, 8]} />
              <meshStandardMaterial
                color="#90D8F0"
                transparent opacity={0.70}
                roughness={0.04} metalness={0.02}
                emissive="#60C8E8" emissiveIntensity={ftnGlowI * 0.8}
              />
            </mesh>
            {/* Spray mist at top */}
            <mesh position={[0, ftnWallH + jetH + 0.05, 0]}>
              <sphereGeometry args={[0.065, 8, 6]} />
              <meshStandardMaterial
                color="#C8E8F8"
                transparent opacity={0.55}
                roughness={0.60} metalness={0.02}
              />
            </mesh>
            {/* Underwater LED point light */}
            {ftnLI > 0 && (
              <pointLight position={[0, ftnWallH * 0.3, 0]} intensity={ftnLI} distance={ftnR * 2.5} decay={2.0} color="#40B8E0" castShadow={false} />
            )}
          </group>
        );
      })()}

      {/* ── 5e-1c. 北庭院锦鲤池（koi pond, north-east garden）──
           Oval stone-edged koi pond with lily pads and orange/white fish
           silhouettes visible through the water. Night: blue LED glow. */}
      {!insideBuilding && isGlassVilla && (() => {
        const kpX = W * 0.28;
        const kpZ = D / 2 + 2.10;
        const kpRX = 1.10;   // pond radius X (east-west)
        const kpRZ = 0.72;   // pond radius Z (north-south)
        const kpDp = 0.32;   // pond depth
        const kpY  = 0;
        const isNightK = sunHour < 6 || sunHour > 20;
        const isDuskK  = !isNightK && (sunHour < 8 || sunHour > 18);
        const kpGlowI  = isNightK ? 1.6 : isDuskK ? 0.7 : 0.04;
        const kpLI     = isNightK ? 2.8 : isDuskK ? 1.2 : 0.0;
        return (
          <group position={[kpX, kpY, kpZ]}>
            {/* Paving surround disc */}
            <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[(kpRX + 0.55) * 2, (kpRZ + 0.55) * 2]} />
              <meshStandardMaterial color="#C8C0A8" roughness={0.74} metalness={0.02} />
            </mesh>
            {/* Stone coping rim — slightly elliptical approximated with a torus-like shape */}
            <mesh position={[0, kpDp / 2, 0]}>
              <torusGeometry args={[Math.max(kpRX, kpRZ) * 0.97, 0.09, 6, 18]} />
              <meshStandardMaterial color="#D4CEC0" roughness={0.68} metalness={0.02} />
            </mesh>
            {/* Pond basin — deep dark green pool */}
            <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[kpRX * 1.80, kpRZ * 1.80]} />
              <meshStandardMaterial color="#1A2818" roughness={0.60} metalness={0.10} />
            </mesh>
            {/* Water surface — translucent dark green-blue */}
            <mesh position={[0, kpDp - 0.022, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={12}>
              <planeGeometry args={[kpRX * 1.78, kpRZ * 1.78]} />
              <meshStandardMaterial
                color="#2A6040"
                transparent opacity={0.80}
                roughness={0.03} metalness={0.08}
                envMapIntensity={4.5}
                emissive="#1A5030" emissiveIntensity={kpGlowI * 0.6}
                depthWrite={false}
              />
            </mesh>
            {/* Lily pads — 5 flat green discs floating */}
            {([[-0.40, -0.10], [0.20, 0.15], [-0.10, 0.22], [0.42, -0.08], [-0.55, 0.08]] as [number,number][]).map(([lx, lz], li) => (
              <mesh key={li} position={[lx, kpDp - 0.010, lz]} rotation={[-Math.PI / 2, 0, li * 0.8]}>
                <circleGeometry args={[0.095 + (li % 3) * 0.030, 10]} />
                <meshStandardMaterial color={li % 2 === 0 ? "#2E6820" : "#3A7828"} roughness={0.94} />
              </mesh>
            ))}
            {/* Lily flowers (2) — small white/pink cones above water */}
            {([[0.22, 0.15, "#F5E8E0"], [-0.10, 0.22, "#FFD0D0"]] as [number, number, string][]).map(([lx, lz, col], li) => (
              <mesh key={li} position={[lx, kpDp + 0.030, lz]}>
                <coneGeometry args={[0.030, 0.055, 6]} />
                <meshStandardMaterial color={col} roughness={0.90} />
              </mesh>
            ))}
            {/* Koi fish silhouettes — flat elongated ovals just below surface */}
            {([[-0.20, 0.05, "#E85020", 0.40], [0.30, -0.05, "#F8F8F8", 0.30], [-0.45, -0.12, "#E87030", 0.36]] as [number,number,string,number][]).map(([fx, fz, fc, fr], fi) => (
              <mesh key={fi} position={[fx, kpDp - 0.040, fz]} rotation={[-Math.PI / 2, 0, fi * 1.0]}>
                <planeGeometry args={[fr, fr * 0.38]} />
                <meshStandardMaterial color={fc} transparent opacity={0.70} roughness={0.55} />
              </mesh>
            ))}
            {/* Underwater LED glow */}
            {kpLI > 0 && (
              <pointLight position={[0, 0.04, 0]} intensity={kpLI} distance={kpRX * 2.5} decay={2.0} color="#20A060" castShadow={false} />
            )}
          </group>
        );
      })()}

      {/* ── 5e-1d. 西侧界墙爬墙月季（climbing roses on west boundary wall）──
           Similar to bougainvillea on east wall but red/pink climbing roses
           for variety. Adds symmetry and lush organic texture. */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndW6 = -W / 2 - 4.50;
        const wallH6 = 0.88;
        const wallT6 = 0.18;
        const wallX6 = bndW6 + wallT6 / 2;
        const vineLen6 = (D + 7.20) * 0.55;
        const vineBottom6 = wallH6 * 0.15;
        return (
          <group>
            {Array.from({ length: 20 }, (_, vi) => {
              const vHash = (vi * 19 + 11) % 17;
              const vy = vineBottom6 + (vi / 19) * vineLen6;
              const vz = -D / 2 - 2.50 + (vHash % 9) * 0.60;
              const vx = wallX6 + wallT6 / 2 + 0.01 + (vHash % 3) * 0.085;
              const vr = 0.14 + (vHash % 4) * 0.050;
              const vCol = vHash % 5 === 0 ? "#2A6018" : vHash % 5 === 1 ? "#C01840" : vHash % 5 === 2 ? "#D83060" : vHash % 5 === 3 ? "#E04070" : "#C83050";
              return (
                <mesh key={vi} position={[vx, vy, vz]}>
                  <sphereGeometry args={[vr, 7, 5]} />
                  <meshStandardMaterial color={vCol} roughness={0.95} />
                </mesh>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5e-2. 旗杆（flagpole, NE corner of boundary）──
           Stainless steel tapered pole, 8m tall. Flag represented as a
           flat rectangle with subtle drape offset at the fly end. */}
      {!insideBuilding && isGlassVilla && (() => {
        const isNightF  = sunHour < 6 || sunHour > 20;
        const flagX     =  W / 2 + 3.80;   // near NE corner
        const flagZ     =  D / 2 + 2.60;
        const poleH     = 8.0;
        // Flag dimensions
        const flagW     = 1.50;
        const flagH     = 1.00;
        const flagY     = poleH - flagH / 2 - 0.10;
        // Halyard line — thin vertical strip
        const hCol      = "#D0D4D8";
        // Flag color — red with small yellow stars (simplified: red body + yellow corner)
        const flagEmi   = isNightF ? 0.08 : 0.0;
        return (
          <group position={[flagX, 0, flagZ]}>
            {/* Pole — tapered stainless cylinder */}
            <mesh position={[0, poleH / 2, 0]} castShadow>
              <cylinderGeometry args={[0.025, 0.042, poleH, 8]} />
              <meshStandardMaterial color="#C0C8D0" roughness={0.18} metalness={0.92} envMapIntensity={2.5} />
            </mesh>
            {/* Base flange disc */}
            <mesh position={[0, 0.06, 0]}>
              <cylinderGeometry args={[0.14, 0.14, 0.12, 8]} />
              <meshStandardMaterial color="#9AA0A8" roughness={0.30} metalness={0.82} />
            </mesh>
            {/* Ball finial at top */}
            <mesh position={[0, poleH + 0.05, 0]}>
              <sphereGeometry args={[0.055, 8, 6]} />
              <meshStandardMaterial color="#D4D8E0" roughness={0.14} metalness={0.94} envMapIntensity={3.0} />
            </mesh>
            {/* Halyard line */}
            <mesh position={[0.032, poleH / 2, 0]}>
              <boxGeometry args={[0.004, poleH, 0.004]} />
              <meshStandardMaterial color={hCol} roughness={0.55} />
            </mesh>
            {/* Flag body — red field */}
            <mesh position={[flagW / 2 + 0.04, flagY, 0.012]}>
              <boxGeometry args={[flagW, flagH, 0.008]} />
              <meshStandardMaterial
                color="#DE2020"
                emissive="#CC1010"
                emissiveIntensity={flagEmi}
                roughness={0.80}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* Flag — yellow canton (upper left quarter) */}
            <mesh position={[0.04 + flagW * 0.18, flagY + flagH * 0.20, 0.018]}>
              <boxGeometry args={[flagW * 0.38, flagH * 0.52, 0.008]} />
              <meshStandardMaterial color="#FFD040" roughness={0.82} side={THREE.DoubleSide} />
            </mesh>
            {/* Large star centre */}
            <mesh position={[0.04 + flagW * 0.12, flagY + flagH * 0.20, 0.024]}>
              <sphereGeometry args={[0.075, 6, 4]} />
              <meshStandardMaterial color="#FFD800" roughness={0.75} />
            </mesh>
            {/* 4 small arc stars (simplified spheres) */}
            {([
              [0.255, 0.32],  // top star
              [0.315, 0.20],  // right star
              [0.255, 0.08],  // bottom star
              [0.195, 0.20],  // left star
            ] as [number,number][]).map(([sxF, syF], si) => (
              <mesh key={si} position={[0.04 + sxF, flagY - flagH / 2 + flagH * syF + flagH * 0.02, 0.024]}>
                <sphereGeometry args={[0.035, 5, 4]} />
                <meshStandardMaterial color="#FFD800" roughness={0.75} />
              </mesh>
            ))}
            {/* Night ground-spot for pole base */}
            {isNightF && (
              <pointLight position={[0, 1.0, 0]} intensity={1.5} distance={4.0} decay={2.0} color="#FFF4E0" />
            )}
          </group>
        );
      })()}

      {/* ── 5f. 庭院绿篱（hedge rows inside boundary wall）── */}
      {!insideBuilding && isGlassVilla && (() => {
        // Boxwood-style clipped hedge rows along east/west inner boundary
        const bndE2  =  W / 2 + 4.50;
        const bndW2  = -W / 2 - 4.50;
        const bndN2  =  D / 2 + 3.20;
        const bndS2  = -D / 2 - 14.50;
        const hedgeH = 0.90;   // hedge height
        const hedgeW = 0.52;   // hedge width/depth
        const gapS   = 0.32;   // gap from boundary wall face
        const hedgeCol = "#2A5A1C";
        const hedgeDk  = "#1E4816";
        // East hedge: inner side of east wall, north-to-south
        const eHedgeLen = bndN2 - bndS2 - 1.0;
        const eHedgeZ   = (bndN2 + bndS2) / 2;
        // West hedge similarly
        return (
          <group>
            {/* East hedge row */}
            <mesh position={[bndE2 - hedgeW / 2 - gapS, hedgeH / 2, eHedgeZ]} castShadow receiveShadow>
              <boxGeometry args={[hedgeW, hedgeH, eHedgeLen]} />
              <meshStandardMaterial color={hedgeCol} roughness={0.96} metalness={0.01} />
            </mesh>
            {/* East hedge top rounded effect — thin darker strip */}
            <mesh position={[bndE2 - hedgeW / 2 - gapS, hedgeH + 0.06, eHedgeZ]}>
              <boxGeometry args={[hedgeW - 0.04, 0.12, eHedgeLen - 0.04]} />
              <meshStandardMaterial color={hedgeDk} roughness={0.97} metalness={0.01} />
            </mesh>
            {/* West hedge row */}
            <mesh position={[bndW2 + hedgeW / 2 + gapS, hedgeH / 2, eHedgeZ]} castShadow receiveShadow>
              <boxGeometry args={[hedgeW, hedgeH, eHedgeLen]} />
              <meshStandardMaterial color={hedgeCol} roughness={0.96} metalness={0.01} />
            </mesh>
            <mesh position={[bndW2 + hedgeW / 2 + gapS, hedgeH + 0.06, eHedgeZ]}>
              <boxGeometry args={[hedgeW - 0.04, 0.12, eHedgeLen - 0.04]} />
              <meshStandardMaterial color={hedgeDk} roughness={0.97} metalness={0.01} />
            </mesh>
            {/* North hedge row */}
            <mesh position={[0, hedgeH / 2, bndN2 - hedgeW / 2 - gapS]} castShadow receiveShadow>
              <boxGeometry args={[bndE2 - bndW2 - 1.0, hedgeH, hedgeW]} />
              <meshStandardMaterial color={hedgeCol} roughness={0.96} metalness={0.01} />
            </mesh>
            <mesh position={[0, hedgeH + 0.06, bndN2 - hedgeW / 2 - gapS]}>
              <boxGeometry args={[bndE2 - bndW2 - 1.04, 0.12, hedgeW - 0.04]} />
              <meshStandardMaterial color={hedgeDk} roughness={0.97} metalness={0.01} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5f-2. 花坛 + 踏石小径（flower beds + stepping-stone path）──
           East and west garden beds flanking the driveway, filled with layered
           flower clusters.  A stepping-stone path runs the length of the garden. */}
      {!insideBuilding && isGlassVilla && (() => {
        // Shared constants from section 5d
        const bndS3   = -D / 2 - 14.50;
        const bndE3   =  W / 2 + 4.50;
        const bndW3   = -W / 2 - 4.50;
        const gapS3   = 0.12;         // gap between hedge and wall
        const hedgeW3 = 0.52;
        // Garden bed occupies the strip between hedge and driveway centreline
        const driveHalfW = 2.20;     // half width of driveway

        // East bed
        const ebX1 = driveHalfW;
        const ebX2 = bndE3 - hedgeW3 - gapS3 * 2;
        const bedW = ebX2 - ebX1;
        const bedMidX_E = (ebX1 + ebX2) / 2;
        const bedMidX_W = -(ebX1 + ebX2) / 2;

        // Bed Z: from behind building terrace to north edge of pool deck
        const poolL3 = Math.min(D * 0.70, 9.50);
        const deckBW3 = 2.80;
        const poolZ3 = -D / 2 - deckBW3 - poolL3 / 2 - 0.80;
        const poolDeckW3 = Math.min(W * 0.78, 11.0);
        const bedZN = poolZ3 - poolL3 / 2 - deckBW3 - 0.10;
        const bedZS = bndS3 + 1.50;  // well inside boundary wall
        const bedLen = Math.abs(bedZN - bedZS);
        const bedMidZ = (bedZN + bedZS) / 2;

        // Flower palette (deterministic via panelBlindHash)
        const flowerPalette = ["#FF4460", "#FF9922", "#FFD840", "#EE44CC", "#CC44FF", "#FFFFFF", "#FF7744"];
        const foliagePalette = ["#2E5818", "#3A6E22", "#245414", "#1E4410", "#4A7A28"];

        // Scatter N flower clusters per bed
        const flowerCount = 18;

        return (
          <group>
            {/* Soil base — E bed */}
            <mesh position={[bedMidX_E, 0.012, bedMidZ]} receiveShadow>
              <boxGeometry args={[bedW, 0.024, bedLen]} />
              <meshStandardMaterial color="#4A3020" roughness={0.98} metalness={0.00} />
            </mesh>
            {/* Soil base — W bed */}
            <mesh position={[bedMidX_W, 0.012, bedMidZ]} receiveShadow>
              <boxGeometry args={[bedW, 0.024, bedLen]} />
              <meshStandardMaterial color="#4A3020" roughness={0.98} metalness={0.00} />
            </mesh>

            {/* Flower clusters — east bed */}
            {Array.from({ length: flowerCount }, (_, fi3) => {
              const fHash = panelBlindHash(fi3 * 17 + 3, fi3 + 11);
              const fHash2 = panelBlindHash(fi3 * 7 + 5, fi3 * 3 + 2);
              const fHash3 = panelBlindHash(fi3 * 13 + 1, fi3 * 5 + 7);
              const fx = bedMidX_E - bedW / 2 + 0.20 + fHash * (bedW - 0.40);
              const fz = bedMidZ - bedLen / 2 + 0.20 + fHash2 * (bedLen - 0.40);
              const stemH = 0.22 + fHash3 * 0.18;
              const bloomR = 0.09 + fHash * 0.07;
              const flowerIdx = Math.floor(fHash3 * flowerPalette.length);
              const foliageIdx = Math.floor(fHash2 * foliagePalette.length);
              return (
                <group key={`fe-${fi3}`} position={[fx, 0.024, fz]}>
                  {/* Foliage mound */}
                  <mesh position={[0, stemH * 0.40, 0]}>
                    <sphereGeometry args={[bloomR * 1.1, 6, 5]} />
                    <meshStandardMaterial color={foliagePalette[foliageIdx]} roughness={0.95} />
                  </mesh>
                  {/* Bloom sphere */}
                  <mesh position={[0, stemH, 0]}>
                    <sphereGeometry args={[bloomR, 6, 5]} />
                    <meshStandardMaterial color={flowerPalette[flowerIdx]} roughness={0.80} emissive={flowerPalette[flowerIdx]} emissiveIntensity={0.12} />
                  </mesh>
                </group>
              );
            })}

            {/* Flower clusters — west bed (mirrored with different hashes) */}
            {Array.from({ length: flowerCount }, (_, fi3) => {
              const fHash = panelBlindHash(fi3 * 19 + 7, fi3 + 17);
              const fHash2 = panelBlindHash(fi3 * 11 + 3, fi3 * 7 + 5);
              const fHash3 = panelBlindHash(fi3 * 5 + 9, fi3 * 13 + 3);
              const fx = bedMidX_W - bedW / 2 + 0.20 + fHash * (bedW - 0.40);
              const fz = bedMidZ - bedLen / 2 + 0.20 + fHash2 * (bedLen - 0.40);
              const stemH = 0.22 + fHash3 * 0.18;
              const bloomR = 0.09 + fHash * 0.07;
              const flowerIdx = Math.floor(fHash3 * flowerPalette.length);
              const foliageIdx = Math.floor(fHash2 * foliagePalette.length);
              return (
                <group key={`fw-${fi3}`} position={[fx, 0.024, fz]}>
                  <mesh position={[0, stemH * 0.40, 0]}>
                    <sphereGeometry args={[bloomR * 1.1, 6, 5]} />
                    <meshStandardMaterial color={foliagePalette[foliageIdx]} roughness={0.95} />
                  </mesh>
                  <mesh position={[0, stemH, 0]}>
                    <sphereGeometry args={[bloomR, 6, 5]} />
                    <meshStandardMaterial color={flowerPalette[flowerIdx]} roughness={0.80} emissive={flowerPalette[flowerIdx]} emissiveIntensity={0.12} />
                  </mesh>
                </group>
              );
            })}

            {/* ── 踏石小径（stepping-stone path）──
                 East and west side paths from entry apron to pool deck,
                 square travertine slabs set in the lawn. */}
            {([-driveHalfW - 0.65, driveHalfW + 0.65] as number[]).map((pathX, pathI) => {
              const stoneSpacing = 0.72;
              const stoneCount = Math.max(3, Math.round(bedLen / stoneSpacing));
              return (
                <group key={`path-${pathI}`}>
                  {Array.from({ length: stoneCount }, (_, si) => {
                    const sz = bedZN + si * (bedLen / (stoneCount - 1));
                    const sHash = panelBlindHash(si * 13 + pathI * 77, si + 3);
                    const stoneW = 0.42 + sHash * 0.08;
                    const stoneD = 0.42 + panelBlindHash(si * 7 + pathI * 33, si) * 0.08;
                    const rotY = (sHash - 0.5) * 0.18;  // slight random rotation
                    return (
                      <mesh key={si} position={[pathX, 0.016, sz]} rotation={[0, rotY, 0]} receiveShadow>
                        <boxGeometry args={[stoneW, 0.032, stoneD]} />
                        <meshStandardMaterial color="#D8CEB8" roughness={0.82} metalness={0.02} />
                      </mesh>
                    );
                  })}
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5g. 泳池边休闲区（pool-side loungers + outdoor dining table）──
           Matches the updated section 5c pool dimensions.
           5 loungers in a row between pool and building (like reference image). */}
      {!insideBuilding && isGlassVilla && (() => {
        // Must mirror section 5c dimensions exactly
        const poolL2  = Math.min(D * 0.70, 9.50);
        const poolW2  = Math.min(W * 0.78, 11.0);
        const deckBW2 = 2.80;
        const deckT2  = 0.12;
        const pz2     = -D / 2 - deckBW2 - poolL2 / 2 - 0.80;
        // Building-side deck edge (closer to z=0 / closer to building)
        // Pool center is at pz2 (negative). Building side = pz2 + poolL/2 (less negative).
        // Deck extends deckBW2 further toward building from pool's building-side edge.
        const deckEdgeBldg = pz2 + poolL2 / 2 + deckBW2;  // building-side edge of deck
        const loungerColor = "#EDE6D2";
        const loungerMetal = "#B0B8C4";
        // 5 loungers between pool and building, in a row parallel to facade
        const nLoungers = 5;
        const loungerSpacing = Math.min(poolW2 * 0.70 / nLoungers, 1.90);
        const loungerRowZ = deckEdgeBldg - 1.20;   // 1.2m toward pool from building-side deck edge
        const loungerRowX0 = -(nLoungers - 1) * loungerSpacing / 2;
        return (
          <group>
            {/* North-side loungers in a row (facing pool / south) */}
            {Array.from({ length: nLoungers }, (_, li) => (
              <group key={li} position={[loungerRowX0 + li * loungerSpacing, deckT2, loungerRowZ]} rotation={[0, Math.PI, 0]}>
                {/* Frame */}
                <mesh position={[0, 0.19, 0]} castShadow>
                  <boxGeometry args={[0.55, 0.06, 1.70]} />
                  <meshStandardMaterial color={loungerMetal} roughness={0.22} metalness={0.88} />
                </mesh>
                {/* Cushion */}
                <mesh position={[0, 0.26, 0]}>
                  <boxGeometry args={[0.47, 0.09, 1.54]} />
                  <meshStandardMaterial color={loungerColor} roughness={0.88} />
                </mesh>
                {/* Backrest tilt */}
                <mesh position={[0, 0.34, 0.48]} rotation={[-0.28, 0, 0]}>
                  <boxGeometry args={[0.45, 0.07, 0.60]} />
                  <meshStandardMaterial color={loungerColor} roughness={0.88} />
                </mesh>
                {/* Legs */}
                {([-0.22, 0.22] as number[]).flatMap(lx2 =>
                  ([-0.68, 0.68] as number[]).map((lz2, ki) => (
                    <mesh key={`${lx2}-${ki}`} position={[lx2, 0.09, lz2]} castShadow>
                      <boxGeometry args={[0.032, 0.18, 0.032]} />
                      <meshStandardMaterial color={loungerMetal} roughness={0.20} metalness={0.90} />
                    </mesh>
                  ))
                )}
              </group>
            ))}
            {/* Note: no umbrella over lounger row — the building cantilever provides shade */}
            {/* Dining area umbrella (east side of pool deck) */}
            <group position={[poolW2 / 2 + deckBW2 * 0.5, deckT2, pz2]}>
              <mesh position={[0, 1.20, 0]} castShadow>
                <cylinderGeometry args={[0.030, 0.034, 2.40, 8]} />
                <meshStandardMaterial color="#E8EAE4" roughness={0.45} metalness={0.30} />
              </mesh>
              <mesh position={[0, 2.40, 0]}>
                <coneGeometry args={[1.40, 0.50, 8, 1, true]} />
                <meshStandardMaterial color="#C8D4E0" roughness={0.82} side={THREE.DoubleSide} transparent opacity={0.90} />
              </mesh>
              <mesh position={[0, 2.66, 0]}>
                <sphereGeometry args={[0.038, 6, 5]} />
                <meshStandardMaterial color="#B0B8C4" roughness={0.55} />
              </mesh>
              <mesh position={[0, 0.06, 0]}>
                <cylinderGeometry args={[0.20, 0.20, 0.12, 8]} />
                <meshStandardMaterial color="#5A5850" roughness={0.60} metalness={0.30} />
              </mesh>
            </group>
            {/* Outdoor dining table (east side of pool deck, on deck surface) */}
            <group position={[poolW2 / 2 + deckBW2 * 0.5, deckT2, pz2]}>
              {/* Table top */}
              <mesh position={[0, 0.74, 0]} castShadow>
                <boxGeometry args={[1.60, 0.040, 0.90]} />
                <meshStandardMaterial color="#C8BFA8" roughness={0.60} metalness={0.08} envMapIntensity={0.9} />
              </mesh>
              {/* Central pedestal */}
              <mesh position={[0, 0.40, 0]}>
                <cylinderGeometry args={[0.038, 0.050, 0.72, 8]} />
                <meshStandardMaterial color="#8A9098" roughness={0.30} metalness={0.72} />
              </mesh>
              {/* Base cross */}
              <mesh position={[0, 0.040, 0]}>
                <boxGeometry args={[0.80, 0.04, 0.12]} />
                <meshStandardMaterial color="#8A9098" roughness={0.30} metalness={0.72} />
              </mesh>
              <mesh position={[0, 0.040, 0]} rotation={[0, Math.PI / 2, 0]}>
                <boxGeometry args={[0.80, 0.04, 0.12]} />
                <meshStandardMaterial color="#8A9098" roughness={0.30} metalness={0.72} />
              </mesh>
              {/* 4 chairs around table */}
              {([
                [0,      0.90,  0   ],
                [0,     -0.90,  0   ],
                [ 0.88,  0,     Math.PI / 2],
                [-0.88,  0,    -Math.PI / 2],
              ] as [number, number, number][]).map(([chx, chz, chRot], ci) => (
                <group key={ci} position={[chx, 0, chz]} rotation={[0, chRot, 0]}>
                  <mesh position={[0, 0.46, 0]} castShadow>
                    <boxGeometry args={[0.44, 0.040, 0.44]} />
                    <meshStandardMaterial color="#DDD4C0" roughness={0.82} />
                  </mesh>
                  <mesh position={[0, 0.82, 0.18]} rotation={[-0.15, 0, 0]}>
                    <boxGeometry args={[0.40, 0.52, 0.030]} />
                    <meshStandardMaterial color="#D8CEB8" roughness={0.84} />
                  </mesh>
                  {/* 4 legs */}
                  {([-0.18, 0.18] as number[]).flatMap(clx =>
                    ([-0.18, 0.18] as number[]).map((clz, cki) => (
                      <mesh key={`${clx}-${cki}`} position={[clx, 0.22, clz]}>
                        <boxGeometry args={[0.028, 0.44, 0.028]} />
                        <meshStandardMaterial color="#9A9FA8" roughness={0.28} metalness={0.78} />
                      </mesh>
                    ))
                  )}
                </group>
              ))}
            </group>
          </group>
        );
      })()}

      {/* ── 5g-2. 餐桌区串灯（bistro string lights over dining area）──
           3 catenary string lines of warm globe bulbs spanning from pool
           deck pergola post to nearby tree, creating evening atmosphere. */}
      {!insideBuilding && isGlassVilla && (() => {
        const poolL2b  = Math.min(D * 0.70, 9.50);
        const poolW2b  = Math.min(W * 0.78, 11.0);
        const deckBW2b = 2.80;
        const pz2b     = -D / 2 - deckBW2b - poolL2b / 2 - 0.80;
        const diningX  = poolW2b / 2 + deckBW2b * 0.5;  // matches dining table in 5g
        const diningZ  = pz2b;
        const isNightSL = sunHour < 6 || sunHour > 20;
        const isDuskSL  = !isNightSL && (sunHour < 8 || sunHour > 18);
        const bulbEmi = isNightSL ? 3.5 : isDuskSL ? 1.8 : 0.0;
        const stringLI = isNightSL ? 2.5 : isDuskSL ? 1.2 : 0.0;

        if (bulbEmi === 0.0) return null;  // skip in full daylight

        // String line: from diningX-1.0, diningZ-1.5, h=2.8 to diningX+2.2, diningZ+1.5, h=3.0
        const lineHeight = 2.90;
        const globeR = 0.040;
        const globeCount = 7;

        return (
          <group>
            {/* Catenary string wire (thin box) — line 1 */}
            <mesh position={[diningX + 0.60, lineHeight - 0.12, diningZ]}>
              <boxGeometry args={[3.20, 0.005, 0.005]} />
              <meshStandardMaterial color="#2A2A2A" roughness={0.70} metalness={0.30} />
            </mesh>
            {/* Globe bulbs along line */}
            {Array.from({ length: globeCount }, (_, bi) => {
              const t = bi / (globeCount - 1);
              const bx = diningX - 1.00 + t * 3.20;
              // Catenary sag — deepest in middle
              const sag = Math.sin(t * Math.PI) * 0.14;
              const by = lineHeight - sag;
              return (
                <group key={bi} position={[bx, by, diningZ]}>
                  {/* Globe */}
                  <mesh>
                    <sphereGeometry args={[globeR, 8, 6]} />
                    <meshStandardMaterial
                      color="#FFF8E0"
                      emissive="#FFE060"
                      emissiveIntensity={bulbEmi}
                      roughness={0.55}
                      transparent opacity={0.88}
                    />
                  </mesh>
                  {/* Point light per bulb */}
                  {stringLI > 0 && (
                    <pointLight intensity={stringLI * 0.28} distance={2.0} decay={2.5} color="#FFE080" />
                  )}
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5g-5. 泳池旁景观大花盆（large ornamental planters on pool deck）──
           4 tall round concrete planters flanking the lounger row, each with a
           slender architectural plant (agave form). Pairs at both ends of the row. */}
      {!insideBuilding && isGlassVilla && (() => {
        const poolL_pl  = Math.min(D * 0.70, 9.50);
        const poolW_pl  = Math.min(W * 0.78, 11.0);
        const deckBW_pl = 2.80;
        const deckT_pl  = 0.12;
        const pz_pl     = -D / 2 - deckBW_pl - poolL_pl / 2 - 0.80;
        // Match lounger row Z exactly: deckEdge - 1.20 (same as section 5g)
        const planterZ  = pz_pl + poolL_pl / 2 + deckBW_pl - 1.20;
        // Two planters flanking the lounger row ends (just outside the row)
        const planterXs: number[] = [-poolW_pl * 0.40, poolW_pl * 0.40];
        const potR = 0.28;    // outer radius
        const potH = 0.50;    // pot height
        const plantH = 1.20;  // agave/ornamental grass height above pot
        return (
          <group>
            {planterXs.map((px, pi) => (
              <group key={pi} position={[px, deckT_pl, planterZ]}>
                {/* Concrete pot body — tapered cylinder */}
                <mesh position={[0, potH / 2, 0]} castShadow receiveShadow>
                  <cylinderGeometry args={[potR, potR * 0.76, potH, 12]} />
                  <meshStandardMaterial color="#C0BBAE" roughness={0.72} metalness={0.06} envMapIntensity={0.4} />
                </mesh>
                {/* Pot rim — slightly wider band at top */}
                <mesh position={[0, potH + 0.010, 0]} castShadow>
                  <cylinderGeometry args={[potR + 0.012, potR, 0.022, 12]} />
                  <meshStandardMaterial color="#B0ACA0" roughness={0.65} metalness={0.08} />
                </mesh>
                {/* Soil top */}
                <mesh position={[0, potH + 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[potR - 0.020, 10]} />
                  <meshStandardMaterial color="#3A2818" roughness={0.98} />
                </mesh>
                {/* Agave-form plant — central spire + radial blades */}
                <mesh position={[0, potH + plantH * 0.55, 0]} castShadow>
                  <coneGeometry args={[0.055, plantH * 0.70, 6]} />
                  <meshStandardMaterial color="#5A7A3A" roughness={0.92} />
                </mesh>
                {Array.from({ length: 8 }, (_, bi) => {
                  const bAng = (bi / 8) * Math.PI * 2;
                  const bLen = 0.38 + (bi % 3) * 0.06;
                  const bTilt = 0.55;
                  return (
                    <mesh key={bi} position={[Math.cos(bAng) * 0.12, potH + 0.15 + bLen * 0.25, Math.sin(bAng) * 0.12]}
                      rotation={[-bTilt * Math.cos(bAng + Math.PI / 2), bAng, bTilt * Math.sin(bAng + Math.PI / 2)]}>
                      <boxGeometry args={[0.032, bLen, 0.018]} />
                      <meshStandardMaterial color="#4A6A2E" roughness={0.92} />
                    </mesh>
                  );
                })}
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 5g-6. 泳池南端低矮植被边带（low planting border at pool south deck edge）──
           A continuous 0.35m-wide planting trough flush with the south deck edge.
           Alternating white agapanthus spheres + ornamental grass tufts, set into a
           dark Cor-ten steel trough. Frames the pool in the near foreground view. */}
      {!insideBuilding && isGlassVilla && (() => {
        const poolL_b  = Math.min(D * 0.70, 9.50);
        const poolW_b  = Math.min(W * 0.78, 11.0);
        const deckBW_b = 2.80;
        const deckT_b  = 0.12;
        const pz_b     = -D / 2 - deckBW_b - poolL_b / 2 - 0.80;
        const borderZ  = pz_b - poolL_b / 2 - deckBW_b + 0.20;  // 0.2m inside south deck edge
        const borderW  = poolW_b + deckBW_b * 1.8;               // full deck width
        const troughH  = 0.20;
        const troughD  = 0.34;
        const plantCount = Math.floor(borderW / 0.55);           // plant every 55cm
        return (
          <group position={[0, deckT_b, borderZ]}>
            {/* Cor-ten steel trough */}
            <mesh position={[0, troughH / 2, 0]} castShadow>
              <boxGeometry args={[borderW, troughH, troughD]} />
              <meshStandardMaterial color="#8B4C2A" roughness={0.72} metalness={0.28} envMapIntensity={0.6} />
            </mesh>
            {/* Soil top */}
            <mesh position={[0, troughH + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[borderW - 0.02, troughD - 0.02]} />
              <meshStandardMaterial color="#2C1E14" roughness={0.98} />
            </mesh>
            {/* Alternating plants: even = white agapanthus globe, odd = grass tuft */}
            {Array.from({ length: plantCount }, (_, pi) => {
              const px = -borderW / 2 + 0.28 + pi * (borderW - 0.56) / Math.max(1, plantCount - 1);
              const isGlobe = pi % 2 === 0;
              return (
                <group key={pi} position={[px, troughH, 0]}>
                  {isGlobe ? (
                    // White agapanthus globe
                    <mesh castShadow>
                      <sphereGeometry args={[0.14, 7, 5]} />
                      <meshStandardMaterial color="#F8F4F0" roughness={0.80} metalness={0.0} envMapIntensity={0.3} />
                    </mesh>
                  ) : (
                    // Ornamental grass tuft — 6 thin blades fanned out
                    <group>
                      {Array.from({ length: 6 }, (_, bi) => {
                        const ba = (bi / 6) * Math.PI * 1.8 - Math.PI * 0.4;
                        return (
                          <mesh key={bi} position={[0, 0.18, 0]}
                            rotation={[ba * 0.28, (bi / 6) * Math.PI * 2, 0]}>
                            <boxGeometry args={[0.010, 0.32, 0.008]} />
                            <meshStandardMaterial color="#6A8840" roughness={0.90} metalness={0.0} />
                          </mesh>
                        );
                      })}
                    </group>
                  )}
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5h. 室外厨房 / BBQ 台（outdoor kitchen, east terrace apron）── */}
      {!insideBuilding && isGlassVilla && (() => {
        const kitX = W / 2 + 0.85;         // east terrace apron center
        const kitZ = D / 2 - 1.80;          // north-east corner of terrace
        const isNightK = sunHour < 6 || sunHour > 20;
        return (
          <group position={[kitX, 0, kitZ]} rotation={[0, -Math.PI / 2, 0]}>
            {/* Counter top — dark granite */}
            <mesh position={[0, 0.92, 0]} castShadow receiveShadow>
              <boxGeometry args={[2.20, 0.042, 0.72]} />
              <meshStandardMaterial color="#1C1E24" roughness={0.18} metalness={0.38} envMapIntensity={2.0} />
            </mesh>
            {/* Cabinet body — white lacquer */}
            <mesh position={[0, 0.46, 0]} castShadow receiveShadow>
              <boxGeometry args={[2.20, 0.90, 0.70]} />
              <meshStandardMaterial color="#E8E4DC" roughness={0.60} metalness={0.08} />
            </mesh>
            {/* Cabinet door lines × 3 */}
            {([-0.68, 0, 0.68] as number[]).map((dx, di) => (
              <mesh key={di} position={[dx, 0.46, 0.358]}>
                <boxGeometry args={[0.60, 0.80, 0.008]} />
                <meshStandardMaterial color="#D8D4CC" roughness={0.55} metalness={0.10} />
              </mesh>
            ))}
            {/* Built-in BBQ grill — stainless */}
            <mesh position={[-0.62, 0.94, 0.02]}>
              <boxGeometry args={[0.58, 0.040, 0.62]} />
              <meshStandardMaterial color="#B0B8C4" roughness={0.22} metalness={0.84} envMapIntensity={2.4} />
            </mesh>
            {/* Grill bars × 5 */}
            {Array.from({ length: 5 }, (_, gi) => (
              <mesh key={gi} position={[-0.62, 0.97, -0.22 + gi * 0.11]}>
                <boxGeometry args={[0.50, 0.010, 0.016]} />
                <meshStandardMaterial color="#808890" roughness={0.28} metalness={0.82} />
              </mesh>
            ))}
            {/* Sink basin */}
            <mesh position={[0.52, 0.88, 0.04]}>
              <boxGeometry args={[0.42, 0.10, 0.54]} />
              <meshStandardMaterial color="#4A5060" roughness={0.38} metalness={0.50} />
            </mesh>
            {/* Faucet */}
            <mesh position={[0.52, 0.96, -0.22]}>
              <boxGeometry args={[0.015, 0.12, 0.015]} />
              <meshStandardMaterial color="#B8C4CC" roughness={0.18} metalness={0.92} />
            </mesh>
            <mesh position={[0.52, 1.02, -0.16]}>
              <boxGeometry args={[0.015, 0.015, 0.12]} />
              <meshStandardMaterial color="#B8C4CC" roughness={0.18} metalness={0.92} />
            </mesh>
            {/* Under-counter LED strip */}
            <mesh position={[0, 0.925, 0.358]}>
              <boxGeometry args={[2.10, 0.018, 0.014]} />
              <meshStandardMaterial
                color="#FFFDE0"
                emissive="#FFE890"
                emissiveIntensity={isNightK ? 2.2 : 0.3}
                roughness={0.5}
              />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5h-2. 户外厨房吧台凳（outdoor kitchen bar stools）──
           3 bar stools facing the kitchen counter for al-fresco dining.
           Dark steel frame, white leather seat pad. */}
      {!insideBuilding && isGlassVilla && (() => {
        const kitX2 = W / 2 + 0.85;
        const kitZ2 = D / 2 - 1.80;
        // Bar stools positioned 0.72m in front of kitchen counter
        // Kitchen is rotated -PI/2, so "in front" = positive X from kitchen centre
        return (
          <group>
            {[-0.65, 0, 0.65].map((offset, si) => {
              // Transform: kitchen rotated -90°, so stool Z offset becomes X offset in world
              const sX = kitX2 + 0.72;
              const sZ = kitZ2 + offset;
              return (
                <group key={si} position={[sX, 0, sZ]}>
                  {/* Seat cushion */}
                  <mesh position={[0, 0.76, 0]} castShadow>
                    <cylinderGeometry args={[0.18, 0.18, 0.040, 10]} />
                    <meshStandardMaterial color="#EEEAE4" roughness={0.72} metalness={0.04} />
                  </mesh>
                  {/* Seat frame ring */}
                  <mesh position={[0, 0.74, 0]}>
                    <torusGeometry args={[0.18, 0.010, 6, 10]} />
                    <meshStandardMaterial color="#484E5C" roughness={0.30} metalness={0.72} envMapIntensity={1.6} />
                  </mesh>
                  {/* Pedestal stem */}
                  <mesh position={[0, 0.38, 0]} castShadow>
                    <cylinderGeometry args={[0.022, 0.038, 0.74, 6]} />
                    <meshStandardMaterial color="#484E5C" roughness={0.32} metalness={0.70} envMapIntensity={1.4} />
                  </mesh>
                  {/* Base cross */}
                  {[0, Math.PI / 2].map((ra, ri) => (
                    <mesh key={ri} position={[0, 0.022, 0]} rotation={[0, ra, 0]}>
                      <boxGeometry args={[0.36, 0.018, 0.040]} />
                      <meshStandardMaterial color="#383C44" roughness={0.40} metalness={0.65} />
                    </mesh>
                  ))}
                  {/* Footrest ring */}
                  <mesh position={[0, 0.38, 0]}>
                    <torusGeometry args={[0.12, 0.008, 5, 10]} />
                    <meshStandardMaterial color="#484E5C" roughness={0.32} metalness={0.68} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5i. 泳池边室外淋浴（outdoor shower post near pool）── */}
      {!insideBuilding && isGlassVilla && (() => {
        const poolL3 = Math.min(D * 0.70, 9.50);
        const poolW3 = Math.min(W * 0.78, 11.0);
        const deckBW3i = 2.80;
        const pz3    = -D / 2 - deckBW3i - poolL3 / 2 - 0.80;
        const showerX = poolW3 / 2 + 0.85;   // east side of pool deck
        const showerZ = pz3 - 0.60;           // toward south end of pool
        const postH   = 2.30;
        const isNightS = sunHour < 6 || sunHour > 20;
        const isDuskS  = !isNightS && (sunHour < 8 || sunHour > 18);
        return (
          <group position={[showerX, 0, showerZ]}>
            {/* Base slab — circular terrazzo */}
            <mesh position={[0, 0.020, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.55, 12]} />
              <meshStandardMaterial color="#D4CEC0" roughness={0.60} metalness={0.04} />
            </mesh>
            {/* Post — brushed stainless */}
            <mesh position={[0, postH / 2, 0]} castShadow>
              <cylinderGeometry args={[0.028, 0.032, postH, 8]} />
              <meshStandardMaterial color="#B8C4CC" roughness={0.18} metalness={0.92} envMapIntensity={2.4} />
            </mesh>
            {/* Horizontal arm */}
            <mesh position={[0.28, postH - 0.04, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.016, 0.016, 0.56, 8]} />
              <meshStandardMaterial color="#B8C4CC" roughness={0.18} metalness={0.92} />
            </mesh>
            {/* Shower head — round disc */}
            <mesh position={[0.56, postH - 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.090, 0.090, 0.028, 12]} />
              <meshStandardMaterial color="#C0C8D0" roughness={0.20} metalness={0.86} envMapIntensity={2.0} />
            </mesh>
            {/* Shower head perforations — small dark dots */}
            {Array.from({ length: 6 }, (_, si) => {
              const sa = (si / 6) * Math.PI * 2;
              return (
                <mesh key={si} position={[0.56 + Math.cos(sa) * 0.045, postH - 0.04 - 0.016, Math.sin(sa) * 0.045]}>
                  <sphereGeometry args={[0.008, 4, 4]} />
                  <meshStandardMaterial color="#2A3038" roughness={0.5} metalness={0.3} />
                </mesh>
              );
            })}
            {/* Control valve handle */}
            <mesh position={[0.14, postH * 0.55, 0.035]}>
              <boxGeometry args={[0.016, 0.14, 0.016]} />
              <meshStandardMaterial color="#A8B0B8" roughness={0.22} metalness={0.88} />
            </mesh>
            {/* Night / dusk point light (warm glow near shower) */}
            {(isNightS || isDuskS) && (
              <pointLight position={[0.3, postH + 0.2, 0]} intensity={isNightS ? 1.5 : 0.8} distance={2.5} decay={2.0} color="#FFF4E0" />
            )}
          </group>
        );
      })()}

      {/* ── 5j. 东侧露台篝火盆 / 火坑（outdoor fire pit, east terrace）── */}
      {!insideBuilding && isGlassVilla && (() => {
        const fpX = W / 2 + 0.85;
        const fpZ = -D / 2 + 2.80;           // south part of east terrace
        const isNightF = sunHour < 6 || sunHour > 20;
        const isDuskF  = !isNightF && (sunHour < 8 || sunHour > 18);
        const fireGlow = isNightF ? 1.0 : isDuskF ? 0.6 : 0.0;
        return (
          <group position={[fpX, 0, fpZ]} rotation={[0, -Math.PI / 4, 0]}>
            {/* Base paving square */}
            <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[1.80, 1.80]} />
              <meshStandardMaterial color="#D0C8B4" roughness={0.78} metalness={0.02} />
            </mesh>
            {/* Fire bowl — dark weathering steel ring */}
            <mesh position={[0, 0.22, 0]}>
              <cylinderGeometry args={[0.36, 0.30, 0.44, 14, 1, true]} />
              <meshStandardMaterial color="#3A2820" roughness={0.72} metalness={0.28} side={THREE.DoubleSide} />
            </mesh>
            {/* Bowl base rim */}
            <mesh position={[0, 0.010, 0]}>
              <cylinderGeometry args={[0.32, 0.32, 0.020, 14]} />
              <meshStandardMaterial color="#2E2018" roughness={0.68} metalness={0.32} />
            </mesh>
            {/* Bowl top rim */}
            <mesh position={[0, 0.450, 0]}>
              <torusGeometry args={[0.36, 0.022, 6, 14]} />
              <meshStandardMaterial color="#282010" roughness={0.60} metalness={0.40} />
            </mesh>
            {/* Fire embers base */}
            <mesh position={[0, 0.26, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.26, 12]} />
              <meshStandardMaterial
                color="#FF4800"
                emissive="#FF3000"
                emissiveIntensity={fireGlow > 0 ? 2.8 : 0.1}
                roughness={0.95}
              />
            </mesh>
            {/* Flame logs — crossed cylinders */}
            {([0, Math.PI / 3, -Math.PI / 3] as number[]).map((fa, fi2) => (
              <mesh key={fi2} position={[0, 0.24, 0]} rotation={[Math.PI / 2, 0, fa]} castShadow>
                <cylinderGeometry args={[0.030, 0.038, 0.44, 6]} />
                <meshStandardMaterial color="#2C1A10" roughness={0.90} metalness={0.02} />
              </mesh>
            ))}
            {/* Flame light — orange point light at night / dusk */}
            {fireGlow > 0 && (
              <pointLight position={[0, 0.70, 0]} intensity={fireGlow * 8} distance={4.5} decay={1.8} color="#FF8020" castShadow={false} />
            )}
            {/* 4 surrounding seats — stone benches */}
            {([0, Math.PI / 2, Math.PI, -Math.PI / 2] as number[]).map((sa, si) => (
              <group key={si} position={[Math.sin(sa) * 0.85, 0, Math.cos(sa) * 0.85]} rotation={[0, sa, 0]}>
                <mesh position={[0, 0.36, 0]} castShadow>
                  <boxGeometry args={[0.44, 0.10, 0.38]} />
                  <meshStandardMaterial color="#B8B0A0" roughness={0.84} metalness={0.03} />
                </mesh>
                {/* Seat legs */}
                {([-0.16, 0.16] as number[]).map((slx, sli) => (
                  <mesh key={sli} position={[slx, 0.16, 0]} castShadow>
                    <boxGeometry args={[0.070, 0.32, 0.34]} />
                    <meshStandardMaterial color="#AEA898" roughness={0.86} metalness={0.02} />
                  </mesh>
                ))}
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 5j-1b. 东侧庭院日式枯山水禅园（Japanese zen garden, east yard NE corner）──
           White raked gravel, flat stepping stones, stone lantern, bamboo fence.
           Positioned in the north-east corner of the east side yard. */}
      {!insideBuilding && isGlassVilla && (() => {
        const zenX  =  W / 2 + 2.20;   // east of building
        const zenZ  =  D / 2 - 0.50;   // north-east corner of east yard
        const zenW  = 2.80;  // garden width (X)
        const zenD  = 2.60;  // garden depth (Z)
        const isNightZ = sunHour < 6 || sunHour > 20;
        const isDuskZ  = !isNightZ && (sunHour < 8 || sunHour > 18);
        const lanternGlow = isNightZ ? 1.8 : isDuskZ ? 0.9 : 0.0;
        return (
          <group position={[zenX, 0, zenZ]}>
            {/* White raked gravel base */}
            <mesh position={[0, 0.010, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[zenW, zenD]} />
              <meshStandardMaterial color="#ECEAE4" roughness={0.94} metalness={0.01} />
            </mesh>
            {/* Raking lines on gravel — subtle parallel grooves */}
            {Array.from({ length: 10 }, (_, ri) => (
              <mesh key={ri} position={[0, 0.012, -zenD / 2 + ri * (zenD / 9)]}>
                <boxGeometry args={[zenW - 0.10, 0.004, 0.022]} />
                <meshStandardMaterial color="#D8D4C8" roughness={0.96} />
              </mesh>
            ))}
            {/* Bamboo fence border on two sides (west and south) */}
            {/* West border */}
            <mesh position={[-zenW / 2 - 0.018, 0.55, 0]}>
              <boxGeometry args={[0.036, 1.10, zenD]} />
              <meshStandardMaterial color="#8A7040" roughness={0.82} metalness={0.02} />
            </mesh>
            {Array.from({ length: Math.round(zenD / 0.10) }, (_, bi) => (
              <mesh key={`bw-${bi}`} position={[-zenW / 2 - 0.018, -zenD / 2 + bi * 0.10 + 0.05, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.018, 0.020, zenD * 1.01, 6]} />
                <meshStandardMaterial color={bi % 2 === 0 ? "#9A8050" : "#7A6030"} roughness={0.85} />
              </mesh>
            ))}
            {/* Horizontal binding rails */}
            {[0.22, 0.65].map((ry, ri) => (
              <mesh key={`bwr-${ri}`} position={[-zenW / 2 - 0.018, ry, 0]}>
                <boxGeometry args={[0.008, 0.020, zenD]} />
                <meshStandardMaterial color="#4A3010" roughness={0.88} />
              </mesh>
            ))}
            {/* 3 flat stepping stones */}
            {([[-0.55, 0.30], [0, -0.10], [0.50, 0.45]] as [number, number][]).map(([sx, sz], si) => (
              <mesh key={si} position={[sx, 0.020, sz]} rotation={[0, (si * 0.5), 0]} castShadow>
                <boxGeometry args={[0.55 + (si % 2) * 0.10, 0.040, 0.45 + (si % 2) * 0.06]} />
                <meshStandardMaterial color={si % 2 === 0 ? "#8A8278" : "#7A7068"} roughness={0.80} metalness={0.04} />
              </mesh>
            ))}
            {/* Two garden rocks */}
            {([[-0.70, -0.60, 0.22, 0.35, 0.30], [0.65, 0.55, 0.18, 0.22, 0.28]] as [number,number,number,number,number][]).map(([rx, rz, rW2, rH, rD], ri) => (
              <mesh key={ri} position={[rx, rH / 2, rz]} rotation={[0, ri * 0.8, 0]} castShadow>
                <boxGeometry args={[rW2, rH, rD]} />
                <meshStandardMaterial color={ri === 0 ? "#6A6258" : "#585048"} roughness={0.86} metalness={0.06} />
              </mesh>
            ))}
            {/* Stone lantern (tōrō) */}
            <group position={[0.55, 0, -0.65]}>
              {/* Base plinth */}
              <mesh position={[0, 0.06, 0]}>
                <boxGeometry args={[0.22, 0.12, 0.22]} />
                <meshStandardMaterial color="#6A6258" roughness={0.82} metalness={0.04} />
              </mesh>
              {/* Post */}
              <mesh position={[0, 0.50, 0]} castShadow>
                <cylinderGeometry args={[0.055, 0.065, 0.78, 8]} />
                <meshStandardMaterial color="#7A7268" roughness={0.80} metalness={0.04} />
              </mesh>
              {/* Cap / fire chamber */}
              <mesh position={[0, 0.95, 0]} castShadow>
                <boxGeometry args={[0.28, 0.28, 0.28]} />
                <meshStandardMaterial color="#686058" roughness={0.78} metalness={0.05} />
              </mesh>
              {/* Glass fire chamber */}
              <mesh position={[0, 0.95, 0]}>
                <boxGeometry args={[0.22, 0.22, 0.22]} />
                <meshStandardMaterial
                  color="#FFF8C0"
                  transparent opacity={0.60}
                  roughness={0.10} metalness={0.02}
                  emissive="#FFE060" emissiveIntensity={lanternGlow}
                  side={THREE.DoubleSide}
                />
              </mesh>
              {/* Roof cap */}
              <mesh position={[0, 1.13, 0]} castShadow>
                <cylinderGeometry args={[0.05, 0.22, 0.28, 6]} />
                <meshStandardMaterial color="#5A5248" roughness={0.78} metalness={0.06} />
              </mesh>
              {/* Lantern glow point light */}
              {lanternGlow > 0 && (
                <pointLight position={[0, 0.95, 0]} intensity={lanternGlow * 2.5} distance={3.0} decay={2.0} color="#FFE890" castShadow={false} />
              )}
            </group>
            {/* Small bamboo plant cluster */}
            <group position={[-0.85, 0, -0.70]}>
              {[[-0.06, 1.60], [0, 2.00], [0.07, 1.75]].map(([bx2, bH2], ci) => (
                <group key={ci} position={[bx2, 0, 0]}>
                  <mesh castShadow>
                    <cylinderGeometry args={[0.016, 0.022, bH2, 6]} />
                    <meshStandardMaterial color="#6A8838" roughness={0.82} />
                  </mesh>
                  <mesh position={[0, bH2 * 0.55, 0]}>
                    <sphereGeometry args={[0.18, 6, 4]} />
                    <meshStandardMaterial color="#2E6818" roughness={0.94} />
                  </mesh>
                </group>
              ))}
            </group>
          </group>
        );
      })()}

      {/* ── 5j-1c. 东侧庭院瑜伽/冥想平台（yoga/meditation deck, east yard S section）──
           A 3.0m × 2.4m raised teak deck provides a dedicated mindfulness space
           in the south portion of the east yard. Enclosed on 3 sides by a
           split-bamboo privacy screen with integrated LED strip at top.
           A rolled yoga mat, 2 meditation cushions, and a small incense holder
           add personality. Overhead: a stretched canvas shade sail. */}
      {!insideBuilding && isGlassVilla && (() => {
        const ydX  =  W / 2 + 2.20;   // east yard
        const ydZ  = -D / 2 + 2.00;   // south portion of east yard
        const ydW  = 2.40;   // deck width (E-W)
        const ydD  = 3.00;   // deck depth (N-S)
        const deckH = 0.16;  // deck platform height
        const screenH = 1.80;
        const isNightYD = sunHour < 6 || sunHour > 20;
        const isDuskYD  = !isNightYD && (sunHour < 8 || sunHour > 18);
        const ledEmiYD  = isNightYD ? 2.0 : isDuskYD ? 0.9 : 0.0;
        const ledLI     = isNightYD ? 2.5 : isDuskYD ? 1.0 : 0.0;

        return (
          <group position={[ydX, 0, ydZ]}>
            {/* Teak deck platform */}
            <mesh position={[0, deckH / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[ydW, deckH, ydD]} />
              <meshStandardMaterial color="#7A4E28" roughness={0.72} metalness={0.03} />
            </mesh>
            {/* Deck plank grooves (N-S running) */}
            {Array.from({ length: 6 }, (_, pi) => {
              const px = -ydW / 2 + (pi + 0.5) * (ydW / 6);
              return (
                <mesh key={pi} position={[px, deckH + 0.001, 0]}>
                  <boxGeometry args={[0.008, 0.004, ydD - 0.04]} />
                  <meshStandardMaterial color="#5A3418" roughness={0.85} />
                </mesh>
              );
            })}

            {/* ── South bamboo screen (3 sides: south, west, east partial) ── */}
            {/* South screen */}
            {Array.from({ length: 9 }, (_, bi) => {
              const bz = -ydD / 2 + bi * (ydD / 8);
              return (
                <mesh key={`bs-${bi}`} position={[0, screenH / 2, bz]} rotation={[0, Math.PI / 2, 0]}>
                  <cylinderGeometry args={[0.022, 0.025, screenH, 6]} />
                  <meshStandardMaterial color={bi % 2 === 0 ? "#8A7040" : "#6A5530"} roughness={0.84} metalness={0.02} />
                </mesh>
              );
            })}
            {/* West screen */}
            {Array.from({ length: 7 }, (_, bi) => {
              const bx2 = -ydW / 2 + bi * (ydW / 6);
              return (
                <mesh key={`bw-${bi}`} position={[bx2, screenH / 2, 0]} rotation={[0, 0, 0]}>
                  <cylinderGeometry args={[0.022, 0.025, screenH, 6]} />
                  <meshStandardMaterial color={bi % 2 === 0 ? "#8A7040" : "#6A5530"} roughness={0.84} metalness={0.02} />
                </mesh>
              );
            })}
            {/* Horizontal binding rails on each screen */}
            {[0.40, 0.90, 1.40].map((ry, ri) => (
              <group key={ri}>
                <mesh position={[0, ry, -ydD / 2 + ydD / 4]}>
                  <boxGeometry args={[0.008, 0.018, ydD / 2]} />
                  <meshStandardMaterial color="#3A2010" roughness={0.90} />
                </mesh>
                <mesh position={[-ydW / 2 + ydW / 4, ry, 0]}>
                  <boxGeometry args={[ydW / 2, 0.018, 0.008]} />
                  <meshStandardMaterial color="#3A2010" roughness={0.90} />
                </mesh>
              </group>
            ))}
            {/* LED strip along top of south screen */}
            {ledEmiYD > 0 && (
              <>
                <mesh position={[0, screenH + 0.025, -ydD / 2]}>
                  <boxGeometry args={[ydW, 0.012, 0.016]} />
                  <meshStandardMaterial color="#FFF8E0" emissive="#FFE880" emissiveIntensity={ledEmiYD} roughness={0.60} />
                </mesh>
                <pointLight position={[0, screenH + 0.06, -ydD / 2 + 0.20]} intensity={ledLI} distance={ydD} decay={2} color="#FFF4D0" />
              </>
            )}

            {/* ── Rolled yoga mat — center of deck ── */}
            <group position={[0, deckH + 0.016, 0.30]}>
              <mesh rotation={[0, Math.PI / 2, 0]} castShadow>
                <cylinderGeometry args={[0.044, 0.044, 1.72, 10]} />
                <meshStandardMaterial color="#6080A0" roughness={0.80} metalness={0.02} />
              </mesh>
              {/* Tie band */}
              <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
                <cylinderGeometry args={[0.046, 0.046, 0.06, 10, 1, true]} />
                <meshStandardMaterial color="#2A3848" roughness={0.60} metalness={0.10} />
              </mesh>
            </group>

            {/* ── 2 meditation cushions (zafu) ── */}
            {([-0.40, 0.40] as number[]).map((cx, ci) => (
              <group key={ci} position={[cx, deckH, -0.55]}>
                <mesh position={[0, 0.06, 0]} castShadow>
                  <cylinderGeometry args={[0.18, 0.20, 0.12, 12]} />
                  <meshStandardMaterial color={ci === 0 ? "#4A2878" : "#6A2020"} roughness={0.88} metalness={0.01} />
                </mesh>
              </group>
            ))}

            {/* ── Incense holder — small wooden disc with thin stick ── */}
            <group position={[0.60, deckH, -0.60]}>
              <mesh position={[0, 0.018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.060, 8]} />
                <meshStandardMaterial color="#4A2E10" roughness={0.75} metalness={0.04} />
              </mesh>
              {/* Incense stick */}
              <mesh position={[0, 0.12, 0]}>
                <cylinderGeometry args={[0.004, 0.004, 0.20, 4]} />
                <meshStandardMaterial color="#C0A060" roughness={0.70} metalness={0.02} />
              </mesh>
              {/* Smoke wisp (very small emissive sphere at tip) */}
              <mesh position={[0, 0.225, 0]}>
                <sphereGeometry args={[0.012, 5, 4]} />
                <meshStandardMaterial color="#E0E0E0" emissive="#C0C0C0" emissiveIntensity={0.4} transparent opacity={0.55} roughness={0.90} />
              </mesh>
            </group>

            {/* ── Canvas shade sail — triangle, stretched between 3 posts ── */}
            <mesh position={[0, screenH + 0.45, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
              <planeGeometry args={[ydW + 0.30, ydD * 0.60]} />
              <meshStandardMaterial
                color="#F4F0E8"
                transparent opacity={0.70}
                roughness={0.70} metalness={0.02}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5j-2. 按摩浴缸 / 水疗缸（outdoor spa / hot tub, west of pool）──
           White acrylic shell with blue glowing water, set into a teak timber
           surround deck. Night mode adds strong underwater LED glow. */}
      {!insideBuilding && isGlassVilla && (() => {
        const deckBW4 = 2.80;
        const poolL4  = Math.min(D * 0.70, 9.50);
        const poolW4  = Math.min(W * 0.78, 11.0);
        const poolZ4  = -D / 2 - deckBW4 - poolL4 / 2 - 0.80;
        const htX    = -(poolW4 / 2 + deckBW4 + 1.20);  // west of pool deck
        const htZ    = poolZ4;
        const isNightH = sunHour < 6 || sunHour > 20;
        const isDuskH  = !isNightH && (sunHour < 8 || sunHour > 18);
        const waterGlowI = isNightH ? 2.0 : isDuskH ? 1.0 : 0.12;
        const tubR  = 1.00;    // inner radius (octagonal approximated by cylinder)
        const tubH  = 0.72;    // tub height
        const wallT = 0.12;    // acrylic wall thickness
        const deckT = 0.06;    // teak deck plank thickness
        return (
          <group position={[htX, 0, htZ]}>
            {/* Teak surround deck (square platform) */}
            <mesh position={[0, deckT / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[tubR * 2 + 0.72, deckT, tubR * 2 + 0.72]} />
              <meshStandardMaterial color="#7A4E28" roughness={0.78} metalness={0.04} />
            </mesh>
            {/* Teak plank grooves (horizontal lines) */}
            {Array.from({ length: 5 }, (_, di) => {
              const dz = -(tubR + 0.30) + di * ((tubR * 2 + 0.60) / 4);
              return (
                <mesh key={di} position={[0, deckT + 0.001, dz]}>
                  <boxGeometry args={[tubR * 2 + 0.70, 0.004, 0.006]} />
                  <meshStandardMaterial color="#5A3818" roughness={0.90} metalness={0.01} />
                </mesh>
              );
            })}
            {/* Tub shell — white acrylic outer wall */}
            <mesh position={[0, deckT + tubH / 2, 0]} castShadow>
              <cylinderGeometry args={[tubR + wallT, tubR + wallT, tubH, 8]} />
              <meshStandardMaterial color="#F0EDE8" roughness={0.40} metalness={0.10} envMapIntensity={1.8} />
            </mesh>
            {/* Inner cavity — dark grey */}
            <mesh position={[0, deckT + tubH / 2, 0]}>
              <cylinderGeometry args={[tubR, tubR, tubH - 0.02, 8]} />
              <meshStandardMaterial color="#20282E" roughness={0.55} metalness={0.08} side={THREE.BackSide} />
            </mesh>
            {/* Water surface */}
            <mesh position={[0, deckT + tubH - 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[tubR - 0.02, 10]} />
              <meshStandardMaterial
                color="#50B8D4"
                transparent opacity={0.88}
                roughness={0.03} metalness={0.04}
                envMapIntensity={5.0}
                emissive="#20A0C8" emissiveIntensity={waterGlowI}
              />
            </mesh>
            {/* Top rim coping — brushed stainless */}
            <mesh position={[0, deckT + tubH + 0.018, 0]}>
              <cylinderGeometry args={[tubR + wallT + 0.02, tubR + wallT + 0.02, 0.040, 8]} />
              <meshStandardMaterial color="#B8C4D0" roughness={0.18} metalness={0.90} envMapIntensity={2.5} />
            </mesh>
            {/* Underwater LED glow */}
            {waterGlowI > 0.5 && (
              <pointLight position={[0, deckT + tubH * 0.40, 0]} intensity={waterGlowI * 3.5} distance={tubR * 2.5} decay={2.0} color="#30B0E0" castShadow={false} />
            )}
            {/* Control panel — small box on rim */}
            <mesh position={[tubR + wallT + 0.025, deckT + tubH + 0.040, 0]}>
              <boxGeometry args={[0.050, 0.090, 0.160]} />
              <meshStandardMaterial color="#2A3038" roughness={0.30} metalness={0.80} envMapIntensity={1.5} />
            </mesh>
            {/* Panel button strip */}
            <mesh position={[tubR + wallT + 0.052, deckT + tubH + 0.050, 0]}>
              <boxGeometry args={[0.010, 0.060, 0.120]} />
              <meshStandardMaterial color="#3A5870" roughness={0.40} metalness={0.50} emissive="#2080B0" emissiveIntensity={waterGlowI * 0.5} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5j-3. 电动汽车充电桩（EV charging station, west of driveway entrance）──
           Wall-box style charger mounted on a post near the garage/gate area. */}
      {!insideBuilding && isGlassVilla && (() => {
        // Place near the west boundary, at driveway level, south side
        const bndW5   = -W / 2 - 4.50;
        const chargeX = bndW5 + 0.40;   // just inside west boundary
        const chargeZ = -D / 2 - 8.50;  // south end, near gate
        const isNightEV = sunHour < 6 || sunHour > 20;
        const isDuskEV  = !isNightEV && (sunHour < 8 || sunHour > 18);
        const evGlow    = isNightEV ? 1.8 : isDuskEV ? 1.0 : 0.3;
        const evLI      = isNightEV ? 2.5 : isDuskEV ? 1.2 : 0.0;
        const postH = 1.20;
        return (
          <group position={[chargeX, 0, chargeZ]}>
            {/* Post — powder-coated steel */}
            <mesh position={[0, postH / 2, 0]} castShadow>
              <boxGeometry args={[0.08, postH, 0.08]} />
              <meshStandardMaterial color="#2C3240" roughness={0.45} metalness={0.70} />
            </mesh>
            {/* Wall-box housing */}
            <mesh position={[0.10, postH * 0.62, 0]} castShadow>
              <boxGeometry args={[0.22, 0.34, 0.10]} />
              <meshStandardMaterial color="#E8ECF2" roughness={0.48} metalness={0.22} envMapIntensity={1.4} />
            </mesh>
            {/* EV logo / brand strip — bright LED */}
            <mesh position={[0.218, postH * 0.70, 0]}>
              <boxGeometry args={[0.008, 0.08, 0.06]} />
              <meshStandardMaterial color="#00AAFF" emissive="#0088DD" emissiveIntensity={evGlow} roughness={0.20} />
            </mesh>
            {/* Charge indicator LEDs — green row */}
            {Array.from({ length: 5 }, (_, li) => (
              <mesh key={li} position={[0.218, postH * 0.58, -0.022 + li * 0.011]}>
                <boxGeometry args={[0.006, 0.008, 0.008]} />
                <meshStandardMaterial color="#22FF44" emissive="#00EE30" emissiveIntensity={evGlow * (li < 3 ? 1.0 : 0.2)} roughness={0.20} />
              </mesh>
            ))}
            {/* Charging cable holster */}
            <mesh position={[0.225, postH * 0.48, 0]}>
              <cylinderGeometry args={[0.016, 0.016, 0.080, 6]} />
              <meshStandardMaterial color="#1A1E28" roughness={0.60} metalness={0.50} />
            </mesh>
            {/* Cable loop */}
            <mesh position={[0.225, postH * 0.40, 0]} rotation={[0, 0, Math.PI / 2]}>
              <torusGeometry args={[0.040, 0.009, 6, 10, Math.PI * 1.3]} />
              <meshStandardMaterial color="#2C3040" roughness={0.55} metalness={0.45} />
            </mesh>
            {/* Base footing */}
            <mesh position={[0, 0.025, 0]}>
              <boxGeometry args={[0.20, 0.050, 0.20]} />
              <meshStandardMaterial color="#3A4050" roughness={0.60} metalness={0.45} />
            </mesh>
            {/* Night indicator light */}
            {evLI > 0 && (
              <pointLight position={[0.25, postH * 0.70, 0]} intensity={evLI} distance={3.0} decay={2.2} color="#0088FF" />
            )}
          </group>
        );
      })()}

      {/* ── 5j-4. 东侧界墙壁泉（wall-mounted water feature, east boundary wall）──
           A two-tiered granite wall fountain with cascading water sheets
           on the inner face of the east boundary wall. Night LED glow. */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndE7  =  W / 2 + 4.50;
        const wallT7 = 0.18;
        const ftnWallX = bndE7 - wallT7;  // inner face of east boundary
        const ftnWZ  = D / 2 * 0.20;       // mid-south section of east wall
        const isNightW7 = sunHour < 6 || sunHour > 20;
        const isDuskW7  = !isNightW7 && (sunHour < 8 || sunHour > 18);
        const wfGlow = isNightW7 ? 1.4 : isDuskW7 ? 0.6 : 0.04;
        const wfLI   = isNightW7 ? 2.2 : isDuskW7 ? 1.0 : 0.0;
        return (
          <group position={[ftnWallX, 0, ftnWZ]}>
            {/* Wall backing plate — dark polished stone */}
            <mesh position={[-0.020, 1.00, 0]} castShadow>
              <boxGeometry args={[0.040, 2.00, 0.90]} />
              <meshStandardMaterial color="#1A1E26" roughness={0.18} metalness={0.70} envMapIntensity={2.5} />
            </mesh>
            {/* Upper tier — spout header */}
            <mesh position={[-0.040, 1.70, 0]} castShadow>
              <boxGeometry args={[0.10, 0.10, 0.70]} />
              <meshStandardMaterial color="#2A2E38" roughness={0.22} metalness={0.78} envMapIntensity={2.2} />
            </mesh>
            {/* Upper basin */}
            <mesh position={[-0.060, 1.22, 0]} castShadow>
              <boxGeometry args={[0.14, 0.06, 0.72]} />
              <meshStandardMaterial color="#282C34" roughness={0.20} metalness={0.72} envMapIntensity={2.0} />
            </mesh>
            {/* Water sheet — upper to lower (thin translucent panel) */}
            <mesh position={[-0.048, 0.95, 0]}>
              <boxGeometry args={[0.008, 0.55, 0.62]} />
              <meshStandardMaterial
                color="#70CCE8"
                transparent opacity={0.62}
                roughness={0.04} metalness={0.04}
                emissive="#40B0D0" emissiveIntensity={wfGlow * 0.9}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* Lower collection basin */}
            <mesh position={[-0.060, 0.58, 0]} castShadow>
              <boxGeometry args={[0.22, 0.10, 0.90]} />
              <meshStandardMaterial color="#282C34" roughness={0.22} metalness={0.70} envMapIntensity={2.0} />
            </mesh>
            {/* Water surface in lower basin */}
            <mesh position={[-0.058, 0.64, 0]} rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[0.78, 0.17]} />
              <meshStandardMaterial
                color="#4898B8"
                transparent opacity={0.80}
                roughness={0.02} metalness={0.08}
                emissive="#2878A0" emissiveIntensity={wfGlow * 0.6}
                envMapIntensity={5.0}
              />
            </mesh>
            {/* Drainage grate at base */}
            <mesh position={[-0.070, 0.26, 0]} rotation={[0, Math.PI / 2, 0]}>
              <boxGeometry args={[0.70, 0.018, 0.14]} />
              <meshStandardMaterial color="#606870" roughness={0.40} metalness={0.65} />
            </mesh>
            {/* Paving surround */}
            <mesh position={[-0.15, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
              <planeGeometry args={[0.60, 1.00]} />
              <meshStandardMaterial color="#C8C0A8" roughness={0.74} metalness={0.02} />
            </mesh>
            {/* Night underwater accent light */}
            {wfLI > 0 && (
              <pointLight position={[-0.08, 0.62, 0]} intensity={wfLI} distance={2.5} decay={2.0} color="#40B0D0" castShadow={false} />
            )}
          </group>
        );
      })()}

      {/* ── 5j-5. 室外电影屏幕（outdoor cinema screen, south yard near pool）──
           White projection screen on a stand, with 6 deck chairs and
           a raised projector post. Illuminated white panel at night. */}
      {!insideBuilding && isGlassVilla && (() => {
        const cinX  = -W * 0.22;
        const cinZ  = -D / 2 - 3.20;   // between steps and pool
        const scrW  = 3.20;
        const scrH  = 1.80;
        const isNightC = sunHour < 6 || sunHour > 20;
        const isDuskC  = !isNightC && (sunHour < 8 || sunHour > 18);
        const scrEmi = isNightC ? 0.80 : isDuskC ? 0.25 : 0.0;
        if (scrEmi === 0.0) return null;  // only show at dusk/night
        return (
          <group position={[cinX, 0, cinZ]}>
            {/* Screen frame posts */}
            {([-scrW / 2, scrW / 2] as number[]).map((sx, si) => (
              <mesh key={si} position={[sx, scrH / 2 + 0.30, 0]} castShadow>
                <cylinderGeometry args={[0.022, 0.022, scrH + 0.60, 6]} />
                <meshStandardMaterial color="#383C44" roughness={0.40} metalness={0.68} />
              </mesh>
            ))}
            {/* Screen surface — bright white emissive at night */}
            <mesh position={[0, scrH / 2 + 0.30, 0]}>
              <boxGeometry args={[scrW, scrH, 0.018]} />
              <meshStandardMaterial
                color="#F8F8F8"
                emissive="#F0F4FF"
                emissiveIntensity={scrEmi}
                roughness={0.88}
              />
            </mesh>
            {/* Cross bar at top */}
            <mesh position={[0, scrH + 0.32, 0]}>
              <boxGeometry args={[scrW + 0.10, 0.030, 0.030]} />
              <meshStandardMaterial color="#303440" roughness={0.35} metalness={0.72} />
            </mesh>
            {/* 6 deck/bean-bag chairs in 2 rows */}
            {Array.from({ length: 6 }, (_, ci) => {
              const row = Math.floor(ci / 3);
              const col = ci % 3;
              const cx2 = -1.20 + col * 1.20;
              const cz2 = 1.10 + row * 0.90;
              const chairColors = ["#E84040", "#4080D0", "#40B840", "#E89020", "#9040C0", "#E04060"];
              return (
                <group key={ci} position={[cx2, 0, cz2]}>
                  {/* Seat/back — simplified box */}
                  <mesh position={[0, 0.22, 0]} castShadow>
                    <boxGeometry args={[0.48, 0.38, 0.50]} />
                    <meshStandardMaterial color={chairColors[ci]} roughness={0.88} />
                  </mesh>
                </group>
              );
            })}
            {/* Projector on post (behind chairs) */}
            <group position={[0, 0, 2.50]}>
              <mesh position={[0, 1.60, 0]} castShadow>
                <cylinderGeometry args={[0.022, 0.025, 1.60, 6]} />
                <meshStandardMaterial color="#383C44" roughness={0.42} metalness={0.66} />
              </mesh>
              <mesh position={[0, 1.62, 0]}>
                <boxGeometry args={[0.22, 0.10, 0.30]} />
                <meshStandardMaterial color="#1A1E26" roughness={0.30} metalness={0.72} />
              </mesh>
              {/* Projector lens */}
              {isNightC && (
                <pointLight position={[0, 1.62, -0.18]} intensity={3.0} distance={scrW * 1.4} decay={2.0} color="#F8F4FF" target-position={[cinX, scrH / 2, cinZ]} castShadow={false} />
              )}
            </group>
          </group>
        );
      })()}

      {/* ── 5j-5b. 西侧界墙绿植景观墙（living green wall on west boundary）──
           A 4m × 3m modular green wall panel system on the inner face of the
           west boundary wall, adjacent to the outdoor gym. 10×6 grid of dark
           powder-coated planting modules (each 0.40m × 0.50m), filled with
           green/chartreuse moss/plant varieties. Top mist nozzle rail.
           Night: linear LED wash at top face. */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndW_gw  = -W / 2 - 4.50;
        const wallT_gw = 0.18;
        const gwX      = bndW_gw + wallT_gw + 0.025;   // inner face of west wall
        const gwZ      = D / 2 + 1.10;   // near gym
        const gwW      = 4.00;   // horizontal extent (N-S)
        const gwH      = 3.00;   // vertical extent
        const gwBotY   = 0.20;   // bottom above grade
        const mW       = 0.40;   // module width (Z axis)
        const mH       = 0.50;   // module height
        const cols     = Math.round(gwW / mW);
        const rows     = Math.round(gwH / mH);
        const isNightGW = sunHour < 6 || sunHour > 20;
        const isDuskGW  = !isNightGW && (sunHour < 8 || sunHour > 18);
        const ledEmi    = isNightGW ? 2.5 : isDuskGW ? 1.0 : 0.0;

        // Plant colour palette — varied greens
        const plantCols = ["#2A6020", "#3A7228", "#264C18", "#4A8030", "#1E5018", "#5C9038", "#304E20"] as const;

        return (
          <group position={[gwX, gwBotY, gwZ]}>
            {/* Frame backing — dark powder-coated steel plate */}
            <mesh position={[0, gwH / 2, gwW / 2]}>
              <boxGeometry args={[0.022, gwH + 0.05, gwW + 0.06]} />
              <meshStandardMaterial color="#1E2228" roughness={0.35} metalness={0.75} envMapIntensity={1.5} />
            </mesh>
            {/* Module cells */}
            {Array.from({ length: rows }, (_, ri) =>
              Array.from({ length: cols }, (_, ci) => {
                const cellZ = ci * mW + mW / 2;
                const cellY = ri * mH + mH / 2;
                const colorIdx = (ri * cols + ci * 3 + ri * 2) % plantCols.length;
                const plantCol = plantCols[colorIdx];
                return (
                  <group key={`gw-${ri}-${ci}`} position={[0, cellY, cellZ]}>
                    {/* Module body */}
                    <mesh position={[0.016, 0, 0]}>
                      <boxGeometry args={[0.015, mH - 0.025, mW - 0.025]} />
                      <meshStandardMaterial color="#282C30" roughness={0.55} metalness={0.40} />
                    </mesh>
                    {/* Plant face — front of module */}
                    <mesh position={[0.026, 0, 0]}>
                      <boxGeometry args={[0.040, mH - 0.032, mW - 0.032]} />
                      <meshStandardMaterial color={plantCol} roughness={0.96} metalness={0.01} />
                    </mesh>
                    {/* Small texture bumps — 3 sphere tufts */}
                    {[[-0.10, -0.06], [0, 0.08], [0.10, -0.04]].map(([dy, dz], bi) => (
                      <mesh key={bi} position={[0.050, dy, dz]}>
                        <sphereGeometry args={[mH * 0.14 + (bi * 0.01), 5, 4]} />
                        <meshStandardMaterial color={plantCols[(colorIdx + bi + 1) % plantCols.length]} roughness={0.97} metalness={0.01} />
                      </mesh>
                    ))}
                  </group>
                );
              })
            )}
            {/* Top mist nozzle rail */}
            <mesh position={[0, gwH + 0.04, gwW / 2]}>
              <boxGeometry args={[0.028, 0.020, gwW + 0.04]} />
              <meshStandardMaterial color="#606870" roughness={0.35} metalness={0.70} envMapIntensity={1.8} />
            </mesh>
            {/* Mist nozzles — 5 small cylinders */}
            {Array.from({ length: 5 }, (_, ni) => (
              <mesh key={ni} position={[0.018, gwH + 0.055, ni * (gwW / 4)]}>
                <cylinderGeometry args={[0.006, 0.006, 0.020, 5]} />
                <meshStandardMaterial color="#808890" roughness={0.38} metalness={0.70} />
              </mesh>
            ))}
            {/* LED wash strip at top */}
            {ledEmi > 0 && (
              <>
                <mesh position={[-0.010, gwH + 0.085, gwW / 2]}>
                  <boxGeometry args={[0.015, 0.012, gwW - 0.06]} />
                  <meshStandardMaterial color="#E0FFD0" emissive="#90F060" emissiveIntensity={ledEmi} roughness={0.60} />
                </mesh>
                <pointLight position={[0.10, gwH + 0.10, gwW / 2]} intensity={ledEmi * 1.2} distance={gwH + 0.5} decay={2} color="#A0F070" />
              </>
            )}
            {/* Drip tray at base — narrow dark channel */}
            <mesh position={[0, -0.015, gwW / 2]}>
              <boxGeometry args={[0.060, 0.030, gwW + 0.04]} />
              <meshStandardMaterial color="#1E2228" roughness={0.50} metalness={0.60} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5j-6. 室外健身区（outdoor gym, west side of north yard）──
           Equipment: power rack, bench press, cable tower, exercise bike,
           battle ropes coiled on hook, rubber flooring mat. */}
      {!insideBuilding && isGlassVilla && (() => {
        const gymX  = -W / 2 - 3.20;    // west boundary area
        const gymZ  =  D / 2 + 1.50;    // north yard
        const matH  = 0.020;
        const isNightGym = sunHour < 6 || sunHour > 20;
        return (
          <group position={[gymX, 0, gymZ]}>
            {/* ── Rubber flooring mat (4m × 3m) ── */}
            <mesh position={[0, matH / 2, 0]} receiveShadow>
              <boxGeometry args={[4.0, matH, 3.0]} />
              <meshStandardMaterial color="#1A1A1A" roughness={0.95} metalness={0.02} />
            </mesh>
            {/* Mat grid lines (3 E-W, 2 N-S) */}
            {[-1.0, 0, 1.0].map((mz, mi) => (
              <mesh key={`mg-${mi}`} position={[0, matH + 0.001, mz]}>
                <boxGeometry args={[4.0, 0.002, 0.020]} />
                <meshStandardMaterial color="#303030" roughness={0.98} />
              </mesh>
            ))}

            {/* ── Power rack — 4 vertical uprights + 2 crossbars ── */}
            <group position={[-1.40, 0, -0.80]}>
              {/* 4 uprights */}
              {([-0.50, 0.50] as number[]).flatMap(rx =>
                ([-0.42, 0.42] as number[]).map((rz, rzi) => (
                  <mesh key={`${rx}-${rzi}`} position={[rx, 1.10, rz]} castShadow>
                    <boxGeometry args={[0.055, 2.20, 0.055]} />
                    <meshStandardMaterial color="#303440" roughness={0.32} metalness={0.82} />
                  </mesh>
                ))
              )}
              {/* Top crossbar front/back */}
              {[-0.42, 0.42].map((cz, ci) => (
                <mesh key={ci} position={[0, 2.18, cz]} castShadow>
                  <boxGeometry args={[1.08, 0.050, 0.050]} />
                  <meshStandardMaterial color="#303440" roughness={0.30} metalness={0.84} />
                </mesh>
              ))}
              {/* J-hooks (bar rests) */}
              {[-0.50, 0.50].map((rx, ri) => (
                <mesh key={ri} position={[rx, 1.55, 0]}>
                  <boxGeometry args={[0.055, 0.060, 0.90]} />
                  <meshStandardMaterial color="#404858" roughness={0.28} metalness={0.88} />
                </mesh>
              ))}
              {/* Barbell in rack */}
              <mesh position={[0, 1.58, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.028, 0.028, 1.50, 8]} />
                <meshStandardMaterial color="#5A6070" roughness={0.25} metalness={0.88} />
              </mesh>
              {/* Weight plates on each end */}
              {[-0.70, 0.70].map((bx, bi) => (
                <mesh key={bi} position={[bx, 1.58, 0]} rotation={[Math.PI / 2, 0, 0]}>
                  <cylinderGeometry args={[0.22, 0.22, 0.040, 12]} />
                  <meshStandardMaterial color="#282C38" roughness={0.35} metalness={0.80} />
                </mesh>
              ))}
            </group>

            {/* ── Flat bench press ── */}
            <group position={[0.20, 0, -0.60]}>
              {/* Frame legs */}
              {([-0.80, 0.80] as number[]).flatMap(bx =>
                ([-0.16, 0.16] as number[]).map((bz, bzi) => (
                  <mesh key={`${bx}-${bzi}`} position={[bx, 0.18, bz]} castShadow>
                    <boxGeometry args={[0.030, 0.36, 0.030]} />
                    <meshStandardMaterial color="#404858" roughness={0.30} metalness={0.82} />
                  </mesh>
                ))
              )}
              {/* Padded seat */}
              <mesh position={[0, 0.400, 0]} castShadow>
                <boxGeometry args={[1.70, 0.060, 0.30]} />
                <meshStandardMaterial color="#B04030" roughness={0.80} metalness={0.02} />
              </mesh>
            </group>

            {/* ── Exercise bike ── */}
            <group position={[1.40, 0, 0.40]}>
              {/* Frame */}
              <mesh position={[0, 0.40, 0]} castShadow>
                <boxGeometry args={[0.55, 0.06, 0.18]} />
                <meshStandardMaterial color="#1A1E28" roughness={0.35} metalness={0.70} />
              </mesh>
              {/* Wheel */}
              <mesh position={[-0.18, 0.28, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.22, 0.035, 5, 12]} />
                <meshStandardMaterial color="#383C4A" roughness={0.28} metalness={0.80} />
              </mesh>
              {/* Seat post */}
              <mesh position={[0.18, 0.50, 0]} castShadow>
                <cylinderGeometry args={[0.020, 0.020, 0.28, 6]} />
                <meshStandardMaterial color="#606878" roughness={0.25} metalness={0.82} />
              </mesh>
              {/* Seat pad */}
              <mesh position={[0.18, 0.66, 0]}>
                <boxGeometry args={[0.22, 0.035, 0.12]} />
                <meshStandardMaterial color="#202430" roughness={0.70} metalness={0.05} />
              </mesh>
              {/* Handlebar post */}
              <mesh position={[-0.10, 0.80, 0]}>
                <cylinderGeometry args={[0.018, 0.018, 0.45, 6]} />
                <meshStandardMaterial color="#606878" roughness={0.25} metalness={0.82} />
              </mesh>
              {/* Handlebars */}
              <mesh position={[-0.10, 1.02, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.014, 0.014, 0.45, 6]} />
                <meshStandardMaterial color="#303848" roughness={0.30} metalness={0.80} />
              </mesh>
            </group>

            {/* ── Battle ropes coiled on wall hook ── */}
            <group position={[-1.85, 0, 1.10]}>
              {/* Hook on wall */}
              <mesh position={[0, 0.80, -0.06]}>
                <boxGeometry args={[0.030, 0.12, 0.050]} />
                <meshStandardMaterial color="#606878" roughness={0.28} metalness={0.78} />
              </mesh>
              {/* Coiled rope (torus loops) */}
              {[0, 0.040, 0.080].map((dy, di) => (
                <mesh key={di} position={[0, 0.70 - dy, 0]} rotation={[Math.PI / 2, 0, 0]}>
                  <torusGeometry args={[0.14, 0.022, 5, 10]} />
                  <meshStandardMaterial color="#1A1008" roughness={0.90} metalness={0.02} />
                </mesh>
              ))}
            </group>

            {/* ── Dumbbell rack ── */}
            <group position={[-0.60, 0, 1.0]}>
              {/* Rack frame */}
              <mesh position={[0, 0.40, 0]} castShadow>
                <boxGeometry args={[0.90, 0.80, 0.35]} />
                <meshStandardMaterial color="#282C38" roughness={0.38} metalness={0.72} />
              </mesh>
              {/* Dumbbells × 3 pairs */}
              {[-0.28, 0, 0.28].map((dx, di) => (
                <group key={di} position={[dx, 0.48, 0.12]}>
                  {/* Handle */}
                  <mesh rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.018, 0.018, 0.22, 6]} />
                    <meshStandardMaterial color="#505868" roughness={0.28} metalness={0.80} />
                  </mesh>
                  {/* Heads */}
                  {[-0.12, 0.12].map((hx, hi) => (
                    <mesh key={hi} position={[hx, 0, 0]}>
                      <sphereGeometry args={[0.050, 6, 4]} />
                      <meshStandardMaterial color="#202428" roughness={0.40} metalness={0.72} />
                    </mesh>
                  ))}
                </group>
              ))}
            </group>

            {/* ── Overhead fan / mist fan (optional night light) ── */}
            {isNightGym && (
              <pointLight position={[0, 2.50, 0]}
                intensity={1.8} distance={5.0} decay={1.8}
                color="#FFF8F0" castShadow={false} />
            )}
          </group>
        );
      })()}

      {/* ── 5j-7. 宠物围栏区（dog run / pet enclosure, east yard）──
           Galvanised wire mesh fence run for pets: concrete base pads,
           wire panel sections, gate, and a small kennel house with pitched roof. */}
      {!insideBuilding && isGlassVilla && (() => {
        const petX   =  W / 2 + 2.80;   // east yard
        const petZ   = -D / 2 - 2.80;   // south side of east yard
        const runW   = 3.20;             // E-W
        const runD   = 2.20;             // N-S
        const fenceH = 1.60;
        return (
          <group position={[petX, 0, petZ]}>
            {/* ── Ground pad — concrete ── */}
            <mesh position={[0, 0.010, 0]} receiveShadow>
              <boxGeometry args={[runW, 0.020, runD]} />
              <meshStandardMaterial color="#B8B4AC" roughness={0.88} metalness={0.02} />
            </mesh>

            {/* ── Fence posts at corners + every 1m ── */}
            {(() => {
              const posts: [number, number, number][] = [];
              const nE = Math.ceil(runD / 1.0);
              const nS = Math.ceil(runW / 1.0);
              // West side
              for (let i = 0; i <= nE; i++) posts.push([-runW / 2, fenceH / 2, -runD / 2 + i * (runD / nE)]);
              // East side
              for (let i = 0; i <= nE; i++) posts.push([runW / 2, fenceH / 2, -runD / 2 + i * (runD / nE)]);
              // South side (skip corners already added)
              for (let i = 1; i < nS; i++) posts.push([-runW / 2 + i * (runW / nS), fenceH / 2, runD / 2]);
              // North side (skip corners)
              for (let i = 1; i < nS; i++) posts.push([-runW / 2 + i * (runW / nS), fenceH / 2, -runD / 2]);
              return posts.map(([px, py, pz], pi) => (
                <mesh key={pi} position={[px, py, pz]} castShadow>
                  <cylinderGeometry args={[0.022, 0.022, fenceH, 5]} />
                  <meshStandardMaterial color="#9AA4A8" roughness={0.30} metalness={0.72} />
                </mesh>
              ));
            })()}

            {/* ── Wire mesh panels — horizontal rails only (mesh implied) ── */}
            {[0.35, 0.75, 1.15, 1.50].map((ry, ri) => (
              <group key={ri}>
                {/* North rail */}
                <mesh position={[0, ry, -runD / 2]}>
                  <boxGeometry args={[runW, 0.010, 0.010]} />
                  <meshStandardMaterial color="#8A9298" roughness={0.35} metalness={0.68} />
                </mesh>
                {/* South rail */}
                <mesh position={[0, ry, runD / 2]}>
                  <boxGeometry args={[runW, 0.010, 0.010]} />
                  <meshStandardMaterial color="#8A9298" roughness={0.35} metalness={0.68} />
                </mesh>
                {/* East rail */}
                <mesh position={[runW / 2, ry, 0]}>
                  <boxGeometry args={[0.010, 0.010, runD]} />
                  <meshStandardMaterial color="#8A9298" roughness={0.35} metalness={0.68} />
                </mesh>
                {/* West rail */}
                <mesh position={[-runW / 2, ry, 0]}>
                  <boxGeometry args={[0.010, 0.010, runD]} />
                  <meshStandardMaterial color="#8A9298" roughness={0.35} metalness={0.68} />
                </mesh>
              </group>
            ))}

            {/* ── Gate (south side, centre-right) ── */}
            <mesh position={[0.55, fenceH * 0.50, runD / 2 + 0.006]}>
              <boxGeometry args={[0.85, fenceH, 0.012]} />
              <meshStandardMaterial color="#7A8490" roughness={0.35} metalness={0.65} />
            </mesh>
            {/* Gate latch */}
            <mesh position={[0.12, fenceH * 0.45, runD / 2 + 0.018]}>
              <boxGeometry args={[0.050, 0.025, 0.012]} />
              <meshStandardMaterial color="#B0B8C0" roughness={0.22} metalness={0.85} />
            </mesh>

            {/* ── Dog kennel house — north-west corner ── */}
            <group position={[-runW * 0.30, 0, -runD * 0.28]}>
              {/* House body */}
              <mesh position={[0, 0.28, 0]} castShadow>
                <boxGeometry args={[0.80, 0.55, 0.65]} />
                <meshStandardMaterial color="#D8CCBA" roughness={0.82} metalness={0.02} />
              </mesh>
              {/* Pitched roof — left panel */}
              <mesh position={[0, 0.60, -0.16]} rotation={[-0.55, 0, 0]} castShadow>
                <boxGeometry args={[0.86, 0.040, 0.42]} />
                <meshStandardMaterial color="#8B4020" roughness={0.75} metalness={0.04} />
              </mesh>
              {/* Pitched roof — right panel */}
              <mesh position={[0, 0.60, 0.16]} rotation={[0.55, 0, 0]} castShadow>
                <boxGeometry args={[0.86, 0.040, 0.42]} />
                <meshStandardMaterial color="#8B4020" roughness={0.75} metalness={0.04} />
              </mesh>
              {/* Door opening (arch) */}
              <mesh position={[0, 0.20, -0.328]}>
                <boxGeometry args={[0.30, 0.38, 0.010]} />
                <meshStandardMaterial color="#1C1410" roughness={0.90} />
              </mesh>
              {/* Name plate (small strip) */}
              <mesh position={[0, 0.44, -0.330]}>
                <boxGeometry args={[0.22, 0.045, 0.006]} />
                <meshStandardMaterial color="#E8D8A0" roughness={0.60} metalness={0.05} />
              </mesh>
            </group>

            {/* ── Water bowl ── */}
            <mesh position={[0.80, 0.065, 0.60]}>
              <cylinderGeometry args={[0.095, 0.080, 0.065, 8]} />
              <meshStandardMaterial color="#4A6080" roughness={0.20} metalness={0.50} />
            </mesh>
            <mesh position={[0.80, 0.068, 0.60]}>
              <cylinderGeometry args={[0.080, 0.080, 0.010, 8]} />
              <meshStandardMaterial color="#60A0C0" transparent opacity={0.75} roughness={0.04} metalness={0.05} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5k. 雨棚玻璃顶（canopy glazing panel upgrade）── */}
      {!insideBuilding && isGlassVilla && (() => {
        const canopyW3 = Math.min(W * 0.62, 8.0);
        const canopyD3 = 2.0;
        const canopyY3 = FLOOR_H - 0.02;
        const southFaceZ3 = -D / 2 - 0.20;
        const canopyZ3 = southFaceZ3 - canopyD3 / 2;
        // Translucent polycarbonate panel between the columns — 3 panels with thin mullions
        const panelCount = 3;
        const panelW3 = (canopyW3 - 0.10) / panelCount;
        return (
          <group>
            {Array.from({ length: panelCount }, (_, pi) => {
              const px3 = -canopyW3 / 2 + 0.05 + (pi + 0.5) * panelW3;
              return (
                <group key={pi} position={[px3, canopyY3 + 0.048, canopyZ3]}>
                  {/* Polycarbonate glazing panel */}
                  <mesh renderOrder={10}>
                    <boxGeometry args={[panelW3 - 0.025, 0.010, canopyD3 - 0.04]} />
                    <meshStandardMaterial
                      color="#DDEEF5"
                      transparent opacity={0.38}
                      depthWrite={false}
                      roughness={0.04}
                      metalness={0.10}
                      envMapIntensity={3.5}
                      side={THREE.DoubleSide}
                      {...overlayMaterialProps(2)}
                    />
                  </mesh>
                  {/* Vertical mullion at right edge */}
                  <mesh position={[panelW3 / 2 - 0.012, 0, 0]}>
                    <boxGeometry args={[0.024, 0.020, canopyD3 - 0.04]} />
                    <meshStandardMaterial color="#1E2028" roughness={0.20} metalness={0.90} envMapIntensity={2.2} />
                  </mesh>
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5l. 豪华轿车停在车道上（luxury sedan parked on driveway）──
           Stylised low-LOD sedan: body + roof cabin + windshields + 4 wheels.
           Placed centre of driveway, ~1m north of south gate pillars. */}
      {!insideBuilding && isGlassVilla && (() => {
        // Car sits on the driveway centreline (x = gateX2 from section 5d).
        // We don't have gateX2 in scope here, so we replicate the logic:
        const gateX2L  = 0;           // gate centred on X=0
        const carZ     = -D / 2 - 7.80;  // between building and gate

        const isNightL  = sunHour < 6 || sunHour > 20;
        const isDuskL   = !isNightL && (sunHour < 8 || sunHour > 18);

        // Car body colours — deep obsidian black
        const bodyCol   = "#1A1C22";
        const glassCol  = "#4A6880";
        const wheelCol  = "#111318";
        const rimCol    = "#B0B8C8";

        // Headlights / tail lights — time-aware
        const headEmi   = isNightL ? 5.0 : isDuskL ? 2.5 : 0.0;
        const tailEmi   = isNightL ? 4.0 : isDuskL ? 2.0 : 0.0;
        const headLI    = isNightL ? 6.0 : isDuskL ? 3.0 : 0.0;
        const tailLI    = isNightL ? 2.0 : isDuskL ? 1.0 : 0.0;

        // Dimensions (metres)
        const cL = 4.60;   // car length (Z axis)
        const cW = 1.90;   // car width  (X axis)
        const cH = 0.52;   // body sill-to-shoulder height
        const cG = 0.22;   // ground clearance
        const roofH = 0.58; // roof cabin height above shoulder
        const roofL = 2.20; // roof cabin length

        return (
          <group position={[gateX2L, 0, carZ]}>
            {/* Main body — lower slab */}
            <mesh position={[0, cG + cH / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[cW, cH, cL]} />
              <meshStandardMaterial color={bodyCol} roughness={0.18} metalness={0.88} envMapIntensity={3.0} />
            </mesh>
            {/* Roof cabin (slightly narrower, centred longitudinally) */}
            <mesh position={[0, cG + cH + roofH / 2, -0.10]} castShadow>
              <boxGeometry args={[cW - 0.14, roofH, roofL]} />
              <meshStandardMaterial color={bodyCol} roughness={0.16} metalness={0.90} envMapIntensity={3.2} />
            </mesh>
            {/* Windshield — front */}
            <mesh position={[0, cG + cH + roofH * 0.42, roofL / 2 + 0.06]} rotation={[Math.PI * 0.20, 0, 0]}>
              <boxGeometry args={[cW - 0.20, roofH * 0.80, 0.015]} />
              <meshStandardMaterial color={glassCol} transparent opacity={0.55} roughness={0.04} metalness={0.30} envMapIntensity={4.0} />
            </mesh>
            {/* Rear window */}
            <mesh position={[0, cG + cH + roofH * 0.42, -roofL / 2 - 0.06]} rotation={[-Math.PI * 0.18, 0, 0]}>
              <boxGeometry args={[cW - 0.20, roofH * 0.78, 0.015]} />
              <meshStandardMaterial color={glassCol} transparent opacity={0.55} roughness={0.04} metalness={0.30} envMapIntensity={4.0} />
            </mesh>
            {/* Side windows (left & right) */}
            {([-1, 1] as number[]).map(sx => (
              <mesh key={sx} position={[sx * (cW / 2 - 0.008), cG + cH + roofH * 0.50, -0.10]} rotation={[0, 0, 0]}>
                <boxGeometry args={[0.012, roofH * 0.72, roofL - 0.30]} />
                <meshStandardMaterial color={glassCol} transparent opacity={0.52} roughness={0.04} metalness={0.30} envMapIntensity={3.5} />
              </mesh>
            ))}
            {/* Front bumper / fascia */}
            <mesh position={[0, cG + cH * 0.40, cL / 2 + 0.04]}>
              <boxGeometry args={[cW + 0.06, cH * 0.60, 0.09]} />
              <meshStandardMaterial color="#202228" roughness={0.55} metalness={0.30} />
            </mesh>
            {/* Rear bumper */}
            <mesh position={[0, cG + cH * 0.40, -cL / 2 - 0.04]}>
              <boxGeometry args={[cW + 0.06, cH * 0.55, 0.09]} />
              <meshStandardMaterial color="#202228" roughness={0.55} metalness={0.30} />
            </mesh>
            {/* Headlights (two narrow strips) */}
            {([-0.55, 0.55] as number[]).map((hx, hi) => (
              <group key={hi} position={[hx, cG + cH * 0.65, cL / 2 + 0.06]}>
                <mesh>
                  <boxGeometry args={[0.38, 0.07, 0.015]} />
                  <meshStandardMaterial color="#FFFFFF" emissive="#EEEEFF" emissiveIntensity={headEmi} roughness={0.04} metalness={0.10} />
                </mesh>
                {headLI > 0 && <pointLight intensity={headLI} distance={8.0} decay={2.0} color="#FFF8F0" position={[0, 0, 0.2]} />}
              </group>
            ))}
            {/* DRL strips just above headlights */}
            {([-0.55, 0.55] as number[]).map((hx, hi) => (
              <mesh key={`drl-${hi}`} position={[hx, cG + cH * 0.76, cL / 2 + 0.055]}>
                <boxGeometry args={[0.38, 0.025, 0.012]} />
                <meshStandardMaterial color="#E0F4FF" emissive="#C0E8FF" emissiveIntensity={isNightL || isDuskL ? 3.0 : 0.8} roughness={0.05} />
              </mesh>
            ))}
            {/* Tail lights (red strips) */}
            {([-0.55, 0.55] as number[]).map((tx, ti) => (
              <group key={`tail-${ti}`} position={[tx, cG + cH * 0.62, -cL / 2 - 0.04]}>
                <mesh>
                  <boxGeometry args={[0.36, 0.065, 0.012]} />
                  <meshStandardMaterial color="#FF2020" emissive="#FF1010" emissiveIntensity={tailEmi} roughness={0.08} metalness={0.05} />
                </mesh>
                {tailLI > 0 && <pointLight intensity={tailLI} distance={4.0} decay={2.5} color="#FF2020" position={[0, 0, -0.1]} />}
              </group>
            ))}
            {/* Wheels (4 corners) — flat cylinders rotated to horizontal */}
            {([
              [ cW / 2 + 0.04, cG,  cL * 0.30],
              [-cW / 2 - 0.04, cG,  cL * 0.30],
              [ cW / 2 + 0.04, cG, -cL * 0.30],
              [-cW / 2 - 0.04, cG, -cL * 0.30],
            ] as [number,number,number][]).map(([wx, wy, wz], wi) => (
              <group key={`wheel-${wi}`} position={[wx, wy, wz]} rotation={[0, 0, Math.PI / 2]}>
                {/* Tyre */}
                <mesh castShadow>
                  <cylinderGeometry args={[0.33, 0.33, 0.24, 20]} />
                  <meshStandardMaterial color={wheelCol} roughness={0.88} metalness={0.04} />
                </mesh>
                {/* Alloy rim */}
                <mesh position={[0, 0.08, 0]}>
                  <cylinderGeometry args={[0.24, 0.24, 0.02, 16]} />
                  <meshStandardMaterial color={rimCol} roughness={0.18} metalness={0.92} envMapIntensity={2.5} />
                </mesh>
                {/* Hub cap centre */}
                <mesh position={[0, 0.10, 0]}>
                  <cylinderGeometry args={[0.06, 0.06, 0.015, 12]} />
                  <meshStandardMaterial color={bodyCol} roughness={0.20} metalness={0.88} />
                </mesh>
                {/* 5 spoke shadow */}
                {Array.from({ length: 5 }, (_, si) => {
                  const a = (si / 5) * Math.PI * 2;
                  return (
                    <mesh key={si} position={[Math.sin(a) * 0.14, 0.09, Math.cos(a) * 0.14]}>
                      <boxGeometry args={[0.038, 0.018, 0.12]} />
                      <meshStandardMaterial color={rimCol} roughness={0.20} metalness={0.90} />
                    </mesh>
                  );
                })}
              </group>
            ))}
            {/* Side door handle strips — thin chrome bars */}
            {([-1, 1] as number[]).map(sx => (
              <group key={`handle-${sx}`}>
                {/* Front door handle */}
                <mesh position={[sx * (cW / 2 + 0.005), cG + cH * 0.75, cL * 0.17]}>
                  <boxGeometry args={[0.012, 0.022, 0.12]} />
                  <meshStandardMaterial color="#C8D0D8" roughness={0.12} metalness={0.96} envMapIntensity={3.0} />
                </mesh>
                {/* Rear door handle */}
                <mesh position={[sx * (cW / 2 + 0.005), cG + cH * 0.75, -cL * 0.10]}>
                  <boxGeometry args={[0.012, 0.022, 0.12]} />
                  <meshStandardMaterial color="#C8D0D8" roughness={0.12} metalness={0.96} envMapIntensity={3.0} />
                </mesh>
              </group>
            ))}
            {/* Roof aerial — thin post */}
            <mesh position={[-0.55, cG + cH + roofH + 0.22, -0.30]}>
              <cylinderGeometry args={[0.008, 0.008, 0.44, 4]} />
              <meshStandardMaterial color="#303035" roughness={0.55} metalness={0.60} />
            </mesh>
          </group>
        );
      })()}

      {/* ── 5l-2. 豪华 SUV 停在车道旁（luxury SUV parked alongside sedan）──
           White/silver SUV parked east of the sedan, taller body profile,
           roof rails, slightly turned to indicate separate parking spot. */}
      {!insideBuilding && isGlassVilla && (() => {
        const suvX = 2.55;   // east of driveway centre (sedan at X=0)
        const suvZ = -D / 2 - 8.10;  // similar Z to sedan
        const isNightS2 = sunHour < 6 || sunHour > 20;
        const isDuskS2  = !isNightS2 && (sunHour < 8 || sunHour > 18);
        const suvBodyCol = "#E0E4E8"; // silver-white
        const suvGlassCol = "#3A5060";
        const suvWheelCol = "#111318";
        const suvRimCol   = "#909AA8";
        const suvHeadEmi = isNightS2 ? 4.5 : isDuskS2 ? 2.2 : 0.0;
        const suvTailEmi = isNightS2 ? 3.5 : isDuskS2 ? 1.8 : 0.0;
        // SUV dimensions (larger / taller than sedan)
        const sL = 4.80, sW = 2.05, sH = 0.62, sG = 0.24, sRH = 0.80, sRL = 2.60;
        return (
          <group position={[suvX, 0, suvZ]} rotation={[0, -0.08, 0]}>
            {/* Body slab */}
            <mesh position={[0, sG + sH / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[sW, sH, sL]} />
              <meshStandardMaterial color={suvBodyCol} roughness={0.22} metalness={0.80} envMapIntensity={2.8} />
            </mesh>
            {/* Cabin (taller, longer than sedan) */}
            <mesh position={[0, sG + sH + sRH / 2, -0.05]} castShadow>
              <boxGeometry args={[sW - 0.12, sRH, sRL]} />
              <meshStandardMaterial color={suvBodyCol} roughness={0.20} metalness={0.82} envMapIntensity={2.8} />
            </mesh>
            {/* Windshield */}
            <mesh position={[0, sG + sH + sRH * 0.44, sRL / 2 + 0.05]} rotation={[Math.PI * 0.18, 0, 0]}>
              <boxGeometry args={[sW - 0.18, sRH * 0.84, 0.015]} />
              <meshStandardMaterial color={suvGlassCol} transparent opacity={0.52} roughness={0.04} metalness={0.30} envMapIntensity={3.5} />
            </mesh>
            {/* Rear window */}
            <mesh position={[0, sG + sH + sRH * 0.44, -sRL / 2 - 0.05]} rotation={[-Math.PI * 0.15, 0, 0]}>
              <boxGeometry args={[sW - 0.18, sRH * 0.78, 0.015]} />
              <meshStandardMaterial color={suvGlassCol} transparent opacity={0.52} roughness={0.04} metalness={0.30} envMapIntensity={3.5} />
            </mesh>
            {/* Side windows */}
            {([-1, 1] as number[]).map(sx => (
              <mesh key={sx} position={[sx * (sW / 2 - 0.008), sG + sH + sRH * 0.50, -0.05]}>
                <boxGeometry args={[0.012, sRH * 0.70, sRL - 0.25]} />
                <meshStandardMaterial color={suvGlassCol} transparent opacity={0.50} roughness={0.04} metalness={0.28} envMapIntensity={3.0} />
              </mesh>
            ))}
            {/* Roof rails */}
            {([-sW * 0.36, sW * 0.36] as number[]).map((rx2, ri) => (
              <mesh key={ri} position={[rx2, sG + sH + sRH + 0.022, -0.05]}>
                <boxGeometry args={[0.028, 0.028, sRL - 0.20]} />
                <meshStandardMaterial color="#707880" roughness={0.35} metalness={0.70} envMapIntensity={1.6} />
              </mesh>
            ))}
            {/* Headlights */}
            {([-0.60, 0.60] as number[]).map((hx, hi) => (
              <mesh key={hi} position={[hx, sG + sH * 0.68, sL / 2 + 0.06]}>
                <boxGeometry args={[0.40, 0.075, 0.014]} />
                <meshStandardMaterial color="#FFFFFF" emissive="#EEEEFF" emissiveIntensity={suvHeadEmi} roughness={0.04} />
              </mesh>
            ))}
            {/* Tail lights */}
            {([-0.60, 0.60] as number[]).map((tx, ti) => (
              <mesh key={`st-${ti}`} position={[tx, sG + sH * 0.65, -sL / 2 - 0.04]}>
                <boxGeometry args={[0.38, 0.065, 0.012]} />
                <meshStandardMaterial color="#FF2020" emissive="#FF1010" emissiveIntensity={suvTailEmi} roughness={0.08} />
              </mesh>
            ))}
            {/* 4 Wheels (SUV larger diameter) */}
            {([
              [ sW / 2 + 0.04, sG,  sL * 0.28],
              [-sW / 2 - 0.04, sG,  sL * 0.28],
              [ sW / 2 + 0.04, sG, -sL * 0.28],
              [-sW / 2 - 0.04, sG, -sL * 0.28],
            ] as [number,number,number][]).map(([wx, wy, wz], wi) => (
              <group key={wi} position={[wx, wy, wz]} rotation={[0, 0, Math.PI / 2]}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.38, 0.38, 0.26, 20]} />
                  <meshStandardMaterial color={suvWheelCol} roughness={0.88} metalness={0.04} />
                </mesh>
                <mesh position={[0, 0.09, 0]}>
                  <cylinderGeometry args={[0.26, 0.26, 0.022, 16]} />
                  <meshStandardMaterial color={suvRimCol} roughness={0.20} metalness={0.88} envMapIntensity={2.0} />
                </mesh>
                {/* 5 spokes */}
                {Array.from({ length: 5 }, (_, si) => {
                  const a = (si / 5) * Math.PI * 2;
                  return (
                    <mesh key={si} position={[Math.sin(a) * 0.15, 0.10, Math.cos(a) * 0.15]}>
                      <boxGeometry args={[0.040, 0.018, 0.14]} />
                      <meshStandardMaterial color={suvRimCol} roughness={0.22} metalness={0.86} />
                    </mesh>
                  );
                })}
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 5m. 外立面上打灯（ground-up facade spotlights on south face）──
           4 in-ground uplighters wash the south facade from below.
           Only visible / active in exterior mode. */}
      {!insideBuilding && isGlassVilla && (() => {
        const isNightM  = sunHour < 6 || sunHour > 20;
        const isDuskM   = !isNightM && (sunHour < 8 || sunHour > 18);
        const uplightEmi = isNightM ? 3.2 : isDuskM ? 1.8 : 0.5;
        const uplightLI  = isNightM ? 8.0 : isDuskM ? 4.5 : 0.0;
        const faceZ      = -D / 2 - 0.12;  // just south of south facade
        const count      = 4;
        const step       = (W - 1.20) / (count - 1);
        return (
          <group>
            {Array.from({ length: count }, (_, ui) => {
              const ux = -W / 2 + 0.60 + ui * step;
              return (
                <group key={ui} position={[ux, 0.01, faceZ - 0.28]}>
                  {/* Ground housing — dark steel disc */}
                  <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[0.090, 0.095, 0.025, 12]} />
                    <meshStandardMaterial color="#282830" roughness={0.40} metalness={0.80} />
                  </mesh>
                  {/* Frosted lens — warm white emissive */}
                  <mesh position={[0, 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[0.070, 0.070, 0.008, 12]} />
                    <meshStandardMaterial color="#FFF8F0" emissive="#FFF4E0" emissiveIntensity={uplightEmi} roughness={0.60} />
                  </mesh>
                  {/* SpotLight shining up toward facade */}
                  {uplightLI > 0 && (
                    <spotLight
                      position={[0, 0.02, 0]}
                      target-position={[0, totalH * 0.60, 0.50]}
                      intensity={uplightLI}
                      angle={0.38}
                      penumbra={0.55}
                      distance={totalH + 4}
                      decay={1.8}
                      color="#FFF6E8"
                      castShadow={false}
                    />
                  )}
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5n. 车道两侧景观灯柱（driveway flanking lamp posts）──
           Elegant tall lamp posts lining the driveway, 3 on each side.
           Classic lantern head style, warm amber glow at dusk/night. */}
      {!insideBuilding && isGlassVilla && (() => {
        const isNightN  = sunHour < 6 || sunHour > 20;
        const isDuskN   = !isNightN && (sunHour < 8 || sunHour > 18);
        const lampLI    = isNightN ? 6.0 : isDuskN ? 3.2 : 0.0;
        const glowEmi   = isNightN ? 2.8 : isDuskN ? 1.4 : 0.0;
        // Posts placed along driveway from gate to building entrance
        const dvHalf = Math.min(W * 0.15, 2.20);  // half-width of driveway
        const gateZ  = -D / 2 - 14.50 + 0.5;      // approx gate Z
        const buildZ = -D / 2 - 0.80;              // near south face
        const postCount = 3;
        const postH  = 3.20;
        const postPositions: Array<[number, number]> = [];
        for (let pi = 0; pi < postCount; pi++) {
          const t  = (pi + 0.5) / postCount;
          const pz = gateZ + t * (buildZ - gateZ);
          postPositions.push([ dvHalf + 0.55, pz]);
          postPositions.push([-dvHalf - 0.55, pz]);
        }
        return (
          <group>
            {postPositions.map(([px, pz], li) => (
              <group key={li} position={[px, 0, pz]}>
                {/* Base plinth */}
                <mesh position={[0, 0.10, 0]} castShadow>
                  <boxGeometry args={[0.22, 0.20, 0.22]} />
                  <meshStandardMaterial color="#C4C0B8" roughness={0.78} metalness={0.06} />
                </mesh>
                {/* Main shaft — tapered dark aluminium */}
                <mesh position={[0, postH / 2 + 0.20, 0]} castShadow>
                  <cylinderGeometry args={[0.025, 0.042, postH, 8]} />
                  <meshStandardMaterial color="#2A2E38" roughness={0.32} metalness={0.72} envMapIntensity={1.4} />
                </mesh>
                {/* Neck collar */}
                <mesh position={[0, postH + 0.24, 0]}>
                  <cylinderGeometry args={[0.040, 0.028, 0.055, 8]} />
                  <meshStandardMaterial color="#1E2028" roughness={0.28} metalness={0.80} envMapIntensity={1.6} />
                </mesh>
                {/* Lantern body — hexagonal housing */}
                <mesh position={[0, postH + 0.42, 0]} castShadow>
                  <cylinderGeometry args={[0.088, 0.088, 0.28, 6]} />
                  <meshStandardMaterial color="#1C1E26" roughness={0.25} metalness={0.82} envMapIntensity={1.8} />
                </mesh>
                {/* Glass panels (6 faces, slightly transparent warm) */}
                <mesh position={[0, postH + 0.42, 0]}>
                  <cylinderGeometry args={[0.080, 0.080, 0.24, 6]} />
                  <meshStandardMaterial
                    color="#FFF0B0"
                    transparent opacity={0.55}
                    roughness={0.04} metalness={0.04}
                    emissive="#FFE080" emissiveIntensity={glowEmi}
                    side={THREE.DoubleSide}
                  />
                </mesh>
                {/* Lantern cap — pyramid shape */}
                <mesh position={[0, postH + 0.60, 0]} castShadow>
                  <coneGeometry args={[0.096, 0.14, 6]} />
                  <meshStandardMaterial color="#1A1C22" roughness={0.22} metalness={0.88} envMapIntensity={2.0} />
                </mesh>
                {/* Finial sphere */}
                <mesh position={[0, postH + 0.72, 0]}>
                  <sphereGeometry args={[0.022, 6, 4]} />
                  <meshStandardMaterial color="#C0A840" roughness={0.16} metalness={0.90} envMapIntensity={3.5} />
                </mesh>
                {/* Point light from lantern */}
                {lampLI > 0 && (
                  <pointLight
                    position={[0, postH + 0.42, 0]}
                    intensity={lampLI}
                    distance={7.0}
                    decay={2.0}
                    color="#FFE890"
                    castShadow={false}
                  />
                )}
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 5o. 入口东侧背光装饰石材立板（backlit entrance feature wall panel）──
           A tall dark onyx/slate slab (2.4m W × 2.8m H) is mounted 50mm proud
           of the south building face, east of the entrance canopy.
           LED wash: top-mounted spotlights rake the stone face from above.
           Night: subtle warm backlight bleeds from behind the panel edges,
           and a recessed inground uplight washes the stone from below. */}
      {!insideBuilding && isGlassVilla && (() => {
        const stepW_fw   = Math.min(W * 0.50, 5.5);
        const fwX        = stepW_fw / 2 + 1.50;    // east of entrance steps
        const fwZ        = -D / 2 - 0.20 - 0.05;   // just proud of south face
        const fwW        = 2.40;
        const fwH        = 2.80;
        const fwT        = 0.055;
        const isNightFW  = sunHour < 6 || sunHour > 20;
        const isDuskFW   = !isNightFW && (sunHour < 8 || sunHour > 18);
        const backGlowI  = isNightFW ? 1.0 : isDuskFW ? 0.4 : 0.0;
        const topWashI   = isNightFW ? 4.0 : isDuskFW ? 2.0 : 0.5;
        const botWashI   = isNightFW ? 3.5 : isDuskFW ? 1.5 : 0.0;

        return (
          <group position={[fwX, 0, fwZ]}>
            {/* Main slab — dark grey onyx look */}
            <mesh position={[0, fwH / 2, 0]} castShadow receiveShadow>
              <boxGeometry args={[fwW, fwH, fwT]} />
              <meshStandardMaterial
                color="#1A1C22"
                roughness={0.12} metalness={0.45}
                envMapIntensity={2.5}
              />
            </mesh>
            {/* Subtle veining overlay (2 lighter diagonal strips) */}
            {([[0.3, 0.55, 0.18], [0.55, 0.82, 0.15]] as [number, number, number][]).map(([y1, y2, x1], vi) => (
              <mesh key={vi} position={[-fwW * 0.25 + vi * fwW * 0.40, fwH * (y1 + y2) / 2, fwT / 2 + 0.001]}>
                <boxGeometry args={[fwW * 0.12, fwH * (y2 - y1), 0.002]} />
                <meshStandardMaterial color="#2E3044" roughness={0.10} metalness={0.60} envMapIntensity={3.0} />
              </mesh>
            ))}
            {/* Backing standoff gap — bright backlit strip (visible at top/bottom edges) */}
            {backGlowI > 0 && (
              <>
                {/* Top backlight bleed */}
                <mesh position={[0, fwH + 0.018, fwT / 2 + 0.04]}>
                  <boxGeometry args={[fwW - 0.20, 0.014, 0.050]} />
                  <meshStandardMaterial color="#FFF8E0" emissive="#FFE880" emissiveIntensity={backGlowI * 2.0} roughness={0.60} />
                </mesh>
                {/* Bottom backlight bleed */}
                <mesh position={[0, 0.018, fwT / 2 + 0.04]}>
                  <boxGeometry args={[fwW - 0.20, 0.014, 0.050]} />
                  <meshStandardMaterial color="#FFF8E0" emissive="#FFE880" emissiveIntensity={backGlowI * 1.5} roughness={0.60} />
                </mesh>
                <pointLight position={[0, fwH / 2, 0.10]} intensity={backGlowI * 1.5} distance={fwH} decay={2} color="#FFF4D0" />
              </>
            )}
            {/* Top-mounted downwash spotLight */}
            <spotLight
              position={[0, fwH + 0.30, fwT / 2 + 0.25]}
              target-position={[0, 1.0, 0]}
              intensity={topWashI}
              distance={fwH + 1.0}
              angle={Math.PI * 0.20}
              penumbra={0.60}
              decay={2}
              color="#FFF4E8"
              castShadow={false}
            />
            {/* Bottom inground uplight */}
            {botWashI > 0 && (
              <>
                <mesh position={[0, 0.016, fwT / 2 + 0.22]} rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[0.050, 8]} />
                  <meshStandardMaterial color="#282C34" roughness={0.38} metalness={0.78} />
                </mesh>
                <mesh position={[0, 0.025, fwT / 2 + 0.22]} rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[0.036, 8]} />
                  <meshStandardMaterial color="#FFF8E0" emissive="#FFE880" emissiveIntensity={botWashI * 0.6} roughness={0.55} transparent opacity={0.92} />
                </mesh>
                <spotLight
                  position={[0, 0.10, fwT / 2 + 0.22]}
                  target-position={[0, fwH * 0.6, 0]}
                  intensity={botWashI}
                  distance={fwH + 0.5}
                  angle={Math.PI * 0.13}
                  penumbra={0.45}
                  decay={1.8}
                  color="#FFF2D0"
                  castShadow={false}
                />
              </>
            )}
          </group>
        );
      })()}

      {/* ── 6a. 走廊地板（铺满整层，楼梯间开口处挖空）── */}
      {insideBuilding && Array.from({ length: floorCount }, (_, fi) => {
        const fp = floorPlans[fi];
        if (!fp) return null;
        let lMinX = Infinity, lMinY = Infinity, lMaxX = -Infinity, lMaxY = -Infinity;
        for (const r of (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor)) {
          const p = fp.roomLayout?.[r]; const d = fp.roomDimensions?.[r];
          if (!p || !d) continue;
          lMinX = Math.min(lMinX, p.x); lMinY = Math.min(lMinY, p.y);
          lMaxX = Math.max(lMaxX, p.x + d.width); lMaxY = Math.max(lMaxY, p.y + d.depth);
        }
        if (!isFinite(lMinX)) return null;
        const lW   = (lMaxX - lMinX) * CM;
        const lD   = (lMaxY - lMinY) * CM;
        const lcx  = (lMinX + lMaxX) / 2;
        const lcy  = (lMinY + lMaxY) / 2;
        const wcx  = (lcx - planOffset.minX) * CM - W / 2;
        const wcz  = -((lcy - planOffset.minY) * CM) + D / 2;
        const yBase  = fi * (FLOOR_H + SLAB_T);
        const corrY  = yBase + 0.008;
        const corrCol = "#CEC0A8";  // warm travertine hallway stone

        // 二楼及以上：走廊地板需绕开楼梯开口
        // 从所有楼层中找楼梯间（优先 fi=0，找不到则取任意层），
        // 楼梯井水平位置各层相同。
        const stairEntry = fi > 0
          ? (interiorRooms.find(r => r.fi === 0 && r.isStair)
             ?? interiorRooms.find(r => r.isStair))
          : null;

        if (!stairEntry) {
          // 一楼或无楼梯间：整层铺满
          return (
            <mesh key={`corr-${fi}`} position={[wcx, corrY, wcz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow raycast={() => null}>
              <planeGeometry args={[lW + 0.1, lD + 0.1]} />
              <meshStandardMaterial color={corrCol} roughness={0.52} metalness={0.05} envMapIntensity={0.45} />
            </mesh>
          );
        }

        // 上层楼：把整层地板拆成 4 块矩形绕开楼梯开口
        const { cx: scx, cz: scz, rW: srW, rD: srD } = stairEntry;
        const fL = wcx - lW / 2, fR = wcx + lW / 2;
        const fN = wcz - lD / 2, fS = wcz + lD / 2;   // N=小Z, S=大Z
        const sL = scx - srW / 2, sRx = scx + srW / 2;
        const sN = scz - srD / 2, sSz = scz + srD / 2;

        type Strip = { key: string; w: number; d: number; x: number; z: number };
        const strips: Strip[] = [];
        // 北侧条（楼梯间以北）
        if (sN - fN > 0.01) strips.push({ key: "N", w: lW + 0.1, d: sN - fN, x: wcx, z: (fN + sN) / 2 });
        // 南侧条（楼梯间以南）
        if (fS - sSz > 0.01) strips.push({ key: "S", w: lW + 0.1, d: fS - sSz, x: wcx, z: (sSz + fS) / 2 });
        // 西侧条（楼梯间左侧，仅楼梯间纵深范围）
        if (sL - fL > 0.01) strips.push({ key: "W", w: sL - fL, d: srD, x: (fL + sL) / 2, z: scz });
        // 东侧条（楼梯间右侧）
        if (fR - sRx > 0.01) strips.push({ key: "E", w: fR - sRx, d: srD, x: (sRx + fR) / 2, z: scz });

        return (
          <group key={`corr-${fi}`}>
            {strips.map(s => (
              <mesh key={s.key} position={[s.x, corrY, s.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow raycast={() => null}>
                <planeGeometry args={[s.w, s.d]} />
                <meshStandardMaterial color={corrCol} roughness={0.52} metalness={0.05} envMapIntensity={0.45} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* ── 6. 室内渲染（仅室内视角）── */}
      {/* 室内渲染 —— 玻璃幕墙建筑的卖点是透过玻璃看到室内，所以
          结构层（地板/墙/天花板/楼梯/门）外观模式也渲染，但 GLTF
          家具只在 insideBuilding 时加载（否则一次性 50+ GLTF 卡死）。 */}
      {interiorRooms.map(({ room, fi, cx, cz, yBase, rW, rD, rWcm, rDcm, floorColor, wallColor, placedItems, doors, windows, isStair, isHallway, autoDoor, stairShape, stairRotation }) => {
        const wallOpacity = wallXray ? 0.13 : 1.0;
        const isXray = wallXray;
        // 走廊：无内墙、无天花板，仅地板；楼梯间：渲染楼梯几何体
        // 有配置门优先用配置门，否则用自动生成门
        const effectiveDoors = doors.length > 0 ? doors : autoDoor ? [autoDoor] : [];
        return (
          <group key={`int-${fi}-${room}`}>
            {/* 内墙面：BackSide box — 仅在室内侧可见，不会遮挡窗框/玻璃。
                玻璃房间跳过 —— 这间已经在外层用 5 块独立 emissive plane
                做了室内壳；再叠这个低 emissive 的 BackSide box 会从玻璃
                外看到额外的"立柱"剪影（双层 BackSide 叠加 + 房间间共享
                墙的盒侧面在斜角下露出）。 */}
            {!isStair && !isHallway && !glassRooms.has(`${fi}:${room}`) && (
              <mesh position={[cx, yBase + FLOOR_H / 2, cz]} raycast={() => null}>
                <boxGeometry args={[rW - 0.02, FLOOR_H - 0.01, rD - 0.02]} />
                <meshStandardMaterial color={wallColor} side={THREE.BackSide} roughness={0.82}
                  transparent={isXray} opacity={wallOpacity} depthWrite={!isXray}
                  emissive={wallColor} emissiveIntensity={insideBuilding ? 0.22 : 0.06} />
              </mesh>
            )}
            {/* 走廊：天花板板条（顶部薄板，让走廊从室内清晰可辨）*/}
            {isHallway && (
              <mesh position={[cx, yBase + FLOOR_H - 0.04, cz]} raycast={() => null}>
                <boxGeometry args={[rW, 0.08, rD]} />
                <meshStandardMaterial color="#E8E4DC" roughness={0.88} side={THREE.DoubleSide} />
              </mesh>
            )}
            {/* 地板：楼梯间上层（fi>0）不渲染地板，保持楼梯开口畅通 */}
            {!(isStair && fi > 0) && (
              <mesh position={[cx, yBase + 0.025, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow raycast={() => null}>
                <planeGeometry args={[rW - 0.04, rD - 0.04]} />
                {/* 室内：高光木地板（低粗糙度 + 轻微金属感，反射筒灯）*/}
                <meshStandardMaterial
                  color={floorColor}
                  roughness={insideBuilding ? 0.42 : 0.70}
                  metalness={insideBuilding ? 0.06 : 0.03}
                  envMapIntensity={insideBuilding ? 0.55 : 0.2}
                  side={THREE.DoubleSide}
                />
              </mesh>
            )}
            {/* 天花板 — 走廊和楼梯间不渲染 */}
            {!isStair && !isHallway && (
              <mesh position={[cx, yBase + FLOOR_H - 0.025, cz]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
                <planeGeometry args={[rW - 0.04, rD - 0.04]} />
                <meshStandardMaterial color="#F5F2EE" roughness={0.88} side={THREE.BackSide}
                  emissive="#FFFDF8" emissiveIntensity={insideBuilding ? 0.08 : 0.02}
                  transparent={isXray} opacity={isXray ? 0.08 : 1} depthWrite={!isXray} />
              </mesh>
            )}
            {/* 天花板筒灯（室内模式）—— 4 盏矩形嵌入式灯，不遮挡视线 */}
            {insideBuilding && !isStair && !isHallway && !glassRooms.has(`${fi}:${room}`) && (() => {
              const roomArea = rW * rD;
              const lightCount = roomArea > 12 ? 4 : roomArea > 6 ? 2 : 1;
              const offsets: [number, number][] = lightCount === 4
                ? [[-rW*0.26, -rD*0.26], [rW*0.26, -rD*0.26], [-rW*0.26, rD*0.26], [rW*0.26, rD*0.26]]
                : lightCount === 2
                ? [[-rW*0.22, 0], [rW*0.22, 0]]
                : [[0, 0]];
              return offsets.map(([ox, oz], li) => (
                <group key={`clight-${li}`} position={[cx + ox, yBase + FLOOR_H - 0.02, cz + oz]}>
                  {/* 嵌入式筒灯外壳 */}
                  <mesh raycast={() => null}>
                    <cylinderGeometry args={[0.08, 0.08, 0.02, 12]} />
                    <meshStandardMaterial color="#E0E0DC" roughness={0.4} metalness={0.25} />
                  </mesh>
                  {/* 发光灯片 */}
                  <mesh position={[0, -0.005, 0]} raycast={() => null}>
                    <cylinderGeometry args={[0.065, 0.065, 0.005, 12]} />
                    <meshStandardMaterial color="#FFFCE8" emissive="#FFF5D0" emissiveIntensity={3.5} roughness={0.3} />
                  </mesh>
                  {/* 点光源 */}
                  <pointLight
                    position={[0, -0.12, 0]}
                    intensity={rW * rD * 0.28}
                    distance={Math.max(rW, rD) * 2.4}
                    decay={2}
                    color="#FFF8E8"
                  />
                </group>
              ));
            })()}
            {/* 踢脚线（室内模式）—— 沿四墙底部 6cm 深色条 */}
            {insideBuilding && !isStair && !isHallway && !glassRooms.has(`${fi}:${room}`) && (
              <group position={[cx, yBase + 0.04, cz]} raycast={() => null}>
                {/* 北墙踢脚 */ }
                <mesh position={[0, 0,  rD / 2 - 0.01]} rotation={[0, Math.PI, 0]}>
                  <boxGeometry args={[rW - 0.04, 0.08, 0.012]} />
                  <meshStandardMaterial color="#9C8A70" roughness={0.75} />
                </mesh>
                {/* 南墙踢脚 */}
                <mesh position={[0, 0, -rD / 2 + 0.01]}>
                  <boxGeometry args={[rW - 0.04, 0.08, 0.012]} />
                  <meshStandardMaterial color="#9C8A70" roughness={0.75} />
                </mesh>
                {/* 东墙踢脚 */}
                <mesh position={[ rW / 2 - 0.01, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
                  <boxGeometry args={[rD - 0.04, 0.08, 0.012]} />
                  <meshStandardMaterial color="#9C8A70" roughness={0.75} />
                </mesh>
                {/* 西墙踢脚 */}
                <mesh position={[-rW / 2 + 0.01, 0, 0]} rotation={[0,  Math.PI / 2, 0]}>
                  <boxGeometry args={[rD - 0.04, 0.08, 0.012]} />
                  <meshStandardMaterial color="#9C8A70" roughness={0.75} />
                </mesh>
              </group>
            )}
            {/* 楼梯间：每层都渲染一套完整楼梯（扶手封在楼板处，无 X 交叉） */}
            {isStair && (
              <group position={[cx, yBase, cz]}>
                <StaircaseGeom W={rW} D={rD} color={wallColor} shape={stairShape} stairRotation={stairRotation} />
              </group>
            )}
            {/* 门：外观模式 + 本层有任何玻璃房间 → 跳过本层所有内部门：
                非玻璃房间（主卧/书房）的门也会从邻居玻璃幕墙看进来变
                "立柱"。门是内视角装饰，对外观无贡献，安全跳过。 */}
            {!isStair && !(!insideBuilding && (floorPlans[fi]?.enabledRooms ?? []).some(r => glassRooms.has(`${fi}:${r}`))) && effectiveDoors.map((door, di) => {
              const dW  = door.len * CM;
              const dH  = (door.h ?? 200) * CM;
              const dPos = door.pos * CM;
              const style = door.style ?? (fi === 0 ? "french_double" : "wood_panel");
              // 计算门在世界坐标系中的位置和朝向（+z local = 向室内方向）
              // dPos and dW are already in metres — no extra * CM needed
              let dx = 0, dz = 0, rotY = 0;
              if (door.wall === "back") {
                dz = cz - rD / 2 + 0.01;
                dx = cx + dPos + dW / 2 - rW / 2;
                rotY = 0;
              } else if (door.wall === "front") {
                dz = cz + rD / 2 - 0.01;
                dx = cx + dPos + dW / 2 - rW / 2;
                rotY = Math.PI;
              } else if (door.wall === "left") {
                dx = cx - rW / 2 + 0.01;
                dz = cz - dPos - dW / 2 + rD / 2;
                rotY = -Math.PI / 2;
              } else {
                dx = cx + rW / 2 - 0.01;
                dz = cz - dPos - dW / 2 + rD / 2;
                rotY = Math.PI / 2;
              }
              // 门框颜色：一楼用浅灰铝合金，其他层用暖木色
              const frameCol = fi === 0 ? "#B0B8C0" : "#8B6914";
              return (
                <group key={`door-${fi}-${room}-${di}`} position={[dx, yBase + dH / 2, dz]} rotation={[0, rotY, 0]}>
                  {/* 门框左柱 */}
                  <mesh position={[-dW / 2 + 0.03, 0, 0]}>
                    <boxGeometry args={[0.06, dH, 0.10]} />
                    <meshStandardMaterial color={frameCol} roughness={0.5} metalness={fi === 0 ? 0.4 : 0.05} />
                  </mesh>
                  {/* 门框右柱 */}
                  <mesh position={[dW / 2 - 0.03, 0, 0]}>
                    <boxGeometry args={[0.06, dH, 0.10]} />
                    <meshStandardMaterial color={frameCol} roughness={0.5} metalness={fi === 0 ? 0.4 : 0.05} />
                  </mesh>
                  {/* 门框上横梁 */}
                  <mesh position={[0, dH / 2 - 0.03, 0]}>
                    <boxGeometry args={[dW, 0.06, 0.10]} />
                    <meshStandardMaterial color={frameCol} roughness={0.5} metalness={fi === 0 ? 0.4 : 0.05} />
                  </mesh>

                  {/* ── 法式对开玻璃门（关闭状态，紧贴墙面）── */}
                  {style === "french_double" && (<>
                    {/* 左扇 — 关闭，紧贴墙面 */}
                    <mesh position={[-dW * 0.25, 0, 0.02]}>
                      <boxGeometry args={[dW * 0.47, dH * 0.96, 0.04]} />
                      <meshStandardMaterial color="#A8D4F5" transparent opacity={0.55} roughness={0.05} metalness={0.15} />
                    </mesh>
                    <mesh position={[-dW * 0.25, 0, 0.025]}>
                      <boxGeometry args={[0.03, dH * 0.96, 0.05]} />
                      <meshStandardMaterial color={frameCol} roughness={0.4} metalness={0.3} />
                    </mesh>
                    {/* 右扇 — 关闭，紧贴墙面 */}
                    <mesh position={[dW * 0.25, 0, 0.02]}>
                      <boxGeometry args={[dW * 0.47, dH * 0.96, 0.04]} />
                      <meshStandardMaterial color="#A8D4F5" transparent opacity={0.55} roughness={0.05} metalness={0.15} />
                    </mesh>
                    <mesh position={[dW * 0.25, 0, 0.025]}>
                      <boxGeometry args={[0.03, dH * 0.96, 0.05]} />
                      <meshStandardMaterial color={frameCol} roughness={0.4} metalness={0.3} />
                    </mesh>
                  </>)}

                  {/* ── 磨砂玻璃门（关闭状态，紧贴墙面）── */}
                  {style === "frosted_glass" && (
                    <group position={[0, 0, 0.02]}>
                      <mesh position={[0, -dH * 0.27, 0]}>
                        <boxGeometry args={[dW * 0.94, dH * 0.38, 0.04]} />
                        <meshStandardMaterial color="#C4922A" roughness={0.6} />
                      </mesh>
                      <mesh position={[0, dH * 0.17, 0]}>
                        <boxGeometry args={[dW * 0.94, dH * 0.55, 0.04]} />
                        <meshStandardMaterial color="#E8EFF5" transparent opacity={0.72} roughness={0.9} />
                      </mesh>
                    </group>
                  )}

                  {/* ── 谷仓推拉门（滑开状态，紧贴墙面一侧）── */}
                  {style === "sliding_barn" && (
                    <mesh position={[dW * 0.55, 0, 0.06]}>
                      <boxGeometry args={[dW * 0.94, dH * 0.97, 0.06]} />
                      <meshStandardMaterial color="#8B5E3C" roughness={0.7} />
                    </mesh>
                  )}

                  {/* ── 标准实木门（关闭状态，紧贴墙面）── */}
                  {(style === "wood_panel" || (style !== "frosted_glass" && style !== "sliding_barn" && style !== "french_double")) && (
                    <mesh position={[0, 0, 0.02]}>
                      <boxGeometry args={[dW * 0.96, dH * 0.97, 0.04]} />
                      <meshStandardMaterial color="#C4922A" roughness={0.5} metalness={0.05} />
                    </mesh>
                  )}
                </group>
              );
            })}

            {/* 窗框：在有窗户的墙面渲染窗框（仅室内视角，嵌在墙面内侧）
                外观模式 + 本层有任何玻璃房间 → 跳过本层所有窗框：
                即使是非玻璃房间（如主卧）的窗户，也可能从邻居的玻璃
                幕墙看进来变成"立柱"。窗框是内视角装饰，对外观视角无
                贡献，安全跳过。 */}
            {!isStair && !(!insideBuilding && (floorPlans[fi]?.enabledRooms ?? []).some(r => glassRooms.has(`${fi}:${r}`))) && windows.map((win, wi) => {
              const wW   = win.len * CM;
              const wH   = (win.h    ?? 150) * CM;
              const wSill = (win.sill ?? 90)  * CM;
              const wPos  = win.pos * CM;
              // wPos and wW are already in metres — no extra * CM needed
              let wx = 0, wz = 0, rotY = 0;
              if (win.wall === "back") {
                wz = cz - rD / 2 + 0.012;
                wx = cx + wPos + wW / 2 - rW / 2;
                rotY = 0;
              } else if (win.wall === "front") {
                wz = cz + rD / 2 - 0.012;
                wx = cx + wPos + wW / 2 - rW / 2;
                rotY = Math.PI;
              } else if (win.wall === "left") {
                wx = cx - rW / 2 + 0.012;
                wz = cz - wPos - wW / 2 + rD / 2;
                rotY = -Math.PI / 2;
              } else {
                wx = cx + rW / 2 - 0.012;
                wz = cz - wPos - wW / 2 + rD / 2;
                rotY = Math.PI / 2;
              }
              const frameCy   = yBase + wSill + wH / 2;
              const frameCol  = "#D8E8F0";
              const border    = 0.06;
              const thick     = 0.05;
              return (
                <group key={`win-${fi}-${room}-${wi}`} position={[wx, frameCy, wz]} rotation={[0, rotY, 0]}>
                  {/* 玻璃（浅蓝透明，嵌在墙壁内侧） */}
                  <mesh>
                    <boxGeometry args={[wW - border * 2, wH - border * 2, 0.01]} />
                    <meshStandardMaterial color="#A8D4F5" transparent opacity={0.42} roughness={0.05} metalness={0.12} />
                  </mesh>
                  {/* 四边窗框 */}
                  <mesh position={[0, wH / 2 - border / 2, 0]}>
                    <boxGeometry args={[wW, border, thick]} /><meshStandardMaterial color={frameCol} roughness={0.35} />
                  </mesh>
                  <mesh position={[0, -wH / 2 + border / 2, 0]}>
                    <boxGeometry args={[wW, border, thick]} /><meshStandardMaterial color={frameCol} roughness={0.35} />
                  </mesh>
                  <mesh position={[-wW / 2 + border / 2, 0, 0]}>
                    <boxGeometry args={[border, wH, thick]} /><meshStandardMaterial color={frameCol} roughness={0.35} />
                  </mesh>
                  <mesh position={[wW / 2 - border / 2, 0, 0]}>
                    <boxGeometry args={[border, wH, thick]} /><meshStandardMaterial color={frameCol} roughness={0.35} />
                  </mesh>
                  {/* 中竖分隔条 */}
                  <mesh>
                    <boxGeometry args={[0.04, wH - border * 2, thick]} /><meshStandardMaterial color={frameCol} roughness={0.35} />
                  </mesh>
                </group>
              );
            })}

            {/* 家具渲染策略 — 选项 A 低 LOD:
                • 外观模式: 用 furn.color 的彩色 box 占位（footprint =
                  width × depth × height，几乎零开销，50 件家具仍流畅）
                • 漫游/单房间模式: 加载真实 GLTF
                • 玻璃幕墙房间: 跳过 —— 已有模板风格的剪影家具
                  （沙发 / 茶几 / 吊灯）在玻璃后专门画了，再叠彩色 box
                  会乱。 */}
            <group position={[cx, yBase, cz]}>
              {!isStair
                && !(!insideBuilding && (floorPlans[fi]?.enabledRooms ?? []).some(r => glassRooms.has(`${fi}:${r}`)))
                && placedItems
                .filter(p => {
                  const fItem = getFurnitureById(p.furnitureId);
                  if (fItem?.category === "curtain") return false;
                  return true;
                })
                .map(p => {
                  const modP = { ...p, z: rDcm - p.z, rotation: (540 - p.rotation) % 360 };
                  if (insideBuilding) {
                    return (
                      <Suspense key={p.instanceId} fallback={null}>
                        <PlacedItemMesh placed={modP} def={ROOM_DEFS[room]} roomW={rW} roomD={rD} room={room} />
                      </Suspense>
                    );
                  }
                  // Low-LOD: 直接 box，避免 GLTF。位置/尺寸算法和
                  // PlacedItemMesh 内部保持一致（参考其 x3d/z3d 公式）。
                  const fItem = getFurnitureById(p.furnitureId);
                  if (!fItem) return null;
                  const fw = (fItem.width  * (modP.scaleW ?? 1)) / 100;
                  const fd = (fItem.depth  * (modP.scaleD ?? 1)) / 100;
                  const fh = (fItem.height * (modP.scaleH ?? 1)) / 100;
                  const x3d = modP.x / 100 - rW / 2;
                  const z3d = modP.z / 100 - rD / 2;
                  const FLOOR_SURFACE = 0.025; // floor plane is rendered 2.5cm above yBase
                  const baseY = modP.mountCeiling
                    ? (FLOOR_H - fh)
                    : FLOOR_SURFACE + (modP.elevationY ?? 0) / 100;
                  const rotY = (modP.rotation * Math.PI) / 180;
                  // 加点 emissive 让 box 在玻璃后面也看得见 — 内部光线
                  // 经过 transparent 玻璃后会暗一截，靠 emissive 弥补。
                  const boxColor = fItem.color ?? "#A8A8A8";
                  return (
                    <mesh
                      key={p.instanceId}
                      position={[x3d, baseY + fh / 2, z3d]}
                      rotation={[0, rotY, 0]}
                      castShadow receiveShadow
                    >
                      <boxGeometry args={[fw, fh, fd]} />
                      <meshStandardMaterial
                        color={boxColor}
                        emissive={boxColor}
                        emissiveIntensity={0.18}
                        roughness={0.7}
                        metalness={0.05}
                      />
                    </mesh>
                  );
                })}
            </group>
          </group>
        );
      })}
    </group>
  );
}
