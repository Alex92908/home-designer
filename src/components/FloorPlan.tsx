"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, WindowConfig, WallSide, FacadeLayer, resolveFacadeLayer, resolveFaceOpacity } from "@/lib/types";
import { FloorPlanMinimap } from "./FloorPlanMinimap";
import { getFurnitureById } from "@/lib/furniture";
import { PlacedItem } from "@/lib/types";
import { useT, useLocale , customRoomDisplayName} from "@/lib/i18n";
import { getFurnitureNameEn } from "@/locales/itemNames";
import { evaluateRoom, type EvaluatedItem, type DoorWall as ClearanceDoorWall } from "@/lib/clearance";
import { pointInPolygon, getEdges } from "@/lib/roomGeometry";

const EMPTY_WINDOWS: never[] = [];
import { RoomState } from "@/lib/store";
const EMPTY_ROOM_STATE: RoomState = { materials: {}, placedItems: [] };

// ─── helpers ──────────────────────────────────────────────

function getSVGPoint(e: React.PointerEvent, svg: SVGSVGElement, zoom = 1): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
}

// ─── Drag state for furniture ────────────────────────────

interface DragState {
  startSvgX: number;
  startSvgZ: number;
  items: Array<{ instanceId: string; startX: number; startZ: number }>;
  /** B4 视觉反馈：当前帧因为撞到障碍被拒绝完整移动的 instanceId 集合。
   *  渲染时这些家具会有红色 outline + 抖动一下，让用户知道"挪不动"。 */
  blockedIds?: string[];
}

// ─── Window drag state ────────────────────────────────────

interface WinDrag {
  id: string;
  wall: WallSide;
  handle: "move" | "start" | "end";
  startMouse: number;
  origPos: number;
  origLen: number;
}

// ─── Door drag state ──────────────────────────────────────

interface DoorDrag {
  id: string;
  wall: WallSide;        // unified cardinal naming (N/S/W/E)
  startMouse: number;    // x for N/S walls, y for W/E walls
  origPos: number;
  wallLen: number;       // cm, for clamping
  doorLen: number;       // cm
  isPolygonEdge: boolean; // polygon-edge doors can't be moved (skip)
}

// ─── Single placed item in SVG ────────────────────────────

interface PlacedItemSVGProps {
  placed: PlacedItem;
  scale: number;
  isSelected: boolean;
  /** B4 视觉反馈：拖拽时被障碍卡住的家具。渲染时叠一层亮红 outline，
   *  立即视觉反馈"挪不动了"。和 hasViolation 区分（后者是稳定的
   *  clearance 警告，blocked 是瞬时拒绝）。 */
  isBlocked?: boolean;
  hasViolation?: boolean;
  violationSeverity?: "required" | "recommended";
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
}

/** Split a display name into at most 2 lines that fit within `maxPx` pixels at font-size 8. */
function splitNameLines(name: string, maxPx: number): [string] | [string, string] {
  // Approx char width: CJK ≈ 8px, ASCII ≈ 5px at font-size 8
  const charW = (ch: string) => /[\u4e00-\u9fff\u3000-\u303f]/.test(ch) ? 8 : 5;
  const textW = (s: string) => s.split("").reduce((a, c) => a + charW(c), 0);

  if (textW(name) <= maxPx) return [name];

  // For English: try to break at a space near the midpoint
  const mid = Math.ceil(name.length / 2);
  let splitAt = mid;
  const spaceLeft  = name.lastIndexOf(" ", mid);
  const spaceRight = name.indexOf(" ", mid);
  if (spaceLeft  > 0) splitAt = spaceLeft;
  else if (spaceRight > 0) splitAt = spaceRight;

  const line1 = name.slice(0, splitAt).trim();
  const line2 = name.slice(splitAt).trim();
  return [line1, line2];
}

function PlacedItemSVG({ placed, scale, isSelected, isBlocked, hasViolation, violationSeverity, onPointerDown }: PlacedItemSVGProps) {
  // 内置家具走静态 FURNITURE；导入家具响应式订阅 store.customFurniture，
  // 否则刷新后查非响应式的 _customItems 拿不到（同 RoomCanvas PlacedItemMesh）。
  const customFurniture = useDesignerStore(s => s.customFurniture);
  const furniture = getFurnitureById(placed.furnitureId)
    ?? customFurniture.find(f => f.id === placed.furnitureId);
  const locale = useLocale();
  // 导入的 GLB 家具在平面图里显示预览缩略图（与模型库列表同一张
  // <file>.preview.png），而不是通用 🧩 图标；图加载失败回落到 icon。
  const [imgFailed, setImgFailed] = useState(false);
  if (!furniture) return null;

  const sw = placed.scaleW ?? 1;
  const sd = placed.scaleD ?? 1;
  const cx = placed.x * scale;
  const cy = placed.z * scale;
  const w = furniture.width * sw * scale;
  const d = furniture.depth * sd * scale;
  const fontSize = Math.min(w, d) * 0.55;
  const displayName = locale === "en" ? (getFurnitureNameEn(furniture.id) ?? furniture.name) : furniture.name;

  const LABEL_SIZE = 8;
  const LINE_H = 9;
  const nameLines = w > 30 && d > 22 ? splitNameLines(displayName, w - 6) : null;
  // 导入模型的预览图（落在 public 的真实文件才有；idb:// 缓存无）。
  const glbUrl = furniture.model3d?.url;
  const glbPreview = !imgFailed && glbUrl?.startsWith("/models/imported/") ? `${glbUrl}.preview.png` : null;

  return (
    <g
      data-furniture="true"
      transform={`translate(${cx},${cy}) rotate(${placed.rotation})`}
      style={{ cursor: isSelected ? "grabbing" : "grab", touchAction: "none" }}
      onPointerDown={onPointerDown}
    >
      <rect x={-w / 2 + 2} y={-d / 2 + 2} width={w} height={d} rx={4} fill="rgba(0,0,0,0.3)" />
      {hasViolation && (
        <rect
          x={-w / 2 - 3} y={-d / 2 - 3} width={w + 6} height={d + 6} rx={6}
          fill="none"
          stroke={violationSeverity === "required" ? "#EF4444" : "#F59E0B"}
          strokeWidth={2}
          strokeDasharray="4 3"
          style={{ pointerEvents: "none" }}
        />
      )}
      <rect
        x={-w / 2} y={-d / 2} width={w} height={d} rx={4}
        fill={furniture.color} fillOpacity={0.85}
        stroke={
          isBlocked ? "#EF4444"
          : isSelected ? "#60A5FA"
          : hasViolation ? (violationSeverity === "required" ? "#EF4444" : "#F59E0B")
          : "rgba(255,255,255,0.35)"
        }
        strokeWidth={isBlocked ? 3 : isSelected ? 2.5 : hasViolation ? 1.8 : 1}
      />
      {/* B4 视觉反馈：阻塞时叠一圈亮红光晕（pulse via CSS animation） */}
      {isBlocked && (
        <rect
          x={-w / 2 - 5} y={-d / 2 - 5} width={w + 10} height={d + 10} rx={7}
          fill="none"
          stroke="#EF4444"
          strokeOpacity={0.85}
          strokeWidth={2.5}
          strokeDasharray="3 3"
          style={{ pointerEvents: "none", animation: "fpBlockedPulse 0.4s ease-out infinite alternate" }}
        />
      )}
      {glbPreview ? (
        <image href={glbPreview} x={-w / 2 + 2} y={-d / 2 + 2} width={Math.max(0, w - 4)} height={Math.max(0, d - 4)}
          preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }}
          onError={() => setImgFailed(true)} />
      ) : fontSize > 5 && (
        <text x={0} y={d > 30 ? -3 : 0} textAnchor="middle" dominantBaseline="middle"
          fontSize={Math.min(fontSize, 18)} style={{ userSelect: "none", pointerEvents: "none" }}>
          {furniture.icon}
        </text>
      )}
      {nameLines && (() => {
        const totalH = nameLines.length * LINE_H;
        const baseY = d / 2 - 3 - totalH;
        return nameLines.map((line, i) => (
          <text key={i} x={0} y={baseY + i * LINE_H + LINE_H / 2}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={LABEL_SIZE} fill="white" fillOpacity={0.9}
            style={{ userSelect: "none", pointerEvents: "none" }}>
            {line}
          </text>
        ));
      })()}
      {isSelected && (
        <>
          <rect x={-w / 2}    y={-d / 2}    width={8} height={8} rx={2} fill="#3B82F6" opacity={0.9} />
          <rect x={w / 2 - 8} y={-d / 2}    width={8} height={8} rx={2} fill="#3B82F6" opacity={0.9} />
          <rect x={-w / 2}    y={d / 2 - 8} width={8} height={8} rx={2} fill="#3B82F6" opacity={0.9} />
          <rect x={w / 2 - 8} y={d / 2 - 8} width={8} height={8} rx={2} fill="#3B82F6" opacity={0.9} />
        </>
      )}
      {/* Elevation badge — shown when item is lifted off floor */}
      {(placed.elevationY ?? 0) > 0 && (
        <g transform={`translate(${w / 2 - 2}, ${-d / 2 - 1}) rotate(${-placed.rotation})`}>
          <rect x={-22} y={-9} width={22} height={9} rx={3} fill="#F59E0B" opacity={0.95} />
          <text x={-11} y={-4.5} textAnchor="middle" dominantBaseline="middle"
            fontSize={6} fill="white" fontWeight="bold"
            style={{ userSelect: "none", pointerEvents: "none" }}>
            ↑{placed.elevationY}cm
          </text>
        </g>
      )}
    </g>
  );
}

// ─── Window segment rendered on wall edge ─────────────────

function WindowSVG({
  win, svgW, svgH, scale, isEditMode, polygonEdge,
  onMoveDown, onStartDown, onEndDown,
}: {
  win: WindowConfig; svgW: number; svgH: number; scale: number; isEditMode: boolean;
  /** Resolved polygon edge if win.edgeIndex is set on a polygon room.
   *  When present, the window is drawn along this edge instead of on the
   *  bbox perimeter — necessary for L / convex inner-corner walls. */
  polygonEdge?: { x1: number; z1: number; x2: number; z2: number; length: number };
  onMoveDown: (e: React.PointerEvent<SVGRectElement>) => void;
  onStartDown: (e: React.PointerEvent<SVGRectElement>) => void;
  onEndDown: (e: React.PointerEvent<SVGRectElement>) => void;
}) {
  const thick = 10;
  const handleSz = 8;
  const color = "#60C0F0";
  const handleColor = "#2080C0";

  // Polygon edge-bound: render along the actual edge.
  if (polygonEdge) {
    const e = polygonEdge;
    const ux = (e.x2 - e.x1) / e.length;
    const uz = (e.z2 - e.z1) / e.length;
    const t1 = win.pos;
    const t2 = win.pos + win.len;
    const sx = (e.x1 + ux * t1) * scale;
    const sy = (e.z1 + uz * t1) * scale;
    const ex = (e.x1 + ux * t2) * scale;
    const ey = (e.z1 + uz * t2) * scale;
    const angleDeg = Math.atan2(ey - sy, ex - sx) * 180 / Math.PI;
    const widthPx = Math.hypot(ex - sx, ey - sy);
    return (
      <g transform={`translate(${sx} ${sy}) rotate(${angleDeg})`}>
        <rect x={0} y={-thick / 2} width={widthPx} height={thick}
          fill={color} opacity={0.8} rx={2}
          style={{ cursor: isEditMode ? "move" : "default" }}
          onPointerDown={isEditMode ? onMoveDown : undefined} />
        {isEditMode && (
          <>
            <rect x={-handleSz / 2} y={-handleSz / 2} width={handleSz} height={handleSz}
              fill={handleColor} rx={2} style={{ cursor: "move" }} onPointerDown={onStartDown} />
            <rect x={widthPx - handleSz / 2} y={-handleSz / 2} width={handleSz} height={handleSz}
              fill={handleColor} rx={2} style={{ cursor: "move" }} onPointerDown={onEndDown} />
          </>
        )}
      </g>
    );
  }

  if (win.wall === "N") {
    const x1 = win.pos * scale;
    const x2 = (win.pos + win.len) * scale;
    return (
      <g>
        <rect x={x1} y={-thick / 2} width={x2 - x1} height={thick}
          fill={color} opacity={0.8} rx={2}
          style={{ cursor: isEditMode ? "move" : "default" }}
          onPointerDown={isEditMode ? onMoveDown : undefined} />
        {isEditMode && (
          <>
            <rect x={x1 - handleSz / 2} y={-handleSz / 2} width={handleSz} height={handleSz}
              fill={handleColor} rx={2} style={{ cursor: "ew-resize" }} onPointerDown={onStartDown} />
            <rect x={x2 - handleSz / 2} y={-handleSz / 2} width={handleSz} height={handleSz}
              fill={handleColor} rx={2} style={{ cursor: "ew-resize" }} onPointerDown={onEndDown} />
          </>
        )}
      </g>
    );
  }
  if (win.wall === "E") {
    const y1 = win.pos * scale;
    const y2 = (win.pos + win.len) * scale;
    return (
      <g>
        <rect x={svgW - thick / 2} y={y1} width={thick} height={y2 - y1}
          fill={color} opacity={0.8} rx={2}
          style={{ cursor: isEditMode ? "move" : "default" }}
          onPointerDown={isEditMode ? onMoveDown : undefined} />
        {isEditMode && (
          <>
            <rect x={svgW - handleSz / 2} y={y1 - handleSz / 2} width={handleSz} height={handleSz}
              fill={handleColor} rx={2} style={{ cursor: "ns-resize" }} onPointerDown={onStartDown} />
            <rect x={svgW - handleSz / 2} y={y2 - handleSz / 2} width={handleSz} height={handleSz}
              fill={handleColor} rx={2} style={{ cursor: "ns-resize" }} onPointerDown={onEndDown} />
          </>
        )}
      </g>
    );
  }
  if (win.wall === "W") {
    const y1 = win.pos * scale;
    const y2 = (win.pos + win.len) * scale;
    return (
      <g>
        <rect x={-thick / 2} y={y1} width={thick} height={y2 - y1}
          fill={color} opacity={0.8} rx={2}
          style={{ cursor: isEditMode ? "move" : "default" }}
          onPointerDown={isEditMode ? onMoveDown : undefined} />
        {isEditMode && (
          <>
            <rect x={-handleSz / 2} y={y1 - handleSz / 2} width={handleSz} height={handleSz}
              fill={handleColor} rx={2} style={{ cursor: "ns-resize" }} onPointerDown={onStartDown} />
            <rect x={-handleSz / 2} y={y2 - handleSz / 2} width={handleSz} height={handleSz}
              fill={handleColor} rx={2} style={{ cursor: "ns-resize" }} onPointerDown={onEndDown} />
          </>
        )}
      </g>
    );
  }
  if (win.wall === "S") {
    const x1 = win.pos * scale;
    const x2 = (win.pos + win.len) * scale;
    return (
      <g>
        <rect x={x1} y={svgH - thick / 2} width={x2 - x1} height={thick}
          fill={color} opacity={0.8} rx={2}
          style={{ cursor: isEditMode ? "move" : "default" }}
          onPointerDown={isEditMode ? onMoveDown : undefined} />
        {isEditMode && (
          <>
            <rect x={x1 - handleSz / 2} y={svgH - handleSz / 2} width={handleSz} height={handleSz}
              fill={handleColor} rx={2} style={{ cursor: "ew-resize" }} onPointerDown={onStartDown} />
            <rect x={x2 - handleSz / 2} y={svgH - handleSz / 2} width={handleSz} height={handleSz}
              fill={handleColor} rx={2} style={{ cursor: "ew-resize" }} onPointerDown={onEndDown} />
          </>
        )}
      </g>
    );
  }
  return null;
}

// ─── Draggable door (supports 4 walls) ────────────────────

type DoorWall = WallSide;

function DoorSVG({
  svgW, svgH, doorPosCm, doorLenCm, roomWidthCm, roomDepthCm, doorWall, scale, isEditMode, onPointerDown, polygonEdge, noHitRect,
}: {
  svgW: number; svgH: number;
  doorPosCm: number; doorLenCm: number; roomWidthCm: number; roomDepthCm: number;
  doorWall: DoorWall; scale: number;
  isEditMode: boolean; onPointerDown: (e: React.PointerEvent<SVGRectElement>) => void;
  polygonEdge?: { x1: number; z1: number; x2: number; z2: number; length: number; nx: number; nz: number };
  noHitRect?: boolean;
}) {
  // Polygon edge-bound door
  if (polygonEdge) {
    const e = polygonEdge;
    const ux = (e.x2 - e.x1) / e.length;
    const uz = (e.z2 - e.z1) / e.length;
    const doorWcm = Math.min(doorLenCm, e.length);
    const sx = (e.x1 + ux * doorPosCm) * scale;
    const sy = (e.z1 + uz * doorPosCm) * scale;
    const angleDeg = Math.atan2(uz, ux) * 180 / Math.PI;
    const widthPx = doorWcm * scale;
    return (
      <g transform={`translate(${sx} ${sy}) rotate(${angleDeg})`}>
        <rect x={0} y={-5} width={widthPx} height={10} fill="#1E2030" />
        <path d={`M0,0 A${widthPx},${widthPx} 0 0,${e.nz < 0 ? 1 : 0} ${widthPx},${(e.nz < 0 ? -widthPx : widthPx)}`}
              fill="none" stroke="#5A6070" strokeWidth={1} strokeDasharray="3,2" />
        <line x1={0} y1={0} x2={widthPx} y2={(e.nz < 0 ? -widthPx : widthPx)}
              stroke="#5A6070" strokeWidth={1.5} />
        {isEditMode && <rect x={-4} y={-7} width={widthPx + 8} height={14} fill="#F59E0B" opacity={0.35} rx={3} style={{ pointerEvents: "none" }} />}
        {/* Transparent hit rect for pointer capture — same strategy as windows */}
        {isEditMode && <rect x={-4} y={-7} width={widthPx + 8} height={14} fill="transparent"
          style={{ cursor: "move" }} onPointerDown={onPointerDown} />}
      </g>
    );
  }

  const wallLen = (doorWall === "N" || doorWall === "S") ? roomWidthCm : roomDepthCm;
  const doorW = Math.min(doorLenCm, wallLen) * scale;
  const pos = doorPosCm * scale;

  // Transparent hit rect dimensions per wall — wide enough for easy grab
  // noHitRect=true means the parent renders the hit rect after delete buttons (correct z-order)
  let hitRect: React.ReactNode = null;
  if (isEditMode && !noHitRect) {
    if (doorWall === "S")
      hitRect = <rect x={pos - 4} y={svgH - 20} width={doorW + 8} height={24} fill="transparent" style={{ cursor: "move" }} onPointerDown={onPointerDown} />;
    else if (doorWall === "N")
      hitRect = <rect x={pos - 4} y={-4} width={doorW + 8} height={24} fill="transparent" style={{ cursor: "move" }} onPointerDown={onPointerDown} />;
    else if (doorWall === "W")
      hitRect = <rect x={-4} y={pos - 4} width={24} height={doorW + 8} fill="transparent" style={{ cursor: "move" }} onPointerDown={onPointerDown} />;
    else
      hitRect = <rect x={svgW - 20} y={pos - 4} width={24} height={doorW + 8} fill="transparent" style={{ cursor: "move" }} onPointerDown={onPointerDown} />;
  }

  let gapRect: React.ReactNode;
  let arc: React.ReactNode;
  let leaf: React.ReactNode;
  let highlight: React.ReactNode;

  if (doorWall === "S") {
    // SVG bottom edge — south wall (+Z)
    gapRect   = <rect x={pos} y={svgH - 5} width={doorW} height={10} fill="#1E2030" />;
    arc       = <path d={`M${pos},${svgH} A${doorW},${doorW} 0 0,1 ${pos+doorW},${svgH-doorW}`} fill="none" stroke="#5A6070" strokeWidth={1} strokeDasharray="3,2" />;
    leaf      = <line x1={pos} y1={svgH} x2={pos+doorW} y2={svgH-doorW} stroke="#5A6070" strokeWidth={1.5} />;
    highlight = isEditMode && <rect x={pos-4} y={svgH-12} width={doorW+8} height={14} fill="#F59E0B" opacity={0.35} rx={3} style={{ pointerEvents:"none" }} />;
  } else if (doorWall === "N") {
    // SVG top edge — north wall (-Z)
    gapRect   = <rect x={pos} y={-5} width={doorW} height={10} fill="#1E2030" />;
    arc       = <path d={`M${pos},${0} A${doorW},${doorW} 0 0,0 ${pos+doorW},${doorW}`} fill="none" stroke="#5A6070" strokeWidth={1} strokeDasharray="3,2" />;
    leaf      = <line x1={pos} y1={0} x2={pos+doorW} y2={doorW} stroke="#5A6070" strokeWidth={1.5} />;
    highlight = isEditMode && <rect x={pos-4} y={-2} width={doorW+8} height={14} fill="#F59E0B" opacity={0.35} rx={3} style={{ pointerEvents:"none" }} />;
  } else if (doorWall === "W") {
    gapRect   = <rect x={-5} y={pos} width={10} height={doorW} fill="#1E2030" />;
    arc       = <path d={`M${0},${pos} A${doorW},${doorW} 0 0,0 ${doorW},${pos+doorW}`} fill="none" stroke="#5A6070" strokeWidth={1} strokeDasharray="3,2" />;
    leaf      = <line x1={0} y1={pos} x2={doorW} y2={pos+doorW} stroke="#5A6070" strokeWidth={1.5} />;
    highlight = isEditMode && <rect x={-2} y={pos-4} width={14} height={doorW+8} fill="#F59E0B" opacity={0.35} rx={3} style={{ pointerEvents:"none" }} />;
  } else {
    gapRect   = <rect x={svgW-5} y={pos} width={10} height={doorW} fill="#1E2030" />;
    arc       = <path d={`M${svgW},${pos} A${doorW},${doorW} 0 0,1 ${svgW-doorW},${pos+doorW}`} fill="none" stroke="#5A6070" strokeWidth={1} strokeDasharray="3,2" />;
    leaf      = <line x1={svgW} y1={pos} x2={svgW-doorW} y2={pos+doorW} stroke="#5A6070" strokeWidth={1.5} />;
    highlight = isEditMode && <rect x={svgW-12} y={pos-4} width={14} height={doorW+8} fill="#F59E0B" opacity={0.35} rx={3} style={{ pointerEvents:"none" }} />;
  }

  return (
    <g>
      {gapRect}{arc}{leaf}{highlight}
      {hitRect}
    </g>
  );
}

// ─── Main FloorPlan component ──────────────────────────────

export default function FloorPlan() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [winDrag, setWinDrag] = useState<WinDrag | null>(null);
  const [doorDrag, setDoorDrag] = useState<DoorDrag | null>(null);
  const [editWindows, setEditWindows] = useState(false);
  const [editShape, setEditShape] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const check = () => setIsLandscape(mq.matches);
    check();
    mq.addEventListener("change", check);
    return () => mq.removeEventListener("change", check);
  }, []);
  // Ref mirror of dragState to avoid stale closures in callbacks
  const dragStateRef = useRef<DragState | null>(null);

  // ─── Inspector drag ──────────────────────────────────────
  const inspectorRef = useRef<HTMLDivElement>(null);
  const [inspectorPos, setInspectorPos] = useState<{ x: number; y: number } | null>(null);
  const inspectorDragOrigin = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // ─── Window / door selection for size editing ────────────
  const [selectedWinId, setSelectedWinId] = useState<string | null>(null);
  const [doorSelected,  setDoorSelected]  = useState(false);
  const [selectedDoorId, setSelectedDoorId] = useState<string | null>(null);

  const activeRoom           = useDesignerStore((s) => s.activeRoom);
  const showCompass          = useDesignerStore((s) => s.showCompass);
  const roomState            = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.rooms[activeRoom] ?? EMPTY_ROOM_STATE);
  const selectedInstanceIds  = useDesignerStore((s) => s.selectedInstanceIds);
  const moveItem             = useDesignerStore((s) => s.moveItem);
  const rotateItem           = useDesignerStore((s) => s.rotateItem);
  const removeItem           = useDesignerStore((s) => s.removeItem);
  const setSelection         = useDesignerStore((s) => s.setSelection);
  const duplicateItems       = useDesignerStore((s) => s.duplicateItems);
  const removeItems          = useDesignerStore((s) => s.removeItems);
  const resizeItem           = useDesignerStore((s) => s.resizeItem);
  const setElevation         = useDesignerStore((s) => s.setElevation);
  const pushFurnitureHistory = useDesignerStore((s) => s.pushFurnitureHistory);
  const undoFurniture        = useDesignerStore((s) => s.undoFurniture);
  const undoLayout           = useDesignerStore((s) => s.undoLayout);
  const layoutHistoryLen     = useDesignerStore((s) => s.layoutHistory.length);
  const customRoomMeta       = useDesignerStore((s) => s.customRoomMeta);
  const rotateRoom           = useDesignerStore((s) => s.rotateRoom);
  const pushLayoutHistory    = useDesignerStore((s) => s.pushLayoutHistory);
  const furnitureHistoryLen  = useDesignerStore((s) => s.furnitureHistory.reduce((n, h) => h.room === activeRoom ? n + 1 : n, 0));
  const copyToClipboard      = useDesignerStore((s) => s.copyToClipboard);
  const pasteFromClipboard   = useDesignerStore((s) => s.pasteFromClipboard);
  const clipboardLen         = useDesignerStore((s) => s.clipboard.length);
  const roomWindows     = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomWindows?.[activeRoom] ?? EMPTY_WINDOWS);
  const setRoomWindows  = useDesignerStore((s) => s.setRoomWindows);
  const addWindow       = useDesignerStore((s) => s.addWindow);
  const removeWindow    = useDesignerStore((s) => s.removeWindow);
  const doorPosCm       = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomDoorPos?.[activeRoom] ?? 0);
  const hasDoor         = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomHasDoor?.[activeRoom] ?? true);
  const doorWall        = useDesignerStore((s) => (s.floorPlans[s.activeFloor]?.roomDoorWall?.[activeRoom] ?? "S") as DoorWall);
  const doorLenCm       = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorLen?.[activeRoom] ?? 80);
  // Default interior-door opening height (cm). Mirrors the 3D render fallback
  // (RoomCanvas / FloorPlanExterior) so the editor shows the same value that
  // actually renders. Per-door / per-room overrides still win.
  const doorHDefault    = useDesignerStore((s) => s.exterior?.interiorDoorHeightCm ?? 240);
  const doorHCm         = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorH?.[activeRoom]) ?? doorHDefault;
  const setDoorPos      = useDesignerStore((s) => s.setDoorPos);
  const setRoomHasDoor  = useDesignerStore((s) => s.setRoomHasDoor);
  const setDoorWall     = useDesignerStore((s) => s.setDoorWall);
  const wallsHiddenOnRoom = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomWallsHidden?.[activeRoom]);
  const toggleWallHidden  = useDesignerStore((s) => s.toggleWallHidden);
  const facadeFacesOnRoom = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomFacadeFaces?.[activeRoom]);
  const setFaceLayer      = useDesignerStore((s) => s.setFaceLayer);
  const setFaceOpacity    = useDesignerStore((s) => s.setFaceOpacity);
  // Curtain-wall mode? (drives per-face facade layer defaults + when to show
  // the 实墙/玻璃幕墙/框架 controls). Mirrors FloorPlanExterior's derivation.
  const curtainWall = useDesignerStore((s) =>
    s.exterior?.facadeSystem === "curtain-wall"
    || (s.exterior?.facadeSystem == null && (s.exterior?.facadeGlass ?? false)));
  const setDoorLen      = useDesignerStore((s) => s.setDoorLen);
  const setDoorH        = useDesignerStore((s) => s.setDoorH);
  const setDoorStyle    = useDesignerStore((s) => s.setDoorStyle);
  const doorStyle       = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorStyle?.[activeRoom] ?? "wood_panel");
  const doorEdgeIdx     = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorEdgeIdx?.[activeRoom]);
  const roomDoorsArr    = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoors?.[activeRoom]);
  const addDoor         = useDesignerStore((s) => s.addDoor);
  const removeDoor      = useDesignerStore((s) => s.removeDoor);
  const updateDoor      = useDesignerStore((s) => s.updateDoor);
  const updateWindow    = useDesignerStore((s) => s.updateWindow);

  // Multi-door: prefer roomDoors[], fall back to legacy single-door fields.
  // Stable reference via useMemo to avoid render loops.
  const allDoors = useMemo(() => {
    if (roomDoorsArr && roomDoorsArr.length > 0) return roomDoorsArr;
    if (!hasDoor) return [];
    return [{
      id: `${activeRoom}-legacy-door`,
      wall: doorWall as WallSide,
      pos: doorPosCm,
      len: doorLenCm,
      h: doorHCm,
      style: doorStyle,
      edgeIndex: doorEdgeIdx,
    }];
  }, [roomDoorsArr, hasDoor, doorWall, doorPosCm, doorLenCm, doorHCm, doorStyle, doorEdgeIdx, activeRoom]);

  const t      = useT();
  const locale = useLocale();

  // ── Use store roomDimensions (respects global plan edits) ──
  const roomDimensions  = useDesignerStore((s) => s.floorPlans[s.activeFloor]?.roomDimensions?.[activeRoom]);
  const roomShape          = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomShapes?.[activeRoom]);
  const setRoomShape         = useDesignerStore((s) => s.setRoomShape);
  const updateRoomShapePoint = useDesignerStore((s) => s.updateRoomShapePoint);
  const insertRoomShapePoint = useDesignerStore((s) => s.insertRoomShapePoint);
  const deleteRoomShapePoint = useDesignerStore((s) => s.deleteRoomShapePoint);
  const rectifyRoomShape     = useDesignerStore((s) => s.rectifyRoomShape);
  const def             = ROOM_DEFS[activeRoom];

  // Effective dimensions: store override if different from default, else ROOM_DEFS
  // Effective dimensions — base on store, but if a polygon outline edited
  // in 全局 has bounds exceeding the rectangular roomDimensions, grow to
  // include the polygon. Covers legacy saves where roomDimensions wasn't
  // synced on shape edit (pre-`syncDimsToShape` fix). Computed inline so
  // 全局 outline edits reflect immediately in 单房间 平面图.
  const _baseW = roomDimensions?.width  ?? def.width;
  const _baseD = roomDimensions?.depth  ?? def.depth;
  const _shapePts = useDesignerStore((s) =>
    s.floorPlans[s.activeFloor]?.roomShapes?.[activeRoom]?.points);
  const { roomW, roomD } = useMemo(() => {
    let mX = _baseW, mZ = _baseD;
    if (_shapePts && _shapePts.length) {
      // Use full bbox (max - min) so legacy data with polygon points in the
      // negative quadrant still produces a usable canvas size. Newer edits
      // are normalized at write time (store.ts syncDimsAndLayout) so min ≥ 0
      // in fresh data — but this read-side fallback heals older saves.
      let minX = _shapePts[0][0], minZ = _shapePts[0][1];
      let maxX = minX, maxZ = minZ;
      for (const [px, pz] of _shapePts) {
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz;
      }
      const spanX = maxX - Math.min(0, minX);
      const spanZ = maxZ - Math.min(0, minZ);
      if (spanX > mX) mX = spanX;
      if (spanZ > mZ) mZ = spanZ;
    }
    return { roomW: mX, roomD: mZ };
  }, [_baseW, _baseD, _shapePts]);

  // Reset zoom when switching rooms
  useEffect(() => { setZoomLevel(1); }, [activeRoom]);

  // Clear window/door selection when leaving edit mode or switching room
  useEffect(() => {
    if (!editWindows) { setSelectedWinId(null); setDoorSelected(false); }
  }, [editWindows, activeRoom]);

  // Auto-clamp items that are outside bounds (e.g. after room was resized smaller)
  useEffect(() => {
    for (const placed of roomState.placedItems) {
      const furniture = getFurnitureById(placed.furnitureId);
      if (!furniture) continue;
      const rot90 = placed.rotation === 90 || placed.rotation === 270;
      const rawHW = furniture.width  * (placed.scaleW ?? 1) / 2;
      const rawHD = furniture.depth  * (placed.scaleD ?? 1) / 2;
      const hw = Math.min(rot90 ? rawHD : rawHW, roomW / 2);
      const hd = Math.min(rot90 ? rawHW : rawHD, roomD / 2);
      let cx = Math.max(hw, Math.min(roomW - hw, placed.x));
      let cz = Math.max(hd, Math.min(roomD - hd, placed.z));
      // If the clamped point is outside the polygon, nudge to the polygon
      // centroid-ish fallback: try a few rings around current; otherwise
      // fall back to bounding-box center (may still be outside, but that's
      // a rarely-hit case when the room was just reshaped smaller).
      if (roomShape && roomShape.preset !== "rect" && !pointInPolygon(roomShape.points, cx, cz)) {
        let found = false;
        for (const [px, pz] of roomShape.points) {
          // Try a point slightly inside each vertex (toward bounds center)
          const tx = px + (roomW / 2 - px) * 0.1;
          const tz = pz + (roomD / 2 - pz) * 0.1;
          if (pointInPolygon(roomShape.points, tx, tz)) { cx = tx; cz = tz; found = true; break; }
        }
        if (!found) continue; // give up, don't move
      }
      if (Math.abs(cx - placed.x) > 0.5 || Math.abs(cz - placed.z) > 0.5) {
        moveItem(placed.instanceId, cx, cz);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoom, roomW, roomD]);

  // Dynamic scale: fit within ~700px wide / ~500px tall, preserving aspect ratio
  const scale = Math.min(700 / roomW, 500 / roomD, 3.0);
  const svgW = roomW * scale;
  const svgH = roomD * scale;

  // ── Clearance evaluation (ergonomic aisle / furniture-fit check) ──
  const evaluation = useMemo(
    () => evaluateRoom(
      roomState.placedItems, getFurnitureById, roomW, roomD,
      hasDoor ? { hasDoor, wall: doorWall as ClearanceDoorWall, posCm: doorPosCm, lenCm: doorLenCm } : undefined,
      roomWindows,
    ),
    [roomState.placedItems, roomW, roomD, hasDoor, doorWall, doorPosCm, doorLenCm, roomWindows]
  );
  const evaluated: EvaluatedItem[] = evaluation.items;
  const doorSwing = evaluation.doorSwing;
  const links = evaluation.links;
  const violatingIds = useMemo(() => {
    const m = new Map<string, "required" | "recommended">();
    for (const e of evaluated) {
      if (e.violations.length === 0) continue;
      const worst = e.violations.some(v => v.severity === "required") ? "required" : "recommended";
      m.set(e.placed.instanceId, worst);
    }
    return m;
  }, [evaluated]);

  const gridXCount = Math.floor(roomW / 100);
  const gridZCount = Math.floor(roomD / 100);

  // ─── Furniture drag ─────────────────────────────────────

  const handleItemPointerDown = useCallback(
    (e: React.PointerEvent<SVGGElement>, instanceId: string) => {
      if (!svgRef.current) return;
      try { e.preventDefault(); } catch { /* passive listener, can't prevent */ }
      e.stopPropagation();

      // Routing-mode interception: while in routing mode, clicks on a
      // fixture either set the connection's "from" endpoint or, if a
      // from is already pinned, complete the connection from→this and
      // exit routing-from state (mode stays on for chained drawing).
      const st = useDesignerStore.getState();
      if (st.routingMode) {
        if (!st.routingFrom) {
          st.setRoutingFrom(instanceId);
        } else if (st.routingFrom !== instanceId) {
          st.addRoutingConnection(activeRoom, st.routingFrom, instanceId, st.routingMode);
        }
        return; // skip selection + drag
      }

      // Selection
      const alreadySelected = selectedInstanceIds.includes(instanceId);
      let newSelection: string[];
      if (e.shiftKey) {
        newSelection = alreadySelected
          ? selectedInstanceIds.filter(id => id !== instanceId)
          : [...selectedInstanceIds, instanceId];
      } else {
        newSelection = alreadySelected ? selectedInstanceIds : [instanceId];
      }
      setSelection(newSelection);

      // Capture all values needed for drag at this moment (avoids stale closure)
      const svg = svgRef.current;
      const capturedZoom  = zoomLevel;
      const capturedScale = Math.min(700 / roomW, 500 / roomD, 3.0);
      const capturedRoomW = roomW;
      const capturedRoomD = roomD;
      // Polygon override (L型/凸字型). Null = rectangular room.
      const capturedShape = roomShape && roomShape.preset !== "rect" ? roomShape : null;
      const startPt = getSVGPoint(e, svg, capturedZoom);

      const selForDrag = alreadySelected ? selectedInstanceIds : newSelection;
      const dragItems = selForDrag
        .map(id => roomState.placedItems.find(p => p.instanceId === id))
        .filter(Boolean)
        .map(p => ({
          instanceId:  p!.instanceId,
          furnitureId: p!.furnitureId,
          startX:      Math.max(0, Math.min(capturedRoomW, p!.x)),
          startZ:      Math.max(0, Math.min(capturedRoomD, p!.z)),
          scaleW:      p!.scaleW ?? 1,
          scaleD:      p!.scaleD ?? 1,
          rotation:    p!.rotation,
        }));

      // ── B4: 拖拽实时碰撞防穿模 ──
      // 行业惯例：CAD/Sketchup 在拖动家具时遇到另一件家具会高亮 +
      // 阻挡释放；clearance.ts 里的规则只是 evaluator（事后警告），不是
      // enforcer。这里把 evaluator 升级为 enforcer：每帧检测拖动 item
      // 的新 AABB 是否与"非拖动"家具的 AABB 相交，相交则拒绝该轴向移动
      // （axis-separated slide：先单 X，再单 Z，都撞死才完全阻塞）。
      const draggedIds = new Set(dragItems.map(i => i.instanceId));
      const obstacles = roomState.placedItems
        .filter(p => !draggedIds.has(p.instanceId))
        .map(p => {
          const f = getFurnitureById(p.furnitureId);
          const r90 = p.rotation === 90 || p.rotation === 270;
          const wW = (f?.width  ?? 100) * (p.scaleW ?? 1);
          const wD = (f?.depth  ?? 100) * (p.scaleD ?? 1);
          const halfW = (r90 ? wD : wW) / 2;
          const halfD = (r90 ? wW : wD) / 2;
          return {
            id: p.instanceId,
            minX: p.x - halfW, maxX: p.x + halfW,
            minZ: p.z - halfD, maxZ: p.z + halfD,
          };
        });
      /** AABB-AABB overlap test. `pad` 留 0.5cm 防"轻贴边"判定为穿模。 */
      const overlapsAny = (cx: number, cz: number, halfW: number, halfD: number, pad = 0.5) => {
        for (const o of obstacles) {
          if (cx + halfW + pad > o.minX && cx - halfW - pad < o.maxX
            && cz + halfD + pad > o.minZ && cz - halfD - pad < o.maxZ) {
            return true;
          }
        }
        return false;
      };

      pushFurnitureHistory();
      const ds: DragState = {
        startSvgX: startPt.x, startSvgZ: startPt.y,
        items: dragItems.map(i => ({ instanceId: i.instanceId, startX: i.startX, startZ: i.startZ })),
      };
      dragStateRef.current = ds;
      setDragState(ds);

      // ── Window-level pointer listeners (most reliable cross-browser drag) ──
      const onMove = (ev: PointerEvent) => {
        ev.preventDefault();
        const rect  = svg.getBoundingClientRect();
        const px    = (ev.clientX - rect.left) / capturedZoom;
        const pz    = (ev.clientY - rect.top)  / capturedZoom;
        const dX    = (px - startPt.x) / capturedScale;
        const dZ    = (pz - startPt.y) / capturedScale;
        const blocked: string[] = [];
        for (const item of dragItems) {
          const furn     = getFurnitureById(item.furnitureId);
          const r90      = item.rotation === 90 || item.rotation === 270;
          const rawHW    = (furn?.width  ?? 100) * item.scaleW / 2;
          const rawHD    = (furn?.depth  ?? 100) * item.scaleD / 2;
          const halfW    = Math.min(r90 ? rawHD : rawHW, capturedRoomW / 2);
          const halfD    = Math.min(r90 ? rawHW : rawHD, capturedRoomD / 2);
          const newX     = Math.max(halfW, Math.min(capturedRoomW - halfW, item.startX + dX));
          const newZ     = Math.max(halfD, Math.min(capturedRoomD - halfD, item.startZ + dZ));
          // Visual-only: mark red when overlapping another item or outside polygon.
          // Movement is never blocked — collision is shown via red outline only.
          if (overlapsAny(newX, newZ, halfW, halfD)
            || (capturedShape && !pointInPolygon(capturedShape.points, newX, newZ))) {
            blocked.push(item.instanceId);
          }
          moveItem(item.instanceId, newX, newZ);
        }
        // Surface blocked ids to render so we can draw red outlines on them.
        // Only update state when the blocked-set actually changes — avoids
        // 60Hz re-renders of the SVG just because the cursor moved 1 px.
        const cur = dragStateRef.current;
        if (cur) {
          const sameSet = cur.blockedIds && cur.blockedIds.length === blocked.length
            && cur.blockedIds.every((id, i) => id === blocked[i]);
          if (!sameSet) {
            const next = { ...cur, blockedIds: blocked };
            dragStateRef.current = next;
            setDragState(next);
          }
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove",   onMove);
        window.removeEventListener("pointerup",     onUp);
        window.removeEventListener("pointercancel", onUp);
        dragStateRef.current = null;
        setDragState(null);
      };
      window.addEventListener("pointermove",   onMove,  { passive: false });
      window.addEventListener("pointerup",     onUp,    { once: true });
      window.addEventListener("pointercancel", onUp,    { once: true });
    },
    [roomState.placedItems, setSelection, selectedInstanceIds, roomW, roomD, pushFurnitureHistory, zoomLevel, moveItem]
  );

  // ─── Window drag ────────────────────────────────────────

  const startWinDrag = useCallback(
    (e: React.PointerEvent<SVGRectElement>, win: WindowConfig, handle: "move" | "start" | "end") => {
      e.stopPropagation();
      if (!svgRef.current) return;
      const pt = getSVGPoint(e, svgRef.current, zoomLevel);
      const axis = (win.wall === "N" || win.wall === "S") ? pt.x : pt.y;
      setWinDrag({ id: win.id, wall: win.wall, handle, startMouse: axis, origPos: win.pos, origLen: win.len });
      (e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId);
    }, []
  );

  // ─── Door drag ───────────────────────────────────────────
  // Uses window-level listeners (same as furniture drag) to avoid React
  // concurrent-mode stale-closure issues with onPointerMove.

  const startDoorDrag = useCallback(
    (e: React.PointerEvent<SVGRectElement>, doorId?: string) => {
      if (!svgRef.current || !doorId) return;
      e.stopPropagation();
      const door = allDoors.find(d => d.id === doorId);
      if (!door || door.edgeIndex != null) return;
      const cardinal: DoorWall = door.wall as DoorWall;
      const isHoriz = cardinal === "N" || cardinal === "S";
      const capturedWallLen = isHoriz ? roomW : roomD;
      const capturedOrigPos = door.pos;
      const capturedDoorLen = door.len;
      const capturedScale   = scale;
      const capturedZoom    = zoomLevel;
      const capturedRoom    = activeRoom;
      const capturedDoorId  = doorId;
      const svg = svgRef.current;

      const svgRect = svg.getBoundingClientRect();
      const startAxis = isHoriz
        ? (e.clientX - svgRect.left) / capturedZoom
        : (e.clientY - svgRect.top)  / capturedZoom;

      const onMove = (ev: PointerEvent) => {
        ev.preventDefault();
        const r = svg.getBoundingClientRect();
        const axis = isHoriz
          ? (ev.clientX - r.left)  / capturedZoom
          : (ev.clientY - r.top)   / capturedZoom;
        const delta  = (axis - startAxis) / capturedScale;
        const newPos = Math.max(0, Math.min(capturedWallLen - capturedDoorLen, capturedOrigPos + delta));
        updateDoor(capturedRoom, capturedDoorId, { pos: newPos });
      };
      const onUp = () => {
        window.removeEventListener("pointermove",   onMove);
        window.removeEventListener("pointerup",     onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove",   onMove, { passive: false });
      window.addEventListener("pointerup",     onUp,   { once: true });
      window.addEventListener("pointercancel", onUp,   { once: true });
    },
    [allDoors, roomW, roomD, zoomLevel, scale, activeRoom, updateDoor]
  );

  // ─── Combined pointer move ───────────────────────────────

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;

      // Furniture drag is handled by window-level listeners in handleItemPointerDown.
      // Window drag
      if (winDrag) {
        const pt = getSVGPoint(e, svgRef.current, zoomLevel);
        const isHorizWin = winDrag.wall === "N" || winDrag.wall === "S";
        const axis = isHorizWin ? pt.x : pt.y;
        const wallLen = isHorizWin ? roomW : roomD;
        const delta = (axis - winDrag.startMouse) / scale;
        const MIN_LEN = 40;

        const snap10 = (v: number) => Math.round(v / 10) * 10;
        const wins = roomWindows.map(w => {
          if (w.id !== winDrag.id) return w;
          if (winDrag.handle === "move") {
            return { ...w, pos: snap10(Math.max(0, Math.min(wallLen - w.len, winDrag.origPos + delta))) };
          }
          if (winDrag.handle === "start") {
            const newPos = snap10(Math.max(0, Math.min(winDrag.origPos + winDrag.origLen - MIN_LEN, winDrag.origPos + delta)));
            return { ...w, pos: newPos, len: Math.max(MIN_LEN, winDrag.origLen - (newPos - winDrag.origPos)) };
          }
          if (winDrag.handle === "end") {
            return { ...w, len: snap10(Math.max(MIN_LEN, Math.min(wallLen - w.pos, winDrag.origLen + delta))) };
          }
          return w;
        });
        setRoomWindows(activeRoom, wins);
        return;
      }

      // Door drag — same pattern as window drag
      if (doorDrag) {
        const pt = getSVGPoint(e, svgRef.current, zoomLevel);
        const isHoriz = doorDrag.wall === "N" || doorDrag.wall === "S";
        const axis = isHoriz ? pt.x : pt.y;
        const delta = (axis - doorDrag.startMouse) / scale;
        const newPos = Math.max(0, Math.min(doorDrag.wallLen - doorDrag.doorLen, doorDrag.origPos + delta));
        updateDoor(activeRoom, doorDrag.id, { pos: newPos });
      }
    },
    [winDrag, doorDrag, scale, roomW, roomD, roomWindows, setRoomWindows, activeRoom, updateDoor, zoomLevel]  // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handlePointerUp = useCallback(() => {
    dragStateRef.current = null;
    setDragState(null);
    setWinDrag(null);
    setDoorDrag(null);
  }, []);

  const handleSVGClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.target === svgRef.current) setSelection([]);
    },
    [setSelection]
  );

  // ─── Keyboard shortcuts ──────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedInstanceIds.length > 0) {
        removeItems(selectedInstanceIds);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undoFurniture();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selectedInstanceIds.length > 0) {
        e.preventDefault();
        copyToClipboard(selectedInstanceIds);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        e.preventDefault();
        pasteFromClipboard();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedInstanceIds, removeItems, undoFurniture, copyToClipboard, pasteFromClipboard]);

  // ─── Non-passive touchstart: prevent scroll when touching furniture ──
  // React attaches event listeners passively on root, so e.preventDefault() in
  // onPointerDown is silently ignored by the browser. We need a native listener
  // directly on the SVG element with { passive: false } to actually block scroll.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.("[data-furniture]")) {
        e.preventDefault();
      }
    };
    svg.addEventListener("touchstart", onTouchStart, { passive: false });
    return () => svg.removeEventListener("touchstart", onTouchStart);
  }, []);

  // ─── Add window helpers ──────────────────────────────────
  // Cardinal-wall add (rect rooms): centered on the bbox wall.
  const handleAddWindow = (wall: WallSide) => {
    const wallLen = (wall === "N" || wall === "S") ? roomW : roomD;
    addWindow(activeRoom, {
      id: `${activeRoom}-w${Date.now()}`,
      wall,
      pos: wallLen * 0.25,
      len: wallLen * 0.4,
    });
  };

  // Per-edge add (polygon rooms): place a window centered on a SPECIFIC
  // polygon edge. We bind via `edgeIndex` so inner-corner edges that the
  // cardinal (wall, pos) projection can't reach also work. `pos` is
  // edge-local: cm from the edge's start vertex.
  const handleAddWindowOnEdge = (edge: ReturnType<typeof getEdges>[number]) => {
    const len = Math.min(160, Math.max(60, edge.length * 0.5));
    const pos = Math.max(0, (edge.length - len) / 2); // centered along edge
    addWindow(activeRoom, {
      id: `${activeRoom}-w${Date.now()}`,
      wall: edge.facing,
      pos,
      len,
      edgeIndex: edge.i,
    });
  };

  // Per-edge add door (polygon rooms). Doors live in roomDoors[].
  const handleAddDoorOnEdge = (edge: ReturnType<typeof getEdges>[number]) => {
    const dl = Math.min(120, Math.max(60, doorLenCm ?? 80));
    const pos = Math.max(0, (edge.length - dl) / 2); // centered
    addDoor(activeRoom, {
      id: `${activeRoom}-d${Date.now()}`,
      wall: edge.facing,
      pos,
      len: dl,
      h: doorHCm,
      style: doorStyle ?? "wood_panel",
      edgeIndex: edge.i,
    });
  };

  // Cardinal-wall add door (rect rooms).
  const handleAddDoorCardinal = (cardinal: WallSide) => {
    const dl = doorLenCm ?? 80;
    const wallLen = (cardinal === "N" || cardinal === "S") ? roomW : roomD;
    addDoor(activeRoom, {
      id: `${activeRoom}-d${Date.now()}`,
      wall: cardinal,
      pos: Math.max(0, (wallLen - dl) / 2),
      len: dl,
      h: doorHCm,
      style: doorStyle ?? "wood_panel",
    });
  };


  // Inspector drag handler — reads current panel rect as start position
  const handleInspectorDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const panel = inspectorRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    inspectorDragOrigin.current = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      if (!inspectorDragOrigin.current) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      const nx = Math.max(0, Math.min(vw - pw, inspectorDragOrigin.current.x + ev.clientX - inspectorDragOrigin.current.px));
      const ny = Math.max(0, Math.min(vh - ph, inspectorDragOrigin.current.y + ev.clientY - inspectorDragOrigin.current.py));
      setInspectorPos({ x: nx, y: ny });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      inspectorDragOrigin.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, []);

  // Single-item controls (show only when exactly 1 item selected)
  const selectedItem = selectedInstanceIds.length === 1
    ? roomState.placedItems.find((p) => p.instanceId === selectedInstanceIds[0]) ?? null
    : null;
  const selectedFurniture = selectedItem ? getFurnitureById(selectedItem.furnitureId) : null;

  return (
    <div className="flex-1 h-full flex flex-col bg-[#0f1117] select-none overflow-hidden relative">
    {/* Floor minimap — bottom-right overlay so the user can see how the
        room being edited sits in the floor. Click another room to switch. */}
    <FloorPlanMinimap />
    {/* ── Scrollable canvas area ────────────────────────────── */}
    <div
      className="flex-1 flex flex-col items-center justify-start overflow-auto p-4 pt-10 min-h-0"
      onWheel={e => {
        // Only zoom when not over an input
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        e.stopPropagation();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        setZoomLevel(prev => Math.max(0.3, Math.min(5, prev * delta)));
      }}
    >
      {/* Header — two rows */}
      <div className="w-full max-w-3xl mb-2 flex flex-col gap-1">
        {/* Row 1: room info + action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-500 font-mono flex-1 min-w-0 truncate">
            {customRoomDisplayName(customRoomMeta[activeRoom], locale) ?? t.roomNames[activeRoom] ?? def.name} · {(roomW / 100).toFixed(1)}m × {(roomD / 100).toFixed(1)}m · {t.fpCeilingLabel} {(def.height / 100).toFixed(1)}m
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {/* Zoom controls */}
            <div className="flex items-center rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)" }}>
              <button onClick={() => setZoomLevel(p => Math.max(0.3, p * 0.8))} className="px-1.5 py-1 text-gray-400 hover:text-white text-xs transition-colors" style={{ minWidth: 22 }}>−</button>
              <span className="text-[10px] text-gray-400 px-1.5 font-mono min-w-[34px] text-center" style={{ borderLeft: "1px solid rgba(255,255,255,0.1)", borderRight: "1px solid rgba(255,255,255,0.1)" }}>{Math.round(zoomLevel * 100)}%</span>
              <button onClick={() => setZoomLevel(p => Math.min(5, p * 1.25))} className="px-1.5 py-1 text-gray-400 hover:text-white text-xs transition-colors" style={{ minWidth: 22 }}>+</button>
              <button onClick={() => setZoomLevel(1)} className="px-2 py-1 text-gray-500 hover:text-white text-[9px] transition-colors" style={{ borderLeft: "1px solid rgba(255,255,255,0.1)" }}>{t.fpZoomReset}</button>
            </div>

            {/* Divider */}
            <div className="w-px h-4 mx-0.5" style={{ background: "rgba(255,255,255,0.12)" }} />

            {/* Undo — in edit-shape mode prefer layout undo (vertex drags
                live in layoutHistory). Out of that mode fall back to
                furniture undo. */}
            <button
              onClick={() => {
                if (editShape && layoutHistoryLen > 0) undoLayout();
                else if (furnitureHistoryLen > 0) undoFurniture();
                else if (layoutHistoryLen > 0) undoLayout();
              }}
              disabled={(editShape ? layoutHistoryLen : furnitureHistoryLen) === 0}
              title={editShape ? t.fpShapeEditUndoTitle(layoutHistoryLen) : t.fpUndoTitle(furnitureHistoryLen)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all"
              style={
                (editShape ? layoutHistoryLen : furnitureHistoryLen) > 0
                  ? { background: editShape ? "#F59E0B" : "#007AFF", color: "#fff" }
                  : { background: "transparent", color: "rgba(255,255,255,0.2)", cursor: "not-allowed" }
              }
            >
              <span>↩</span>
              <span>{t.fpUndo}</span>
              {(editShape ? layoutHistoryLen : furnitureHistoryLen) > 0 && (
                <span className="text-[9px] px-1 rounded-full" style={{ background: "rgba(255,255,255,0.25)" }}>{editShape ? layoutHistoryLen : furnitureHistoryLen}</span>
              )}
            </button>

            {/* Paste */}
            {clipboardLen > 0 && (
              <button
                onClick={pasteFromClipboard}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all"
                style={{ background: "#007AFF", color: "#fff" }}
              >
                📋 {t.fpPaste}({clipboardLen})
              </button>
            )}

            {/* Routing mode toggle (pipes/wires) */}
            <RoutingModeButton />

            {/* Rotate room */}
            <button
              onClick={() => { pushLayoutHistory(); rotateRoom(activeRoom); setZoomLevel(1); }}
              title={t.fpRotateTitle}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all"
              style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)", background: "transparent" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#fff"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
            >
              <span>↻</span>
              <span>{t.fpRotate}</span>
            </button>

            {/* Window/door edit toggle */}
            <button
              onClick={() => setEditWindows(v => !v)}
              className="text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-all"
              style={
                editWindows
                  ? { background: "#007AFF", color: "#fff" }
                  : { color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)", background: "transparent" }
              }
            >
              {editWindows ? t.fpEditDone : t.fpEditStart}
            </button>

            {/* Shape edit toggle — always available; auto-initialises polygon
                on first entry for plain rectangular rooms. */}
            <>
              <button
                onClick={() => {
                  if (!editShape) {
                    // Entering edit mode: ensure polygon points exist.
                    // If room is currently a plain rect (no shape override or
                    // preset==="rect"), generate the 4-corner polygon now.
                    if (!roomShape || roomShape.preset === "rect") {
                      pushLayoutHistory();
                      setRoomShape(activeRoom, "rect"); // creates editable rect points
                    }
                  }
                  setEditShape(v => !v);
                }}
                className="text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-all"
                style={
                  editShape
                    ? { background: "#F59E0B", color: "#fff" }
                    : { color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)", background: "transparent" }
                }
                title={t.fpShapeEditTitle}
              >
                {editShape ? t.fpShapeEditDone : t.fpShapeEditStart}
              </button>
              {editShape && (
                <>
                  <button
                    onClick={() => { pushLayoutHistory(); rectifyRoomShape(activeRoom); }}
                    className="text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-all"
                    style={{ border: "1px solid rgba(245,158,11,0.7)", color: "#F59E0B", background: "transparent" }}
                    title={t.fpShapeStraightenTitle}
                  >
                    {t.fpShapeStraightenBtn}
                  </button>
                  <button
                    onClick={() => {
                      pushLayoutHistory();
                      // Reset to plain rectangle (clears all shape overrides)
                      useDesignerStore.setState(s => {
                        const fp = { ...s.floorPlans[s.activeFloor] };
                        const nextShapes = { ...(fp.roomShapes ?? {}) };
                        delete nextShapes[activeRoom];
                        fp.roomShapes = nextShapes;
                        const plans = [...s.floorPlans];
                        plans[s.activeFloor] = fp;
                        return { floorPlans: plans };
                      });
                      setEditShape(false);
                    }}
                    className="text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-all"
                    style={{ border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)", background: "transparent" }}
                    title={t.fpResetShapeTitle}
                  >
                    {t.fpResetShape}
                  </button>
                </>
              )}
            </>
          </div>
        </div>
        {/* Row 2: window/door sub-controls (only when editing) */}
        {editWindows && (
          <div className="flex flex-wrap gap-1 items-center pl-1">
            {(() => {
              // Polygon rooms: one button per actual edge — every straight
              // segment of the L / convex outline is an installable wall.
              // Otherwise (rect rooms): the legacy 4 cardinal buttons.
              if (roomShape && roomShape.preset !== "rect") {
                const labels = t.fpWallLabels;
                const edges = getEdges(roomShape.points)
                  .filter(e => e.length > 40); // skip only tiny stub edges (<40cm)
                // Number duplicates per facing (e.g. two "N" edges → #1, #2)
                const seen: Record<string, number> = { N: 0, S: 0, W: 0, E: 0 };
                return edges.map(e => {
                  seen[e.facing] += 1;
                  const sameFacingCount = edges.filter(x => x.facing === e.facing).length;
                  const idx = seen[e.facing];
                  const showIdx = sameFacingCount > 1;
                  return (
                    <button key={`${e.facing}-${e.i}`} onClick={() => handleAddWindowOnEdge(e)}
                      className="text-[10px] px-2 py-1 rounded-lg font-semibold transition-all"
                      style={{ background: "rgba(0,122,255,0.2)", color: "#60AEFF", border: "1px solid rgba(0,122,255,0.3)" }}
                      onMouseEnter={ev => { (ev.currentTarget as HTMLButtonElement).style.background = "rgba(0,122,255,0.35)"; }}
                      onMouseLeave={ev => { (ev.currentTarget as HTMLButtonElement).style.background = "rgba(0,122,255,0.2)"; }}
                      title={`${(e.length / 100).toFixed(2)}m`}
                    >
                      +{labels[e.facing]}{showIdx ? `${idx}` : ""}{t.fpWindowWord}
                      <span className="ml-1 opacity-60 font-mono">{(e.length / 100).toFixed(1)}m</span>
                    </button>
                  );
                });
              }
              return (["N","S","W","E"] as const).map(wall => {
                const labels = t.fpWallLabels;
                const wallLen = (wall === "N" || wall === "S") ? roomW : roomD;
                if (wallLen <= 100) return null;
                return (
                  <button key={wall} onClick={() => handleAddWindow(wall)}
                    className="text-[10px] px-2 py-1 rounded-lg font-semibold transition-all"
                    style={{ background: "rgba(0,122,255,0.2)", color: "#60AEFF", border: "1px solid rgba(0,122,255,0.3)" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,122,255,0.35)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,122,255,0.2)"; }}
                  >
                    +{labels[wall]}{t.fpWindowWord}
                  </button>
                );
              });
            })()}
            {/* Add-door buttons. Multi-door: each click adds a new door
                bound to the chosen edge (polygon) or cardinal wall (rect). */}
            <div className="flex items-center gap-0.5 ml-1">
              <span className="text-[10px] text-gray-500 mr-0.5">+{t.fpDoorLabel}</span>
              {(() => {
                if (roomShape && roomShape.preset !== "rect") {
                  const edges = getEdges(roomShape.points)
                    .filter(e => e.length >= (doorLenCm ?? 80));
                  const seen: Record<string, number> = { N: 0, S: 0, W: 0, E: 0 };
                  return edges.map(e => {
                    seen[e.facing] += 1;
                    const sameFacingCount = edges.filter(x => x.facing === e.facing).length;
                    const idx = seen[e.facing];
                    const showIdx = sameFacingCount > 1;
                    const labels = t.fpWallLabels;
                    return (
                      <button key={`door-${e.facing}-${e.i}`}
                        onClick={() => handleAddDoorOnEdge(e)}
                        className="text-[10px] px-1.5 py-0.5 rounded font-semibold transition-all"
                        style={{ background: "rgba(124,58,237,0.2)", color: "#A78BFA", border: "1px solid rgba(124,58,237,0.3)" }}
                        title={`${(e.length / 100).toFixed(2)}m`}
                      >
                        {labels[e.facing]}{showIdx ? `${idx}` : ""}
                      </button>
                    );
                  });
                }
                return (["N","S","W","E"] as const).map(w => {
                  const labels = t.fpWallLabels;
                  const wallLen = (w === "N" || w === "S") ? roomW : roomD;
                  if (wallLen <= 100) return null;
                  return (
                    <button key={`door-${w}`} onClick={() => handleAddDoorCardinal(w)}
                      className="text-[10px] px-1.5 py-0.5 rounded font-semibold transition-all"
                      style={{ background: "rgba(124,58,237,0.2)", color: "#A78BFA", border: "1px solid rgba(124,58,237,0.3)" }}>
                      {labels[w]}
                    </button>
                  );
                });
              })()}
            </div>
            {/* ── 隐藏墙：mirror the +窗 / +门 button layout so polygon
                rooms get one toggle per actual edge (北墙1/北墙2/南墙1…)
                while rect rooms keep 4 cardinal toggles. Hidden walls
                render red so it's obvious which sides are off. ── */}
            <div className="flex flex-wrap items-center gap-0.5 ml-1">
              <span className="text-[10px] text-gray-500 mr-0.5">{t.fpHideWord}</span>
              {(() => {
                const labels = t.fpWallLabels;
                if (roomShape && roomShape.preset !== "rect") {
                  // Polygon room — one button per outline edge, keyed by
                  // edge index. Numbering matches the +窗/+门 buttons
                  // above so "南墙2" hide button targets the same edge
                  // that "+南墙2窗" added a window to.
                  const edges = getEdges(roomShape.points)
                    .filter(e => e.length > 40);
                  const seen: Record<string, number> = { N: 0, S: 0, W: 0, E: 0 };
                  return edges.map(e => {
                    seen[e.facing] += 1;
                    const sameFacingCount = edges.filter(x => x.facing === e.facing).length;
                    const idx = seen[e.facing];
                    const showIdx = sameFacingCount > 1;
                    const key = `edge-${e.i}`;
                    const hidden = wallsHiddenOnRoom?.[key] === true;
                    return (
                      <button key={`hide-${key}`}
                        onClick={() => toggleWallHidden(activeRoom, key)}
                        title={(hidden ? t.fpRestorePrefix : t.fpHidePrefix) + `${labels[e.facing]}${showIdx ? idx : ""}`}
                        className="text-[10px] px-1.5 py-0.5 rounded font-semibold transition-all"
                        style={hidden
                          ? { background: "rgba(239,68,68,0.32)", color: "#FCA5A5", border: "1px solid rgba(239,68,68,0.6)" }
                          : { background: "rgba(75,85,99,0.20)", color: "#9CA3AF", border: "1px solid rgba(75,85,99,0.35)" }}>
                        {hidden ? "✓" : "✕"}{labels[e.facing]}{showIdx ? idx : ""}
                      </button>
                    );
                  });
                }
                // Rect room — 4 cardinal toggles, key = side name.
                return (["N","S","W","E"] as const).map(w => {
                  const hidden = wallsHiddenOnRoom?.[w] === true;
                  return (
                    <button key={`hide-${w}`}
                      onClick={() => toggleWallHidden(activeRoom, w)}
                      title={(hidden ? t.fpRestorePrefix : t.fpHidePrefix) + `${labels[w]}`}
                      className="text-[10px] px-1.5 py-0.5 rounded font-semibold transition-all"
                      style={hidden
                        ? { background: "rgba(239,68,68,0.32)", color: "#FCA5A5", border: "1px solid rgba(239,68,68,0.6)" }
                        : { background: "rgba(75,85,99,0.20)", color: "#9CA3AF", border: "1px solid rgba(75,85,99,0.35)" }}>
                      {hidden ? "✓" : "✕"}{labels[w]}
                    </button>
                  );
                });
              })()}
              {/* 通用的「地板 / 天花板」显隐切换 —— 与 N/S/W/E 共用同一
                  roomWallsHidden 机制 (task #100)，所有房间都能用。例如：
                  天台休闲区把 ceiling+floor 关掉 = 露天甲板；楼梯出屋面间
                  打开 ceiling = 顶层屋面间挡雨。多边形房间也适用（与边数
                  无关，floor/ceiling 是两个独立键）。 */}
              {(["floor","ceiling"] as const).map(face => {
                const hidden = wallsHiddenOnRoom?.[face] === true;
                const lbl = face === "floor" ? t.fpFaceFloor : t.fpFaceCeiling;
                return (
                  <button key={`hide-${face}`}
                    onClick={() => toggleWallHidden(activeRoom, face)}
                    title={(hidden ? t.fpRestorePrefix : t.fpHidePrefix) + lbl}
                    className="text-[10px] px-1.5 py-0.5 rounded font-semibold transition-all"
                    style={hidden
                      ? { background: "rgba(239,68,68,0.32)", color: "#FCA5A5", border: "1px solid rgba(239,68,68,0.6)" }
                      : { background: "rgba(75,85,99,0.20)", color: "#9CA3AF", border: "1px solid rgba(75,85,99,0.35)" }}>
                    {hidden ? "✓" : "✕"}{lbl}
                  </button>
                );
              })}
            </div>
            {/* ── 幕墙模式：逐面三层(实墙/玻璃幕墙/框架)独立显隐 + 逐面玻璃透明度 ──
                墙归墙、幕墙归幕墙、框架归框架；全局「玻璃幕墙模式」是宏(= 隐实墙
                + 显玻璃 + 显框)，这里可逐面覆盖任意一层。 */}
            {curtainWall && (() => {
              let keys: { key: string; label: string }[];
              if (roomShape && roomShape.preset !== "rect") {
                const edges = getEdges(roomShape.points).filter(e => e.length > 40);
                const seen: Record<string, number> = { N: 0, S: 0, W: 0, E: 0 };
                keys = edges.map(e => {
                  seen[e.facing] += 1;
                  const same = edges.filter(x => x.facing === e.facing).length;
                  return { key: `edge-${e.i}`, label: `${t.fpWallLabels[e.facing]}${same > 1 ? seen[e.facing] : ""}` };
                });
              } else {
                keys = (["N", "S", "W", "E"] as const).map(w => ({ key: w, label: t.fpWallLabels[w] }));
              }
              const fpLike = {
                roomFacadeFaces: { [activeRoom]: facadeFacesOnRoom },
                roomWallsHidden: { [activeRoom]: wallsHiddenOnRoom },
              } as Parameters<typeof resolveFacadeLayer>[0];
              const en = t.fpWallLabels.N === "N";
              const layers: { layer: FacadeLayer; label: string }[] = [
                { layer: "wall",  label: en ? "Wall"  : "实墙" },
                { layer: "glass", label: en ? "Glass" : "幕墙" },
                { layer: "frame", label: en ? "Frame" : "框架" },
              ];
              return (
                <div className="flex flex-col gap-0.5 ml-1 mt-1 pt-1 border-t border-gray-700/40">
                  {layers.map(({ layer, label }) => (
                    <div key={layer} className="flex flex-wrap items-center gap-0.5">
                      <span className="text-[10px] text-gray-500 mr-0.5 w-8 text-right">{label}</span>
                      {keys.map(({ key, label: kl }) => {
                        const shown = resolveFacadeLayer(fpLike, activeRoom, key, layer, curtainWall);
                        return (
                          <button key={`${layer}-${key}`}
                            onClick={() => setFaceLayer(activeRoom, key, layer, !shown)}
                            title={`${shown ? t.fpHidePrefix : t.fpRestorePrefix}${label}·${kl}`}
                            className="text-[10px] px-1.5 py-0.5 rounded font-semibold transition-all"
                            style={shown
                              ? { background: "rgba(59,130,246,0.22)", color: "#93C5FD", border: "1px solid rgba(59,130,246,0.5)" }
                              : { background: "rgba(75,85,99,0.18)", color: "#9CA3AF", border: "1px solid rgba(75,85,99,0.3)" }}>
                            {shown ? "●" : "○"}{kl}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {/* 逐面玻璃透明度 */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-gray-500 mr-0.5 w-8 text-right">{en ? "Opacity" : "透明度"}</span>
                    {keys.map(({ key, label: kl }) => {
                      // 透明度 0..1：1 = 全透(清玻璃) ，0 = 不透(实心磨砂面)。默认 0.85。
                      const op = resolveFaceOpacity(fpLike, activeRoom, key, 0.85);
                      return (
                        <label key={`op-${key}`} className="flex items-center gap-0.5 text-[9px] text-gray-400">
                          {kl}
                          <input type="range" min={0} max={1} step={0.02} value={op}
                            onChange={(e) => setFaceOpacity(activeRoom, key, parseFloat(e.target.value))}
                            style={{ width: 44 }} />
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Zoomable SVG container — top padding so canvas doesn't crowd the toolbar */}
      <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: "top center", marginTop: 28 }}>
      <div className="relative" style={{ width: svgW + 60, height: svgH + 60 }}>
        {/* Left dimension */}
        <div className="absolute text-[10px] text-gray-600 font-mono"
          style={{ left: 6, top: svgH / 2 + 20, transform: "rotate(-90deg) translateX(-50%)", transformOrigin: "center", width: svgH }}>
          {(roomD / 100).toFixed(1)}m
        </div>
        {/* Bottom dimension */}
        <div className="absolute text-[10px] text-gray-600 font-mono text-center"
          style={{ left: 30, bottom: 6, width: svgW }}>
          {(roomW / 100).toFixed(1)}m
        </div>

        <svg
          ref={svgRef}
          width={svgW} height={svgH}
          style={{ display: "block", marginLeft: 30, cursor: dragState ? "grabbing" : "default" }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClick={handleSVGClick}
        >
          {/* Background */}
          <rect width={svgW} height={svgH} fill="#1a1c28" />

          {/* Grid */}
          {Array.from({ length: gridXCount + 1 }).map((_, i) => (
            <line key={`gx-${i}`}
              x1={i * 100 * scale} y1={0} x2={i * 100 * scale} y2={svgH}
              stroke={i % 2 === 0 ? "#2a2d3d" : "#252838"} strokeWidth={1} />
          ))}
          {Array.from({ length: gridZCount + 1 }).map((_, i) => (
            <line key={`gz-${i}`}
              x1={0} y1={i * 100 * scale} x2={svgW} y2={i * 100 * scale}
              stroke={i % 2 === 0 ? "#2a2d3d" : "#252838"} strokeWidth={1} />
          ))}

          {/* Floor fill */}
          <rect width={svgW} height={svgH}
            fill={roomState.materials.floor?.color ?? def.defaultFloorColor} opacity={0.18} />

          {/* Walls — rect outline for plain rect rooms, polygon outline when a
              shape override exists (any preset, including "rect" which now
              carries editable polygon points when editShape is active). */}
          {roomShape ? (
            <>
              {/* Light tint for out-of-polygon region: even-odd fill with the
                  polygon as a hole. Kept semi-transparent so the floor / grid
                  still read through — the polygon outline below is the
                  authoritative shape indicator. */}
              <path
                d={
                  `M 0 0 L ${svgW} 0 L ${svgW} ${svgH} L 0 ${svgH} Z ` +
                  `M ` + roomShape.points.map(([x,z],i)=>`${x*scale} ${z*scale}${i<roomShape.points.length-1?" L ":""}`).join("") +
                  ` Z`
                }
                fill="#1a1c28"
                fillOpacity={0.35}
                fillRule="evenodd"
                style={{ pointerEvents: "none" }}
              />
              {/* Polygon outline */}
              <polygon
                points={roomShape.points.map(([x,z]) => `${x*scale},${z*scale}`).join(" ")}
                fill="none"
                stroke={roomState.materials.wall?.color ?? def.defaultWallColor}
                strokeWidth={8} strokeOpacity={0.7}
                strokeLinejoin="round"
              />
              {/* Vertex handles — only visible in edit-shape mode. Drag to
                  reshape. Snapping to 10cm (≈ 1px at scale≈0.1) keeps walls
                  aligned. Switches preset to "custom" on first edit. */}
              {editShape && roomShape.points.map(([vx, vz], i) => {
                // Edge midpoint handle between vertex i and i+1
                const next = (i + 1) % roomShape.points.length;
                const [nx2, nz2] = roomShape.points[next];
                const midX = (vx + nx2) / 2;
                const midZ = (vz + nz2) / 2;
                return (
                  <g key={`vh-${i}`}>
                    {/* ── Vertex handle (amber circle) ── */}
                    <circle
                      cx={vx * scale} cy={vz * scale} r={9}
                      fill="#F59E0B" stroke="#fff" strokeWidth={2}
                      style={{ cursor: "grab" }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (roomShape.points.length <= 3) return;
                        pushLayoutHistory();
                        deleteRoomShapePoint(activeRoom, i);
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        if (e.altKey || e.shiftKey) {
                          if (roomShape.points.length <= 3) return;
                          pushLayoutHistory();
                          deleteRoomShapePoint(activeRoom, i);
                          return;
                        }
                        const svg = svgRef.current;
                        if (!svg) return;
                        pushLayoutHistory();
                        svg.setPointerCapture(e.pointerId);
                        const onMove = (ev: PointerEvent) => {
                          const r = svg.getBoundingClientRect();
                          const px = (ev.clientX - r.left) / zoomLevel;
                          const pz = (ev.clientY - r.top)  / zoomLevel;
                          const cx2 = Math.max(0, Math.min(roomW, Math.round((px / scale) / 10) * 10));
                          const cz2 = Math.max(0, Math.min(roomD, Math.round((pz / scale) / 10) * 10));
                          updateRoomShapePoint(activeRoom, i, cx2, cz2);
                        };
                        const onUp = () => { window.removeEventListener("pointermove", onMove); };
                        window.addEventListener("pointermove", onMove);
                        window.addEventListener("pointerup", onUp, { once: true });
                      }}
                    />
                    {/* ── Edge midpoint handle (small diamond) — click to insert vertex ── */}
                    <polygon
                      points={`${midX*scale},${midZ*scale - 7} ${midX*scale+7},${midZ*scale} ${midX*scale},${midZ*scale+7} ${midX*scale-7},${midZ*scale}`}
                      fill="#fff" stroke="#F59E0B" strokeWidth={1.5}
                      style={{ cursor: "copy", opacity: 0.85 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        pushLayoutHistory();
                        insertRoomShapePoint(activeRoom, i,
                          Math.round(midX / 10) * 10,
                          Math.round(midZ / 10) * 10,
                        );
                      }}
                    />
                  </g>
                );
              })}
            </>
          ) : (
            <>
              <rect x={0} y={0} width={svgW} height={svgH} fill="none"
                stroke={roomState.materials.wall?.color ?? def.defaultWallColor}
                strokeWidth={8} strokeOpacity={0.7} />
              <rect x={4} y={4} width={svgW - 8} height={svgH - 8}
                fill="none" stroke="#88AABB" strokeWidth={1} strokeOpacity={0.3} />
            </>
          )}

          {/* Windows */}
          {roomWindows.map(win => {
            // Resolve polygon edge for inner-edge windows
            let polygonEdge: { x1: number; z1: number; x2: number; z2: number; length: number } | undefined;
            if (win.edgeIndex != null && roomShape && roomShape.preset !== "rect") {
              const edges = getEdges(roomShape.points);
              const e = edges.find(x => x.i === win.edgeIndex);
              if (e) polygonEdge = { x1: e.x1, z1: e.z1, x2: e.x2, z2: e.z2, length: e.length };
            }
            return (
              <WindowSVG key={win.id} win={win} svgW={svgW} svgH={svgH} scale={scale}
                isEditMode={editWindows}
                polygonEdge={polygonEdge}
                onMoveDown={(e) => startWinDrag(e, win, "move")}
                onStartDown={(e) => startWinDrag(e, win, "start")}
                onEndDown={(e) => startWinDrag(e, win, "end")}
              />
            );
          })}

          {/* Window edit/delete buttons in edit mode */}
          {editWindows && roomWindows.map(win => {
            const R = 9;
            const clampX = (v: number) => Math.max(R, Math.min(svgW - R, v));
            const clampY = (v: number) => Math.max(R, Math.min(svgH - R, v));
            let dx: number, dy: number, sx: number, sy: number;

            // Polygon-bound window: place buttons at the window midpoint on
            // the actual edge, offset slightly into the room interior.
            if (win.edgeIndex != null && roomShape && roomShape.preset !== "rect") {
              const edges = getEdges(roomShape.points);
              const e = edges.find(x => x.i === win.edgeIndex);
              if (e) {
                const ux = (e.x2 - e.x1) / e.length;
                const uz = (e.z2 - e.z1) / e.length;
                const tMid = win.pos + win.len / 2;
                const mx = (e.x1 + ux * tMid) * scale;
                const my = (e.z1 + uz * tMid) * scale;
                // Inward normal in scale-pixels (15px nudge into room)
                const inX = e.nx * 15;
                const inY = e.nz * 15;
                dx = clampX(mx + inX);
                dy = clampY(my + inY);
                // Edit button: along the edge direction, ~22px before delete
                sx = clampX(dx - ux * 22);
                sy = clampY(dy - uz * 22);
                return (
                  <g key={`btns-${win.id}`}>
                    <g style={{ cursor: "pointer" }}
                      onClick={(ev) => { ev.stopPropagation(); setSelectedWinId(win.id); setDoorSelected(false); }}>
                      <circle cx={sx} cy={sy} r={R} fill="#3B82F6" opacity={selectedWinId === win.id ? 1 : 0.85} />
                      <text x={sx} y={sy} textAnchor="middle" dominantBaseline="middle"
                        fontSize={10} fill="white" style={{ pointerEvents: "none" }}>✎</text>
                    </g>
                    <g style={{ cursor: "pointer" }}
                      onPointerDown={(ev) => { ev.stopPropagation(); removeWindow(activeRoom, win.id); if (selectedWinId === win.id) setSelectedWinId(null); }}>
                      <circle cx={dx} cy={dy} r={R} fill="#EF4444" opacity={0.9} />
                      <text x={dx} y={dy} textAnchor="middle" dominantBaseline="middle"
                        fontSize={10} fill="white" style={{ pointerEvents: "none" }}>✕</text>
                    </g>
                  </g>
                );
              }
            }

            // Cardinal-bound window (rect rooms): old bbox-edge layout
            const mid = (win.pos + win.len / 2) * scale;
            const horiz = win.wall === "N" || win.wall === "S";
            if (win.wall === "N")           { dx = clampX(mid); dy = R + 4; }
            else if (win.wall === "S")      { dx = clampX(mid); dy = svgH - R - 4; }
            else if (win.wall === "E")      { dx = svgW - R - 4; dy = clampY(mid); }
            else                            { dx = R + 4;        dy = clampY(mid); }
            if (horiz) { sx = clampX(dx - R * 2.2); sy = dy; }
            else       { sx = dx;                   sy = clampY(dy - R * 2.2); }
            return (
              <g key={`btns-${win.id}`}>
                <g style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); setSelectedWinId(win.id); setDoorSelected(false); }}>
                  <circle cx={sx} cy={sy} r={R} fill="#3B82F6" opacity={selectedWinId === win.id ? 1 : 0.85} />
                  <text x={sx} y={sy} textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fill="white" style={{ pointerEvents: "none" }}>✎</text>
                </g>
                <g style={{ cursor: "pointer" }}
                  onPointerDown={(e) => { e.stopPropagation(); removeWindow(activeRoom, win.id); if (selectedWinId === win.id) setSelectedWinId(null); }}>
                  <circle cx={dx} cy={dy} r={R} fill="#EF4444" opacity={0.9} />
                  <text x={dx} y={dy} textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fill="white" style={{ pointerEvents: "none" }}>✕</text>
                </g>
              </g>
            );
          })}

          {/* Doors — multi-door, each rendered with cardinal or polygon-edge geometry */}
          {allDoors.map(d => {
            // Resolve polygon edge for inner-edge doors
            let polygonEdge: { x1: number; z1: number; x2: number; z2: number; length: number; nx: number; nz: number } | undefined;
            if (d.edgeIndex != null && roomShape && roomShape.preset !== "rect") {
              const edges = getEdges(roomShape.points);
              const e = edges.find(x => x.i === d.edgeIndex);
              if (e) polygonEdge = { x1: e.x1, z1: e.z1, x2: e.x2, z2: e.z2, length: e.length, nx: e.nx, nz: e.nz };
            }
            // Cardinal-wall coord — DoorSVG now speaks the same NSWE names.
            const cardinalDoorWall: DoorWall = d.wall as DoorWall;
            return (
              <g key={d.id}>
                <DoorSVG
                  svgW={svgW} svgH={svgH}
                  doorPosCm={d.pos} doorLenCm={d.len}
                  roomWidthCm={roomW} roomDepthCm={roomD}
                  doorWall={cardinalDoorWall}
                  scale={scale}
                  isEditMode={editWindows}
                  polygonEdge={polygonEdge}
                  noHitRect={editWindows && !polygonEdge}
                  onPointerDown={editWindows ? (e) => startDoorDrag(e, d.id) : (() => {})}
                />
                {/* Hit rect (drag) — rendered BEFORE the edit/delete
                    buttons so the buttons sit on top in SVG z-order.
                    Previous order trapped pointerdown in the hit-rect
                    and the user couldn't click ✎ or ✕.  */}
                {editWindows && !polygonEdge && (() => {
                  const isHoriz = cardinalDoorWall === "N" || cardinalDoorWall === "S";
                  const wallLen = isHoriz ? roomW : roomD;
                  const doorWpx = Math.min(d.len, wallLen) * scale;
                  const doorPosPx = d.pos * scale;
                  let hrX: number, hrY: number, hrW: number, hrH: number;
                  if (cardinalDoorWall === "S")      { hrX = doorPosPx - 4; hrY = svgH - 20; hrW = doorWpx + 8; hrH = 24; }
                  else if (cardinalDoorWall === "N") { hrX = doorPosPx - 4; hrY = -4;        hrW = doorWpx + 8; hrH = 24; }
                  else if (cardinalDoorWall === "W") { hrX = -4;            hrY = doorPosPx - 4; hrW = 24; hrH = doorWpx + 8; }
                  else                               { hrX = svgW - 20;     hrY = doorPosPx - 4; hrW = 24; hrH = doorWpx + 8; }
                  return (
                    <rect x={hrX} y={hrY} width={hrW} height={hrH}
                      fill="transparent" style={{ cursor: "move" }}
                      onPointerDown={(e) => startDoorDrag(e, d.id)} />
                  );
                })()}
                {/* Per-door delete/edit buttons */}
                {editWindows && (() => {
                  const R = 9;
                  const clampX = (v: number) => Math.max(R, Math.min(svgW - R, v));
                  const clampY = (v: number) => Math.max(R, Math.min(svgH - R, v));
                  let dx: number, dy: number, sx: number, sy: number;
                  if (polygonEdge) {
                    const ux = (polygonEdge.x2 - polygonEdge.x1) / polygonEdge.length;
                    const uz = (polygonEdge.z2 - polygonEdge.z1) / polygonEdge.length;
                    const tMid = d.pos + d.len / 2;
                    const mx = (polygonEdge.x1 + ux * tMid) * scale;
                    const my = (polygonEdge.z1 + uz * tMid) * scale;
                    dx = clampX(mx + polygonEdge.nx * 15);
                    dy = clampY(my + polygonEdge.nz * 15);
                    sx = clampX(dx - ux * 22);
                    sy = clampY(dy - uz * 22);
                  } else {
                    const isHoriz = cardinalDoorWall === "N" || cardinalDoorWall === "S";
                    const wallLen = isHoriz ? roomW : roomD;
                    const doorWpx = Math.min(d.len, wallLen) * scale;
                    const doorMid = d.pos * scale + doorWpx / 2;
                    if (cardinalDoorWall === "S")      { dx = doorMid; dy = svgH - 14; }
                    else if (cardinalDoorWall === "N") { dx = doorMid; dy = 14; }
                    else if (cardinalDoorWall === "W") { dx = 14; dy = doorMid; }
                    else                               { dx = svgW - 14; dy = doorMid; }
                    sx = isHoriz ? clampX(dx - R * 2.2) : dx;
                    sy = isHoriz ? dy : clampY(dy - R * 2.2);
                  }
                  const isLegacy = d.id === `${activeRoom}-legacy-door`;
                  // Use onPointerDown (not onClick) so the gesture wins
                  // even when the wider drag hit-rect (rendered later in
                  // editWindows mode for cardinal-wall doors) is on top.
                  // stopPropagation prevents the drag handler from claiming
                  // the same pointer.
                  return (
                    <g>
                      <g style={{ cursor: "pointer" }}
                        onPointerDown={(ev) => {
                          ev.stopPropagation();
                          setDoorSelected(true); setSelectedWinId(null); setSelectedDoorId(d.id);
                        }}>
                        <circle cx={sx} cy={sy} r={R} fill="#3B82F6" opacity={(doorSelected && selectedDoorId === d.id) ? 1 : 0.85} />
                        <text x={sx} y={sy} textAnchor="middle" dominantBaseline="middle"
                          fontSize={10} fill="white" style={{ pointerEvents: "none" }}>✎</text>
                      </g>
                      <g style={{ cursor: "pointer" }}
                        onPointerDown={(ev) => {
                          ev.stopPropagation();
                          if (isLegacy) setRoomHasDoor(activeRoom, false);
                          else removeDoor(activeRoom, d.id);
                          setDoorSelected(false);
                        }}>
                        <circle cx={dx} cy={dy} r={R} fill="#EF4444" opacity={0.9} />
                        <text x={dx} y={dy} textAnchor="middle" dominantBaseline="middle"
                          fontSize={10} fill="white" style={{ pointerEvents: "none" }}>✕</text>
                      </g>
                    </g>
                  );
                })()}
              </g>
            );
          })}
          {false && (
            /* No door — show "add door" button in edit mode, near active wall */
            editWindows && (() => {
              let bx: number, by: number;
              if (doorWall === "S")      { bx = svgW * 0.08;     by = svgH - 18; }
              else if (doorWall === "N") { bx = svgW * 0.08;     by = 0; }
              else if (doorWall === "W") { bx = 0;               by = svgH * 0.08; }
              else                       { bx = svgW - 60;       by = svgH * 0.08; }
              return (
                <g style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); setRoomHasDoor(activeRoom, true); }}>
                  <rect x={bx} y={by} width={60} height={18} fill="#10B981" opacity={0.85} rx={4} />
                  <text x={bx + 30} y={by + 9} textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fill="white" style={{ pointerEvents: "none" }}>{t.fpAddDoorBtn}</text>
                </g>
              );
            })()
          )}

          {/* Compass hidden per user request. */}
          {false && (
            <g transform={`translate(${svgW - 22}, 22)`}>
              <circle r={12} fill="rgba(0,0,0,0.5)" />
              <text x={0} y={-5} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="#4488AA">N</text>
              <line x1={0} y1={-9} x2={0} y2={-4} stroke="#4488AA" strokeWidth={1.5} />
            </g>
          )}

          {/* Door-swing zone — always shown when door exists */}
          {doorSwing && (() => {
            const { bbox, wall } = doorSwing;
            const x = (bbox.cx - bbox.w / 2) * scale;
            const y = (bbox.cz - bbox.d / 2) * scale;
            const w = bbox.w * scale;
            const h = bbox.d * scale;
            const blocked = evaluated.some(e => e.violations.some(v => v.kind === "door"));
            const color = blocked ? "#EF4444" : "#10B981";
            // Quadrant arc hinted via SVG arc in the correct corner.
            // Hinge corner is the one closest to a room corner along the wall.
            let hingeX = x, hingeY = y;
            let sweepX = x + w, sweepY = y + h;
            if (wall === "S")      { hingeX = x;       hingeY = y + h; sweepX = x + w; sweepY = y; }
            else if (wall === "N") { hingeX = x;       hingeY = y;     sweepX = x + w; sweepY = y + h; }
            else if (wall === "W") { hingeX = x;       hingeY = y;     sweepX = x + w; sweepY = y + h; }
            else                   { hingeX = x + w;   hingeY = y;     sweepX = x;     sweepY = y + h; }
            const r = Math.min(w, h);
            return (
              <g style={{ pointerEvents: "none" }}>
                <rect x={x} y={y} width={w} height={h}
                  fill={color} fillOpacity={0.10}
                  stroke={color} strokeOpacity={0.55} strokeWidth={1}
                  strokeDasharray="4 3" rx={2} />
                {/* 90° arc from hinge — visual hint of swing direction */}
                <path
                  d={`M ${hingeX + (sweepX - hingeX)} ${hingeY} A ${r} ${r} 0 0 ${wall === "S" || wall === "E" ? 1 : 0} ${hingeX} ${hingeY + (sweepY - hingeY)}`}
                  fill="none" stroke={color} strokeOpacity={0.6} strokeWidth={1} strokeDasharray="2 2"
                />
              </g>
            );
          })()}

          {/* Clearance zones — show for (a) selected items and (b) any item with violations */}
          {evaluated.map(({ placed, zone, violations }) => {
            if (!zone) return null;
            const isSel = selectedInstanceIds.includes(placed.instanceId);
            const hasViol = violations.length > 0;
            if (!isSel && !hasViol) return null;
            const color = hasViol
              ? (violations.some(v => v.severity === "required") ? "#EF4444" : "#F59E0B")
              : "#60A5FA";
            return (
              <rect
                key={`clear-${placed.instanceId}`}
                x={(zone.cx - zone.w / 2) * scale}
                y={(zone.cz - zone.d / 2) * scale}
                width={zone.w * scale}
                height={zone.d * scale}
                fill={color}
                fillOpacity={hasViol ? 0.14 : 0.08}
                stroke={color}
                strokeOpacity={hasViol ? 0.7 : 0.45}
                strokeWidth={1}
                strokeDasharray="3 3"
                rx={3}
                style={{ pointerEvents: "none" }}
              />
            );
          })}

          {/* Pipe / wire routing connections — render UNDER furniture so
              icons stay clickable. Color by kind (yellow=wire, blue=cold,
              red=hot, gray=drain). Click line to delete. */}
          {(roomState.connections ?? []).map(conn => {
            const a = roomState.placedItems.find(p => p.instanceId === conn.from);
            const b = roomState.placedItems.find(p => p.instanceId === conn.to);
            if (!a || !b) return null;
            const colorMap: Record<string, string> = {
              "wire": "#FACC15",
              "cold-water": "#3B82F6",
              "hot-water": "#EF4444",
              "drain": "#6B7280",
            };
            const color = colorMap[conn.kind] ?? "#999";
            // Manhattan (L-shape) routing: pipe/wire takes a horizontal
            // and a vertical leg via one elbow, mirroring how real conduit
            // and water pipes follow walls. Pick whichever leg is longer
            // first so the elbow lands on the longer axis.
            const x1 = a.x * scale, y1 = a.z * scale;
            const x2 = b.x * scale, y2 = b.z * scale;
            const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
            const cornerX = dx > dy ? x2 : x1;
            const cornerY = dx > dy ? y1 : y2;
            const points = `${x1},${y1} ${cornerX},${cornerY} ${x2},${y2}`;
            return (
              <g key={conn.id}>
                <polyline
                  points={points}
                  fill="none" stroke="transparent" strokeWidth={12}
                  style={{ cursor: "pointer" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (window.confirm(t.fpDeletePipeConfirm)) {
                      useDesignerStore.getState().removeRoutingConnection(activeRoom, conn.id);
                    }
                  }}
                />
                <polyline
                  points={points}
                  fill="none" stroke={color} strokeWidth={3}
                  strokeDasharray={conn.kind === "wire" ? "0" : "6 3"}
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ pointerEvents: "none" }}
                />
              </g>
            );
          })}

          {/* Routing-from indicator: highlight the chosen first endpoint.
              Rendered via subcomponent so we can subscribe to routingFrom
              with useDesignerStore reactively (a snapshot via getState()
              wouldn't update when state changes). */}
          <RoutingFromHighlight
            placedItems={roomState.placedItems}
            scale={scale}
          />

          {/* Routing preview line — when in routing mode and a from-endpoint
              is set, follow the cursor with a faint dashed L-line that
              snaps to the nearest valid fixture if the cursor is within
              30px of one. Visual confirmation of "what would be drawn". */}
          <RoutingPreview
            placedItems={roomState.placedItems}
            scale={scale}
            svgRef={svgRef}
          />

          {/* Routing validation overlay — red ring around any fixture
              missing a required hookup. Tooltip on hover via <title>. */}
          <RoutingIssueOverlay
            placedItems={roomState.placedItems}
            connections={roomState.connections ?? []}
            scale={scale}
          />

          {/* Placed furniture */}
          {roomState.placedItems.map((placed) => (
            <PlacedItemSVG
              key={placed.instanceId}
              placed={placed}
              scale={scale}
              isSelected={selectedInstanceIds.includes(placed.instanceId)}
              isBlocked={dragState?.blockedIds?.includes(placed.instanceId)}
              hasViolation={violatingIds.has(placed.instanceId)}
              violationSeverity={violatingIds.get(placed.instanceId)}
              onPointerDown={(e) => handleItemPointerDown(e, placed.instanceId)}
            />
          ))}

          {/* Relational links (e.g. TV ↔ sofa viewing distance, desk ↔ window) */}
          {links.map((link, i) => {
            const a = roomState.placedItems.find(p => p.instanceId === link.fromInstanceId);
            if (!a) return null;
            let x2: number, y2: number;
            if (link.toInstanceId) {
              const b = roomState.placedItems.find(p => p.instanceId === link.toInstanceId);
              if (!b) return null;
              x2 = b.x * scale; y2 = b.z * scale;
            } else if (link.toPoint) {
              x2 = link.toPoint.x * scale; y2 = link.toPoint.z * scale;
            } else {
              return null;
            }
            const x1 = a.x * scale, y1 = a.z * scale;
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            const color = link.violates
              ? (link.severity === "required" ? "#EF4444" : "#F59E0B")
              : "#60A5FA";
            const label = `${(link.distanceCm / 100).toFixed(1)}m`;
            return (
              <g key={`link-${i}`} style={{ pointerEvents: "none" }}>
                <line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={color} strokeOpacity={0.7} strokeWidth={1.5}
                  strokeDasharray="5 4" />
                <rect x={mx - 18} y={my - 8} width={36} height={16} rx={8}
                  fill={color} fillOpacity={0.95} />
                <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
                  fontSize={10} fill="white" fontWeight="bold">
                  {label}
                </text>
              </g>
            );
          })}

          {/* Empty state */}
          {roomState.placedItems.length === 0 && (
            <text x={svgW / 2} y={svgH / 2} textAnchor="middle" dominantBaseline="middle"
              fontSize={12} fill="#3A4055">
              {t.fpFurnitureHint}
            </text>
          )}
          {/* ── NSWE wall labels — code convention back=N (-Z, top of svg),
               front=S (+Z, bottom of svg), left=W (-X), right=E (+X).
               由 showCompass 开关控制显隐。 ── */}
          {showCompass && (() => {
            const fs = Math.max(20, Math.min(48, Math.min(svgW, svgH) * 0.05));
            const inset = Math.max(8, fs * 0.4);
            const lbls = [
              { x: svgW / 2,         y: inset + fs * 0.5, t: "N" },
              { x: svgW / 2,         y: svgH - inset,     t: "S" },
              { x: inset,            y: svgH / 2,         t: "W" },
              { x: svgW - inset,     y: svgH / 2,         t: "E" },
            ];
            return lbls.map((l, i) => (
              <text key={`nswe-${i}`} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle"
                fontSize={fs} fontWeight={900} fill="#FF1493" stroke="#FFFFFF" strokeWidth={3}
                paintOrder="stroke" style={{ pointerEvents: "none", userSelect: "none" }}>
                {l.t}
              </text>
            ));
          })()}
        </svg>
      </div>
      </div>{/* end zoom wrapper */}
      {/* Legend — desktop only */}
      <div className="hidden md:flex mt-2 flex-wrap items-center gap-3 text-[10px] text-gray-600 justify-center pb-2">
        <span>{t.fpLegendDrag}</span>
        <span>{t.fpLegendMulti}</span>
        <span>{t.fpLegendRotate}</span>
        <span>{t.fpLegendCopy}</span>
        <span>{t.fpLegendDelete}</span>
        <span>{t.fpLegendEdit}</span>
        <span>{t.fpLegendGrid}</span>
      </div>
    </div>{/* ── end scrollable canvas area ── */}

      {/* Window / door size inspector (edit mode) */}
      {editWindows && (selectedWinId || doorSelected) && (() => {
        const selectedWin = selectedWinId ? roomWindows.find(w => w.id === selectedWinId) ?? null : null;
        if (doorSelected) {
          const sel = allDoors.find(d => d.id === selectedDoorId) ?? allDoors[0];
          if (!sel) return null;
          const isLegacy = sel.id === `${activeRoom}-legacy-door`;
          // Wall length: edge length for polygon-edge doors, bbox wall otherwise
          let wallLen: number;
          if (sel.edgeIndex != null && roomShape && roomShape.preset !== "rect") {
            const edges = getEdges(roomShape.points);
            const e = edges.find(x => x.i === sel.edgeIndex);
            wallLen = e ? e.length : ((sel.wall === "N" || sel.wall === "S") ? roomW : roomD);
          } else {
            wallLen = (sel.wall === "N" || sel.wall === "S") ? roomW : roomD;
          }
          const dLen = sel.len;
          const dH   = sel.h ?? doorHDefault;
          const dStyle = sel.style ?? "wood_panel";
          const patchDoor = (patch: Partial<typeof sel>) => {
            if (isLegacy) {
              // Migrate legacy single-door to roomDoors[] on first edit
              if (patch.len   != null) setDoorLen(activeRoom, patch.len);
              if (patch.h     != null) setDoorH(activeRoom, patch.h);
              if (patch.style != null) setDoorStyle(activeRoom, patch.style);
            } else {
              updateDoor(activeRoom, sel.id, patch);
            }
          };
          return (
            <div className={isLandscape
              ? "mt-3 mx-auto max-w-lg w-full bg-gray-800/80 rounded-xl border border-gray-700/50 backdrop-blur flex flex-col gap-2 shrink-0 px-4 py-3"
              : "flex flex-col gap-2 bg-gray-900/95 rounded-t-xl border-t border-gray-700/50 backdrop-blur-md w-full px-4 py-3"}
              style={!isLandscape ? { paddingBottom: "max(12px, env(safe-area-inset-bottom, 12px))" } : undefined}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-200 flex-1">🚪 {t.fpDoorLabel.replace(/:$/, "")}</span>
                <button onClick={() => setDoorSelected(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 active:text-white"
                  style={{ background: "rgba(255,255,255,0.08)" }}>✕</button>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[10px] text-gray-400">{t.fpWidth}</span>
                  <span className="text-[10px] text-gray-300 font-mono">{(dLen / 100).toFixed(2)}m</span>
                </div>
                <input type="range" min={50} max={Math.min(200, wallLen)} step={5}
                  value={dLen}
                  onChange={e => patchDoor({ len: parseInt(e.target.value) })}
                  className="w-full accent-blue-500 h-2 md:h-1.5" />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[10px] text-gray-400">{t.fpHeight}</span>
                  <span className="text-[10px] text-gray-300 font-mono">{(dH / 100).toFixed(2)}m</span>
                </div>
                <input type="range" min={140} max={260} step={5}
                  value={dH}
                  onChange={e => patchDoor({ h: parseInt(e.target.value) })}
                  className="w-full accent-blue-500 h-2 md:h-1.5" />
              </div>
              {/* Door style selector */}
              <div>
                <div className="text-[10px] text-gray-400 mb-1">{t.fpStyleLabel}</div>
                <div className="grid grid-cols-4 gap-1">
                  {([
                    { key: "wood_panel",    label: t.fpDoorStyleWood },
                    { key: "frosted_glass", label: t.fpDoorStyleFrosted },
                    { key: "sliding_barn",  label: t.fpDoorStyleBarn },
                    { key: "french_double", label: t.fpDoorStyleFrench },
                  ] as const).map(s => {
                    const active = dStyle === s.key;
                    return (
                      <button
                        key={s.key}
                        onClick={() => patchDoor({ style: s.key })}
                        className="text-[10px] py-1.5 rounded-md transition-all"
                        style={
                          active
                            ? { background: "#3B82F6", color: "white", fontWeight: 600 }
                            : { background: "rgba(255,255,255,0.08)", color: "#C0C0C8", border: "1px solid rgba(255,255,255,0.12)" }
                        }
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        }
        if (!selectedWin) return null;
        // For polygon-bound windows (edgeIndex set), the slider range is the
        // length of THAT edge. For cardinal-bound windows it's the bbox wall.
        let wallLen: number;
        if (selectedWin.edgeIndex != null && roomShape && roomShape.preset !== "rect") {
          const edges = getEdges(roomShape.points);
          const e = edges.find(x => x.i === selectedWin.edgeIndex);
          wallLen = e ? e.length : ((selectedWin.wall === "N" || selectedWin.wall === "S") ? roomW : roomD);
        } else {
          wallLen = (selectedWin.wall === "N" || selectedWin.wall === "S") ? roomW : roomD;
        }
        const winH   = selectedWin.h   ?? 150;
        const winSill = selectedWin.sill ?? 90;
        const ceilH = def.height;
        return (
          <div className={isLandscape
            ? "mt-3 mx-auto max-w-lg w-full bg-gray-800/80 rounded-xl border border-gray-700/50 backdrop-blur flex flex-col gap-2 shrink-0 px-4 py-3"
            : "flex flex-col gap-2 bg-gray-900/95 rounded-t-xl border-t border-gray-700/50 backdrop-blur-md w-full px-4 py-3"}
            style={!isLandscape ? { paddingBottom: "max(12px, env(safe-area-inset-bottom, 12px))" } : undefined}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-200 flex-1">🪟 {t.fpWindowWord}</span>
              <button onClick={() => setSelectedWinId(null)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 active:text-white"
                style={{ background: "rgba(255,255,255,0.08)" }}>✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[10px] text-gray-400">{t.fpWidth}</span>
                  <span className="text-[10px] text-gray-300 font-mono">{(selectedWin.len / 100).toFixed(2)}m</span>
                </div>
                <input type="range" min={40} max={Math.max(60, wallLen - selectedWin.pos)} step={5}
                  value={selectedWin.len}
                  onChange={e => updateWindow(activeRoom, selectedWin.id, { len: parseInt(e.target.value) })}
                  className="w-full accent-blue-500 h-2 md:h-1.5" />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[10px] text-gray-400">{t.fpHeight}</span>
                  <span className="text-[10px] text-gray-300 font-mono">{(winH / 100).toFixed(2)}m</span>
                </div>
                <input type="range" min={40} max={Math.min(240, ceilH - 5)} step={5}
                  value={winH}
                  onChange={e => {
                    // 高度 = 窗户自身尺寸高度，与离地高度解耦：滑块量程只受层高约束，
                    // 不再随离地高度缩水。仅当「离地高度 + 新高度」会顶穿天花板时，
                    // 才把离地高度下压到刚好贴顶，保证窗体始终在房间内（物理定位）。
                    const newH = parseInt(e.target.value);
                    const maxSill = Math.max(0, ceilH - newH - 5);
                    const patch: Partial<WindowConfig> = { h: newH };
                    if (winSill > maxSill) patch.sill = maxSill;
                    updateWindow(activeRoom, selectedWin.id, patch);
                  }}
                  className="w-full accent-blue-500 h-2 md:h-1.5" />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[10px] text-gray-400">↕ {t.fpElevation}</span>
                <span className="text-[10px] text-gray-300 font-mono">{winSill} cm</span>
              </div>
              <input type="range" min={0} max={Math.max(0, ceilH - winH - 5)} step={5}
                value={winSill}
                onChange={e => updateWindow(activeRoom, selectedWin.id, { sill: parseInt(e.target.value) })}
                className="w-full accent-amber-400 h-2 md:h-1.5" />
            </div>
            {/* Window style selector */}
            <div>
              <div className="text-[10px] text-gray-400 mb-1">{t.fpStyleLabel}</div>
              <div className="grid grid-cols-3 gap-1">
                {([
                  { key: "sliding",  label: t.fpWindowStyleSliding },
                  { key: "casement", label: t.fpWindowStyleCasement },
                  { key: "fixed",    label: t.fpWindowStyleFixed },
                  { key: "louvered", label: t.fpWindowStyleLouvered },
                  { key: "security", label: t.fpWindowStyleSecurity },
                  { key: "wooden",   label: t.fpWindowStyleWooden },
                ] as const).map(s => {
                  const active = (selectedWin.style ?? "sliding") === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => updateWindow(activeRoom, selectedWin.id, { style: s.key })}
                      className="text-[10px] py-1.5 rounded-md transition-all"
                      style={
                        active
                          ? { background: "#3B82F6", color: "white", fontWeight: 600 }
                          : { background: "rgba(255,255,255,0.08)", color: "#C0C0C8", border: "1px solid rgba(255,255,255,0.12)" }
                      }
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Multi-select action bar */}
      {selectedInstanceIds.length > 1 && (
        <div className={isLandscape
          ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[200] w-72 bg-gray-900/98 rounded-2xl px-4 py-3 border border-blue-500/50 shadow-2xl backdrop-blur-md flex items-center gap-2"
          : "flex items-center gap-2 bg-gray-900/95 rounded-t-xl px-4 py-3 border-t border-blue-500/40 backdrop-blur-md w-full"}>
          <span className="text-xs text-blue-300 font-semibold flex-1">{t.fpMultiSelected(selectedInstanceIds.length)}</span>
          <button
            onClick={() => copyToClipboard(selectedInstanceIds)}
            className="px-2.5 py-1 bg-blue-600/80 hover:bg-blue-600 text-white text-[11px] font-semibold rounded-lg transition-colors"
          >
            {t.fpMultiCopy}
          </button>
          <button
            onClick={() => removeItems(selectedInstanceIds)}
            className="px-2.5 py-1 bg-red-600/80 hover:bg-red-600 text-white text-[11px] font-semibold rounded-lg transition-colors"
          >
            {t.fpMultiDelete}
          </button>
          <button
            onClick={() => setSelection([])}
            className="px-2.5 py-1 bg-gray-600/80 hover:bg-gray-600 text-gray-200 text-[11px] font-semibold rounded-lg transition-colors"
          >
            {t.fpMultiCancel}
          </button>
        </div>
      )}

      {/* Selected item controls */}
      {selectedItem && selectedFurniture && (
        <div
          ref={inspectorRef}
          className={inspectorPos
            ? "fixed z-[200] w-80 bg-gray-900/98 rounded-2xl border border-gray-700/60 shadow-2xl backdrop-blur-md flex flex-col gap-2 overflow-y-auto"
            : isLandscape
              ? "mt-3 mx-auto max-w-lg w-full bg-gray-800/80 rounded-xl border border-gray-700/50 backdrop-blur flex flex-col gap-2 shrink-0"
              : "flex flex-col gap-2 bg-gray-900/95 rounded-t-xl border-t border-gray-700/50 backdrop-blur-md w-full"}
          style={inspectorPos
            ? { left: inspectorPos.x, top: inspectorPos.y, maxHeight: "80dvh" }
            : isLandscape
              ? undefined
              : { paddingBottom: "max(12px, env(safe-area-inset-bottom, 12px))" }}
        >
          {/* Drag handle — always shown, lets user reposition panel */}
          <div
            onPointerDown={handleInspectorDragStart}
            className="flex items-center justify-center h-5 shrink-0 rounded-t-2xl cursor-grab active:cursor-grabbing touch-none select-none"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <div className="w-8 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
          </div>
          <div className="flex flex-col gap-2 px-4 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-md shrink-0 border border-white/20" style={{ background: selectedFurniture.color }} />
            <span className="text-xs font-semibold text-gray-200 truncate min-w-0 flex-1">
              {locale === "en" ? (getFurnitureNameEn(selectedFurniture.id) ?? selectedFurniture.name) : selectedFurniture.name}
              <span className="text-[10px] text-gray-500 font-normal ml-1">
                {(selectedItem.x / 100).toFixed(1)},{(selectedItem.z / 100).toFixed(1)}m · {selectedItem.rotation}°
              </span>
            </span>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => rotateItem(selectedItem.instanceId)}
                className="px-2 py-1 bg-blue-600/80 active:bg-blue-600 text-white text-[11px] font-semibold rounded-lg">
                ↻ {t.fpRotateItem}
              </button>
              <button onClick={() => copyToClipboard([selectedItem.instanceId])}
                className="px-2 py-1 text-white text-[11px] font-semibold rounded-lg"
                style={{ background: "rgba(0,122,255,0.7)" }}>
                ⧉ {t.fpCopyItem}
              </button>
              <button onClick={() => removeItem(selectedItem.instanceId)}
                className="px-2 py-1 bg-red-600/80 active:bg-red-600 text-white text-[11px] font-semibold rounded-lg">
                ✕ {t.fpDeleteItem}
              </button>
              <button onClick={() => setSelection([])}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 active:text-white shrink-0"
                style={{ background: "rgba(255,255,255,0.08)" }}>
                ✕
              </button>
            </div>
          </div>

          {/* Size sliders */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[10px] text-gray-400">{t.fpWidth}</span>
                <span className="text-[10px] text-gray-300 font-mono">
                  {(selectedFurniture.width * (selectedItem.scaleW ?? 1) / 100).toFixed(2)}m
                </span>
              </div>
              <input type="range" min={30} max={400} step={5}
                value={Math.round((selectedItem.scaleW ?? 1) * 100)}
                onMouseDown={() => pushFurnitureHistory()}
                onTouchStart={() => pushFurnitureHistory()}
                onChange={e => {
                  const newSW = parseInt(e.target.value) / 100;
                  resizeItem(selectedItem.instanceId, newSW, selectedItem.scaleD ?? 1);
                  const rot90 = (selectedItem.rotation ?? 0) === 90 || (selectedItem.rotation ?? 0) === 270;
                  const rawHW = selectedFurniture.width * newSW / 2;
                  const rawHD = selectedFurniture.depth * (selectedItem.scaleD ?? 1) / 2;
                  const hw = Math.min(rot90 ? rawHD : rawHW, roomW / 2);
                  const hd = Math.min(rot90 ? rawHW : rawHD, roomD / 2);
                  const cx = Math.max(hw, Math.min(roomW - hw, selectedItem.x));
                  const cz = Math.max(hd, Math.min(roomD - hd, selectedItem.z));
                  if (cx !== selectedItem.x || cz !== selectedItem.z) moveItem(selectedItem.instanceId, cx, cz);
                }}
                className="w-full accent-blue-500 h-2 md:h-1.5" />
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[10px] text-gray-400">{t.fpDepth}</span>
                <span className="text-[10px] text-gray-300 font-mono">
                  {(selectedFurniture.depth * (selectedItem.scaleD ?? 1) / 100).toFixed(2)}m
                </span>
              </div>
              <input type="range" min={30} max={400} step={5}
                value={Math.round((selectedItem.scaleD ?? 1) * 100)}
                onMouseDown={() => pushFurnitureHistory()}
                onTouchStart={() => pushFurnitureHistory()}
                onChange={e => {
                  const newSD = parseInt(e.target.value) / 100;
                  resizeItem(selectedItem.instanceId, selectedItem.scaleW ?? 1, newSD);
                  const rot90 = (selectedItem.rotation ?? 0) === 90 || (selectedItem.rotation ?? 0) === 270;
                  const rawHW = selectedFurniture.width * (selectedItem.scaleW ?? 1) / 2;
                  const rawHD = selectedFurniture.depth * newSD / 2;
                  const hw = Math.min(rot90 ? rawHD : rawHW, roomW / 2);
                  const hd = Math.min(rot90 ? rawHW : rawHD, roomD / 2);
                  const cx = Math.max(hw, Math.min(roomW - hw, selectedItem.x));
                  const cz = Math.max(hd, Math.min(roomD - hd, selectedItem.z));
                  if (cx !== selectedItem.x || cz !== selectedItem.z) moveItem(selectedItem.instanceId, cx, cz);
                }}
                className="w-full accent-blue-500 h-2 md:h-1.5" />
            </div>
          </div>
          {/* Height slider */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-gray-400">↥ {t.fpHeight}</span>
              <span className="text-[10px] text-gray-300 font-mono">
                {(selectedFurniture.height * (selectedItem.scaleH ?? 1) / 100).toFixed(2)}m
              </span>
            </div>
            <input type="range" min={30} max={400} step={5}
              value={Math.round((selectedItem.scaleH ?? 1) * 100)}
              onMouseDown={() => pushFurnitureHistory()}
              onTouchStart={() => pushFurnitureHistory()}
              onChange={e => {
                const newSH = parseInt(e.target.value) / 100;
                resizeItem(selectedItem.instanceId, selectedItem.scaleW ?? 1, selectedItem.scaleD ?? 1, newSH);
              }}
              className="w-full accent-blue-500 h-2 md:h-1.5" />
          </div>

          {/* Elevation slider */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-gray-400">
                ↕ {t.fpElevation}
              </span>
              <span className="text-[10px] text-gray-300 font-mono">
                {selectedItem.elevationY ?? 0} cm
              </span>
            </div>
            <input type="range" min={0} max={200} step={5}
              value={selectedItem.elevationY ?? 0}
              onMouseDown={() => pushFurnitureHistory()}
              onTouchStart={() => pushFurnitureHistory()}
              onChange={e => setElevation(selectedItem.instanceId, parseInt(e.target.value))}
              className="w-full accent-amber-400 h-2 md:h-1.5" />
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-gray-600">0</span>
              <span className="text-[9px] text-gray-600">50</span>
              <span className="text-[9px] text-gray-600">100</span>
              <span className="text-[9px] text-gray-600">150</span>
              <span className="text-[9px] text-gray-600">200cm</span>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <button onClick={() => { resizeItem(selectedItem.instanceId, 1, 1, 1); setElevation(selectedItem.instanceId, 0); }}
              className="text-[10px] text-gray-500 hover:text-gray-300 underline">{t.fpResetSize}</button>
            <span className="text-[10px] text-gray-600">
              {t.fpOriginal} {(selectedFurniture.width / 100).toFixed(2)}m × {(selectedFurniture.depth / 100).toFixed(2)}m × {(selectedFurniture.height / 100).toFixed(2)}m
            </span>
          </div>
          </div>{/* end px-4 pb-3 */}
        </div>
      )}

    </div>
  );
}

// ─── Routing mode toggle (pipes / wires) ────────────────────
const ROUTING_KINDS: Array<{ id: import("@/lib/types").RoutingKind; color: string; emoji: string }> = [
  { id: "wire",       color: "#FACC15", emoji: "⚡" },
  { id: "cold-water", color: "#3B82F6", emoji: "🔵" },
  { id: "hot-water",  color: "#EF4444", emoji: "🔴" },
  { id: "drain",      color: "#6B7280", emoji: "⚫" },
];

function RoutingModeButton() {
  const mode = useDesignerStore(s => s.routingMode);
  const setMode = useDesignerStore(s => s.setRoutingMode);
  const [open, setOpen] = useState(false);
  const t = useT();
  const labelFor = (id: import("@/lib/types").RoutingKind) =>
    id === "wire" ? t.fpRoutingWire :
    id === "cold-water" ? t.fpRoutingCold :
    id === "hot-water" ? t.fpRoutingHot :
    t.fpRoutingDrain;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title={t.fpRoutingMenuTitle}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all"
        style={
          mode
            ? { background: ROUTING_KINDS.find(k => k.id === mode)?.color ?? "#FACC15", color: "#1A1A1A" }
            : { color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.15)", background: "transparent" }
        }
      >
        <span>🔧</span>
        <span>{mode ? labelFor(mode) : t.fpRoutingDefault}</span>
      </button>
      {open && (
        <div className="absolute top-full mt-1 right-0 z-20 flex flex-col gap-1 p-1 rounded-lg shadow-lg" style={{ background: "#1A1A1A", border: "1px solid rgba(255,255,255,0.15)" }}>
          <button
            onClick={() => { setMode(null); setOpen(false); }}
            className="px-2 py-1 text-[11px] text-left rounded text-gray-300 hover:bg-gray-700"
          >{t.fpRoutingExit}</button>
          {ROUTING_KINDS.map(k => (
            <button key={k.id}
              onClick={() => { setMode(k.id); setOpen(false); }}
              className={`flex items-center gap-1.5 px-2 py-1 text-[11px] text-left rounded transition-all ${
                mode === k.id ? "font-bold" : "text-gray-200 hover:bg-gray-700"
              }`}
              style={mode === k.id ? { background: k.color, color: "#1A1A1A" } : {}}
            >
              <span>{k.emoji}</span><span>{labelFor(k.id)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RoutingFromHighlight({
  placedItems, scale,
}: { placedItems: import("@/lib/types").PlacedItem[]; scale: number }) {
  const fromId = useDesignerStore(s => s.routingFrom);
  if (!fromId) return null;
  const a = placedItems.find(p => p.instanceId === fromId);
  if (!a) return null;
  return (
    <circle
      cx={a.x * scale} cy={a.z * scale} r={14}
      fill="none" stroke="#FACC15" strokeWidth={2}
      strokeDasharray="3 2"
      style={{ pointerEvents: "none" }}
    />
  );
}

function RoutingPreview({
  placedItems, scale, svgRef,
}: {
  placedItems: import("@/lib/types").PlacedItem[];
  scale: number;
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  const fromId = useDesignerStore(s => s.routingFrom);
  const mode = useDesignerStore(s => s.routingMode);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // Track cursor in SVG coords while routing-from is set
  useEffect(() => {
    if (!fromId || !mode) { setCursor(null); return; }
    const svg = svgRef.current;
    if (!svg) return;
    const onMove = (e: PointerEvent) => {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const inv = ctm.inverse();
      const local = pt.matrixTransform(inv);
      setCursor({ x: local.x, y: local.y });
    };
    svg.addEventListener("pointermove", onMove);
    return () => svg.removeEventListener("pointermove", onMove);
  }, [fromId, mode, svgRef]);

  if (!fromId || !cursor) return null;
  const a = placedItems.find(p => p.instanceId === fromId);
  if (!a) return null;

  // Snap target: if cursor within 30 SVG-units of a non-from item, snap.
  // Port-aware: for fixtures with defined ports, snap to the nearest port
  // point (on fixture footprint edge) rather than geometric center.
  const SNAP = 30;
  let snapped: { x: number; y: number; id: string } | null = null;
  let bestD = SNAP;
  for (const p of placedItems) {
    if (p.instanceId === fromId) continue;
    const furn = getFurnitureById(p.furnitureId);
    // Candidate snap points: center + 4 footprint-edge midpoints
    const candidates: { x: number; y: number }[] = [
      { x: p.x * scale, y: p.z * scale },
    ];
    if (furn) {
      const rot = ((p.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const w = furn.width / 2, d = furn.depth / 2;
      const edges = [[0, -d], [0, d], [-w, 0], [w, 0]] as const;
      for (const [ex, ez] of edges) {
        const lx = ex * cos - ez * sin;
        const lz = ex * sin + ez * cos;
        candidates.push({ x: (p.x + lx) * scale, y: (p.z + lz) * scale });
      }
    }
    for (const cand of candidates) {
      const dd = Math.hypot(cursor.x - cand.x, cursor.y - cand.y);
      if (dd < bestD) { bestD = dd; snapped = { x: cand.x, y: cand.y, id: p.instanceId }; }
    }
  }

  const x1 = a.x * scale, y1 = a.z * scale;
  const x2 = snapped ? snapped.x : cursor.x;
  const y2 = snapped ? snapped.y : cursor.y;
  const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
  const cornerX = dx > dy ? x2 : x1;
  const cornerY = dx > dy ? y1 : y2;
  const colorMap: Record<string, string> = {
    "wire": "#FACC15", "cold-water": "#3B82F6",
    "hot-water": "#EF4444", "drain": "#6B7280",
  };
  const color = colorMap[mode!] ?? "#999";
  return (
    <g style={{ pointerEvents: "none" }}>
      <polyline
        points={`${x1},${y1} ${cornerX},${cornerY} ${x2},${y2}`}
        fill="none" stroke={color} strokeWidth={2}
        strokeDasharray="4 3" opacity={0.7}
      />
      {snapped && (
        <circle cx={snapped.x} cy={snapped.y} r={10}
          fill="none" stroke={color} strokeWidth={2}
        />
      )}
    </g>
  );
}

function RoutingIssueOverlay({
  placedItems, connections, scale,
}: {
  placedItems: import("@/lib/types").PlacedItem[];
  connections: import("@/lib/types").RoutingConnection[];
  scale: number;
}) {
  const issues = useMemo(() => {
    // Lazy import to avoid circular concerns
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { validateRouting } = require("@/lib/routingValidation") as typeof import("@/lib/routingValidation");
    return validateRouting(placedItems, connections);
  }, [placedItems, connections]);
  if (issues.length === 0) return null;

  // Group issues by instanceId for deduped circles + concatenated tooltip
  const grouped = new Map<string, string[]>();
  for (const i of issues) {
    if (!grouped.has(i.instanceId)) grouped.set(i.instanceId, []);
    grouped.get(i.instanceId)!.push(i.message);
  }

  return (
    <g style={{ pointerEvents: "none" }}>
      {[...grouped.entries()].map(([id, msgs]) => {
        const p = placedItems.find(p => p.instanceId === id);
        if (!p) return null;
        return (
          <g key={id}>
            <circle
              cx={p.x * scale} cy={p.z * scale} r={18}
              fill="none" stroke="#EF4444" strokeWidth={2}
              strokeDasharray="3 2" opacity={0.85}
            >
              <title>{msgs.join("\n")}</title>
            </circle>
          </g>
        );
      })}
    </g>
  );
}
