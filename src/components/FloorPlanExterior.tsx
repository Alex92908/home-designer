"use client";

/**
 * FloorPlanExterior — 从平面图自动提取外墙并渲染外立面
 *
 * 核心思路：
 *   对每个房间的每条边，检查是否有相邻房间紧贴。
 *   无相邻房间的边 = 外墙，按方向和立面设置渲染材质。
 *
 * 坐标系映射（与 HouseCanvas/RichGlassVillaBuilding 一致）：
 *   平面图 x  →  Three.js X  （不翻转）
 *   平面图 y  →  Three.js -Z （翻转，y 增大=向南 → Three.js -Z 方向）
 *   楼层高度  →  Three.js Y
 *
 * 朝向：
 *   South face（平面图下边，大 y）= Three.js -Z = 建筑正面（面向观者）
 *   North face（平面图上边，小 y）= Three.js +Z = 背面
 *   East  face（平面图右边，大 x）= Three.js +X = 东侧
 *   West  face（平面图左边，小 x）= Three.js -X = 西侧
 */

import { useMemo } from "react";
import * as THREE from "three";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, RoomType, WindowConfig } from "@/lib/types";

// ── 常量 ──────────────────────────────────────────────────────
const CM       = 0.01;   // cm → m
const FLOOR_H  = 3.00;   // 每层净高 m
const SLAB_T   = 0.20;   // 层间楼板厚 m
const STEP_H   = FLOOR_H + SLAB_T;  // 楼层间距（含楼板）
const WT       = 0.20;   // 墙厚 m
const TOLE     = 8;      // 相邻判定容差 cm

// ── 外墙段数据结构 ─────────────────────────────────────────────
export type WallSide = "south" | "north" | "east" | "west";

export interface ExteriorWallSeg {
  floorIndex: number;
  room:       RoomType;
  side:       WallSide;
  // 平面图坐标（cm）
  roomX: number; roomY: number; roomW: number; roomD: number;
  segStart: number;  // 沿墙起点（cm，对应 X 或 Y 轴）
  segEnd:   number;  // 沿墙终点
  // 该段上的窗（来自 roomWindows，已匹配 wall 方向）
  windows: WindowConfig[];
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

// 平面图 wall 名 → WindowConfig.wall 映射
function sideToWinWall(side: WallSide): WindowConfig["wall"] {
  return { south: "front", north: "back", east: "right", west: "left" }[side] as WindowConfig["wall"];
}

// ── 核心算法：提取所有外墙段 ──────────────────────────────────
export function computeExteriorWalls(
  enabledRooms: RoomType[],
  layout:       Record<string, { x: number; y: number }>,
  dims:         Record<string, { width: number; depth: number }>,
  winMap:       Record<string, WindowConfig[]>,
  floorIndex:   number,
): ExteriorWallSeg[] {
  const rooms = enabledRooms.filter(r => !ROOM_DEFS[r]?.isOutdoor);
  const result: ExteriorWallSeg[] = [];

  for (const room of rooms) {
    const p = layout[room]; const d = dims[room];
    if (!p || !d) continue;
    const { x: rx, y: ry } = p;
    const { width: rw, depth: rd } = d;

    type SideDef = {
      side:      WallSide;
      wallCoord: number;   // 固定轴坐标
      axis:      "x" | "y";
      wallStart: number;
      wallEnd:   number;
    };

    const sides: SideDef[] = [
      { side: "south", wallCoord: ry + rd, axis: "x", wallStart: rx,      wallEnd: rx + rw },
      { side: "north", wallCoord: ry,      axis: "x", wallStart: rx,      wallEnd: rx + rw },
      { side: "east",  wallCoord: rx + rw, axis: "y", wallStart: ry,      wallEnd: ry + rd },
      { side: "west",  wallCoord: rx,      axis: "y", wallStart: ry,      wallEnd: ry + rd },
    ];

    for (const { side, wallCoord, axis, wallStart, wallEnd } of sides) {
      // 找所有覆盖此墙的相邻房间区间
      const covered: [number, number][] = [];

      for (const other of rooms) {
        if (other === room) continue;
        const op = layout[other]; const od = dims[other];
        if (!op || !od) continue;

        let adjCoord: number;
        let oStart: number;
        let oEnd: number;

        if (axis === "x") {
          adjCoord = side === "south" ? op.y : op.y + od.depth;
          oStart   = op.x;
          oEnd     = op.x + od.width;
        } else {
          adjCoord = side === "east" ? op.x : op.x + od.width;
          oStart   = op.y;
          oEnd     = op.y + od.depth;
        }

        if (Math.abs(adjCoord - wallCoord) > TOLE) continue;

        const overS = Math.max(wallStart, oStart);
        const overE = Math.min(wallEnd,   oEnd);
        if (overE - overS > TOLE) covered.push([overS, overE]);
      }

      // 计算未被覆盖（外墙）区间
      const exterior = subtractIntervals([[wallStart, wallEnd]], covered);

      // 获取该房间该墙面的窗
      const winWall  = sideToWinWall(side);
      const roomWins = (winMap[room] ?? []).filter(w => w.wall === winWall);

      for (const [segStart, segEnd] of exterior) {
        if (segEnd - segStart < 20) continue; // 忽略太小的碎片

        // 过滤落在此段内的窗
        const segWins = roomWins.filter(w => {
          const wS = wallStart + (w.pos ?? 0);
          const wE = wS + w.len;
          return wE > segStart && wS < segEnd;
        });

        result.push({ floorIndex, room, side, roomX: rx, roomY: ry, roomW: rw, roomD: rd, segStart, segEnd, windows: segWins });
      }
    }
  }

  return result;
}

// ── 坐标换算（平面图 cm → Three.js m，以包围盒中心为原点）────
interface PlanOffset { minX: number; minY: number; W: number; D: number }

function planToWorld(fpX: number, fpY: number, o: PlanOffset): [number, number] {
  return [
    (fpX - o.minX) * CM - o.W / 2,   // Three.js X
    -(fpY - o.minY) * CM + o.D / 2,  // Three.js Z（Y 轴翻转）
  ];
}

// ── 玻璃幕墙立面 ──────────────────────────────────────────────
function GlassFace({ width, height, mullions = 5 }: { width: number; height: number; mullions?: number }) {
  const panelW = width / mullions;
  // 中横框数量 — 随楼层高度自适应（约每 1m 一根）
  const midRails = Math.max(1, Math.round(height / 1.0) - 1);
  return (
    <group>
      {/* 室内暖光背景（透过玻璃可见） */}
      <mesh position={[0, 0, -0.08]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#F5E8D0" emissive="#EFD8A8" emissiveIntensity={0.35} side={THREE.DoubleSide} />
      </mesh>
      {/* 玻璃面板 — 分格，每格一块 */}
      {Array.from({ length: mullions }, (_, i) => {
        const px = -width / 2 + (i + 0.5) * panelW;
        return (
          <mesh key={i} position={[px, 0, 0]}>
            <planeGeometry args={[panelW * 0.96, height * 0.96]} />
            <meshPhysicalMaterial
              color="#AACCDD"
              metalness={0.0}
              roughness={0.02}
              transmission={0.65}
              thickness={0.5}
              ior={1.45}
              transparent
              opacity={0.50}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
      {/* 竖向钢竖框 */}
      {Array.from({ length: mullions + 1 }, (_, i) => {
        const px = -width / 2 + i * panelW;
        return (
          <mesh key={i} position={[px, 0, 0.02]}>
            <boxGeometry args={[0.05, height + 0.04, 0.06]} />
            <meshStandardMaterial color="#1C1C1C" metalness={0.85} roughness={0.20} />
          </mesh>
        );
      })}
      {/* 顶横框 + 底横框 */}
      {[-height / 2 + 0.025, height / 2 - 0.025].map((py, i) => (
        <mesh key={i} position={[0, py, 0.02]}>
          <boxGeometry args={[width + 0.04, 0.05, 0.06]} />
          <meshStandardMaterial color="#1C1C1C" metalness={0.85} roughness={0.20} />
        </mesh>
      ))}
      {/* 中横框（等分） */}
      {Array.from({ length: midRails }, (_, i) => {
        const py = -height / 2 + ((i + 1) / (midRails + 1)) * height;
        return (
          <mesh key={i} position={[0, py, 0.02]}>
            <boxGeometry args={[width + 0.04, 0.04, 0.05]} />
            <meshStandardMaterial color="#222" metalness={0.85} roughness={0.20} />
          </mesh>
        );
      })}
    </group>
  );
}

// ── 混凝土墙面（带冲孔窗） ─────────────────────────────────────
function ConcreteFace({
  width, height, wallColor = "#EEEAE2",
  windows = [],
  wallStart = 0,
}: {
  width: number; height: number; wallColor?: string;
  windows?: WindowConfig[]; wallStart?: number;
}) {
  return (
    <group>
      {/* 墙体基底 */}
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={wallColor} roughness={0.82} metalness={0.0} side={THREE.DoubleSide} />
      </mesh>
      {/* 穿孔窗 */}
      {windows.map((win) => {
        const winL    = win.len / 100;
        const winH_m  = (win.h ?? 150) / 100;
        const winSill = (win.sill ?? 90) / 100;
        const localPos = ((win.pos ?? 0) - wallStart) / 100;
        const wx = -width / 2 + localPos + winL / 2;
        const wy = -height / 2 + winSill + winH_m / 2;
        return (
          <group key={win.id} position={[wx, wy, 0.02]}>
            {/* 室内暖光背底 */}
            <mesh position={[0, 0, -0.06]}>
              <planeGeometry args={[winL, winH_m]} />
              <meshStandardMaterial color="#EED8A8" emissive="#E8C888" emissiveIntensity={0.25} />
            </mesh>
            {/* 玻璃 */}
            <mesh>
              <planeGeometry args={[winL, winH_m]} />
              <meshPhysicalMaterial
                color="#AACCDD"
                transmission={0.68}
                roughness={0.04}
                transparent opacity={0.52}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* 铝合金窗框（四边） */}
            {([
              [-winL / 2,    0,          winL * 0.04, winH_m],
              [ winL / 2,    0,          winL * 0.04, winH_m],
              [0,           -winH_m / 2, winL,        winH_m * 0.04],
              [0,            winH_m / 2, winL,        winH_m * 0.04],
            ] as [number,number,number,number][]).map(([fx, fy, fw, fh], i) => (
              <mesh key={i} position={[fx, fy, 0.01]}>
                <planeGeometry args={[fw, fh]} />
                <meshStandardMaterial color="#383838" roughness={0.45} metalness={0.4} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

// ── 单段外墙渲染 ──────────────────────────────────────────────
function WallSegment({
  seg, offset, floorHeight, wallColor, facadeType,
}: {
  seg:          ExteriorWallSeg;
  offset:       PlanOffset;
  floorHeight:  number;
  wallColor:    string;
  facadeType:   "glass" | "concrete" | "wood";
}) {
  const segLen = (seg.segEnd - seg.segStart) * CM;  // m
  const yBase  = seg.floorIndex * (floorHeight + SLAB_T);
  const yMid   = yBase + floorHeight / 2;

  // 计算墙中心 Three.js 坐标
  const pos = useMemo<[number, number, number]>(() => {
    switch (seg.side) {
      case "south": {
        const [wx] = planToWorld(
          seg.segStart + (seg.segEnd - seg.segStart) / 2,
          seg.roomY + seg.roomD,
          offset,
        );
        const [, wz] = planToWorld(seg.roomX, seg.roomY + seg.roomD, offset);
        return [wx, yMid, wz - WT / 2];
      }
      case "north": {
        const [wx] = planToWorld(
          seg.segStart + (seg.segEnd - seg.segStart) / 2,
          seg.roomY,
          offset,
        );
        const [, wz] = planToWorld(seg.roomX, seg.roomY, offset);
        return [wx, yMid, wz + WT / 2];
      }
      case "east": {
        const [wx] = planToWorld(seg.roomX + seg.roomW, seg.roomY, offset);
        const [, wz] = planToWorld(
          seg.roomX + seg.roomW,
          seg.segStart + (seg.segEnd - seg.segStart) / 2,
          offset,
        );
        return [wx + WT / 2, yMid, wz];
      }
      case "west": {
        const [wx] = planToWorld(seg.roomX, seg.roomY, offset);
        const [, wz] = planToWorld(
          seg.roomX,
          seg.segStart + (seg.segEnd - seg.segStart) / 2,
          offset,
        );
        return [wx - WT / 2, yMid, wz];
      }
    }
  }, [seg, offset, yMid]);

  const rot = useMemo<[number, number, number]>(() => {
    switch (seg.side) {
      case "south": return [0, Math.PI, 0];   // normal = -Z
      case "north": return [0, 0, 0];          // normal = +Z
      case "east":  return [0, -Math.PI / 2, 0];
      case "west":  return [0,  Math.PI / 2, 0];
    }
  }, [seg.side]);

  const mullions = Math.max(3, Math.round(segLen / 1.5));

  return (
    <group position={pos} rotation={rot}>
      {facadeType === "glass" ? (
        <GlassFace width={segLen} height={floorHeight} mullions={mullions} />
      ) : facadeType === "wood" ? (
        <WoodFace width={segLen} height={floorHeight} />
      ) : (
        <ConcreteFace
          width={segLen} height={floorHeight}
          wallColor={wallColor}
          windows={seg.windows}
          wallStart={seg.segStart}
        />
      )}
    </group>
  );
}

// ── 木饰面（侧墙） ─────────────────────────────────────────────
function WoodFace({ width, height }: { width: number; height: number }) {
  const planks = Math.round(height / 0.18);
  const plankH = height / planks;
  return (
    <group>
      {Array.from({ length: planks }, (_, i) => (
        <mesh key={i} position={[0, -height / 2 + (i + 0.5) * plankH, 0]}>
          <planeGeometry args={[width, plankH * 0.88]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? "#7A5530" : "#6B4828"}
            roughness={0.78} metalness={0}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

// ── 平屋顶 ────────────────────────────────────────────────────
function FlatRoof({
  W, D, floorCount,
}: {
  W: number; D: number; floorCount: number; offset: PlanOffset;
}) {
  const roofY = floorCount * (FLOOR_H + SLAB_T) + 0.04;
  const OV    = 0.35;   // 标准侧悬挑 35cm
  const OV_S  = 0.70;   // 南侧悬挑 70cm（适度，不夸张）
  return (
    <group>
      {/* 主屋面板（偏南，使南悬挑更大） */}
      <mesh position={[0, roofY, -(OV_S - OV) / 2]} castShadow receiveShadow>
        <boxGeometry args={[W + OV * 2, 0.18, D + OV_S + OV]} />
        <meshStandardMaterial color="#DEDAD4" roughness={0.85} metalness={0.05} />
      </mesh>
      {/* 南侧悬挑底面（木纹饰面） */}
      <mesh position={[0, roofY - 0.09, -D / 2 - OV_S / 2 + 0.02]}>
        <planeGeometry args={[W + OV * 2, OV_S]} />
        <meshStandardMaterial color="#8B6340" roughness={0.75} side={THREE.DoubleSide} />
      </mesh>
      {/* 女儿墙压顶（四周薄条） */}
      {[
        { pos: [0, roofY + 0.15, -D / 2 - OV_S + 0.09] as [number,number,number], args: [W + OV * 2, 0.12, 0.08] as [number,number,number] },
        { pos: [0, roofY + 0.15,  D / 2 + OV - 0.09]   as [number,number,number], args: [W + OV * 2, 0.12, 0.08] as [number,number,number] },
        { pos: [-(W / 2 + OV - 0.04), roofY + 0.15, 0] as [number,number,number], args: [0.08, 0.12, D + OV_S + OV] as [number,number,number] },
        { pos: [ (W / 2 + OV - 0.04), roofY + 0.15, 0] as [number,number,number], args: [0.08, 0.12, D + OV_S + OV] as [number,number,number] },
      ].map(({ pos, args }, i) => (
        <mesh key={i} position={pos}>
          <boxGeometry args={args} />
          <meshStandardMaterial color="#D0CCC4" roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

// ── 层间楼板条带 ──────────────────────────────────────────────
function SlabBand({ W, D, y }: { W: number; D: number; y: number }) {
  return (
    <mesh position={[0, y + SLAB_T / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[W + 0.10, SLAB_T, D + 0.10]} />
      <meshStandardMaterial color="#F0EDE6" roughness={0.82} />
    </mesh>
  );
}

// ── 主组件：FloorPlanBuilding ─────────────────────────────────
/**
 * 从平面图数据自动生成外立面。
 * 放在 HouseCanvas 的 Canvas 内，替代 HouseBody。
 */
export default function FloorPlanBuilding() {
  const floorPlans    = useDesignerStore(s => s.floorPlans);
  const exterior      = useDesignerStore(s => s.exterior);
  const floorCount    = Math.max(exterior.floors, 1);

  // 计算全局包围盒（取所有楼层房间的并集）
  const planOffset = useMemo<PlanOffset>(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let fi = 0; fi < floorCount; fi++) {
      const fp = floorPlans[fi];
      if (!fp) continue;
      const rooms = (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor);
      for (const r of rooms) {
        const p = fp.roomLayout?.[r]; const d = fp.roomDimensions?.[r];
        if (!p || !d) continue;
        minX = Math.min(minX, p.x);          minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + d.width); maxY = Math.max(maxY, p.y + d.depth);
      }
    }
    if (!isFinite(minX)) return { minX: 0, minY: 0, W: 10, D: 8 };
    return { minX, minY, W: (maxX - minX) * CM, D: (maxY - minY) * CM };
  }, [floorPlans, floorCount]);

  const { W, D } = planOffset;

  // 立面类型判断
  const buildingType = (exterior as any).buildingType ?? "";
  // floor-plan-driven 和 rich-glass-villa 都使用玻璃幕墙逻辑
  const isGlassVilla = buildingType === "rich-glass-villa" || buildingType === "floor-plan-driven";

  // 墙色
  const wallColor = exterior.wallColor ?? "#EEEAE2";

  // 计算所有楼层的外墙段
  const allSegs = useMemo<ExteriorWallSeg[]>(() => {
    const result: ExteriorWallSeg[] = [];
    for (let fi = 0; fi < floorCount; fi++) {
      const fp = floorPlans[fi];
      if (!fp) continue;
      const rooms = (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor) as RoomType[];
      const segs = computeExteriorWalls(
        rooms,
        fp.roomLayout ?? {},
        fp.roomDimensions ?? {},
        fp.roomWindows ?? {},
        fi,
      );
      result.push(...segs);
    }
    return result;
  }, [floorPlans, floorCount]);

  // 确定每段立面类型
  function facadeFor(seg: ExteriorWallSeg): "glass" | "concrete" | "wood" {
    if (isGlassVilla) {
      if (seg.side === "south") return "glass";
      if (seg.side === "west" && seg.floorIndex > 0) return "wood";
    }
    return "concrete";
  }

  return (
    <group>
      {/* 地面基座 */}
      <mesh position={[0, 0.04, 0]} receiveShadow>
        <boxGeometry args={[W + 0.20, 0.08, D + 0.20]} />
        <meshStandardMaterial color="#E0D8C8" roughness={0.88} />
      </mesh>

      {/* 外墙段 */}
      {allSegs.map((seg, i) => (
        <WallSegment
          key={i}
          seg={seg}
          offset={planOffset}
          floorHeight={FLOOR_H}
          wallColor={wallColor}
          facadeType={facadeFor(seg)}
        />
      ))}

      {/* 层间楼板（从第1层起） */}
      {Array.from({ length: floorCount - 1 }, (_, fi) => (
        <SlabBand key={fi} W={W} D={D} y={(fi + 1) * (FLOOR_H + SLAB_T) - SLAB_T} />
      ))}

      {/* 平屋顶 */}
      <FlatRoof W={W} D={D} floorCount={floorCount} offset={planOffset} />
    </group>
  );
}
