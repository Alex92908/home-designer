"use client";

import { useRef, useState, useEffect } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, RoomType } from "@/lib/types";
import { ALL_POSSIBLE_ROOMS, DEFAULT_ENABLED } from "@/lib/store";
import { getFurnitureById } from "@/lib/furniture";
import { useT, useLocale } from "@/lib/i18n";

// ─── Constants ─────────────────────────────────────────────
const WALL     = 14;   // wall thickness cm
const SNAP     = 20;   // snap grid cm
const MIN_W    = 160;  // min room width cm
const MIN_D    = 120;  // min room depth cm
const HANDLE   = 28;   // resize handle size cm
const ALL_ROOMS = ALL_POSSIBLE_ROOMS;

function snap(v: number) { return Math.round(v / SNAP) * SNAP; }

function getSVGPoint(e: React.PointerEvent, svg: SVGSVGElement) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM()!.inverse());
}

// ─── Types ─────────────────────────────────────────────────
type DragState =
  | { type: "move";   room: RoomType; sx: number; sy: number; ox: number; oy: number; hasMoved: boolean }
  | { type: "resize"; room: RoomType; sx: number; sy: number; ow: number; od: number };

const CUSTOM_SLOTS: RoomType[] = ["custom1","custom2","custom3","custom4","custom5"];
const ROOM_GROUP_ROOMS = [
  { key: "allGroupIndoor",   rooms: ["living","master","bedroom","bedroom2","bedroom3","kitchen","bathroom","bathroom2","dining","study","study2","closet","balcony","balcony2"] as RoomType[] },
  { key: "allGroupSpecial",  rooms: ["yard","garage","gym","cinema"] as RoomType[] },
  { key: "allGroupCustom",   rooms: CUSTOM_SLOTS },
];
const CUSTOM_ICONS = ["🔲","🏠","🛖","🏰","🏗️","🎯","🎲","🎪","⭐","💎","🌈","🔑"];

// ─── Custom room name form ──────────────────────────────────
function CustomRoomForm({ room, onDone }: { room: RoomType; onDone: () => void }) {
  const setCustomRoomMeta = useDesignerStore(s => s.setCustomRoomMeta);
  const meta = useDesignerStore(s => s.customRoomMeta[room]);
  const [name, setName] = useState(meta?.name ?? "");
  const [icon, setIcon] = useState(meta?.icon ?? "🔲");
  const t = useT();
  return (
    <div className="px-3 pb-3 bg-blue-50 flex flex-col gap-2">
      <input value={name} onChange={e => setName(e.target.value)}
        placeholder={t.allRoomNamePlaceholder} maxLength={12}
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 bg-white" />
      <div className="flex flex-wrap gap-1">
        {CUSTOM_ICONS.map(ic => (
          <button key={ic} onClick={() => setIcon(ic)}
            className={`text-sm p-0.5 rounded transition-colors ${icon === ic ? "bg-blue-200" : "hover:bg-gray-200"}`}>
            {ic}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={() => { if (name.trim()) { setCustomRoomMeta(room, name.trim(), icon); onDone(); } }}
          disabled={!name.trim()}
          className="flex-1 py-1 bg-blue-600 text-white text-xs font-bold rounded-xl disabled:opacity-40">
          {t.allConfirm}
        </button>
        <button onClick={onDone} className="px-2 text-xs text-gray-400 hover:text-gray-600">{t.allCancel}</button>
      </div>
    </div>
  );
}

// ─── Left panel: room management ───────────────────────────
function RoomPanel() {
  const activeFloor         = useDesignerStore(s => s.activeFloor);
  const enabledRooms        = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const roomDimensions      = useDesignerStore(s => s.floorPlans[s.activeFloor].roomDimensions);
  const customRoomMeta      = useDesignerStore(s => s.customRoomMeta);
  const setCustomRoomMeta   = useDesignerStore(s => s.setCustomRoomMeta);
  const addRoom             = useDesignerStore(s => s.addRoom);
  const removeRoom          = useDesignerStore(s => s.removeRoom);
  const updateRoomDimension = useDesignerStore(s => s.updateRoomDimension);
  const roomShapes          = useDesignerStore(s => s.floorPlans[s.activeFloor].roomShapes);
  const setRoomShape        = useDesignerStore(s => s.setRoomShape);
  const resetLayout         = useDesignerStore(s => s.resetLayout);
  const pushLayoutHistory   = useDesignerStore(s => s.pushLayoutHistory);
  const copyRoom            = useDesignerStore(s => s.copyRoom);
  const pasteRoom           = useDesignerStore(s => s.pasteRoom);
  const roomClipboard       = useDesignerStore(s => s.roomClipboard);
  const exterior            = useDesignerStore(s => s.exterior);
  const setExterior         = useDesignerStore(s => s.setExterior);
  const t      = useT();
  const locale = useLocale();
  const [expanded,    setExpanded]    = useState<RoomType | null>(null);
  const [naming,      setNaming]      = useState<RoomType | null>(null);
  const [renamingRoom, setRenamingRoom] = useState<RoomType | null>(null);
  const [renameVal,   setRenameVal]   = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (renamingRoom && renameRef.current) renameRef.current.focus(); }, [renamingRoom]);

  const getRoomLabel = (room: RoomType) => {
    const meta = customRoomMeta[room];
    const def  = ROOM_DEFS[room];
    const baseName = meta?.name ?? (locale === "en" ? (t.roomNames[room] ?? def.name) : def.name);
    return { name: baseName, icon: meta?.icon ?? def.icon };
  };

  const startRename = (room: RoomType) => {
    const { name } = getRoomLabel(room);
    setRenameVal(name);
    setRenamingRoom(room);
  };

  const commitRename = (room: RoomType) => {
    const trimmed = renameVal.trim();
    if (trimmed) {
      const meta = customRoomMeta[room];
      const def  = ROOM_DEFS[room];
      setCustomRoomMeta(room, trimmed, meta?.icon ?? def.icon);
    }
    setRenamingRoom(null);
  };

  return (
    <aside className="w-56 shrink-0 h-full bg-white border-r border-gray-200 flex flex-col overflow-hidden">
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 shrink-0">
        <div className="text-xs font-black text-gray-800">{t.allRoomMgmt}</div>
        <div className="text-[10px] text-gray-400 mt-0.5">{t.allRoomCount(enabledRooms.length)}</div>
        {/* Floor count control */}
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[10px] text-gray-500 font-semibold shrink-0">{t.extFloors}:</span>
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => setExterior({ floors: Math.max(1, exterior.floors - 1) })}
              className="w-5 h-5 rounded-md text-xs font-bold text-gray-500 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors"
              disabled={exterior.floors <= 1}
            >−</button>
            <span className="w-5 text-center text-xs font-black text-gray-800">{exterior.floors}</span>
            <button
              onClick={() => setExterior({ floors: Math.min(6, exterior.floors + 1) })}
              className="w-5 h-5 rounded-md text-xs font-bold text-gray-500 hover:text-blue-500 hover:bg-blue-50 flex items-center justify-center transition-colors"
              disabled={exterior.floors >= 6}
            >＋</button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Active rooms on current floor ── */}
        <div className="py-1">
          {ALL_ROOMS.filter(r => enabledRooms.includes(r)).map(room => {
            const { name, icon } = getRoomLabel(room);
            const dims  = roomDimensions[room];
            const isExp = expanded === room;
            const isRenaming = renamingRoom === room;

            return (
              <div key={room} className="border-b border-gray-50 group/row">
                <div className="flex items-center gap-1 px-2.5 py-2">
                  <span className="text-sm shrink-0">{icon}</span>
                  {isRenaming ? (
                    <input
                      ref={renameRef}
                      value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onBlur={() => commitRename(room)}
                      onKeyDown={e => {
                        if (e.key === "Enter") { e.preventDefault(); commitRename(room); }
                        if (e.key === "Escape") setRenamingRoom(null);
                      }}
                      className="flex-1 text-xs font-semibold outline-none border-b border-blue-400 bg-transparent text-gray-700 min-w-0"
                    />
                  ) : (
                    <span className="flex-1 text-xs font-semibold text-gray-700 truncate min-w-0">{name}</span>
                  )}
                  {/* Hover actions */}
                  <div className="hidden group-hover/row:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => startRename(room)}
                      className="text-[11px] text-gray-400 hover:text-gray-700 px-0.5 leading-none"
                      title="重命名">✏️</button>
                    <button
                      onClick={() => copyRoom(room)}
                      className="text-[11px] text-gray-400 hover:text-blue-600 px-0.5 leading-none"
                      title="复制房间配置">⧉</button>
                    {roomClipboard && (
                      <button
                        onClick={() => pasteRoom(room)}
                        className="text-[11px] text-emerald-500 hover:text-emerald-700 px-0.5 leading-none"
                        title="粘贴配置">📋</button>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0 group-hover/row:hidden">
                    {(dims.width/100).toFixed(1)}×{(dims.depth/100).toFixed(1)}
                  </span>
                  <button onClick={() => setExpanded(isExp ? null : room)}
                    className="text-[10px] text-gray-400 hover:text-gray-700 w-4 text-center shrink-0">
                    {isExp ? "▲" : "▼"}
                  </button>
                  <button onClick={() => { pushLayoutHistory(); removeRoom(room); setExpanded(null); setRenamingRoom(null); }}
                    className="text-[11px] text-gray-300 hover:text-red-400 transition-colors w-4 text-center font-bold shrink-0"
                    title="移除房间">✕</button>
                </div>

                {naming === room && (
                  <CustomRoomForm room={room} onDone={() => setNaming(null)} />
                )}

                {isExp && naming !== room && (
                  <div className="px-3 pb-2.5 bg-gray-50 flex flex-col gap-2">
                    <div className="text-[10px] text-gray-500 font-bold">{t.allResizeDims}</div>
                    <div className="flex gap-2">
                      {[
                        { label: t.allWidthLabel, val: dims.width,  min: 1.6, set: (v: number) => updateRoomDimension(room, Math.round(v*100), dims.depth) },
                        { label: t.allDepthLabel, val: dims.depth,  min: 1.2, set: (v: number) => updateRoomDimension(room, dims.width, Math.round(v*100)) },
                      ].map(({ label, val, min, set }) => (
                        <div key={label} className="flex flex-col gap-0.5 flex-1">
                          <label className="text-[9px] text-gray-400">{label} m</label>
                          <input type="number" min={min} max={30} step={0.1}
                            value={(val/100).toFixed(1)}
                            onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= min) set(v); }}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-blue-400" />
                        </div>
                      ))}
                    </div>
                    <div className="text-[9px] text-gray-400">≈ {((dims.width/100)*(dims.depth/100)).toFixed(1)} ㎡</div>
                    {/* Shape picker: 矩形 / L 型 / 凸字型 */}
                    <div className="flex flex-col gap-1 mt-1">
                      <div className="text-[10px] text-gray-500 font-bold">形状</div>
                      <div className="flex gap-1">
                        {([
                          { preset: "rect"    as const, label: "矩形", icon: "▭" },
                          { preset: "l-shape" as const, label: "L型",  icon: "⌐" },
                          { preset: "convex"  as const, label: "凸字", icon: "⎍" },
                        ]).map(({ preset, label, icon }) => {
                          const active = (roomShapes?.[room]?.preset ?? "rect") === preset;
                          return (
                            <button key={preset}
                              onClick={() => { pushLayoutHistory(); setRoomShape(room, preset); }}
                              className={`flex-1 py-1 px-1 rounded-lg text-[10px] font-semibold transition-colors ${
                                active
                                  ? "bg-blue-600 text-white"
                                  : "bg-white text-gray-500 border border-gray-200 hover:border-blue-300 hover:text-blue-600"
                              }`}
                            >
                              <span className="mr-0.5">{icon}</span>{label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Addable rooms by group ── */}
        {ROOM_GROUP_ROOMS.map(group => {
          const addable = group.rooms.filter(r => !enabledRooms.includes(r));
          if (!addable.length) return null;
          const groupLabel = t[group.key as keyof typeof t] as string;
          return (
            <div key={group.key} className="px-2.5 pt-3 pb-1">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">＋ {groupLabel}</div>
              <div className="flex flex-col gap-1">
                {addable.map(room => {
                  const { name, icon } = getRoomLabel(room);
                  return (
                    <button key={room} onClick={() => { pushLayoutHistory(); addRoom(room); if (CUSTOM_SLOTS.includes(room)) setNaming(room); }}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left">
                      <span className="text-sm">{icon}</span>
                      <span className="flex-1 text-xs text-gray-500 font-medium">{name}</span>
                      <span className="text-sm font-bold text-blue-400">＋</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-gray-100 shrink-0">
        <button onClick={resetLayout}
          className="w-full py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl hover:border-gray-300 transition-colors">
          {t.allResetLayout}
        </button>
      </div>
    </aside>
  );
}

// ─── Main FloorPlanAll ──────────────────────────────────────
export default function FloorPlanAll() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const t      = useT();
  const locale = useLocale();

  const activeFloor         = useDesignerStore(s => s.activeFloor);
  const setActiveFloor      = useDesignerStore(s => s.setActiveFloor);
  const rooms               = useDesignerStore(s => s.floorPlans[s.activeFloor].rooms);
  const activeRoom          = useDesignerStore(s => s.activeRoom);
  const roomLayout          = useDesignerStore(s => s.floorPlans[s.activeFloor].roomLayout);
  const roomDimensions      = useDesignerStore(s => s.floorPlans[s.activeFloor].roomDimensions);
  const enabledRooms        = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const roomWindows         = useDesignerStore(s => s.floorPlans[s.activeFloor].roomWindows);
  const roomShapes          = useDesignerStore(s => s.floorPlans[s.activeFloor].roomShapes);
  const customRoomMeta      = useDesignerStore(s => s.customRoomMeta);
  const setActiveRoom       = useDesignerStore(s => s.setActiveRoom);
  const setViewMode         = useDesignerStore(s => s.setViewMode);
  const updateRoomLayout    = useDesignerStore(s => s.updateRoomLayout);
  const updateRoomDimension = useDesignerStore(s => s.updateRoomDimension);
  const rotateRoom          = useDesignerStore(s => s.rotateRoom);
  const pushLayoutHistory   = useDesignerStore(s => s.pushLayoutHistory);
  const undoLayout          = useDesignerStore(s => s.undoLayout);
  const historyLen          = useDesignerStore(s => s.layoutHistory.length);
  const roomClipboard       = useDesignerStore(s => s.roomClipboard);
  const pasteAsNewRoom      = useDesignerStore(s => s.pasteAsNewRoom);
  const exterior            = useDesignerStore(s => s.exterior);

  const getRoomLabel = (room: RoomType) => {
    const meta = customRoomMeta[room];
    const def  = ROOM_DEFS[room];
    const baseName = meta?.name ?? (locale === "en" ? (t.roomNames[room] ?? def.name) : def.name);
    return { name: baseName, icon: meta?.icon ?? def.icon };
  };

  const svgRef  = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);

  // Compute viewBox from enabled rooms on current floor
  const visibleRooms = ALL_ROOMS.filter(r => enabledRooms.includes(r));
  const pad = 60;
  const vbX1 = visibleRooms.length ? Math.min(...visibleRooms.map(r => roomLayout[r].x)) - pad : 0;
  const vbY1 = visibleRooms.length ? Math.min(...visibleRooms.map(r => roomLayout[r].y)) - pad : 0;
  const vbX2 = visibleRooms.length ? Math.max(...visibleRooms.map(r => roomLayout[r].x + roomDimensions[r].width))  + pad : 800;
  const vbY2 = visibleRooms.length ? Math.max(...visibleRooms.map(r => roomLayout[r].y + roomDimensions[r].depth)) + pad + 60 : 600;
  const viewBox = `${vbX1} ${vbY1} ${vbX2 - vbX1} ${vbY2 - vbY1}`;

  const configuredCount = ALL_ROOMS.filter(r =>
    Object.keys(rooms[r].materials).length > 0 || rooms[r].placedItems.length > 0
  ).length;

  // ── Pointer handlers ──
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const ds = dragRef.current;
    if (!ds || !svgRef.current) return;
    const pt = getSVGPoint(e, svgRef.current);
    const dx = pt.x - ds.sx, dy = pt.y - ds.sy;
    if (ds.type === "move") {
      if (!ds.hasMoved && Math.sqrt(dx*dx + dy*dy) < 8) return;
      if (!ds.hasMoved) pushLayoutHistory();
      dragRef.current = { ...ds, hasMoved: true };
      updateRoomLayout(ds.room, snap(ds.ox + dx), snap(ds.oy + dy));
    } else {
      updateRoomDimension(ds.room,
        Math.max(MIN_W, snap(ds.ow + dx)),
        Math.max(MIN_D, snap(ds.od + dy))
      );
    }
  };

  const handlePointerUp = () => {
    const ds = dragRef.current;
    if (ds?.type === "move" && !ds.hasMoved) {
      setActiveRoom(ds.room);
      setViewMode("2d");
    }
    dragRef.current = null;
  };

  const startMove = (e: React.PointerEvent, room: RoomType) => {
    e.stopPropagation();
    if (!svgRef.current) return;
    svgRef.current.setPointerCapture(e.pointerId);
    const pt = getSVGPoint(e, svgRef.current);
    dragRef.current = { type: "move", room, sx: pt.x, sy: pt.y, ox: roomLayout[room].x, oy: roomLayout[room].y, hasMoved: false };
  };

  const startResize = (e: React.PointerEvent, room: RoomType) => {
    e.stopPropagation();
    if (!svgRef.current) return;
    pushLayoutHistory();
    svgRef.current.setPointerCapture(e.pointerId);
    const pt = getSVGPoint(e, svgRef.current);
    const d = roomDimensions[room];
    dragRef.current = { type: "resize", room, sx: pt.x, sy: pt.y, ow: d.width, od: d.depth };
  };

  return (
    <div className="w-full h-full flex overflow-hidden">
      <RoomPanel />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
        {/* Subheader */}
        <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-100 shrink-0">
          <span className="text-xs font-bold text-gray-800">{t.allTitle}</span>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {configuredCount}/{ALL_ROOMS.length} {t.allConfigured}
          </span>
          <span className="text-[10px] text-gray-400 hidden lg:block">{t.allHint}</span>
          {/* Floor selector tabs — only shown when floors > 1 */}
          {exterior.floors > 1 && (
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-[10px] text-gray-400 mr-1">{t.fpFloor}:</span>
              {Array.from({ length: exterior.floors }).map((_, i) => (
                <button key={i}
                  onClick={() => setActiveFloor(i)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    activeFloor === i
                      ? "bg-blue-600 text-white"
                      : "bg-white/10 text-gray-400 hover:text-white border border-gray-200 hover:bg-blue-50 hover:border-blue-300"
                  }`}
                >
                  {i + 1}F
                </button>
              ))}
            </div>
          )}
          {roomClipboard && (
            <button
              onClick={pasteAsNewRoom}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${exterior.floors <= 1 ? "ml-auto" : ""}`}
              style={{ border: "1px solid #007AFF", color: "#007AFF", background: "white" }}
            >
              📋 {t.allPasteRoom} ({roomClipboard.name})
            </button>
          )}
        </div>

        {/* Empty floor hint */}
        {visibleRooms.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <div className="text-5xl opacity-20">🏗️</div>
            <div className="text-sm font-bold text-gray-400">
              {activeFloor + 1}F 暂无房间
            </div>
            <div className="text-xs text-gray-300 max-w-48 leading-relaxed">
              在左侧添加房间到 {activeFloor + 1}F
            </div>
          </div>
        )}

        {/* SVG canvas */}
        {visibleRooms.length > 0 && <div className="flex-1 overflow-auto flex items-start justify-center p-4">
          <svg
            ref={svgRef}
            viewBox={viewBox}
            style={{ width: "100%", maxWidth: 580, display: "block", flexShrink: 0, touchAction: "none" }}
            preserveAspectRatio="xMidYMin meet"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            {/* Background */}
            <rect x={vbX1} y={vbY1} width={vbX2 - vbX1} height={vbY2 - vbY1} fill="#9CA3AF" />

            {/* Pass 1: room bodies */}
            {visibleRooms.map(room => {
              const def     = ROOM_DEFS[room];
              const pos     = roomLayout[room];
              const dims    = roomDimensions[room];
              const { x, y } = pos;
              const { width: w, depth: d } = dims;
              const cx = x + w / 2, cy = y + d / 2;
              const isActive   = room === activeRoom;
              const iconFs = Math.min(w, d) * 0.11;
              const nameFs = Math.min(w, d) * 0.088;
              const dimFs  = Math.min(w, d) * 0.068;
              const { name: roomName, icon: roomIcon } = getRoomLabel(room);

              const shape = roomShapes?.[room];
              const isPolygon = shape && shape.preset !== "rect";
              const polyPts = isPolygon
                ? shape!.points.map(([px, pz]) => `${x + px},${y + pz}`).join(" ")
                : "";
              return (
                <g key={room}>
                  {/* Wall background — polygon for L型/凸字型, rect otherwise */}
                  {isPolygon ? (
                    <polygon
                      points={polyPts}
                      fill="#374151"
                      stroke="#374151" strokeWidth={WALL * 2} strokeLinejoin="round"
                    />
                  ) : (
                    <rect x={x} y={y} width={w} height={d} fill="#374151" rx={2} />
                  )}
                  {/* Floor */}
                  {isPolygon ? (
                    <polygon
                      points={polyPts}
                      fill={rooms[room].materials.floor?.color ?? def.defaultFloorColor}
                      opacity={0.93}
                      style={{ pointerEvents: "none" }}
                    />
                  ) : (
                    <rect
                      x={x + WALL} y={y + WALL}
                      width={w - WALL*2} height={d - WALL*2}
                      fill={rooms[room].materials.floor?.color ?? def.defaultFloorColor}
                      opacity={0.93}
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                  {/* Window indicators */}
                  {(roomWindows[room] ?? []).map(win => {
                    const s2 = w / (roomDimensions[room].width);
                    const s3 = d / (roomDimensions[room].depth);
                    if (win.wall === "back") {
                      const wx = x + win.pos * s2, ww = win.len * s2;
                      return <rect key={win.id} x={wx} y={y + 2} width={ww} height={6} fill="#7DD3FC" opacity={0.6} rx={2} style={{ pointerEvents: "none" }} />;
                    }
                    if (win.wall === "front") {
                      const wx = x + win.pos * s2, ww = win.len * s2;
                      return <rect key={win.id} x={wx} y={y + d - 8} width={ww} height={6} fill="#7DD3FC" opacity={0.6} rx={2} style={{ pointerEvents: "none" }} />;
                    }
                    if (win.wall === "right") {
                      const wy = y + win.pos * s3, wh = win.len * s3;
                      return <rect key={win.id} x={x + w - 8} y={wy} width={6} height={wh} fill="#7DD3FC" opacity={0.6} rx={2} style={{ pointerEvents: "none" }} />;
                    }
                    if (win.wall === "left") {
                      const wy = y + win.pos * s3, wh = win.len * s3;
                      return <rect key={win.id} x={x + 2} y={wy} width={6} height={wh} fill="#7DD3FC" opacity={0.6} rx={2} style={{ pointerEvents: "none" }} />;
                    }
                    return null;
                  })}

                  {/* Active room highlight */}
                  {isActive && (
                    <>
                      <rect x={x+WALL} y={y+WALL} width={w-WALL*2} height={d-WALL*2}
                        fill="#3B82F6" opacity={0.12} style={{ pointerEvents: "none" }} />
                      <rect x={x-3} y={y-3} width={w+6} height={d+6}
                        fill="none" stroke="#3B82F6" strokeWidth={7} rx={3}
                        style={{ pointerEvents: "none" }} />
                    </>
                  )}

                  {/* Furniture icons */}
                  {rooms[room].placedItems.map(p => {
                    const f = getFurnitureById(p.furnitureId);
                    if (!f) return null;
                    return (
                      <text key={p.instanceId}
                        x={x + p.x} y={y + p.z}
                        textAnchor="middle" dominantBaseline="middle"
                        fontSize={Math.min(w, d) * 0.12}
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >{f.icon}</text>
                    );
                  })}

                  {/* Labels */}
                  <text x={cx} y={cy - nameFs*1.2}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={iconFs} style={{ pointerEvents: "none", userSelect: "none" }}>{roomIcon}</text>
                  <text x={cx} y={cy + nameFs*0.4}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={nameFs} fontWeight={isActive ? "900" : "700"}
                    fill={isActive ? "#1D4ED8" : "#1F2937"}
                    fontFamily="system-ui, sans-serif"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >{roomName}</text>
                  <text x={cx} y={cy + nameFs*2}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={dimFs} fill={isActive ? "#3B82F6" : "#6B7280"}
                    fontFamily="system-ui, sans-serif"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >{(w/100).toFixed(1)}×{(d/100).toFixed(1)}m</text>

                  {/* Drag/tap hit rect */}
                  <rect
                    x={x+WALL} y={y+WALL}
                    width={w - WALL*2 - HANDLE} height={d - WALL*2 - HANDLE}
                    fill="transparent"
                    style={{ cursor: "grab" }}
                    onPointerDown={e => startMove(e, room)}
                  />
                </g>
              );
            })}

            {/* Pass 2: buttons on top */}
            {visibleRooms.map(room => {
              const pos  = roomLayout[room];
              const dims = roomDimensions[room];
              const { x, y } = pos;
              const { width: w, depth: d } = dims;
              const isActive = room === activeRoom;

              return (
                <g key={`btns-${room}`}>
                  {/* Undo — top-left */}
                  <g
                    style={{ cursor: historyLen > 0 ? "pointer" : "default" }}
                    onPointerDown={e => { e.stopPropagation(); if (historyLen > 0) undoLayout(); }}
                  >
                    <rect x={x + WALL} y={y + WALL} width={HANDLE} height={HANDLE}
                      fill={historyLen > 0 ? "#F97316" : "#9CA3AF"} opacity={0.82} rx={4} />
                    <text x={x + WALL + HANDLE/2} y={y + WALL + HANDLE/2}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={HANDLE * 0.72} fill="white"
                      style={{ pointerEvents: "none", userSelect: "none" }}>↩</text>
                  </g>

                  {/* Resize — bottom-right */}
                  <g onPointerDown={e => startResize(e, room)} style={{ cursor: "nwse-resize" }}>
                    <rect x={x + w - WALL - HANDLE} y={y + d - WALL - HANDLE}
                      width={HANDLE} height={HANDLE}
                      fill={isActive ? "#3B82F6" : "#6B7280"} opacity={0.75} rx={4} />
                    <text x={x + w - WALL - HANDLE/2} y={y + d - WALL - HANDLE/2}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={HANDLE * 0.7} fill="white"
                      style={{ pointerEvents: "none", userSelect: "none" }}>⤡</text>
                  </g>

                  {/* Rotate — top-right */}
                  <g style={{ cursor: "pointer" }}
                    onPointerDown={e => { e.stopPropagation(); pushLayoutHistory(); rotateRoom(room); }}>
                    <rect x={x + w - WALL - HANDLE} y={y + WALL}
                      width={HANDLE} height={HANDLE}
                      fill="#10B981" opacity={0.82} rx={4} />
                    <text x={x + w - WALL - HANDLE/2} y={y + WALL + HANDLE/2}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={HANDLE * 0.72} fill="white"
                      style={{ pointerEvents: "none", userSelect: "none" }}>↻</text>
                  </g>
                </g>
              );
            })}

            {/* Compass */}
            <g transform={`translate(${vbX2 - 60}, ${vbY2 - 80})`}>
              <circle r={36} fill="white" fillOpacity={0.92} stroke="#D1D5DB" strokeWidth={2} />
              <text textAnchor="middle" y={-14} fontSize={20} fontWeight="bold" fill="#1F2937" fontFamily="system-ui">N</text>
              <text textAnchor="middle" y={24}  fontSize={16} fill="#9CA3AF" fontFamily="system-ui">S</text>
              <text textAnchor="start"  x={9}   y={6} fontSize={16} fill="#9CA3AF" fontFamily="system-ui">E</text>
              <text textAnchor="end"    x={-9}  y={6} fontSize={16} fill="#9CA3AF" fontFamily="system-ui">W</text>
              <polygon points="0,-26 5,-8 0,-13 -5,-8" fill="#374151" />
              <polygon points="0,26 5,8 0,13 -5,8"    fill="#9CA3AF" />
            </g>

            {/* Scale ruler */}
            <g transform={`translate(${vbX1 + 20}, ${vbY2 - 50})`}>
              <rect width={100} height={9}  fill="#374151" rx={2} />
              <rect x={100}    width={100} height={9}  fill="#6B7280" rx={2} />
              {[0,100,200].map(x => <line key={x} x1={x} y1={0} x2={x} y2={18} stroke="#374151" strokeWidth={2.5} />)}
              {[{x:0,t:"0"},{x:100,t:"1m"},{x:200,t:"2m"}].map(({x,t})=>(
                <text key={t} x={x} y={34} textAnchor="middle" fontSize={17} fill="#374151" fontFamily="system-ui">{t}</text>
              ))}
            </g>
          </svg>
        </div>}
      </div>
    </div>
  );
}
