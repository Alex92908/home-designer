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

import { useMemo } from "react";
import * as THREE from "three";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, RoomType, WindowConfig, DoorConfig } from "@/lib/types";

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
  return { south: "front", north: "back", east: "right", west: "left" }[side] as WindowConfig["wall"];
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

// ── 窗洞（混凝土墙上） ─────────────────────────────────────────
function WallWindow({ win, wallStart, segStart }: { win: WindowConfig; wallStart: number; segStart: number }) {
  const winL    = win.len * CM;
  const winH    = (win.h ?? 150) * CM;
  const winSill = (win.sill ?? 90) * CM;
  const localX  = (wallStart + (win.pos ?? 0) - segStart) * CM + winL / 2;
  const localY  = -FLOOR_H / 2 + winSill + winH / 2;
  return (
    <group position={[localX, localY, 0.01]}>
      <mesh>
        <planeGeometry args={[winL, winH]} />
        <meshPhysicalMaterial color="#B0CCE0" transmission={0.65} roughness={0.04} transparent opacity={0.50} side={THREE.DoubleSide} />
      </mesh>
      {/* 窗框 */}
      {([[-winL/2,0,winL*0.04,winH],[winL/2,0,winL*0.04,winH],[0,-winH/2,winL,winH*0.04],[0,winH/2,winL,winH*0.04]] as [number,number,number,number][]).map(([fx,fy,fw,fh],i) => (
        <mesh key={i} position={[fx, fy, 0.01]}>
          <planeGeometry args={[fw, fh]} />
          <meshStandardMaterial color="#2A2A2A" roughness={0.5} metalness={0.4} />
        </mesh>
      ))}
    </group>
  );
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

// ── 主组件 ────────────────────────────────────────────────────
export default function FloorPlanBuilding() {
  const floorPlans = useDesignerStore(s => s.floorPlans);
  const exterior   = useDesignerStore(s => s.exterior);
  const floorCount = Math.max(exterior.floors, 1);

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

  // 外墙段检测（用于覆盖材质）
  const allSegs = useMemo<ExteriorWallSeg[]>(() => {
    const legacyWallMap: Record<string, DoorConfig["wall"]> = {
      bottom: "front", top: "back", left: "left", right: "right",
    };
    const result: ExteriorWallSeg[] = [];
    for (let fi = 0; fi < floorCount; fi++) {
      const fp = floorPlans[fi];
      if (!fp) continue;
      const rooms = (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor) as RoomType[];
      const mergedDoors: Record<string, DoorConfig[]> = {};
      for (const r of rooms) {
        const newDoors = fp.roomDoors?.[r] ?? [];
        if (newDoors.length > 0) {
          mergedDoors[r] = newDoors;
        } else if (fp.roomHasDoor?.[r] && fp.roomDoorWall?.[r]) {
          mergedDoors[r] = [{
            id: `legacy-${r}`, wall: legacyWallMap[fp.roomDoorWall[r]] ?? "front",
            pos: fp.roomDoorPos?.[r] ?? 40, len: fp.roomDoorLen?.[r] ?? 90, h: fp.roomDoorH?.[r] ?? 210,
          }];
        }
      }
      result.push(...computeExteriorWalls(rooms, fp.roomLayout ?? {}, fp.roomDimensions ?? {}, fp.roomWindows ?? {}, fi, mergedDoors));
    }
    return result;
  }, [floorPlans, floorCount]);

  const usedFloors = allSegs.length > 0 ? Math.max(...allSegs.map(s => s.floorIndex)) + 1 : 1;
  const totalH     = usedFloors * (FLOOR_H + SLAB_T) - SLAB_T;

  return (
    <group>
      {/* 地面基座 */}
      <mesh position={[0, -0.04, 0]} receiveShadow>
        <boxGeometry args={[W + 0.40, 0.08, D + 0.40]} />
        <meshStandardMaterial color="#D0C8B4" roughness={0.90} />
      </mesh>

      {/* ── 1. 实心房间盒子（和全局3D完全对应） ── */}
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
            // 房间中心坐标（同 FloorPlanExterior 坐标系：南 = -Z）
            const cx = (p.x + d.width / 2 - planOffset.minX) * CM - W / 2;
            const cz = -((p.y + d.depth / 2 - planOffset.minY) * CM) + D / 2;
            return (
              <mesh
                key={`box-${fi}-${room}`}
                position={[cx, yBase + FLOOR_H / 2, cz]}
                castShadow receiveShadow
              >
                <boxGeometry args={[rW, FLOOR_H, rD]} />
                <meshStandardMaterial color={wallColor} roughness={0.82} metalness={0.01} />
              </mesh>
            );
          });
      })}

      {/* ── 2. 层间楼板 ── */}
      {Array.from({ length: usedFloors - 1 }, (_, fi) => (
        <mesh key={`slab-${fi}`} position={[0, (fi + 1) * (FLOOR_H + SLAB_T) - SLAB_T / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[W + 0.30, SLAB_T, D + 0.30]} />
          <meshStandardMaterial color="#E0DCD4" roughness={0.85} />
        </mesh>
      ))}

      {/* ── 3. 外墙 facade overlay（覆盖在房间盒子表面） ── */}
      {allSegs.map((seg, i) => {
        const segLen = (seg.segEnd - seg.segStart) * CM;
        const yBase  = seg.floorIndex * (FLOOR_H + SLAB_T);
        const yMid   = yBase + FLOOR_H / 2;
        const isSouth = seg.side === "south";
        const facade  = isGlassVilla
          ? (isSouth ? "glass" : seg.side === "west" && seg.floorIndex > 0 ? "wood" : null)
          : null;

        // 只渲染需要特殊材质的面（玻璃/木），混凝土直接用 box 底色
        if (!facade) {
          // 混凝土面 + 窗洞（planeGeometry overlay）
          if (!seg.windows.length) return null;
          // 有窗才加 overlay
          const wallStartAbs = isSouth || seg.side === "north" ? seg.roomX : seg.roomY;
          let px: number, pz: number, rot: [number, number, number];
          if (isSouth) {
            [px] = toWorld(seg.segStart + (seg.segEnd - seg.segStart) / 2, seg.roomY + seg.roomD, planOffset);
            [, pz] = toWorld(seg.roomX, seg.roomY + seg.roomD, planOffset);
            rot = [0, Math.PI, 0]; pz -= 0.11;
          } else if (seg.side === "north") {
            [px] = toWorld(seg.segStart + (seg.segEnd - seg.segStart) / 2, seg.roomY, planOffset);
            [, pz] = toWorld(seg.roomX, seg.roomY, planOffset);
            rot = [0, 0, 0]; pz += 0.11;
          } else if (seg.side === "east") {
            [px] = toWorld(seg.roomX + seg.roomW, seg.roomY, planOffset);
            [, pz] = toWorld(seg.roomX + seg.roomW, seg.segStart + (seg.segEnd - seg.segStart) / 2, planOffset);
            rot = [0, -Math.PI / 2, 0]; px += 0.11;
          } else {
            [px] = toWorld(seg.roomX, seg.roomY, planOffset);
            [, pz] = toWorld(seg.roomX, seg.segStart + (seg.segEnd - seg.segStart) / 2, planOffset);
            rot = [0, Math.PI / 2, 0]; px -= 0.11;
          }
          return (
            <group key={`win-${i}`} position={[px, yMid, pz]} rotation={rot}>
              {seg.windows.map(w => (
                <WallWindow key={w.id} win={w} wallStart={wallStartAbs} segStart={seg.segStart} />
              ))}
            </group>
          );
        }

        // 玻璃幕墙 / 木板 overlay
        let px: number, pz: number, rot: [number, number, number];
        if (isSouth) {
          [px] = toWorld(seg.segStart + (seg.segEnd - seg.segStart) / 2, seg.roomY + seg.roomD, planOffset);
          [, pz] = toWorld(seg.roomX, seg.roomY + seg.roomD, planOffset);
          rot = [0, Math.PI, 0]; pz -= 0.11;
        } else if (seg.side === "north") {
          [px] = toWorld(seg.segStart + (seg.segEnd - seg.segStart) / 2, seg.roomY, planOffset);
          [, pz] = toWorld(seg.roomX, seg.roomY, planOffset);
          rot = [0, 0, 0]; pz += 0.11;
        } else if (seg.side === "east") {
          [px] = toWorld(seg.roomX + seg.roomW, seg.roomY, planOffset);
          [, pz] = toWorld(seg.roomX + seg.roomW, seg.segStart + (seg.segEnd - seg.segStart) / 2, planOffset);
          rot = [0, -Math.PI / 2, 0]; px += 0.11;
        } else {
          [px] = toWorld(seg.roomX, seg.roomY, planOffset);
          [, pz] = toWorld(seg.roomX, seg.segStart + (seg.segEnd - seg.segStart) / 2, planOffset);
          rot = [0, Math.PI / 2, 0]; px -= 0.11;
        }

        // 门坐标换算
        const wallStartForDoor = isSouth || seg.side === "north" ? seg.roomX : seg.roomY;
        const doorInfos = seg.doors.map(d => {
          const dPos  = d.pos ?? 0;
          const dLen  = d.len;
          const rawX  = (wallStartForDoor + dPos + dLen / 2 - seg.segStart) * CM - segLen / 2;
          const dLenM = dLen * CM;
          return {
            cx:  Math.max(-segLen / 2 + dLenM / 2, Math.min(segLen / 2 - dLenM / 2, rawX)),
            w:   dLenM,
            h:   Math.min((d.h ?? 210) * CM, FLOOR_H - 0.05),
          };
        });

        if (facade === "glass") {
          return (
            <group key={`gl-${i}`} position={[px, yMid, pz]} rotation={rot}>
              <GlassCurtain width={segLen} height={FLOOR_H} floorH={FLOOR_H} doors={doorInfos} />
            </group>
          );
        }

        // wood facade (侧墙木饰面)
        const planks = Math.max(4, Math.round(FLOOR_H / 0.15));
        const plankH = FLOOR_H / planks;
        return (
          <group key={`wd-${i}`} position={[px, yMid, pz]} rotation={rot}>
            {Array.from({ length: planks }, (_, pi) => (
              <mesh key={pi} position={[0, -FLOOR_H / 2 + (pi + 0.5) * plankH, 0]}>
                <boxGeometry args={[segLen, plankH * 0.88, 0.05]} />
                <meshStandardMaterial color={pi % 2 === 0 ? "#8B6340" : "#7A5530"} roughness={0.78} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* ── 4. 平屋顶 ── */}
      <FlatRoof W={W} D={D} roofY={totalH} />
    </group>
  );
}
