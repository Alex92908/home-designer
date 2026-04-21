"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, WindowConfig } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { PlacedItem } from "@/lib/types";
import { useT, useLocale } from "@/lib/i18n";
import { getFurnitureNameEn } from "@/locales/itemNames";
import { evaluateRoom, type EvaluatedItem, type DoorWall as ClearanceDoorWall } from "@/lib/clearance";

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
}

// ─── Window drag state ────────────────────────────────────

interface WinDrag {
  id: string;
  wall: "back" | "front" | "right" | "left";
  handle: "move" | "start" | "end";
  startMouse: number;
  origPos: number;
  origLen: number;
}

// ─── Door drag state ──────────────────────────────────────

interface DoorDrag {
  startMouse: number;  // x for top/bottom walls, y for left/right walls
  origPos: number;
}

// ─── Single placed item in SVG ────────────────────────────

interface PlacedItemSVGProps {
  placed: PlacedItem;
  scale: number;
  isSelected: boolean;
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

function PlacedItemSVG({ placed, scale, isSelected, hasViolation, violationSeverity, onPointerDown }: PlacedItemSVGProps) {
  const furniture = getFurnitureById(placed.furnitureId);
  const locale = useLocale();
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
        stroke={isSelected ? "#60A5FA" : hasViolation ? (violationSeverity === "required" ? "#EF4444" : "#F59E0B") : "rgba(255,255,255,0.35)"}
        strokeWidth={isSelected ? 2.5 : hasViolation ? 1.8 : 1}
      />
      {fontSize > 5 && (
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
  win, svgW, svgH, scale, isEditMode,
  onMoveDown, onStartDown, onEndDown,
}: {
  win: WindowConfig; svgW: number; svgH: number; scale: number; isEditMode: boolean;
  onMoveDown: (e: React.PointerEvent<SVGRectElement>) => void;
  onStartDown: (e: React.PointerEvent<SVGRectElement>) => void;
  onEndDown: (e: React.PointerEvent<SVGRectElement>) => void;
}) {
  const thick = 10;
  const handleSz = 8;
  const color = "#60C0F0";
  const handleColor = "#2080C0";

  if (win.wall === "back") {
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
  if (win.wall === "right") {
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
  if (win.wall === "left") {
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
  if (win.wall === "front") {
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

type DoorWall = "bottom" | "top" | "left" | "right";

function DoorSVG({
  svgW, svgH, doorPosCm, doorLenCm, roomWidthCm, roomDepthCm, doorWall, scale, isEditMode, onPointerDown,
}: {
  svgW: number; svgH: number;
  doorPosCm: number; doorLenCm: number; roomWidthCm: number; roomDepthCm: number;
  doorWall: DoorWall; scale: number;
  isEditMode: boolean; onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
}) {
  // Door width: explicit cm value (clamped to wall length)
  const wallLen = (doorWall === "bottom" || doorWall === "top") ? roomWidthCm : roomDepthCm;
  const doorW = Math.min(doorLenCm, wallLen) * scale;
  const pos = doorPosCm * scale;

  // Build path for each wall orientation
  let gapRect: React.ReactNode;
  let arc: React.ReactNode;
  let leaf: React.ReactNode;
  let highlight: React.ReactNode;

  if (doorWall === "bottom") {
    gapRect  = <rect x={pos} y={svgH - 5} width={doorW} height={10} fill="#1E2030" />;
    arc      = <path d={`M${pos},${svgH} A${doorW},${doorW} 0 0,1 ${pos+doorW},${svgH-doorW}`} fill="none" stroke="#5A6070" strokeWidth={1} strokeDasharray="3,2" />;
    leaf     = <line x1={pos} y1={svgH} x2={pos+doorW} y2={svgH-doorW} stroke="#5A6070" strokeWidth={1.5} />;
    highlight = isEditMode && <rect x={pos-4} y={svgH-12} width={doorW+8} height={14} fill="#F59E0B" opacity={0.35} rx={3} style={{ pointerEvents:"none" }} />;
  } else if (doorWall === "top") {
    gapRect  = <rect x={pos} y={-5} width={doorW} height={10} fill="#1E2030" />;
    arc      = <path d={`M${pos},${0} A${doorW},${doorW} 0 0,0 ${pos+doorW},${doorW}`} fill="none" stroke="#5A6070" strokeWidth={1} strokeDasharray="3,2" />;
    leaf     = <line x1={pos} y1={0} x2={pos+doorW} y2={doorW} stroke="#5A6070" strokeWidth={1.5} />;
    highlight = isEditMode && <rect x={pos-4} y={-2} width={doorW+8} height={14} fill="#F59E0B" opacity={0.35} rx={3} style={{ pointerEvents:"none" }} />;
  } else if (doorWall === "left") {
    gapRect  = <rect x={-5} y={pos} width={10} height={doorW} fill="#1E2030" />;
    arc      = <path d={`M${0},${pos} A${doorW},${doorW} 0 0,0 ${doorW},${pos+doorW}`} fill="none" stroke="#5A6070" strokeWidth={1} strokeDasharray="3,2" />;
    leaf     = <line x1={0} y1={pos} x2={doorW} y2={pos+doorW} stroke="#5A6070" strokeWidth={1.5} />;
    highlight = isEditMode && <rect x={-2} y={pos-4} width={14} height={doorW+8} fill="#F59E0B" opacity={0.35} rx={3} style={{ pointerEvents:"none" }} />;
  } else { // right
    gapRect  = <rect x={svgW-5} y={pos} width={10} height={doorW} fill="#1E2030" />;
    arc      = <path d={`M${svgW},${pos} A${doorW},${doorW} 0 0,1 ${svgW-doorW},${pos+doorW}`} fill="none" stroke="#5A6070" strokeWidth={1} strokeDasharray="3,2" />;
    leaf     = <line x1={svgW} y1={pos} x2={svgW-doorW} y2={pos+doorW} stroke="#5A6070" strokeWidth={1.5} />;
    highlight = isEditMode && <rect x={svgW-12} y={pos-4} width={14} height={doorW+8} fill="#F59E0B" opacity={0.35} rx={3} style={{ pointerEvents:"none" }} />;
  }

  return (
    <g
      style={{ cursor: isEditMode ? "move" : "default" }}
      onPointerDown={isEditMode ? onPointerDown : undefined}
    >
      {gapRect}{arc}{leaf}{highlight}
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

  const activeRoom           = useDesignerStore((s) => s.activeRoom);
  const roomState            = useDesignerStore((s) => s.floorPlans[s.activeFloor].rooms[activeRoom]);
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
  const rotateRoom           = useDesignerStore((s) => s.rotateRoom);
  const pushLayoutHistory    = useDesignerStore((s) => s.pushLayoutHistory);
  const furnitureHistoryLen  = useDesignerStore((s) => s.furnitureHistory.filter(h => h.room === activeRoom).length);
  const copyToClipboard      = useDesignerStore((s) => s.copyToClipboard);
  const pasteFromClipboard   = useDesignerStore((s) => s.pasteFromClipboard);
  const clipboardLen         = useDesignerStore((s) => s.clipboard.length);
  const roomWindows     = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomWindows[activeRoom] ?? []);
  const setRoomWindows  = useDesignerStore((s) => s.setRoomWindows);
  const addWindow       = useDesignerStore((s) => s.addWindow);
  const removeWindow    = useDesignerStore((s) => s.removeWindow);
  const doorPosCm       = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorPos[activeRoom] ?? 0);
  const hasDoor         = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomHasDoor[activeRoom] ?? true);
  const doorWall        = useDesignerStore((s) => (s.floorPlans[s.activeFloor].roomDoorWall[activeRoom] ?? "bottom") as DoorWall);
  const doorLenCm       = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorLen?.[activeRoom] ?? 80);
  const doorHCm         = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorH?.[activeRoom] ?? 200);
  const setDoorPos      = useDesignerStore((s) => s.setDoorPos);
  const setRoomHasDoor  = useDesignerStore((s) => s.setRoomHasDoor);
  const setDoorWall     = useDesignerStore((s) => s.setDoorWall);
  const setDoorLen      = useDesignerStore((s) => s.setDoorLen);
  const setDoorH        = useDesignerStore((s) => s.setDoorH);
  const updateWindow    = useDesignerStore((s) => s.updateWindow);
  const t      = useT();
  const locale = useLocale();

  // ── Use store roomDimensions (respects global plan edits) ──
  const roomDimensions  = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDimensions[activeRoom]);
  const def             = ROOM_DEFS[activeRoom];

  // Effective dimensions: store override if different from default, else ROOM_DEFS
  const roomW = roomDimensions?.width  ?? def.width;
  const roomD = roomDimensions?.depth  ?? def.depth;

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
      const cx = Math.max(hw, Math.min(roomW - hw, placed.x));
      const cz = Math.max(hd, Math.min(roomD - hd, placed.z));
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
    ),
    [roomState.placedItems, roomW, roomD, hasDoor, doorWall, doorPosCm, doorLenCm]
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
        for (const item of dragItems) {
          const furn     = getFurnitureById(item.furnitureId);
          const r90      = item.rotation === 90 || item.rotation === 270;
          const rawHW    = (furn?.width  ?? 100) * item.scaleW / 2;
          const rawHD    = (furn?.depth  ?? 100) * item.scaleD / 2;
          const halfW    = Math.min(r90 ? rawHD : rawHW, capturedRoomW / 2);
          const halfD    = Math.min(r90 ? rawHW : rawHD, capturedRoomD / 2);
          const newX     = Math.max(halfW, Math.min(capturedRoomW - halfW, item.startX + dX));
          const newZ     = Math.max(halfD, Math.min(capturedRoomD - halfD, item.startZ + dZ));
          moveItem(item.instanceId, newX, newZ);
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
      const axis = (win.wall === "back" || win.wall === "front") ? pt.x : pt.y;
      setWinDrag({ id: win.id, wall: win.wall, handle, startMouse: axis, origPos: win.pos, origLen: win.len });
      (e.currentTarget as SVGRectElement).setPointerCapture(e.pointerId);
    }, []
  );

  // ─── Door drag ───────────────────────────────────────────

  const startDoorDrag = useCallback(
    (e: React.PointerEvent<SVGGElement>) => {
      e.stopPropagation();
      if (!svgRef.current) return;
      const pt = getSVGPoint(e, svgRef.current, zoomLevel);
      const axis = (doorWall === "top" || doorWall === "bottom") ? pt.x : pt.y;
      setDoorDrag({ startMouse: axis, origPos: doorPosCm });
      (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    },
    [doorPosCm, doorWall]
  );

  // ─── Combined pointer move ───────────────────────────────

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;

      // Furniture drag is handled by window-level listeners in handleItemPointerDown.
      // Window drag
      if (winDrag) {
        const pt = getSVGPoint(e, svgRef.current, zoomLevel);
        const isHorizWin = winDrag.wall === "back" || winDrag.wall === "front";
        const axis = isHorizWin ? pt.x : pt.y;
        const wallLen = isHorizWin ? roomW : roomD;
        const delta = (axis - winDrag.startMouse) / scale;
        const MIN_LEN = 40;

        const wins = roomWindows.map(w => {
          if (w.id !== winDrag.id) return w;
          if (winDrag.handle === "move") {
            return { ...w, pos: Math.max(0, Math.min(wallLen - w.len, winDrag.origPos + delta)) };
          }
          if (winDrag.handle === "start") {
            const newPos = Math.max(0, Math.min(winDrag.origPos + winDrag.origLen - MIN_LEN, winDrag.origPos + delta));
            return { ...w, pos: newPos, len: Math.max(MIN_LEN, winDrag.origLen - (newPos - winDrag.origPos)) };
          }
          if (winDrag.handle === "end") {
            return { ...w, len: Math.max(MIN_LEN, Math.min(wallLen - w.pos, winDrag.origLen + delta)) };
          }
          return w;
        });
        setRoomWindows(activeRoom, wins);
        return;
      }

      // Door drag
      if (doorDrag) {
        const pt = getSVGPoint(e, svgRef.current, zoomLevel);
        const isHorizontalWall = doorWall === "top" || doorWall === "bottom";
        const axis = isHorizontalWall ? pt.x : pt.y;
        const delta = (axis - doorDrag.startMouse) / scale;
        const wallLen = isHorizontalWall ? roomW : roomD;
        const doorWCm = Math.min(doorLenCm, wallLen);
        const newPos = Math.max(0, Math.min(wallLen - doorWCm, doorDrag.origPos + delta));
        setDoorPos(activeRoom, newPos);
      }
    },
    [dragState, winDrag, doorDrag, scale, roomW, roomD, doorWall, roomState.placedItems, moveItem, roomWindows, setRoomWindows, activeRoom, setDoorPos]  // eslint-disable-line react-hooks/exhaustive-deps
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

  // ─── Add window helper ───────────────────────────────────
  const handleAddWindow = (wall: "back" | "front" | "right" | "left") => {
    const wallLen = (wall === "back" || wall === "front") ? roomW : roomD;
    addWindow(activeRoom, {
      id: `${activeRoom}-w${Date.now()}`,
      wall,
      pos: wallLen * 0.25,
      len: wallLen * 0.4,
    });
  };

  // Reset inspector position whenever selection changes
  useEffect(() => { setInspectorPos(null); }, [selectedInstanceIds]);

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
    {/* ── Scrollable canvas area ────────────────────────────── */}
    <div
      className="flex-1 flex flex-col items-center justify-start overflow-auto p-4 pt-6 min-h-0"
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
            {t.roomNames[activeRoom] ?? def.name} · {(roomW / 100).toFixed(1)}m × {(roomD / 100).toFixed(1)}m · {t.fpCeilingLabel} {(def.height / 100).toFixed(1)}m
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

            {/* Undo */}
            <button
              onClick={undoFurniture}
              disabled={furnitureHistoryLen === 0}
              title={t.fpUndoTitle(furnitureHistoryLen)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all"
              style={
                furnitureHistoryLen > 0
                  ? { background: "#007AFF", color: "#fff" }
                  : { background: "transparent", color: "rgba(255,255,255,0.2)", cursor: "not-allowed" }
              }
            >
              <span>↩</span>
              <span>{t.fpUndo}</span>
              {furnitureHistoryLen > 0 && (
                <span className="text-[9px] px-1 rounded-full" style={{ background: "rgba(255,255,255,0.25)" }}>{furnitureHistoryLen}</span>
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
          </div>
        </div>
        {/* Row 2: window/door sub-controls (only when editing) */}
        {editWindows && (
          <div className="flex flex-wrap gap-1 items-center pl-1">
            {(["back","front","left","right"] as const).map(wall => {
              const labels = t.fpWallLabels;
              const wallLen = (wall === "back" || wall === "front") ? roomW : roomD;
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
            })}
            {hasDoor && (
              <div className="flex items-center gap-0.5 ml-1">
                <span className="text-[10px] text-gray-500 mr-0.5">{t.fpDoorLabel}</span>
                {(["bottom","top","left","right"] as DoorWall[]).map(w => {
                  const labels = t.fpDoorDirs as Record<DoorWall, string>;
                  return (
                    <button key={w} onClick={() => { setDoorWall(activeRoom, w); setDoorPos(activeRoom, 0); }}
                      className="text-[10px] px-1.5 py-0.5 rounded font-semibold transition-all"
                      style={doorWall === w
                        ? { background: "#007AFF", color: "#fff" }
                        : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }
                      }>
                      {labels[w]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Zoomable SVG container */}
      <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: "top center" }}>
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

          {/* Walls */}
          <rect x={0} y={0} width={svgW} height={svgH} fill="none"
            stroke={roomState.materials.wall?.color ?? def.defaultWallColor}
            strokeWidth={8} strokeOpacity={0.7} />
          <rect x={4} y={4} width={svgW - 8} height={svgH - 8}
            fill="none" stroke="#88AABB" strokeWidth={1} strokeOpacity={0.3} />

          {/* Windows */}
          {roomWindows.map(win => (
            <WindowSVG key={win.id} win={win} svgW={svgW} svgH={svgH} scale={scale}
              isEditMode={editWindows}
              onMoveDown={(e) => startWinDrag(e, win, "move")}
              onStartDown={(e) => startWinDrag(e, win, "start")}
              onEndDown={(e) => startWinDrag(e, win, "end")}
            />
          ))}

          {/* Window edit/delete buttons in edit mode */}
          {editWindows && roomWindows.map(win => {
            const R = 9;
            const mid = (win.pos + win.len / 2) * scale;
            const clampX = (v: number) => Math.max(R, Math.min(svgW - R, v));
            const clampY = (v: number) => Math.max(R, Math.min(svgH - R, v));
            const horiz = win.wall === "back" || win.wall === "front";
            let dx: number, dy: number, sx: number, sy: number;
            if (win.wall === "back")        { dx = clampX(mid); dy = R + 4; }
            else if (win.wall === "front")  { dx = clampX(mid); dy = svgH - R - 4; }
            else if (win.wall === "right")  { dx = svgW - R - 4; dy = clampY(mid); }
            else                            { dx = R + 4;        dy = clampY(mid); }
            // Place size-edit button beside delete, along the wall axis
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
                  onClick={(e) => { e.stopPropagation(); removeWindow(activeRoom, win.id); if (selectedWinId === win.id) setSelectedWinId(null); }}>
                  <circle cx={dx} cy={dy} r={R} fill="#EF4444" opacity={0.9} />
                  <text x={dx} y={dy} textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fill="white" style={{ pointerEvents: "none" }}>✕</text>
                </g>
              </g>
            );
          })}

          {/* Door (draggable/deletable in edit mode) */}
          {hasDoor ? (
            <g>
              <DoorSVG
                svgW={svgW} svgH={svgH}
                doorPosCm={doorPosCm} doorLenCm={doorLenCm}
                roomWidthCm={roomW} roomDepthCm={roomD}
                doorWall={doorWall}
                scale={scale}
                isEditMode={editWindows}
                onPointerDown={startDoorDrag}
              />
              {/* Edit/Delete door buttons — positioned near door on active wall */}
              {editWindows && (() => {
                const R = 9;
                const isHoriz = doorWall === "top" || doorWall === "bottom";
                const wallLen = isHoriz ? roomW : roomD;
                const doorWpx = Math.min(doorLenCm, wallLen) * scale;
                const doorMid = doorPosCm * scale + doorWpx / 2;
                let cx: number, cy: number;
                if (doorWall === "bottom")      { cx = doorMid; cy = svgH - 14; }
                else if (doorWall === "top")    { cx = doorMid; cy = 14; }
                else if (doorWall === "left")   { cx = 14; cy = doorMid; }
                else                            { cx = svgW - 14; cy = doorMid; }
                // Size-edit button offset along the wall axis
                const sx = isHoriz ? Math.max(R, Math.min(svgW - R, cx - R * 2.2)) : cx;
                const sy = isHoriz ? cy : Math.max(R, Math.min(svgH - R, cy - R * 2.2));
                return (
                  <g>
                    <g style={{ cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); setDoorSelected(true); setSelectedWinId(null); }}>
                      <circle cx={sx} cy={sy} r={R} fill="#3B82F6" opacity={doorSelected ? 1 : 0.85} />
                      <text x={sx} y={sy} textAnchor="middle" dominantBaseline="middle"
                        fontSize={10} fill="white" style={{ pointerEvents: "none" }}>✎</text>
                    </g>
                    <g style={{ cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); setRoomHasDoor(activeRoom, false); setDoorSelected(false); }}>
                      <circle cx={cx} cy={cy} r={R} fill="#EF4444" opacity={0.9} />
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                        fontSize={10} fill="white" style={{ pointerEvents: "none" }}>✕</text>
                    </g>
                  </g>
                );
              })()}
            </g>
          ) : (
            /* No door — show "add door" button in edit mode, near active wall */
            editWindows && (() => {
              let bx: number, by: number;
              if (doorWall === "bottom")      { bx = svgW * 0.08;     by = svgH - 18; }
              else if (doorWall === "top")    { bx = svgW * 0.08;     by = 0; }
              else if (doorWall === "left")   { bx = 0;               by = svgH * 0.08; }
              else                            { bx = svgW - 60;       by = svgH * 0.08; }
              return (
                <g style={{ cursor: "pointer" }}
                  onClick={(e) => { e.stopPropagation(); setRoomHasDoor(activeRoom, true); }}>
                  <rect x={bx} y={by} width={60} height={18} fill="#10B981" opacity={0.85} rx={4} />
                  <text x={bx + 30} y={by + 9} textAnchor="middle" dominantBaseline="middle"
                    fontSize={10} fill="white" style={{ pointerEvents: "none" }}>＋添加门</text>
                </g>
              );
            })()
          )}

          {/* Compass */}
          <g transform={`translate(${svgW - 22}, 22)`}>
            <circle r={12} fill="rgba(0,0,0,0.5)" />
            <text x={0} y={-5} textAnchor="middle" dominantBaseline="middle" fontSize={7} fill="#4488AA">N</text>
            <line x1={0} y1={-9} x2={0} y2={-4} stroke="#4488AA" strokeWidth={1.5} />
          </g>

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
            if (wall === "bottom")      { hingeX = x;       hingeY = y + h; sweepX = x + w; sweepY = y; }
            else if (wall === "top")    { hingeX = x;       hingeY = y;     sweepX = x + w; sweepY = y + h; }
            else if (wall === "left")   { hingeX = x;       hingeY = y;     sweepX = x + w; sweepY = y + h; }
            else                        { hingeX = x + w;   hingeY = y;     sweepX = x;     sweepY = y + h; }
            const r = Math.min(w, h);
            return (
              <g style={{ pointerEvents: "none" }}>
                <rect x={x} y={y} width={w} height={h}
                  fill={color} fillOpacity={0.10}
                  stroke={color} strokeOpacity={0.55} strokeWidth={1}
                  strokeDasharray="4 3" rx={2} />
                {/* 90° arc from hinge — visual hint of swing direction */}
                <path
                  d={`M ${hingeX + (sweepX - hingeX)} ${hingeY} A ${r} ${r} 0 0 ${wall === "bottom" || wall === "right" ? 1 : 0} ${hingeX} ${hingeY + (sweepY - hingeY)}`}
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

          {/* Placed furniture */}
          {roomState.placedItems.map((placed) => (
            <PlacedItemSVG
              key={placed.instanceId}
              placed={placed}
              scale={scale}
              isSelected={selectedInstanceIds.includes(placed.instanceId)}
              hasViolation={violatingIds.has(placed.instanceId)}
              violationSeverity={violatingIds.get(placed.instanceId)}
              onPointerDown={(e) => handleItemPointerDown(e, placed.instanceId)}
            />
          ))}

          {/* Relational links (e.g. TV ↔ sofa viewing distance) */}
          {links.map((link, i) => {
            const a = roomState.placedItems.find(p => p.instanceId === link.fromInstanceId);
            const b = roomState.placedItems.find(p => p.instanceId === link.toInstanceId);
            if (!a || !b) return null;
            const x1 = a.x * scale, y1 = a.z * scale;
            const x2 = b.x * scale, y2 = b.z * scale;
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
              从左侧选择家具，点击即可放置
            </text>
          )}
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
          const isHoriz = doorWall === "top" || doorWall === "bottom";
          const wallLen = isHoriz ? roomW : roomD;
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
                  <span className="text-[10px] text-gray-300 font-mono">{(doorLenCm / 100).toFixed(2)}m</span>
                </div>
                <input type="range" min={50} max={Math.min(200, wallLen)} step={5}
                  value={doorLenCm}
                  onChange={e => setDoorLen(activeRoom, parseInt(e.target.value))}
                  className="w-full accent-blue-500 h-2 md:h-1.5" />
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-[10px] text-gray-400">{t.fpHeight}</span>
                  <span className="text-[10px] text-gray-300 font-mono">{(doorHCm / 100).toFixed(2)}m</span>
                </div>
                <input type="range" min={140} max={260} step={5}
                  value={doorHCm}
                  onChange={e => setDoorH(activeRoom, parseInt(e.target.value))}
                  className="w-full accent-blue-500 h-2 md:h-1.5" />
              </div>
            </div>
          );
        }
        if (!selectedWin) return null;
        const wallLen = (selectedWin.wall === "back" || selectedWin.wall === "front") ? roomW : roomD;
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
                <input type="range" min={40} max={Math.min(240, ceilH - winSill - 5)} step={5}
                  value={winH}
                  onChange={e => updateWindow(activeRoom, selectedWin.id, { h: parseInt(e.target.value) })}
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
          </div>
        );
      })()}

      {/* Multi-select action bar */}
      {selectedInstanceIds.length > 1 && (
        <div className={isLandscape
          ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[200] w-72 bg-gray-900/98 rounded-2xl px-4 py-3 border border-blue-500/50 shadow-2xl backdrop-blur-md flex items-center gap-2"
          : "flex items-center gap-2 bg-gray-900/95 rounded-t-xl px-4 py-3 border-t border-blue-500/40 backdrop-blur-md w-full"}>
          <span className="text-xs text-blue-300 font-semibold flex-1">已选 {selectedInstanceIds.length} 件</span>
          <button
            onClick={() => copyToClipboard(selectedInstanceIds)}
            className="px-2.5 py-1 bg-blue-600/80 hover:bg-blue-600 text-white text-[11px] font-semibold rounded-lg transition-colors"
          >
            ⧉ 复制
          </button>
          <button
            onClick={() => removeItems(selectedInstanceIds)}
            className="px-2.5 py-1 bg-red-600/80 hover:bg-red-600 text-white text-[11px] font-semibold rounded-lg transition-colors"
          >
            ✕ 删除
          </button>
          <button
            onClick={() => setSelection([])}
            className="px-2.5 py-1 bg-gray-600/80 hover:bg-gray-600 text-gray-200 text-[11px] font-semibold rounded-lg transition-colors"
          >
            取消
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
