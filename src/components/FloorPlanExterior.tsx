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
 * 坐标系与全局3D完全一致（coord-refactor 之后）：
 *   Floor plan X → Three.js X（不翻转）
 *   Floor plan Y → Three.js +Z（南=大Y → world +Z；北=-Z）
 *   摄像机在 SE 角（+X,+Z），朝 NW 看，与 GlobalCanvas 相同象限
 *   楼层 → Three.js Y（向上）
 */

import React, { useMemo, useCallback, useEffect, useState, useRef, Suspense } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Html, useGLTF, Clone, Instances, Instance, Text } from "@react-three/drei";
import { useDesignerStore } from "@/lib/store";
import { overlayMaterialProps } from "@/lib/zLayer";
import { ROOM_DEFS, RoomType, WindowConfig, DoorConfig, PlacedItem, resolveFacadeLayer, resolveFaceOpacity, isExteriorWallSide } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { InteriorRoomDetail } from "./InteriorRoomDetail";
import { PlacedItemMesh, LightFixtureInner } from "./RoomCanvas";
import { STAIR_FURNITURE_IDS } from "./Staircase";
import { WalkthroughDoor3D } from "@/components/walkthrough/WalkthroughDoor3D";
import { StyledWindow } from "@/components/shared/StyledWindow";
import {
  WINDOW_GLASS_COLOR, WINDOW_FRAME_COLOR,
  ENTRANCE_DOOR_COLOR, ENTRANCE_DOOR_CASING_COLOR, ENTRANCE_DOOR_HANDLE_COLOR,
} from "@/lib/roomVisuals";
import { splitWallAroundHoles } from "@/lib/wallGeom";
import { paintAlbedo, paintNormal, defaultFloorPlanks } from "@/lib/furnitureTextures";
import { getFloorTexture, floorTileSize, getWallTexture, wallTileSize, getStuccoTexture, getStuccoNormal } from "@/lib/textures";

/** 漫游/室内模式下的房间灯具：复用 效果图 的同一套灯具造型
 *  （LightFixtureInner，visualOnly=只出网格、不出投影灯——漫游里
 *  实际照明由场景级方向光+环境光提供，避免每房多盏点光爆 WebGL
 *  灯数/纹理预算）。读取该房间的 materials.light.id，这样「换灯具
 *  类型 / AI 改灯」在漫游里也能看出形状变化，不再是写死的筒灯。
 *  开关 / 调光 / 改色复用与 效果图 相同的 store 状态。 */
function WalkthroughRoomLight({ room, lightId, color, H }: {
  room: RoomType; lightId: string; color: string; H: number;
}) {
  const isOn = useDesignerStore(s => s.lightsOnByRoom[room] !== false);
  const brightness = useDesignerStore(s => s.lightBrightnessByRoom[room] ?? 1);
  const colorOverride = useDesignerStore(s => s.lightColorByRoom[room]);
  const ref = useRef<THREE.Mesh>(null);
  const finalColor = colorOverride ?? color;
  return (
    <LightFixtureInner
      H={H} lightColor={finalColor} lightId={lightId}
      chandelierRef={ref} isOn={isOn} brightness={brightness}
      visualOnly
    />
  );
}

// ── 常量 ──────────────────────────────────────────────────────
const CM      = 0.01;
const FLOOR_H = 3.00;   // 每层净高 m
const SLAB_T  = 0.20;   // 层间楼板厚 m
const TOLE    = 10;     // 外墙相邻判定容差 cm

/** 把一块矩形地块（XZ 平面，单位 m）绕开一个矩形开口拆成 ≤4 块矩形，
 *  返回 {w,d,x,z} 数组；opening=null 时返回整块。屋面板 / 背景板 / 层间
 *  楼板都复用同一机制开「楼梯井」，保证天台开口上下贯通、不被任何一层
 *  封死。中间 W/E 两块按开口与地块的交集裁剪，避免开口越界时溢出。*/
function carveRect(
  fW: number, fD: number, cX: number, cZ: number,
  opening: { cx: number; cz: number; w: number; d: number } | null,
): Array<{ key: string; w: number; d: number; x: number; z: number }> {
  if (!opening) return [{ key: "all", w: fW, d: fD, x: cX, z: cZ }];
  const oL = opening.cx - opening.w / 2, oR = opening.cx + opening.w / 2;
  const oN = opening.cz - opening.d / 2, oS = opening.cz + opening.d / 2;
  const fL = cX - fW / 2, fR = cX + fW / 2, fN = cZ - fD / 2, fS = cZ + fD / 2;
  const pcs: Array<{ key: string; w: number; d: number; x: number; z: number }> = [];
  if (oN - fN > 0.01) pcs.push({ key: "N", w: fW, d: oN - fN, x: cX, z: (fN + oN) / 2 });
  if (fS - oS > 0.01) pcs.push({ key: "S", w: fW, d: fS - oS, x: cX, z: (oS + fS) / 2 });
  const midN = Math.max(oN, fN), midS = Math.min(oS, fS);
  const midD = midS - midN, midZ = (midN + midS) / 2;
  if (oL - fL > 0.01) pcs.push({ key: "W", w: oL - fL, d: midD, x: (fL + oL) / 2, z: midZ });
  if (fR - oR > 0.01) pcs.push({ key: "E", w: fR - oR, d: midD, x: (oR + fR) / 2, z: midZ });
  return pcs;
}

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
export type WallSide = "S" | "N" | "E" | "W";

export interface ExteriorWallSeg {
  floorIndex: number;
  room:       RoomType;
  side:       WallSide;
  roomX: number; roomY: number; roomW: number; roomD: number;
  segStart: number; segEnd: number;
  windows: WindowConfig[];
  doors:   DoorConfig[];
  /** Resolved facade layers for THIS face (实墙/玻璃幕墙/框架 + 玻璃透明度).
   *  Filled in the component memo (needs floorPlans + curtainWall). Two
   *  adjacent segs only merge into one FacadeBlock when their fl signatures
   *  match, so per-face overrides stay at per-room/per-face granularity. */
  fl?: { wall: boolean; glass: boolean; frame: boolean; opacity: number };
}

// ── 坐标换算 ──────────────────────────────────────────────────
interface PlanOffset { minX: number; minY: number; W: number; D: number }

/** floor-plan cm → Three.js m (北 = world -Z, 南 = world +Z) */
function toWorld(fpX: number, fpY: number, o: PlanOffset): [number, number] {
  return [
    (fpX - o.minX) * CM - o.W / 2,
    (fpY - o.minY) * CM - o.D / 2,
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
  // FPE.WallSide and WindowConfig.wall are now the same NSWE alphabet —
  // no translation needed. Kept as a helper for grep-ability.
  return side;
}

/** Default door span (cm) for a room when the user hasn't set roomDoorLen.
 *  Garage gets a WIDE sectional door (most of the wall, min 240 / max 300),
 *  so it reads as a real garage door and triggers the sectional-door render
 *  (≥2m threshold). All other rooms get the standard 80cm single-leaf door. */
function defaultDoorLenCm(room: RoomType, wallLenCm: number): number {
  if (room === "garage") return Math.max(240, Math.min(wallLenCm - 40, 300));
  return 80;
}
/** Force any garage door to a wide, centred garage-door size so the GLB roller
 *  shutter fills the opening (a user's leftover 80cm pedestrian door would make
 *  the shutter tiny). No-op for non-garage rooms / non-garage doors. */
function widenGarageDoor(room: RoomType, door: DoorConfig, widthCm: number, depthCm: number): DoorConfig {
  if (room !== "garage") return door;
  const wallLen = (door.wall === "W" || door.wall === "E") ? depthCm : widthCm;
  const len = Math.max(door.len ?? 0, Math.min(wallLen - 40, 340));
  const pos = Math.max(5, (wallLen - len) / 2);
  return { ...door, len, pos, h: Math.max(door.h ?? 0, 210), style: door.style ?? ("roller_shutter" as import("@/lib/types").DoorStyle) };
}
/** Default door height (cm) — garage doors are taller (~210). */
function defaultDoorHCm(room: RoomType): number {
  return room === "garage" ? 210 : 200;
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
      { side: "S" as WallSide, wallCoord: ry + rd, axis: "x" as const, wallStart: rx,     wallEnd: rx + rw },
      { side: "N" as WallSide, wallCoord: ry,      axis: "x" as const, wallStart: rx,     wallEnd: rx + rw },
      { side: "E"  as WallSide, wallCoord: rx + rw, axis: "y" as const, wallStart: ry,     wallEnd: ry + rd },
      { side: "W"  as WallSide, wallCoord: rx,      axis: "y" as const, wallStart: ry,     wallEnd: ry + rd },
    ];

    for (const { side, wallCoord, axis, wallStart, wallEnd } of sides) {
      // 「被相邻房间覆盖」= 内墙；剩下的才是真正的建筑外周面。
      // 旧逻辑只认「边缘精确对齐」(other 的对面边 == wallCoord)，一旦相邻
      // 房间与本房间在该轴上有重叠/错位(如默认户型里走廊 y320–560 压进
      // 客厅 y520–1020 共 40cm)，对齐判定失败 → 把这道内墙误判成外周 →
      // 幕墙模式下渲染成玻璃幕墙(用户：客厅 N 墙明明隐藏了却出现幕墙)。
      // 改用「房体重叠」判定：取该面正外侧 1cm 处的探针点，若它落在另一个
      // 房间体内，则该段属于内墙(被覆盖)。对完美拼接的户型与旧逻辑等价，
      // 对重叠/错位户型更正确。
      const PROBE = 1; // cm，刚好探到面外侧
      const covered: [number, number][] = [];
      for (const other of rooms) {
        if (other === room) continue;
        const op = layout[other]; const od = dims[other];
        if (!op || !od) continue;
        let onOuterSide: boolean, oStart: number, oEnd: number;
        if (axis === "x") {
          // N/S 面：外侧在 y 方向
          const outerY = side === "S" ? wallCoord + PROBE : wallCoord - PROBE;
          onOuterSide = op.y - TOLE <= outerY && outerY <= op.y + od.depth + TOLE;
          oStart = op.x; oEnd = op.x + od.width;
        } else {
          // E/W 面：外侧在 x 方向
          // W 面特别处理：同一 x 坐标的共面房间不互相遮蔽。
          // 只有真正在本墙外侧（对 W 面 = 更靠西，即 op.x < wallCoord）的房间
          // 才算覆盖。避免走廊/客厅等共享同一 x=0 的房间互相削去对方的外立面段。
          if (side === "W") {
            onOuterSide = op.x < wallCoord && op.x + od.width + TOLE >= wallCoord;
          } else {
            // E 面：覆盖房间在右侧，op.x + od.width > wallCoord 且 op.x ≤ wallCoord+TOLE
            onOuterSide = op.x + od.width > wallCoord && op.x <= wallCoord + TOLE;
          }
          oStart = op.y; oEnd = op.y + od.depth;
        }
        if (!onOuterSide) continue;
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
          // 按窗户「中心点」归属到唯一墙段，避免横跨切割点的宽窗被相邻两段
          // 各画一遍（重复窗框/窗梃错位叠加 → 多余竖线、下方拖线）。门已用
          // 同样的「落在段内」思路（见下方 segDoors）。
          const wCenter = wallStart + (w.pos ?? 0) + w.len / 2;
          return wCenter >= segStart && wCenter < segEnd;
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

/**
 * 幕墙竖挺 + 分格的「单一真源」布局 —— 网格优先模型(用户:框架先均匀排布,门窗再选
 * 合适的格嵌进去,框架别太密)。供外观图(GlassCurtain)与门窗吸附(房间循环)共用:
 *   1. 硬边:两端 + 所有门/窗左右边 → 洞口边必有竖挺,严格对齐平面图位置。
 *   2. 在无洞口的跨内均匀补挺(全局对齐,bay 默认 1.5m)。
 *   3. 门洞内部竖挺删除;窗竖挺不动(窗边已是挺)。
 * 返回:mullions(最终竖挺,含两级宽) / cells(door=key 的格在外观图里抠掉玻璃,window
 *      的格保留固定玻璃) / openingBay(每个洞口实际区间,严格对齐平面图)。
 * 纯函数、确定性:相同输入 → 相同输出,GlassCurtain 与吸附 memo 各自调用必然一致。
 */
function buildCurtainLayout(
  segLen: number,
  openings: Array<{ cx: number; w: number; key: string; kind: "d" | "w" }>,
  cfg: { bay?: number; structW?: number; mullionW?: number; gridOriginM?: number; flip?: boolean },
): {
  mullions: Array<{ x: number; w: number }>;
  cells: Array<{ x0: number; x1: number; door: string | null }>;
  openingBay: Map<string, { x0: number; x1: number; kind: "d" | "w" }>;
} {
  const half = segLen / 2;
  const bay = Math.max(0.8, cfg.bay ?? 1.5);
  const structW = Math.max(0.04, cfg.structW ?? 0.085);
  const mullionW = Math.max(0.03, cfg.mullionW ?? 0.07);
  const gridOriginM = cfg.gridOriginM ?? 0;
  const flip = cfg.flip ?? false;

  const ops = openings
    .map(o => ({ x0: Math.max(-half, o.cx - o.w / 2), x1: Math.min(half, o.cx + o.w / 2), cx: o.cx, key: o.key, kind: o.kind }))
    .filter(o => o.x1 - o.x0 > 0.05)
    .sort((a, b) => a.cx - b.cx);

  // 1. 硬边:两端 + 所有门/窗左右边 —— 洞口边必有竖挺,严格对齐平面图。
  const hardSet = new Set<number>([-half, half]);
  for (const o of ops) { hardSet.add(o.x0); hardSet.add(o.x1); }
  const hardX = Array.from(hardSet).sort((a, b) => a - b);

  // 2. 在无洞口的跨内均匀补挺(全局对齐,防碎格)。
  const allXSet = new Set<number>(hardX);
  for (let i = 0; i < hardX.length - 1; i++) {
    const lx0 = hardX[i], lx1 = hardX[i + 1];
    const spanMid = (lx0 + lx1) / 2;
    if (ops.some(o => spanMid > o.x0 + 0.005 && spanMid < o.x1 - 0.005)) continue;
    const x0w = lx0 + half, x1w = lx1 + half;
    const margin = bay * 0.4;
    const startK = Math.ceil((gridOriginM + x0w + margin) / bay);
    const endK   = Math.floor((gridOriginM + x1w - margin) / bay);
    for (let k = startK; k <= endK; k++) {
      const run = k * bay - gridOriginM;
      const lx = flip ? -(run - half) : (run - half);
      if (lx > lx0 + 0.005 && lx < lx1 - 0.005) allXSet.add(lx);
    }
  }
  // 近邻去重(洞口边与均匀挺重合时保留一根)
  const rawX = Array.from(allXSet).sort((a, b) => a - b);
  const gridX: number[] = [rawX[0]];
  for (let i = 1; i < rawX.length; i++) {
    if (rawX[i] - gridX[gridX.length - 1] > mullionW * 0.35) gridX.push(rawX[i]);
  }

  // 3. 洞口记录;门洞删内部挺,窗竖挺保持不动(窗边已是挺)。
  const removedX = new Set<number>();
  const openingBay = new Map<string, { x0: number; x1: number; kind: "d" | "w" }>();
  for (const o of ops) {
    openingBay.set(o.key, { x0: o.x0, x1: o.x1, kind: o.kind });
    if (o.kind === "d") {
      for (const x of gridX) {
        if (x > o.x0 + 0.005 && x < o.x1 - 0.005) removedX.add(x);
      }
    }
  }

  // 4. 最终竖挺,两级宽:端部 structW,其余 mullionW。
  const mullions: Array<{ x: number; w: number }> = gridX
    .filter(x => !removedX.has(x))
    .map(x => ({ x, w: (x <= -half + 0.001 || x >= half - 0.001) ? structW : mullionW }));

  // 5. 分格:门格抠玻璃,窗格保留固定玻璃。
  const cells: Array<{ x0: number; x1: number; door: string | null }> = [];
  for (let i = 0; i < mullions.length - 1; i++) {
    const x0 = mullions[i].x, x1 = mullions[i + 1].x, mid = (x0 + x1) / 2;
    let doorKey: string | null = null;
    for (const [k, b] of openingBay) { if (b.kind === "d" && mid > b.x0 && mid < b.x1) { doorKey = k; break; } }
    cells.push({ x0, x1, door: doorKey });
  }
  return { mullions, cells, openingBay };
}

function GlassCurtain({
  width, height, floorH, doors = [], windows = [], opacityScale = 1, glassColor,
  mullionBay, structFrameWidth, mullionWidth, gridOriginM = 0, gridFlip = false,
  skipMullionLeft = false, skipMullionRight = false,
  spandrelColor = "#283442",
  entranceFrameColor = "#202329",
  entranceHandleColor = "#C8CDD2",
  entranceCanopy = true,
  showFrame = true,
  showGlass = true,
  glassTransparency,
  showBottomSpandrel = true,
  showEntranceDoor = true,
  showBlinds = false,
}: {
  width: number; height: number; floorH: number;
  doors?: Array<{ cx: number; w: number; h: number }>;
  /** 该立面段上的窗(中心+宽,立面局部),与门一起决定竖挺分格(洞口边必有挺)。
   *  sill/h(米): 开启扇竖直区间 —— 幕墙在该格 [sill,sill+h] 抠掉固定玻璃留窗洞,
   *  关窗时由 StyledWindow 上悬扇(同色同透)填满、开窗时露出真洞。 */
  windows?: Array<{ cx: number; w: number; sill?: number; h?: number }>;
  /** 竖挺节奏(米,默认 1.2):非洞口段按此补匀中间挺。可经 exterior.curtainMullionBay 配。 */
  mullionBay?: number;
  /** 承重外框料宽(米,默认 0.16):建筑两端 + 上下楼板线用粗框。exterior.curtainStructFrameWidth。 */
  structFrameWidth?: number;
  /** 分格竖挺料宽(米,默认 0.07):洞口边 + 中间补匀挺用细框。exterior.curtainMullionWidth。 */
  mullionWidth?: number;
  /** 本立面块沿墙轴的起点(米)+ 是否翻转 —— 用于竖挺「全局对齐」(同面相邻块挺对齐)。 */
  gridOriginM?: number;
  gridFlip?: boolean;
  /** 跨块去重:抑制本块左端(−half)/右端(+half)的承重端挺(交界处只留隔壁块那根)。 */
  skipMullionLeft?: boolean;
  skipMullionRight?: boolean;
  /** Per-face 透明度 0..1 (1 = fully clear see-through, 0 = opaque frosted panel).
   *  When set, it drives the vision-pane opacity DIRECTLY across the full
   *  clear→opaque range, overriding the (multiplicative) opacityScale path. */
  glassTransparency?: number;
  /** 框架(框) layer — aluminium mullion/transom/rail grid + entrance door frame.
   *  Independently toggleable per face (roomFacadeFaces[..].frame). */
  showFrame?: boolean;
  /** 玻璃幕墙(玻璃) layer — vision-glass panes + spandrel bands + blinds.
   *  Independently toggleable per face (roomFacadeFaces[..].glass). When false
   *  the face is an open aluminium frame (or fully open if frame也 hidden). */
  showGlass?: boolean;
  /** 底部裙板(落地处那道暗色 spandrel)开关。一楼(floorIndex===0)设为 false，
   *  让玻璃直接落地、露出室内地面家具(地毯/矮茶几)，符合通透玻璃幕墙别墅参考图；
   *  楼层间的带(上层 facade 的底带)保留以表达楼板线。默认 true。 */
  showBottomSpandrel?: boolean;
  /** 是否渲染幕墙自带的「静态装饰入户门」。curtainWall villa 里设为 false：
   *  门改由可点击开关的 WalkthroughDoor3D（french_double 玻璃门）渲染在
   *  幕墙留出的门洞里，于是门能真正推开(用户：幕墙门能推开吗)。GlassCurtain
   *  仍按 doors 在该格跳过玻璃面留洞，只是不再画那道静态门。默认 true。 */
  showEntranceDoor?: boolean;
  /** 幕墙玻璃内侧的「百叶帘」装饰(随机部分格上部拉下水平百叶)。从外面看是
   *  一片悬浮的半透水平细网,易被误读(用户:这个网是什么)。默认 false 关闭，
   *  可经 exterior.curtainBlinds 恢复。 */
  showBlinds?: boolean;
  // Whole-house glass-tower mode multiplies pane opacity so the curtain
  // wall reads as reflective glass instead of a transparent window onto
  // the (stylised, cream) interior shell. Configurable via exterior.glassOpacity.
  opacityScale?: number;
  glassColor?: string;
  /** Spandrel (opaque shadow-box) glass colour. Configurable via
   *  exterior.glassSpandrelColor. Default soft blue-grey #283442. */
  spandrelColor?: string;
  /** Ground-floor entrance door frame colour. Configurable via
   *  exterior.entranceFrameColor. Default near-black anodised #202329. */
  entranceFrameColor?: string;
  /** Entrance door pull-handle colour. Configurable via
   *  exterior.entranceHandleColor. Default brushed steel #C8CDD2. */
  entranceHandleColor?: string;
  /** Project a flat canopy slab over the entrance. Configurable via
   *  exterior.entranceCanopy. Default true. */
  entranceCanopy?: boolean;
}) {
  // Vision-pane opacity. Per-face 透明度 (glassTransparency) maps the full
  // clear→opaque range directly: t=1 → 0.04 (barely-there clear glass), t=0 →
  // 0.88 (opaque frosted panel). Without it, fall back to the legacy
  // multiplicative opacityScale (whole-house glass-tower / legacy presets).
  const paneAbs = glassTransparency != null
    ? Math.max(0.04, Math.min(0.88, (1 - glassTransparency) * 0.88 + 0.04))
    : null;
  const op = (v: number) =>
    paneAbs != null ? paneAbs : Math.min(0.92, v * Math.max(0.1, opacityScale));
  // 完全对齐"现代玻璃幕墙别墅"模板的 GlassCurtainWallFace：
  //  · 玻璃 #C8E0EA opacity 0.45 roughness 0.06 metalness 0.04 envMapIntensity 0.35
  //  · 黑色阳极氧化铝压条 #181A1E，金属感强但不被环境贴图染色
  //  · 模板原话："No spandrel/backing slab — interior room geometry provides
  //    back walls visible through transmission glass"——所以视觉通透感来自
  //    "玻璃 + 背后专门画的暖色奶油室内"，不是玻璃透明度本身。
  // Wider panels (1.80m) match reference image's curtain wall rhythm
  // Vertical-mullion rhythm. ~1.2m bays give a consistent floor-to-ceiling
  // glazing grid even on wide rooms (1.80m left wide faces looking frameless).
  const rows  = Math.round(height / floorH);
  const rowH  = height / rows;
  const frame = "#181A1E";
  void showBlinds; void panelBlindHash;   // 百叶帘已移除(用户:这个网是什么)

  // ── 竖挺/分格「统一真源」布局:均匀网格优先 + 门窗吸附到格(见 buildCurtainLayout)。
  //    两级框宽(承重粗 structW / 分格细 mullW),bay 默认 1.5m(不太密)。 ──
  const structW = Math.max(0.05, structFrameWidth ?? 0.085);
  const mullW   = Math.max(0.03, mullionWidth ?? 0.07);
  const layout = useMemo(
    () => buildCurtainLayout(
      width,
      [
        ...doors.map((d, i) => ({ cx: d.cx, w: d.w, key: `d${i}`, kind: "d" as const })),
        ...windows.map((w, i) => ({ cx: w.cx, w: w.w, key: `w${i}`, kind: "w" as const })),
      ],
      { bay: mullionBay ?? 1.5, structW, mullionW: mullW, gridOriginM, flip: gridFlip },
    ),
    [width, doors, windows, mullionBay, structW, mullW, gridOriginM, gridFlip],
  );

  // 窗格 → 开启扇竖直区间(sill,h) 映射:在该格抠出与窗等大的窗洞(开窗见真洞)。
  const winBandByCell = useMemo(() => {
    const m = new Map<string, { sill: number; h: number }>();
    windows.forEach((w, i) => {
      if (w.sill == null || w.h == null) return;
      const span = layout.openingBay.get(`w${i}`);
      if (!span) return;
      m.set(`${span.x0.toFixed(3)}_${span.x1.toFixed(3)}`, { sill: w.sill, h: w.h });
    });
    return m;
  }, [windows, layout]);

  return (
    <group>
      {/* ── 框架(框) layer — gated by showFrame ── */}
      {showFrame && (
      <>
      {/* 上/下楼板线 = 承重粗横框(structW) */}
      <mesh position={[0, height / 2 - structW / 2, 0.005]}>
        <boxGeometry args={[width, structW, 0.064]} />
        <meshStandardMaterial color={frame} roughness={0.10} metalness={0.96} envMapIntensity={2.8} />
      </mesh>
      <mesh position={[0, -height / 2 + structW / 2, 0.005]}>
        <boxGeometry args={[width, structW, 0.064]} />
        <meshStandardMaterial color={frame} roughness={0.10} metalness={0.96} envMapIntensity={2.8} />
      </mesh>

      {/* 竖挺:由 buildCurtainLayout 决定 —— 洞口左右边「必有」一根挺(门窗永远
          落在两挺之间,不跨挺不留缝);两端=承重粗框 structW,其余=分格细挺 mullW。
          每根挺自带料宽 m.w(两级)。 */}
      {layout.mullions.filter(m => {
        // 跨块去重:交界处抑制本块的左/右端挺(隔壁块已有一根)。
        if (skipMullionLeft  && Math.abs(m.x - (-width / 2)) < 0.02) return false;
        if (skipMullionRight && Math.abs(m.x - ( width / 2)) < 0.02) return false;
        return true;
      }).map((m, i) => (
        <mesh key={`mul-${i}`} position={[m.x, 0, 0.005]}>
          <boxGeometry args={[m.w, height + 0.22, 0.060]} />
          <meshStandardMaterial color={frame} roughness={0.10} metalness={0.96} envMapIntensity={2.8} />
        </mesh>
      ))}
      </>
      )}

      {/* ── 玻璃 layer：除「门格」外都铺固定视觉玻璃(裙带 + 上/下视野 62/38)。
          · 门格:留空,由可开关的 WalkthroughDoor3D 玻璃门填满。
          · 窗格:保留固定玻璃,小开启扇(StyledWindow 上悬扇)嵌在格内、覆在固定玻璃上
            (参考实拍:整面固定玻璃 + 少数小开启扇)。
          三视图共用同一套 layout,门窗永远正好嵌进该格、不跨挺。 ── */}
      {showGlass && layout.cells.map((cell, ci) => {
        if (cell.door) return null;                          // 门格:不铺玻璃(门填满)
        const cxc = (cell.x0 + cell.x1) / 2;
        const cw  = (cell.x1 - cell.x0) - mullW - 0.006;     // 扣掉两侧半根挺
        if (cw <= 0.02) return null;
        // 窗格:在开启扇竖直区间(sill..sill+h)抠掉固定玻璃 → 与窗等大的窗洞(开窗见真洞);
        // 上方横头、下方窗台保留固定玻璃。关窗时由 StyledWindow 上悬扇(同色同透)填满,
        // 与幕墙浑然一体、有反射(用户:和幕墙一样 + 要窗洞)。
        const band = winBandByCell.get(`${cell.x0.toFixed(3)}_${cell.x1.toFixed(3)}`);
        if (band) {
          const floorY  = -height / 2;
          const botEdge = floorY + structW;
          const topEdge = height / 2 - structW;
          const sashY0  = Math.max(botEdge, floorY + band.sill);
          const sashY1  = Math.min(topEdge, floorY + band.sill + band.h);
          const pane = (y0: number, y1: number, key: string) => {
            const ph = y1 - y0;
            if (ph <= 0.02) return null;
            return (
              <mesh key={key} position={[cxc, (y0 + y1) / 2, 0.020]} renderOrder={10}>
                <boxGeometry args={[cw, ph - 0.004, 0.008]} />
                <meshPhysicalMaterial
                  color={glassColor ?? "#8AA6C2"}
                  transparent opacity={op(0.24)}
                  depthWrite={false} roughness={0.05} metalness={0.0}
                  reflectivity={0.5} envMapIntensity={2.0} side={THREE.DoubleSide}
                  {...overlayMaterialProps(2)}
                />
              </mesh>
            );
          };
          return (
            <group key={`wincell-${ci}`}>
              {pane(botEdge, sashY0, `wsill-${ci}`)}
              {pane(sashY1, topEdge, `wtransom-${ci}`)}
            </group>
          );
        }
        return Array.from({ length: rows }, (_, ri) => {
          const py     = -height / 2 + (ri + 0.5) * rowH;
          const spH    = showBottomSpandrel ? Math.min(rowH * 0.200, 0.55) : 0;
          const visH   = rowH - spH;
          const topH   = visH * 0.62;
          const botH   = visH * 0.38;
          const visBot = py - rowH / 2 + spH;
          return (
            <group key={`cell-${ci}-${ri}`} position={[cxc, 0, 0.005]}>
              {spH > 0 && (
                <mesh position={[0, py - rowH / 2 + spH / 2, 0.021]}>
                  <boxGeometry args={[cw, spH, 0.008]} />
                  <meshStandardMaterial color={spandrelColor} roughness={0.28} metalness={0.85} envMapIntensity={1.25} />
                </mesh>
              )}
              <mesh position={[0, visBot + botH + topH / 2, 0.020]} renderOrder={10}>
                <boxGeometry args={[cw, topH - 0.004, 0.008]} />
                <meshPhysicalMaterial
                  color={glassColor ?? "#93AEC8"}
                  transparent opacity={op(0.22)}
                  depthWrite={false} roughness={0.04} metalness={0.0}
                  reflectivity={0.5} envMapIntensity={2.0} side={THREE.DoubleSide}
                  {...overlayMaterialProps(2)}
                />
              </mesh>
              <mesh position={[0, visBot + botH / 2, 0.020]} renderOrder={10}>
                <boxGeometry args={[cw, botH - 0.004, 0.008]} />
                <meshPhysicalMaterial
                  color={glassColor ?? "#8AA6C2"}
                  transparent opacity={op(0.24)}
                  depthWrite={false} roughness={0.05} metalness={0.0}
                  reflectivity={0.5} envMapIntensity={2.0} side={THREE.DoubleSide}
                  {...overlayMaterialProps(2)}
                />
              </mesh>
            </group>
          );
        });
      })}

      {/* Spandrel bands 已并入外层 InstancedMesh (spandrelPositions) */}

      {/* 大门 —— 玻璃幕墙底层的"可读"主入口。
          旧版把门做得和幕墙同色同透明度 + 细黑竖线，几乎看不出来，
          正是用户抱怨的"看不出门"。现在做成一个清晰的入口门洞：
          · 落到地面的整片门（盖住该格 spandrel 暗带，z 在 spandrel 之前）
          · 较粗的深色门框（门头 + 两侧门套 + 地槛）勾出门洞
          · 双扇透明玻璃门（比幕墙更清透）
          · 一对竖向不锈钢拉手（强烈的"这是门"信号）
          · 可选的入口雨棚挑板。
          颜色/雨棚全部可配置（exterior.entrance*）。
          showEntranceDoor=false（curtainWall villa）时不画这道静态门——
          改由可开关的 WalkthroughDoor3D 玻璃门接管，门能真正推开。 */}
      {showEntranceDoor && doors.map((door, di) => {
        const dW = door.w;
        const dH = door.h;
        const fT = 0.07;             // frame member width
        const fD = 0.07;             // frame depth
        const zFront = 0.034;        // sit in front of spandrel band (z≈0.026)
        const baseY = -height / 2;   // building floor line
        const leafW = dW / 2 - fT * 0.6;
        const handleH = Math.min(0.9, dH * 0.42);
        const handleY = baseY + dH * 0.5;
        return (
          <group key={`door-${di}`} position={[door.cx, baseY, zFront]}>
            {/* 双扇玻璃门 —— 比幕墙更清透，读作"可进入的开口" */}
            {[-dW / 4 + fT * 0.1, dW / 4 - fT * 0.1].map((ox, si) => (
              <mesh key={si} position={[ox, dH / 2, 0.004]} renderOrder={20}>
                <boxGeometry args={[leafW, dH - 0.06, 0.010]} />
                <meshPhysicalMaterial
                  color={glassColor ?? "#7FA6C4"}
                  transparent opacity={op(0.30)}
                  depthWrite={false} roughness={0.04} metalness={0.0}
                  reflectivity={0.55} clearcoat={0.9} clearcoatRoughness={0.04}
                  envMapIntensity={1.4} side={THREE.DoubleSide}
                  {...overlayMaterialProps(3)}
                />
              </mesh>
            ))}
            {/* 门框：门头 + 左右门套 + 中竖梃 + 地槛 */}
            {[
              [0, dH + fT / 2, dW + fT * 2, fT] as const,            // head
              [-(dW / 2 + fT / 2), dH / 2, fT, dH + fT] as const,    // left jamb
              [ (dW / 2 + fT / 2), dH / 2, fT, dH + fT] as const,    // right jamb
              [0, dH / 2, fT * 0.7, dH] as const,                    // meeting mullion
              [0, 0.025, dW + fT * 2, 0.05] as const,                // threshold
            ].map(([bx, by, bw, bh], bi) => (
              <mesh key={bi} position={[bx, by, 0.012]}>
                <boxGeometry args={[bw, bh, fD]} />
                <meshStandardMaterial color={entranceFrameColor} metalness={0.85} roughness={0.22} envMapIntensity={1.8} />
              </mesh>
            ))}
            {/* 一对竖向拉手 */}
            {[-0.10, 0.10].map((hx, hi) => (
              <mesh key={hi} position={[hx, handleY, 0.05]}>
                <boxGeometry args={[0.022, handleH, 0.030]} />
                <meshStandardMaterial color={entranceHandleColor} metalness={0.9} roughness={0.25} envMapIntensity={2.2} />
              </mesh>
            ))}
            {/* 入口雨棚挑板 —— 明确的"主入口"提示 */}
            {entranceCanopy && (
              <mesh position={[0, dH + fT + 0.06, 0.30]}>
                <boxGeometry args={[dW + 0.55, 0.06, 0.62]} />
                <meshStandardMaterial color={entranceFrameColor} metalness={0.6} roughness={0.4} envMapIntensity={1.4} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}


// ── 混凝土外墙面（带板缝线条，建筑感） ──────────────────────────────
function ConcreteFacade({
  width, height, windows = [], windowGlow = 0,
  glassColor: glassColorOverride,
  frameColor: frameColorOverride,
  hGrooveStep: hGrooveStepOverride,
  vGrooveStep: vGrooveStepOverride,
  sillEnabled = true, lintelEnabled = true, jambEnabled = true,
  flowerBoxFreq = 70, twoTone = true,
  stripVCm = 4, stripHCm = 8,
  sillColor = "#B8B4AC", lintelColor = "#C0BCB4",
  jambColor = "#BCBAB2", jambDepthCm = 9,
  flowerBoxColor = "#2A2C34",
  flowerFoliageColor = "#3E7428",
  flowerBloomColor = "#E83040",
  baseColor = "#E6E0D8",
  grooveColor = "#C0BAB2",
  glassTopColor,
  glassEnvIntensity = 0.10,
  mullionPos = 0,
  mullionThicknessCm = 3,
  grooveOpacity = 0.55,
  revealShadow = 0.50,
  baseShadow = 0.0,
  eaveShadow = 0.0,
  wallVignette = 0.0,
  stuccoEnabled = true,
  stuccoScale = 1.2,
  stuccoRoughness = 0.85,
  wallTextureId = "",
  windowProtrude = 0.06,
  doors = [],
  // 门色默认值从共享视觉模块取（与效果图同一真源），不在此处另写色值。
  doorColor = ENTRANCE_DOOR_COLOR,
  doorHandleColor = ENTRANCE_DOOR_HANDLE_COLOR,
  casingColor = "#D8D0C2",
  // 门套独立配色（与窗套 casingColor 解耦），同样取共享真源
  doorCasingColor = ENTRANCE_DOOR_CASING_COLOR,
  frameDepthCm = 7,
  frameMemberCm = 5.5,
}: {
  width: number; height: number;
  windows?: Array<{ localX: number; winLen: number; winH: number; winSill: number }>;
  /** Ground-floor entrance doors (concrete facade). cx/w/h in metres. */
  doors?: Array<{ cx: number; w: number; h: number }>;
  /** Door leaf color. Default gray '#9C9699' to match 效果图 glTF door. */
  doorColor?: string;
  /** Door handle / hardware metal color. Default brushed metal '#B7BBC0'. */
  doorHandleColor?: string;
  /** Window outer plaster casing (trim) color. Default '#D8D0C2'. */
  casingColor?: string;
  /** Door casing/frame color. Default gray '#C7C4C7' to match 效果图 door frame. */
  doorCasingColor?: string;
  /** Forward projection (cm) of the window frame ring — creates the recessed
   *  3D window depth so glass reads as set behind a real proud frame. Default 7. */
  frameDepthCm?: number;
  /** Window frame member width (cm). Default 5.5. */
  frameMemberCm?: number;
  /** Night-mode interior glow (0 = off, 0.9+ = full night). */
  windowGlow?: number;
  /** Daytime window glass color (when no night glow). Falls back to slate-blue. */
  glassColor?: string;
  /** Window frame color. Falls back to dark anodised. */
  frameColor?: string;
  /** Horizontal precast seam spacing (m). Default 0.90. */
  hGrooveStep?: number;
  /** Vertical precast seam spacing (m). Default 1.20. */
  vGrooveStep?: number;
  /** Window sill + drip edge. Default true. */
  sillEnabled?: boolean;
  /** Window lintel above. Default true. */
  lintelEnabled?: boolean;
  /** Side jamb reveals. Default true. */
  jambEnabled?: boolean;
  /** Flower-box probability per window in 0–100. Default 70. */
  flowerBoxFreq?: number;
  /** Even/odd two-tone panel striping. Default true. */
  twoTone?: boolean;
  /** Vertical (left + right) frame strip width in cm. Default 4. */
  stripVCm?: number;
  /** Horizontal (top + bottom) frame strip height in cm. Default 8. */
  stripHCm?: number;
  /** Window sill stone color. Default '#B8B4AC'. */
  sillColor?: string;
  /** Window lintel concrete color. Default '#C0BCB4'. */
  lintelColor?: string;
  /** Window jamb (side reveal) color. Default '#BCBAB2'. */
  jambColor?: string;
  /** Window jamb depth (cm). Default 9. */
  jambDepthCm?: number;
  /** Wrought-iron flower-box body color. Default '#2A2C34'. */
  flowerBoxColor?: string;
  /** Foliage base color. Default '#3E7428'. */
  flowerFoliageColor?: string;
  /** Bloom base color. Default '#E83040'. */
  flowerBloomColor?: string;
  /** Facade base color. Default '#E6E0D8'. */
  baseColor?: string;
  /** Facade groove shadow color. Default '#C0BAB2'. */
  grooveColor?: string;
  /** Window glass TOP colour for sky-reflection gradient. When undefined,
   *  glass is drawn as a single uniform pane in `glassColor`. */
  glassTopColor?: string;
  /** Daytime glass envMap reflection strength (0–1). Default 0.10 — kept low so
   *  the pane reads as a dark recessed opening instead of mirroring the bright
   *  sky and washing into the facade. */
  glassEnvIntensity?: number;
  /** Horizontal mullion position 0–1 of pane height. 0 = disabled. */
  mullionPos?: number;
  /** Mullion thickness in cm. Default 3. */
  mullionThicknessCm?: number;
  /** Multiplier on grout-line opacity (0–1). Default 0.55. Lower = grout
   *  blends into wall, reducing the "kindergarten brick" look. */
  grooveOpacity?: number;
  /** Strength of the inward darkening band at the jamb (0–1). Default 0.50. */
  revealShadow?: number;
  /** AO-style dark strip at wall bottom (where wall meets ground / slab). 0..1. */
  baseShadow?: number;
  /** AO-style dark strip below the eave / parapet (top of wall). 0..1. */
  eaveShadow?: number;
  /** 0..1 vertical wall vignette — adds a soft top→bottom darkening overlay
   *  so the wall reads as 3D-lit instead of flat-fill. */
  wallVignette?: number;
  /** Multiply procedural stucco grain into the baseColor box. Default true.
   *  Set false for the flat painted-cardboard legacy look. */
  stuccoEnabled?: boolean;
  /** Physical tile size (m) of the stucco grain. Default 1.2. */
  stuccoScale?: number;
  /** Roughness of the stuccoed wall material 0..1. Default 0.85. */
  stuccoRoughness?: number;
  /** Registered wall material id (brick / stone / wood / tile …) configured on
   *  the room's exterior wall in 效果图. When set AND `getWallTexture` knows it,
   *  the facade base wall is clad with that SAME tiled texture (matching the
   *  interior render & walkthrough) instead of the procedural stucco grain.
   *  Empty string → keep stucco (the default matte-cream villa look). The
   *  building-wide `wallBaseColor` flat-color override clears this upstream so a
   *  user-picked solid color always wins. Default "". */
  wallTextureId?: string;
  /** Forward offset (m) of the whole window detail group so the glass clears
   *  the 12 cm-thick wall box (front face at local z=+0.06) and is actually
   *  visible from outside. Without this the glass/frame (authored at local
   *  z≈0.018–0.022) sit INSIDE the solid wall and get occluded — the window
   *  vanishes, leaving only the protruding flower box on a blank wall.
   *  Default 0.06 → group sits AT the wall front face; glass/backing land a
   *  few mm proud and the frame ring projects forward by frameDepthCm to make
   *  a real recessed window. Configurable to match a thinner/thicker wall. */
  windowProtrude?: number;
}) {
  // Per-tone hash variation around the base — shifts RGB ±20 % so the
  // mound doesn't read as flat-tone. Saturation/hue stay anchored to
  // the user's pick. Helper inlined since it's only used twice.
  const shadeBy = (hex: string, by: number): string => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 0xff) * (1 + by))));
    const g = Math.max(0, Math.min(255, Math.round(((n >>  8) & 0xff) * (1 + by))));
    const b = Math.max(0, Math.min(255, Math.round(( n        & 0xff) * (1 + by))));
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
  };
  const foliageA = shadeBy(flowerFoliageColor, -0.20);
  const foliageB = shadeBy(flowerFoliageColor,  0.10);
  const bloomA   = flowerBloomColor;
  const bloomB   = shadeBy(flowerBloomColor,  0.15);
  const bloomC   = shadeBy(flowerBloomColor, -0.15);
  const jambDepthM = Math.max(0.04, Math.min(0.20, jambDepthCm / 100));
  // Convert strip-thickness cm → metres for mesh use, with clamps.
  const stripVm = Math.max(0.02, Math.min(0.12, stripVCm / 100));
  const stripHm = Math.max(0.02, Math.min(0.16, stripHCm / 100));
  // 水平板缝：每 hGrooveStep m 一道（模拟预制混凝土挂板分割）
  const hGrooveStep  = Math.max(0.4, Math.min(2.0, hGrooveStepOverride ?? 0.90));
  const hGrooveCount = Math.max(1, Math.round(height / hGrooveStep) - 1);
  // 竖向板缝：每 vGrooveStep m 一道
  const vGrooveStep  = Math.max(0.4, Math.min(3.0, vGrooveStepOverride ?? 1.20));
  const vGrooveCount = Math.max(1, Math.round(width / vGrooveStep) - 1);
  // grooveColor + baseColor are now props (configured via ExteriorSettings).
  // ── Iter 3: soften panel grout. Blend grooveColor toward baseColor by
  // (1 - grooveOpacity). At grooveOpacity=0 the seam reads as a hairline
  // tonal break instead of a kindergarten-brick white line. ────────────
  const grooveCol = (() => {
    const op = Math.max(0, Math.min(1, grooveOpacity));
    if (op >= 0.99) return grooveColor;
    const hexOf = (h: string) => {
      const m = /^#([0-9a-f]{6})$/i.exec(h);
      if (!m) return [192, 186, 178];
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    };
    const a = hexOf(grooveColor);
    const b = hexOf(baseColor);
    const mix = a.map((ai, i) => Math.round(ai * op + b[i] * (1 - op)));
    return `#${mix.map(v => v.toString(16).padStart(2, "0")).join("")}`;
  })();

  return (
    <group>
      {/* ── 底板（整面）── 12 cm 厚，跟漫游模式 WALL_T 一致，让外观图墙体在
           转角处显出真实墙厚（不像纸片）。
           Stucco grain texture multiplied into baseColor stops the wall
           reading as cardboard flat-fill. Repeat scaled by width/height so
           the speckle stays the same physical size regardless of segment.
           Configurable via stuccoTextureEnabled (default true). */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, 0.12]} />
        {(() => {
          // ── 与效果图 / 漫游同源的外墙材质贴图 ──
          // 当该面外墙在 效果图 里配了砖/石/木/瓷砖等注册材质 (wallTextureId)，
          // 就用 getWallTexture 取同一张贴图铺在外立面 —— 与 RoomCanvas /
          // WalkthroughWallPiece 调用的是同一套纹理 + 同一套 wallTileSize，
          // 三个视图墙面一致。tileSize 决定每块贴图的物理尺寸，repeat 用
          // width/height 换算，保证砖块大小不随墙段长度漂移。baseColor 作为
          // 染色叠加（多数砖石贴图是近灰底，乘上墙色微调色温即可）。
          const wallTex = wallTextureId ? getWallTexture(wallTextureId) : null;
          if (wallTex) {
            const t = wallTex.clone();
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
            const [us, vs] = wallTileSize(wallTextureId);
            t.repeat.set(Math.max(1, width / us), Math.max(1, height / vs));
            t.needsUpdate = true;
            return <meshStandardMaterial map={t} color={baseColor} roughness={0.85} metalness={0.02} envMapIntensity={0.30} />;
          }
          if (stuccoEnabled === false) {
            return <meshStandardMaterial color={baseColor} roughness={0.78} metalness={0.02} envMapIntensity={0.35} />;
          }
          const tex = getStuccoTexture(1).clone();
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          const scl = Math.max(0.2, stuccoScale);
          const rx = Math.max(2, width / scl), ry = Math.max(2, height / scl);
          tex.repeat.set(rx, ry);
          tex.needsUpdate = true;
          // 法线贴图：给外墙加凹凸光感（关键「假→真」），与 albedo 同 repeat。
          const nrm = getStuccoNormal(1).clone();
          nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
          nrm.repeat.set(rx, ry);
          nrm.needsUpdate = true;
          return <meshStandardMaterial map={tex} normalMap={nrm} normalScale={new THREE.Vector2(0.32, 0.32)} color={baseColor} roughness={stuccoRoughness} metalness={0.02} envMapIntensity={0.30} />;
        })()}
      </mesh>
      {/* ── Iter 7-9: AO-style overlays. All three (baseShadow, eaveShadow,
           wallVignette) are thin transparent dark planes layered just in
           front of the wall — purely additive, never replaces baseColor. */}
      {baseShadow > 0 && (() => {
        // Band height grows with the dial — at full strength covers 60 cm
        // up the wall (enough to mask base bloom/specular hot-spots), at
        // low strength reads as a hairline AO line.
        const op = Math.max(0, Math.min(1, baseShadow));
        const bandH = 0.20 + op * 0.40; // 20..60 cm
        return (
          <mesh position={[0, -height / 2 + bandH / 2, 0.062]}>
            <planeGeometry args={[width + 0.004, bandH]} />
            <meshStandardMaterial color="#000000" transparent
              opacity={op * 0.55}
              roughness={1.0} metalness={0} />
          </mesh>
        );
      })()}
      {eaveShadow > 0 && (
        <mesh position={[0, height / 2 - 0.075, 0.062]}>
          <planeGeometry args={[width + 0.004, 0.15]} />
          <meshStandardMaterial color="#000000" transparent
            opacity={Math.max(0, Math.min(1, eaveShadow)) * 0.50}
            roughness={1.0} metalness={0} />
        </mesh>
      )}
      {wallVignette > 0 && (() => {
        // Stack 3 horizontal bands: dim at bottom, neutral middle, slight
        // boost at top. Cheap fake of sky-occlusion lighting without writing
        // a custom shader.
        const v = Math.max(0, Math.min(1, wallVignette));
        return (
          <>
            <mesh position={[0, -height / 4, 0.061]}>
              <planeGeometry args={[width + 0.004, height / 2 - 0.10]} />
              <meshStandardMaterial color="#000000" transparent opacity={v * 0.18} roughness={1.0} metalness={0} />
            </mesh>
            <mesh position={[0, height / 4, 0.061]}>
              <planeGeometry args={[width + 0.004, height / 2 - 0.10]} />
              <meshStandardMaterial color="#FFFFFF" transparent opacity={v * 0.08} roughness={1.0} metalness={0} />
            </mesh>
          </>
        );
      })()}
      {/* ── 竖向分板阴影面 —— InstancedMesh，颜色交替 (even/odd 拆 2 个) ──
          每块宽固定 = vGrooveStep - 0.020。边角 panel 如果 panelW2 ≠ 标准
          宽度，会被几何 scale；为简单起见，跳过越界的板。 */}
      {twoTone && (() => {
        const evenPanels: Array<[number, number, number]> = [];
        const oddPanels: Array<[number, number, number]> = [];
        const N = Math.round(width / vGrooveStep);
        for (let vi = 0; vi < N; vi++) {
          const panelX = -width / 2 + (vi + 0.5) * vGrooveStep;
          if (panelX > width / 2) continue;
          const panelW2 = Math.min(vGrooveStep - 0.020, width - Math.abs(panelX) * 2);
          if (panelW2 <= 0) continue;
          // 我们假定 panelW2 ≈ 标准宽度（边角差异忽略，视觉上感觉不到）
          (vi % 2 === 0 ? evenPanels : oddPanels).push([panelX, 0, 0.041]);
        }
        const stdW = vGrooveStep - 0.020;
        return (
          <>
            {evenPanels.length > 0 && (
              <Instances limit={evenPanels.length}>
                <boxGeometry args={[stdW, height - 0.002, 0.004]} />
                <meshStandardMaterial color={shadeBy(baseColor,  0.020)} roughness={0.88} metalness={0.01} />
                {evenPanels.map((p, i) => <Instance key={i} position={p} />)}
              </Instances>
            )}
            {oddPanels.length > 0 && (
              <Instances limit={oddPanels.length}>
                <boxGeometry args={[stdW, height - 0.002, 0.004]} />
                <meshStandardMaterial color={shadeBy(baseColor, -0.025)} roughness={0.88} metalness={0.01} />
                {oddPanels.map((p, i) => <Instance key={i} position={p} />)}
              </Instances>
            )}
          </>
        );
      })()}

      {/* ── 水平板缝线 —— InstancedMesh */}
      {hGrooveCount > 0 && (
        <Instances limit={hGrooveCount}>
          <boxGeometry args={[width + 0.01, 0.018, 0.006]} />
          <meshStandardMaterial color={grooveCol} roughness={0.92} />
          {Array.from({ length: hGrooveCount }, (_, i) => (
            <Instance key={i} position={[0, -height / 2 + (i + 1) * hGrooveStep, 0.042]} />
          ))}
        </Instances>
      )}

      {/* ── 竖向板缝线 —— InstancedMesh */}
      {vGrooveCount > 0 && (
        <Instances limit={vGrooveCount}>
          <boxGeometry args={[0.018, height + 0.01, 0.006]} />
          <meshStandardMaterial color={grooveCol} roughness={0.92} />
          {Array.from({ length: vGrooveCount }, (_, i) => (
            <Instance key={i} position={[-width / 2 + (i + 1) * vGrooveStep, 0, 0.042]} />
          ))}
        </Instances>
      )}

      {/* ── 窗（真实 3D：墙面外凸窗框 + 凹陷玻璃，形成真实窗洞进深）── */}
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
        // 与效果图（RoomCanvas）程序化窗共享同一玻璃色（WINDOW_GLASS_COLOR）。
        // 白天模式玻璃 opacity=1、transmission=0（不透，不暴露内部），所以
        // 用浅蓝只是表面反射色，安全。仍可由 exterior.windowGlassColor 覆盖。
        const glassDay = glassColorOverride ?? WINDOW_GLASS_COLOR;
        // 顶片天空反射 tint，比主玻璃略亮一点，读作真实玻璃；可由
        // glassTopColor 覆盖。
        const glassSkyDay = "#D4E4F0";
        const glassColor = windowGlow > 0.5
          ? (isWarm ? "#D8C8A0" : isCool ? "#B8D8F0" : "#3A4A60")
          : glassDay;
        // 窗框/窗梃色：与效果图程序化窗共享同一白框（WINDOW_FRAME_COLOR）。
        const fc = frameColorOverride ?? WINDOW_FRAME_COLOR;
        // ── Real 3D window geometry ──────────────────────────────────────
        // The wall is a SOLID 12 cm box (no CSG holes), so anything authored
        // BEHIND its front face (local z<0 here, since the group sits AT the
        // face) is occluded. We fake a real recessed opening by:
        //   • glass + backing sitting a few mm proud of the wall face;
        //   • a frame ring (4 boxes) PROJECTING forward by frameDepth → the
        //     glass reads as set deep behind a proud frame (genuine depth,
        //     not a flat sticker);
        //   • an outer plaster casing/trim ring flush on the wall surface.
        const frameDepth = Math.max(0.02, Math.min(0.16, frameDepthCm / 100));
        const frameM     = Math.max(0.03, Math.min(0.12, frameMemberCm / 100));
        const glassZ     = 0.010;                 // pane just proud of wall face
        const backZ      = 0.003;                 // interior backing
        const innerW     = Math.max(0.05, w.winLen - frameM * 2);
        const innerH     = Math.max(0.05, w.winH  - frameM * 2);
        return (
        <group key={`ww-${wi}`} position={[w.localX, -height / 2 + w.winSill + w.winH / 2, windowProtrude]}>
          {/* 室内衬底 — 白天深邃，夜间按房间类型发光 */}
          <mesh position={[0, 0, backZ]}>
            <planeGeometry args={[innerW, innerH]} />
            <meshStandardMaterial
              color={windowGlow > 0.5 ? bgColor : "#11151B"}
              emissive={windowGlow > 0.5 && litMult > 0 ? glowColor : "#000000"}
              emissiveIntensity={windowGlow > 0.5 ? windowGlow * 0.90 * litMult : 0}
              roughness={0.92}
            />
          </mesh>
          {/* 玻璃 — 上下两片渐变（上片反射天空、下片偏深邃房间色）+ 窗梃 */}
          {(() => {
            const splitT  = mullionPos > 0 ? Math.max(0.10, Math.min(0.90, mullionPos)) : 0.50;
            const topH    = innerH * (1 - splitT);
            const botH    = innerH * splitT;
            const topCol  = (windowGlow > 0.5) ? glassColor : (glassTopColor ?? glassSkyDay);
            const mTh     = Math.max(0.015, Math.min(0.08, mullionThicknessCm / 100));
            const glassMatFor = (col: string) => (
              <meshPhysicalMaterial
                color={col}
                roughness={windowGlow > 0.5 ? 0.04 : 0.18}
                metalness={0.05}
                clearcoat={0.55} clearcoatRoughness={0.12}
                envMapIntensity={windowGlow > 0.5 ? 1.0 : (glassEnvIntensity ?? 0.10)}
                transparent opacity={windowGlow > 0.5 ? 0.82 : 1.0}
                emissive={windowGlow > 0.5 && litMult > 0 ? glassGlow : "#000000"}
                emissiveIntensity={windowGlow > 0.5 ? windowGlow * 0.24 * litMult : 0}
                side={THREE.FrontSide}
              />
            );
            return (
              <>
                <mesh position={[0, innerH / 2 - topH / 2, glassZ]}>
                  <planeGeometry args={[innerW, topH]} />
                  {glassMatFor(topCol)}
                </mesh>
                <mesh position={[0, -innerH / 2 + botH / 2, glassZ]}>
                  <planeGeometry args={[innerW, botH]} />
                  {glassMatFor(glassColor)}
                </mesh>
                {/* 水平窗梃（mullion）— 始终一根，使玻璃读作真实可开启窗 */}
                <mesh position={[0, splitT * innerH - innerH / 2, glassZ + 0.006]}>
                  <boxGeometry args={[innerW, mTh, 0.012]} />
                  <meshStandardMaterial color={fc} roughness={0.5} metalness={0.25} envMapIntensity={0.18} />
                </mesh>
                {/* 竖向窗梃 —— 宽窗才加，避免小窗显挤 */}
                {innerW > 1.25 && (
                  <mesh position={[0, 0, glassZ + 0.006]}>
                    <boxGeometry args={[mTh, innerH, 0.012]} />
                    <meshStandardMaterial color={fc} roughness={0.5} metalness={0.25} envMapIntensity={0.18} />
                  </mesh>
                )}
              </>
            );
          })()}
          {/* 窗框环 —— 4 根盒体向外凸出 frameDepth，内侧面构成真实窗洞进深。
              暗金属色，可由 windowFrameColor 配置。 */}
          {([
            [-w.winLen / 2 + frameM / 2, 0,                       frameM,    w.winH ] as [number, number, number, number],
            [ w.winLen / 2 - frameM / 2, 0,                       frameM,    w.winH ] as [number, number, number, number],
            [0,                          w.winH / 2 - frameM / 2,  w.winLen,  frameM ] as [number, number, number, number],
            [0,                         -w.winH / 2 + frameM / 2,  w.winLen,  frameM ] as [number, number, number, number],
          ]).map(([fx, fy, fw, fh], k) => (
            <mesh key={`fr-${k}`} position={[fx, fy, frameDepth / 2 + glassZ]} castShadow>
              <boxGeometry args={[fw, fh, frameDepth]} />
              <meshStandardMaterial color={fc} roughness={0.45} metalness={0.30} envMapIntensity={0.22} />
            </mesh>
          ))}
          {/* 外圈灰泥窗套（plaster casing / trim）—— 贴在墙面上，略凸 3 cm，
              让窗与墙之间有一圈装饰收边。颜色由 casingColor 配置。 */}
          {(() => {
            const tw = 0.085;                 // trim member width
            const tz = 0.014;                 // trim projection
            const oW = w.winLen + tw * 2;
            const oH = w.winH  + tw * 2;
            return ([
              [-oW / 2 + tw / 2, 0,                tw, oH] as [number, number, number, number],
              [ oW / 2 - tw / 2, 0,                tw, oH] as [number, number, number, number],
              [0,                 oH / 2 - tw / 2, oW, tw] as [number, number, number, number],
              [0,                -oH / 2 + tw / 2, oW, tw] as [number, number, number, number],
            ]).map(([tx, ty, tcw, tch], k) => (
              <mesh key={`tr-${k}`} position={[tx, ty, tz / 2]} castShadow>
                <boxGeometry args={[tcw, tch, tz]} />
                <meshStandardMaterial color={casingColor} roughness={0.82} metalness={0.02} envMapIntensity={0.3} />
              </mesh>
            ));
          })()}
          {/* 窗台板 + 滴水线（projecting sill + drip-edge metal cap） */}
          {sillEnabled && (
            <>
              <mesh position={[0, -w.winH / 2 - 0.055, frameDepth * 0.55]} castShadow receiveShadow>
                <boxGeometry args={[w.winLen + 0.18, 0.07, frameDepth + 0.06]} />
                <meshStandardMaterial color={sillColor} roughness={0.84} metalness={0.02} />
              </mesh>
              <mesh position={[0, -w.winH / 2 - 0.078, frameDepth + 0.05]}>
                <boxGeometry args={[w.winLen + 0.20, 0.010, 0.010]} />
                <meshStandardMaterial color="#2A2E38" roughness={0.20} metalness={0.92} envMapIntensity={1.8} />
              </mesh>
            </>
          )}
          {/* 窗楣（projecting concrete lintel above window） */}
          {lintelEnabled && (
            <mesh position={[0, w.winH / 2 + 0.045, frameDepth * 0.5]} castShadow>
              <boxGeometry args={[w.winLen + 0.14, 0.06, frameDepth + 0.03]} />
              <meshStandardMaterial color={lintelColor} roughness={0.86} metalness={0.01} />
            </mesh>
          )}
        </group>
        );
      })}
      {/* ── 入户门（真实 3D：外凸门套 + 凹陷木门扇 + 镶板 + 金属把手 + 门槛石）── */}
      {doors.map((d, di) => {
        const oW = Math.max(0.5, d.w);
        const oH = Math.max(1.2, d.h);
        const trimW   = 0.10;        // door casing member width
        const trimZ   = 0.09;        // casing forward projection
        const leafZ   = 0.020;       // leaf face just proud of wall
        const leafDp  = 0.05;        // leaf thickness
        const lw = oW - trimW;       // leaf width (set inside casing)
        const lh = oH - trimW / 2;   // leaf height (threshold at bottom)
        const panelShade = shadeBy(doorColor, -0.24);
        return (
          <group key={`dr-${di}`} position={[d.cx, -height / 2 + oH / 2, windowProtrude]}>
            {/* 门套环（3 边：左/右/顶）—— 向外凸出，构成门洞进深 */}
            {([
              [-oW / 2 + trimW / 2, 0,               trimW, oH    ] as [number, number, number, number],
              [ oW / 2 - trimW / 2, 0,               trimW, oH    ] as [number, number, number, number],
              [0,                    oH / 2 - trimW / 2, oW,   trimW] as [number, number, number, number],
            ]).map(([tx, ty, tcw, tch], k) => (
              <mesh key={`dt-${k}`} position={[tx, ty, trimZ / 2]} castShadow>
                <boxGeometry args={[tcw, tch, trimZ]} />
                <meshStandardMaterial color={doorCasingColor} roughness={0.8} metalness={0.02} envMapIntensity={0.3} />
              </mesh>
            ))}
            {/* 门扇 —— 木质，凹陷在门套之内 */}
            <mesh position={[0, -trimW / 4, leafZ + leafDp / 2]} castShadow receiveShadow>
              <boxGeometry args={[lw, lh, leafDp]} />
              <meshStandardMaterial color={doorColor} roughness={0.62} metalness={0.04} envMapIntensity={0.25} />
            </mesh>
            {/* 三块镶板（inset panels）—— 凹陷的木门镶板 */}
            {[0.30, 0.0, -0.30].map((fr, k) => {
              const pw = lw - 0.16;
              const ph = lh * 0.24;
              const py = -trimW / 4 + fr * lh;
              return (
                <mesh key={`dp-${k}`} position={[0, py, leafZ + leafDp + 0.001]}>
                  <planeGeometry args={[pw, ph]} />
                  <meshStandardMaterial color={panelShade} roughness={0.7} metalness={0.04} />
                </mesh>
              );
            })}
            {/* 金属门把手 */}
            <mesh position={[lw / 2 - 0.10, -trimW / 4, leafZ + leafDp + 0.02]} castShadow>
              <boxGeometry args={[0.03, 0.14, 0.04]} />
              <meshStandardMaterial color={doorHandleColor} roughness={0.25} metalness={0.9} envMapIntensity={1.6} />
            </mesh>
            {/* 门槛石（threshold stone） */}
            <mesh position={[0, -oH / 2 + 0.03, trimZ * 0.5]} castShadow receiveShadow>
              <boxGeometry args={[oW + 0.10, 0.06, trimZ + 0.08]} />
              <meshStandardMaterial color={sillColor} roughness={0.82} metalness={0.02} />
            </mesh>
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
  /** Resolved facade layers for this merged block (taken from its segs, which
   *  all share the same signature thanks to the merge guard). */
  fl: { wall: boolean; glass: boolean; frame: boolean; opacity: number };
}

// opacity here = 透明度 0..1 (1 = clear). 0.85 ≈ the see-through default look.
const DEFAULT_GLASS_TRANSPARENCY = 0.85;
const DEFAULT_FL = { wall: false, glass: true, frame: true, opacity: DEFAULT_GLASS_TRANSPARENCY };
const flKey = (fl?: ExteriorWallSeg["fl"]) =>
  fl ? `${fl.wall ? 1 : 0}${fl.glass ? 1 : 0}${fl.frame ? 1 : 0}:${fl.opacity}` : "def";

function buildFacadeBlocks(segs: ExteriorWallSeg[]): FacadeBlock[] {
  // Group by (floorIndex, side, wallCoord)
  const planes = new Map<string, { fi: number; side: WallSide; wc: number; segs: ExteriorWallSeg[] }>();
  for (const seg of segs) {
    const wc = seg.side === "S" ? seg.roomY + seg.roomD
             : seg.side === "N" ? seg.roomY
             : seg.side === "E"  ? seg.roomX + seg.roomW
             :                        seg.roomX;
    const key = `${seg.floorIndex}:${seg.side}:${wc}`;
    if (!planes.has(key)) planes.set(key, { fi: seg.floorIndex, side: seg.side, wc, segs: [] });
    planes.get(key)!.segs.push(seg);
  }

  const result: FacadeBlock[] = [];
  for (const { fi, side, wc, segs: pSegs } of planes.values()) {
    const sorted = [...pSegs].sort((a, b) => a.segStart - b.segStart);
    const isCirc = (r: string) => r === "stair" || r === "hallway";
    const groups: ExteriorWallSeg[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const last = groups[groups.length - 1];
      const lastEnd = Math.max(...last.map(s => s.segEnd));
      const adjacent = sorted[i].segStart - lastEnd <= TOLE * 3;
      // Never merge circulation rooms (stair/hallway) with regular rooms —
      // keeps their facade blocks separate so solid-wall logic applies.
      const sameKind = isCirc(sorted[i].room) === last.every(s => isCirc(s.room));
      // Only merge faces that share the SAME facade-layer signature, so a
      // per-face override (e.g. one room's south glass hidden) doesn't get
      // swallowed into a neighbour's merged block.
      const sameLayers = flKey(sorted[i].fl) === flKey(last[0].fl);
      if (adjacent && sameKind && sameLayers) {
        last.push(sorted[i]);
      } else {
        // Clip new group's start to previous group's end to prevent
        // coplanar rooms that overlap in Y from double-rendering the overlap zone.
        const clippedStart = Math.max(sorted[i].segStart, lastEnd);
        if (clippedStart < sorted[i].segEnd) {
          groups.push([{ ...sorted[i], segStart: clippedStart }]);
        }
      }
    }
    const isHoriz = side === "S" || side === "N";
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
      result.push({ floorIndex: fi, side, wallCoord: wc, mergedStart, mergedEnd, primaryRoom, rooms, doorEntries, winEntries, fl: grp[0].fl ?? DEFAULT_FL });
    }
  }
  return result;
}

// ── 平屋顶 ────────────────────────────────────────────────────
function FlatRoof({
  W, D, roofY, nightGlow = 0, hasRooftop = false,
  overhang = 0.45,
  overhangSouthExtra = 0.30,
  parapetH = 0.30,
  parapetGlass = true,
  slabColor = "#F0EDE8",
  parapetColorOverride,
  slabThicknessCm = 10,
  parapetThicknessCm: parapetTCm = 12,
  coveLightEnabled = true,
  coveLightColor = "#D0E8FF",
  stairOpening = null,
  stairExitSide = null,
  stairWallsHidden = null,
  penthouse = false,
  penthouseColor = "#E8E4DE",
}: {
  W: number; D: number; roofY: number;
  nightGlow?: number; hasRooftop?: boolean;
  overhang?: number;
  overhangSouthExtra?: number;
  parapetH?: number;
  parapetGlass?: boolean;
  slabColor?: string;
  parapetColorOverride?: string;
  /** Slab thickness (cm). Default 10. */
  slabThicknessCm?: number;
  /** Parapet thickness (cm). Default 12. */
  parapetThicknessCm?: number;
  /** Parapet cove LED strip. Default true. */
  coveLightEnabled?: boolean;
  /** Cove LED emissive color. Default '#D0E8FF'. */
  coveLightColor?: string;
  /** Stairwell footprint (building-center coords, metres) to carve out of the
   *  roof slab so the stair from the top floor emerges onto the 天台. Same
   *  treatment as the inter-floor slabs (4-piece carve around the opening).
   *  Only carved when hasRooftop. null ⇒ solid roof. */
  stairOpening?: { cx: number; cz: number; w: number; d: number } | null;
  /** 楼梯踏出天台的那一侧（= 天台楼梯间的门所在墙，NSWE）。开口护栏在这一
   *  侧留缺口、出屋面间的门也开在这侧，使「围栏缺口 / 门 / 漫游碰撞门洞」三者
   *  统一到房间真实配置的门，而非另算几何。null ⇒ 回退到按开口贴边几何推断。 */
  stairExitSide?: "N" | "S" | "E" | "W" | null;
  /** 天台楼梯间各墙是否隐藏（NSWE）。开口护栏只补在「墙体被隐藏」的那几侧
   *  ——墙在=房间盒子已挡人，护栏多余；墙隐=开敞楼梯口，护栏作安全栏。门侧
   *  始终留缺口。null/全 false ⇒ 不画护栏（盒子四壁已围合）。 */
  stairWallsHidden?: Partial<Record<"N" | "S" | "E" | "W", boolean>> | null;
  /** 天台楼梯口加盖「出屋面间」（带门带顶小屋，挡雨）。默认 false。 */
  penthouse?: boolean;
  /** 出屋面间墙体颜色。默认同女儿墙色。 */
  penthouseColor?: string;
}) {
  const OV   = Math.max(0, Math.min(1.5, overhang));
  const OV_S = OV + Math.max(0, Math.min(1.5, overhangSouthExtra));
  const PH   = Math.max(0, Math.min(1.0, parapetH));   // 女儿墙高度 — 0 隐藏
  const PT   = Math.max(0.06, Math.min(0.25, parapetTCm / 100));   // 女儿墙厚度（可配，6–25 cm）
  const ST   = Math.max(0.05, Math.min(0.30, slabThicknessCm / 100)); // 屋面板厚度
  const roofColor    = slabColor;
  const parapetColor = parapetColorOverride ?? "#E8E4DE";
  const roofSlab     = roofY + 0.05;  // 屋面板中心Y

  // 楼梯井开口：天台需要从下层楼梯上来的「楼梯口」，否则屋面板把楼梯
  // 间封死。与层间楼板一致，绕开 stairOpening 用 4 块矩形拼出屋面板。
  // 仅在 hasRooftop（天台可上人）时开洞。
  const opening = hasRooftop && stairOpening ? stairOpening : null;
  const carve = (fW: number, fD: number, cX: number, cZ: number) =>
    carveRect(fW, fD, cX, cZ, opening);

  return (
    <group>
      {/* 屋面板 — 厚度由 ExteriorSettings.roofSlabThicknessCm 控制；
          天台层绕开楼梯井开口（4 块矩形拼接）*/}
      {carve(W + OV * 2, D + OV_S + OV, 0, -(OV_S - OV) / 2).map((p) => (
        <mesh key={p.key} position={[p.x, roofSlab, p.z]} castShadow receiveShadow>
          <boxGeometry args={[p.w, ST, p.d]} />
          <meshStandardMaterial color={roofColor} roughness={0.88} />
        </mesh>
      ))}
      {/* 楼梯井开口安全护栏（天台开洞时）：在朝天台内侧（未贴女儿墙）
          的一侧留缺口，作为人从楼梯上来踏出天台的出入口。 */}
      {opening && (() => {
        const tol = 0.2;
        const perim: Record<"N" | "S" | "E" | "W", boolean> = {
          N: Math.abs((opening.cz - opening.d / 2) - (-D / 2)) < tol,
          S: Math.abs((opening.cz + opening.d / 2) - ( D / 2)) < tol,
          W: Math.abs((opening.cx - opening.w / 2) - (-W / 2)) < tol,
          E: Math.abs((opening.cx + opening.w / 2) - ( W / 2)) < tol,
        };
        const towardX: "W" | "E" = opening.cx > 0 ? "W" : "E";
        const towardZ: "N" | "S" = opening.cz > 0 ? "N" : "S";
        const order: Array<"N" | "S" | "E" | "W"> = Math.abs(opening.cx) >= Math.abs(opening.cz)
          ? [towardX, towardZ, towardX === "W" ? "E" : "W", towardZ === "N" ? "S" : "N"]
          : [towardZ, towardX, towardZ === "N" ? "S" : "N", towardX === "W" ? "E" : "W"];
        // 优先用天台楼梯间「真实配置的门」所在侧，使围栏缺口与门 / 漫游碰撞
        // 门洞完全一致（不特立独行、不另算几何）；房间没有门时才回退到按开口
        // 贴边几何推断「朝天台内侧」的那一面。
        const exitSide = stairExitSide ?? order.find(s => !perim[s]) ?? "S";
        return (
          <group position={[opening.cx, roofSlab + ST / 2, opening.cz]}>
            {/* 开口护栏：门洞那一侧留缺口（与出屋面间的门同侧） */}
            <StairwellRailing rW={opening.w} rD={opening.d} gap={exitSide} wallsHidden={stairWallsHidden} />
            {/* 出屋面间：带门带顶小屋，门开在 exitSide（踏出天台那侧），挡雨 */}
            {penthouse && (
              <StairPenthouse rW={opening.w} rD={opening.d} doorSide={exitSide}
                wallColor={penthouseColor} roofColor={roofColor} />
            )}
          </group>
        );
      })()}
      {/* 女儿墙 — 四边（仅 PH > 0 时渲染）*/}
      {PH > 0.01 && (
        <>
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
        </>
      )}
      {/* 屋顶边缘影线（同样绕开楼梯井开口） */}
      {carve(W + OV * 2 + 0.005, D + OV_S + OV + 0.005, 0, -(OV_S - OV) / 2).map((p) => (
        <mesh key={p.key} position={[p.x, roofY - 0.005, p.z]}>
          <boxGeometry args={[p.w, 0.01, p.d]} />
          <meshStandardMaterial color="#D8D4CE" roughness={0.85} />
        </mesh>
      ))}
      {/* 女儿墙顶面金属压盖（parapet cap flashing — dark anodized aluminum）
          PH=0 时无女儿墙，也就没有压盖了 */}
      {PH > 0.01 && [
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
           Posts are square 40mm brushed steel, spaced ~1.2m on all four sides.
           Only renders when parapetGlass=true AND there's a parapet to sit on. */}
      {parapetGlass && PH > 0.01 && (() => {
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

        // Combo-2 E: 4 侧所有立柱合并到 1 个 InstancedMesh（同几何同材质）
        const allParapetPosts: Array<[number, number, number]> = [];
        const sideMeta = sidesData.map(side => {
          const posts = sideRailing(side.len, side.posX, side.posZ, side.axisX);
          for (const { px, pz } of posts) {
            allParapetPosts.push([px, parapetTopY + postH / 2, pz]);
          }
          return { side, posts };
        });

        return (
          <group>
            {/* 4 侧所有立柱 —— InstancedMesh */}
            {allParapetPosts.length > 0 && (
              <Instances limit={allParapetPosts.length} castShadow>
                <boxGeometry args={[postS, postH, postS]} />
                <meshStandardMaterial color="#9AA0A8" roughness={0.18} metalness={0.88} envMapIntensity={2.5} />
                {allParapetPosts.map((p, i) => <Instance key={i} position={p} />)}
              </Instances>
            )}
            {sideMeta.flatMap(({ side, posts }, si) => {
              const glassSegCount = posts.length - 1;
              return [
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
           Gated by coveLightEnabled + only when there IS a parapet. */}
      {coveLightEnabled && PH > 0.01 && (() => {
        const coveH  = 0.032;   // LED strip height
        const coveT  = 0.015;   // strip depth
        const coveY  = roofSlab + 0.05 + 0.04;  // just above slab surface, at parapet base
        const coveColor = "#E8F4FF";
        const coveEmi   = coveLightColor;
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

      {/* 屋顶排水口/绿化块/线性天窗/HVAC 冷凝器组均已改为天台普通家具
          （furnitureId: roof-scupper / green-roof-patch / roof-skylight /
          hvac-condenser），在天台房间里按需增删/拖动/缩放，不再程序化写死。 */}
      {/* 光伏阵列已改为天台房间里的普通家具（furnitureId: solar-panel-array），
          在 RooftopDecorations → PlacedItemMesh 里渲染，位置可在「全局平面图 ·
          天台层」拖动。此处不再程序化写死建筑级阵列。 */}
      {/* 通风排气管已改为天台普通家具（furnitureId: roof-vent），在天台房间里
          按需增删/拖动/缩放。此处不再程序化写死。 */}

      {/* 避雷针/通信天线杆/屋顶气象站均已改为天台普通家具
          （furnitureId: lightning-rod / antenna-mast / weather-station），
          在天台房间里按需增删/拖动/缩放，不再程序化写死。 */}


    </group>
  );
}

// ── 楼梯间围栏（上层开口处安全栏杆） ─────────────────────────
function StairwellRailing({ rW, rD, gap = null, wallsHidden = null }: {
  rW: number; rD: number;
  gap?: "N" | "S" | "E" | "W" | null;
  /** 楼梯间各墙的显隐（NSWE）。护栏只在「没有墙」的那一侧补栏杆 —— 与房间
   *  墙体互补、绝不重复：墙在 → 由墙挡（不画护栏）；墙隐（开放楼梯井）→ 护栏
   *  补上做安全围栏。null ⇒ 视为四面都有墙（即不画护栏，全交给房间墙体）。 */
  wallsHidden?: Partial<Record<"N" | "S" | "E" | "W", boolean>> | null;
}) {
  const RH   = 0.92;   // 栏杆高度 m
  const POST = 0.06;   // 立柱截面 m
  const RAIL = 0.045;  // 横杆截面 m
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

  // 局部坐标：+Z=南 -Z=北 +X=东 -X=西。gap 指定的那一侧整段不画，
  // 留出人从楼梯上来踏出天台的出入口。
  const sideDefs: Array<{ side: "N" | "S" | "W" | "E"; axis: "x" | "z"; len: number; fixed: number; railAxis: "x" | "z" }> = [
    { side: "N", axis: "x", len: rW, fixed: -rD / 2 + POST / 2, railAxis: "x" },
    { side: "S", axis: "x", len: rW, fixed:  rD / 2 - POST / 2, railAxis: "x" },
    { side: "W", axis: "z", len: rD, fixed: -rW / 2 + POST / 2, railAxis: "z" },
    { side: "E", axis: "z", len: rD, fixed:  rW / 2 - POST / 2, railAxis: "z" },
  ];
  // 护栏与房间墙体互补：只在「该侧墙被隐藏」时补栏杆，且永远空出出入口
  // （gap = 门 / 踏出天台那侧）。四面都有墙时 allSides 为空 → 不画护栏，
  // 避免和房间自身的墙重复成「双层笼子」。
  const allSides = sideDefs.filter(s => s.side !== gap && (wallsHidden?.[s.side] === true));

  // Combo-2 E: 4 侧的所有立柱合并到 1 个 InstancedMesh（同几何同材质）
  const allPostPositions: Array<[number, number, number]> = [];
  for (const s of allSides) {
    for (const [px, , pz] of sidePosts(s.axis === "x" ? rW : rD, s.axis, s.fixed)) {
      allPostPositions.push([px, RH / 2, pz]);
    }
  }

  return (
    <group position={[0, 0, 0]}>
      {/* 立柱 —— InstancedMesh */}
      {allPostPositions.length > 0 && (
        <Instances limit={allPostPositions.length}>
          <boxGeometry args={[POST, RH, POST]} />
          <meshStandardMaterial color="#8A9BA8" metalness={0.55} roughness={0.35} />
          {allPostPositions.map((p, i) => <Instance key={i} position={p} />)}
        </Instances>
      )}
      {/* 横杆 + 玻璃保留 per-side（4 侧只画 4 套，每套 axis/len 各不同，不值得 instance） */}
      {allSides.map((s, si) => (
        <group key={si}>{/* 立柱已合并到上面的 Instances */}
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

// ── 楼梯出屋面间（penthouse / 屋面梯屋）──────────────────────────────
// 天台楼梯口的「带门带顶小屋」：四面墙 + 平屋面板，门洞开在 doorSide
// （= 楼梯口踏出天台的那一侧，与开口护栏的缺口同侧），其余三面封闭。
// 作用：挡雨遮风，避免雨水顺楼梯口灌入下层。坐标系与 StairwellRailing
// 一致（局部中心在天台开口中心、y=0 在屋面上表面）。
function StairPenthouse({ rW, rD, doorSide, wallColor, roofColor }: {
  rW: number; rD: number; doorSide: "N" | "S" | "E" | "W";
  wallColor: string; roofColor: string;
}) {
  const H     = 2.30;  // 墙净高 m
  const WT    = 0.12;  // 墙厚 m
  const RT    = 0.12;  // 屋面板厚 m
  const OV    = 0.12;  // 屋面出挑 m
  const doorW = Math.min(1.0, Math.min(rW, rD) * 0.55);
  const doorH = Math.min(2.1, H - 0.12);
  const wallMat = <meshStandardMaterial color={wallColor} roughness={0.84} />;
  const doorMat = <meshStandardMaterial color="#6B5847" roughness={0.6} metalness={0.05} />;

  const fullWall = (side: "N" | "S" | "E" | "W") => {
    const horiz = side === "N" || side === "S";
    const pos: [number, number, number] =
      side === "N" ? [0, H / 2, -rD / 2] : side === "S" ? [0, H / 2, rD / 2]
      : side === "W" ? [-rW / 2, H / 2, 0] : [rW / 2, H / 2, 0];
    const args: [number, number, number] = horiz ? [rW, H, WT] : [WT, H, rD];
    return <mesh position={pos} castShadow receiveShadow><boxGeometry args={args} />{wallMat}</mesh>;
  };

  const doorWall = (side: "N" | "S" | "E" | "W") => {
    const horiz = side === "N" || side === "S";
    const fixedZ = side === "N" ? -rD / 2 : rD / 2;
    const fixedX = side === "W" ? -rW / 2 : rW / 2;
    const span = horiz ? rW : rD;
    const segL = (span - doorW) / 2;
    const segC = doorW / 2 + segL / 2;   // 门垛中心离中线
    const segArgs:  [number, number, number] = horiz ? [segL, H, WT] : [WT, H, segL];
    const headArgs: [number, number, number] = horiz ? [doorW, H - doorH, WT] : [WT, H - doorH, doorW];
    const doorArgs: [number, number, number] = horiz ? [doorW * 0.94, doorH, WT * 0.5] : [WT * 0.5, doorH, doorW * 0.94];
    const p = (along: number, y: number): [number, number, number] =>
      horiz ? [along, y, fixedZ] : [fixedX, y, along];
    return (
      <>
        <mesh position={p(-segC, H / 2)} castShadow receiveShadow><boxGeometry args={segArgs} />{wallMat}</mesh>
        <mesh position={p( segC, H / 2)} castShadow receiveShadow><boxGeometry args={segArgs} />{wallMat}</mesh>
        <mesh position={p(0, (doorH + H) / 2)} castShadow receiveShadow><boxGeometry args={headArgs} />{wallMat}</mesh>
        <mesh position={p(0, doorH / 2)} castShadow><boxGeometry args={doorArgs} />{doorMat}</mesh>
      </>
    );
  };

  return (
    <group>
      {(["N", "S", "E", "W"] as const).map(s => (
        <group key={s}>{s === doorSide ? doorWall(s) : fullWall(s)}</group>
      ))}
      {/* 平屋面板（带四周出挑） */}
      <mesh position={[0, H + RT / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[rW + WT + OV * 2, RT, rD + WT + OV * 2]} />
        <meshStandardMaterial color={roofColor} roughness={0.86} />
      </mesh>
    </group>
  );
}

// ── 真实 GLTF 植物/树木加载器 ──────────────────────────────────────────────────
/**
 * Loads a GLTF model, auto-scales it to `targetH` metres tall, and places its
 * base at y=0. Wrapped in Suspense so missing files fail gracefully.
 * castShadow + receiveShadow set on all child meshes.
 */
const _gltfBboxCache = new Map<string, { h: number; minY: number }>();

function GltfPlant({
  path, targetH = 4.0, rotY = 0, scaleX = 1, scaleZ = 1,
}: {
  path: string;
  targetH?: number;
  rotY?: number;
  scaleX?: number;  // independent horizontal scaling for stylistic variety
  scaleZ?: number;
}) {
  const { scene } = useGLTF(path);
  const { yOff, s } = useMemo(() => {
    let cached = _gltfBboxCache.get(path);
    if (!cached) {
      const box = new THREE.Box3().setFromObject(scene);
      const sz = new THREE.Vector3();
      box.getSize(sz);
      cached = { h: sz.y || 1, minY: box.min.y };
      _gltfBboxCache.set(path, cached);
    }
    const sc = targetH / cached.h;
    return { yOff: -cached.minY * sc, s: sc };
  }, [path, targetH, scene]); // eslint-disable-line react-hooks/exhaustive-deps

  useMemo(() => {
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
    });
  }, [scene]);

  // Distance culling: trees/shrubs are decorative — when the camera is >30m
  // away the plant occupies just a few screen pixels and isn't worth the
  // GLTF triangles + shadow-pass cost. Toggle visible on group ref each
  // frame based on world-space distance. We throttle to every 6th frame
  // (~100ms at 60fps) since plant positions are static — sub-frame
  // accuracy buys nothing. Threshold has hysteresis (28m show / 32m hide)
  // to avoid flicker right at the boundary.
  const groupRef = useRef<THREE.Group>(null);
  const frameCounter = useRef(0);
  useFrame(({ camera }) => {
    frameCounter.current++;
    if (frameCounter.current % 6 !== 0) return;
    const g = groupRef.current;
    if (!g) return;
    // group is local to a parent — get world position
    g.getWorldPosition(_tmpVec3);
    const dist = _tmpVec3.distanceTo(camera.position);
    const wasVisible = g.visible;
    if (wasVisible && dist > 32) g.visible = false;
    else if (!wasVisible && dist < 28) g.visible = true;
  });

  return (
    <group ref={groupRef} position={[0, yOff, 0]} rotation={[0, rotY, 0]} scale={[s * scaleX, s, s * scaleZ]}>
      <Clone object={scene} />
    </group>
  );
}

const _tmpVec3 = new THREE.Vector3();

// Convenience wrappers with correct public paths
const CYPRESS_PATH  = "/models/outdoor_tree/cypress_tree_lowpoly/cypress_tree_lowpoly.glb";
const PALM_PATH     = "/models/outdoor_tree/palm_tree_lowpoly/palm_tree_lowpoly.glb";
const OLIVE_PATH    = "/models/outdoor_tree/old_olive_tree/old_olive_tree.glb";
const MAPLE_PATH    = "/models/outdoor_tree/maple_sugar_lowpoly/maple_sugar_lowpoly.glb";
// shrub_01/03/04 have truncated .bin files — only shrub_02 is valid
const SHRUB2_PATH    = "/models/outdoor_shrub/shrub_02/shrub_02_1k.glb";
const BOXWOOD_PATH   = "/models/outdoor_plant/boxwood_bush/boxwood_bush.glb";
const HEDGE_PATH     = "/models/outdoor_plant/hedge_generic/hedge_generic.glb";
const LOUNGER_PATH   = "/models/outdoor_furniture/sun_lounger/sun_lounger.glb";

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
    const light = lightsRef.current[0];
    if (!light) return;
    light.position.x = Math.sin(tc * 0.25) * poolW * 0.30;
    light.position.z = Math.cos(tc * 0.18) * poolL * 0.25;
    light.position.y = -poolDp * 0.55;
    const pulse = 0.80 + 0.20 * Math.sin(tc * 1.3);
    light.intensity = 2.0 * poolGlowI * pulse;
  });

  return (
    <pointLight
      ref={(el) => { if (el) lightsRef.current[0] = el; }}
      distance={poolW * 1.2}
      decay={1.8}
      color="#50D8F0"
      castShadow={false}
    />
  );
}

// ── 屋顶装饰层：读取屋顶平面图，按房间类型渲染真实 3D GLB 模型 ──
function RooftopDecorations({
  W, D, surfaceY, planOffset, onEnterRoom: _onEnterRoom, roofFloorIdx, nightGlow,
  floorPlansOverride,
}: {
  W: number; D: number; surfaceY: number;
  planOffset: PlanOffset;
  onEnterRoom?: (room: RoomType, floorIndex: number, worldPos: [number, number, number]) => void;
  roofFloorIdx: number;
  nightGlow: number;
  /** 多楼栋：渲染副楼天台时传入该楼 floorPlans，缺省读 store(激活楼栋)。 */
  floorPlansOverride?: import("@/lib/types").FloorPlan[];
}) {
  const storeFloorPlans = useDesignerStore(s => s.floorPlans);
  const floorPlans = floorPlansOverride ?? storeFloorPlans;
  const fp = floorPlans[roofFloorIdx];
  if (!fp) return null;

  const { enabledRooms, roomLayout, roomDimensions } = fp;

  const toW = (px: number, py: number, rw: number, rd: number) => {
    const cx  = (px + rw / 2 - planOffset.minX) * CM - W / 2;
    const cz  = (py + rd / 2 - planOffset.minY) * CM - D / 2;
    const rWm = rw * CM;
    const rDm = rd * CM;
    return { cx, cz, rWm, rDm };
  };

  return (
    <group>
      {enabledRooms.map((rt) => {
        const pos  = roomLayout[rt];
        const dims = roomDimensions[rt];
        if (!pos || !dims) return null;
        const { cx, cz, rWm, rDm } = toW(pos.x, pos.y, dims.width, dims.depth);
        const y = surfaceY;
        // NOTE: previously each rooftop room group had `onClick={() =>
        // onEnterRoom?.(...)}`. R3F's <group onClick> fires on every
        // pointerup that's preceded by a pointerdown on the same subtree
        // — there's no built-in drag-threshold filter. The result: any
        // drag-rotate that happened to start AND end over a rooftop room
        // triggered the room-enter handler, sliding the camera and (with
        // some probability) flipping into walkthrough mode mid-drag.
        // Comment at line 4719 records the deliberate decision to drop
        // these click handlers — entry is now solely via the left room
        // list and the top 「进入室内漫游」 button. Keep onEnterRoom in the
        // function signature for backwards compat with other callers.

        // 天台房间统一按普通房间渲染：外壳/装饰（遮阳棚/泳池/花园/吧台/
        // 设备箱）全部已是目录家具，走房间 placedItems，不再按房间类型
        // 程序化写死几何。默认布局在 store.makeRooftopFloorPlan 注入，
        // 用户可在平面图 / 效果图里自由增删 / 缩放 / 旋转，各视图统一用
        // PlacedItemMesh 渲染（与普通楼层房间完全一致）。
        const items = fp.rooms?.[rt]?.placedItems ?? [];
        return (
          <group key={rt} position={[cx, y, cz]}>
            {items.map((p) => (
              <Suspense key={p.instanceId} fallback={null}>
                <PlacedItemMesh placed={p} def={ROOM_DEFS[rt]} roomW={rWm} roomD={rDm} room={rt} />
              </Suspense>
            ))}
            {/* Rooftop ambient glow — emissive-only, no pointLight for perf */}
          </group>
        );
      })}
    </group>
  );
}


// ─── Walkthrough floor with proper texture (wood planks or registered
// tile texture). Mirrors RoomShell's floor material — gives the
// walkthrough the same wood-floor look as the effect page. ───────────
function WalkthroughFloor({
  cx, cz, yBase, rW, rD, floorColor, floorId, insideBuilding,
  bleed = 0, depthRank = 0, underlayMargin = 0,
}: {
  cx: number; cz: number; yBase: number; rW: number; rD: number;
  floorColor: string; floorId: string; insideBuilding: boolean;
  /** Per-edge overscan (m). Room floors are exact width×depth rectangles.
   *  At the open room↔corridor boundary (the corridor has no interior wall)
   *  the two floors are separated by the wall-thickness strip, so a gap
   *  shows the bright background as a thin seam. Growing each floor by
   *  `bleed` on every edge overlaps neighbours and bridges that strip. The
   *  overlap tucks under interior/exterior walls so nothing pokes out.
   *  NOTE: prefer `underlayMargin` over `bleed` — bleed makes a neighbour's
   *  (possibly lighter) floor intrude on TOP of this room near shared walls.
   *  Configurable; default 0. */
  bleed?: number;
  /** Unique, monotonic per-room index used as a polygonOffset depth rank.
   *  Adjacent room floors are coplanar; at exactly the same depth bias they
   *  z-fight and shimmer as a bright line. Keeping every floor COPLANAR (no
   *  Y stagger — a Y step lifts one floor's edge so it catches light as a
   *  bright rim) and instead giving each a DISTINCT polygonOffset makes one
   *  floor deterministically win the depth test (no z-fight, no lit step).
   *  Unique per room ⇒ no two neighbours ever tie. */
  depthRank?: number;
  /** Per-edge margin (m) of a neutral UNDERLAY plane rendered 2 cm BELOW the
   *  real floor. The real floor stays an exact room-sized rectangle (no
   *  intrusion onto neighbours), but the open 客厅↔走廊 boundary still leaves
   *  a hairline gap that, with nothing beneath, shows the bright background
   *  as a white seam. The underlay (this room's own floor tone) sits just
   *  under that gap so the seam reads as floor, never white sky. Because it
   *  is BELOW every real floor, neighbours' floors fully occlude it inside
   *  rooms — it only shows in the thin inter-room gap. Configurable. */
  underlayMargin?: number;
}) {
  // Bleed-expanded floor dimensions (overlap neighbours to hide seams).
  const fW = rW + bleed * 2;
  const fD = rD + bleed * 2;
  const floorTex = useMemo(() => {
    const base = getFloorTexture(floorId);
    if (!base) return null;
    const t = base.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const [us, vs] = floorTileSize(floorId);
    t.repeat.set(fW / us, fD / vs);
    t.needsUpdate = true;
    return t;
  }, [floorId, fW, fD]);
  const defaultTex = useMemo(() => {
    if (floorTex) return null;
    const t = defaultFloorPlanks(floorColor).clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(fW / 1.5, fD / 1.5);
    t.needsUpdate = true;
    return t;
  }, [floorColor, fW, fD, floorTex]);
  const map = floorTex ?? defaultTex;
  return (
    <>
      {/* UNDERLAY — only in walkthrough. A neutral, room-tone plane 2 cm below
          the real floor, grown by `underlayMargin` on every edge so it tucks
          under neighbours and fills the thin inter-room gap from beneath.
          This makes any seam read as floor instead of bright sky. Kept out of
          exterior view (insideBuilding === false) so it never pokes past the
          building base. */}
      {insideBuilding && underlayMargin > 0 && (
        <mesh
          position={[cx, yBase + 0.025 - 0.02, cz]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <planeGeometry args={[rW + underlayMargin * 2, rD + underlayMargin * 2]} />
          <meshStandardMaterial
            color={floorColor}
            roughness={0.85}
            metalness={0.0}
            side={THREE.FrontSide}
            polygonOffset
            polygonOffsetFactor={-1 - depthRank * 0.6}
            // Unique per-room bias so overlapping underlays don't z-fight either.
            // 每个房间 factor + units 同步拉开（≈3 个单位/房间），保证在掠射角
            // / 远距离下相邻楼板的深度排序仍是决定性的，不会闪烁出虚影。
            polygonOffsetUnits={-2 - depthRank * 3}
          />
        </mesh>
      )}
      {/* REAL FLOOR — exact room rectangle (plus optional `bleed`). All room
          floors are coplanar (no Y stagger → no lit edge); the per-room
          `depthRank` polygonOffset breaks z-fight ties cleanly. */}
      <mesh position={[cx, yBase + 0.025, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[fW, fD]} />
        <meshStandardMaterial
          color={floorColor}
          roughness={insideBuilding ? 0.42 : 0.70}
          metalness={insideBuilding ? 0.06 : 0.03}
          envMapIntensity={insideBuilding ? 0.55 : 0.2}
          side={THREE.FrontSide}
          polygonOffset
          // 相邻房间的楼板是共面的，且因房间矩形在开放边界（客厅↔走廊）
          // 互相重叠 ~0.4m，仅靠 0.5 单位的偏移差在掠射角/远距离下不足以
          // 决定深度排序 → 闪烁出"虚影"撕裂带。把 factor 与 units 都按房间
          // 序号成倍拉开（≈3 单位/房间 + 斜率项），让某一块楼板在重叠区
          // 始终确定性获胜，彻底消除 z-fight。
          polygonOffsetFactor={-1 - depthRank * 0.6}
          polygonOffsetUnits={-2 - depthRank * 3}
          map={map ?? undefined}
        />
      </mesh>
    </>
  );
}

// ─── Walkthrough wall piece. Drop-in mesh for one rectangle inside a
// dedup'd wallSegment. Uses paintAlbedo + paintNormal for the painted
// look that matches the effect page, or a registered tile texture if
// the wall has a material id set. ─────────────────────────────────────
function WalkthroughWallPiece({
  position, w, h, thickness, pieceX, pieceY,
  wallColor, wallId, insideBuilding, wallXray,
  glassFacade = false, glassFacadeColor,
}: {
  position: [number, number, number]; w: number; h: number; thickness: number;
  /** Position of this piece's bottom-left corner within the parent wall
   *  (wall-local metres). Used to compute texture OFFSET so the paint
   *  pattern is continuous across piece boundaries — without this, each
   *  piece restarts its tiling from 0 and the wall looks like a quilt of
   *  rectangular patches. */
  pieceX: number; pieceY: number;
  wallColor: string; wallId: string; insideBuilding: boolean; wallXray: boolean;
  /** Whole-building glass curtain-wall mode. When true (exterior view only),
   *  the shell wall renders as reflective glass spandrel so faces NOT covered
   *  by a GlassCurtain overlay panel still read as glass — keeping the whole
   *  envelope a uniform glass tower instead of a glass/matte-concrete mix. */
  glassFacade?: boolean;
  glassFacadeColor?: string;
}) {
  // Texture density: tiles per metre. Same for ALL pieces of all walls so
  // the noise grain is consistent. With offset applied per piece, adjacent
  // pieces appear continuous.
  const TILES_PER_M = 3;
  const NORMAL_TILES_PER_M = 4;
  const tiled = useMemo(() => {
    const base = getWallTexture(wallId);
    if (!base) return null;
    const t = base.clone();
    const [us, vs] = wallTileSize(wallId);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / us, h / vs);
    t.offset.set(pieceX / us, pieceY / vs);
    t.needsUpdate = true;
    return t;
  }, [wallId, w, h, pieceX, pieceY]);
  const paint = useMemo(() => {
    if (tiled) return null;
    const t = paintAlbedo(wallColor).clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // Repeat across THIS piece = piece size × density.
    t.repeat.set(w * TILES_PER_M, h * TILES_PER_M);
    // Offset to start sampling where the parent wall sits in tile-space.
    // Same TILES_PER_M density everywhere → piece-to-piece continuity.
    t.offset.set(pieceX * TILES_PER_M, pieceY * TILES_PER_M);
    t.needsUpdate = true;
    return t;
  }, [wallColor, w, h, pieceX, pieceY, tiled]);
  const normalTex = useMemo(() => {
    if (tiled) return null;
    const t = paintNormal().clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w * NORMAL_TILES_PER_M, h * NORMAL_TILES_PER_M);
    t.offset.set(pieceX * NORMAL_TILES_PER_M, pieceY * NORMAL_TILES_PER_M);
    t.needsUpdate = true;
    return t;
  }, [tiled, w, h, pieceX, pieceY]);
  return (
    <mesh position={position} raycast={() => null} receiveShadow castShadow>
      <boxGeometry args={[w, h, thickness]} />
      {glassFacade && !wallXray ? (
        /* TRANSPARENT reflective curtain-wall glass — turns the shell wall into
           see-through tinted glass so the interior reads through it (the photo's
           glass-box look) while clearcoat + reflectivity keep the sheen. Opacity
           is moderate so it reads as glass, not a milky panel or a mirror. */
        <meshPhysicalMaterial
          color={glassFacadeColor ?? "#7E97AC"}
          transparent
          opacity={0.24}
          roughness={0.05}
          metalness={0.0}
          clearcoat={1.0}
          clearcoatRoughness={0.05}
          reflectivity={0.85}
          envMapIntensity={2.4}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      ) : (
        <meshStandardMaterial
          color={wallColor}
          roughness={0.88}
          metalness={0}
          /* No emissive — RoomShell's wallMatFor doesn't use it either. The
             previous 0.18 emissive washed out the paint-albedo texture so
             walls looked like flat plastic. Insufficient ambient light in
             walkthrough is solved at the scene level (hemisphereLight). */
          transparent={wallXray}
          opacity={wallXray ? 0.13 : 1.0}
          depthWrite={!wallXray}
          map={tiled ?? paint ?? undefined}
          normalMap={!tiled ? normalTex ?? undefined : undefined}
          normalScale={!tiled && normalTex ? new THREE.Vector2(0.12, 0.12) : undefined}
        />
      )}
    </mesh>
  );
}

// ── 主组件 ────────────────────────────────────────────────────
export default function FloorPlanBuilding({
  insideBuilding = false, wallXray = false, hideInterior = false,
  onEnterRoom,
  floorPlansOverride, exteriorOverride,
  worldX = 0, worldZ = 0, worldRot = 0, interactive = true,
}: {
  insideBuilding?: boolean;
  wallXray?: boolean;
  /** Hide interior room contents (furniture/walls) during orbit drag to reduce
   *  Three.js scene traversal cost (~120ms JS saved per frame). */
  hideInterior?: boolean;
  /** When provided, clicking a room block / window enters first-person
   *  walkthrough mode at that room's center (handled by HouseCanvas
   *  parent), instead of switching to the single-room 3D view. */
  onEnterRoom?: (room: RoomType, floorIndex: number, worldPos: [number, number, number]) => void;
  /** 多楼栋：渲染「非激活楼栋」时传入该楼的 floorPlans/exterior + 在地块里的
   *  位置(worldX/Z 米)与旋转(worldRot 弧度)。缺省 = 激活楼栋，读 store 全局、
   *  置于原点，与单楼栋行为完全一致。interactive=false 时禁用点击进房(副楼只看)。 */
  floorPlansOverride?: import("@/lib/types").FloorPlan[];
  exteriorOverride?: import("@/lib/types").ExteriorSettings;
  worldX?: number;
  worldZ?: number;
  worldRot?: number;
  interactive?: boolean;
}) {
  const storeFloorPlans = useDesignerStore(s => s.floorPlans);
  const storeExterior   = useDesignerStore(s => s.exterior);
  const floorPlans     = floorPlansOverride ?? storeFloorPlans;
  const exterior       = exteriorOverride ?? storeExterior;
  const showCompass    = useDesignerStore(s => s.showCompass);
  const floorCount     = Math.max(exterior.floors, 1);
  const setActiveRoom  = useDesignerStore(s => s.setActiveRoom);
  const setViewMode    = useDesignerStore(s => s.setViewMode);
  const setActiveFloor = useDesignerStore(s => s.setActiveFloor);
  const sunHour        = useDesignerStore(s => s.sunHour);

  // ── Walkthrough door/window open-close state ──────────────────────────
  // Map<key, open>. Key format: `door|${fi}|${room}|${di}` /
  // `window|${fi}|${room}|${wi}`. Only the keys actually toggled live in
  // the map; missing key = closed. Reset whenever walkthrough exits so a
  // re-entry starts from a clean state.
  const [openMap, setOpenMap] = useState<Map<string, boolean>>(new Map());
  const toggleOpen = useCallback((key: string) => {
    setOpenMap(prev => {
      const next = new Map(prev);
      next.set(key, !next.get(key));
      return next;
    });
  }, []);
  useEffect(() => {
    if (!insideBuilding) setOpenMap(new Map());
  }, [insideBuilding]);

  // ── Interior emissive intensity driven by time-of-day ──────────────────
  // Night/late evening → rooms glow warm from within (high emissive).
  // Full day → ZERO emissive so the interior behind windows reads as a
  // dark shaded space — exactly how a real interior looks through a
  // window on a sunny day. The previous daytime value of 1.15 made the
  // interior backing self-illuminate (amber emissive ≈ 1.0 intensity),
  // which the user perceived as "light leaking through the walls"
  // because the warm glow stamped halos around every window. Dawn/dusk
  // also brought down — the strong amber there was the "golden hour"
  // tint, only realistic when sky is already dim.
  // Default window dimensions (cm) — applied to any WindowConfig that
  // doesn't specify its own sill/h. Lets users dial up floor-to-ceiling
  // glazing (sill=0) or short kitchen strip windows globally.
  const defWinSill = Math.max(0, Math.min(200, exterior.defaultWindowSill ?? 90));
  const defWinH    = Math.max(60, Math.min(280, exterior.defaultWindowHeight ?? 150));

  const interiorGlowWall: number = sunHour < 6 || sunHour > 20
    ? 2.10   // night — strong warm interior glow visible through clear glass
    : sunHour < 8 || sunHour > 18
    ? 0.55   // dawn/dusk — subtle warm amber, not stamping halos
    : 0.0;   // day — no glow; interior reads as dark shade through windows
  const interiorGlowCeil: number = sunHour < 6 || sunHour > 20
    ? 1.10   // night ceiling — warm downlight wash
    : sunHour < 8 || sunHour > 18
    ? 0.40   // dawn/dusk ceiling
    : 0.0;   // day ceiling — no self-emit

  /** Click door/window on exterior →
   *  - if onEnterRoom prop given: walkthrough mode at this room's centre
   *  - else: legacy behaviour (switch to single-room RoomCanvas view) */
  const enterRoom = useCallback((room: RoomType, floorIndex: number) => {
    // 副楼(interactive=false)：点击不进房/不改激活房间——它的 floorPlans 是 override
    // 而非 store 激活楼栋，若改 activeRoom/activeFloor 会错乱到激活楼栋。要进副楼
    // 应先在 整体布局/院子图 切换 activeBuilding。
    if (!interactive) return;
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
        const cz = (lay.y + dims.depth / 2 - minY) * CM - D / 2;
        const cy = floorIndex * FLOOR_H + 1.6;   // eye height
        onEnterRoom(room, floorIndex, [cx, cy, cz]);
        return;
      }
    }
    setViewMode("3d");
  }, [setActiveFloor, setActiveRoom, setViewMode, onEnterRoom, floorPlans, interactive]);

  /** Track which block is hovered for tooltip */
  const [hoveredRoom, setHoveredRoom] = useState<{ room: RoomType; fi: number } | null>(null);

  // ── 房间聚类：找出不相连的房间分组（如车库与主楼分离）───────────────
  // 用 union-find 把平面上重叠/相邻的房间归为一组；最大组 = 主楼，
  // 其余 = 独立附属建筑（各自独立盖顶，不再强行一块大顶盖全场）。
  type RoomRect = { room: string; x: number; y: number; w: number; d: number };
  const roomClusters = useMemo(() => {
    const rects: RoomRect[] = [];
    const seen = new Set<string>();
    for (let fi = 0; fi < floorCount; fi++) {
      const fp = floorPlans[fi];
      if (!fp) continue;
      for (const r of (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor)) {
        if (seen.has(r)) continue;
        const p = fp.roomLayout?.[r]; const dm = fp.roomDimensions?.[r];
        if (!p || !dm) continue;
        seen.add(r);
        rects.push({ room: r, x: p.x, y: p.y, w: dm.width, d: dm.depth });
      }
    }
    if (rects.length === 0) return { main: [] as RoomRect[], detached: [] as RoomRect[][] };
    const par = rects.map((_, i) => i);
    const find = (i: number): number => par[i] === i ? i : (par[i] = find(par[i]));
    const union = (a: number, b: number) => { par[find(a)] = find(b); };
    const TOL = 5;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.x - TOL < b.x + b.w && a.x + a.w + TOL > b.x &&
            a.y - TOL < b.y + b.d && a.y + a.d + TOL > b.y) {
          union(i, j);
        }
      }
    }
    const groups = new Map<number, RoomRect[]>();
    for (let i = 0; i < rects.length; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(rects[i]);
    }
    const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
    return { main: sorted[0], detached: sorted.slice(1) };
  }, [floorPlans, floorCount]);

  // 全局包围盒（所有楼层取并集）— 坐标原点，涵盖所有房间
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

  // 主楼屋顶范围（仅主聚类，不含车库等独立建筑）
  const mainRoofBounds = useMemo(() => {
    const rects = roomClusters.main;
    if (rects.length === 0) return null;
    let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
    for (const r of rects) {
      mnX = Math.min(mnX, r.x); mnY = Math.min(mnY, r.y);
      mxX = Math.max(mxX, r.x + r.w); mxY = Math.max(mxY, r.y + r.d);
    }
    const w = (mxX - mnX) * CM;
    const d = (mxY - mnY) * CM;
    const cx = ((mnX + mxX) / 2 - planOffset.minX) * CM - planOffset.W / 2;
    const cz = ((mnY + mxY) / 2 - planOffset.minY) * CM - planOffset.D / 2;
    return { w, d, cx, cz };
  }, [roomClusters, planOffset]);

  const { W, D } = planOffset;
  const wallColor  = exterior.wallColor ?? "#F0EDE6";
  const buildingType = (exterior as any).buildingType ?? "";
  // The 'glass curtain wall' concept is deprecated — per user request,
  // glass facades are now just regular walls with large windows. We keep
  // the variable so the existing conditional branches still compile, but
  // hard-wire it to false so every `!insideBuilding && isGlassVilla`
  // special path becomes dead code. (Removing the branches outright is a
  // 40+ site refactor with high regression surface; gating them is
  // strictly safer and leaves a clean revert path.)
  void buildingType;
  const isGlassVilla = false;

  // ── Unified facade engine selector ("hidden-frame curtain wall") ──────────
  // `facadeSystem` is the authoritative dial; the legacy `facadeGlass` boolean
  // is kept only as a back-compat alias (facadeGlass:true ⇒ curtain-wall).
  // When curtainWall is on we render a black-aluminium mullion grid + vision
  // glass AT the wall plane, with WHITE concrete slab bands at each floor line
  // (expressed-slab "hidden frame" look), per the reference villa.
  const curtainWall =
    exterior.facadeSystem === "curtain-wall" ||
    (exterior.facadeSystem == null && (exterior.facadeGlass ?? false));
  // White concrete slab-band spandrel for the hidden-frame look (overridable).
  const slabBandColor = exterior.glassSpandrelColor ?? "#EDEAE3";

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
        minZ: (bMinY - planOffset.minY) * CM - D / 2,
        maxZ: (bMaxY - planOffset.minY) * CM - D / 2,
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
  ): Record<"N" | "S" | "W" | "E", number> {
    // N = -Z (back, SVG top), S = +Z (front, SVG bottom).
    // W = -X (left), E = +X (right).
    return {
      N: (cz - rD / 2) - bounds.minZ,
      S: bounds.maxZ   - (cz + rD / 2),
      W: (cx - rW / 2) - bounds.minX,
      E: bounds.maxX   - (cx + rW / 2),
    };
  }

  function pickAutoDoor(
    fi: number, room: RoomType,
    cx: number, cz: number, rW: number, rD: number, rWcm: number, rDcm: number,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  ): DoorConfig {
    const d = calcWallDists(cx, cz, rW, rD, bounds);
    const EPS = 0.25; // metres: wall is "on exterior" if distance < this

    // 一楼客厅大门：传统正门朝南（S, +Z）。
    // 优先级：S → N → W → E，只要这面墙是外墙（距离 < EPS）。
    // 没有任何外墙时，回退到"最接近外边界"（升序最小距离）。
    // 这样可以避免浮点并列导致门钉到侧墙。
    if ((exterior.livingEntryDoor ?? true) && fi === 0 && room === "living") {
      const wallsByPriority: DoorConfig["wall"][] = ["S", "N", "W", "E"];
      const pickFrontFirst = wallsByPriority.find(w => d[w] < EPS);
      const wall: DoorConfig["wall"] = pickFrontFirst ?? (() => {
        const all: [DoorConfig["wall"], number][] = [
          ["N", d.N], ["S", d.S], ["W", d.W], ["E", d.E],
        ];
        all.sort((a, b) => a[1] - b[1]);
        return all[0][0];
      })();
      const wallLenCm = (wall === "W" || wall === "E") ? rDcm : rWcm;
      const pos = Math.max(0, (wallLenCm - AUTO_DOOR_W) / 2);
      // eslint-disable-next-line no-console
      console.log(
        `[pickAutoDoor:living] picked=${wall} pos=${pos.toFixed(0)}cm`
        + ` | dists: N=${d.N.toFixed(2)} S=${d.S.toFixed(2)} W=${d.W.toFixed(2)} E=${d.E.toFixed(2)}`
        + ` | bounds: x=[${bounds.minX.toFixed(2)},${bounds.maxX.toFixed(2)}] z=[${bounds.minZ.toFixed(2)},${bounds.maxZ.toFixed(2)}]`
        + ` | room: cx=${cx.toFixed(2)} cz=${cz.toFixed(2)} rW=${rW.toFixed(2)} rD=${rD.toFixed(2)}`
      );
      return { id: `auto-${fi}-${room}-${wall}`, wall, pos, len: AUTO_DOOR_W, h: 200 };
    }

    // 车库：选最近的外墙作为车库门（S→W→N→E 优先），门宽取房间宽度减 20cm
    // 最小 220cm，确保能在外立面渲染卷帘车库门板。
    if (room === "garage") {
      const exteriorOrder: DoorConfig["wall"][] = ["S", "W", "N", "E"];
      const picked = exteriorOrder.find(w => d[w] < EPS) ?? "S";
      const wallLenCm = (picked === "W" || picked === "E") ? rDcm : rWcm;
      const gdW = Math.max(220, Math.min(wallLenCm - 20, 300));
      const pos = Math.max(0, (wallLenCm - gdW) / 2);
      return { id: `auto-garage-${fi}-${picked}`, wall: picked, pos, len: gdW, h: 210 };
    }

    // 其他房间：走廊侧门
    // 优先 Z 轴方向（N/S）的内墙 — 水平走廊布局中这两面墙朝向走廊
    // 若 Z 轴两面墙都是外墙，则回退到 X 轴内墙
    const yWalls: [DoorConfig["wall"], number, number][] = (
      [["N", d.N, Math.max(0, (rWcm - AUTO_DOOR_W) / 2)],
       ["S", d.S, Math.max(0, (rWcm - AUTO_DOOR_W) / 2)]] as [DoorConfig["wall"], number, number][]
    ).filter(([, dist]) => (dist as number) >= EPS);

    const xWalls: [DoorConfig["wall"], number, number][] = (
      [["W", d.W, Math.max(0, (rDcm - AUTO_DOOR_W) / 2)],
       ["E", d.E, Math.max(0, (rDcm - AUTO_DOOR_W) / 2)]] as [DoorConfig["wall"], number, number][]
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
      ["N", d.N, Math.max(0, (rWcm - AUTO_DOOR_W) / 2)],
      ["S", d.S, Math.max(0, (rWcm - AUTO_DOOR_W) / 2)],
      ["W", d.W, Math.max(0, (rDcm - AUTO_DOOR_W) / 2)],
      ["E", d.E, Math.max(0, (rDcm - AUTO_DOOR_W) / 2)],
    ];
    all.sort((a, b) => a[1] - b[1]);
    const [wall, , pos] = all[0];
    return { id: `auto-${fi}-${room}-${wall}`, wall, pos, len: AUTO_DOOR_W, h: 200 };
  }

  function adjustWindowWall(
    win: WindowConfig,
    cx: number, cz: number, rW: number, rD: number, rWcm: number, rDcm: number,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    doorWall?: DoorConfig["wall"],
    // True if `side` is a genuine exterior wall of this room (no neighbour covering
    // it). Preferred over bounding-box distance: a detached/offset room (e.g. an
    // offset garage) has exterior walls that are FAR from the building's bbox edge,
    // so the distance test wrongly relocates its windows (用户:车库窗户位置不对).
    isExtWall?: (side: WindowConfig["wall"]) => boolean,
  ): WindowConfig {
    const d = calcWallDists(cx, cz, rW, rD, bounds);
    const onExterior = (side: WindowConfig["wall"]): boolean =>
      isExtWall ? isExtWall(side) : ((d[side as keyof typeof d] ?? Infinity) < WIN_EPS);

    // If configured wall is on the exterior and not the door wall,
    // keep it there — only clamp the position within the wall to avoid overflow.
    if (onExterior(win.wall) && win.wall !== doorWall) {
      const wallLen = (win.wall === "W" || win.wall === "E") ? rDcm : rWcm;
      const safePos = Math.max(5, Math.min(win.pos ?? 0, wallLen - (win.len ?? 80) - 5));
      return { ...win, pos: safePos, len: Math.min(win.len, Math.round(wallLen * 0.70)) };
    }

    // Configured wall is interior or is the door wall — pick best exterior wall.
    // Genuine exterior walls (isExtWall) rank first, then by bbox distance.
    const ranked = (["N", "S", "W", "E"] as const)
      .map(w => ({ w, dist: d[w] ?? Infinity, ext: onExterior(w) }))
      .sort((a, b) => (a.ext === b.ext ? a.dist - b.dist : (a.ext ? -1 : 1)));

    const target = ranked.find(({ w, ext }) => ext && w !== doorWall)
      ?? ranked.find(({ w }) => w !== doorWall)
      ?? ranked[0];

    const extWall = target.w;
    const wallLen = (extWall === "W" || extWall === "E") ? rDcm : rWcm;
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
        const p = fp.roomLayout?.[r]; const dd = fp.roomDimensions?.[r];
        if (!p || !dd) continue;
        // 循环空间(楼梯/走廊)不自动生成门(与 interiorRooms 一致)——但仍需把它们配置的
        // 窗户纳入 mergedWindows,否则 computeExteriorWalls 拿不到这些窗 → 幕墙不抠窗洞
        // (用户:楼梯间的窗户没开窗洞)。
        const isCirc = r === "stair" || r === "hallway";
        const rW = dd.width * CM; const rD = dd.depth * CM;
        const cx = (p.x + dd.width  / 2 - planOffset.minX) * CM - W / 2;
        const cz = (p.y + dd.depth / 2 - planOffset.minY) * CM - D / 2;

        // 门优先级（与 2D 平面图 / 室内漫游 HouseCanvas 一致）：
        //   roomDoors 显式数组 > roomDoorWall/Pos/Len 单门配置 > pickAutoDoor 自动门。
        // 原来只认 roomDoors + pickAutoDoor，漏了平面图实际用的 roomDoorWall/Pos →
        // 配在内墙(如厨房 S 朝走廊)的门外观图里根本不画(用户:门洞都没有、门也没有)。
        const configuredDoors = fp.roomDoors?.[r] ?? [];
        if (configuredDoors.length > 0) {
          mergedDoors[r] = configuredDoors.map(d => widenGarageDoor(r, d, dd.width, dd.depth));
        } else if (bounds && !isCirc && fp.roomHasDoor?.[r] !== false) {
          const lw = fp.roomDoorWall?.[r];
          if (lw) {
            const wallLenCm = (lw === "W" || lw === "E") ? dd.depth : dd.width;
            const dl = fp.roomDoorLen?.[r] ?? defaultDoorLenCm(r, wallLenCm);
            mergedDoors[r] = [{ id: `cfg-${fi}-${r}`, wall: lw, pos: fp.roomDoorPos?.[r] ?? Math.max(5, (wallLenCm - dl) / 2), len: dl, h: fp.roomDoorH?.[r] ?? defaultDoorHCm(r) }];
          } else {
            mergedDoors[r] = [pickAutoDoor(fi, r, cx, cz, rW, rD, dd.width, dd.depth, bounds)];
          }
        }

        // 窗：修正到外墙，且不与门在同一面墙
        const wins = fp.roomWindows?.[r] ?? [];
        const doorWall0 = mergedDoors[r]?.[0]?.wall;
        if (wins.length > 0 && bounds) {
          const isExtWall = (side: WindowConfig["wall"]) => isExteriorWallSide(fp, r, side);
          mergedWindows[r] = wins.map(w => adjustWindowWall(w, cx, cz, rW, rD, dd.width, dd.depth, bounds, doorWall0, isExtWall));
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

  // ── 天台层并入通用房间渲染 ─────────────────────────────────────────────
  // 天台(floorPlans[floorCount]) 就是一个「普通楼层」，只是它的房间通过
  // roomWallsHidden 把露天的面隐掉：楼梯出屋面间(stair)保留四面墙+顶板+门，
  // 休闲区(rooftop_lounge)四面墙/地板/顶板全隐 → 露天甲板。它不进入建筑高度
  // 推导(usedFloors/totalH 仍只数封闭楼层)，楼层基面落在 FlatRoof 屋面板顶面。
  const roofFi      = exterior.hasRooftop ? floorCount : -1;        // 天台层在 floorPlans 中的下标
  const roomLoopMax = roofFi >= 0 ? roofFi + 1 : floorCount;        // 房间/墙体循环上界（含天台层）
  // FlatRoof 屋面板顶面 = roofY(totalH) + 0.05(板中心偏移) + ST/2。默认板厚
  // 10cm → 顶面 = totalH + 0.10。天台房间的墙/顶/地都以此为基面坐落在甲板上。
  const roofDeckY   = totalH + 0.05 + (exterior.roofSlabThicknessCm ?? 10) / 100 / 2;
  const yBaseOf     = (fi: number) => (fi === roofFi ? roofDeckY : fi * (FLOOR_H + SLAB_T));

  // 立面段：为每段解析「三层 facade」可见性(实墙/玻璃幕墙/框架)+ 该面玻璃透明度。
  // 三层各自 tri-state：显式 override(roomFacadeFaces) > 旧 roomWallsHidden(仅实墙)
  // > 全局模式默认(幕墙模式: 墙隐/玻璃显/框显；普通模式: 墙显/玻璃隐/框隐)。
  // 三层全隐 → 该面完全开敞 → 不进入立面块。其余带 fl 进入 buildFacadeBlocks，
  // 合并时按 fl 签名分组(见 buildFacadeBlocks)，从而保住逐面粒度。
  // usedFloors/totalH 仍用全量 allSegs 推楼层高度(隐藏某面不应改变楼高)。
  const layeredSegs = useMemo(
    () => allSegs.map(s => {
      const fp = floorPlans[s.floorIndex];
      const wall  = resolveFacadeLayer(fp, s.room, s.side, "wall",  curtainWall);
      const glass = resolveFacadeLayer(fp, s.room, s.side, "glass", curtainWall);
      const frame = resolveFacadeLayer(fp, s.room, s.side, "frame", curtainWall);
      // 透明度 0..1 (1 = clear). Default 0.85 ≈ current see-through look.
      const opacity = resolveFaceOpacity(fp, s.room, s.side, DEFAULT_GLASS_TRANSPARENCY);
      return { ...s, fl: { wall, glass, frame, opacity } };
    }).filter(s => s.fl.wall || s.fl.glass || s.fl.frame),
    [allSegs, floorPlans, curtainWall],
  );
  // 把相邻共面段合并 → 玻璃幕墙不再出现双框缝
  const facadeBlocks = useMemo(() => buildFacadeBlocks(layeredSegs), [layeredSegs]);

  // 幕墙玻璃门「吸附到竖挺分格」：可开关的门(WalkthroughDoor3D)在按房间的循环里
  // 渲染(房间局部坐标),而幕墙竖挺网格在按立面块渲染(立面块坐标)——两套坐标系。
  // 用户要门「借助幕墙的两根竖挺当门框」(圈红两根 mullion),所以门必须正好填满它
  // 所在的那一格(GlassCurtain 已在该格抠掉视觉玻璃),门左右边贴住分格两侧的竖挺。
  // 这里在立面块坐标里算出每道一层幕墙门所在的分格(中心+宽),再换算回房间局部的
  // 门 pos/len,键 = `${fi}:${room}:${wall}:${round(pos)}`,供下方房间循环消费。
  const curtainOpeningSnap = useMemo(() => {
    const m = new Map<string, { posCm: number; lenCm: number }>();
    if (!curtainWall) return m;
    const ex = exterior as { curtainMullionBay?: number; curtainStructFrameWidth?: number; curtainMullionWidth?: number };
    const bay = ex.curtainMullionBay ?? 1.5;
    const structW = Math.max(0.05, ex.curtainStructFrameWidth ?? 0.085);
    const mullW = Math.max(0.03, ex.curtainMullionWidth ?? 0.07);
    for (const block of facadeBlocks) {
      const segLen = (block.mergedEnd - block.mergedStart) * CM;   // 立面块宽(米)
      if (segLen <= 0) continue;
      const flipX = block.side === "S" || block.side === "E";
      // 立面局部洞口列表 —— 必须与传给 GlassCurtain 的 doors/windows 完全同序同坐标,
      // 这样吸附用的 buildCurtainLayout 与外观图渲染用的 layout 必然一致。
      const ops: Array<{ cx: number; w: number; key: string; kind: "d" | "w"; room: RoomType; wall: string; pos: number; roomWallStart: number }> = [];
      if (block.floorIndex === 0) {
        block.doorEntries.forEach(({ roomWallStart, d, room }, i) => {
          const dPos = d.pos ?? 0, dLen = d.len;
          const rawX = (roomWallStart + dPos + dLen / 2 - block.mergedStart) * CM - segLen / 2;
          const flipped = flipX ? -rawX : rawX;
          const dLenM = dLen * CM;
          // 与 doorInfos 同样夹紧到段内。
          const cx = Math.max(-segLen / 2 + dLenM / 2, Math.min(segLen / 2 - dLenM / 2, flipped));
          ops.push({ cx, w: dLenM, key: `d${i}`, kind: "d", room, wall: d.wall, pos: dPos, roomWallStart });
        });
      }
      block.winEntries.forEach(({ roomWallStart, w, room }, i) => {
        const wPos = w.pos ?? 0;
        const rawX = (roomWallStart + wPos + w.len / 2 - block.mergedStart) * CM - segLen / 2;
        const cx = flipX ? -rawX : rawX;
        ops.push({ cx, w: w.len * CM, key: `w${i}`, kind: "w", room, wall: w.wall, pos: wPos, roomWallStart });
      });
      if (!ops.length) continue;
      const layout = buildCurtainLayout(segLen, ops.map(o => ({ cx: o.cx, w: o.w, key: o.key, kind: o.kind })), { bay, structW, mullionW: mullW, gridOriginM: block.mergedStart * CM, flip: flipX });
      for (const o of ops) {
        const baySpan = layout.openingBay.get(o.key);
        if (!baySpan) continue;
        const bayCenter = (baySpan.x0 + baySpan.x1) / 2;
        // openingBay 现在直接返回平面图实际区间(buildCurtainLayout 已改为硬边对齐),
        // 所以 lenCm/posCm 直接用实际宽度换算即可,不再需要 bayInner/fillW 收缩。
        const worldFlip = block.side === "S" || block.side === "W";
        const rawTarget = worldFlip ? -bayCenter : bayCenter;
        const lenCm = o.w / CM;                                         // 平面图实际宽度
        const posCm = (rawTarget + segLen / 2) / CM - o.roomWallStart - lenCm / 2 + block.mergedStart;
        m.set(`${o.kind}:${block.floorIndex}:${o.room}:${o.wall}:${Math.round(o.pos)}`, { posCm, lenCm });
      }
    }
    return m;
  }, [facadeBlocks, curtainWall, exterior]);

  // 幕墙竖挺「跨块去重」：同一面上多个相邻立面块,各自在交界处都有一根承重端挺,
  // 两块的端挺挤在一起(贴合 → 双挺;有小凹口 → 0.4m 碎缝)= 用户反复指的「粗接缝/碎格」。
  // 这里按「面」分组,沿墙轴排序,凡相邻两块间距 < 0.6m,就抑制后一块的「轴起点」端挺
  // (保留前一块的端挺),交界处只剩一根挺。结果按块 index 给出「左/右端挺是否抑制」。
  const curtainEndSuppress = useMemo(() => {
    const res = facadeBlocks.map(() => ({ left: false, right: false }));
    if (!curtainWall) return res;
    const faces = new Map<string, number[]>();
    facadeBlocks.forEach((b, bi) => {
      const k = `${b.floorIndex}|${b.side}|${Math.round(b.wallCoord)}`;
      if (!faces.has(k)) faces.set(k, []);
      faces.get(k)!.push(bi);
    });
    for (const bis of faces.values()) {
      bis.sort((a, b) => facadeBlocks[a].mergedStart - facadeBlocks[b].mergedStart);
      for (let i = 1; i < bis.length; i++) {
        const A = facadeBlocks[bis[i - 1]], B = facadeBlocks[bis[i]];
        const gap = (B.mergedStart - A.mergedEnd) * CM;   // 沿墙轴两块间距(米)
        // 只合并「几乎重合」的双挺(两块贴合 → 端挺叠在一起)。有真实凹口(0.1~0.6m)时
        // 两根挺各自框住凹口两侧,不能删 —— 否则那侧玻璃没边框,看起来「断开」。
        if (gap < 0.12) {
          const biB = bis[i];
          const flipB = B.side === "S" || B.side === "E";
          // 抑制 B 的「轴起点」端挺:flip 时它在 local +half(右),否则在 −half(左)。
          if (flipB) res[biB].right = true; else res[biB].left = true;
        }
      }
    }
    return res;
  }, [facadeBlocks, curtainWall]);

  // 幕墙模式：建筑外周「立面平面」集合（fi|轴|平面坐标）。用于在外观图里
  // 抑制与玻璃幕墙重合的那道不透明外墙壳——否则白墙背衬玻璃 → 玻璃发白不透。
  // 平面 key 与 wallSegments 的 `${fi}|${axis}|round(fixed)` 同源对齐：
  // facadeBlock.wallCoord(N=roomY / S=roomY+roomD / W=roomX / E=roomX+roomW)
  // 恒等于对应外墙 seg.fixed，故同一道外墙必然命中同一 key。
  // 幕墙模式下要抑制的外墙壳平面：凡是「实墙(wall)层未显示」的外墙面——无论它
  // 被玻璃幕墙取代、还是完全开敞——都把那道不透明外墙壳抑制掉(否则白墙背衬玻璃
  // 发白、或开敞面仍堵着墙)。实墙显示的面(强制实墙)保留外墙壳带门窗洞。
  // 直接从 allSegs 解析，覆盖被 layeredSegs 过滤掉的全开敞面。
  const exteriorPlanes = useMemo(() => {
    const set = new Set<string>();
    for (const s of allSegs) {
      const wallShown = resolveFacadeLayer(floorPlans[s.floorIndex], s.room, s.side, "wall", curtainWall);
      if (wallShown) continue;
      const axis = s.side === "N" || s.side === "S" ? "h" : "v";
      const wc = s.side === "S" ? s.roomY + s.roomD
               : s.side === "N" ? s.roomY
               : s.side === "E" ? s.roomX + s.roomW
               :                  s.roomX;
      set.add(`${s.floorIndex}|${axis}|${Math.round(wc)}`);
    }
    return set;
  }, [allSegs, floorPlans, curtainWall]);

  // 哪些房间最终会被渲染成玻璃幕墙？复刻外墙渲染那段判玻璃的逻辑
  // （显式 override > auto-detected glass coverage > isGlassVilla 南面），
  // 然后把这些房间收集到 Set 里。下面"房间盒子 / 低 LOD 家具 / 背景填充板"
  // 都用这个 Set 做条件，自动判玻璃的房间也能得到暖色发光内饰，不必靠
  // 用户手动切到"玻璃幕墙"。
  // 'Glass-room' concept is deprecated for the legacy isGlassVilla path —
  // there, glass facades are just regular walls with windows, so the set
  // stays empty and every `glassRooms.has(...)` falls through to the
  // standard wall path.
  //
  // BUT in curtain-wall mode every room with an exterior face IS a glass
  // room: its envelope is the see-through GlassCurtain. We MUST mark those
  // rooms so the opaque per-floor 背景填充板 and the 实心房间盒子 (solid room
  // boxes) are skipped behind them — otherwise that grey backing sits right
  // behind the glass and the curtain reads milky/opaque ("玻璃不通透"). With
  // the boxes gone, the glass shows the real interior slabs/partitions
  // through it (and sky beyond open faces) — a true 通透 glass villa.
  // 一个房间只要有「实墙被隐藏」的外墙面(玻璃/框/完全开敞)，就标记为 glassRoom：
  // 跳过它身后的实心盒子 + 背景填充板，这样透过幕墙/开口能看到真实室内而非灰背衬。
  // 直接从 allSegs 解析(含被 layeredSegs 过滤掉的「全开敞」面)，覆盖更全。
  const glassRooms = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    // 仅幕墙模式才有「玻璃房间」。普通立面(punched-window)下，floor-plan 里隐藏的
    // 外墙(roomWallsHidden，如默认方案的 living.N / hallway / stair)只是「开/缺墙」，
    // 不是玻璃；若误判为 glassRoom 会跳过实心盒子和门板 → 门变空洞、家具裸露
    // (用户反馈「门和家具不正常」)。所以非幕墙模式直接返回空集。
    if (!curtainWall) return set;
    for (const s of allSegs) {
      const wallShown = resolveFacadeLayer(floorPlans[s.floorIndex], s.room, s.side, "wall", curtainWall);
      if (!wallShown) set.add(`${s.floorIndex}:${s.room}`);
    }
    return set;
  }, [allSegs, floorPlans, curtainWall]);

  // 有「外墙开洞」(窗 / 门) 的房间集合（fi:room）。punched-window 模式下，
  // 这些房间在外观图里跳过实心房间盒子 + 背景填充板 —— 否则洞口后面是不透明
  // 盒子，开窗/开门也只看到灰背衬。盒子去掉后，洞后是真实内墙 + 家具（都在
  // <group visible> 里渲染），配合通透窗玻璃即可「透过门洞/窗洞看到里面」。
  // 实体外墙(wallSegments)仍带洞渲染，墙的实心部分照样挡视线，只有洞口透视。
  const openingRooms = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    for (const b of facadeBlocks) {
      for (const e of b.winEntries)  set.add(`${b.floorIndex}:${e.room}`);
      for (const e of b.doorEntries) set.add(`${b.floorIndex}:${e.room}`);
    }
    return set;
  }, [facadeBlocks]);

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
      wallsHidden?: Partial<Record<string, boolean>>;
      floorHidden: boolean;
      ceilingHidden: boolean;
    }> = [];

    for (let fi = 0; fi < roomLoopMax; fi++) {
      const fp = floorPlans[fi];
      if (!fp) continue;
      for (const room of (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r]?.isOutdoor) as RoomType[]) {
        const p = fp.roomLayout?.[room]; const d = fp.roomDimensions?.[room];
        if (!p || !d) continue;
        const rW = d.width * CM; const rD = d.depth * CM;
        const rWcm = d.width; const rDcm = d.depth;
        const cx = (p.x + d.width  / 2 - planOffset.minX) * CM - W / 2;
        const cz = (p.y + d.depth / 2 - planOffset.minY) * CM - D / 2;
        const yBase = fi === roofFi ? roofDeckY : fi * (FLOOR_H + SLAB_T);
        const mats = fp.rooms?.[room]?.materials;
        const floorColor = mats?.floor?.color ?? ROOM_DEFS[room]?.defaultFloorColor ?? "#C8A882";
        const wallColor  = mats?.wall?.color  ?? ROOM_DEFS[room]?.defaultWallColor  ?? "#EDE8E0";
        const placedItems = fp.rooms?.[room]?.placedItems ?? [];
        const doors = fp.roomDoors?.[room] ?? [];
        const windows = fp.roomWindows?.[room] ?? [];
        const isStair = room === "stair";
        const isHallway = room === "hallway";
        const bounds = floorBoundsArr[fi];

        // 自动门：优先级与 wallSegments/allSegs 完全一致：
        //   roomDoorWall/Pos/Len 单门配置 > pickAutoDoor 自动门。
        // 不同步会导致 wallSegment 的门洞位置与 WalkthroughDoor3D 渲染位置错位
        // (用户：门洞和门没对应)。
        const autoDoor: DoorConfig | null = (() => {
          if (isStair || isHallway || doors.length > 0 || !bounds) return null;
          const lw = fp.roomDoorWall?.[room];
          if (lw) {
            const wallLenCm = (lw === "W" || lw === "E") ? d.depth : d.width;
            const dl = fp.roomDoorLen?.[room] ?? defaultDoorLenCm(room, wallLenCm);
            return { id: `cfg-${fi}-${room}`, wall: lw as import("@/lib/types").WallSide,
              pos: fp.roomDoorPos?.[room] ?? Math.max(5, (wallLenCm - dl) / 2), len: dl, h: fp.roomDoorH?.[room] ?? defaultDoorHCm(room) };
          }
          return pickAutoDoor(fi, room, cx, cz, rW, rD, rWcm, rDcm, bounds);
        })();

        // 窗户方向修正：强制到不同于门的外墙，彻底避免门窗同墙重叠
        const doorWallForRoom = autoDoor?.wall ?? doors[0]?.wall;
        const isExtWallR = (side: WindowConfig["wall"]) => isExteriorWallSide(fp, room, side);
        const adjustedWindows = (bounds && windows.length > 0)
          ? windows.map(w => adjustWindowWall(w, cx, cz, rW, rD, rWcm, rDcm, bounds, doorWallForRoom, isExtWallR))
          : windows;

        const wallsHidden = fp.roomWallsHidden?.[room];
        // 地板/天花板显隐复用 roomWallsHidden 的「单面显隐」机制，只是把可隐藏
        // 的面从 4 面墙扩到 floor / ceiling 两个键 —— 楼梯间从此和任何普通房间
        // 同权，渲染器不再特判 isStair。下面两行仅是「行为不变的默认值」：
        // 只有楼梯间需要上下贯通的竖直开口 —— 上层楼梯间默认不铺地板、楼梯间
        // 默认无天花板（让楼梯穿层而上）。走廊是普通房间，默认有天花板（否则
        // 从上层/天台往下看会穿透走廊）。房间显式给出的 floor / ceiling 值一律优先。
        const floorHidden = wallsHidden?.floor
          ?? (isStair && fi > 0 && !(exterior.stairFloorSlab ?? false));
        // 楼梯间默认无天花板 —— 让楼梯穿层而上；但「顶层楼梯间」（楼上没
        // 有更高楼层，比如天台出屋面间）上方根本没东西可穿，是否盖顶由
        // exterior.stairTopFloorCeiling 控制（default true = 盖顶挡雨）。
        // 中间层楼梯间默认无顶以贯通楼梯井；circulationDecor 打开后所有
        // 楼梯间都盖顶（调试通行空间装饰用）。
        const hasStairAbove = fi + 1 < roomLoopMax
          && (floorPlans[fi + 1]?.enabledRooms?.includes("stair") ?? false);
        const isTopStair  = isStair && !hasStairAbove;
        const topHasRoof  = exterior.stairTopFloorCeiling ?? true;
        // 天台（屋顶层）= 一个「没有顶的普通楼层」：其普通房间默认露天，盖顶与否
        // 由 exterior.rooftopCeiling 单一开关控制（default false = 不盖顶）。仍走
        // 通用 ceilingHidden，不特判天台房间类型；房间显式 ceiling 值优先。
        const isRooftopNormalRoom = fi === roofFi && !isStair;
        const ceilingHidden = wallsHidden?.ceiling
          ?? (isRooftopNormalRoom
              ? !(exterior.rooftopCeiling ?? false)
              : (isStair
                 && !(exterior.circulationDecor ?? false)
                 && !(isTopStair && topHasRoof)));
        result.push({ room, fi, cx, cz, yBase, rW, rD, rWcm, rDcm, floorColor, wallColor, placedItems, doors, windows: adjustedWindows, isStair, isHallway, autoDoor, wallsHidden, floorHidden, ceilingHidden });
      }
    }
    return result;
  }, [floorPlans, floorCount, roofFi, roofDeckY, roomLoopMax, floorBoundsArr, planOffset, W, D, exterior.stairFloorSlab, exterior.circulationDecor, exterior.stairTopFloorCeiling, exterior.rooftopCeiling]);

  // ── Wall graph: unique interior wall segments per floor ──
  // For each non-circulation room we list its 4 boundary lines in PLAN
  // coords; identical lines from two rooms (e.g. 厨房 west == 健身房 east)
  // collapse into a single segment carrying BOTH rooms' doors / windows /
  // hide flags. Each segment is rendered EXACTLY ONCE as a flat
  // ShapeGeometry plane sized to the segment, positioned on the boundary,
  // DoubleSide so both adjoining rooms see an opaque wall. Eliminates the
  // double-render that produced edge / fin artefacts the user reported.
  type WallHole = { x: number; y: number; w: number; h: number };
  type WallSeg = {
    fi: number;
    /** "h" = horizontal (constant plan-Y), "v" = vertical (constant plan-X). */
    axis: "h" | "v";
    /** Constant coordinate (plan-Y for horizontal, plan-X for vertical), cm. */
    fixed: number;
    /** Variable extent endpoints (plan-X for h, plan-Y for v), cm. */
    a: number;
    b: number;
    holes: WallHole[];      // wall-local cm, x along the wall, y from floor
    hideAny: boolean;       // hidden if ANY adjoining room marks this side hidden
    wallColor: string;
    wallId: string;         // material id (for getWallTexture); "" = paint
    /** 该面的「外墙材质」(wall{Side}Exterior ?? wallExterior) 颜色/贴图 id —
     *  仅外观图(!insideBuilding)用，优先于 wallBaseColor，让左面板「外墙材质」
     *  真正驱动外立面。未设外墙材质时为 undefined → 回落原行为（零回归）。 */
    extWallColor?: string;
    extWallId?: string;
    /** True when this segment's room has an explicit roomFacadeFaces wall=true override.
     *  When set, the exteriorPlanes suppression is skipped so mixed same-coordinate
     *  walls (e.g. garage=solid + bedroom=glass on the same N plane) render correctly. */
    wallOverridden?: boolean;
  };
  const wallSegments = useMemo<WallSeg[]>(() => {
    const map = new Map<string, WallSeg>();
    // Secondary index: (fi|axis|fixedRound) → existing segments.
    // Used to detect range overlaps: when room A's back wall [0..900] would
    // otherwise create a NEW solid segment on top of room B/C/D's front walls
    // at [0..280], [280..480], [480..900] (which have door holes), we instead
    // skip the already-covered sub-ranges and distribute holes into the
    // existing segments. Without this, the solid superset wall buries the
    // door holes, making doors invisible in the walkthrough.
    const fixedSegs = new Map<string, WallSeg[]>();
    const registerSeg = (seg: WallSeg, key: string) => {
      map.set(key, seg);
      const fk = `${seg.fi}|${seg.axis}|${Math.round(seg.fixed)}`;
      const list = fixedSegs.get(fk) ?? [];
      list.push(seg);
      fixedSegs.set(fk, list);
    };
    // Convert door/window-on-side into wall-local hole. Side label is the
    // DATA convention (back/front/left/right per fp.roomDoors). The hole's
    // "x" is along the wall starting from the wall's "left" endpoint in
    // plan coords:
    //   - horizontal walls (N/S): x grows with plan-X (left → right)
    //   - vertical walls   (W/E): x grows with plan-Y (top → bottom)
    // d.pos and w.pos already follow the same convention (see DoorSVG and
    // the door render at line ~10111).
    const addHole = (seg: WallSeg, holes: WallHole[]) => seg.holes.push(...holes);
    const collectHoles = (
      side: import("@/lib/types").WallSide,
      effDoors: import("@/lib/types").DoorConfig[],
      windows: import("@/lib/types").WindowConfig[],
    ): WallHole[] => {
      const out: WallHole[] = [];
      for (const d of effDoors) {
        if (d.wall !== side) continue;
        // Door hole goes ALL the way to the floor (y=0), not raised 1cm.
        // The 1cm sill earlier made the doorway look like a window. The
        // X axis is shrunk by 1cm on each side to match RoomDoor3D's
        // panel inset (doorW-2cm wide) — closed door covers hole cleanly.
        out.push({ x: d.pos + 1, y: 0, w: Math.max(1, d.len - 2), h: d.h ?? (exterior.interiorDoorHeightCm ?? 240) });
      }
      for (const w of windows) {
        if (w.wall !== side) continue;
        out.push({ x: w.pos, y: w.sill ?? defWinSill, w: w.len, h: w.h ?? defWinH });
      }
      return out;
    };
    // Walk every room and dedupe its 4 edges into the map. "fixed" + "axis"
    // + endpoints (sorted) form a canonical key. We round to integer cm so
    // near-matches snap together. Stair + hallway are also registered so
    // they own their wall hide/show + door via the standard wallsHidden
    // mechanism. Hallway is a thin special case: only its W + E short ends
    // are registered (the long N + S walls remain neighbour-contributed
    // so hallway's lack-of-hide-flag doesn't OR-pollute the neighbour's
    // shared wall via dedup — see task #57).
    for (let fi = 0; fi < roomLoopMax; fi++) {
      const fp = floorPlans[fi]; if (!fp) continue;
      for (const room of (fp.enabledRooms ?? [])) {
        if (ROOM_DEFS[room]?.isOutdoor) continue;
        // 跳过「四壁全隐」的房间：它们是纯容器（如天台休闲区＝开放露台），
        // 不参与墙体图。否则 dedup 会把容器的「全隐 E 墙」与相邻房间（如
        // 楼梯出屋面间）的「实 W 墙」合并，hideAny=true 一锁定，相邻房间
        // 的那面墙连同门洞一起消失。
        const whThis = fp.roomWallsHidden?.[room];
        if (whThis?.N && whThis?.S && whThis?.E && whThis?.W) continue;
        const onlyShortEnds = room === "hallway";
        const p = fp.roomLayout?.[room]; const d = fp.roomDimensions?.[room];
        if (!p || !d) continue;
        const wColor = fp.rooms?.[room]?.materials?.wall?.color ?? ROOM_DEFS[room]?.defaultWallColor ?? "#EDE8E0";
        const wId = fp.rooms?.[room]?.materials?.wall?.id ?? "";
        const configuredDoors = fp.roomDoors?.[room] ?? [];
        // Mirror the interior render: if a room has no configured doors
        // but should have one (roomHasDoor !== false), synthesize the auto
        // door via the SAME pickAutoDoor so the wall gets a hole exactly
        // where the rendered door sits. Without this, opening the door
        // reveals a solid wall behind it.
        //
        // Circulation rooms (stair / hallway) are EXCLUDED from auto-door
        // synthesis — exactly as the interior render is (it only builds an
        // autoDoor for `!isStair && !isHallway`). Previously this punched a
        // phantom door hole into the stairwell's exterior wall while the
        // interior render drew NO door panel there → an open gap you could
        // see the yard grass through. A user-configured door still applies.
        const isCircRoom = room === "stair" || room === "hallway";
        let doorsArr = configuredDoors.map(dd0 => widenGarageDoor(room, dd0, d.width, d.depth));
        if (!isCircRoom && configuredDoors.length === 0 && fp.roomHasDoor?.[room] !== false) {
          // 与 facade(mergedDoors)同优先级:roomDoorWall/Pos/Len 单门配置 > pickAutoDoor。
          const lw = fp.roomDoorWall?.[room];
          if (lw) {
            const wallLenCm = (lw === "W" || lw === "E") ? d.depth : d.width;
            const dl = fp.roomDoorLen?.[room] ?? defaultDoorLenCm(room, wallLenCm);
            doorsArr = [{ id: `cfg-${fi}-${room}`, wall: lw, pos: fp.roomDoorPos?.[room] ?? Math.max(5, (wallLenCm - dl) / 2), len: dl, h: fp.roomDoorH?.[room] ?? defaultDoorHCm(room) }];
          } else {
            const bounds = floorBoundsArr[fi];
            if (bounds) {
              const rW = d.width * CM; const rD = d.depth * CM;
              const cx = (p.x + d.width  / 2 - planOffset.minX) * CM - W / 2;
              const cz = (p.y + d.depth / 2 - planOffset.minY) * CM - D / 2;
              doorsArr = [pickAutoDoor(fi, room, cx, cz, rW, rD, d.width, d.depth, bounds)];
            }
          }
        }
        // 车库门洞与门板必须同尺寸/同位置：门板侧(effectiveDoors)对每个门都过一遍
        // widenGarageDoor（居中加宽到卷帘门尺寸），门洞侧此前只对"配置门"过、
        // 自动门/roomDoorWall 单门配置漏了 → 门洞(≤300)比门板(≤340)窄且错位，
        // 卷帘门对不上洞。这里统一补一遍（widenGarageDoor 对非车库房间是 no-op，
        // 对已加宽的配置门幂等），保证两侧完全一致。
        doorsArr = doorsArr.map(dd => widenGarageDoor(room, dd, d.width, d.depth));
        const winsArr = fp.roomWindows?.[room] ?? [];
        const wh = fp.roomWallsHidden?.[room];
        // Side keys are NSWE — same alphabet as door.wall + roomWallsHidden.
        const sides: Array<{
          uiSide: import("@/lib/types").WallSide;
          dataSide: import("@/lib/types").WallSide;
          axis: "h" | "v";
          fixed: number;
          a: number; b: number;
        }> = [
          // N (back, -Z) = SVG top = small plan-Y (fixed: p.y).
          // S (front, +Z) = SVG bottom = large plan-Y (fixed: p.y + d.depth).
          { uiSide: "N", dataSide: "N", axis: "h", fixed: p.y,          a: p.x,          b: p.x + d.width },
          { uiSide: "S", dataSide: "S", axis: "h", fixed: p.y + d.depth, a: p.x,          b: p.x + d.width },
          { uiSide: "W", dataSide: "W", axis: "v", fixed: p.x,          a: p.y,          b: p.y + d.depth },
          { uiSide: "E", dataSide: "E", axis: "v", fixed: p.x + d.width, a: p.y,          b: p.y + d.depth },
        ];
        const segMats = fp.rooms?.[room]?.materials;
        for (const s of sides) {
          // For hallway, skip N + S (let neighbours contribute those).
          // Only contribute W + E to give the corridor its short-end walls.
          if (onlyShortEnds && (s.uiSide === "N" || s.uiSide === "S")) continue;
          // 该面的外墙材质（逐面 > 整间 wallExterior）。外观图渲染时用它驱动
          // 外立面贴图/颜色（见 wallColor/wallId 取值），与左面板「外墙材质」同源。
          const extMat =
              s.uiSide === "N" ? (segMats?.wallBackExterior  ?? segMats?.wallExterior)
            : s.uiSide === "S" ? (segMats?.wallFrontExterior ?? segMats?.wallExterior)
            : s.uiSide === "E" ? (segMats?.wallRightExterior ?? segMats?.wallExterior)
            :                    (segMats?.wallLeftExterior  ?? segMats?.wallExterior);
          const extColor = extMat?.color;
          const extId    = extMat?.id;
          const lo = Math.min(s.a, s.b), hi = Math.max(s.a, s.b);
          const key = `${fi}|${s.axis}|${Math.round(s.fixed)}|${Math.round(lo)}|${Math.round(hi)}`;
          const fk  = `${fi}|${s.axis}|${Math.round(s.fixed)}`;
          const seg = map.get(key);
          const holes = collectHoles(s.dataSide, doorsArr, winsArr);
          // Explicit roomFacadeFaces wall=true on this room+side overrides exteriorPlanes suppression.
          const wallOverridden = fp.roomFacadeFaces?.[room]?.[s.uiSide]?.wall === true;
          if (seg) {
            // Exact range match: merge holes + hide flags + wallOverridden.
            addHole(seg, holes);
            if (wh?.[s.uiSide] === true) seg.hideAny = true;
            if (wallOverridden) seg.wallOverridden = true;
          } else {
            // Check for partially- or fully-overlapping segments at the same
            // plan-Y (or plan-X for vertical walls). These come from rooms on
            // the opposite side of the same physical wall. We must NOT create
            // a duplicate slab on top of them — instead distribute holes into
            // the overlapping segments and only create new segments for the
            // sub-ranges that aren't covered yet.
            const existing = fixedSegs.get(fk) ?? [];
            const overlapping = existing.filter(e => e.a < hi && e.b > lo);

            // Distribute holes from this wall into every overlapping segment
            // (adjusting x so it's local to each segment's own [a..b] span).
            for (const e of overlapping) {
              const offsetX = e.a - lo; // e.a is in plan coords; lo is our wall's start
              const clipped = holes
                .map(h => ({ x: h.x - offsetX, y: h.y, w: h.w, h: h.h }))
                .filter(h => h.x + h.w > 0 && h.x < e.b - e.a);
              addHole(e, clipped);
              if (wh?.[s.uiSide] === true) e.hideAny = true;
              if (wallOverridden) e.wallOverridden = true;
            }

            // Create new segments only for sub-ranges not yet covered.
            const sortedOvlp = [...overlapping].sort((a, b) => a.a - b.a);
            let cursor = lo;
            const addSubSeg = (subLo: number, subHi: number) => {
              if (subHi <= subLo) return;
              const subKey = `${fi}|${s.axis}|${Math.round(s.fixed)}|${Math.round(subLo)}|${Math.round(subHi)}`;
              const offsetX = subLo - lo;
              const subHoles = holes
                .map(h => ({ x: h.x - offsetX, y: h.y, w: h.w, h: h.h }))
                .filter(h => h.x + h.w > 0 && h.x < subHi - subLo);
              registerSeg({
                fi, axis: s.axis, fixed: s.fixed, a: subLo, b: subHi,
                holes: subHoles, hideAny: wh?.[s.uiSide] === true,
                wallColor: wColor, wallId: wId,
                extWallColor: extColor, extWallId: extId,
                wallOverridden,
              }, subKey);
            };
            for (const e of sortedOvlp) {
              addSubSeg(cursor, e.a);   // gap before this overlapping seg
              cursor = Math.max(cursor, e.b);
            }
            addSubSeg(cursor, hi);      // tail gap (or full range if no overlap)
          }
        }
      }
    }
    return [...map.values()];
  }, [floorPlans, floorCount, roomLoopMax, floorBoundsArr, planOffset, W, D, exterior.interiorDoorHeightCm]);

  return (
    <group position={[worldX, 0, worldZ]} rotation={[0, worldRot, 0]}>
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
                {/* No pointLight per marker — these tile across the apron, so
                    one light each is another night-only per-fragment tax. The
                    emissive disc alone is the visible marker glow. */}
              </group>
            ))}
          </group>
        );
      })()}
      {/* 建筑基座 — 两段式：下部黑花岗岩脚踢 + 上部深色抛光石材。
          ⚠️ 玻璃幕墙别墅例外：这道 0.4m 高的不透明地台会沿落地玻璃底部
          一圈把室内低于 0.4m 的东西（地毯、矮茶几等）从外面全挡住，与
          「通透玻璃幕墙落地」的卖点冲突（用户：基座暗带挡住地面家具）。
          故 curtainWall 模式下把基座压成贴地的 2cm 薄压边——保留干净的
          落地线，但不再遮挡室内地面家具。非幕墙(实墙)建筑保留原两段式基座。 */}
      {!insideBuilding && ((curtainWall || (exterior.transparentExterior ?? true)) ? (
        /* 幕墙 / 透明立面：贴地薄压边（高 2cm，顶面 0.02m，低于地板 0.025）。
           透明立面(默认)能透过门窗看到室内，0.4m 两段式深色基座会从门窗下方
           露出、像地板下多了两层暗带(用户：普通立面地板也有两层/暗带)，故同样
           压成薄边。只有完全不透明的实心立面(transparentExterior=false)才保留
           原两段式厚基座。 */
        <mesh position={[0, 0.01, 0]} castShadow>
          <boxGeometry args={[W + 0.06, 0.02, D + 0.06]} />
          <meshStandardMaterial color="#3A3E48" roughness={0.30} metalness={0.55} envMapIntensity={1.6} />
        </mesh>
      ) : (
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
      ))}
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
            {/* Corner glow handled by emissive materials — no pointLights for perf */}
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
        // 南立面外墙在 world-z ≈ +D/2（新坐标系：北=-Z, 南=+Z）。再向南 0.25m 开始，延伸 canopyD
        const southFaceZ = D / 2 + 0.20;  // 玻璃幕墙平面约在此处
        const canopyZ    = southFaceZ + canopyD / 2;  // 雨棚中心
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
            {/* Canopy soffit glow via emissive — no pointLight for perf */}
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
        const southFaceZ_sw = D / 2 + 0.20;
        const canopyZ_sw    = southFaceZ_sw + canopyD_sw / 2;
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
        const southFaceZ2 = D / 2 + 0.20;
        const stepW = Math.min(W * 0.50, 5.5);  // step width
        const nSteps = 3;
        const stepRise = 0.14;  // each step rise (m)
        const stepRun  = 0.38;  // each step run (m)
        const baseY = -nSteps * stepRise;  // ground level depression (building base is at 0.40)
        const plazaW = stepW + 2.8;
        const plazaD = nSteps * stepRun + 0.60;
        const plazaZ = southFaceZ2 + plazaD / 2;

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
              const sz = southFaceZ2 + si * stepRun + stepRun / 2;
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
                      {/* No pointLight per step — a staircase × floors added
                          a dozen-plus live lights at night (per-fragment cost).
                          The emissive strip alone reads as a glowing riser. */}
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
                  {/* Trough back wall (against building, north side) */}
                  <mesh position={[0, wbY + 0.02, wbZ - 0.28]}>
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
                  <mesh position={[0, wbY + 0.025, wbZ - 0.24]}>
                    <boxGeometry args={[wbW, 0.012, 0.014]} />
                    <meshStandardMaterial color="#80D8F0" emissive="#40C8E8" emissiveIntensity={1.4} />
                  </mesh>
                  {/* Water blade glow via emissive strip — no pointLight for perf */}
                  {/* Stone coping on far (south) side of water trough */}
                  <mesh position={[0, wbY + 0.02, wbZ + 0.30]}>
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
                    const jOriginZ = wbZ_j - 0.22;  // at back wall (north side, toward building)
                    const jOriginY = 0.06;
                    // Position the jet mid-point between origin and arc tip
                    const midX = jx;
                    const midY = jOriginY + Math.cos(jetAngle) * jetLen / 2;
                    const midZ = jOriginZ + Math.sin(jetAngle) * jetLen / 2;
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
                    const bz = wbZ2 + 0.35;   // in front of water trough
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
                        {/* Bollard glow via emissive cap — no pointLight for perf */}
                      </group>
                    );
                  })}
                </group>
              );
            })()}

            {/* entrance planters removed */}

            {/* entrance bamboo removed */}

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
                        const stepFaceZ = southFaceZ2 + si * stepRun;  // front face of step
                        const treadZ    = stepFaceZ + stepRun / 2;
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
                            {/* Step LED glow via emissive — no pointLight for perf */}
                          </group>
                        );
                      })}

                      {/* Splash pool at base — small basin where water collects */}
                      {(() => {
                        const poolFloorY  = -0.004;
                        const poolZ       = southFaceZ2 + nSteps * stepRun + 0.12;
                        const poolD       = 0.30;
                        return (
                          <group>
                            {/* Basin floor */}
                            <mesh position={[cx, poolFloorY, poolZ]} receiveShadow>
                              <boxGeometry args={[cascW + wallT * 2, 0.022, poolD]} />
                              <meshStandardMaterial color="#B0ACA4" roughness={0.60} metalness={0.04} />
                            </mesh>
                            {/* Basin front lip */}
                            <mesh position={[cx, poolFloorY + 0.038, poolZ + poolD / 2 + 0.030]}>
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
                            {/* Basin glow via emissive water surface — no pointLight for perf */}
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
              const plateZ = southFaceZ2 + 0.05;
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
                  {/* House number glow via emissive — no pointLight for perf */}
                </group>
              );
            })()}
          </group>
        );
      })()}

      {/* ── 入口大型装饰花盆（entry plaza ornamental urns）——
               台阶顶端两侧各一只黑花岗岩大盆，搭配修剪球形灌木 ── */}

      {/* ── 车道边缘低矮灯柱（driveway side bollards）——
               从大门向建筑入口沿车道两侧布置，每侧 4 盏，时间感知 ── */}

      {/* ── 外墙壁灯（南立面）—— 每层 2 盏，对称布置，随时间调光 ── */}
      {!insideBuilding && isGlassVilla && (() => {
        const isNight2 = sunHour < 6 || sunHour > 20;
        const isDusk2  = !isNight2 && (sunHour < 8 || sunHour > 18);
        // Emissive and point light intensity scaled by time of day
        const sconceEmi  = isNight2 ? 3.8 : isDusk2 ? 2.0 : 0.6;
        const lightInt   = isNight2 ? 4.0 : isDusk2 ? 2.0 : 0.0;
        const lightDist  = 5.0;
        const wallZ = D / 2 + 0.18;
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
              {/* Sconce glow via emissive head — no pointLight for perf */}
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
              <mesh position={[0, bandY, D / 2 + bandT / 2 - 0.002]}>
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
        const southFaceZF = D / 2 + 0.18;
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
                          position={[0, finY, southFaceZF + finD / 2]}
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
        // 本层有「外墙开洞」房间时跳过背景填充板，让透过通透门窗看到真实室内。
        // (门板仍由 glassRooms 已限定幕墙 → 普通立面照常渲染门板，不再是空洞。)
        const hasOpeningRoom = (fp.enabledRooms ?? [])
          .some(r => openingRooms.has(`${fi}:${r}`));
        if (hasOpeningRoom) return null;
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
        const wcz = (lcy - planOffset.minY) * CM - D / 2;
        const yBase = fi * (FLOOR_H + SLAB_T);
        if (insideBuilding) return null; // hidden inside — visible=false still intercepts raycasting
        // 顶层背景板：天台可上人时，绕开楼梯井开口（同屋面板/层间楼板的
        // carveRect 机制），否则这块实心板的顶面会把天台楼梯口封死。
        const topFloor   = usedFloors - 1;
        const stairEntry = interiorRooms.find(r => r.isStair && r.fi === 0);
        const bgOpening  = (exterior.hasRooftop && fi === topFloor && stairEntry)
          ? { cx: stairEntry.cx, cz: stairEntry.cz, w: stairEntry.rW, d: stairEntry.rD }
          : null;
        return (
          <group key={`bg-${fi}`}>
            {carveRect(lW + 0.02, lD + 0.02, wcx, wcz, bgOpening).map((p) => (
              <mesh key={p.key} position={[p.x, yBase + FLOOR_H / 2, p.z]} receiveShadow>
                <boxGeometry args={[p.w, FLOOR_H + 0.01, p.d]} />
                <meshStandardMaterial color={wallColor} roughness={0.82} metalness={0.01} />
              </mesh>
            ))}
          </group>
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
            const cz = (p.y + d.depth / 2 - planOffset.minY) * CM - D / 2;
            // Glass-curtain room: drop the opaque box and stage a "warm
            // emissive interior" exactly like the template's RichGlassInterior.
            // Key trick: walls/ceiling SELF-EMIT (emissive map) so the
            // room reads as lit-from-within through the glass — visual
            // depth comes from emissive surfaces, NOT from glass opacity
            // or external point lights.
            // We use the precomputed glassRooms set (built from facadeBlocks)
            // so auto-detected glass walls also get the emissive interior,
            // not only the explicit "glass" UI override.
            if (glassRooms.has(`${fi}:${room}`) && !insideBuilding) {
              // 玻璃幕墙房间室内：5 块独立发光平面（4 墙 + 天花板）+ 地板。
              // ONLY runs in 外观图 view — in walkthrough the proper opaque
              // ShapeGeometry walls (line 9952+) already render and double-
              // rendering both creates Z-fighting + ghost partition lines
              // visible between doorways (user: "为什么会有隔板和半透明
              // 图层").
              // 之前用 BackSide 盒子，但盒子的侧墙在斜角下会产生奇怪的
              // "立柱状"剪影（用户："2F 有几个深色立柱状物体"）。
              // 拆成 5 块独立 plane，每块法线朝向房间内部（FrontSide 默
              // 认即可），从玻璃外看到的就是连续的发光奶油墙面。
              const wallC     = "#EDE6D8";
              const ceilC     = "#F3EEE4";
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

              // 逐面判断：该面是「玻璃外立面」(在 exteriorPlanes 里)就跳过这堵
              // 奶油背景墙——否则它紧贴在玻璃后面，从斜角看会把房间糊成不透明
              // 奶油盒(用户：这个角度 S 墙不透明)。只有「内隔墙/实墙」面才画奶油
              // 背景(给玻璃后一个干净背衬)。角落两面玻璃的房间因此能真正透出去。
              const _pl = floorPlans[fi]?.roomLayout?.[room];
              const _dm = floorPlans[fi]?.roomDimensions?.[room];
              const _isGlassFace = (axis: "h" | "v", wc: number) =>
                !!_pl && !!_dm && exteriorPlanes.has(`${fi}|${axis}|${Math.round(wc)}`);
              // 也要跳过「用户在平面图里隐藏掉的面」(roomWallsHidden)——隐藏=开口，
              // 既不该有玻璃幕墙、也不该有这堵奶油盒墙，否则隐藏后仍显示乳白墙
              // (用户：客厅 N 墙隐藏了却还显示乳白墙)。
              const _hid = floorPlans[fi]?.roomWallsHidden?.[room];
              // 也跳过有门的面：该面的 wallSegment 已有门洞，奶油背板会把洞堵死
              // (用户：整片乳白，没门)。有门的面交给 wallSegments + WalkthroughDoor3D。
              const _fpDoorWall = floorPlans[fi]?.roomDoorWall?.[room];
              const _fpDoors    = floorPlans[fi]?.roomDoors?.[room] ?? [];
              const _hasDoor    = (side: string) =>
                _fpDoorWall === side || (_fpDoors as Array<{wall:string}>).some(d => d.wall === side);
              const skipS = !!_hid?.S || (!!_dm && _isGlassFace("h", (_pl?.y ?? 0) + (_dm?.depth ?? 0))) || _hasDoor("S");
              const skipN = !!_hid?.N || _isGlassFace("h", _pl?.y ?? 0) || _hasDoor("N");
              const skipE = !!_hid?.E || (!!_dm && _isGlassFace("v", (_pl?.x ?? 0) + (_dm?.width ?? 0))) || _hasDoor("E");
              const skipW = !!_hid?.W || _isGlassFace("v", _pl?.x ?? 0) || _hasDoor("W");
              return (
                <group key={`gbox-${fi}-${room}`} position={[cx, cy, cz]}>
                  {/* 南墙 S（+Z 方向，朝 -Z 即朝室内）*/}
                  {!skipS && (
                  <mesh position={[0, 0,  iD / 2 - 0.005]} rotation={[0, Math.PI, 0]}>
                    <planeGeometry args={[iW, wallH]} />
                    {wallMat}
                  </mesh>
                  )}
                  {/* 北墙 N（-Z 方向，朝 +Z 即朝室内）*/}
                  {!skipN && (
                  <mesh position={[0, 0, -iD / 2 + 0.005]}>
                    <planeGeometry args={[iW, wallH]} />
                    {wallMat}
                  </mesh>
                  )}
                  {/* 西墙 W（-X 方向，朝 +X 即朝室内）*/}
                  {!skipW && (
                  <mesh position={[-iW / 2 + 0.005, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
                    <planeGeometry args={[iD, wallH]} />
                    {wallMat}
                  </mesh>
                  )}
                  {/* 东墙 E（+X 方向，朝 -X 即朝室内）*/}
                  {!skipE && (
                  <mesh position={[ iW / 2 - 0.005, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
                    <planeGeometry args={[iD, wallH]} />
                    {wallMat}
                  </mesh>
                  )}

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
                  {/* 地板 —— 已移除（修复「多了一层地板」）。
                      这套发光室内盒原本在 yBase+0.04 又画了一层纯色地板，
                      但每间房的 WalkthroughFloor 已在 yBase+0.025 渲染了带
                      木纹的真实楼板。两层叠加：① 立面上看像「一层多了一层
                      地板 + 下方深色夹层」；② 高 1.5cm 的 0.04 板把贴地的
                      地毯/矮茶几埋住，外观图里看不到地面家具。删掉这层重复
                      地板后，真实楼板(0.025)单独显示，地毯/矮件随之露出。
                      墙面/天花仍保留发光盒，透过玻璃的奶油色室内观感不变。 */}

                  {/* 大房间家具剪影（仅在外观模式下渲染，通过玻璃可见）
                      不渲染 GLTF — 只是简单的几何体轮廓，给室内视觉深度
                      放在南墙 S（+Z）附近，从南面玻璃幕墙外看到 */}
                  {/* Sheer curtain panels — thin semi-transparent planes hanging from
                      ceiling, visible from outside through glass. Added to both large
                      and medium rooms for visual layering behind the glass.
                      curtain-wall 模式跳过：那里渲染用户在平面图里真实摆放的家具
                      （见 §家具渲染 placedItems 分支），不再叠这套通用模板剪影。 */}
                  {!insideBuilding && !curtainWall && (
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

                  {isLarge && !insideBuilding && !curtainWall && (
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
                      {/* Pendant glow via emissive globe only — NO pointLight.
                          A real per-room pointLight here multiplied by (rooms ×
                          floors) added 20-40 live lights at night, and WebGL
                          forward shading evaluates every light per fragment →
                          severe night-only frame drops when scrubbing the time
                          slider. The emissive globe + room-wall emissive
                          (interiorGlowWall) already read as a lit room through
                          the glass; the extra light pooling wasn't visible from
                          outside anyway. (Same "glow via emissive, no pointLight
                          for perf" rule used across this file.) */}
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
                          {/* Second pendant: emissive globe only, no pointLight
                              (see perf note on the primary pendant above). */}
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
                  {!insideBuilding && !curtainWall && iW > 2.5 && iD > 2.5 && !isLarge && (
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
            // 有外墙开洞的房间跳过实心盒子，让窗/门洞透出真实室内家具。门板仍
            // 渲染(glassRooms 已限定幕墙)，实体外墙带洞，墙的实心部分照样挡视线。
            if (!insideBuilding && openingRooms.has(`${fi}:${room}`)) return null;
            // 顶层楼梯间：天台可上人时不画实心盒子，否则盒子顶面把天台
            // 楼梯口封死（背景板已在同位置 carveRect 开了井口）。
            if (room === "stair" && exterior.hasRooftop && fi === usedFloors - 1) return null;
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
              slabCZ = ((lMinY + lMaxY) / 2 - planOffset.minY) * CM - D / 2;
            }
          }
          // Glass villa: add south cantilever so upper floor dramatically
          // projects over the ground-floor glass facade, as in the reference image.
          // Extend slab 1.50m further south (+Z direction) and narrow the north side.
          if (isGlassVilla) {
            const cantilever = 1.50;      // m of south projection beyond ground floor
            totalD  += cantilever;
            slabCZ  += cantilever / 2;    // shift slab centre south (+Z) to keep north edge fixed
          }
          const halfW = totalW / 2;
          const halfD = totalD / 2;

          // Wood soffit helper — horizontal teak battens on slab underside (glass villa only)
          const WoodSoffit = ({ cx, cz, sW, sD, yBot }: { cx: number; cz: number; sW: number; sD: number; yBot: number }) => {
            if (!isGlassVilla && !(exterior.woodSoffit ?? false)) return null;
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
                {(isGlassVilla || (exterior.woodSoffit ?? false))
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

      {/* ── 4. 外墙 facade overlay（基于合并块，无双框缝）── 室内模式下隐藏外墙。
           transparentExterior（默认开）时也跳过：外观图改用与效果图/室内漫游同源
           的透明立面 —— 露出带窗洞的墙体 + 共享 <StyledWindow> 透明玻璃，不再叠
           盖窗洞的实心 ConcreteFacade 立面层。设 transparentExterior=false 可恢复
           旧的实心立面外观。 */}
      {/* 幕墙玻璃立面：curtainWall 模式下漫游(insideBuilding)也渲染，
          这样从室内往外看是通透玻璃而非实墙(用户反馈：漫游里幕墙变实墙)。
          非幕墙的 legacy 路径仍只在外观图渲染。 */}
      {(curtainWall || (!insideBuilding && !(exterior.transparentExterior ?? true))) && facadeBlocks.map((block, bi) => {
        const { floorIndex, side, wallCoord, mergedStart, mergedEnd, doorEntries, winEntries } = block;
        const segLen  = (mergedEnd - mergedStart) * CM;
        const yBase   = floorIndex * (FLOOR_H + SLAB_T);
        const yMid    = yBase + FLOOR_H / 2;
        const isSouth = side === "S";
        // X轴翻转：south/east 的旋转使 local+X 方向反转
        const flipX   = side === "S" || side === "E";

        // Facade treatment — 统一以 resolveFacadeLayer 的结果(block.fl，已并入
        // per-face roomFacadeFaces + per-room roomExteriorStyle + 全局模式)为权威。
        // 此前这里用 forceGlass/forceConcrete 直接读旧 roomExteriorStyle 并把优先级
        // 压过 block.fl，导致「同面外观显实墙、室内显玻璃」——现已删除，三视图统一。
        const totalWinLen = winEntries.reduce((s, e) => s + e.w.len, 0);
        const winCoverage = segLen > 0 ? (totalWinLen * CM) / segLen : 0;
        // Stair/hallway rooms must always be solid — never auto-glass even on
        // south-facing glass-villa facades (stairs are interior structure).
        const blockIsCirculation = block.rooms.every(r => r === "stair" || r === "hallway");
        const isGlassWall = !blockIsCirculation && (winCoverage > 0.42 || (isGlassVilla && (isSouth || winCoverage > 0.28)));

        // Per-face facade layers (实墙/玻璃幕墙/框架) resolved on the block.
        // 玻璃 OR 框 显示 → 渲染幕墙(下面按 showGlass/showFrame 分层)；都不显示
        // → 该面是实墙(或全开敞，已被 layeredSegs 过滤)，走实墙/ConcreteFacade。
        const viaLayers = block.fl.glass || block.fl.frame;
        // 车库（有门）永远是实墙 + 卷帘车库门，绝不做玻璃幕墙 —— 即使整楼是玻璃别墅
        // 模式(isGlassVilla)或南向自动玻璃。卷帘车库门板在 concrete 分支渲染，所以
        // 必须把车库面强制为 concrete，否则它落进 glass 分支 → 门板永远不出现
        // (用户：车库有洞没有门)。
        const isGarageDoorBlock = floorIndex === 0 && block.rooms.includes("garage")
          && doorEntries.length > 0;
        let facade: "glass" | "concrete" | "wood";
        if (isGarageDoorBlock) {
          facade = "concrete";
        } else if (viaLayers) {
          facade = "glass";
        } else if (curtainWall) {
          // 幕墙模式下某面被强制显示「实墙」(玻璃+框都隐藏)：交给真实外墙壳
          // (wallSegments，未被 exteriorPlanes 抑制) 渲染带门窗洞的实墙。
          facade = "concrete";
        } else if (isGlassVilla) {
          facade = isGlassWall ? "glass"
                 : side === "W" && floorIndex > 0 ? "wood"
                 : "concrete";
        } else {
          facade = "concrete";
        }

        // 幕墙模式下的非玻璃面(实墙)：不画 ConcreteFacade 叠层，由真实外墙壳呈现。
        // 车库门面：ConcreteFacade 是一块实心 12cm 盒子(无 CSG)，会把墙段的门洞
        // 和 WalkthroughDoor3D 的卷帘门全挡住 → 跳过，由 wallSegments 的带洞墙
        // + WalkthroughDoor3D 渲染门板。
        if (isGarageDoorBlock) return null;
        if (curtainWall && facade !== "glass") return null;

        // ── 位置 & 旋转（使用合并块中心坐标）──
        const midCoord = mergedStart + (mergedEnd - mergedStart) / 2;
        let px: number, pz: number, rot: [number, number, number];
        if (isSouth) {
          [px] = toWorld(midCoord, wallCoord, planOffset);
          [, pz] = toWorld(0, wallCoord, planOffset);
          // South wall sits at max-Z (the building's +Z edge); outward = +Z.
          // The facade panel must be pushed OUTWARD so it sits in front of the
          // room-shell wall — otherwise the shell occludes the glass curtain
          // and that face reads as a bare (matte/spandrel) wall instead of
          // glass, producing the "颜色不统一" face-to-face inconsistency.
          rot = [0, Math.PI, 0]; pz += 0.12;
        } else if (side === "N") {
          [px] = toWorld(midCoord, wallCoord, planOffset);
          [, pz] = toWorld(0, wallCoord, planOffset);
          // North wall sits at min-Z (the building's -Z edge); outward = -Z.
          rot = [0, 0, 0]; pz -= 0.12;
        } else if (side === "E") {
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
            winH:    (w.h ?? defWinH) * CM,
            winSill: (w.sill ?? defWinSill) * CM,
          };
        });

        // ── 玻璃幕墙 ──
        // 不再有 onClick 进入房间 —— 用户在左侧房间列表/顶部漫游按钮
        // 显式进入。3D 玻璃幕墙仅作展示。
        if (facade === "glass") {
          // Upper-floor Juliet balcony railing — removed per user request
          // (the 2F horizontal steel rails read as clutter on the clean
          // vertical-mullion curtain wall). Set back to `floorIndex > 0 &&
          // segLen > 0.8` to restore.
          const showRailing = false;
          // South-facing upper floors get external horizontal sunshade fins
          const showSunshade = floorIndex > 0 && isSouth && segLen > 1.2;
          const finCount2 = showSunshade ? Math.max(3, Math.round(segLen / 0.90)) : 0;
          return (
            <group key={`gl-${bi}`} position={[px, yMid, pz]} rotation={rot}>
              <GlassCurtain
                width={segLen} height={FLOOR_H} floorH={FLOOR_H}
                doors={floorIndex === 0 ? doorInfos : []}
                /* 窗也参与竖挺分格(洞口边必有挺、不跨挺) —— 与房间循环里上悬扇
                   共用同一套 buildCurtainLayout,故窗永远正好嵌进它那一格。 */
                windows={winInfos.map(w => ({ cx: w.localX, w: w.winLen, sill: w.winSill, h: w.winH }))}
                mullionBay={(exterior as { curtainMullionBay?: number }).curtainMullionBay}
                structFrameWidth={(exterior as { curtainStructFrameWidth?: number }).curtainStructFrameWidth}
                mullionWidth={(exterior as { curtainMullionWidth?: number }).curtainMullionWidth}
                /* 竖挺全局对齐:本块沿墙轴起点(米)+ 翻转,使同面相邻块的挺落在同一组网格线。 */
                gridOriginM={mergedStart * CM}
                gridFlip={flipX}
                /* 跨块去重:交界处抑制本块端挺(curtainEndSuppress 按面分组算出)。 */
                skipMullionLeft={curtainEndSuppress[bi]?.left ?? false}
                skipMullionRight={curtainEndSuppress[bi]?.right ?? false}
                /* Per-face layers: 玻璃幕墙(showGlass) and 框架(showFrame) toggle
                   independently; opacity is per-face. Legacy non-layer glass
                   faces (forceGlass / isGlassVilla) render the full curtain at
                   the global opacity. */
                showGlass={viaLayers ? block.fl.glass : true}
                showFrame={viaLayers ? block.fl.frame : true}
                /* 各层幕墙都不放底部裙板 → 玻璃到各层楼板，外观可透过玻璃
                   看到地面家具(地毯/矮茶几)。楼层线由层间楼板(slab)表达，
                   不需要裙带。(用户：一楼、二楼裙带都去掉) */
                showBottomSpandrel={false}
                /* 幕墙内侧百叶帘装饰：默认关(从外看是悬浮水平细网,易误读)。
                   可经 exterior.curtainBlinds 开启。 */
                showBlinds={(exterior as { curtainBlinds?: boolean }).curtainBlinds ?? false}
                /* 幕墙别墅：不画静态装饰门，门交给可点击开关的 WalkthroughDoor3D
                   通透玻璃门(见下方 _doorOnGlassFace → glass_swing/glass_slide，
                   与室内装修门型一致)，于是门能推开。 */
                showEntranceDoor={!curtainWall}
                opacityScale={exterior.glassOpacity ?? (curtainWall ? 1.1 : 1)}
                /* per-face 玻璃透明度在幕墙/普通两种模式下都生效(此前幕墙模式被旁路
                   改用全局 glassOpacity，致单面透明度外观图不响应、与室内装修不一致)。 */
                glassTransparency={viaLayers ? block.fl.opacity : undefined}
                glassColor={exterior.glassColor}
                spandrelColor={curtainWall ? slabBandColor : exterior.glassSpandrelColor}
                entranceFrameColor={exterior.entranceFrameColor}
                entranceHandleColor={exterior.entranceHandleColor}
                entranceCanopy={exterior.entranceCanopy}
              />
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
                    {/* Rail LED glow via emissive — no pointLight for perf */}
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
                  {/* 玻璃 — 白天偏深蓝灰，更清晰区分于墙面（matches ConcreteFacade）*/}
                  <mesh position={[0, 0, 0.018]}>
                    <planeGeometry args={[w.winLen - 0.04, w.winH - 0.04]} />
                    <meshPhysicalMaterial
                      color={interiorGlowWall > 0.5 ? "#D8C8A0" : "#3A4A60"}
                      transparent opacity={interiorGlowWall > 0.5 ? 0.80 : 0.92}
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
        // Resolution order for the facade base color (per user request — the
        // exterior should reflect what was set in 效果图 per-room material):
        //   1. wallBaseColor (an explicit building-wide override the user set
        //      via ExteriorPanel, if any) — highest priority because it's the
        //      "I want this exact color" knob.
        //   2. The primary room's wall material color, looked up from
        //      fp.rooms[room].materials.wall.color — i.e. whatever the user
        //      configured in the per-room effect-view material picker.
        //   3. ROOM_DEFS[room].defaultWallColor — the room-type baseline.
        //   4. The original hardcoded ConcreteFacade default.
        const blockFp = floorPlans[floorIndex];
        const blockMats = blockFp?.rooms?.[block.primaryRoom]?.materials;
        // 与效果图外墙面 100% 对齐：每面外立面优先取该面的外墙材质
        // (wall{Side}Exterior)，其次整间外墙 (wallExterior)，再回落到该面
        // 内墙材质、整间墙色、最后房型默认色 —— 与 RoomCanvas 渲染外墙面时
        // 的取色顺序完全一致（N=后/S=前/E=右/W=左）。
        const sideExtMat =
            block.side === "N" ? (blockMats?.wallBackExterior  ?? blockMats?.wallExterior)
          : block.side === "S" ? (blockMats?.wallFrontExterior ?? blockMats?.wallExterior)
          : block.side === "E" ? (blockMats?.wallRightExterior ?? blockMats?.wallExterior)
          :                      (blockMats?.wallLeftExterior  ?? blockMats?.wallExterior);
        const sideIntMat =
            block.side === "N" ? blockMats?.wallBack
          : block.side === "S" ? blockMats?.wallFront
          : block.side === "E" ? blockMats?.wallRight
          :                      blockMats?.wallLeft;
        const roomWallColor = sideExtMat?.color ?? sideIntMat?.color ?? blockMats?.wall?.color
          ?? ROOM_DEFS[block.primaryRoom]?.defaultWallColor;
        const facadeBase = exterior.wallBaseColor ?? roomWallColor ?? "#E6E0D8";
        // 外立面贴图 id —— 取色同序：本面外墙材质 → 内墙材质 → 整间墙材质。
        // 当用户设了 wallBaseColor（整楼纯色覆盖）时清空贴图，让纯色生效，
        // 与 WalkthroughWallPiece 在 exterior.wallBaseColor 下丢弃 wallId 一致。
        const sideWallTexId = exterior.wallBaseColor
          ? ""
          : (sideExtMat?.id ?? sideIntMat?.id ?? blockMats?.wall?.id ?? "");
        return (
          <group key={`co-${bi}`} position={[px, yMid, pz]} rotation={rot}>
            {/* ConcreteFacade is authored with its exterior detail (glass, sills, lintels,
                jambs, flower boxes) protruding toward local +z, but the per-wall `rot`
                convention above (written for GlassCurtain) places the exterior face on
                local -z. Without this flip the opaque interior backing pane faces the
                camera and the glass/trim render inside the building (the "black hole"
                windows). One uniform z-flip on ONLY the facade re-faces all its detail
                outward on every wall without mirroring window X positions. The sibling
                stone base below is already authored on the correct (+z exterior) side,
                so it must stay outside this flip. three.js auto-corrects winding/normals
                for the negative-determinant matrix, so FrontSide lighting is unaffected. */}
            <group scale={[1, 1, -1]}>
            <ConcreteFacade
              width={segLen} height={FLOOR_H} windows={winInfos} windowGlow={interiorGlowWall}
              /* 车库门洞由真实 GLB 卷帘门填充，ConcreteFacade 不再画静态门板（否则
                 灰门叠在卷帘门前面挡住）。门洞本身仍由 wallSegments 抠出。 */
              doors={floorIndex === 0 && !isGarageDoorBlock ? doorInfos : []}
              doorColor={exterior.entranceDoorColor ?? ENTRANCE_DOOR_COLOR}
              doorHandleColor={exterior.entranceHandleColor ?? ENTRANCE_DOOR_HANDLE_COLOR}
              doorCasingColor={exterior.entranceCasingColor ?? ENTRANCE_DOOR_CASING_COLOR}
              casingColor={exterior.windowCasingColor ?? "#D8D0C2"}
              frameDepthCm={exterior.windowFrameDepthCm ?? 7}
              frameMemberCm={exterior.windowFrameMemberCm ?? 5.5}
              glassColor={exterior.windowGlassColor}
              frameColor={exterior.windowFrameColor ?? WINDOW_FRAME_COLOR}
              hGrooveStep={exterior.wallPanelHSpacing}
              vGrooveStep={exterior.wallPanelVSpacing}
              sillEnabled={exterior.windowSillEnabled ?? true}
              lintelEnabled={exterior.windowLintelEnabled ?? true}
              jambEnabled={exterior.windowJambEnabled ?? true}
              flowerBoxFreq={exterior.windowFlowerBoxFreq ?? 0}
              twoTone={exterior.wallPanelTwoTone ?? true}
              stripVCm={exterior.windowFrameStripVCm ?? 2.5}
              stripHCm={exterior.windowFrameStripHCm ?? 3}
              sillColor={exterior.windowSillColor ?? "#B8B4AC"}
              lintelColor={exterior.windowLintelColor ?? "#C0BCB4"}
              jambColor={exterior.windowJambColor ?? "#BCBAB2"}
              jambDepthCm={exterior.windowJambDepthCm ?? 9}
              flowerBoxColor={exterior.windowFlowerBoxColor ?? "#2A2C34"}
              flowerFoliageColor={exterior.flowerFoliageColor ?? "#3E7428"}
              flowerBloomColor={exterior.flowerBloomColor ?? "#E83040"}
              baseColor={facadeBase}
              grooveColor={exterior.wallGrooveColor ?? "#C0BAB2"}
              glassTopColor={exterior.windowGlassTopColor}
              mullionPos={exterior.windowMullionPos ?? 0}
              mullionThicknessCm={exterior.windowMullionThicknessCm ?? 3}
              grooveOpacity={exterior.wallPanelGrooveOpacity ?? 0.55}
              revealShadow={exterior.windowRevealShadow ?? 0.50}
              baseShadow={floorIndex === 0 ? (exterior.buildingBaseShadow ?? 0.6) : 0}
              eaveShadow={floorIndex === exterior.floors - 1 ? (exterior.eaveShadow ?? 0.35) : 0}
              wallVignette={exterior.wallVignette ?? 0.30}
              stuccoEnabled={exterior.wallStuccoEnabled ?? true}
              stuccoScale={exterior.wallStuccoScale ?? 1.2}
              stuccoRoughness={exterior.wallStuccoRoughness ?? 0.85}
              wallTextureId={sideWallTexId}
              windowProtrude={exterior.windowProtrude ?? 0.06}
            />
            </group>
            {/* 底部石材腰线（ground floor only）— 仿石灰岩腰线覆盖在混凝土底部。
                Height + on/off now driven by ExteriorSettings.stoneBase{Enabled,Height}. */}
            {floorIndex === 0 && (exterior.stoneBaseEnabled ?? true) && (() => {
              const sbH = Math.max(0.15, Math.min(1.20, exterior.stoneBaseHeight ?? 0.55));
              // Course joint Y positions evenly spaced (3 courses regardless of height)
              const j = sbH / 4;
              return (
                <group position={[0, -FLOOR_H / 2 + sbH / 2, 0.050]}>
                  {/* Main cladding slab */}
                  <mesh castShadow receiveShadow>
                    <boxGeometry args={[segLen + 0.004, sbH, 0.016]} />
                    <meshStandardMaterial color="#D8D0BE" roughness={0.64} metalness={0.02} envMapIntensity={0.55} />
                  </mesh>
                  {/* Ashlar horizontal rustication joints — 3 stone courses */}
                  {[j, 0, -j].map((jy, ji) => (
                    <mesh key={ji} position={[0, jy, 0.009]}>
                      <boxGeometry args={[segLen + 0.005, 0.008, 0.006]} />
                      <meshStandardMaterial color="#B8B0A0" roughness={0.88} />
                    </mesh>
                  ))}
                  {/* Top edge flashing strip */}
                  <mesh position={[0, sbH / 2 + 0.003, 0.010]}>
                    <boxGeometry args={[segLen + 0.006, 0.010, 0.012]} />
                    <meshStandardMaterial color="#3A3E48" roughness={0.22} metalness={0.90} envMapIntensity={1.6} />
                  </mesh>
                </group>
              );
            })()}
            {/* 车库门不在这里画：门(含卷帘门 roller_shutter 样式)统一由下方
                effectiveDoors 的 WalkthroughDoor3D 渲染，可点击开关。 */}
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
          fixtures.push({ x: fx, y: 0, z: D / 2 + ulOffset, rY: 0 });
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

      {/* ── 4d. 屋顶南向露台玻璃栏杆已移除 ──
               这段是硬编码的南向露台栏杆（始终渲染、不受开关控制、railY 写死
               totalH+0.78 且假定女儿墙 0.30/悬挑 0.45），当实际女儿墙高度或悬挑
               不同时会悬空错位，看着像漂浮的玻璃板/光伏板。天台四周护栏统一由
               FlatRoof 的女儿墙顶玻璃护栏（parapetGlassEnabled，绕屋顶一圈、随
               女儿墙高度自动贴合）负责，避免重复与特例。 */}

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

      {/* ── 5a-base. 建筑基部种植（foundation planting — ornamental grass + shrubs）──
           A strip of low ornamental grasses and mounding shrubs along the
           south and east/west faces, softening building-meets-ground transition.
           Standard luxury exterior finish — usually boxwood, liriope, or grasses. */}
      {false && (() => {
        const bedW = 0.55;    // planting bed depth from building face
        const bedY = bedW / 2;
        // South facade plant strip
        const southZ = D / 2 + bedW / 2 - 0.004;
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
            <mesh position={[0, eaveY, D / 2 + OV_S5 + eaveInset]}>
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
            {/* Eave glow via emissive materials — no pointLights for perf */}
          </group>
        );
      })()}

      {!insideBuilding && mainRoofBounds && (
        <group position={[mainRoofBounds.cx, 0, mainRoofBounds.cz]}>
        <FlatRoof
          W={mainRoofBounds.w} D={mainRoofBounds.d} roofY={totalH}
          nightGlow={interiorGlowWall > 1.20 ? 1.0 : interiorGlowWall > 0.92 ? 0.5 : 0}
          hasRooftop={exterior.hasRooftop}
          overhang={exterior.roofOverhang ?? 0.45}
          overhangSouthExtra={exterior.roofOverhangSouthExtra ?? 0.30}
          parapetH={exterior.parapetHeight ?? 0.30}
          parapetGlass={exterior.parapetGlassEnabled ?? true}
          slabColor={exterior.roofSlabColor ?? "#F0EDE8"}
          parapetColorOverride={exterior.parapetColor}
          slabThicknessCm={exterior.roofSlabThicknessCm ?? 10}
          parapetThicknessCm={exterior.parapetThicknessCm ?? 12}
          coveLightEnabled={exterior.coveLightEnabled ?? true}
          coveLightColor={exterior.coveLightColor ?? "#D0E8FF"}
          stairOpening={(() => {
            const se = interiorRooms.find(r => r.isStair && r.fi === 0);
            return se ? { cx: se.cx, cz: se.cz, w: se.rW, d: se.rD } : null;
          })()}
          stairExitSide={(() => {
            // 天台楼梯间真实配置的门所在侧 —— 与漫游碰撞用的同一扇门同源。
            const rs = interiorRooms.find(r => r.isStair && r.fi === roofFi);
            return (rs?.doors?.[0]?.wall as "N" | "S" | "E" | "W" | undefined) ?? null;
          })()}
          stairWallsHidden={(() => {
            // 天台楼梯间各墙显隐 —— 与房间真实墙体同源。护栏只补在被隐藏的墙侧，
            // 墙在则盒子四壁已围合、不再叠玻璃栏杆（不特立独行）。
            const rs = interiorRooms.find(r => r.isStair && r.fi === roofFi);
            return (rs?.wallsHidden as Partial<Record<"N" | "S" | "E" | "W", boolean>> | undefined) ?? null;
          })()}
          penthouse={false}
          penthouseColor={exterior.penthouseColor ?? exterior.parapetColor ?? "#E8E4DE"}
        />
        </group>
      )}

      {/* 独立附属建筑（车库等）各自独立盖小顶 */}
      {!insideBuilding && roomClusters.detached.map((cluster, ci) => {
        let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
        let maxH = 0;
        for (const r of cluster) {
          mnX = Math.min(mnX, r.x); mnY = Math.min(mnY, r.y);
          mxX = Math.max(mxX, r.x + r.w); mxY = Math.max(mxY, r.y + r.d);
          const rd = ROOM_DEFS[r.room as RoomType];
          if (rd) maxH = Math.max(maxH, (rd.height ?? 260) * CM);
        }
        const cw = (mxX - mnX) * CM;
        const cd = (mxY - mnY) * CM;
        const cx = ((mnX + mxX) / 2 - planOffset.minX) * CM - planOffset.W / 2;
        const cz = ((mnY + mxY) / 2 - planOffset.minY) * CM - planOffset.D / 2;
        const ov = 0.25;
        const st = (exterior.roofSlabThicknessCm ?? 10) / 100;
        const roofColor = exterior.roofSlabColor ?? "#F0EDE8";
        return (
          <group key={`detached-roof-${ci}`} position={[cx, maxH + 0.05, cz]}>
            <mesh castShadow receiveShadow>
              <boxGeometry args={[cw + ov * 2, st, cd + ov * 2]} />
              <meshStandardMaterial color={roofColor} roughness={0.88} />
            </mesh>
          </group>
        );
      })}

      {/* ── DEBUG: NWES direction labels (code convention: north=-Z, south=+Z, east=+X, west=-X) ──
           Commented out for production; re-enable to debug coord directions in 外观图. */}
      {/* {!insideBuilding && (() => {
        const lblY = 1.5;
        const lblStyle: React.CSSProperties = {
          fontSize: 72, fontWeight: 900, color: '#FF1493',
          background: 'rgba(255,255,255,0.95)',
          padding: '8px 20px', borderRadius: 10,
          border: '4px solid #FF1493',
          whiteSpace: 'nowrap', userSelect: 'none', pointerEvents: 'none',
          transform: 'translate(-50%, -50%)',
        };
        return (
          <group>
            <Html position={[0, lblY, -D / 2 - 2]} center><div style={lblStyle}>N (-Z)</div></Html>
            <Html position={[0, lblY,  D / 2 + 2]} center><div style={lblStyle}>S (+Z)</div></Html>
            <Html position={[ W / 2 + 2, lblY, 0]} center><div style={lblStyle}>E (+X)</div></Html>
            <Html position={[-W / 2 - 2, lblY, 0]} center><div style={lblStyle}>W (-X)</div></Html>
          </group>
        );
      })()} */}

      {/* ── 屋顶层 (hasRooftop) — 读取屋顶平面图，按房间类型渲染 3D 模板装饰 ── */}
      {exterior.hasRooftop && (
        <RooftopDecorations
          W={W} D={D}
          surfaceY={totalH + 0.10 + 0.05 + 0.005}
          planOffset={planOffset}
          onEnterRoom={onEnterRoom}
          roofFloorIdx={exterior.floors}
          nightGlow={interiorGlowWall > 1.20 ? 1.0 : interiorGlowWall > 0.92 ? 0.5 : 0}
          floorPlansOverride={floorPlansOverride}
        />
      )}

      {/* ── 5a-conservatory. 北侧温室 / 冬季花园（glass conservatory, north facade）──
           A Victorian-style steel-and-glass conservatory attached to the north wall.
           Width = W × 0.38, depth = 2.4m, height = 3.2m at ridge.
           Dark anodized steel frame + laminated glass panels.
           At night: warm amber glow from interior plants / lighting. */}
      {false && (() => {
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

      {/* ── 5b-3. 建筑南侧石板过渡露台（transition terrace between building & pool deck）──
           0.80m stone apron connecting the building south face to the pool deck.
           Same travertine as pool deck, slightly wider than building footprint.
           Small riser step at pool deck level (+0.12m) visible from south. */}

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
        const upZ = D / 2 + 0.50;   // 0.5m south of building face (in transition terrace)
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

      {/* ── 5c-2d. 泳池两侧高柏树（tall cypress trees flanking pool deck — real GLTF）──
           6 cypress_tree_lowpoly GLTF models: 3 per side, at E and W deck edges.
           Staggered heights 6.5–8m. Slender columnar form frames the pool. */}
      {false && (() => {
        const poolL_cy = Math.min(D * 0.70, 9.50);
        const poolW_cy = Math.min(W * 0.78, 11.0);
        const deckBW_cy = 2.80;
        const pz_cy = D / 2 + deckBW_cy + poolL_cy / 2 + 0.80;
        const deckEdgeX = poolW_cy / 2 + deckBW_cy + 0.55;
        const cypressData: Array<[number, number, number, number]> = [
          // [x, z, targetH, rotY]
          [ deckEdgeX, pz_cy - poolL_cy * 0.35, 7.5, 0.3],
          [ deckEdgeX, pz_cy,                    8.0, 1.1],
          [ deckEdgeX, pz_cy + poolL_cy * 0.30,  6.8, 2.0],
          [-deckEdgeX, pz_cy - poolL_cy * 0.35,  7.2, 4.5],
          [-deckEdgeX, pz_cy,                    7.8, 3.8],
          [-deckEdgeX, pz_cy + poolL_cy * 0.30,  7.0, 5.2],
        ];
        return (
          <group>
            {cypressData.map(([tx, tz, tH, rotY], ti) => (
              <group key={ti} position={[tx, 0, tz]}>
                <Suspense fallback={null}>
                  <GltfPlant path={CYPRESS_PATH} targetH={tH} rotY={rotY} />
                </Suspense>
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 5c-2e. 泳池南端热带棕榈（tropical palms at pool south end — real GLTF）──
           4 palm_tree_lowpoly GLTF models flanking the infinity overflow edge.
           2 east, 2 west, staggered heights 3.5–5m. Resort foreground element. */}
      {false && (() => {
        const poolL_tp  = Math.min(D * 0.70, 9.50);
        const poolW_tp  = Math.min(W * 0.78, 11.0);
        const deckBW_tp = 2.80;
        const pz_tp     = D / 2 + deckBW_tp + poolL_tp / 2 + 0.80;
        const deckEdgeX_tp = poolW_tp / 2 + deckBW_tp + 0.70;
        const poolSZ = pz_tp - poolL_tp / 2 - deckBW_tp;
        const palmData: Array<[number, number, number, number]> = [
          // [x, z, targetH, rotY]
          [ deckEdgeX_tp + 0.30, poolSZ + 1.0, 4.5, 0.5],
          [ deckEdgeX_tp + 1.00, poolSZ + 2.8, 3.8, 2.2],
          [-(deckEdgeX_tp + 0.30), poolSZ + 1.0, 4.2, 4.0],
          [-(deckEdgeX_tp + 1.00), poolSZ + 2.8, 3.6, 5.5],
        ];
        return (
          <group>
            {palmData.map(([px, pz, tH, rotY], pi) => (
              <group key={pi} position={[px, 0, pz]}>
                <Suspense fallback={null}>
                  <GltfPlant path={PALM_PATH} targetH={tH} rotY={rotY} />
                </Suspense>
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 5c-3. 北院绿篱屏障（formal clipped hedge, north boundary inside）──
           Dense clipped yew/boxwood hedge 1.2m tall runs along inside of north wall,
           providing green backdrop behind the garden sculpture and fountain. */}

      {/* ── 5c-4. 北庭院石凳（garden stone bench near fountain）──
           A simple white marble bench with dark metal legs, placed between
           the circular fountain and hedge for a reading / resting spot. */}

      {/* ── 5c-5. 东侧界墙灌木（shrub row along inner east boundary wall — real GLTF）──
           Replaces floating magenta ball clusters with real shrub_01/shrub_02 GLTF
           models spaced along the east wall interior. 8 shrubs alternating models. */}
      {false && (() => {
        const bndE5  =  W / 2 + 4.50;
        const wallT5 = 0.18;
        const wallX5 = bndE5 - wallT5 - 0.40;  // 0.4m inside east wall
        const shrubZStart = D / 2 + 1.5;       // start south of building
        const shrubZEnd   = D / 2 + 12.0;      // stop well before south boundary
        const nShrubs = 7;
        const shrubStep = (shrubZStart - shrubZEnd) / (nShrubs - 1);
        return (
          <group>
            {Array.from({ length: nShrubs }, (_, si) => {
              const sz = shrubZStart - si * shrubStep;
              const rotY = (si * 1.3) % (Math.PI * 2);
              const shrubPath = si % 3 === 0 ? BOXWOOD_PATH : si % 3 === 1 ? SHRUB2_PATH : HEDGE_PATH;
              return (
                <group key={si} position={[wallX5, 0, sz]}>
                  <Suspense fallback={null}>
                    <GltfPlant path={shrubPath} targetH={1.0} rotY={rotY} />
                  </Suspense>
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5d. 场地边界矮墙 + 入口大门 ──
           Coord convention (current): north = -Z, south = +Z. The gate goes on
           the SOUTH boundary (large +Z, facing the living-room facade). */}

      {/* ── 5d-0b. 车道嵌入式 LED 导向线（driveway inset LED runway lines）──
           At dusk/night, two parallel amber LED strips run the length of the
           motor court from gate to building steps. They act as runway approach
           guides and add a dramatic luxury hotel quality to the arrival sequence.
           Additional transverse LED marks every ~3m for a hotel-court grid. */}

      {/* ── 5d-1. 界墙壁灯（wall-mounted lanterns along south boundary wall）──
           Traditional bracket lanterns spaced ~4m apart on the inner face of
           the south boundary wall, providing warm amber pathway lighting at
           dusk and night. */}

      {/* ── 5d-2. 停车位标线 + 门卫岗亭（parking bay markings + security booth）──
           White painted parking bays alongside the driveway and a small
           modern security booth near the east gate pillar. */}
      {false && (() => {
        const bndS8  = D / 2 + 14.50;
        const bndE8  =  W / 2 + 4.50;
        const gateW8 = Math.min(W * 0.30, 3.80);
        const isNightB = sunHour < 6 || sunHour > 20;
        const isDuskB  = !isNightB && (sunHour < 8 || sunHour > 18);
        // Parking bay for sedan (X=0, Z=-D/2-7.80) and SUV (X=2.55, Z=-D/2-8.10)
        const parkZ = D / 2 + 7.90;
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
              <mesh key={`bm-${mi}`} position={[1.80, 0.016, D / 2 + 5.30 - mi * 5.0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[5.00, 0.10]} />
                <meshStandardMaterial color="#E8E8E8" roughness={0.82} />
              </mesh>
            ))}
            {/* Security guard booth — east side of gate, inside boundary */}
            <group position={[gateW8 + 1.50, 0, bndS8 - 1.20]}>
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
              {/* Lantern glow via emissive — no pointLight for perf */}
            </group>
          </group>
        );
      })()}

      {/* ── 5e. 庭院乔木（mature trees at site corners — real GLTF models）──
           Replaces fake sphere/cylinder geometry with real olive + maple models.
           Alternates between old_olive_tree (SW/SE/mid-W) and maple_sugar (NE/NW/mid-E)
           for visual variety. Each has a night in-ground uplight. */}
      {false && (() => {
        // [x, z, targetH, useOlive, rotY]
        const treeData: Array<[number, number, number, boolean, number]> = [
          [ W / 2 + 3.0,  D / 2 + 1.8, 5.5, false, 0.8],   // NE — maple
          [-W / 2 - 3.0,  D / 2 + 1.8, 5.0, false, 2.1],   // NW — maple
          [ W / 2 + 3.0, D / 2 + 5.0, 6.0, true,  1.2],   // SE — olive
          [-W / 2 - 3.0, D / 2 + 5.0, 5.8, true,  3.5],   // SW — olive
          [ W / 2 + 3.5, -D / 2 + 1.0, 5.2, false, 0.4],   // mid-east — maple
          [-W / 2 - 3.5, -D / 2 + 1.0, 5.4, true,  2.8],   // mid-west — olive
        ];
        const isNightT = sunHour < 6 || sunHour > 20;
        const isDuskT  = !isNightT && (sunHour < 8 || sunHour > 18);
        const treeLI   = isNightT ? 4.5 : isDuskT ? 2.2 : 0.0;
        return (
          <group>
            {treeData.map(([tx, tz, tH, useOlive, rotY], ti) => (
              <group key={ti} position={[tx, 0, tz]}>
                <Suspense fallback={null}>
                  <GltfPlant
                    path={useOlive ? OLIVE_PATH : MAPLE_PATH}
                    targetH={tH}
                    rotY={rotY}
                  />
                </Suspense>
                {/* Tree up-light via emissive — no pointLight for perf */}
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 5d-3. 西侧行人侧门（pedestrian side gate, west boundary wall）──
           A single-leaf wrought-iron pedestrian gate set into the west boundary
           wall, approx 3m north of the south-west corner. Two flanking pillars
           (matching main gate style), a steel picket gate leaf, night lanterns,
           and a stone slab path leading east to the main driveway. */}

      {/* ── 5e-0a. 车道两侧棕榈树（palm trees flanking driveway entry — real GLTF）──
           4 tall palm_tree_lowpoly GLTF models at the gate entrance.
           2 per side, heights 5.5–7m for Beverly Hills estate feel. */}
      {false && (() => {
        const dvHalfW3 = 2.20;
        const gateZ3 = D / 2 + 14.50 + 0.40;
        const palmData3: Array<[number, number, number, number]> = [
          // [x, z, targetH, rotY]
          [ dvHalfW3 + 1.20, gateZ3 + 1.20, 6.5, 0.8],
          [ dvHalfW3 + 2.60, gateZ3 + 0.60, 5.8, 1.8],
          [-dvHalfW3 - 1.20, gateZ3 + 1.20, 6.2, 3.5],
          [-dvHalfW3 - 2.60, gateZ3 + 0.60, 7.0, 4.8],
        ];
        return (
          <group>
            {palmData3.map(([px, pz, tH, rotY], pi) => (
              <group key={pi} position={[px, 0, pz]}>
                <Suspense fallback={null}>
                  <GltfPlant path={PALM_PATH} targetH={tH} rotY={rotY} />
                </Suspense>
              </group>
            ))}
          </group>
        );
      })()}

      {/* ── 5e-0. 踏石路径太阳能灯（solar path stake lights along stepping stones）──
           Small stake-style solar LED lights placed alongside the stepping stone
           paths on east and west sides of the driveway. Night-mode glow. */}

      {/* ── 5e-0b. 北庭院藤架拱门（garden arbor arch, north garden entry）──
           A white-painted iron arbor arch marking the transition from the
           south lawn / path into the formal north garden. Draped with
           climbing green vines and small flower clusters. */}
      {false && (() => {
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

      {/* ── 5e-1. 北侧庭院艺术装置（premium garden art installation, north yard）──
           Dual polished-steel sweeping arch sculpture over a circular mirror pool.
           Each arch is a partial torus (240° sweep) of brushed mirror steel,
           leaning outward in a V shape. A floating torus ring caps the apex.
           Ground: large honed black granite pad + 4 LED uplights.
           Night: warm amber spots wash the arches, underwater LED in pool. */}
      {false && (() => {
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
      {false && (() => {
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
      {false && (() => {
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

      {/* ── 5e-1d. 西侧界墙灌木（shrub row along inner west boundary wall — real GLTF）──
           Replaces floating pink/red rose ball clusters with real shrub GLTF models. */}
      {false && (() => {
        const bndW6  = -W / 2 - 4.50;
        const wallT6 = 0.18;
        const wallX6 = bndW6 + wallT6 + 0.40;  // 0.4m inside west wall
        const shrubZStart6 = D / 2 + 1.5;
        const shrubZEnd6   = D / 2 + 12.0;
        const nShrubs6 = 7;
        const shrubStep6 = (shrubZStart6 - shrubZEnd6) / (nShrubs6 - 1);
        return (
          <group>
            {Array.from({ length: nShrubs6 }, (_, si) => {
              const sz = shrubZStart6 - si * shrubStep6;
              const rotY = (si * 1.7 + 1.0) % (Math.PI * 2);
              const shrubPath = si % 3 === 0 ? SHRUB2_PATH : si % 3 === 1 ? HEDGE_PATH : BOXWOOD_PATH;
              return (
                <group key={si} position={[wallX6, 0, sz]}>
                  <Suspense fallback={null}>
                    <GltfPlant path={shrubPath} targetH={1.0} rotY={rotY} />
                  </Suspense>
                </group>
              );
            })}
          </group>
        );
      })()}

      {/* ── 5e-2. 旗杆（flagpole, NE corner of boundary）──
           Stainless steel tapered pole, 8m tall. Flag represented as a
           flat rectangle with subtle drape offset at the fly end. */}

      {/* ── 5f. 庭院绿篱（hedge rows inside boundary wall）── */}

      {/* ── 5f-2. 花坛 + 踏石小径（flower beds + stepping-stone path）──
           East and west garden beds flanking the driveway, filled with layered
           flower clusters.  A stepping-stone path runs the length of the garden. */}

      {/* ── 5g-2. 餐桌区串灯（bistro string lights over dining area）──
           3 catenary string lines of warm globe bulbs spanning from pool
           deck pergola post to nearby tree, creating evening atmosphere. */}

      {/* ── 5g-5. 泳池旁景观大花盆（large ornamental planters on pool deck）──
           4 tall round concrete planters flanking the lounger row, each with a
           slender architectural plant (agave form). Pairs at both ends of the row. */}
      {false && (() => {
        const poolL_pl  = Math.min(D * 0.70, 9.50);
        const poolW_pl  = Math.min(W * 0.78, 11.0);
        const deckBW_pl = 2.80;
        const deckT_pl  = 0.12;
        const pz_pl     = D / 2 + deckBW_pl + poolL_pl / 2 + 0.80;
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
      {false && (() => {
        const poolL_b  = Math.min(D * 0.70, 9.50);
        const poolW_b  = Math.min(W * 0.78, 11.0);
        const deckBW_b = 2.80;
        const deckT_b  = 0.12;
        const pz_b     = D / 2 + deckBW_b + poolL_b / 2 + 0.80;
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
      {false && (() => {
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
      {false && (() => {
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

      {/* ── 5j. 东侧露台篝火盆 / 火坑（outdoor fire pit, east terrace）── */}

      {/* ── 5j-1b. 东侧庭院日式枯山水禅园（Japanese zen garden, east yard NE corner）──
           White raked gravel, flat stepping stones, stone lantern, bamboo fence.
           Positioned in the north-east corner of the east side yard. */}

      {/* ── 5j-1c. 东侧庭院瑜伽/冥想平台（yoga/meditation deck, east yard S section）──
           A 3.0m × 2.4m raised teak deck provides a dedicated mindfulness space
           in the south portion of the east yard. Enclosed on 3 sides by a
           split-bamboo privacy screen with integrated LED strip at top.
           A rolled yoga mat, 2 meditation cushions, and a small incense holder
           add personality. Overhead: a stretched canvas shade sail. */}

      {/* ── 5j-2. 按摩浴缸 / 水疗缸（outdoor spa / hot tub, west of pool）──
           White acrylic shell with blue glowing water, set into a teak timber
           surround deck. Night mode adds strong underwater LED glow. */}

      {/* ── 5j-3. 电动汽车充电桩（EV charging station, west of driveway entrance）──
           Wall-box style charger mounted on a post near the garage/gate area. */}
      {false && (() => {
        // Place near the west boundary, at driveway level, south side
        const bndW5   = -W / 2 - 4.50;
        const chargeX = bndW5 + 0.40;   // just inside west boundary
        const chargeZ = D / 2 + 8.50;  // south end, near gate
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

      {/* ── 5j-5. 室外电影屏幕（outdoor cinema screen, south yard near pool）──
           White projection screen on a stand, with 6 deck chairs and
           a raised projector post. Illuminated white panel at night. */}

      {/* ── 5j-5b. 西侧界墙绿植景观墙（living green wall on west boundary）──
           A 4m × 3m modular green wall panel system on the inner face of the
           west boundary wall, adjacent to the outdoor gym. 10×6 grid of dark
           powder-coated planting modules (each 0.40m × 0.50m), filled with
           green/chartreuse moss/plant varieties. Top mist nozzle rail.
           Night: linear LED wash at top face. */}
      {false && (() => {
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

      {/* ── 5j-7. 宠物围栏区（dog run / pet enclosure, east yard）──
           Galvanised wire mesh fence run for pets: concrete base pads,
           wire panel sections, gate, and a small kennel house with pitched roof. */}

      {/* ── 5k. 雨棚玻璃顶（canopy glazing panel upgrade）── */}
      {!insideBuilding && isGlassVilla && (() => {
        const canopyW3 = Math.min(W * 0.62, 8.0);
        const canopyD3 = 2.0;
        const canopyY3 = FLOOR_H - 0.02;
        const southFaceZ3 = D / 2 + 0.20;
        const canopyZ3 = southFaceZ3 + canopyD3 / 2;
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

      {/* 5l sedan removed */}

      {/* 5l-2 SUV removed */}

      {/* ── 5m. 外立面上打灯（ground-up facade spotlights on south face）──
           4 in-ground uplighters wash the south facade from below.
           Only visible / active in exterior mode. */}
      {!insideBuilding && isGlassVilla && (() => {
        const isNightM  = sunHour < 6 || sunHour > 20;
        const isDuskM   = !isNightM && (sunHour < 8 || sunHour > 18);
        const uplightEmi = isNightM ? 3.2 : isDuskM ? 1.8 : 0.5;
        const uplightLI  = isNightM ? 8.0 : isDuskM ? 4.5 : 0.0;
        const faceZ      = D / 2 + 0.12;  // just south of south facade
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

      {/* ── 5o. 入口东侧背光装饰石材立板（backlit entrance feature wall panel）──
           A tall dark onyx/slate slab (2.4m W × 2.8m H) is mounted 50mm proud
           of the south building face, east of the entrance canopy.
           LED wash: top-mounted spotlights rake the stone face from above.
           Night: subtle warm backlight bleeds from behind the panel edges,
           and a recessed inground uplight washes the stone from below. */}
      {!insideBuilding && isGlassVilla && (() => {
        const stepW_fw   = Math.min(W * 0.50, 5.5);
        const fwX        = stepW_fw / 2 + 1.50;    // east of entrance steps
        const fwZ        = D / 2 + 0.20 - 0.05;   // just proud of south face
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

      {/* ── 6a. 走廊地板 —— 已移除
           历史：原本在 yBase + 0.008（8mm）渲染一张铺满整层 footprint
           的米色 travertine 平面，作为"地板兜底"。
           问题：每间房（含 hallway）的 WalkthroughFloor 已在 yBase + 0.025
           （17mm）渲染各自材质，两层 9mm 高差形成 z-fight + 房间边界外
           travertine 露脸，视觉上像"半透明分层地板"。
           解决：彻底删掉这层。每间房自己的 floor 已经够。 ── */}
      {/* ── 6. 室内渲染（仅室内视角）── */}
      {/* 室内渲染 —— 玻璃幕墙建筑的卖点是透过玻璃看到室内，所以
          结构层（地板/墙/天花板/楼梯/门）外观模式也渲染，但 GLTF
          家具只在 insideBuilding 时加载（否则一次性 50+ GLTF 卡死）。
          hideInterior=true 时 visible=false：Three.js 跳过 projectObject
          遍历这些对象，节省约 120ms JS/帧（拖拽期间内部不可见无所谓）。 */}
      <group visible={insideBuilding || !hideInterior}>
      {/* ── Unique interior wall segments (dedupe across rooms) ──
          Renders each wall ONCE — shared walls between two rooms get
          their door / window cutouts merged. ShapeGeometry plane (zero
          thickness) DoubleSide so both adjoining interiors see an opaque
          wall surface without the inset double-render that produced the
          edge "fin" artefacts. */}
      {wallSegments.map((seg, idx) => {
        if (seg.hideAny) return null;
        // Curtain-wall mode: drop the opaque shell on any building-perimeter
        // plane — the GlassCurtain on that face IS the envelope, and a white
        // wall behind it would make the glass read milky/opaque. Now applies
        // in BOTH exterior AND walkthrough (insideBuilding): the curtain glass
        // renders in walkthrough too (see facadeBlocks gate above), so from
        // inside you look out through transparent glass instead of a solid
        // wall (用户反馈：漫游里幕墙变实墙). Interior partitions (not on a
        // perimeter plane) keep their solid walls.
        if (
          curtainWall &&
          exteriorPlanes.has(`${seg.fi}|${seg.axis}|${Math.round(seg.fixed)}`) &&
          !seg.wallOverridden
        ) return null;
        const CM_l = 0.01;
        const wH = FLOOR_H - 0.01;
        const yBase = yBaseOf(seg.fi);
        const wY = yBase + FLOOR_H / 2;
        const wallLenM = (seg.b - seg.a) * CM_l;
        if (wallLenM <= 0.05) return null;
        // World-coord transform mirrors interiorRooms's cx / cz formula.
        // For a horizontal wall: fixed = plan Y, extent runs along plan-X.
        // For a vertical wall:   fixed = plan X, extent runs along plan-Y.
        // New convention: north = -Z, south = +Z.
        // Plan → world:  worldX = (planX - planOffset.minX) * CM - W/2
        //                worldZ = (planY - planOffset.minY) * CM - D/2
        let pos: [number, number, number];
        let rot: [number, number, number] = [0, 0, 0];
        if (seg.axis === "h") {
          const midPlanX = (seg.a + seg.b) / 2;
          const worldX = (midPlanX - planOffset.minX) * CM_l - W / 2;
          const worldZ = (seg.fixed - planOffset.minY) * CM_l - D / 2;
          // Shape's local X spans 0..wallLenM aligned with worldX direction.
          // Plane default lies in XY, normal +Z. After we shift mesh by
          // -wallLenM/2 in shape-X (to put the wall's middle at our pos),
          // ShapeGeometry orientation matches world XY. Wall is in XZ plane
          // in world (extent along world-X) — rotate around X by 0 keeps
          // shape in XY → plane stands vertical, length along X. ✓
          pos = [worldX - wallLenM / 2, wY - wH / 2, worldZ];
        } else {
          const midPlanY = (seg.a + seg.b) / 2;
          const worldX = (seg.fixed - planOffset.minX) * CM_l - W / 2;
          const worldZ = (midPlanY - planOffset.minY) * CM_l - D / 2;
          // Vertical wall: rotate Y by +π/2 so shape-X axis maps to world -Z.
          // R_y(+π/2) * (1,0,0) = (0,0,-1) = world -Z (northward).
          // Anchor at SOUTH end (large-Z) so pieces extend northward (-Z).
          const topZ = (seg.b - planOffset.minY) * CM_l - D / 2;
          pos = [worldX, wY - wH / 2, topZ];
          rot = [0, Math.PI / 2, 0];
        }
        // 10cm thick BOX wall pieces. Each piece is a separate rectangle
        // from splitWallAroundHoles, so the door/window holes are real
        // 3D gaps in the wall slab — doorways show proper jamb depth
        // from any viewing angle. Door panels use WalkthroughDoor3D (a
        // copy of the shared one) which positions the panel 7cm into the
        // room — clear of the 5cm wall half-thickness, so the panel
        // sits in the room interior past the wall's inner face.
        // Wall thickness: 12cm — proper architectural thickness, jamb
        // depth clearly visible. Walls intrude 6cm into each adjoining
        // room. Floor is flush to boundary (no inset) so it covers the
        // wall's bottom face. WalkthroughDoor3D panel offset (0.08m)
        // sits the door panel ~2cm past the wall's interior face.
        const WALL_T = 0.12;
        const holesM = seg.holes
          .map(h => ({ x: h.x * CM_l, y: h.y * CM_l, w: h.w * CM_l, h: h.h * CM_l }))
          // 竖墙(v)洞方向修正：collectHoles 的 hole.x 从 seg.a(北/小-Z 端)量起，
          // 但下面竖墙渲染把 shape-x=0 锚在 seg.b(南/大-Z 端)向北延伸（见 else
          // 分支 topZ + rotY=+π/2）。两端不一致会把洞镜像到墙的另一头——窗玻璃
          // /门板都按「北端起算」定位（StyledWindow wPos、WalkthroughDoor3D），于是
          // 洞与窗/门错位（共用墙上偏移最明显：客厅西窗一半压实墙、一半空洞发白）。
          // 沿墙长翻转洞 x，使洞回到北端起算，与窗/门对齐。横墙(h)shape-x→+X 与
          // collectHoles 同向，无需翻转。
          .map(h => seg.axis === "v" ? { ...h, x: wallLenM - (h.x + h.w) } : h)
          .filter(h => h.w > 0.01 && h.h > 0.01);
        const pieces = splitWallAroundHoles(wallLenM, wH, holesM);
        return (
          <group key={`wseg-${idx}`} position={pos} rotation={rot}>
            {pieces.map((p, pi) => (
              <WalkthroughWallPiece
                key={`wp-${pi}`}
                position={[p.x + p.w / 2, p.y + p.h / 2, 0]}
                w={p.w} h={p.h}
                thickness={WALL_T}
                pieceX={p.x} pieceY={p.y}
                // In EXTERIOR view, when the user has set a building-wide
                // wallBaseColor (Modern Minimal etc.), repaint every wall
                // segment with that flat colour and drop the texture id —
                // otherwise per-room bath/kitchen tile materials leak
                // through the ConcreteFacade as bright stripes. Walkthrough
                // always keeps the real per-room material.
                wallColor={
                  // Hidden-frame curtain-wall mode: walls that are SHOWN read as
                  // solid WHITE stucco masses; walls hidden in the floor plan are
                  // dropped entirely (seg.hideAny) so the glass curtain alone
                  // remains on that face — a clean single glass layer.
                  (!insideBuilding && curtainWall)
                    ? (exterior.wallBaseColor ?? "#F2EFE8")
                    // 外观图：该面设了「外墙材质」就用它（优先于 wallBaseColor）
                    // —— 让左面板的外墙材质真正驱动外立面（白下木上等）。
                    : (!insideBuilding && seg.extWallColor) ? seg.extWallColor
                    : (!insideBuilding && exterior.wallBaseColor) ? exterior.wallBaseColor : seg.wallColor
                }
                wallId={
                  (!insideBuilding && curtainWall) ? ""
                    : (!insideBuilding && seg.extWallId) ? seg.extWallId
                    : (!insideBuilding && exterior.wallBaseColor) ? ""
                    : seg.wallId
                }
                glassFacade={false}
                glassFacadeColor={exterior.glassColor ?? exterior.glassShellColor ?? "#3A4654"}
                insideBuilding={insideBuilding}
                wallXray={wallXray}
              />
            ))}
          </group>
        );
      })}
      {interiorRooms.map(({ room, fi, cx, cz, yBase, rW, rD, rWcm, rDcm, floorColor, wallColor, placedItems, doors, windows, isStair, isHallway, autoDoor, wallsHidden, floorHidden, ceilingHidden }, ridx) => {
        const wallOpacity = wallXray ? 0.13 : 1.0;
        const isXray = wallXray;
        // 走廊：无内墙、无天花板，仅地板；楼梯间：渲染楼梯几何体
        // 有配置门优先用配置门，否则用自动生成门。车库门加宽到车库门尺寸
        // (与 wallSegments 抠的门洞一致)，使卷帘门正好填满洞。
        const effectiveDoors = (doors.length > 0 ? doors : autoDoor ? [autoDoor] : [])
          .map(d => widenGarageDoor(room, d, rWcm, rDcm));
        return (
          // Fragment instead of <group> — the wrapper had no transform, so
          // it added 1 traversed Object3D per room × floor (~40 dead nodes)
          // for zero rendering benefit. React.Fragment lives in React's tree
          // only; nothing is added to the Three.js scene graph.
          <React.Fragment key={`int-${fi}-${room}`}>
            {/* 内墙现在统一在外层 wallSegments.map 渲染（去重 + 不超出
                房间边界）。这里只留地板/天花板/门/窗等不需要 dedupe
                的元素。 */}
            {/* 走廊天花板不再特判：与所有房间一样由通用 ceilingHidden 控制
                （见下方天花板块 + interiorRooms 默认值——走廊作普通房间默认有顶，
                只有楼梯间默认无顶以贯通竖井）。旧的 isHallway 专属常显顶板会从
                二楼楼梯井开口露出顶面发白成「白色区块」、且绕过 roomWallsHidden
                统一机制，已删除；改由通用 per-room 顶板按房间足迹精确裁剪。 */}
            {/* 地板：显隐统一由 roomWallsHidden.floor 控制（默认值见 interiorRooms
                构建处——上层楼梯间默认隐藏以保持竖直开口）。楼梯间不再特判。 */}
            {!floorHidden && (
              <WalkthroughFloor
                cx={cx} cz={cz} yBase={yBase} rW={rW} rD={rD}
                floorColor={floorColor}
                floorId={floorPlans[fi]?.rooms?.[room]?.materials?.floor?.id ?? ""}
                insideBuilding={insideBuilding}
                bleed={Math.max(0, (exterior.walkthroughFloorBleedCm ?? 0) / 100)}
                depthRank={ridx}
                underlayMargin={Math.max(0, (exterior.walkthroughFloorUnderlayCm ?? 20) / 100)}
              />
            )}
            {/* ── per-room NSWE wall labels rendered as flat 3D Text
                 decals on the inner face of each wall (like wall art). Each
                 room gets its own color so adjacent rooms are easy to tell
                 apart. Code convention: north=-Z (back), south=+Z (front),
                 west=-X (left), east=+X (right). 由 showCompass 开关控制显隐。 ── */}
            {showCompass && insideBuilding && !isStair && !isHallway && (() => {
              const lblY = yBase + 1.5;
              // Treat each room's 4 walls INDEPENDENTLY of any shared-wall
              // dedup — float the decal 30 cm INTO the room from its own
              // wall plane, well clear of the wall thickness (12 cm),
              // any door-panel sitting in the jamb (~8 cm), wall artwork
              // (~6 cm), or the neighbour's identical decal on the other
              // face of a shared wall. From this room's camera it reads as
              // a floating "wall tag" hovering in front of that wall — no
              // possibility of being buried in wall geometry, no possibility
              // of z-fight with anything else, and visible regardless of
              // whether the wall is dedup'd or hidden.
              const eps  = 0.30;
              // Pick a stable color from a small palette using room+floor key
              const palette = [
                '#FF1493','#1E90FF','#32CD32','#FF8C00','#9932CC',
                '#FF4500','#00CED1','#FFD700','#DC143C','#2E8B57',
              ];
              const key = `${fi}:${room}`;
              let hash = 0;
              for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
              const col = palette[hash % palette.length];
              // Bumped from 0.20 → 0.32 so labels are legible at typical
              // walkthrough distance (3–6 m). Plate scales with font.
              const fontSize = 0.32;
              const plaqueSize = fontSize * 1.8;
              const common = {
                fontSize,
                color: col,
                outlineWidth: fontSize * 0.10,
                outlineColor: '#ffffff',
                anchorX: 'center' as const,
                anchorY: 'middle' as const,
              };
              // Backing plate occludes anything behind (e.g. the neighbour
              // room's mirrored text on a shared wall). renderOrder=50 makes
              // the decal group composite AFTER walls within the same depth
              // bucket so it wins z-sorting at sub-mm distances.
              const Decal = ({
                letter, pos, rot,
              }: { letter: string; pos: [number, number, number]; rot: [number, number, number] }) => (
                <group position={pos} rotation={rot} renderOrder={50}>
                  <mesh position={[0, 0, -0.01]} raycast={() => null}>
                    <planeGeometry args={[plaqueSize, plaqueSize]} />
                    <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} toneMapped={false} />
                  </mesh>
                  <Text {...common}>{letter}</Text>
                </group>
              );
              // Anchor strategy: try 25% from the NW corner first, but if
              // the resulting decal would land inside a door/window hole
              // contributed by EITHER room sharing this wall (after the
              // wallSegments dedup OR-merge), shift the anchor to the
              // nearest clear span on the same wall. This fixes the
              // long-standing "shared wall — no NSWE label visible" case
              // where the neighbour's hole punched through the decal
              // landing zone (task #36 / commit dc14513 limitation note).
              const p = floorPlans[fi]?.roomLayout?.[room];
              const dd = floorPlans[fi]?.roomDimensions?.[room];
              const DECAL_Y_CM = 150;          // 1.5 m above wall base
              const DECAL_HALF_CM = 18;        // 18 cm half-width margin (plaque is 30 cm wide)
              // Collect holes from every deduped wallSegment that covers
              // (any portion of) this room's wall. Translate hole x into
              // this wall's local coords (cm from the NW/SW end —
              // matches the same "x grows along plan-X / plan-Y" rule the
              // dedup builder uses).
              const collectBlocked = (axis: "h" | "v", fixed: number, lo: number, hi: number): Array<[number, number]> => {
                const blocked: Array<[number, number]> = [];
                for (const seg of wallSegments) {
                  if (seg.fi !== fi) continue;
                  if (seg.axis !== axis) continue;
                  if (Math.abs(seg.fixed - fixed) > 1) continue;
                  if (seg.a >= hi || seg.b <= lo) continue;
                  const offset = seg.a - lo;
                  for (const h of seg.holes) {
                    // Skip holes that don't intersect the decal's vertical band.
                    if (h.y > DECAL_Y_CM + 10 || h.y + h.h < DECAL_Y_CM - 10) continue;
                    const x0 = Math.max(0, offset + h.x);
                    const x1 = Math.min(hi - lo, offset + h.x + h.w);
                    if (x1 > x0) blocked.push([x0, x1]);
                  }
                }
                return blocked;
              };
              const pickClearAnchor = (wallLenCm: number, blocked: Array<[number, number]>): number => {
                const isClear = (xCm: number) => {
                  if (xCm - DECAL_HALF_CM < 5 || xCm + DECAL_HALF_CM > wallLenCm - 5) return false;
                  for (const [b0, b1] of blocked) {
                    if (xCm + DECAL_HALF_CM > b0 && xCm - DECAL_HALF_CM < b1) return false;
                  }
                  return true;
                };
                const candidates = [0.25, 0.75, 0.5, 0.15, 0.85, 0.35, 0.65, 0.10, 0.90];
                for (const r of candidates) {
                  const x = wallLenCm * r;
                  if (isClear(x)) return x;
                }
                // Final fallback: scan in 5cm steps. If still nothing, just use 0.25.
                for (let x = DECAL_HALF_CM + 5; x < wallLenCm - DECAL_HALF_CM - 5; x += 5) {
                  if (isClear(x)) return x;
                }
                return wallLenCm * 0.25;
              };
              // World x (for N/S walls) and world z (for W/E walls) from a
              // local-cm anchor along that wall.
              const xFromAnchor = (anchorCm: number) => cx - rW / 2 + (anchorCm / 100);
              const zFromAnchor = (anchorCm: number) => cz - rD / 2 + (anchorCm / 100);
              let xQ_N = cx - rW * 0.25, xQ_S = cx - rW * 0.25;
              let zQ_W = cz - rD * 0.25, zQ_E = cz - rD * 0.25;
              if (p && dd) {
                // N wall: axis=h, fixed=p.y,           plan-X range [p.x, p.x+d.width]
                xQ_N = xFromAnchor(pickClearAnchor(rWcm, collectBlocked("h", p.y,            p.x, p.x + dd.width)));
                // S wall: axis=h, fixed=p.y+d.depth,   same plan-X range
                xQ_S = xFromAnchor(pickClearAnchor(rWcm, collectBlocked("h", p.y + dd.depth, p.x, p.x + dd.width)));
                // W wall: axis=v, fixed=p.x,           plan-Y range [p.y, p.y+d.depth]
                zQ_W = zFromAnchor(pickClearAnchor(rDcm, collectBlocked("v", p.x,            p.y, p.y + dd.depth)));
                // E wall: axis=v, fixed=p.x+d.width,   same plan-Y range
                zQ_E = zFromAnchor(pickClearAnchor(rDcm, collectBlocked("v", p.x + dd.width, p.y, p.y + dd.depth)));
              }
              return (
                <group>
                  {/* N wall: back, -Z, faces +Z */}
                  <Decal letter="N" pos={[xQ_N, lblY, cz - rD / 2 + eps]} rot={[0, 0, 0]} />
                  {/* S wall: front, +Z, faces -Z */}
                  <Decal letter="S" pos={[xQ_S, lblY, cz + rD / 2 - eps]} rot={[0, Math.PI, 0]} />
                  {/* W wall: left, -X, faces +X */}
                  <Decal letter="W" pos={[cx - rW / 2 + eps, lblY, zQ_W]} rot={[0, Math.PI / 2, 0]} />
                  {/* E wall: right, +X, faces -X */}
                  <Decal letter="E" pos={[cx + rW / 2 - eps, lblY, zQ_E]} rot={[0, -Math.PI / 2, 0]} />
                </group>
              );
            })()}
            {/* 天花板 — 显隐统一由 roomWallsHidden.ceiling 控制（默认值见
                interiorRooms 构建处——楼梯/走廊默认隐藏）。不再特判 isStair。*/}
            {!ceilingHidden && (
              <mesh position={[cx, yBase + FLOOR_H - 0.025, cz]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
                <planeGeometry args={[rW - 0.04, rD - 0.04]} />
                <meshStandardMaterial color={exterior.roomCeilingColor ?? "#F5F2EE"} roughness={0.88} side={THREE.DoubleSide}
                  emissive="#FFFDF8" emissiveIntensity={insideBuilding ? 0.08 : 0.02}
                  transparent={isXray} opacity={isXray ? 0.08 : 1} depthWrite={!isXray} />
              </mesh>
            )}
            {/* 天花板筒灯（室内模式）—— 4 盏矩形嵌入式灯，不遮挡视线。
                阈值 + 总开关从 ExteriorSettings 读取，便于按风格统一调灯感。 */}
            {/* 该房间若选了具体灯具（用户手选 / AI 改灯 → materials.light.id），
                漫游里就渲染那盏灯的真实造型（复用 效果图 同款 LightFixtureInner，
                visualOnly）。注意：不挂在 ceilingLightsEnabled（那是"通用筒灯"
                的总开关）和 glassRooms 门控下——用户点名选的灯具不该被它们误杀。 */}
            {insideBuilding && ((exterior.circulationDecor ?? false) || (!isStair && !isHallway)) && (() => {
              const lightMat = floorPlans[fi]?.rooms?.[room]?.materials?.light;
              if (!lightMat?.id) return null;
              return (
                <group position={[cx, yBase, cz]}>
                  <WalkthroughRoomLight
                    room={room} lightId={lightMat.id}
                    color={lightMat.color ?? "#FFF5D0"} H={FLOOR_H}
                  />
                </group>
              );
            })()}
            {insideBuilding && (exterior.ceilingLightsEnabled ?? true) && ((exterior.circulationDecor ?? false) || (!isStair && !isHallway)) && !glassRooms.has(`${fi}:${room}`) && (() => {
              // 选了具体灯具的房间走上面的真实灯型，这里只给"没选灯"的房间
              // 渲染默认筒灯阵列，避免两套灯叠加。
              if (floorPlans[fi]?.rooms?.[room]?.materials?.light?.id) return null;
              const roomArea = rW * rD;
              const lgA = Math.max(4, Math.min(40, exterior.ceilingLightLargeArea ?? 12));
              const mdA = Math.max(2, Math.min(lgA, exterior.ceilingLightMediumArea ?? 6));
              const lightCount = roomArea > lgA ? 4 : roomArea > mdA ? 2 : 1;
              // Configurable can size + glow intensity. Inner emissive disc
              // stays 1.5 cm smaller than the housing so the bezel reads.
              const rOuter = Math.max(0.04, Math.min(0.15, (exterior.ceilingLightRadiusCm ?? 8) / 100));
              const rInner = Math.max(0.02, rOuter - 0.015);
              const emiI   = Math.max(0.5, Math.min(6.0, exterior.ceilingLightIntensity ?? 3.5));
              const emiC   = exterior.ceilingLightColor ?? "#FFF5D0";
              const offsets: [number, number][] = lightCount === 4
                ? [[-rW*0.26, -rD*0.26], [rW*0.26, -rD*0.26], [-rW*0.26, rD*0.26], [rW*0.26, rD*0.26]]
                : lightCount === 2
                ? [[-rW*0.22, 0], [rW*0.22, 0]]
                : [[0, 0]];
              return offsets.map(([ox, oz], li) => (
                <group key={`clight-${li}`} position={[cx + ox, yBase + FLOOR_H - 0.02, cz + oz]}>
                  {/* 嵌入式筒灯外壳 */}
                  <mesh raycast={() => null}>
                    <cylinderGeometry args={[rOuter, rOuter, 0.02, 12]} />
                    <meshStandardMaterial color="#E0E0DC" roughness={0.4} metalness={0.25} />
                  </mesh>
                  {/* 发光灯片 (emissive only — see comment below) */}
                  <mesh position={[0, -0.005, 0]} raycast={() => null}>
                    <cylinderGeometry args={[rInner, rInner, 0.005, 12]} />
                    <meshStandardMaterial color="#FFFCE8" emissive={emiC} emissiveIntensity={emiI} roughness={0.3} />
                  </mesh>
                  {/* Previous version emitted a real pointLight per spot
                      — but 1-4 per room × 12 rooms blew past WebGL's
                      light-uniform budget and stuttered walkthrough.
                      The emissive disc still reads as a visible warm
                      ceiling source; actual illumination falls to the
                      scene-wide directionalLight + ambient. */}
                </group>
              ));
            })()}
            {/* 踢脚线（室内模式）—— 沿四墙底部，高度+色由 ExteriorSettings 决定 */}
            {insideBuilding && (exterior.skirtingEnabled ?? true) && ((exterior.circulationDecor ?? false) || (!isStair && !isHallway)) && !glassRooms.has(`${fi}:${room}`) && (() => {
              const skH = Math.max(0.04, Math.min(0.20, (exterior.skirtingHeight ?? 8) / 100));
              const skT = Math.max(0.005, Math.min(0.04, (exterior.skirtingThicknessCm ?? 1.2) / 100));
              const skColor = exterior.skirtingColor ?? "#9C8A70";
              const END_INSET = 0.02;   // stop 2cm short of each corner
              const DOOR_MARGIN = 0.06; // clearance each side of a door opening
              // Door openings reach the floor, so a full-width skirting strip
              // would float across the threshold and read as a bright "白线"
              // on the floor at open room↔room boundaries. Break the strip
              // around every door opening on that wall. Mapping matches
              // WalkthroughDoor3D's groupPos so the gap lands on the door.
              const sideGaps = (side: "N" | "S" | "E" | "W"): Array<[number, number]> => {
                const out: Array<[number, number]> = [];
                for (const d of effectiveDoors) {
                  if (d.wall !== side) continue;
                  const dW = (d.len ?? 90) / 100;
                  let s: number;
                  if (side === "E") {
                    const dPos = Math.max(0, rDcm - d.pos) / 100;
                    s = rD / 2 - dPos - dW;
                  } else if (side === "W") {
                    s = -rD / 2 + d.pos / 100;
                  } else { // N or S — door runs along X
                    s = -rW / 2 + d.pos / 100;
                  }
                  out.push([s - DOOR_MARGIN, s + dW + DOOR_MARGIN]);
                }
                return out;
              };
              const split = (L: number, gaps: Array<[number, number]>): Array<{ c: number; len: number }> => {
                const half = L / 2 - END_INSET;
                const g = gaps.slice().sort((a, b) => a[0] - b[0]);
                const segs: Array<{ c: number; len: number }> = [];
                let cur = -half;
                for (const [gs, ge] of g) {
                  const cs = Math.max(-half, gs), ce = Math.min(half, ge);
                  if (ce <= cur) continue;
                  if (cs > cur) segs.push({ c: (cur + cs) / 2, len: cs - cur });
                  cur = Math.max(cur, ce);
                }
                if (cur < half) segs.push({ c: (cur + half) / 2, len: half - cur });
                return segs.filter(sg => sg.len > 0.03);
              };
              const nSegs = split(rW, sideGaps("N"));
              const sSegs = split(rW, sideGaps("S"));
              const eSegs = split(rD, sideGaps("E"));
              const wSegs = split(rD, sideGaps("W"));
              return (
                <group position={[cx, yBase + skH / 2, cz]} raycast={() => null}>
                  {/* 北墙踢脚 (physical z = +rD/2) — break around S-wall doors */}
                  {sSegs.map((sg, i) => (
                    <mesh key={`skN-${i}`} position={[sg.c, 0,  rD / 2 - skT / 2 - 0.004]} rotation={[0, Math.PI, 0]}>
                      <boxGeometry args={[sg.len, skH, skT]} />
                      <meshStandardMaterial color={skColor} roughness={0.75} />
                    </mesh>
                  ))}
                  {/* 南墙踢脚 (physical z = -rD/2) — break around N-wall doors */}
                  {nSegs.map((sg, i) => (
                    <mesh key={`skS-${i}`} position={[sg.c, 0, -rD / 2 + skT / 2 + 0.004]}>
                      <boxGeometry args={[sg.len, skH, skT]} />
                      <meshStandardMaterial color={skColor} roughness={0.75} />
                    </mesh>
                  ))}
                  {/* 东墙踢脚 (physical x = +rW/2) */}
                  {eSegs.map((sg, i) => (
                    <mesh key={`skE-${i}`} position={[ rW / 2 - skT / 2 - 0.004, 0, sg.c]} rotation={[0, -Math.PI / 2, 0]}>
                      <boxGeometry args={[sg.len, skH, skT]} />
                      <meshStandardMaterial color={skColor} roughness={0.75} />
                    </mesh>
                  ))}
                  {/* 西墙踢脚 (physical x = -rW/2) */}
                  {wSegs.map((sg, i) => (
                    <mesh key={`skW-${i}`} position={[-rW / 2 + skT / 2 + 0.004, 0, sg.c]} rotation={[0,  Math.PI / 2, 0]}>
                      <boxGeometry args={[sg.len, skH, skT]} />
                      <meshStandardMaterial color={skColor} roughness={0.75} />
                    </mesh>
                  ))}
                </group>
              );
            })()}
            {/* 门：外观模式 + 本层有任何玻璃房间 → 跳过本层所有内部门：
                非玻璃房间（主卧/书房）的门也会从邻居玻璃幕墙看进来变
                "立柱"。门是内视角装饰，对外观无贡献，安全跳过。 */}
            {(!isStair || (exterior.renderStairOpenings ?? true)) && effectiveDoors.map((door, di) => {
              // Use the SAME RoomDoor3D component the effect page uses
              // (shared module). Single source of truth for door visuals.
              const dHcm = door.h ?? (exterior.interiorDoorHeightCm ?? 240);
              // 门样式单一真源 = 效果图：与 RoomCanvas 完全同序
              //   per-door door.style → roomDoorStyle[room] → "wood_panel"。
              // 历史：这里曾给 客厅一层入户自动门 特判成 french_double（白色
              // 双开玻璃门），导致「漫游=白双开玻璃 / 效果图=灰木门」不一致
              // （用户反馈：客厅的门三视图不一致）。改为直接读效果图的
              // roomDoorStyle，三视图门样式从此一致。
              // 幕墙玻璃外立面上的门：强制用 french_double(双扇玻璃门)——
              // 既是通透玻璃门、又走 WalkthroughDoor3D 的开关动画(可点击推开)，
              // 替代原来 GlassCurtain 的静态装饰门(用户：幕墙门能推开吗)。
              // 其余面(普通实墙/内门)仍按效果图门样式。
              const _doorOnGlassFace = curtainWall && (() => {
                const _dpl = floorPlans[fi]?.roomLayout?.[room];
                const _ddm = floorPlans[fi]?.roomDimensions?.[room];
                if (!_dpl || !_ddm) return false;
                const _dax = (door.wall === "N" || door.wall === "S") ? "h" : "v";
                const _dwc = door.wall === "S" ? _dpl.y + _ddm.depth
                           : door.wall === "N" ? _dpl.y
                           : door.wall === "E" ? _dpl.x + _ddm.width
                           :                      _dpl.x;
                return exteriorPlanes.has(`${fi}|${_dax}|${Math.round(_dwc)}`);
              })();
              // 外观模式 + 本层有玻璃房间：跳过「内部门」(非玻璃面的门会从邻居
              // 玻璃幕墙看进来变成立柱状)，但 perimeter 玻璃外立面上的「入户门」
              // 要照常渲染——那正是透过幕墙看到、且能点击推开的那道玻璃门。
              // 车库例外：车库是实墙房间、它的门(尤其卷帘门)要照常渲染成可点击的
              // WalkthroughDoor3D，不能被「本层有玻璃房间就跳过」误伤。
              if (!insideBuilding && !_doorOnGlassFace && room !== "garage"
                  && !glassRooms.has(`${fi}:${room}`)
                  && (floorPlans[fi]?.enabledRooms ?? []).some(r => glassRooms.has(`${fi}:${r}`))) {
                return null;
              }
              const _cfgDoorStyle = door.style ?? floorPlans[fi]?.roomDoorStyle?.[room];
              const style: import("@/lib/types").DoorStyle = _doorOnGlassFace
                // 幕墙玻璃面：用通透玻璃门。用户若指定了玻璃平开/玻璃推拉就用其一，
                // 否则默认玻璃平开门(glass_swing)。两种都是新增的玻璃门样式。
                ? (_cfgDoorStyle === "glass_slide" || _cfgDoorStyle === "glass_swing" ? _cfgDoorStyle : "glass_swing")
                : (_cfgDoorStyle ?? "wood_panel");
              // Wall mapping: FPE data → WalkthroughDoor3D — both use NSWE now.
              const doorWall: import("@/lib/types").WallSide = door.wall;
              // WalkthroughDoor3D "E" (east/right) measures pos from the large-Z (south) end.
              // FPE.pos for "E" is from the small-Z (north) end. So mirror.
              // "W" (west/left) is direct: both measure from the small-Z (north) end.
              // 幕墙玻璃门:吸附到所在竖挺分格(填满整格、左右贴住竖挺当门框)。
              const _snap = _doorOnGlassFace
                ? curtainOpeningSnap.get(`d:${fi}:${room}:${door.wall}:${Math.round(door.pos)}`)
                : undefined;
              const _basePos = _snap ? _snap.posCm : door.pos;
              const doorPosCm = door.wall === "E"
                ? Math.max(0, rDcm - _basePos)
                : _basePos;
              const _doorLenCm = _snap ? _snap.lenCm : door.len;
              const doorKey = `door|${fi}|${room}|${di}`;
              const isOpen = openMap.get(doorKey) ?? false;
              return (
                <group key={`door-${fi}-${room}-${di}`} position={[cx, yBase, cz]}>
                  <WalkthroughDoor3D
                    W={rW} D={rD} H={FLOOR_H - 0.01}
                    doorWall={doorWall}
                    doorPosCm={doorPosCm}
                    doorLenCm={_doorLenCm}
                    doorHCm={_doorOnGlassFace
                      // 幕墙玻璃门做成近满层高的落地玻璃门 —— 填满整格、消除门上方
                      // 那段「空玻璃」(用户：门上方空的干嘛呢)。留 ~10cm 作顶横档。
                      ? Math.round((FLOOR_H - 0.10) * 100)
                      : dHcm}
                    isOpen={isOpen}
                    onToggle={() => { if (insideBuilding || (exterior.exteriorInteractiveOpenings ?? true)) toggleOpen(doorKey); }}
                    doorStyle={style}
                    frameColor={insideBuilding
                      ? (exterior.interiorDoorFrameColor ?? "#EFEAE2")
                      : _doorOnGlassFace
                        // 幕墙玻璃门：门框用幕墙竖挺同色的黑(借助幕墙钢筋当框、
                        // 融进网格),靠外置竖向长拉手表明是门(用户:借助幕墙钢筋、
                        // 外面加把手)。可用 exterior.curtainDoorFrameColor 覆盖。
                        ? ((exterior as { curtainDoorFrameColor?: string }).curtainDoorFrameColor
                            ?? exterior.entranceFrameColor ?? "#181A20")
                      : (exterior.transparentExterior ?? true)
                        // 透明立面外观图：和窗框同理——大白天近白门框会糊进近白墙里，
                        // 门「消失」。给门框一个有存在感的中性轮廓色（默认与窗框同一
                        // 暖灰 #6E6A60），门立刻能从墙体里读出来。可配置。
                        ? (exterior.transparentExteriorDoorFrameColor ?? exterior.transparentExteriorFrameColor ?? "#6E6A60")
                        : (exterior.doorFrameColor ?? "#F0EEEA")}
                    handleColor={_doorOnGlassFace
                      // 幕墙玻璃门借用幕墙竖挺当门框，把手必须是不锈钢银色才能从黑色
                      // 竖挺/深色玻璃里读出来；沿用全局 doorHandleColor(常为近黑)会糊掉。
                      ? ((exterior as { curtainDoorHandleColor?: string }).curtainDoorHandleColor ?? "#C8CDD2")
                      : (exterior.doorHandleColor ?? "#B8A060")}
                    outwardProtrude={insideBuilding ? 0 : (exterior.exteriorDoorProtrude ?? 0.16)}
                  />
                </group>
              );
            })}

            {/* 窗框：在有窗户的墙面渲染共享 <StyledWindow>（嵌在墙洞内）。
                · 室内漫游（insideBuilding）：始终渲染。
                · 外观图（!insideBuilding）：当 transparentExterior（默认开）时也
                  渲染 —— 因为此时 ConcreteFacade 实心立面层已关闭，窗洞露出，
                  透明玻璃可隔窗看到室内，窗型/玻璃/墙色与效果图完全一致。
                · transparentExterior=false（旧实心立面）：外观图不渲染这里的窗，
                  外立面窗户完全交给 ConcreteFacade，避免双层窗重叠。 */}
            {(!isStair || (exterior.renderStairOpenings ?? true)) && (insideBuilding || (exterior.transparentExterior ?? true) || curtainWall) && windows.map((win, wi) => {
              // 幕墙面也渲染共享 <StyledWindow>：用户要门窗「看得出来 + 能开关」，
              // 所以幕墙玻璃面上配置的窗仍画出可见的开启扇(带开关动画)，而不是
              // 完全并进整片玻璃看不见。(之前为「纯通透」跳过过，现按用户要求恢复)
              // 该窗是否落在「玻璃幕墙面」(exteriorPlanes)——是则参与幕墙竖挺分格、
              // 吸附到它那一格(与门同理);否则是普通实墙上的窗,保持原 pos/len。
              const _winOnGlassFace = curtainWall && (() => {
                const _wpl = floorPlans[fi]?.roomLayout?.[room];
                const _wdm = floorPlans[fi]?.roomDimensions?.[room];
                if (!_wpl || !_wdm) return false;
                const _wax = (win.wall === "N" || win.wall === "S") ? "h" : "v";
                const _wwc = win.wall === "S" ? _wpl.y + _wdm.depth
                           : win.wall === "N" ? _wpl.y
                           : win.wall === "E" ? _wpl.x + _wdm.width
                           :                     _wpl.x;
                return exteriorPlanes.has(`${fi}|${_wax}|${Math.round(_wwc)}`);
              })();
              // 幕墙玻璃面上的窗:吸附到它所在的竖挺分格(填满整格、左右贴竖挺),
              // 与 GlassCurtain 用同一套 buildCurtainLayout → 永远不跨挺、不留缝。
              const _winSnap = _winOnGlassFace
                ? curtainOpeningSnap.get(`w:${fi}:${room}:${win.wall}:${Math.round(win.pos)}`)
                : undefined;
              const wW   = _winSnap ? _winSnap.lenCm * CM : win.len * CM;
              const wH   = (win.h    ?? defWinH) * CM;
              const wSill = (win.sill ?? defWinSill)  * CM;
              const wPos  = (_winSnap ? _winSnap.posCm : win.pos) * CM;
              // wPos and wW are already in metres — no extra * CM needed
              let wx = 0, wz = 0, rotY = 0;
              if (win.wall === "N") {
                // N = SVG top = small planY = small worldZ (north wall, -Z face)
                wz = cz - rD / 2 + 0.012;
                wx = cx + wPos + wW / 2 - rW / 2;
                rotY = Math.PI;
              } else if (win.wall === "S") {
                // S = SVG bottom = large planY = large worldZ (south wall, +Z face)
                wz = cz + rD / 2 - 0.012;
                wx = cx + wPos + wW / 2 - rW / 2;
                rotY = 0;
              } else if (win.wall === "W") {
                // pos grows from N (small-Z) end
                wx = cx - rW / 2 + 0.012;
                wz = cz - rD / 2 + wPos + wW / 2;
                rotY = -Math.PI / 2;
              } else {
                // pos grows from N (small-Z) end
                wx = cx + rW / 2 - 0.012;
                wz = cz - rD / 2 + wPos + wW / 2;
                rotY = Math.PI / 2;
              }
              const frameCy   = yBase + wSill + wH / 2;
              // Walkthrough window now reads ExteriorSettings so it stays
              // visually consistent with what's shown from outside.
              // Indoors the dark exterior mullion color reads as an ugly black
              // frame, so interior walkthrough uses a light natural frame color
              // (configurable). Exterior facade keeps the dark accent mullion.
              // 窗框配色三态：
              // · 室内漫游（insideBuilding）：白框 WINDOW_FRAME_COLOR（= 效果图同源），
              //   室内看深色框很丑；可被 interiorWindowFrameColor 覆盖。
              // · 透明立面外观图（!insideBuilding + transparentExterior）：用「有
              //   存在感」的中性框色 transparentExteriorFrameColor（默认暖灰 #6E6A60）。
              //   因为从外面大白天看，白框会糊进近纯白的墙里 → 窗户消失；给框一个
              //   明确的轮廓色，窗户立刻能读出来（像外观漫游图那样清晰）。
              // · 旧实心立面外观（transparentExterior=false）：深色立面窗梃。
              const frameCol  = insideBuilding
                ? (exterior.interiorWindowFrameColor ?? WINDOW_FRAME_COLOR)
                : (exterior.transparentExterior ?? true)
                  ? (exterior.transparentExteriorFrameColor ?? exterior.windowFrameColor ?? "#6E6A60")
                  : (exterior.windowFrameColor ?? exterior.accentColor ?? "#3A4150");
              // 外立面窗框反射强度（可配置）。默认很低，避免框体镜面化
              // 把明亮的天空 HDR 反射成接近墙体的奶油白 → 窗户消失。
              const winKey = `window|${fi}|${room}|${wi}`;
              const winOpen = openMap.get(winKey) ?? false;
              // 幕墙别墅:配置的窗统一做成「上悬开启扇」(顶铰、底边外顶,参考实拍幕墙
              // 通风扇),带框 + 执手 + 开关动画。其余(非幕墙)按效果图配置的窗型。
              const winStyle: import("@/lib/types").WindowStyle =
                curtainWall ? "awning" : (win.style ?? "sliding");
              // 玻璃参数两套：
              // · 室内漫游（insideBuilding）：高通透（transmission 0.85 /
              //   opacity 0.35），便于透窗看院子，从里看本就对比强。
              // · 外观图（!insideBuilding）：大白天从外面看，全透玻璃显示的
              //   颜色≈墙色 → 窗户糊进墙里看不见。改用「可见的有色反光玻璃」
              //   （低通透 + 偏蓝灰 + 一定反射），窗户立刻像真实建筑玻璃一样
              //   明显跳出。全部可配置，0/默认可调。
              // 注意：transmission>0 会让玻璃「折射式透视」背景，薄玻璃（厚 1cm）
              // 几乎不着色 → 大白天透出明亮背景 = 一片惨白。所以外观图玻璃
              // 默认 transmission=0，纯靠 opacity + 偏蓝灰 color 做成「可见的
              // 半透实体玻璃面板」，从外面立刻能读出门窗。
              const exView = !insideBuilding;
              // 窗玻璃通透只在幕墙模式开启：开窗/开门透过洞口看到真实室内(配套
              // openingRooms 跳过盒子)。普通立面(punched-window)保留原「可见的反光
              // 半透实体玻璃」(transmission=0 / opacity≈0.82)——否则窗户半透半反、
              // 通透窗玻璃（所有立面）：开窗/开门透过洞口看到真实室内（配套
              // openingRooms 跳过洞后实心盒子）。室内漫游恒为高通透。
              const gTrans = exView ? (exterior.exteriorWindowGlassTransmission ?? 0.9) : 0.85;
              const gOpac  = exView ? (exterior.exteriorWindowGlassOpacity ?? 0.14) : 0.35;
              const gColor = exView
                ? (exterior.exteriorWindowGlassColor ?? "#8FA3B2")
                : (exterior.interiorWindowGlassColor ?? WINDOW_GLASS_COLOR);
              const gEnv   = exView ? (exterior.exteriorWindowGlassEnvMapIntensity ?? 0.35) : 0.25;
              const gRough = exView ? (exterior.exteriorWindowGlassRoughness ?? 0.06) : 0.08;
              // 外观图玻璃「凸出墙面」：经实测，玻璃面 wallOffset=0 时落在墙体
              // 厚度（WALL_T=0.12m）中线 → 大白天斜视角下被墙体几何挡住（实测
              // 把玻璃 depthTest 关掉才看得到 → 证明被遮挡而非颜色问题）。把外观
              // 玻璃往外推到墙体前表面之外（默认 0.06m，略大于半墙厚 0.06），
              // 玻璃永不被墙挡，门窗立刻能从墙体里读出来。可配置。
              const gOffset = exView ? (exterior.exteriorWindowProtrude ?? 0.06) : 0;
              // 幕墙别墅的上悬开启扇:玻璃必须与幕墙「视觉玻璃」完全同色、同透、同反射,
              // 否则开启扇是一块更透更亮的玻璃 → 与幕墙「颜色分离」(用户:窗户透明、和
              // 幕墙颜色分离)。对齐 GlassCurtain cell 视觉玻璃的实际取值:
              // color glassColor??#93AEC8 / opacity 0.22 / transmission 0.68 /
              // envMapIntensity 2.0 / roughness 0.04。关窗时窗与幕墙浑然一体,
              // 开窗时上悬扇顶开、透过它后面那格的窗洞看进房间。
              const curtainSash = curtainWall && exView;
              const wGColor = curtainSash ? (exterior.glassColor ?? "#93AEC8") : gColor;
              const wGOpac  = curtainSash ? 0.22 : gOpac;
              const wGTrans = curtainSash ? 0.68 : gTrans;
              const wGEnv   = curtainSash ? 2.0  : gEnv;
              const wGRough = curtainSash ? 0.04 : gRough;
              const wFrameWidth = curtainSash ? 0.06 : undefined;  // 加宽铝框
              return (
                <group key={`win-${fi}-${room}-${wi}`} position={[wx, frameCy, wz]} rotation={[0, rotY, 0]}>
                  {/* 共享 <StyledWindow>，按 win.style 渲染（推拉/百叶/平开/
                      固定/木窗/防盗）。玻璃参数随视图切换（见上）。 */}
                  <StyledWindow
                    winLen={wW}
                    winH={wH}
                    style={winStyle}
                    isOpen={winOpen}
                    onToggle={() => toggleOpen(winKey)}
                    frameColor={frameCol}
                    glassColor={wGColor}
                    glassTransmission={wGTrans}
                    glassOpacity={wGOpac}
                    glassRoughness={wGRough}
                    glassEnvMapIntensity={wGEnv}
                    frameWidth={wFrameWidth}
                    wallOffset={gOffset}
                    // 外观图给百叶窗叶片用对比框色（默认暖灰），并在叶片后加 tinted
                    // 玻璃背板，否则百叶在大白天透出墙体发白「像没渲染」。
                    mullionColor={exView ? frameCol : undefined}
                    glassBehindLouver={exView}
                  />
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
              {/* 天台层家具的单一渲染者是 RooftopDecorations（全精度
                  PlacedItemMesh，露天可见所以不走低 LOD 彩色 box）。这里
                  若再渲染一遍，露台家具会叠出一个低 LOD 占位 box —— 例如
                  廊架(pergola)会在真实木条顶之下多出一只橙色实心盒子。
                  故跳过 fi === roofFi，避免与 RooftopDecorations 重复渲染。 */}
              {fi !== roofFi
                // curtain-wall：玻璃房间也渲染真实 placedItems 低 LOD（透过通透
                // 玻璃看到用户在平面图实际摆放的家具，而非通用模板剪影）。
                // 旧逻辑「本层有玻璃房间就整层跳过家具」只服务于 isGlassVilla
                // 的模板剪影方案，幕墙模式下绕过它。
                && (curtainWall || !(!insideBuilding && (floorPlans[fi]?.enabledRooms ?? []).some(r => glassRooms.has(`${fi}:${r}`))))
                && placedItems
                .filter(p => {
                  // Curtains: hide in low-LOD 效果图 ONLY when the facade is
                  // opaque (legacy isGlassVilla / punched-window) — they'd be
                  // invisible behind a solid wall anyway. In curtain-wall mode
                  // the glass is see-through, so curtains SHOULD show through it
                  // (user request). Walkthrough always renders them.
                  if (!insideBuilding && !curtainWall) {
                    const fItem = getFurnitureById(p.furnitureId);
                    if (fItem?.category === "curtain") return false;
                  }
                  return true;
                })
                .map(p => {
                  const modP = p;
                  const fItem = getFurnitureById(p.furnitureId);
                  // Items that need wall-mount / specialised positioning
                  // (artwork, upper kitchen cabinets) delegate to
                  // PlacedItemMesh in BOTH modes — it's the single source
                  // of truth for those placements. Artwork loads only a
                  // canvas texture and cabinet-upper is procedural boxes,
                  // both cheap enough for the effect view's LOD budget.
                  // curtain-wall 外观图：透过通透玻璃看到的家具用全精度 GLTF
                  // （PlacedItemMesh），而非低 LOD 彩色 box —— 用户要求真实模型。
                  // 仍逐件 <Suspense>，且 fallback 用 box 占位：GLTF 流式加载时
                  // 先显示 box，加载完原地替换，避免一次性 50+ GLTF 的空窗期。
                  // 外观图里凡是「盒子被跳过、室内可透过门窗看到」的房间(玻璃房间
                  // 或有开洞的房间)都用全精度 GLTF——透过通透门窗看到的是真实家具，
                  // 而非低 LOD 彩色 box。其余外观房间(盒子仍在、看不到内部)保留 box 省开销。
                  const seeThroughRoom = !insideBuilding
                    && (glassRooms.has(`${fi}:${room}`) || openingRooms.has(`${fi}:${room}`));
                  const needsPlacedMesh =
                    insideBuilding
                    || seeThroughRoom
                    || fItem?.category === "artwork"
                    || (fItem ? STAIR_FURNITURE_IDS.has(fItem.id) : false)
                    || fItem?.id?.includes("cabinet-upper");
                  // Low-LOD box proxy（也作 GLTF 的 Suspense fallback）。
                  // 位置/尺寸算法和 PlacedItemMesh 内部保持一致。
                  const proxyBox = (() => {
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
                  })();
                  if (needsPlacedMesh) {
                    // 地毯专属抬升：地毯是贴地薄片(1.5cm)，PlacedItemMesh 把它放在
                    // group 的 yBase 上 → 整片沉在真实楼板(yBase+0.025)之下被盖住。
                    // 只把「地毯」抬到楼板面之上(0.03)，配合 Rug 材质的 polygonOffset
                    // 让它稳定画在楼板前面，外观图里就能透过落地玻璃看到。其余家具
                    // 够高，不抬，避免悬空。
                    const rugLiftY = fItem?.category === "rug" ? 0.03 : 0;
                    return (
                      <Suspense key={p.instanceId} fallback={proxyBox}>
                        <group position={[0, rugLiftY, 0]}>
                          <PlacedItemMesh placed={modP} def={ROOM_DEFS[room]} roomW={rW} roomD={rD} room={room} />
                        </group>
                      </Suspense>
                    );
                  }
                  if (!fItem) return null;
                  return <group key={p.instanceId}>{proxyBox}</group>;
                })}
            </group>
            {/* ── §10 walkthrough LOD detail: crown molding + 吸顶灯。Only
                 mounts inside the building so the exterior view stays
                 unchanged. Stair / hallway skipped by default — they
                 shouldn't have residential trim; exterior.circulationDecor
                 打开后通行空间也加室内细节。
                 天花板隐藏的房间（如全隐藏的露天露台/天台休息区）不挂：天花线
                 与吸顶灯都是「盖顶」装饰，房间既无天花板就不该悬空出现 ——
                 复用通用的 ceilingHidden，不特判房间类型。 ── */}
            {insideBuilding && !ceilingHidden && ((exterior.circulationDecor ?? false) || (!isStair && !isHallway)) && (
              <InteriorRoomDetail
                cx={cx}
                cz={cz}
                yBase={yBase}
                rW={rW}
                rD={rD}
                wallColor={wallColor}
              />
            )}
          </React.Fragment>
        );
      })}
      </group>
    </group>
  );
}

// Preload all GLTF models used in this file so they are fetched before first render
useGLTF.preload(CYPRESS_PATH);
useGLTF.preload(PALM_PATH);
useGLTF.preload(OLIVE_PATH);
useGLTF.preload(MAPLE_PATH);
useGLTF.preload(SHRUB2_PATH);
useGLTF.preload(BOXWOOD_PATH);
useGLTF.preload(HEDGE_PATH);
useGLTF.preload(LOUNGER_PATH);
