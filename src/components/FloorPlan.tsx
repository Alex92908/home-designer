"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, WindowConfig } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { PlacedItem } from "@/lib/types";
import { useT, useLocale } from "@/lib/i18n";
import { getFurnitureNameEn } from "@/locales/itemNames";

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
  onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
}

function PlacedItemSVG({ placed, scale, isSelected, onPointerDown }: PlacedItemSVGProps) {
  const furniture = getFurnitureById(placed.furnitureId);
  if (!furniture) return null;

  const sw = placed.scaleW ?? 1;
  const sd = placed.scaleD ?? 1;
  const cx = placed.x * scale;
  const cy = placed.z * scale;
  const w = furniture.width * sw * scale;
  const d = furniture.depth * sd * scale;
  const fontSize = Math.min(w, d) * 0.55;

  return (
    <g
      transform={`translate(${cx},${cy}) rotate(${placed.rotation})`}
      style={{ cursor: "grab" }}
      onPointerDown={onPointerDown}
    >
      <rect x={-w / 2 + 2} y={-d / 2 + 2} width={w} height={d} rx={4} fill="rgba(0,0,0,0.3)" />
      <rect
        x={-w / 2} y={-d / 2} width={w} height={d} rx={4}
        fill={furniture.color} fillOpacity={0.85}
        stroke={isSelected ? "#60A5FA" : "rgba(255,255,255,0.35)"}
        strokeWidth={isSelected ? 2.5 : 1}
      />
      {fontSize > 5 && (
        <text x={0} y={d > 30 ? -3 : 0} textAnchor="middle" dominantBaseline="middle"
          fontSize={Math.min(fontSize, 18)} style={{ userSelect: "none", pointerEvents: "none" }}>
          {furniture.icon}
        </text>
      )}
      {w > 45 && d > 25 && (
        <text x={0} y={d / 2 - 5} textAnchor="middle" dominantBaseline="middle"
          fontSize={8} fill="white" fillOpacity={0.9}
          style={{ userSelect: "none", pointerEvents: "none" }}>
          {furniture.name.length > 7 ? furniture.name.slice(0, 7) + "…" : furniture.name}
        </text>
      )}
      {isSelected && (
        <>
          <rect x={-w / 2}    y={-d / 2}    width={8} height={8} rx={2} fill="#3B82F6" opacity={0.9} />
          <rect x={w / 2 - 8} y={-d / 2}    width={8} height={8} rx={2} fill="#3B82F6" opacity={0.9} />
          <rect x={-w / 2}    y={d / 2 - 8} width={8} height={8} rx={2} fill="#3B82F6" opacity={0.9} />
          <rect x={w / 2 - 8} y={d / 2 - 8} width={8} height={8} rx={2} fill="#3B82F6" opacity={0.9} />
        </>
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
  svgW, svgH, doorPosCm, roomWidthCm, roomDepthCm, doorWall, scale, isEditMode, onPointerDown,
}: {
  svgW: number; svgH: number;
  doorPosCm: number; roomWidthCm: number; roomDepthCm: number;
  doorWall: DoorWall; scale: number;
  isEditMode: boolean; onPointerDown: (e: React.PointerEvent<SVGGElement>) => void;
}) {
  // Door width: 20% of whichever wall dimension it's on
  const wallLen = (doorWall === "bottom" || doorWall === "top") ? roomWidthCm : roomDepthCm;
  const doorW = Math.min(wallLen * 0.2, 80) * scale;
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

  const activeRoom           = useDesignerStore((s) => s.activeRoom);
  const roomState            = useDesignerStore((s) => s.rooms[activeRoom]);
  const selectedInstanceIds  = useDesignerStore((s) => s.selectedInstanceIds);
  const moveItem             = useDesignerStore((s) => s.moveItem);
  const rotateItem           = useDesignerStore((s) => s.rotateItem);
  const removeItem           = useDesignerStore((s) => s.removeItem);
  const setSelection         = useDesignerStore((s) => s.setSelection);
  const duplicateItems       = useDesignerStore((s) => s.duplicateItems);
  const removeItems          = useDesignerStore((s) => s.removeItems);
  const resizeItem           = useDesignerStore((s) => s.resizeItem);
  const pushFurnitureHistory = useDesignerStore((s) => s.pushFurnitureHistory);
  const undoFurniture        = useDesignerStore((s) => s.undoFurniture);
  const rotateRoom           = useDesignerStore((s) => s.rotateRoom);
  const pushLayoutHistory    = useDesignerStore((s) => s.pushLayoutHistory);
  const furnitureHistoryLen  = useDesignerStore((s) => s.furnitureHistory.filter(h => h.room === activeRoom).length);
  const copyToClipboard      = useDesignerStore((s) => s.copyToClipboard);
  const pasteFromClipboard   = useDesignerStore((s) => s.pasteFromClipboard);
  const clipboardLen         = useDesignerStore((s) => s.clipboard.length);
  const roomWindows     = useDesignerStore((s) => s.roomWindows[activeRoom] ?? []);
  const setRoomWindows  = useDesignerStore((s) => s.setRoomWindows);
  const addWindow       = useDesignerStore((s) => s.addWindow);
  const removeWindow    = useDesignerStore((s) => s.removeWindow);
  const doorPosCm       = useDesignerStore((s) => s.roomDoorPos[activeRoom] ?? 0);
  const hasDoor         = useDesignerStore((s) => s.roomHasDoor[activeRoom] ?? true);
  const doorWall        = useDesignerStore((s) => (s.roomDoorWall[activeRoom] ?? "bottom") as DoorWall);
  const setDoorPos      = useDesignerStore((s) => s.setDoorPos);
  const setRoomHasDoor  = useDesignerStore((s) => s.setRoomHasDoor);
  const setDoorWall     = useDesignerStore((s) => s.setDoorWall);
  const t      = useT();
  const locale = useLocale();

  // ── Use store roomDimensions (respects global plan edits) ──
  const roomDimensions  = useDesignerStore((s) => s.roomDimensions[activeRoom]);
  const def             = ROOM_DEFS[activeRoom];

  // Effective dimensions: store override if different from default, else ROOM_DEFS
  const roomW = roomDimensions?.width  ?? def.width;
  const roomD = roomDimensions?.depth  ?? def.depth;

  // Reset zoom when switching rooms
  useEffect(() => { setZoomLevel(1); }, [activeRoom]);

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

  const gridXCount = Math.floor(roomW / 100);
  const gridZCount = Math.floor(roomD / 100);

  // ─── Furniture drag ─────────────────────────────────────

  const handleItemPointerDown = useCallback(
    (e: React.PointerEvent<SVGGElement>, instanceId: string) => {
      e.stopPropagation();
      if (!svgRef.current) return;

      let newSelection: string[];
      if (e.shiftKey) {
        // Toggle this item in selection
        newSelection = selectedInstanceIds.includes(instanceId)
          ? selectedInstanceIds.filter(id => id !== instanceId)
          : [...selectedInstanceIds, instanceId];
      } else {
        // If clicking something already in selection, keep group; otherwise single-select
        newSelection = selectedInstanceIds.includes(instanceId) ? selectedInstanceIds : [instanceId];
      }
      setSelection(newSelection);

      const pt = getSVGPoint(e, svgRef.current, zoomLevel);
      const items = newSelection
        .map(id => roomState.placedItems.find(p => p.instanceId === id))
        .filter(Boolean)
        .map(placed => ({
          instanceId: placed!.instanceId,
          startX: Math.max(0, Math.min(roomW, placed!.x)),
          startZ: Math.max(0, Math.min(roomD, placed!.z)),
        }));
      pushFurnitureHistory();
      setDragState({ startSvgX: pt.x, startSvgZ: pt.y, items });
      (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    },
    [roomState.placedItems, setSelection, selectedInstanceIds, roomW, roomD, pushFurnitureHistory]
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

      // Furniture drag (multi-item)
      if (dragState) {
        const pt = getSVGPoint(e, svgRef.current, zoomLevel);
        const deltaX = (pt.x - dragState.startSvgX) / scale;
        const deltaZ = (pt.y - dragState.startSvgZ) / scale;
        for (const item of dragState.items) {
          const placed = roomState.placedItems.find((p) => p.instanceId === item.instanceId);
          const furniture = getFurnitureById(placed?.furnitureId ?? "");
          const sw = placed?.scaleW ?? 1;
          const sd = placed?.scaleD ?? 1;
          const rot = placed?.rotation ?? 0;
          const rotated90 = rot === 90 || rot === 270;
          const rawHW = (furniture?.width ?? 0) * sw / 2;
          const rawHD = (furniture?.depth ?? 0) * sd / 2;
          const halfW = Math.min(rotated90 ? rawHD : rawHW, roomW / 2);
          const halfD = Math.min(rotated90 ? rawHW : rawHD, roomD / 2);
          const newX = Math.max(halfW, Math.min(roomW - halfW, item.startX + deltaX));
          const newZ = Math.max(halfD, Math.min(roomD - halfD, item.startZ + deltaZ));
          moveItem(item.instanceId, newX, newZ);
        }
        return;
      }

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
        const doorWCm = Math.min(wallLen * 0.2, 80);
        const newPos = Math.max(0, Math.min(wallLen - doorWCm, doorDrag.origPos + delta));
        setDoorPos(activeRoom, newPos);
      }
    },
    [dragState, winDrag, doorDrag, scale, roomW, roomD, doorWall, roomState.placedItems, moveItem, roomWindows, setRoomWindows, activeRoom, setDoorPos]  // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handlePointerUp = useCallback(() => {
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

  // Single-item controls (show only when exactly 1 item selected)
  const selectedItem = selectedInstanceIds.length === 1
    ? roomState.placedItems.find((p) => p.instanceId === selectedInstanceIds[0]) ?? null
    : null;
  const selectedFurniture = selectedItem ? getFurnitureById(selectedItem.furnitureId) : null;

  return (
    <div
      className="flex-1 flex flex-col items-center justify-start bg-[#0f1117] select-none overflow-auto p-4 pt-6"
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
                  +{labels[wall]}窗
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

          {/* Window delete buttons in edit mode */}
          {editWindows && roomWindows.map(win => {
            const R = 9;
            const mid = (win.pos + win.len / 2) * scale;
            const clampX = (v: number) => Math.max(R, Math.min(svgW - R, v));
            const clampY = (v: number) => Math.max(R, Math.min(svgH - R, v));
            let bx: number, by: number;
            if (win.wall === "back")        { bx = clampX(mid); by = R + 4; }
            else if (win.wall === "front")  { bx = clampX(mid); by = svgH - R - 4; }
            else if (win.wall === "right")  { bx = svgW - R - 4; by = clampY(mid); }
            else                            { bx = R + 4;        by = clampY(mid); }
            return (
              <g key={`del-${win.id}`} style={{ cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); removeWindow(activeRoom, win.id); }}>
                <circle cx={bx} cy={by} r={R} fill="#EF4444" opacity={0.9} />
                <text x={bx} y={by} textAnchor="middle" dominantBaseline="middle"
                  fontSize={10} fill="white" style={{ pointerEvents: "none" }}>✕</text>
              </g>
            );
          })}

          {/* Door (draggable/deletable in edit mode) */}
          {hasDoor ? (
            <g>
              <DoorSVG
                svgW={svgW} svgH={svgH}
                doorPosCm={doorPosCm} roomWidthCm={roomW} roomDepthCm={roomD}
                doorWall={doorWall}
                scale={scale}
                isEditMode={editWindows}
                onPointerDown={startDoorDrag}
              />
              {/* Delete door button — positioned near door on active wall */}
              {editWindows && (() => {
                const isHoriz = doorWall === "top" || doorWall === "bottom";
                const wallLen = isHoriz ? roomW : roomD;
                const doorWpx = Math.min(wallLen * 0.2, 80) * scale;
                const doorMid = doorPosCm * scale + doorWpx / 2;
                let cx: number, cy: number;
                if (doorWall === "bottom")      { cx = doorMid; cy = svgH - 14; }
                else if (doorWall === "top")    { cx = doorMid; cy = 14; }
                else if (doorWall === "left")   { cx = 14; cy = doorMid; }
                else                            { cx = svgW - 14; cy = doorMid; }
                return (
                  <g style={{ cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); setRoomHasDoor(activeRoom, false); }}>
                    <circle cx={cx} cy={cy} r={9} fill="#EF4444" opacity={0.9} />
                    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                      fontSize={10} fill="white" style={{ pointerEvents: "none" }}>✕</text>
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

          {/* Placed furniture */}
          {roomState.placedItems.map((placed) => (
            <PlacedItemSVG
              key={placed.instanceId}
              placed={placed}
              scale={scale}
              isSelected={selectedInstanceIds.includes(placed.instanceId)}
              onPointerDown={(e) => handleItemPointerDown(e, placed.instanceId)}
            />
          ))}

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

      {/* Multi-select action bar */}
      {selectedInstanceIds.length > 1 && (
        <div className="mt-3 flex items-center gap-2 bg-gray-800/80 rounded-xl px-4 py-2.5 border border-blue-500/40 backdrop-blur max-w-lg w-full">
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
        <div className="mt-3 flex flex-col gap-2 bg-gray-800/80 rounded-xl px-4 py-3 border border-gray-700/50 backdrop-blur max-w-lg w-full">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md shrink-0 border border-white/20" style={{ background: selectedFurniture.color }} />
            <span className="text-xs font-semibold text-gray-200">{locale === "en" ? (getFurnitureNameEn(selectedFurniture.id) ?? selectedFurniture.name) : selectedFurniture.name}</span>
            <span className="text-xs text-gray-500">
              {(selectedItem.x / 100).toFixed(1)}m, {(selectedItem.z / 100).toFixed(1)}m · {selectedItem.rotation}°
            </span>
            <div className="flex gap-1 ml-auto">
              <button onClick={() => rotateItem(selectedItem.instanceId)}
                className="px-2 py-1 bg-blue-600/80 hover:bg-blue-600 text-white text-[11px] font-semibold rounded-lg transition-colors">
                ↻ {t.fpRotateItem}
              </button>
              <button onClick={() => copyToClipboard([selectedItem.instanceId])}
                className="px-2 py-1 text-white text-[11px] font-semibold rounded-lg transition-all"
                style={{ background: "rgba(0,122,255,0.7)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "#007AFF"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,122,255,0.7)"; }}
              >
                ⧉ {t.fpCopyItem}
              </button>
              <button onClick={() => removeItem(selectedItem.instanceId)}
                className="px-2 py-1 bg-red-600/80 hover:bg-red-600 text-white text-[11px] font-semibold rounded-lg transition-colors">
                ✕ {t.fpDeleteItem}
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
                className="w-full accent-blue-500 h-1.5" />
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
                className="w-full accent-blue-500 h-1.5" />
            </div>
          </div>
          <div className="flex justify-between items-center">
            <button onClick={() => resizeItem(selectedItem.instanceId, 1, 1)}
              className="text-[10px] text-gray-500 hover:text-gray-300 underline">{t.fpResetSize}</button>
            <span className="text-[10px] text-gray-600">
              {t.fpOriginal} {(selectedFurniture.width / 100).toFixed(2)}m × {(selectedFurniture.depth / 100).toFixed(2)}m
            </span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-gray-600 justify-center">
        <span>{t.fpLegendDrag}</span>
        <span>{t.fpLegendMulti}</span>
        <span>{t.fpLegendRotate}</span>
        <span>{t.fpLegendCopy}</span>
        <span>{t.fpLegendDelete}</span>
        <span>{t.fpLegendEdit}</span>
        <span>{t.fpLegendGrid}</span>
      </div>
    </div>
  );
}
