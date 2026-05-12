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
  width, height, windows = [],
}: {
  width: number; height: number;
  windows?: Array<{ localX: number; winLen: number; winH: number; winSill: number }>;
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
      {windows.map((w, wi) => (
        <group key={`ww-${wi}`} position={[w.localX, -height / 2 + w.winSill + w.winH / 2, 0]}>
          {/* 深色室内衬底（模拟从外部看到窗内的深邃感） */}
          <mesh position={[0, 0, -0.04]}>
            <boxGeometry args={[w.winLen - 0.02, w.winH - 0.02, 0.10]} />
            <meshStandardMaterial color="#161A20" roughness={0.9} />
          </mesh>
          {/* 玻璃（浅蓝透明，带反射）*/}
          <mesh position={[0, 0, 0.018]}>
            <planeGeometry args={[w.winLen - 0.04, w.winH - 0.04]} />
            <meshPhysicalMaterial color="#B8D4E8" transmission={0.35} roughness={0.04} metalness={0.08} transparent opacity={0.72} side={THREE.FrontSide} />
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
          {/* 窗台板（concrete sill ledge — casts shadow below window） */}
          <mesh position={[0, -w.winH / 2 - 0.040, 0.055]} castShadow>
            <boxGeometry args={[w.winLen + 0.10, 0.065, 0.130]} />
            <meshStandardMaterial color="#B8B4AC" roughness={0.86} metalness={0.02} />
          </mesh>
          {/* 窗楣（concrete lintel above window — add shadow depth） */}
          <mesh position={[0, w.winH / 2 + 0.030, 0.050]}>
            <boxGeometry args={[w.winLen + 0.04, 0.048, 0.095]} />
            <meshStandardMaterial color="#C0BCB4" roughness={0.88} metalness={0.01} />
          </mesh>
        </group>
      ))}
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
function FlatRoof({ W, D, roofY }: { W: number; D: number; roofY: number }) {
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
      {/* ── 屋顶设备箱（机房/新风系统，增加细节感）── */}
      <mesh position={[-W * 0.28, roofSlab + 0.35, D * 0.18]} castShadow>
        <boxGeometry args={[1.40, 0.70, 0.90]} />
        <meshStandardMaterial color="#B8B4AE" roughness={0.82} metalness={0.08} />
      </mesh>
      {/* ── 太阳能热水器（北侧，倾斜面朝南）── */}
      <group position={[W * 0.25, roofSlab + 0.20, D * 0.28]} rotation={[0.32, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[1.20, 0.06, 1.60]} />
          <meshStandardMaterial color="#2A2E3C" roughness={0.30} metalness={0.45} />
        </mesh>
        {/* 玻璃覆盖面 */}
        <mesh position={[0, 0.04, 0]}>
          <boxGeometry args={[1.18, 0.02, 1.58]} />
          <meshStandardMaterial color="#6090A8" roughness={0.12} metalness={0.22} transparent opacity={0.65} />
        </mesh>
      </group>
      {/* ── 屋顶排气管（细节）── */}
      <mesh position={[W * 0.10, roofSlab + 0.25, -D * 0.10]} castShadow>
        <cylinderGeometry args={[0.08, 0.10, 0.50, 8]} />
        <meshStandardMaterial color="#606468" roughness={0.60} metalness={0.30} />
      </mesh>

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
      {/* 屋顶种植箱 — 绿植对称，增加生机 */}
      {([[-W * 0.36, -D * 0.18], [W * 0.36, -D * 0.18]] as [number,number][]).map(([px, pz], pi) => (
        <group key={`rp-${pi}`} position={[px, roofSlab + 0.05, pz]}>
          <mesh position={[0, 0.24, 0]} castShadow>
            <boxGeometry args={[0.70, 0.48, 0.36]} />
            <meshStandardMaterial color="#3A3840" roughness={0.75} metalness={0.12} />
          </mesh>
          <mesh position={[0, 0.70, 0]} castShadow>
            <sphereGeometry args={[0.34, 10, 8]} />
            <meshStandardMaterial color="#2A5820" roughness={0.94} />
          </mesh>
        </group>
      ))}
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
        return (
          <group>
            {/* 雨棚板面（顶面浅色，底面深色）*/}
            <mesh position={[0, canopyY, canopyZ]} castShadow receiveShadow>
              <boxGeometry args={[canopyW, canopyT, canopyD]} />
              <meshStandardMaterial color="#ECEAE4" roughness={0.82} metalness={0.02} />
            </mesh>
            {/* 雨棚底面暗色 */}
            <mesh position={[0, canopyY - canopyT / 2 - 0.002, canopyZ]}>
              <boxGeometry args={[canopyW + 0.01, 0.004, canopyD + 0.01]} />
              <meshStandardMaterial color="#1E222C" roughness={0.90} />
            </mesh>
            {/* 三根细圆柱支撑（左/中/右，等间距）*/}
            {[-canopyW / 2 + 0.15, 0, canopyW / 2 - 0.15].map((cpx, ci) => (
              <mesh key={ci} position={[cpx, canopyY / 2, southFaceZ + 0.05]} castShadow>
                <cylinderGeometry args={[0.055, 0.055, canopyY, 8]} />
                <meshStandardMaterial color="#18181E" roughness={0.28} metalness={0.88} envMapIntensity={2} />
              </mesh>
            ))}
          </group>
        );
      })()}

      {/* ── 外墙壁灯（南立面）—— 每层 2 盏，对称布置 ── */}
      {!insideBuilding && isGlassVilla && Array.from({ length: usedFloors }, (_, fi) => {
        const wallY  = fi * (FLOOR_H + SLAB_T) + 2.2;  // 灯安装高度（距楼层地面2.2m）
        const wallZ  = -D / 2 - 0.18;   // 紧贴南立面
        const lampX1 = -W * 0.28;
        const lampX2 =  W * 0.28;
        const sconceColor = "#E8E0C0";
        const lightIntensity = 2.5;
        const lightDist = 4.0;
        return [lampX1, lampX2].map((lx, li) => (
          <group key={`sconce-${fi}-${li}`} position={[lx, wallY, wallZ]}>
            {/* 壁灯托架（细矩形）*/}
            <mesh>
              <boxGeometry args={[0.06, 0.06, 0.14]} />
              <meshStandardMaterial color="#282830" roughness={0.30} metalness={0.88} />
            </mesh>
            {/* 灯头（发光方盒）*/}
            <mesh position={[0, 0, -0.10]}>
              <boxGeometry args={[0.10, 0.10, 0.08]} />
              <meshStandardMaterial color={sconceColor} emissive="#FFE4A0" emissiveIntensity={2.8} roughness={0.40} />
            </mesh>
            {/* 点光源 */}
            <pointLight position={[0, -0.05, -0.22]} intensity={lightIntensity} distance={lightDist} decay={2} color="#FFF0D0" />
          </group>
        ));
      })}

      {/* ── 外立面转角柱（4 角）— 黑色阳极氧化铝方柱，给建筑立面明确边界，
              现代玻璃幕墙建筑标配转角细节 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const colW   = 0.16;   // column cross-section
        const colH   = totalH + SLAB_T + 0.06; // full building height + small overshoot
        const colY   = colH / 2;
        const colMat = { color: "#181A1E" as const, roughness: 0.10 as const, metalness: 0.95 as const, envMapIntensity: 2.6 as const };
        return (
          <>
            {([[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]] as [number,number][]).map(([cx2, cz2], ci) => (
              <mesh key={ci} position={[cx2, colY, cz2]} castShadow>
                <boxGeometry args={[colW, colH, colW]} />
                <meshStandardMaterial {...colMat} />
              </mesh>
            ))}
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
                  emissiveIntensity={0.92}
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
                      emissiveIntensity={0.60}
                      roughness={0.92}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                  {/* 地板 —— 胡桃木 */}
                  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -FLOOR_H / 2 + 0.04, 0]} receiveShadow>
                    <planeGeometry args={[iW, iD]} />
                    <meshStandardMaterial color={floorC} roughness={0.55} />
                  </mesh>

                  {/* 吊灯（仅 ≥12㎡ 的房间）*/}
                  {isLarge && (
                    <>
                      <pointLight position={[0, FLOOR_H / 2 - 0.50, 0]} intensity={3.5} distance={Math.max(iW, iD) * 2.2} decay={1.8} color="#FFF8E0" />
                      <mesh position={[0, FLOOR_H / 2 - 0.40, 0]}>
                        <cylinderGeometry args={[0.008, 0.008, 0.30, 8]} />
                        <meshStandardMaterial color="#222" roughness={0.6} />
                      </mesh>
                      <mesh position={[0, FLOOR_H / 2 - 0.62, 0]}>
                        <sphereGeometry args={[0.13, 16, 10]} />
                        <meshStandardMaterial
                          color="#FFE0A0"
                          emissive="#FFC966"
                          emissiveIntensity={2.4}
                          roughness={0.40}
                        />
                      </mesh>
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
                  <meshStandardMaterial color={slabColor} roughness={0.85} />
                </mesh>
                {/* 楼板下边缘暗线（阴影缝，增加分层感）*/}
                <mesh position={[slabCX, slabY - SLAB_T / 2 - 0.015, slabCZ]}>
                  <boxGeometry args={[totalW + 0.01, 0.030, totalD + 0.01]} />
                  <meshStandardMaterial color="#8A8680" roughness={0.9} />
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
          return (
            <group key={`gl-${bi}`} position={[px, yMid, pz]} rotation={rot}>
              <GlassCurtain width={segLen} height={FLOOR_H} floorH={FLOOR_H} doors={floorIndex === 0 ? doorInfos : []} />
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
          // 竖向木条板，每条 12cm 宽，4mm 缝隙（阴影效果）
          const SLAT_W  = 0.120;   // 木条宽度
          const SLAT_GAP = 0.008;  // 缝隙
          const SLAT_T  = 0.048;   // 木条厚度
          const slatStep = SLAT_W + SLAT_GAP;
          const slatCount = Math.max(3, Math.ceil(segLen / slatStep));
          const slatColor  = "#7A4E2A";   // 暖棕木色
          const grooveColor2 = "#3A2010";  // 缝隙深色
          return (
            <group key={`wd-${bi}`} position={[px, yMid, pz]} rotation={rot}>
              {/* 背板（保证无漏光）*/}
              <mesh castShadow receiveShadow>
                <boxGeometry args={[segLen, FLOOR_H, 0.02]} />
                <meshStandardMaterial color={grooveColor2} roughness={0.92} />
              </mesh>
              {/* 竖向木条 */}
              {Array.from({ length: slatCount }, (_, si) => {
                const sx = -segLen / 2 + SLAT_W / 2 + si * slatStep;
                if (sx > segLen / 2) return null;
                // 交替略深色营造自然木纹变化
                const col = si % 3 === 1 ? "#8B5E3C" : si % 3 === 2 ? "#6E4226" : slatColor;
                return (
                  <mesh key={si} position={[sx, 0, 0.020 + SLAT_T / 2]} castShadow>
                    <boxGeometry args={[SLAT_W, FLOOR_H - 0.04, SLAT_T]} />
                    <meshStandardMaterial color={col} roughness={0.82} metalness={0.0} />
                  </mesh>
                );
              })}
            </group>
          );
        }

        // ── 混凝土（含窗） ──
        return (
          <group key={`co-${bi}`} position={[px, yMid, pz]} rotation={rot}>
            <ConcreteFacade width={segLen} height={FLOOR_H} windows={winInfos} />
          </group>
        );
      })}

      {/* ── 5. 平屋顶（室内视角下隐藏） ── */}
      {!insideBuilding && <FlatRoof W={W} D={D} roofY={totalH} />}

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
