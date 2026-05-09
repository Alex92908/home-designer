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
import { ROOM_DEFS, RoomType, WindowConfig, DoorConfig } from "@/lib/types";

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
  // 该段上的门
  doors: DoorConfig[];
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
  doorMap?:     Record<string, DoorConfig[]>,
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
      // 门（legacy single-door 或 multi-door）
      const allDoors  = doorMap?.[room] ?? [];
      const roomDoors = allDoors.filter(d => d.wall === winWall);

      for (const [segStart, segEnd] of exterior) {
        if (segEnd - segStart < 20) continue; // 忽略太小的碎片

        // 过滤落在此段内的窗
        const segWins = roomWins.filter(w => {
          const wS = wallStart + (w.pos ?? 0);
          const wE = wS + w.len;
          return wE > segStart && wS < segEnd;
        });

        // 过滤落在此段内的门（门必须完全在 segStart..segEnd 内才渲染）
        const segDoors = roomDoors.filter(d => {
          const dS = wallStart + (d.pos ?? 0);
          const dE = dS + d.len;
          // 门要在段内有重叠，且宽度合理
          return dE > segStart + 5 && dS < segEnd - 5 && d.len >= 60;
        });

        result.push({ floorIndex, room, side, roomX: rx, roomY: ry, roomW: rw, roomD: rd, segStart, segEnd, windows: segWins, doors: segDoors });
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
function GlassFace({
  width, height, mullions = 5, doors = [],
}: {
  width: number; height: number; mullions?: number;
  doors?: Array<{ cx: number; w: number; h: number }>;
}) {
  const panelW   = width / mullions;
  const midRails = Math.max(1, Math.round(height / 1.0) - 1);
  const FRAME_D  = 0.08;   // 钢框深度

  return (
    <group>
      {/* 室内背景 — 中性暖白，极低 emissive，避免黄绿感 */}
      <mesh position={[0, 0, FRAME_D + 0.02]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          color="#F0EBE3" emissive="#FFFFFF" emissiveIntensity={0.06}
          side={THREE.FrontSide} depthWrite={false}
        />
      </mesh>

      {/* 玻璃面板 */}
      {Array.from({ length: mullions }, (_, i) => {
        const px     = -width / 2 + (i + 0.5) * panelW;
        const pLeft  = -width / 2 + i * panelW;
        const pRight = pLeft + panelW;
        const door   = doors.find(d => d.cx - d.w / 2 < pRight && d.cx + d.w / 2 > pLeft);
        if (door) {
          const transomH = height - door.h;
          return transomH > 0.15 ? (
            <mesh key={i} position={[px, -height / 2 + door.h + transomH / 2, 0]}>
              <planeGeometry args={[panelW * 0.94, transomH * 0.90]} />
              <meshPhysicalMaterial color="#C8DCE8" transmission={0.7} roughness={0.05} transparent opacity={0.55} side={THREE.DoubleSide} />
            </mesh>
          ) : null;
        }
        return (
          <mesh key={i} position={[px, 0, 0]}>
            <planeGeometry args={[panelW * 0.94, height * 0.97]} />
            <meshPhysicalMaterial
              color="#C0D8E8"
              roughness={0.05} metalness={0.05}
              transmission={0.60} thickness={0.4} ior={1.5}
              transparent opacity={0.55}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}

      {/* 竖向钢竖框 */}
      {Array.from({ length: mullions + 1 }, (_, i) => (
        <mesh key={i} position={[-width / 2 + i * panelW, 0, 0]}>
          <boxGeometry args={[0.06, height + 0.02, FRAME_D]} />
          <meshStandardMaterial color="#1A1A1A" metalness={0.88} roughness={0.18} />
        </mesh>
      ))}
      {/* 顶 + 底横框 */}
      {[-height / 2, height / 2].map((py, i) => (
        <mesh key={i} position={[0, py, 0]}>
          <boxGeometry args={[width + 0.04, 0.06, FRAME_D]} />
          <meshStandardMaterial color="#1A1A1A" metalness={0.88} roughness={0.18} />
        </mesh>
      ))}
      {/* 中横框 */}
      {Array.from({ length: midRails }, (_, i) => {
        const py = -height / 2 + ((i + 1) / (midRails + 1)) * height;
        return (
          <mesh key={i} position={[0, py, 0]}>
            <boxGeometry args={[width + 0.04, 0.045, FRAME_D * 0.8]} />
            <meshStandardMaterial color="#1A1A1A" metalness={0.88} roughness={0.18} />
          </mesh>
        );
      })}

      {/* 推拉玻璃门 */}
      {doors.map((door, di) => (
        <group key={`door-${di}`} position={[door.cx, -height / 2 + door.h / 2, 0]}>
          {[-door.w / 4, door.w / 4].map((ox, si) => (
            <mesh key={si} position={[ox, 0, 0]}>
              <planeGeometry args={[door.w / 2 - 0.05, door.h - 0.08]} />
              <meshPhysicalMaterial color="#A8C8D8" transmission={0.68} roughness={0.03} transparent opacity={0.48} side={THREE.DoubleSide} />
            </mesh>
          ))}
          {/* 门框 */}
          {[
            [0, door.h / 2, door.w + 0.04, 0.06, FRAME_D] as const,
            [0, -door.h / 2, door.w + 0.04, 0.06, FRAME_D] as const,
            [-door.w / 2, 0, 0.06, door.h, FRAME_D] as const,
            [0, 0, 0.06, door.h, FRAME_D] as const,
            [door.w / 2, 0, 0.06, door.h, FRAME_D] as const,
          ].map(([bx, by, bw, bh, bd], bi) => (
            <mesh key={bi} position={[bx, by, 0]}>
              <boxGeometry args={[bw, bh, bd]} />
              <meshStandardMaterial color="#111" metalness={0.92} roughness={0.12} />
            </mesh>
          ))}
          {/* 拉手 */}
          {[-door.w / 4 + 0.10, door.w / 4 - 0.10].map((hx, hi) => (
            <mesh key={hi} position={[hx, 0, -0.04]}>
              <boxGeometry args={[0.02, 0.16, 0.02]} />
              <meshStandardMaterial color="#AAA" metalness={0.95} roughness={0.08} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ── 混凝土实心墙（有厚度，带窗） ────────────────────────────────
function ConcreteFace({
  width, height, wallColor = "#EEEAE2",
  windows = [], wallStart = 0,
}: {
  width: number; height: number; wallColor?: string;
  windows?: WindowConfig[]; wallStart?: number;
}) {
  return (
    <group>
      {/* 实心墙体 — BoxGeometry 给墙壁厚度感和阴影 */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, WT]} />
        <meshStandardMaterial color={wallColor} roughness={0.80} metalness={0.02} />
      </mesh>
      {/* 窗洞（覆叠在墙面） */}
      {windows.map((win) => {
        const winL    = win.len / 100;
        const winH_m  = (win.h ?? 150) / 100;
        const winSill = (win.sill ?? 90) / 100;
        const localPos = ((win.pos ?? 0) - wallStart) / 100;
        const wx = -width / 2 + localPos + winL / 2;
        const wy = -height / 2 + winSill + winH_m / 2;
        return (
          <group key={win.id} position={[wx, wy, -WT / 2]}>
            {/* 窗台和窗套（深色边框） */}
            <mesh position={[0, 0, WT / 2 + 0.01]}>
              <boxGeometry args={[winL + 0.08, winH_m + 0.08, 0.05]} />
              <meshStandardMaterial color="#D0CAC0" roughness={0.78} />
            </mesh>
            {/* 室内背景 */}
            <mesh position={[0, 0, 0.04]}>
              <planeGeometry args={[winL - 0.04, winH_m - 0.04]} />
              <meshStandardMaterial color="#EAE6E0" emissive="#FFFFFF" emissiveIntensity={0.08} side={THREE.FrontSide} />
            </mesh>
            {/* 玻璃 */}
            <mesh position={[0, 0, WT / 2]}>
              <planeGeometry args={[winL, winH_m]} />
              <meshPhysicalMaterial color="#B8D0E0" transmission={0.65} roughness={0.05} transparent opacity={0.50} side={THREE.DoubleSide} />
            </mesh>
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

  // 将门的平面图坐标（相对于 wallStart）转换为 Three.js 局部 X。
  // d.pos 是从 wallStart 起的偏移：南/北墙 wallStart = roomX，东/西墙 wallStart = roomY
  const wallStartForDoor = (seg.side === "south" || seg.side === "north") ? seg.roomX : seg.roomY;
  const doorInfos = useMemo(() => seg.doors.map(d => {
    const dPos = d.pos ?? 0;
    const dLen = d.len;
    const dH   = (d.h ?? 210) * CM;
    // 门中心在 worldX 轴上的位置 = wallStart + dPos + dLen/2
    // 相对于 segment 中心的局部 X：
    const rawX  = (wallStartForDoor + dPos + dLen / 2 - seg.segStart) * CM - segLen / 2;
    const dLenM = dLen * CM;
    // 夹住，不允许超出墙段范围
    const localX = Math.max(-segLen / 2 + dLenM / 2, Math.min(segLen / 2 - dLenM / 2, rawX));
    return { cx: localX, w: dLenM, h: Math.min(dH, floorHeight - 0.05) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [seg.doors, seg.segStart, segLen, wallStartForDoor, floorHeight]);

  return (
    <group position={pos} rotation={rot}>
      {facadeType === "glass" ? (
        <GlassFace width={segLen} height={floorHeight} mullions={mullions} doors={doorInfos} />
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
// 实心箱体 + 横向拼缝纹理（通过 emissive 带变化，避免 z 方向判断问题）
function WoodFace({ width, height }: { width: number; height: number }) {
  const planks = Math.round(height / 0.15);
  const plankH = height / planks;
  return (
    <group>
      {Array.from({ length: planks }, (_, i) => (
        <mesh key={i} position={[0, -height / 2 + (i + 0.5) * plankH, 0]} castShadow receiveShadow>
          <boxGeometry args={[width, plankH * 0.90, WT]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? "#8B6340" : "#7A5530"}
            roughness={0.78} metalness={0.0}
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
      <boxGeometry args={[W + WT * 2, SLAB_T, D + WT * 2]} />
      <meshStandardMaterial color="#E8E4DC" roughness={0.85} metalness={0.02} />
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
    // wall 名映射：平面图 bottom/top/left/right → DoorConfig wall 名
    const legacyWallMap: Record<string, DoorConfig["wall"]> = {
      bottom: "front", top: "back", left: "left", right: "right",
    };

    const result: ExteriorWallSeg[] = [];
    for (let fi = 0; fi < floorCount; fi++) {
      const fp = floorPlans[fi];
      if (!fp) continue;
      const rooms = (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor) as RoomType[];

      // 合并新版 roomDoors + 旧版 roomDoorWall/Pos/Len
      const mergedDoors: Record<string, DoorConfig[]> = {};
      for (const r of rooms) {
        const newDoors = fp.roomDoors?.[r as RoomType] ?? [];
        if (newDoors.length > 0) {
          mergedDoors[r] = newDoors;
        } else if (fp.roomHasDoor?.[r as RoomType] && fp.roomDoorWall?.[r as RoomType]) {
          const legWall = fp.roomDoorWall[r as RoomType];
          mergedDoors[r] = [{
            id:   `legacy-${r}`,
            wall: legacyWallMap[legWall] ?? "front",
            pos:  fp.roomDoorPos?.[r as RoomType] ?? 40,
            len:  fp.roomDoorLen?.[r as RoomType] ?? 90,
            h:    fp.roomDoorH?.[r as RoomType] ?? 210,
          }];
        }
      }

      const segs = computeExteriorWalls(
        rooms,
        fp.roomLayout ?? {},
        fp.roomDimensions ?? {},
        fp.roomWindows ?? {},
        fi,
        mergedDoors,
      );
      result.push(...segs);
    }
    return result;
  }, [floorPlans, floorCount]);

  // 实际有墙段的最高楼层 + 1 = 真实楼层数（用于屋顶和楼板定位）
  // 避免 exterior.floors=2 但 floorPlans[1] 没有房间时屋顶飞到天上
  const usedFloors = allSegs.length > 0
    ? Math.max(...allSegs.map(s => s.floorIndex)) + 1
    : 1;

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
      <mesh position={[0, -0.04, 0]} receiveShadow>
        <boxGeometry args={[W + 0.30, 0.08, D + 0.30]} />
        <meshStandardMaterial color="#D8D0BC" roughness={0.88} />
      </mesh>

      {/* 외墙段 */}
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

      {/* 层间楼板（从第1层起，用 usedFloors 不用 floorCount） */}
      {Array.from({ length: usedFloors - 1 }, (_, fi) => (
        <SlabBand key={fi} W={W} D={D} y={(fi + 1) * (FLOOR_H + SLAB_T) - SLAB_T} />
      ))}

      {/* 平屋顶 — 用 usedFloors 定位，不会飞天 */}
      <FlatRoof W={W} D={D} floorCount={usedFloors} offset={planOffset} />
    </group>
  );
}
