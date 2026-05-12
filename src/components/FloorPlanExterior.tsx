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

import { useMemo, useCallback, useState, Suspense } from "react";
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
  const cols  = Math.max(2, Math.round(width / 1.35));
  const panelW = width / cols;
  const mullionW = 0.095;
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
                  {/* Upper vision pane */}
                  <mesh position={[0, visBot + botH + topH / 2, 0.020]} renderOrder={10}>
                    <boxGeometry args={[panelW - 0.006, topH - 0.004, 0.008]} />
                    <meshStandardMaterial
                      color={hasDoor ? "#C2D6E4" : "#C8DCE8"}
                      transparent opacity={hasDoor ? 0.48 : 0.44}
                      depthWrite={false} roughness={0.03} metalness={0.14}
                      envMapIntensity={2.4} side={THREE.DoubleSide}
                      {...overlayMaterialProps(2)}
                    />
                  </mesh>
                  {/* Lower vision pane (fixed / operable bottom sash) */}
                  <mesh position={[0, visBot + botH / 2, 0.020]} renderOrder={10}>
                    <boxGeometry args={[panelW - 0.006, botH - 0.004, 0.008]} />
                    <meshStandardMaterial
                      color={hasDoor ? "#BDD0DE" : "#C4D8E4"}
                      transparent opacity={hasDoor ? 0.52 : 0.46}
                      depthWrite={false} roughness={0.04} metalness={0.12}
                      envMapIntensity={2.2} side={THREE.DoubleSide}
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
                  {!hasDoor && panelBlindHash(ci, ri) < 0.28 && (() => {
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
  const grooveColor  = "#B8B3AB";   // deeper groove shadow
  const baseColor    = "#C8C4BC";   // warm-gray concrete base

  return (
    <group>
      {/* ── 底板（整面）── */}
      <mesh>
        <boxGeometry args={[width, height, 0.08]} />
        <meshStandardMaterial color={baseColor} roughness={0.88} metalness={0.01} />
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
              {/* Plant clumps — varying color green blobs */}
              {Array.from({ length: Math.max(2, Math.round(w.winLen / 0.55)) }, (_, pi) => {
                const px3 = -w.winLen / 2 + 0.28 + pi * (w.winLen / Math.max(1, Math.round(w.winLen / 0.55) - 0));
                const greenTone = panelBlindHash(wi + pi * 5, wi * 2 + pi) < 0.5 ? "#2E6820" : "#4A8030";
                return (
                  <mesh key={pi} position={[px3, 0.14, 0]} castShadow>
                    <sphereGeometry args={[0.12 + panelBlindHash(pi, wi + 3) * 0.06, 6, 5]} />
                    <meshStandardMaterial color={greenTone} roughness={0.96} />
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
    ? 1.55   // night — strong interior glow
    : sunHour < 8 || sunHour > 18
    ? 1.20   // dawn/dusk — moderate glow
    : 0.92;  // day — subtle (existing default)
  const interiorGlowCeil: number = sunHour < 6 || sunHour > 20
    ? 0.90   // night ceiling
    : sunHour < 8 || sunHour > 18
    ? 0.72   // dawn/dusk ceiling
    : 0.60;  // day ceiling

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
              return (
                <mesh key={si} position={[0, sy, sz]} castShadow receiveShadow>
                  <boxGeometry args={[sw, stepRise, stepRun]} />
                  <meshStandardMaterial color="#D8D4CC" roughness={0.45} metalness={0.06} envMapIntensity={0.9} />
                </mesh>
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
        const bndS7   = -D / 2 - 11.50;
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

      {/* ── 外立面转角柱（4 角）— 黑色阳极氧化铝方柱，给建筑立面明确边界，
              现代玻璃幕墙建筑标配转角细节 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const colW   = 0.16;   // column cross-section
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
        const slabColor  = "#C8C4BC";

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
          const halfW = totalW / 2;
          const halfD = totalD / 2;

          if (!stairEntry) {
            return (
              <group key={`slab-${fi}`}>
                <mesh position={[slabCX, slabY, slabCZ]} castShadow receiveShadow>
                  <boxGeometry args={[totalW, SLAB_T, totalD]} />
                  <meshStandardMaterial color={slabColor} roughness={0.85} metalness={0.02} />
                </mesh>
                {/* 楼板下边缘暗线（阴影缝，增加分层感）*/}
                <mesh position={[slabCX, slabY - SLAB_T / 2 - 0.015, slabCZ]}>
                  <boxGeometry args={[totalW + 0.01, 0.030, totalD + 0.01]} />
                  <meshStandardMaterial color="#8A8680" roughness={0.9} />
                </mesh>
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
              {/* 楼板下边缘暗线（阴影缝）— deeper shadow reveal */}
              <mesh position={[slabCX, slabY - SLAB_T / 2 - 0.015, slabCZ]}>
                <boxGeometry args={[totalW + 0.01, 0.030, totalD + 0.01]} />
                <meshStandardMaterial color="#7C7870" roughness={0.90} />
              </mesh>
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
              {showRailing && (
                /* Railing group placed at floor base + outward ~5cm */
                <group position={[0, -FLOOR_H / 2 + 0.005, 0.05]}>
                  {/* Glass panel — 0.95m high, full-width */}
                  <mesh position={[0, 0.475, 0.006]} renderOrder={11}>
                    <boxGeometry args={[segLen - 0.06, 0.95, 0.012]} />
                    <meshStandardMaterial
                      color="#CCDDE8"
                      transparent opacity={0.36}
                      depthWrite={false}
                      roughness={0.03} metalness={0.14}
                      envMapIntensity={2.2}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                  {/* Top handrail — brushed steel bar */}
                  <mesh position={[0, 0.968, 0]}>
                    <boxGeometry args={[segLen - 0.04, 0.042, 0.042]} />
                    <meshStandardMaterial color="#181A1E" roughness={0.10} metalness={0.95} envMapIntensity={2.6} />
                  </mesh>
                  {/* Vertical end-posts */}
                  {[-segLen / 2 + 0.025, segLen / 2 - 0.025].map((ex, ei) => (
                    <mesh key={ei} position={[ex, 0.485, 0]}>
                      <boxGeometry args={[0.040, 0.975, 0.040]} />
                      <meshStandardMaterial color="#181A1E" roughness={0.10} metalness={0.95} />
                    </mesh>
                  ))}
                </group>
              )}
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
            {/* ── 车库门（garage door）——宽门（≥ 2m）渲染为卷帘分节式车库门 ──
                 Modern sectional panel garage door: dark brushed aluminum,
                 4 horizontal panels with thin reveal lines. */}
            {floorIndex === 0 && doorInfos.filter(d => d.w >= 2.0).map((d, di) => {
              const gdW  = d.w;
              const gdH  = Math.min(d.h, FLOOR_H * 0.85);
              const panels = 4;
              const panelH = gdH / panels;
              const gdY  = -FLOOR_H / 2 + gdH / 2;
              const gdColor  = "#2A2E38";    // dark anodized aluminum
              const gdReveal = "#1C1E24";    // deeper groove
              const gdSheen  = "#3A4050";    // lighter panel face
              return (
                <group key={`gd-${di}`} position={[d.cx, gdY, 0.065]}>
                  {/* Frame — perimeter aluminum channel */}
                  <mesh position={[0, 0, -0.008]}>
                    <boxGeometry args={[gdW + 0.06, gdH + 0.06, 0.040]} />
                    <meshStandardMaterial color={gdColor} roughness={0.20} metalness={0.90} envMapIntensity={2.2} />
                  </mesh>
                  {/* Panel sections */}
                  {Array.from({ length: panels }, (_, pi) => {
                    const pyOffset = -gdH / 2 + (pi + 0.5) * panelH;
                    return (
                      <group key={pi} position={[0, pyOffset, 0]}>
                        {/* Panel face */}
                        <mesh>
                          <boxGeometry args={[gdW - 0.04, panelH - 0.012, 0.025]} />
                          <meshStandardMaterial color={pi % 2 === 0 ? gdSheen : gdColor} roughness={0.22} metalness={0.86} envMapIntensity={2.0} />
                        </mesh>
                        {/* Horizontal reveal groove at panel bottom */}
                        <mesh position={[0, -panelH / 2 + 0.004, 0.014]}>
                          <boxGeometry args={[gdW - 0.04, 0.009, 0.010]} />
                          <meshStandardMaterial color={gdReveal} roughness={0.30} metalness={0.85} />
                        </mesh>
                      </group>
                    );
                  })}
                  {/* Central door handle / pull bar */}
                  <mesh position={[0, -gdH * 0.28, 0.020]}>
                    <boxGeometry args={[gdW * 0.22, 0.025, 0.022]} />
                    <meshStandardMaterial color="#B0B8C4" roughness={0.18} metalness={0.92} envMapIntensity={2.4} />
                  </mesh>
                  {/* Door tracks (both sides) */}
                  {([-gdW / 2 - 0.015, gdW / 2 + 0.015] as number[]).map((tx, ti) => (
                    <mesh key={ti} position={[tx, 0, -0.020]}>
                      <boxGeometry args={[0.030, gdH + 0.06, 0.020]} />
                      <meshStandardMaterial color={gdColor} roughness={0.25} metalness={0.88} />
                    </mesh>
                  ))}
                </group>
              );
            })}
          </group>
        );
      })}

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
          </group>
        );
      })()}

      {!insideBuilding && <FlatRoof W={W} D={D} roofY={totalH} nightGlow={interiorGlowWall > 1.20 ? 1.0 : interiorGlowWall > 0.92 ? 0.5 : 0} />}

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

      {/* ── 5c. 游泳池（outdoor swimming pool, south yard）── */}
      {!insideBuilding && isGlassVilla && (() => {
        const poolW  = Math.min(W * 0.72, 10.0);  // pool width E-W
        const poolL  = 4.80;                        // pool length N-S
        const poolDp = 0.55;                        // pool depth below grade
        const pz     = -D / 2 - 5.80;              // south yard, clear of steps
        const deckBW = 0.52;                        // deck border width
        const deckT  = 0.09;                        // deck slab thickness
        const isNightP = sunHour < 6 || sunHour > 20;
        const isDuskP  = !isNightP && (sunHour < 8 || sunHour > 18);
        const poolGlowI = isNightP ? 2.2 : isDuskP ? 1.0 : 0.06;
        return (
          <group position={[0, 0, pz]}>
            {/* Pool shell — dark blue-grey rendered concrete */}
            <mesh position={[0, -poolDp / 2 - deckT, 0]} receiveShadow>
              <boxGeometry args={[poolW + deckBW * 2, poolDp + deckT * 2, poolL + deckBW * 2]} />
              <meshStandardMaterial color="#404850" roughness={0.70} metalness={0.08} />
            </mesh>
            {/* Pool interior tile — azure mosaic blue */}
            <mesh position={[0, -poolDp / 2, 0]}>
              <boxGeometry args={[poolW, poolDp - 0.02, poolL]} />
              <meshStandardMaterial
                color="#2878A0"
                emissive="#204E70"
                emissiveIntensity={poolGlowI}
                roughness={0.35}
                metalness={0.10}
              />
            </mesh>
            {/* Water surface — semi-transparent rippled */}
            <mesh position={[0, 0.008, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={10}>
              <planeGeometry args={[poolW, poolL]} />
              <meshStandardMaterial
                color="#3090C0"
                transparent opacity={0.78}
                depthWrite={false}
                roughness={0.04}
                metalness={0.12}
                envMapIntensity={4.5}
                side={THREE.DoubleSide}
                {...overlayMaterialProps(2)}
              />
            </mesh>
            {/* Pool deck — travertine pale stone on all 4 sides */}
            {([
              [0,                      poolL / 2 + deckBW / 2,  poolW + deckBW * 2, deckBW],
              [0,                     -(poolL / 2 + deckBW / 2), poolW + deckBW * 2, deckBW],
              [ poolW / 2 + deckBW / 2, 0,                       deckBW,            poolL],
              [-(poolW / 2 + deckBW / 2), 0,                     deckBW,            poolL],
            ] as [number, number, number, number][]).map(([dx, dz, dw, dd], di) => (
              <mesh key={di} position={[dx, deckT / 2, dz]} receiveShadow>
                <boxGeometry args={[dw, deckT, dd]} />
                <meshStandardMaterial color="#D8D0BC" roughness={0.74} metalness={0.04} />
              </mesh>
            ))}
            {/* Underwater night glow */}
            {isNightP && (
              <pointLight position={[0, -0.20, 0]} intensity={poolGlowI * 3.0} distance={poolW * 1.4} decay={1.6} color="#40C0F0" castShadow={false} />
            )}
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
          </group>
        );
      })()}

      {/* ── 5d. 场地边界矮墙 + 入口大门 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const bndN   =  D / 2 + 3.20;    // north boundary Z
        const bndS   = -D / 2 - 11.50;   // south boundary Z (beyond pool)
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
              </group>
            ))}
            {/* Driveway iron gate leaves (closed, dark charcoal) */}
            {([-1, 1] as number[]).map((side) => {
              const leafX = gateX2 + side * gateW2 / 2;
              return (
                <group key={side} position={[leafX, 0, bndS]}>
                  {/* Outer frame */}
                  <mesh position={[0, wallH2 * 0.55, 0]} castShadow>
                    <boxGeometry args={[gateW2 - 0.06, wallH2 * 1.15, 0.040]} />
                    <meshStandardMaterial color="#1C1E26" roughness={0.28} metalness={0.78} />
                  </mesh>
                  {/* Vertical bars × 4 */}
                  {Array.from({ length: 4 }, (_, bi) => {
                    const bx = -gateW2 / 2 + 0.10 + bi * ((gateW2 - 0.20) / 3);
                    return (
                      <mesh key={bi} position={[bx, wallH2 * 0.56, 0.022]}>
                        <boxGeometry args={[0.028, wallH2 * 1.10, 0.028]} />
                        <meshStandardMaterial color="#252830" roughness={0.30} metalness={0.72} />
                      </mesh>
                    );
                  })}
                </group>
              );
            })}
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
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5e-1. 北侧庭院雕塑（garden sculpture, north yard centre）──
           Abstract polished-steel totem: stacked tapered cylinders on a
           dark granite plinth. Reflective, catches sky light well. */}
      {!insideBuilding && isGlassVilla && (() => {
        const sculX = 0;
        const sculZ = D / 2 + 1.60;   // north yard centre
        const isNightSc = sunHour < 6 || sunHour > 20;
        return (
          <group position={[sculX, 0, sculZ]}>
            {/* Granite plinth */}
            <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
              <boxGeometry args={[0.55, 0.36, 0.55]} />
              <meshStandardMaterial color="#1C1E24" roughness={0.22} metalness={0.38} envMapIntensity={1.5} />
            </mesh>
            {/* Plinth top face — polished */}
            <mesh position={[0, 0.362, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[0.53, 0.53]} />
              <meshStandardMaterial color="#2A2C32" roughness={0.06} metalness={0.55} envMapIntensity={3.0} />
            </mesh>
            {/* Lower totem element — broad */}
            <mesh position={[0, 0.72, 0]} castShadow>
              <cylinderGeometry args={[0.12, 0.16, 0.70, 8]} />
              <meshStandardMaterial color="#B8C0CC" roughness={0.06} metalness={0.96} envMapIntensity={4.0} />
            </mesh>
            {/* Middle element — tapered inward */}
            <mesh position={[0, 1.22, 0]} castShadow>
              <cylinderGeometry args={[0.085, 0.12, 0.55, 8]} />
              <meshStandardMaterial color="#C8D0D8" roughness={0.08} metalness={0.94} envMapIntensity={4.0} />
            </mesh>
            {/* Upper element — slender */}
            <mesh position={[0, 1.70, 0]} castShadow>
              <cylinderGeometry args={[0.055, 0.085, 0.60, 8]} />
              <meshStandardMaterial color="#D4DDE5" roughness={0.06} metalness={0.96} envMapIntensity={4.5} />
            </mesh>
            {/* Finial sphere */}
            <mesh position={[0, 2.03, 0]}>
              <sphereGeometry args={[0.065, 10, 8]} />
              <meshStandardMaterial color="#E0E8EE" roughness={0.04} metalness={0.98} envMapIntensity={5.0} />
            </mesh>
            {/* Night accent light at base */}
            {isNightSc && (
              <pointLight position={[0, 0.40, 0.35]} intensity={2.5} distance={3.0} decay={2.0} color="#E8F0FF" />
            )}
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
        const bndS2  = -D / 2 - 11.50;
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
        const bndS3   = -D / 2 - 11.50;
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
        const poolZ3 = -D / 2 - 5.80;
        const poolL3 = 4.80;
        const poolDeckW3 = Math.min(W * 0.72, 10.0);
        const deckBW3 = 0.52;
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

      {/* ── 5g. 泳池边休闲区（pool-side loungers + outdoor dining table）── */}
      {!insideBuilding && isGlassVilla && (() => {
        const pz2  = -D / 2 - 5.80;   // pool centre Z (same as 5c)
        const poolL2 = 4.80;
        const poolW2 = Math.min(W * 0.72, 10.0);
        const deckBW2 = 0.52;
        const deckEdgeZ = pz2 + poolL2 / 2 + deckBW2; // south edge of pool deck
        const deckEdgeN = pz2 - poolL2 / 2 - deckBW2; // north edge
        const loungerColor = "#EDE6D2";
        const loungerMetal = "#B0B8C4";
        // Two extra loungers on south deck side (facing north toward building)
        return (
          <group>
            {/* South-side loungers (2, symmetric) */}
            {([-poolW2 * 0.22, poolW2 * 0.22] as number[]).map((lx, li) => (
              <group key={li} position={[lx, 0, deckEdgeZ + 0.60]}>
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
            {/* Patio umbrella over south loungers */}
            <group position={[0, 0, deckEdgeZ + 0.60]}>
              {/* Centre pole — white powder-coat */}
              <mesh position={[0, 1.20, 0]} castShadow>
                <cylinderGeometry args={[0.030, 0.034, 2.40, 8]} />
                <meshStandardMaterial color="#E8EAE4" roughness={0.45} metalness={0.30} />
              </mesh>
              {/* Canopy — 8-panel cone */}
              <mesh position={[0, 2.40, 0]}>
                <coneGeometry args={[1.60, 0.55, 8, 1, true]} />
                <meshStandardMaterial
                  color="#E8D8A0"
                  roughness={0.82}
                  side={THREE.DoubleSide}
                  transparent opacity={0.92}
                />
              </mesh>
              {/* Canopy top finial */}
              <mesh position={[0, 2.70, 0]}>
                <sphereGeometry args={[0.040, 6, 5]} />
                <meshStandardMaterial color="#D8D0B0" roughness={0.55} />
              </mesh>
              {/* Ground base weight */}
              <mesh position={[0, 0.06, 0]}>
                <cylinderGeometry args={[0.22, 0.22, 0.12, 8]} />
                <meshStandardMaterial color="#5A5850" roughness={0.60} metalness={0.30} />
              </mesh>
            </group>
            {/* Dining area umbrella (matches patio umbrella style) */}
            <group position={[poolW2 / 2 + deckBW2 + 1.10, 0, pz2]}>
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
            {/* Outdoor dining table (east side of pool deck) */}
            <group position={[poolW2 / 2 + deckBW2 + 1.10, 0, pz2]}>
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

      {/* ── 5i. 泳池边室外淋浴（outdoor shower post near pool）── */}
      {!insideBuilding && isGlassVilla && (() => {
        const poolW3 = Math.min(W * 0.72, 10.0);
        const pz3    = -D / 2 - 5.80;
        const showerX = -poolW3 / 2 - 0.85;   // west side of pool deck
        const showerZ = pz3 - 0.60;            // north of pool
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

      {/* ── 5j-2. 按摩浴缸 / 水疗缸（outdoor spa / hot tub, west of pool）──
           White acrylic shell with blue glowing water, set into a teak timber
           surround deck. Night mode adds strong underwater LED glow. */}
      {!insideBuilding && isGlassVilla && (() => {
        const poolW4 = Math.min(W * 0.72, 10.0);
        const poolZ4 = -D / 2 - 5.80;   // same Z as main pool
        const htX    = -poolW4 / 2 - 1.80;  // west of pool deck
        const htZ    = poolZ4 + 0.40;
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
