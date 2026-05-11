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
  const cols  = Math.max(2, Math.round(width / 1.2));
  const panelW = width / cols;
  const rows  = Math.round(height / floorH);
  const rowH  = height / rows;

  return (
    <group>
      {/* 玻璃格 */}
      {Array.from({ length: cols }, (_, ci) => {
        const px = -width / 2 + (ci + 0.5) * panelW;
        return Array.from({ length: rows }, (_, ri) => {
          const py = -height / 2 + (ri + 0.5) * rowH;
          // 跳过门所在的格
          const hasDoor = doors.some(d => Math.abs(d.cx - px) < panelW / 2 + d.w / 2 && ri === 0);
          return (
            <mesh key={`${ci}-${ri}`} position={[px, py, 0]}>
              <planeGeometry args={[panelW * 0.93, rowH * 0.94]} />
              <meshPhysicalMaterial
                color={hasDoor ? "#A0C8DC" : "#B8D4E4"}
                roughness={0.04} metalness={0.05}
                transmission={hasDoor ? 0.50 : 0.55}
                thickness={0.3}
                transparent opacity={hasDoor ? 0.42 : 0.52}
                side={THREE.DoubleSide}
              />
            </mesh>
          );
        });
      })}

      {/* 竖框 */}
      {Array.from({ length: cols + 1 }, (_, i) => (
        <mesh key={`v${i}`} position={[-width / 2 + i * panelW, 0, 0.02]}>
          <boxGeometry args={[0.055, height + 0.02, 0.07]} />
          <meshStandardMaterial color="#181818" metalness={0.9} roughness={0.15} />
        </mesh>
      ))}
      {/* 横框 — 每层一根 */}
      {Array.from({ length: rows + 1 }, (_, i) => {
        const py = -height / 2 + i * rowH;
        return (
          <mesh key={`h${i}`} position={[0, py, 0.02]}>
            <boxGeometry args={[width + 0.04, 0.05, 0.07]} />
            <meshStandardMaterial color="#181818" metalness={0.9} roughness={0.15} />
          </mesh>
        );
      })}

      {/* 大门 */}
      {doors.map((door, di) => (
        <group key={`door-${di}`} position={[door.cx, -height / 2 + door.h / 2, 0.04]}>
          {[-door.w / 4, door.w / 4].map((ox, si) => (
            <mesh key={si} position={[ox, 0, 0]}>
              <planeGeometry args={[door.w / 2 - 0.04, door.h - 0.06]} />
              <meshPhysicalMaterial color="#90B8CC" transmission={0.60} roughness={0.02} transparent opacity={0.44} side={THREE.DoubleSide} />
            </mesh>
          ))}
          {[
            [0, door.h / 2, door.w, 0.06] as const,
            [0, -door.h / 2, door.w, 0.06] as const,
            [-door.w / 2, 0, 0.06, door.h] as const,
            [0, 0, 0.06, door.h] as const,
            [door.w / 2, 0, 0.06, door.h] as const,
          ].map(([bx, by, bw, bh], bi) => (
            <mesh key={bi} position={[bx, by, 0.02]}>
              <boxGeometry args={[bw, bh, 0.07]} />
              <meshStandardMaterial color="#111" metalness={0.92} roughness={0.12} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}


// ── 混凝土外墙面（带横向分仓线） ─────────────────────────────────
function ConcreteFacade({
  width, height, windows = [],
}: {
  width: number; height: number;
  windows?: Array<{ localX: number; winLen: number; winH: number; winSill: number }>;
}) {
  const panelRows = Math.max(2, Math.round(height / 0.75));
  const rowH = height / panelRows;
  return (
    <group>
      {/* 横缝线 */}
      {Array.from({ length: panelRows - 1 }, (_, i) => (
        <mesh key={`hg-${i}`} position={[0, -height / 2 + (i + 1) * rowH, 0.01]}>
          <boxGeometry args={[width, 0.025, 0.03]} />
          <meshStandardMaterial color="#C8C4BA" roughness={0.92} />
        </mesh>
      ))}
      {/* 窗洞 */}
      {windows.map((w, wi) => (
        <group key={`ww-${wi}`} position={[w.localX, -height / 2 + w.winSill + w.winH / 2, 0.02]}>
          <mesh>
            <planeGeometry args={[w.winLen, w.winH]} />
            <meshPhysicalMaterial color="#A8C4D8" transmission={0.55} roughness={0.06} transparent opacity={0.55} side={THREE.DoubleSide} />
          </mesh>
          {([[-w.winLen/2,0,w.winLen*0.05,w.winH],[w.winLen/2,0,w.winLen*0.05,w.winH],[0,-w.winH/2,w.winLen,w.winH*0.05],[0,w.winH/2,w.winLen,w.winH*0.05]] as [number,number,number,number][]).map(([fx,fy,fw,fh],k) => (
            <mesh key={k} position={[fx, fy, 0.01]}>
              <planeGeometry args={[fw, fh]} />
              <meshStandardMaterial color="#252525" roughness={0.5} metalness={0.4} />
            </mesh>
          ))}
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
      result.push({ floorIndex: fi, side, wallCoord: wc, mergedStart, mergedEnd, primaryRoom, doorEntries, winEntries });
    }
  }
  return result;
}

// ── 平屋顶 ────────────────────────────────────────────────────
function FlatRoof({ W, D, roofY }: { W: number; D: number; roofY: number }) {
  const OV = 0.45;    // 侧悬挑
  const OV_S = 0.85;  // 南侧悬挑（更大）
  return (
    <group>
      {/* 主屋面板 */}
      <mesh position={[0, roofY + 0.09, -(OV_S - OV) / 2]} castShadow receiveShadow>
        <boxGeometry args={[W + OV * 2, 0.18, D + OV_S + OV]} />
        <meshStandardMaterial color="#DEDAD4" roughness={0.85} metalness={0.03} />
      </mesh>
      {/* 南侧悬挑底面（木纹） */}
      <mesh position={[0, roofY, -D / 2 - OV_S / 2]}>
        <planeGeometry args={[W + OV * 2, OV_S]} />
        <meshStandardMaterial color="#8B6340" roughness={0.75} side={THREE.DoubleSide} />
      </mesh>
      {/* 女儿墙（四周压顶线） */}
      {[
        { pos: [0, roofY + 0.26, -D/2 - OV_S + 0.1]  as [number,number,number], args: [W + OV*2, 0.14, 0.10] as [number,number,number] },
        { pos: [0, roofY + 0.26,  D/2 + OV - 0.1]    as [number,number,number], args: [W + OV*2, 0.14, 0.10] as [number,number,number] },
        { pos: [-(W/2+OV-0.05), roofY+0.26, 0]        as [number,number,number], args: [0.10, 0.14, D+OV_S+OV] as [number,number,number] },
        { pos: [ (W/2+OV-0.05), roofY+0.26, 0]        as [number,number,number], args: [0.10, 0.14, D+OV_S+OV] as [number,number,number] },
      ].map(({ pos, args }, i) => (
        <mesh key={i} position={pos}>
          <boxGeometry args={args} />
          <meshStandardMaterial color="#C8C4BC" roughness={0.88} />
        </mesh>
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
export default function FloorPlanBuilding({ insideBuilding = false, wallXray = false }: { insideBuilding?: boolean; wallXray?: boolean }) {
  const floorPlans     = useDesignerStore(s => s.floorPlans);
  const exterior       = useDesignerStore(s => s.exterior);
  const floorCount     = Math.max(exterior.floors, 1);
  const setActiveRoom  = useDesignerStore(s => s.setActiveRoom);
  const setViewMode    = useDesignerStore(s => s.setViewMode);
  const setActiveFloor = useDesignerStore(s => s.setActiveFloor);

  /** Click door/window on exterior → enter that room's 3D interior view */
  const enterRoom = useCallback((room: RoomType, floorIndex: number) => {
    setActiveFloor(floorIndex);
    setActiveRoom(room);
    setViewMode("3d");
  }, [setActiveFloor, setActiveRoom, setViewMode]);

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
    // Sort walls by exterior-ness (smallest dist = most exterior)
    const ranked = (["back", "front", "left", "right"] as const)
      .map(w => ({ w, dist: d[w] ?? Infinity }))
      .sort((a, b) => a.dist - b.dist);

    // Pick most exterior wall that is NOT the door wall
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
      {/* 地面基座 */}
      <mesh position={[0, -0.04, 0]} receiveShadow>
        <boxGeometry args={[W + 0.40, 0.08, D + 0.40]} />
        <meshStandardMaterial color="#D0C8B4" roughness={0.90} />
      </mesh>

      {/* ── 1. 每层背景填充板（消除房间间微小缝隙，视觉统一） ── */}
      {Array.from({ length: usedFloors }, (_, fi) => {
        const fp = floorPlans[fi];
        if (!fp) return null;
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

      {/* ── 2. 实心房间盒子（和全局3D完全对应，覆盖在背景板上形成凹凸轮廓） ── */}
      {Array.from({ length: usedFloors }, (_, fi) => {
        const fp = floorPlans[fi];
        if (!fp) return null;
        const yBase = fi * (FLOOR_H + SLAB_T);
        return (fp.enabledRooms ?? [])
          .filter(r => !ROOM_DEFS[r]?.isOutdoor)
          .map(room => {
            const p = fp.roomLayout?.[room]; const d = fp.roomDimensions?.[room];
            if (!p || !d) return null;
            const rW = d.width * CM;
            const rD = d.depth * CM;
            const cx = (p.x + d.width / 2 - planOffset.minX) * CM - W / 2;
            const cz = -((p.y + d.depth / 2 - planOffset.minY) * CM) + D / 2;
            if (insideBuilding) return null; // hide when inside — avoids blocking raycasting
            return (
              <mesh key={`box-${fi}-${room}`} position={[cx, yBase + FLOOR_H / 2, cz]} castShadow receiveShadow>
                <boxGeometry args={[rW, FLOOR_H, rD]} />
                <meshStandardMaterial color={wallColor} roughness={0.82} metalness={0.01} />
              </mesh>
            );
          });
      })}

      {/* ── 3. 层间楼板（室内模式下隐藏）── */}
      {!insideBuilding && Array.from({ length: usedFloors - 1 }, (_, fi) => (
        <mesh key={`slab-${fi}`} position={[0, (fi + 1) * (FLOOR_H + SLAB_T) - SLAB_T / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[W + 0.30, SLAB_T, D + 0.30]} />
          <meshStandardMaterial color="#E0DCD4" roughness={0.85} />
        </mesh>
      ))}

      {/* ── 4. 外墙 facade overlay（基于合并块，无双框缝）── 室内模式下隐藏外墙 */}
      {!insideBuilding && facadeBlocks.map((block, bi) => {
        const { floorIndex, side, wallCoord, mergedStart, mergedEnd, doorEntries, winEntries } = block;
        const segLen  = (mergedEnd - mergedStart) * CM;
        const yBase   = floorIndex * (FLOOR_H + SLAB_T);
        const yMid    = yBase + FLOOR_H / 2;
        const isSouth = side === "south";
        // X轴翻转：south/east 的旋转使 local+X 方向反转
        const flipX   = side === "south" || side === "east";

        // Facade treatment — data-driven when possible:
        // If windows cover >55% of the wall segment, treat as glass curtain.
        // Otherwise use concrete+punched-windows.
        // West upper-floor gets wood cladding accent for the glass villa.
        const totalWinLen = winEntries.reduce((s, e) => s + e.w.len, 0);
        const winCoverage = segLen > 0 ? (totalWinLen * CM) / segLen : 0;
        const isGlassWall = winCoverage > 0.55 || (isGlassVilla && isSouth);
        const facade = isGlassVilla
          ? (isGlassWall ? "glass"
            : side === "west" && floorIndex > 0 ? "wood"
            : "concrete")
          : "concrete";

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
        if (facade === "glass") {
          return (
            <group key={`gl-${bi}`} position={[px, yMid, pz]} rotation={rot}>
              <GlassCurtain width={segLen} height={FLOOR_H} floorH={FLOOR_H} doors={doorInfos} />
              {/* Clickable door hit-zones on glass curtain */}
              {block.doorEntries.map((de, di) => {
                const rawX = (de.roomWallStart + (de.d.pos ?? 0) + de.d.len / 2 - mergedStart) * CM - segLen / 2;
                const cx   = flipX ? -rawX : rawX;
                const dH   = Math.min((de.d.h ?? 210) * CM, FLOOR_H - 0.05);
                return (
                  <mesh
                    key={`dh-${di}`}
                    position={[cx, -FLOOR_H / 2 + dH / 2, 0.18]}
                    onClick={(e) => { e.stopPropagation(); enterRoom(de.room, floorIndex); }}
                    onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; }}
                    onPointerOut={() => { document.body.style.cursor = "default"; }}
                  >
                    <boxGeometry args={[de.d.len * CM, dH, 0.01]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                  </mesh>
                );
              })}
              {/* Clicking anywhere on the glass curtain enters the primary room */}
              <mesh
                position={[0, 0, 0.20]}
                onClick={(e) => { e.stopPropagation(); enterRoom(block.primaryRoom, floorIndex); }}
                onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; setHoveredRoom({ room: block.primaryRoom, fi: floorIndex }); }}
                onPointerOut={() => { document.body.style.cursor = "default"; setHoveredRoom(null); }}
              >
                <planeGeometry args={[segLen, FLOOR_H]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
              {/* Tooltip */}
              {hoveredRoom?.room === block.primaryRoom && hoveredRoom?.fi === floorIndex && (
                <Html position={[0, FLOOR_H / 2 + 0.3, 0.25]} center style={{ pointerEvents: "none" }}>
                  <div style={{
                    background: "rgba(15,23,42,0.92)", color: "white", padding: "4px 10px",
                    borderRadius: 8, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                    border: "1px solid rgba(99,102,241,0.6)", backdropFilter: "blur(8px)",
                  }}>
                    点击进入 {ROOM_DEFS[block.primaryRoom]?.name ?? block.primaryRoom} →
                  </div>
                </Html>
              )}
            </group>
          );
        }

        // ── 木饰面（侧墙）──
        if (facade === "wood") {
          const planks = Math.max(4, Math.round(FLOOR_H / 0.15));
          const plankH = FLOOR_H / planks;
          return (
            <group key={`wd-${bi}`} position={[px, yMid, pz]} rotation={rot}>
              {Array.from({ length: planks }, (_, pi) => (
                <mesh key={pi} position={[0, -FLOOR_H / 2 + (pi + 0.5) * plankH, 0]}>
                  <boxGeometry args={[segLen, plankH * 0.88, 0.06]} />
                  <meshStandardMaterial color={pi % 2 === 0 ? "#8B6340" : "#7A5530"} roughness={0.78} />
                </mesh>
              ))}
            </group>
          );
        }

        // ── 混凝土（含横缝线 + 窗） ──
        return (
          <group key={`co-${bi}`} position={[px, yMid, pz]} rotation={rot}>
            <ConcreteFacade width={segLen} height={FLOOR_H} windows={winInfos} />
            {/* Clickable window hit-zones on concrete facade */}
            {block.winEntries.map((we, wi) => {
              const rawX  = (we.roomWallStart + (we.w.pos ?? 0) + we.w.len / 2 - mergedStart) * CM - segLen / 2;
              const lx    = flipX ? -rawX : rawX;
              const wH    = (we.w.h ?? 150) * CM;
              const sill  = (we.w.sill ?? 90) * CM;
              const winKey = `${bi}-${wi}`;
              const isHov = hoveredRoom?.room === we.room && hoveredRoom?.fi === floorIndex;
              return (
                <group key={`wh-${wi}`}>
                  <mesh
                    position={[lx, -FLOOR_H / 2 + sill + wH / 2, 0.12]}
                    onClick={(e) => { e.stopPropagation(); enterRoom(we.room, floorIndex); }}
                    onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = "pointer"; setHoveredRoom({ room: we.room, fi: floorIndex }); }}
                    onPointerOut={() => { document.body.style.cursor = "default"; setHoveredRoom(null); }}
                  >
                    <boxGeometry args={[we.w.len * CM, wH, 0.01]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                  </mesh>
                  {isHov && (
                    <Html position={[lx, -FLOOR_H / 2 + sill + wH + 0.2, 0.15]} center style={{ pointerEvents: "none" }}>
                      <div style={{
                        background: "rgba(15,23,42,0.92)", color: "white", padding: "4px 10px",
                        borderRadius: 8, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                        border: "1px solid rgba(99,102,241,0.6)", backdropFilter: "blur(8px)",
                      }}>
                        点击进入 {ROOM_DEFS[we.room]?.name ?? we.room} →
                      </div>
                    </Html>
                  )}
                </group>
              );
            })}
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
        const corrCol = "#C4BAA6";

        // 二楼及以上：走廊地板需绕开楼梯开口
        // 楼梯井贯穿所有楼层，开口位置应始终与一楼楼梯间对齐。
        // 优先：一楼（fi=0）的楼梯间（最权威，因为楼梯从这里起步）
        // 次优：本层或上一层楼梯间（用户手动在多层都放了楼梯间的情况）
        const stairEntry = fi > 0
          ? (interiorRooms.find(r => r.fi === 0 && r.isStair)
             ?? interiorRooms.find(r => r.fi === fi && r.isStair)
             ?? interiorRooms.find(r => r.fi === fi - 1 && r.isStair))
          : null;

        if (!stairEntry) {
          // 一楼或无楼梯间：整层铺满
          return (
            <mesh key={`corr-${fi}`} position={[wcx, corrY, wcz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow raycast={() => null}>
              <planeGeometry args={[lW + 0.1, lD + 0.1]} />
              <meshStandardMaterial color={corrCol} roughness={0.85} metalness={0.01} />
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
                <meshStandardMaterial color={corrCol} roughness={0.85} metalness={0.01} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* ── 6. 室内渲染（仅室内视角）── */}
      {insideBuilding && interiorRooms.map(({ room, fi, cx, cz, yBase, rW, rD, rWcm, rDcm, floorColor, wallColor, placedItems, doors, windows, isStair, isHallway, autoDoor, stairShape, stairRotation }) => {
        const wallOpacity = wallXray ? 0.13 : 1.0;
        const isXray = wallXray;
        // 走廊：无内墙、无天花板，仅地板；楼梯间：渲染楼梯几何体
        // 有配置门优先用配置门，否则用自动生成门
        const effectiveDoors = doors.length > 0 ? doors : autoDoor ? [autoDoor] : [];
        return (
          <group key={`int-${fi}-${room}`}>
            {/* 内墙面：BackSide box — 仅在室内侧可见，不会遮挡窗框/玻璃 */}
            {!isStair && !isHallway && (
              <mesh position={[cx, yBase + FLOOR_H / 2, cz]} raycast={() => null}>
                <boxGeometry args={[rW - 0.02, FLOOR_H - 0.01, rD - 0.02]} />
                <meshStandardMaterial color={wallColor} side={THREE.BackSide} roughness={0.80}
                  transparent={isXray} opacity={wallOpacity} depthWrite={!isXray}
                  emissive={wallColor} emissiveIntensity={0.06} />
              </mesh>
            )}
            {/* 地板：楼梯间上层（fi>0）不渲染地板，保持楼梯开口畅通 */}
            {!(isStair && fi > 0) && (
              <mesh position={[cx, yBase + 0.025, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow raycast={() => null}>
                <planeGeometry args={[rW - 0.04, rD - 0.04]} />
                <meshStandardMaterial color={floorColor} roughness={0.70} metalness={0.03} side={THREE.DoubleSide} />
              </mesh>
            )}
            {/* 天花板 — 走廊和楼梯间不渲染 */}
            {!isStair && !isHallway && (
              <mesh position={[cx, yBase + FLOOR_H - 0.025, cz]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
                <planeGeometry args={[rW - 0.04, rD - 0.04]} />
                <meshStandardMaterial color="#F8F6F2" roughness={0.90} side={THREE.BackSide}
                  transparent={isXray} opacity={isXray ? 0.08 : 1} depthWrite={!isXray} />
              </mesh>
            )}
            {/* 楼梯间：渲染实际楼梯几何体 + 上层开口处安全围栏 */}
            {isStair && (
              // fi>0 楼梯向下偏移 SLAB_T，使上下层楼梯无缝衔接（消除楼板厚度产生的空隙）
              <group position={[cx, yBase - (fi > 0 ? SLAB_T : 0), cz]}>
                {/* 上层楼梯旋转 180°：一层顶端对接二层底端，形成连续路径 */}
                <StaircaseGeom W={rW} D={rD} color={wallColor} shape={stairShape} stairRotation={((stairRotation + (fi > 0 ? 180 : 0)) % 360) as 0|90|180|270} />
                {/* 二楼及以上楼板开口处：钢化玻璃围栏，防止跌落 */}
                {fi > 0 && <StairwellRailing rW={rW} rD={rD} />}
              </group>
            )}
            {/* 门：有配置门用配置门，否则用自动门（向室内/走廊方向开） */}
            {!isStair && effectiveDoors.map((door, di) => {
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

            {/* 窗框：在有窗户的墙面渲染窗框（仅室内视角，嵌在墙面内侧） */}
            {!isStair && windows.map((win, wi) => {
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

            {/* 家具（帘子只在室内视角渲染，避免全局视图重叠） */}
            <group position={[cx, yBase, cz]}>
              {!isStair && placedItems
                .filter(p => {
                  if (!insideBuilding) {
                    // 外观视角：跳过帘子（帘子在全局视图会从多个房间叠在一起）
                    const fItem = getFurnitureById(p.furnitureId);
                    if (fItem?.category === "curtain") return false;
                  }
                  return true;
                })
                .map(p => {
                  const modP = { ...p, z: rDcm - p.z, rotation: (540 - p.rotation) % 360 };
                  return (
                    <Suspense key={p.instanceId} fallback={null}>
                      <PlacedItemMesh placed={modP} def={ROOM_DEFS[room]} roomW={rW} roomD={rD} room={room} />
                    </Suspense>
                  );
                })}
            </group>
          </group>
        );
      })}
    </group>
  );
}
