"use client";

import { useRef, useState, useEffect, useMemo } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, RoomType } from "@/lib/types";
import { ALL_POSSIBLE_ROOMS, DEFAULT_ENABLED } from "@/lib/store";
import { getFurnitureById } from "@/lib/furniture";
import { useT, useLocale , customRoomDisplayName} from "@/lib/i18n";
import { FLOORPLAN_LAYOUTS, type FloorplanLayout } from "@/lib/floorplanLayouts";
import { PROJECT_TEMPLATES } from "@/lib/projectTemplates";
import { getLayoutNameEn } from "@/locales/itemNames";
import { getAiKey, setAiKey, getSelectedProvider, setSelectedProvider } from "@/lib/aiKeys";
import { AiProviderId } from "@/lib/aiProviders";
import ApiKeyPromptModal from "./ApiKeyPromptModal";
import { houseHalfExtentsCm } from "@/lib/yardAutoLayout";

function localizeLayoutName(layout: FloorplanLayout, locale: string): string {
  if (locale === "en") return getLayoutNameEn(layout.id) ?? layout.name;
  return layout.name;
}

// ─── Constants ─────────────────────────────────────────────
const WALL     = 14;   // wall thickness cm
const SNAP     = 20;   // snap grid cm
const MIN_W    = 160;  // min room width cm
const MIN_D    = 120;  // min room depth cm
const HANDLE   = 28;   // resize handle size cm
const ALL_ROOMS = ALL_POSSIBLE_ROOMS;

function snap(v: number) { return Math.round(v / SNAP) * SNAP; }

function getSVGPoint(e: { clientX: number; clientY: number }, svg: SVGSVGElement) {
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
  { key: "allGroupSpecial",  rooms: ["hallway","stair","yard","garage","gym","cinema","pool","terrace","deck","pergola","equipment_room"] as RoomType[] },
  { key: "allGroupCustom",   rooms: CUSTOM_SLOTS },
];
const CUSTOM_ICONS = ["🔲","🏠","🛖","🏰","🏗️","🎯","🎲","🎪","⭐","💎","🌈","🔑"];

// ─── Custom room name form ──────────────────────────────────
function CustomRoomForm({ room, onDone }: { room: RoomType; onDone: () => void }) {
  const setCustomRoomMeta = useDesignerStore(s => s.setCustomRoomMeta);
  const meta = useDesignerStore(s => s.customRoomMeta[room]);
  const [name, setName] = useState(meta?.name ?? "");
  const [nameEn, setNameEn] = useState(meta?.nameEn ?? "");
  const [icon, setIcon] = useState(meta?.icon ?? "🔲");
  const t = useT();
  const locale = useLocale();
  return (
    <div className="px-3 pb-3 bg-blue-50 flex flex-col gap-2">
      <input value={name} onChange={e => setName(e.target.value)}
        placeholder={t.allRoomNamePlaceholder} maxLength={12}
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-blue-400 bg-white" />
      {/* 英文名（可选）：英文界面显示它，没填回落中文名 */}
      <input value={nameEn} onChange={e => setNameEn(e.target.value)}
        placeholder={locale === "en" ? "English name (optional)" : "English name（可选）"} maxLength={24}
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
        <button onClick={() => { if (name.trim()) { setCustomRoomMeta(room, name.trim(), icon, nameEn); onDone(); } }}
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
export function RoomPanel() {
  const activeFloor         = useDesignerStore(s => s.activeFloor);
  const enabledRooms        = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const roomDimensions      = useDesignerStore(s => s.floorPlans[s.activeFloor].roomDimensions);
  const customRoomMeta      = useDesignerStore(s => s.customRoomMeta);
  const setCustomRoomMeta   = useDesignerStore(s => s.setCustomRoomMeta);
  const addRoom             = useDesignerStore(s => s.addRoom);
  const removeRoom          = useDesignerStore(s => s.removeRoom);
  const updateRoomDimension = useDesignerStore(s => s.updateRoomDimension);
  const roomShapes              = useDesignerStore(s => s.floorPlans[s.activeFloor].roomShapes);
  const setRoomShape            = useDesignerStore(s => s.setRoomShape);
  const updateRoomShapePoint    = useDesignerStore(s => s.updateRoomShapePoint);
  const insertRoomShapePoint    = useDesignerStore(s => s.insertRoomShapePoint);
  const deleteRoomShapePoint    = useDesignerStore(s => s.deleteRoomShapePoint);
  const rectifyRoomShape        = useDesignerStore(s => s.rectifyRoomShape);
  const resetLayout         = useDesignerStore(s => s.resetLayout);
  const autoInsertHallway   = useDesignerStore(s => s.autoInsertHallway);
  const pushLayoutHistory   = useDesignerStore(s => s.pushLayoutHistory);
  const copyRoom            = useDesignerStore(s => s.copyRoom);
  const pasteRoom           = useDesignerStore(s => s.pasteRoom);
  const roomClipboard       = useDesignerStore(s => s.roomClipboard);
  const exterior            = useDesignerStore(s => s.exterior);
  const setExterior         = useDesignerStore(s => s.setExterior);
  const setActiveFloor      = useDesignerStore(s => s.setActiveFloor);
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
    const baseName = customRoomDisplayName(meta, locale) ?? (locale === "en" ? (t.roomNames[room] ?? def.name) : def.name);
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
      // 英文界面改名写 nameEn（中文名保留），中文界面写 name（英文名保留）
      if (locale === "en") {
        setCustomRoomMeta(room, meta?.name ?? def.name, meta?.icon ?? def.icon, trimmed);
      } else {
        setCustomRoomMeta(room, trimmed, meta?.icon ?? def.icon, meta?.nameEn);
      }
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
              onClick={() => setExterior({ floors: exterior.floors + 1 })}
              className="w-5 h-5 rounded-md text-xs font-bold text-gray-500 hover:text-blue-500 hover:bg-blue-50 flex items-center justify-center transition-colors"
            >＋</button>
          </div>
        </div>
        {/* 天台开关 — 始终显示 */}
        <div className="flex items-center gap-2 mt-1.5">
          {exterior.hasRooftop
            ? <span className="text-[10px] text-red-500 font-semibold shrink-0">🏠 {locale === "en" ? "Rooftop floor enabled" : "天台层已开启"}</span>
            : <span className="text-[10px] text-gray-400 font-semibold shrink-0">🏠 {locale === "en" ? "Rooftop floor disabled" : "天台层未开启"}</span>
          }
          {exterior.hasRooftop ? (
            <button
              onClick={() => { setExterior({ hasRooftop: false }); setActiveFloor(Math.min(activeFloor, exterior.floors - 1)); }}
              className="ml-auto px-2 py-0.5 rounded-lg text-[10px] font-bold text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-300 transition-colors"
            >{locale === "en" ? "Disable" : "关闭"}</button>
          ) : (
            <button
              onClick={() => setExterior({ hasRooftop: true })}
              className="ml-auto px-2 py-0.5 rounded-lg text-[10px] font-bold text-blue-500 hover:text-blue-700 border border-blue-200 hover:border-blue-400 transition-colors"
            >{locale === "en" ? "Enable" : "开启"}</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Active rooms on current floor ── */}
        <div className="py-1">
          {ALL_ROOMS.filter(r => enabledRooms.includes(r)).map(room => {
            const { name, icon } = getRoomLabel(room);
            const dims  = roomDimensions[room] ?? { width: ROOM_DEFS[room]?.width ?? 300, depth: ROOM_DEFS[room]?.depth ?? 260 };
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
                    <div className="flex-1 flex items-center gap-1 min-w-0">
                      <span className="text-xs font-semibold text-gray-700 truncate">{name}</span>
                      {room === "stair" && exterior.floors > 1 && (
                        <span className="shrink-0 text-[8px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-bold">
                          {locale === "en" ? "Same on each floor" : "每层同位"}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Hover actions */}
                  <div className="hidden group-hover/row:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => startRename(room)}
                      className="text-[11px] text-gray-400 hover:text-gray-700 px-0.5 leading-none"
                      title={t.fpRenameTitle}>✏️</button>
                    <button
                      onClick={() => copyRoom(room)}
                      className="text-[11px] text-gray-400 hover:text-blue-600 px-0.5 leading-none"
                      title={t.fpCopyRoomTitle}>⧉</button>
                    {roomClipboard && (
                      <button
                        onClick={() => pasteRoom(room)}
                        className="text-[11px] text-emerald-500 hover:text-emerald-700 px-0.5 leading-none"
                        title={t.fpPasteRoomTitle}>📋</button>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0 group-hover/row:hidden">
                    {dims ? `${(dims.width/100).toFixed(1)}×${(dims.depth/100).toFixed(1)}` : "—"}
                  </span>
                  <button onClick={() => setExpanded(isExp ? null : room)}
                    className="text-[10px] text-gray-400 hover:text-gray-700 w-4 text-center shrink-0">
                    {isExp ? "▲" : "▼"}
                  </button>
                  <button onClick={() => { pushLayoutHistory(); removeRoom(room); setExpanded(null); setRenamingRoom(null); }}
                    className="text-[11px] text-gray-300 hover:text-red-400 transition-colors w-4 text-center font-bold shrink-0"
                    title={t.fpRemoveRoomTitle}>✕</button>
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
                      <div className="text-[10px] text-gray-500 font-bold">{t.fpShapeLabel}</div>
                      <div className="flex gap-1">
                        {([
                          { preset: "rect"    as const, label: t.fpShapeRect,   icon: "▭" },
                          { preset: "l-shape" as const, label: t.fpShapeL,      icon: "⌐" },
                          { preset: "convex"  as const, label: t.fpShapeConvex, icon: "⎍" },
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
        {(() => {
          // 天台 = 普通楼层：可添加房间分组与其它楼层完全一致，不做特判。
          const groups = ROOM_GROUP_ROOMS;
          return groups.map(group => {
            const addable = group.rooms.filter(r => !enabledRooms.includes(r));
            if (!addable.length) return null;
            const groupLabel = (t[group.key as keyof typeof t] as string) ?? (locale === "en" ? "Rooftop space" : "屋顶空间");
            return (
              <div key={group.key} className="px-2.5 pt-3 pb-1">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">＋ {groupLabel}</div>
                <div className="flex flex-col gap-1">
                  {addable.map(room => {
                    const { name, icon } = getRoomLabel(room);
                    return (
                      <button key={room} onClick={() => { pushLayoutHistory(); addRoom(room); if (CUSTOM_SLOTS.includes(room)) setNaming(room); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-dashed border-gray-200 hover:border-red-300 hover:bg-red-50 transition-colors text-left">
                        <span className="text-sm">{icon}</span>
                        <span className="flex-1 text-xs text-gray-500 font-medium">{name}</span>
                        <span className="text-sm font-bold text-red-400">＋</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          });
        })()}
      </div>

      <div className="p-3 border-t border-gray-100 shrink-0 flex flex-col gap-1.5">
        <button onClick={autoInsertHallway}
          className="w-full py-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 border border-blue-200 rounded-xl hover:border-blue-400 transition-colors"
          title={locale === "en" ? "Auto-detect left/right room groups and insert an 80 cm hallway between them" : "自动检测左右两列房间，在中间插入80cm走廊"}>
          🚪 {locale === "en" ? "Insert hallway" : "插入走廊"}
        </button>
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
  const removeRoom          = useDesignerStore(s => s.removeRoom);
  const pushLayoutHistory   = useDesignerStore(s => s.pushLayoutHistory);
  const undoLayout          = useDesignerStore(s => s.undoLayout);
  const historyLen          = useDesignerStore(s => s.layoutHistory.length);
  const roomClipboard       = useDesignerStore(s => s.roomClipboard);
  const pasteAsNewRoom      = useDesignerStore(s => s.pasteAsNewRoom);
  const exterior            = useDesignerStore(s => s.exterior);
  const setExterior         = useDesignerStore(s => s.setExterior);
  const blueprint           = useDesignerStore(s => s.blueprint);
  const setBlueprint        = useDesignerStore(s => s.setBlueprint);
  // yardItems removed — yard not shown in FloorPlanAll; edit in 院子图 view
  const clearBlueprint      = useDesignerStore(s => s.clearBlueprint);
  // Unified tool state for the All/blueprint canvas:
  //   "browse" — normal (drag rooms, click to edit)
  //   "trace"  — drag the blueprint image to reposition
  //   "ruler"  — click two points → prompt real distance → auto-set scale
  //   "draw"   — click corners to define a new room polygon
  const [tool, setTool] = useState<"browse" | "trace" | "ruler" | "draw">("browse");
  const traceMode = tool === "trace";
  const [blueprintPanelOpen, setBlueprintPanelOpen] = useState(false);
  // Ruler: first-clicked point waiting for the second click
  const [rulerPt, setRulerPt] = useState<{ x: number; y: number } | null>(null);
  // Draw: accumulating polygon vertices (SVG coords, cm)
  const [drawPts, setDrawPts] = useState<Array<[number, number]>>([]);
  const [drawHover, setDrawHover] = useState<{ x: number; y: number } | null>(null);
  // Shape-edit mode for a specific room (vertex drag handles in the overview)
  const [shapeEditRoom, setShapeEditRoom] = useState<RoomType | null>(null);

  const updateRoomShapePoint  = useDesignerStore(s => s.updateRoomShapePoint);
  const insertRoomShapePoint  = useDesignerStore(s => s.insertRoomShapePoint);
  const deleteRoomShapePoint  = useDesignerStore(s => s.deleteRoomShapePoint);
  const addRoom2             = useDesignerStore(s => s.addRoom);
  const setRoomShape         = useDesignerStore(s => s.setRoomShape);
  // All floors data — for ghost overlay rendering
  const allFloorPlans        = useDesignerStore(s => s.floorPlans);
  // Multi-building
  const buildings            = useDesignerStore(s => s.buildings);
  const activeBuilding       = useDesignerStore(s => s.activeBuilding);
  const setActiveBuilding    = useDesignerStore(s => s.setActiveBuilding);
  const addBuilding              = useDesignerStore(s => s.addBuilding);
  const updateBuildingPosition   = useDesignerStore(s => s.updateBuildingPosition);
  // Which non-active floors are shown as ghost overlays (default: all visible)
  const [ghostFloors, setGhostFloors] = useState<Set<number>>(() => new Set([0, 1, 2, 3]));
  const applyFloorplanLayout  = useDesignerStore(s => s.applyFloorplanLayout);
  const applyProjectTemplate  = useDesignerStore(s => s.applyProjectTemplate);
  const applyAiDesign         = useDesignerStore(s => s.applyAiDesign);
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState<string | null>(null);
  // BYOK key 弹窗：存「拿到 平台+key 后要继续干什么」的回调，AI 解析 / 文生设计共用
  const [keyPrompt, setKeyPrompt] = useState<{ run: (provider: AiProviderId, key: string) => void } | null>(null);
  // 选中平台有 key 就直接跑，没有就弹窗让用户选平台 + 填 key，填好后再跑
  const ensureAiKey = (run: (provider: AiProviderId, key: string) => void) => {
    const provider = getSelectedProvider();
    const key = getAiKey(provider);
    if (key) run(provider, key);
    else setKeyPrompt({ run });
  };
  // AI text-to-design
  const [aiInput, setAiInput]       = useState("");
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiError, setAiError]       = useState<string | null>(null);
  const [aiSummary, setAiSummary]   = useState<string | null>(null);

  /** 点「✨ AI 生成」：没填智谱 key 先弹窗，否则直接生成 */
  function handleAiGenerate() {
    if (!aiInput.trim()) return;
    ensureAiKey((provider, key) => void doAiGenerate(provider, key));
  }

  /** 实际文生设计：平台 + key 随请求 BYOK 传递 */
  async function doAiGenerate(provider: AiProviderId, key: string) {
    const desc = aiInput.trim();
    if (!desc) return;
    setAiLoading(true);
    setAiError(null);
    setAiSummary(null);
    try {
      const res = await fetch("/api/ai-design", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: desc, provider, apiKey: key }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        // 401 = key 缺失/失效：清掉该平台本地 key 并重新弹窗
        if (res.status === 401) {
          setAiKey(provider, "");
          setKeyPrompt({ run: (p, k) => void doAiGenerate(p, k) });
          return;
        }
        setAiError(data.error ?? (locale === "en" ? "AI generation failed, please retry" : "AI 生成失败，请重试"));
        return;
      }
      applyAiDesign(data);
      setAiSummary(data.summary ?? (locale === "en" ? "Design generated!" : "设计已生成！"));
      setLayoutPickerOpen(false);
      setViewMode("exterior");
    } catch {
      setAiError(locale === "en" ? "Network error, please check your connection and retry" : "网络错误，请检查连接后重试");
    } finally {
      setAiLoading(false);
    }
  }
  // Page-level zoom for the overview canvas. Same UX as FloorPlan: − / % / +
  // / reset, plus Ctrl/Cmd-wheel pinch zoom on the canvas wrapper.
  const [zoomLevel, setZoomLevel] = useState(1.0);

  // In-app replacement for window.prompt/confirm/alert (blocked in some
  // Next.js runtime contexts). `dialog` holds the currently open dialog
  // plus its resolve callback; we render it inline at the bottom of the
  // component and resolve the promise on confirm/cancel.
  type DialogState =
    | { type: "prompt";  title: string; defaultValue: string; resolve: (v: string | null) => void }
    | { type: "confirm"; title: string; resolve: (v: boolean) => void }
    | { type: "alert";   title: string; resolve: () => void }
    | null;
  const [dialog, setDialog] = useState<DialogState>(null);
  const [dialogInput, setDialogInput] = useState("");

  const promptDialog = (title: string, defaultValue = ""): Promise<string | null> =>
    new Promise(resolve => {
      setDialogInput(defaultValue);
      setDialog({ type: "prompt", title, defaultValue, resolve });
    });
  const confirmDialog = (title: string): Promise<boolean> =>
    new Promise(resolve => setDialog({ type: "confirm", title, resolve }));
  const alertDialog = (title: string): Promise<void> =>
    new Promise(resolve => setDialog({ type: "alert", title, resolve }));

  /** 中文房间名 → RoomType 偏好链。分析器同名的第二间房会顺着链走
   *  （次卧 → bedroom → bedroom2 → bedroom3；卫生间 → bathroom → bathroom2）。 */
  const NAME_TO_TYPE_CHAIN: Record<string, RoomType[]> = {
    客厅:    ["living"],
    起居室:  ["living"],
    餐厅:    ["dining"],
    厨房:    ["kitchen"],
    主卧:    ["master"],
    主卧室:  ["master"],
    卧室:    ["bedroom", "bedroom2", "bedroom3"],
    次卧:    ["bedroom", "bedroom2", "bedroom3"],
    次卧室:  ["bedroom", "bedroom2", "bedroom3"],
    儿童房:  ["bedroom2", "bedroom3"],
    客房:    ["bedroom2", "bedroom3"],
    书房:    ["study", "study2"],
    卫生间:  ["bathroom", "bathroom2"],
    卫浴:    ["bathroom", "bathroom2"],
    浴室:    ["bathroom", "bathroom2"],
    洗手间:  ["bathroom", "bathroom2"],
    衣帽间:  ["closet"],
    储物间:  ["closet"],
    储藏室:  ["closet"],
    阳台:    ["balcony", "balcony2"],
    玄关:    ["custom1", "custom2", "custom3", "custom4", "custom5"],
    车库:    ["garage"],
    健身房:  ["gym"],
    影音室:  ["cinema"],
    影院:    ["cinema"],
  };

  /** 点「✨ AI 解析」：没填智谱 key 先弹窗，否则直接解析 */
  const runAnalyze = () => {
    if (!blueprint.image) return;
    ensureAiKey((provider, key) => void doAnalyze(provider, key));
  };

  /** 实际解析：调服务端路由 → 所选平台视觉模型 → 批量建房（平台+key 随请求 BYOK 传递） */
  const doAnalyze = async (provider: AiProviderId, key: string) => {
    if (!blueprint.image) return;
    setAnalyzing(true);
    setAnalyzeMsg(null);
    try {
      const res = await fetch("/api/analyze-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: blueprint.image, provider, apiKey: key }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 401 = key 缺失/失效：清掉该平台本地 key 并重新弹窗让用户填
        if (res.status === 401) {
          setAiKey(provider, "");
          setKeyPrompt({ run: (p, k) => void doAnalyze(p, k) });
          return;
        }
        const msg = data.message || data.error || t.fpRecognizeFailed;
        setAnalyzeMsg(`❌ ${msg}`);
        return;
      }
      const rooms: Array<{ name: string; bbox: [number, number, number, number]; shape?: string }> = data.rooms ?? [];
      if (rooms.length === 0) {
        setAnalyzeMsg(t.fpAnalyzeNoRooms);
        return;
      }
      pushLayoutHistory();
      // Track which slots we've already taken this round
      const used = new Set<RoomType>(enabledRooms);
      let placed = 0;
      for (const r of rooms) {
        const chain = NAME_TO_TYPE_CHAIN[r.name.trim()] ?? ALL_POSSIBLE_ROOMS.filter(x => x.startsWith("custom"));
        const slot = chain.find(t => !used.has(t))
          ?? ALL_POSSIBLE_ROOMS.find(t => !used.has(t));
        if (!slot) break; // 所有槽位都占满了
        used.add(slot);

        // pixel bbox → cm world coord, honoring current blueprint offset+scale
        const [px, py, pw, ph] = r.bbox;
        const x = Math.round(blueprint.offsetX + px * blueprint.scale);
        const y = Math.round(blueprint.offsetY + py * blueprint.scale);
        const w = Math.max(100, Math.round(pw * blueprint.scale));
        const d = Math.max(100, Math.round(ph * blueprint.scale));

        addRoom2(slot);
        updateRoomLayout(slot, x, y);
        updateRoomDimension(slot, w, d);
        if (r.shape === "l-shape") {
          // 模型很难给精确顶点；先套预设 L 型，用户再手动调顶点
          setRoomShape(slot, "l-shape");
        }
        placed++;
      }
      setAnalyzeMsg(t.fpAnalyzeOk(rooms.length, placed));
    } catch (e) {
      setAnalyzeMsg(t.fpAnalyzeErr(String(e)));
    } finally {
      setAnalyzing(false);
    }
  };

  /** Commit the polygon accumulated in drawPts as a new room. Assigns the
   *  next free slot from ALL_POSSIBLE_ROOMS, sets its bbox as
   *  width/depth + layout, and stores a non-rect shape when the polygon
   *  isn't an axis-aligned rectangle. */
  const commitDrawnRoom = () => {
    if (drawPts.length < 3) return;
    const xs = drawPts.map(p => p[0]);
    const ys = drawPts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = Math.max(100, maxX - minX);
    const depth = Math.max(100, maxY - minY);

    const freeSlot = ALL_POSSIBLE_ROOMS.find(r => !enabledRooms.includes(r));
    if (!freeSlot) {
      void alertDialog(t.fpNoRoomSlot);
      return;
    }

    // Detect: is it an axis-aligned rectangle? (4 corners at bbox corners)
    const isRect = drawPts.length === 4 &&
      drawPts.every(([x, y]) =>
        (x === minX || x === maxX) && (y === minY || y === maxY)
      );

    pushLayoutHistory();
    addRoom2(freeSlot);
    updateRoomLayout(freeSlot, minX, minY);
    updateRoomDimension(freeSlot, width, depth);
    if (!isRect) {
      // Write the raw polygon as a "custom" shape, points translated to
      // room-local cm (back-left origin).
      useDesignerStore.setState(s => {
        const fp = s.floorPlans[s.activeFloor];
        const newShapes = { ...(fp.roomShapes ?? {}) };
        newShapes[freeSlot] = {
          preset: "custom",
          points: drawPts.map(([x, y]) => [x - minX, y - minY] as [number, number]),
        };
        const plans = [...s.floorPlans];
        plans[s.activeFloor] = { ...fp, roomShapes: newShapes };
        return { floorPlans: plans };
      });
    }
    setDrawPts([]);
    setDrawHover(null);
    setTool("browse");
    setActiveRoom(freeSlot);
  };

  // Keyboard: Enter = commit draw, Escape = cancel current tool
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (tool === "draw") {
        if (e.key === "Enter") { e.preventDefault(); commitDrawnRoom(); }
        if (e.key === "Escape") { setTool("browse"); setDrawPts([]); setDrawHover(null); }
        if (e.key === "Backspace" && drawPts.length > 0) { e.preventDefault(); setDrawPts(pts => pts.slice(0, -1)); }
      }
      if (tool === "ruler" && e.key === "Escape") { setTool("browse"); setRulerPt(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, drawPts]);

  // Blueprint upload: read image → extract natural size → stash as data URL
  const handleBlueprintUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new window.Image();
      img.onload = () => {
        setBlueprint({
          image: dataUrl,
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
          // Try to sensibly auto-scale: if the image is roughly A4-ish, aim
          // for the whole-house bbox to fit inside. Fall back to 1 px = 1 cm.
          scale: 1,
          offsetX: 0,
          offsetY: 0,
        });
        setBlueprintPanelOpen(true);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const getRoomLabel = (room: RoomType) => {
    const meta = customRoomMeta[room];
    const def  = ROOM_DEFS[room];
    const baseName = meta?.name ?? (locale === "en" ? (t.roomNames[room] ?? def.name) : def.name);
    return { name: baseName, icon: meta?.icon ?? def.icon };
  };

  const svgRef  = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const bldDragRef = useRef<{ id: string; bldIdx: number; sx: number; sy: number; ox: number; oz: number; hasMoved: boolean } | null>(null);
  // Room-tap tracker: first tap selects (active highlight), second tap
  // within DOUBLE_MS actually enters the room in 2D view. Prevents accidental
  // mode switches while moving / resizing rooms in the plan.
  const lastRoomTapRef = useRef<{ room: RoomType; t: number } | null>(null);
  const DOUBLE_MS = 400;

  // Compute viewBox from enabled rooms on current floor + optional blueprint
  // Guard: only include rooms that have both layout and dimensions data
  // Z 顺序：outdoor 先画（垫底），indoor 后画（覆盖在上）；同组内面积大的先画。
  // 这样天台休闲区（outdoor 大块）做背景，楼梯间（indoor 小块）画在它上面可见，
  // 通用规则不只服务天台 —— 任何 outdoor 大房间套小 indoor 都会自然显出位置关系。
  const visibleRooms = ALL_ROOMS
    .filter(r => enabledRooms.includes(r) && roomDimensions[r] && roomLayout[r])
    .slice()
    .sort((a, b) => {
      const oa = ROOM_DEFS[a]?.isOutdoor ? 0 : 1;
      const ob = ROOM_DEFS[b]?.isOutdoor ? 0 : 1;
      if (oa !== ob) return oa - ob;
      const da = roomDimensions[a], db = roomDimensions[b];
      const areaA = da.width * da.depth;
      const areaB = db.width * db.depth;
      return areaB - areaA; // 面积大的先画
    });
  const pad = 60;
  const bpW = blueprint.image ? blueprint.naturalW * blueprint.scale : 0;
  const bpH = blueprint.image ? blueprint.naturalH * blueprint.scale : 0;
  const roomXs = visibleRooms.map(r => [roomLayout[r].x, roomLayout[r].x + roomDimensions[r].width]).flat();
  const roomYs = visibleRooms.map(r => [roomLayout[r].y, roomLayout[r].y + roomDimensions[r].depth]).flat();
  const bpXs = blueprint.image ? [blueprint.offsetX, blueprint.offsetX + bpW] : [];
  const bpYs = blueprint.image ? [blueprint.offsetY, blueprint.offsetY + bpH] : [];
  // 计算房屋几何中心 —— 院子物件的坐标系以此为原点（cm）
  const houseCenterX = roomXs.length ? (Math.min(...roomXs) + Math.max(...roomXs)) / 2 : 0;
  const houseCenterY = roomYs.length ? (Math.min(...roomYs) + Math.max(...roomYs)) / 2 : 0;

  // Secondary building outlines — positioned relative to the active building
  const activeBldPos = buildings[activeBuilding] ?? { x: 0, z: 0 };
  const secondaryBldOutlines = buildings
    .map((bld, i) => {
      if (i === activeBuilding) return null;
      if (!bld.floorPlans[0]) return null;
      const { hw, hd } = houseHalfExtentsCm(bld.floorPlans[0]);
      const svgCx = houseCenterX + (bld.x - activeBldPos.x);
      const svgCy = houseCenterY + (bld.z - activeBldPos.z);
      return { bld, bldIdx: i, hw, hd, svgCx, svgCy };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const bldXs = secondaryBldOutlines.flatMap(b => [b.svgCx - b.hw, b.svgCx + b.hw]);
  const bldYs = secondaryBldOutlines.flatMap(b => [b.svgCy - b.hd, b.svgCy + b.hd]);
  const allXs = [...roomXs, ...bpXs, ...bldXs];
  const allYs = [...roomYs, ...bpYs, ...bldYs];
  const vbX1 = allXs.length ? Math.min(...allXs) - pad : 0;
  const vbY1 = allYs.length ? Math.min(...allYs) - pad : 0;
  const vbX2 = allXs.length ? Math.max(...allXs) + pad : 800;
  const vbY2 = allYs.length ? Math.max(...allYs) + pad + 60 : 600;
  const viewBox = `${vbX1} ${vbY1} ${vbX2 - vbX1} ${vbY2 - vbY1}`;

  const configuredCount = ALL_ROOMS.filter(r =>
    rooms[r] && (Object.keys(rooms[r].materials).length > 0 || rooms[r].placedItems.length > 0)
  ).length;

  // ── Pointer handlers ──
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    // Building drag (non-active buildings)
    const bds = bldDragRef.current;
    if (bds && svgRef.current) {
      const pt = getSVGPoint(e, svgRef.current);
      const dx = pt.x - bds.sx, dy = pt.y - bds.sy;
      if (!bds.hasMoved && Math.sqrt(dx * dx + dy * dy) < 6) return;
      bldDragRef.current = { ...bds, hasMoved: true };
      updateBuildingPosition(bds.id, {
        x: Math.round((bds.ox + dx) / SNAP) * SNAP,
        z: Math.round((bds.oz + dy) / SNAP) * SNAP,
      });
      return;
    }
    // Room drag / resize
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
    // End building drag — if no movement, treat as click → switch active building
    if (bldDragRef.current) {
      if (!bldDragRef.current.hasMoved) setActiveBuilding(bldDragRef.current.bldIdx);
      bldDragRef.current = null;
      return;
    }
    const ds = dragRef.current;
    if (ds?.type === "move" && !ds.hasMoved) {
      // 第一次点：只设激活房间；第二次在 400ms 内点同一间房才进入 2D
      const now = Date.now();
      const last = lastRoomTapRef.current;
      if (last && last.room === ds.room && now - last.t < DOUBLE_MS) {
        setActiveRoom(ds.room);
        setViewMode("2d");
        lastRoomTapRef.current = null;
      } else {
        setActiveRoom(ds.room);
        lastRoomTapRef.current = { room: ds.room, t: now };
      }
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
      {/* Main area — left sidebar (RoomPanel) is now rendered by page.tsx
          in a collapsible container, matching 效果图 / 平面图 UX. */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
        {/* Subheader */}
        <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-100 shrink-0">
          <span className="text-xs font-bold text-gray-800">{t.allTitle}</span>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {configuredCount}/{ALL_ROOMS.length} {t.allConfigured}
          </span>
          <span className="text-[10px] text-gray-400 hidden lg:block">{t.allHint}</span>
          {/* Toolbar undo — page-level layout undo, easier to find than the
              tiny per-room ↩ corner button when bulk-adding rooms via Layouts
              / AI Analyze. */}
          <button
            onClick={() => { if (historyLen > 0) undoLayout(); }}
            disabled={historyLen === 0}
            title={t.fpOverviewUndoTitle(historyLen)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ border: "1px solid #F97316", color: "#F97316", background: "white" }}
          >
            {t.fpOverviewUndoBtn}
            {historyLen > 0 && (
              <span className="text-[9px] px-1 rounded-full bg-orange-100">{historyLen}</span>
            )}
          </button>
          {/* Building switcher — add/switch buildings, manage positions */}
          {buildings.length > 0 && (
            <div className="flex items-center gap-1">
              {buildings.map((bld, i) => (
                <button
                  key={bld.id}
                  onClick={() => setActiveBuilding(i)}
                  title={bld.label}
                  className="px-2.5 py-0.5 text-[11px] font-bold rounded-full transition-all"
                  style={i === activeBuilding
                    ? { background: "#EFF6FF", color: "#2563EB", border: "1px solid #93C5FD" }
                    : { background: "white", color: "#6B7280", border: "1px solid #E5E7EB" }
                  }>
                  {bld.label}
                </button>
              ))}
              <button
                onClick={() => {
                  const label = locale === "en" ? `Bldg ${buildings.length + 1}` : `楼${buildings.length + 1}`;
                  addBuilding(label, buildings.length * 1600, 0);
                }}
                title={locale === "en" ? "Add building" : "添加楼栋"}
                className="w-5 h-5 flex items-center justify-center text-[13px] rounded-full transition-all"
                style={{ background: "#EFF6FF", color: "#2563EB", border: "1px solid #93C5FD" }}>
                +
              </button>
            </div>
          )}
          {/* Floor switcher is now in the TopBar (unified across all views) */}
          <div className="ml-auto" />
          {roomClipboard && (
            <button
              onClick={pasteAsNewRoom}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${exterior.floors <= 1 ? "ml-auto" : ""}`}
              style={{ border: "1px solid #007AFF", color: "#007AFF", background: "white" }}
            >
              📋 {t.allPasteRoom} ({roomClipboard.name})
            </button>
          )}
          <button
            onClick={() => setLayoutPickerOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${(!roomClipboard && exterior.floors <= 1 && !blueprint.image) ? "ml-auto" : ""}`}
            style={{ border: "1px solid #6366F1", color: "#6366F1", background: "white" }}
            title={t.fpHouseTemplateTitle}
          >
            {t.fpHouseTemplateBtn}
          </button>
          {/* 院子入口先注释掉 — 「编辑院子」按钮暂时下线
          <button
            onClick={() => setViewMode("yard2d")}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all"
            style={{ border: "1px solid #10B981", color: "#059669", background: "white" }}
            title={locale === "en" ? "Open yard design: drag trees / flowers / pools / pavilions around the house" : "进入院子设计：拖拽树/花/池子/凉亭等到房屋周围"}
          >
            🌳 {locale === "en" ? "Edit yard" : "编辑院子"}
          </button>
          */}
          <button
            onClick={() => setViewMode("exterior")}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all"
            style={{ border: "1px solid #6366F1", color: "#6366F1", background: "white" }}
            title={locale === "en" ? "Open 3D exterior design" : "进入 3D 外观设计"}
          >
            🏠 {locale === "en" ? "Exterior" : "外观"}
          </button>
          {/* Blueprint tracing: upload image, adjust, toggle trace mode */}
          {!blueprint.image ? (
            <label
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold cursor-pointer transition-all ${(!roomClipboard && exterior.floors <= 1) ? "ml-auto" : ""}`}
              style={{ border: "1px dashed #9CA3AF", color: "#6B7280", background: "white" }}
              title={t.fpUploadBlueprintTitle}
            >
              {t.fpUploadBlueprintBtn}
              <input type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleBlueprintUpload(f); e.currentTarget.value = ""; }}
              />
            </label>
          ) : (
            <div className={`flex items-center gap-1 ${(!roomClipboard && exterior.floors <= 1) ? "ml-auto" : ""}`}>
              {/* Tool picker: trace / ruler / draw. Click same tool again to exit. */}
              {([
                { id: "trace" as const, label: t.fpToolTrace, icon: "📐", color: "#F59E0B", title: t.fpToolTraceTitle },
                { id: "ruler" as const, label: t.fpToolRuler, icon: "🔭", color: "#0EA5E9", title: t.fpToolRulerTitle },
                { id: "draw"  as const, label: t.fpToolDraw,  icon: "✏️", color: "#10B981", title: t.fpToolDrawTitle },
              ]).map(({ id, label, icon, color, title }) => {
                const active = tool === id;
                return (
                  <button key={id}
                    onClick={() => {
                      setTool(active ? "browse" : id);
                      setRulerPt(null); setDrawPts([]); setDrawHover(null);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all"
                    style={active
                      ? { background: color, color: "#fff" }
                      : { border: `1px solid ${color}`, color, background: "white" }}
                    title={title}
                  >
                    <span>{icon}</span><span>{label}</span>
                  </button>
                );
              })}
              <button
                onClick={runAnalyze}
                disabled={analyzing}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-wait"
                style={{ background: "linear-gradient(135deg, #8B5CF6, #EC4899)", color: "#fff" }}
                title={t.fpAiAnalyzeTitle}
              >
                {analyzing ? t.fpAiAnalyzeBusy : t.fpAiAnalyzeBtn}
              </button>
              <button onClick={() => setBlueprintPanelOpen(v => !v)}
                className="px-2 py-1 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100"
                title={t.fpBlueprintAdjustTitle}
              >⚙️</button>
              <button onClick={() => { clearBlueprint(); setTool("browse"); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold transition-all hover:text-white"
                style={{ border: "1px solid #EF4444", color: "#EF4444", background: "white" }}
                onMouseEnter={e => { e.currentTarget.style.background = "#EF4444"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "white"; }}
                title={t.fpBlueprintRemoveTitle}
              ><span>🗑️</span><span>{t.fpBlueprintRemoveTitle}</span></button>
            </div>
          )}
        </div>

        {/* Blueprint control popover */}
        {blueprint.image && blueprintPanelOpen && (
          <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 border-b border-amber-200 shrink-0 flex-wrap text-[11px]">
            <span className="font-semibold text-amber-700">{t.fpBpControlsLabel}</span>
            <label className="flex items-center gap-1.5">
              {t.fpBpOpacity}
              <input type="range" min={0.1} max={1} step={0.05}
                value={blueprint.opacity}
                onChange={e => setBlueprint({ opacity: parseFloat(e.target.value) })}
                className="w-20 accent-amber-500" />
              <span className="font-mono w-7 text-right">{Math.round(blueprint.opacity * 100)}%</span>
            </label>
            <label className="flex items-center gap-1.5">
              {t.fpBpScale}
              <input type="number" min={0.05} max={20} step={0.05}
                value={blueprint.scale}
                onChange={e => setBlueprint({ scale: Math.max(0.05, parseFloat(e.target.value) || 1) })}
                className="w-16 px-1 py-0.5 border border-amber-300 rounded" />
              <span className="text-gray-500">cm/px</span>
            </label>
            <label className="flex items-center gap-1.5">
              X
              <input type="number" step={10}
                value={Math.round(blueprint.offsetX)}
                onChange={e => setBlueprint({ offsetX: parseFloat(e.target.value) || 0 })}
                className="w-16 px-1 py-0.5 border border-amber-300 rounded" />
            </label>
            <label className="flex items-center gap-1.5">
              Y
              <input type="number" step={10}
                value={Math.round(blueprint.offsetY)}
                onChange={e => setBlueprint({ offsetY: parseFloat(e.target.value) || 0 })}
                className="w-16 px-1 py-0.5 border border-amber-300 rounded" />
            </label>
            <span className="text-gray-500 ml-auto">{t.fpBpDimensions(blueprint.naturalW, blueprint.naturalH, Math.round(blueprint.naturalW * blueprint.scale), Math.round(blueprint.naturalH * blueprint.scale))}</span>
          </div>
        )}

        {/* Empty floor hint */}
        {visibleRooms.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <div className="text-5xl opacity-20">🏗️</div>
            <div className="text-sm font-bold text-gray-400">
              {t.fpFloorEmpty(activeFloor + 1)}
            </div>
            <div className="text-xs text-gray-300 max-w-48 leading-relaxed">
              {t.fpFloorEmptyHint(activeFloor + 1)}
            </div>
          </div>
        )}

        {/* BYOK 大模型 key 弹窗：AI 解析 / 文生设计共用，没填 key 时弹出，填好后跑挂起的动作 */}
        {keyPrompt && <ApiKeyPromptModal
          initialProvider={getSelectedProvider()}
          getSavedKey={getAiKey}
          onSave={(provider, k) => {
            setAiKey(provider, k);
            setSelectedProvider(provider);
            const run = keyPrompt.run;
            setKeyPrompt(null);
            run(provider, k);
          }}
          onClose={() => setKeyPrompt(null)}
        />}

        {/* AI analyze result / error */}
        {analyzeMsg && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-violet-50 border-b border-violet-200 shrink-0 text-[11px] text-violet-900">
            <span>{analyzeMsg}</span>
            <button onClick={() => setAnalyzeMsg(null)}
              className="ml-auto text-violet-400 hover:text-violet-700">✕</button>
          </div>
        )}

        {/* Tool hint bar */}
        {(tool === "ruler" || tool === "draw") && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-sky-50 border-b border-sky-200 shrink-0 text-[11px]">
            {tool === "ruler" && (
              <span><b>{t.fpRulerLabel}</b>{rulerPt ? t.fpRulerHintSecond : t.fpRulerHintFirst}{t.fpRulerCancel}</span>
            )}
            {tool === "draw" && (
              <>
                <span><b>{t.fpDrawLabel}</b>{t.fpDrawHint}
                  <b>Enter</b> {t.fpDrawHintEnter}<b>Backspace</b> {t.fpDrawHintBack}<b>Esc</b> {t.fpDrawHintEsc}</span>
                <span className="ml-auto font-mono">{t.fpDrawPtCount(drawPts.length)}</span>
                {drawPts.length >= 3 && (
                  <button onClick={commitDrawnRoom}
                    className="px-2 py-0.5 rounded bg-emerald-500 text-white font-bold"
                  >{t.fpDrawDone}</button>
                )}
                <button onClick={() => { setTool("browse"); setDrawPts([]); setDrawHover(null); }}
                  className="px-2 py-0.5 rounded border border-gray-300 text-gray-500"
                >{t.fpCancel}</button>
              </>
            )}
          </div>
        )}

        {/* SVG canvas (also visible when only a blueprint is loaded so
            users can position the trace image before adding rooms) */}
        {(visibleRooms.length > 0 || blueprint.image) && <div
          className="flex-1 overflow-auto flex items-start justify-center p-4 relative"
          onWheel={(e) => {
            // Ctrl/Cmd + wheel = pinch zoom (matches FloorPlan UX)
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
            setZoomLevel(prev => Math.max(0.3, Math.min(5, prev * delta)));
          }}
        >
          <div style={{ transform: `scale(${zoomLevel})`, transformOrigin: "top center", width: "100%", display: "flex", justifyContent: "center" }}>
          <svg
            ref={svgRef}
            viewBox={viewBox}
            style={{
              width: "100%", maxWidth: 580, display: "block", flexShrink: 0, touchAction: "none",
              cursor: tool === "ruler" || tool === "draw" ? "crosshair" : "default",
            }}
            preserveAspectRatio="xMidYMin meet"
            onPointerMove={(e) => {
              handlePointerMove(e);
              if ((tool === "ruler" && rulerPt) || tool === "draw") {
                const p = getSVGPoint(e, svgRef.current!);
                setDrawHover({ x: p.x, y: p.y });
              }
            }}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onClick={(e) => {
              if (!svgRef.current) return;
              // Intercept clicks for ruler / draw tools (rooms handle their own
              // clicks via pointerdown on their hit rects, so this only fires
              // when clicking the canvas background / blueprint).
              if (tool === "ruler") {
                const p = getSVGPoint(e, svgRef.current);
                if (!rulerPt) {
                  setRulerPt({ x: p.x, y: p.y });
                } else {
                  const dxx = p.x - rulerPt.x, dyy = p.y - rulerPt.y;
                  const svgDist = Math.hypot(dxx, dyy); // current cm
                  if (svgDist < 1) { setRulerPt(null); return; }
                  promptDialog(t.fpAskRealDistance, "3.6").then(input => {
                    if (input) {
                      const realM = parseFloat(input);
                      if (isFinite(realM) && realM > 0) {
                        const realCm = realM * 100;
                        const k = realCm / svgDist;
                        if (blueprint.image) {
                          setBlueprint({ scale: blueprint.scale * k });
                        }
                      }
                    }
                    setRulerPt(null);
                    setTool("browse");
                  });
                }
              } else if (tool === "draw") {
                const p = getSVGPoint(e, svgRef.current);
                // Snap to 10cm
                const sx = Math.round(p.x / 10) * 10;
                const sy = Math.round(p.y / 10) * 10;
                setDrawPts(pts => [...pts, [sx, sy]]);
              }
            }}
            onDoubleClick={(e) => {
              if (tool === "draw" && drawPts.length >= 3) {
                e.preventDefault();
                commitDrawnRoom();
              }
            }}
          >
            {/* Background */}
            <rect x={vbX1} y={vbY1} width={vbX2 - vbX1} height={vbY2 - vbY1} fill="#9CA3AF" />

            {/* Blueprint overlay — behind rooms. Draggable in trace mode. */}
            {blueprint.image && (
              <image
                href={blueprint.image}
                x={blueprint.offsetX}
                y={blueprint.offsetY}
                width={blueprint.naturalW * blueprint.scale}
                height={blueprint.naturalH * blueprint.scale}
                opacity={blueprint.opacity}
                style={{ pointerEvents: traceMode ? "auto" : "none", cursor: traceMode ? "grab" : "default" }}
                preserveAspectRatio="none"
                onPointerDown={(e) => {
                  if (!traceMode || !svgRef.current) return;
                  e.stopPropagation();
                  svgRef.current.setPointerCapture(e.pointerId);
                  const startPt = getSVGPoint(e, svgRef.current);
                  const sx0 = blueprint.offsetX, sy0 = blueprint.offsetY;
                  const onMove = (ev: PointerEvent) => {
                    const pt = svgRef.current!.createSVGPoint();
                    pt.x = ev.clientX; pt.y = ev.clientY;
                    const loc = pt.matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
                    setBlueprint({
                      offsetX: Math.round((sx0 + loc.x - startPt.x) / 10) * 10,
                      offsetY: Math.round((sy0 + loc.y - startPt.y) / 10) * 10,
                    });
                  };
                  const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp, { once: true });
                }}
              />
            )}

            {/* ── Other buildings — same-canvas rendering at their relative positions ── */}
            {buildings.map((bld, bldIdx) => {
              if (bldIdx === activeBuilding) return null;
              const fp = bld.floorPlans[Math.min(activeFloor, bld.floorPlans.length - 1)];
              if (!fp) return null;
              const bldRooms = ALL_ROOMS.filter(r =>
                (fp.enabledRooms ?? []).includes(r) && fp.roomDimensions?.[r] && fp.roomLayout?.[r]
                && !ROOM_DEFS[r]?.isOutdoor
              );
              // Compute this building's local room-center so we can align it to its world position
              const rxs = bldRooms.flatMap(r => [fp.roomLayout![r].x, fp.roomLayout![r].x + fp.roomDimensions![r].width]);
              const rys = bldRooms.flatMap(r => [fp.roomLayout![r].y, fp.roomLayout![r].y + fp.roomDimensions![r].depth]);
              const bcx = rxs.length ? (Math.min(...rxs) + Math.max(...rxs)) / 2 : 0;
              const bcy = rys.length ? (Math.min(...rys) + Math.max(...rys)) / 2 : 0;
              // Target SVG position: offset from active building's center by world-space distance
              const tx = houseCenterX + (bld.x - activeBldPos.x) - bcx;
              const ty = houseCenterY + (bld.z - activeBldPos.z) - bcy;
              const bMinX = rxs.length ? Math.min(...rxs) : -200;
              const bMinY = rys.length ? Math.min(...rys) : -200;
              const bMaxX = rxs.length ? Math.max(...rxs) : 200;
              const bMaxY = rys.length ? Math.max(...rys) : 200;
              return (
                <g key={bld.id} transform={`translate(${tx},${ty})`}
                  style={{ cursor: bldDragRef.current?.id === bld.id ? "grabbing" : "grab", opacity: 0.5 }}
                  onPointerDown={(e) => {
                    if (!svgRef.current) return;
                    e.stopPropagation();
                    svgRef.current.setPointerCapture(e.pointerId);
                    const pt = getSVGPoint(e, svgRef.current);
                    bldDragRef.current = { id: bld.id, bldIdx, sx: pt.x, sy: pt.y, ox: bld.x, oz: bld.z, hasMoved: false };
                  }}>
                  {/* Background fill so building is visually distinct */}
                  <rect x={bMinX - 6} y={bMinY - 6} width={bMaxX - bMinX + 12} height={bMaxY - bMinY + 12}
                    fill="#EFF6FF" stroke="#93C5FD" strokeWidth={1.5} strokeDasharray="6 3" rx={4}
                  />
                  {/* Room tiles */}
                  {bldRooms.map(room => {
                    const pos  = fp.roomLayout![room];
                    const dims = fp.roomDimensions![room];
                    const shape = fp.roomShapes?.[room];
                    const isPolygon = shape && shape.preset !== "rect";
                    const polyPts = isPolygon
                      ? shape!.points.map(([px, pz]) => `${pos.x + px},${pos.y + pz}`).join(" ") : "";
                    const roomName = ROOM_DEFS[room]?.name ?? room;
                    return (
                      <g key={room}>
                        {isPolygon ? (
                          <polygon points={polyPts} fill="#BFDBFE" stroke="#3B82F6" strokeWidth={1.5} />
                        ) : (
                          <rect x={pos.x} y={pos.y} width={dims.width} height={dims.depth}
                            fill="#BFDBFE" stroke="#3B82F6" strokeWidth={1.5} rx={2} />
                        )}
                        <text x={pos.x + dims.width / 2} y={pos.y + dims.depth / 2 + 4}
                          textAnchor="middle" fontSize={9} fill="#1E3A8A"
                          fontFamily="ui-sans-serif,sans-serif">
                          {roomName}
                        </text>
                      </g>
                    );
                  })}
                  {/* Building label + hint */}
                  <text x={(bMinX + bMaxX) / 2} y={bMinY - 14} textAnchor="middle" fontSize={10}
                    fill="#2563EB" fontFamily="ui-sans-serif,sans-serif" fontWeight={700}>
                    {bld.label}
                  </text>
                  <text x={(bMinX + bMaxX) / 2} y={bMaxY + 16} textAnchor="middle" fontSize={7.5}
                    fill="#60A5FA" fontFamily="ui-sans-serif,sans-serif">
                    {locale === "en" ? "click to edit" : "点击切换编辑"}
                  </text>
                </g>
              );
            })}

            {/* ── Ghost floor overlays — non-active floors shown semi-transparently ── */}
            {exterior.floors > 1 && Array.from({ length: exterior.floors }, (_, fi) => {
              if (fi === activeFloor) return null;
              if (!ghostFloors.has(fi)) return null;
              const fp = allFloorPlans[fi];
              if (!fp) return null;
              const ghostRooms = (fp.enabledRooms ?? []).filter(r => !ROOM_DEFS[r].isOutdoor);
              const ghostColors = ["#2563EB", "#7C3AED", "#059669", "#D97706"];
              const gc = ghostColors[fi % ghostColors.length];
              return (
                <g key={`ghost-${fi}`} style={{ pointerEvents: "none" }}>
                  {ghostRooms.map(room => {
                    const pos  = fp.roomLayout?.[room];
                    const dims = fp.roomDimensions?.[room];
                    if (!pos || !dims) return null;
                    const { x, y } = pos;
                    const { width: w, depth: d } = dims;
                    const shape = fp.roomShapes?.[room];
                    const isPolygon = shape && shape.preset !== "rect";
                    const polyPts = isPolygon
                      ? shape!.points.map(([px, pz]) => `${x + px},${y + pz}`).join(" ")
                      : "";
                    return (
                      <g key={room}>
                        {isPolygon ? (
                          <polygon points={polyPts}
                            fill={gc} fillOpacity={0.12}
                            stroke={gc} strokeWidth={1.5} strokeOpacity={0.55}
                            strokeDasharray="6 3" />
                        ) : (
                          <rect x={x} y={y} width={w} height={d}
                            fill={gc} fillOpacity={0.12}
                            stroke={gc} strokeWidth={1.5} strokeOpacity={0.55}
                            strokeDasharray="6 3" />
                        )}
                        <text
                          x={x + w / 2} y={y + d / 2 - 8}
                          textAnchor="middle" dominantBaseline="middle"
                          fontSize={Math.min(w, d) * 0.075}
                          fill={gc} fillOpacity={0.7} fontWeight="600"
                        >
                          {fi + 1}F·{ROOM_DEFS[room]?.name ?? room}
                        </text>
                        <text
                          x={x + w / 2} y={y + d / 2 + Math.min(w, d) * 0.08}
                          textAnchor="middle" dominantBaseline="middle"
                          fontSize={Math.min(w, d) * 0.060}
                          fill={gc} fillOpacity={0.55}
                        >
                          {(w / 100).toFixed(1)}×{(d / 100).toFixed(1)}m
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}

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
              // Render as polygon for any non-rect preset, OR a rect-preset room that
              // has been shape-initialized (points exist) and the user is actively editing it.
              const isPolygon = shape && (shape.preset !== "rect" || shapeEditRoom === room);
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
                      fill={(rooms[room] ?? {materials:{}}).materials?.floor?.color ?? def.defaultFloorColor}
                      opacity={0.93}
                      style={{ pointerEvents: "none" }}
                    />
                  ) : (
                    <rect
                      x={x + WALL} y={y + WALL}
                      width={w - WALL*2} height={d - WALL*2}
                      fill={(rooms[room] ?? {materials:{}}).materials?.floor?.color ?? def.defaultFloorColor}
                      opacity={0.93}
                      style={{ pointerEvents: "none" }}
                    />
                  )}
                  {/* Window indicators */}
                  {(roomWindows[room] ?? []).map(win => {
                    const s2 = w / (roomDimensions[room].width);
                    const s3 = d / (roomDimensions[room].depth);
                    if (win.wall === "N") {
                      const wx = x + win.pos * s2, ww = win.len * s2;
                      return <rect key={win.id} x={wx} y={y + 2} width={ww} height={6} fill="#7DD3FC" opacity={0.6} rx={2} style={{ pointerEvents: "none" }} />;
                    }
                    if (win.wall === "S") {
                      const wx = x + win.pos * s2, ww = win.len * s2;
                      return <rect key={win.id} x={wx} y={y + d - 8} width={ww} height={6} fill="#7DD3FC" opacity={0.6} rx={2} style={{ pointerEvents: "none" }} />;
                    }
                    if (win.wall === "E") {
                      const wy = y + win.pos * s3, wh = win.len * s3;
                      return <rect key={win.id} x={x + w - 8} y={wy} width={6} height={wh} fill="#7DD3FC" opacity={0.6} rx={2} style={{ pointerEvents: "none" }} />;
                    }
                    if (win.wall === "W") {
                      const wy = y + win.pos * s3, wh = win.len * s3;
                      return <rect key={win.id} x={x + 2} y={wy} width={6} height={wh} fill="#7DD3FC" opacity={0.6} rx={2} style={{ pointerEvents: "none" }} />;
                    }
                    return null;
                  })}

                  {/* ── DEBUG: per-room NSWE wall labels (code convention) ── */}
                  {(() => {
                    const fs = Math.max(10, Math.min(20, Math.min(w, d) * 0.10));
                    const inset = Math.max(6, fs * 0.7);
                    const nswe = [
                      { x: x + w / 2,        y: y + inset,         t: "N" },
                      { x: x + w / 2,        y: y + d - inset,     t: "S" },
                      { x: x + inset,        y: y + d / 2,         t: "W" },
                      { x: x + w - inset,    y: y + d / 2,         t: "E" },
                    ];
                    return nswe.map((l, i) => (
                      <text key={`nswe-${room}-${i}`} x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle"
                        fontSize={fs} fontWeight={900} fill="#FF1493" stroke="#FFFFFF" strokeWidth={2}
                        paintOrder="stroke" style={{ pointerEvents: "none", userSelect: "none" }}>
                        {l.t}
                      </text>
                    ));
                  })()}

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
                  {(rooms[room]?.placedItems ?? []).map(p => {
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

                  {/* Delete — bottom-left */}
                  <g style={{ cursor: "pointer" }}
                    onPointerDown={e => {
                      e.stopPropagation();
                      const roomName = customRoomDisplayName(customRoomMeta[room], locale) ?? t.roomNames[room] ?? ROOM_DEFS[room].name;
                      void confirmDialog(t.fpRoomDeleteConfirm(roomName)).then(ok => {
                        if (!ok) return;
                        pushLayoutHistory();
                        removeRoom(room);
                      });
                    }}>
                    <rect x={x + WALL} y={y + d - WALL - HANDLE}
                      width={HANDLE} height={HANDLE}
                      fill="#EF4444" opacity={0.82} rx={4} />
                    <text x={x + WALL + HANDLE/2} y={y + d - WALL - HANDLE/2}
                      textAnchor="middle" dominantBaseline="middle"
                      fontSize={HANDLE * 0.7} fill="white" fontWeight="bold"
                      style={{ pointerEvents: "none", userSelect: "none" }}>✕</text>
                  </g>


                  {/* Edit shape — bottom-center (toggle vertex edit mode) */}
                  {(() => {
                    const isEditing = shapeEditRoom === room;
                    const btnW = 52, btnH = HANDLE;
                    const btnX = x + w / 2 - btnW / 2;
                    const btnY = y + d - WALL - btnH;
                    return (
                      <g style={{ cursor: "pointer" }}
                        onPointerDown={e => {
                          e.stopPropagation();
                          if (isEditing) {
                            setShapeEditRoom(null);
                          } else {
                            // Init rect polygon if no custom shape yet
                            if (!roomShapes?.[room] || roomShapes[room].preset === "rect") {
                              setRoomShape(room, "rect");
                            }
                            setShapeEditRoom(room);
                          }
                        }}>
                        <rect x={btnX} y={btnY} width={btnW} height={btnH}
                          fill={isEditing ? "#F59E0B" : "#7C3AED"} opacity={0.88} rx={4} />
                        <text x={btnX + btnW/2} y={btnY + btnH/2}
                          textAnchor="middle" dominantBaseline="middle"
                          fontSize={btnH * 0.5} fill="white" fontWeight="bold"
                          style={{ pointerEvents: "none", userSelect: "none" }}>
                          {isEditing ? (locale === "en" ? "Done" : "完成") : (locale === "en" ? "Edit outline" : "编辑轮廓")}
                        </text>
                      </g>
                    );
                  })()}
                </g>
              );
            })}

            {/* Ruler tool overlay: first point + rubber-band line */}
            {tool === "ruler" && rulerPt && (
              <g style={{ pointerEvents: "none" }}>
                <circle cx={rulerPt.x} cy={rulerPt.y} r={6} fill="#0EA5E9" />
                {drawHover && (
                  <>
                    <line x1={rulerPt.x} y1={rulerPt.y} x2={drawHover.x} y2={drawHover.y}
                      stroke="#0EA5E9" strokeWidth={3} strokeDasharray="6 4" />
                    <circle cx={drawHover.x} cy={drawHover.y} r={4} fill="#fff" stroke="#0EA5E9" strokeWidth={2} />
                    <text x={(rulerPt.x + drawHover.x) / 2} y={(rulerPt.y + drawHover.y) / 2 - 10}
                      textAnchor="middle" fontSize={16} fontWeight={700} fill="#0EA5E9"
                      paintOrder="stroke" stroke="white" strokeWidth={4} strokeLinejoin="round">
                      {(Math.hypot(drawHover.x - rulerPt.x, drawHover.y - rulerPt.y) / 100).toFixed(2)}m
                    </text>
                  </>
                )}
              </g>
            )}

            {/* Draw tool overlay: accumulated polygon + rubber-band line */}
            {tool === "draw" && drawPts.length > 0 && (
              <g style={{ pointerEvents: "none" }}>
                <polyline
                  points={drawPts.map(([x, y]) => `${x},${y}`).join(" ") +
                    (drawHover ? ` ${drawHover.x},${drawHover.y}` : "")}
                  fill="rgba(16,185,129,0.15)"
                  stroke="#10B981" strokeWidth={3} strokeLinejoin="round" strokeDasharray="0"
                />
                {drawPts.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={6} fill="#10B981" stroke="white" strokeWidth={2} />
                ))}
                {drawHover && (
                  <circle cx={drawHover.x} cy={drawHover.y} r={4} fill="#fff" stroke="#10B981" strokeWidth={2} />
                )}
              </g>
            )}

            {/* Pass 3: shape-edit vertex handles for shapeEditRoom */}
            {shapeEditRoom && roomShapes?.[shapeEditRoom] && (() => {
              const room = shapeEditRoom;
              const pos  = roomLayout[room];
              const shape = roomShapes[room]!;
              return (
                <g>
                  {/* Highlight outline of the edited room */}
                  <polygon
                    points={shape.points.map(([px, pz]) => `${pos.x + px},${pos.y + pz}`).join(" ")}
                    fill="none"
                    stroke="#F59E0B" strokeWidth={3} strokeDasharray="8 4" strokeLinejoin="round"
                    style={{ pointerEvents: "none" }}
                  />
                  {shape.points.map(([px, pz], i) => {
                    const next = (i + 1) % shape.points.length;
                    const [nx, nz] = shape.points[next];
                    const midLocalX = (px + nx) / 2, midLocalZ = (pz + nz) / 2;
                    const ax = pos.x + px,  ay = pos.y + pz;
                    const mx = pos.x + midLocalX, my = pos.y + midLocalZ;
                    return (
                      <g key={`sv-${i}`}>
                        {/* Vertex drag handle */}
                        <circle cx={ax} cy={ay} r={10} fill="#F59E0B" stroke="white" strokeWidth={2.5}
                          style={{ cursor: "move" }}
                          onPointerDown={e => {
                            e.stopPropagation();
                            if (!svgRef.current) return;
                            svgRef.current.setPointerCapture(e.pointerId);
                            pushLayoutHistory();
                            const onMove = (ev: PointerEvent) => {
                              if (!svgRef.current) return;
                              const pt2 = getSVGPoint(ev, svgRef.current);
                              updateRoomShapePoint(room, i, pt2.x - pos.x, pt2.y - pos.y);
                            };
                            const onUp = () => {
                              window.removeEventListener("pointermove", onMove);
                              window.removeEventListener("pointerup", onUp);
                            };
                            window.addEventListener("pointermove", onMove);
                            window.addEventListener("pointerup", onUp, { once: true });
                          }}
                          onContextMenu={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (shape.points.length <= 3) return; // keep at least a triangle
                            pushLayoutHistory();
                            deleteRoomShapePoint(room, i);
                          }}
                        />
                        {/* Edge midpoint — insert vertex */}
                        <polygon
                          points={`${mx},${my - 8} ${mx + 8},${my} ${mx},${my + 8} ${mx - 8},${my}`}
                          fill="#FDE68A" stroke="#F59E0B" strokeWidth={2}
                          style={{ cursor: "copy" }}
                          onClick={e => {
                            e.stopPropagation();
                            pushLayoutHistory();
                            insertRoomShapePoint(room, i, midLocalX, midLocalZ);
                          }}
                        />
                      </g>
                    );
                  })}
                  {/* Reset to rectangle */}
                  {(() => {
                    const dims = roomDimensions[room];
                    const bx = pos.x + dims.width / 2 - 36, by = pos.y - 36;
                    return (
                      <g style={{ cursor: "pointer" }}
                        onClick={e => {
                          e.stopPropagation();
                          pushLayoutHistory();
                          setRoomShape(room, "rect");
                          setShapeEditRoom(null);
                        }}>
                        <rect x={bx} y={by} width={72} height={26} rx={6}
                          fill="rgba(239,68,68,0.88)" />
                        <text x={bx + 36} y={by + 13} textAnchor="middle" dominantBaseline="middle"
                          fontSize={13} fill="white" fontWeight="bold"
                          style={{ pointerEvents: "none", userSelect: "none" }}>{locale === "en" ? "Reset rect" : "重置矩形"}</text>
                      </g>
                    );
                  })()}
                </g>
              );
            })()}

            {/* ── Fallback stair symbol — clickable shortcut to add a stair room ── */}
            {exterior.floors > 1 && visibleRooms.length > 0 && !visibleRooms.includes("stair") && (() => {
              // Position just inside the right edge of the viewBox so it's always visible
              const symW = 80;
              const symD = 100;
              const symX = vbX2 - symW - 12;
              const symY = vbY1 + pad;
              const steps = 8;
              const stepH = symD / steps;
              return (
                <g
                  style={{ cursor: "pointer" }}
                  onPointerDown={e => {
                    e.stopPropagation();
                    pushLayoutHistory();
                    addRoom2("stair");
                  }}
                >
                  {/* Clickable background hit area */}
                  <rect x={symX - 4} y={symY - 4} width={symW + 8} height={symD + 60}
                    fill="transparent" />
                  {/* Outline box */}
                  <rect x={symX} y={symY} width={symW} height={symD}
                    fill="rgba(253,230,138,0.35)" stroke="#B45309" strokeWidth={2.5} rx={4} />
                  {/* Tread lines */}
                  {Array.from({ length: steps - 1 }, (_, i) => (
                    <line key={i}
                      x1={symX} y1={symY + stepH * (i + 1)}
                      x2={symX + symW} y2={symY + stepH * (i + 1)}
                      stroke="#B45309" strokeWidth={1.5} />
                  ))}
                  {/* Direction arrow */}
                  <line x1={symX + symW * 0.5} y1={symY + symD - 8}
                    x2={symX + symW * 0.5} y2={symY + 12}
                    stroke="#B45309" strokeWidth={2} />
                  <polygon
                    points={`${symX + symW * 0.5 - 6},${symY + 16} ${symX + symW * 0.5 + 6},${symY + 16} ${symX + symW * 0.5},${symY + 4}`}
                    fill="#B45309" />
                  {/* "+ 添加楼梯" label */}
                  <rect x={symX} y={symY + symD + 6} width={symW} height={22}
                    fill="#D97706" rx={4} />
                  <text x={symX + symW / 2} y={symY + symD + 17}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={13} fill="white" fontWeight="bold"
                    fontFamily="system-ui"
                    style={{ pointerEvents: "none", userSelect: "none" }}>{locale === "en" ? "+ Add stairs" : "+ 添加楼梯"}</text>
                  <text x={symX + symW / 2} y={symY + symD + 42}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={12} fill="#92400E"
                    fontFamily="system-ui"
                    style={{ pointerEvents: "none", userSelect: "none" }}>{locale === "en" ? "Stairwell" : "楼梯间"}</text>
                </g>
              );
            })()}

            {/* Compass hidden per user request. */}
            {false && (
              <g transform={`translate(${vbX2 - 60}, ${vbY2 - 80})`}>
                <circle r={36} fill="white" fillOpacity={0.92} stroke="#D1D5DB" strokeWidth={2} />
                <text textAnchor="middle" y={-14} fontSize={20} fontWeight="bold" fill="#1F2937" fontFamily="system-ui">N</text>
                <text textAnchor="middle" y={24}  fontSize={16} fill="#9CA3AF" fontFamily="system-ui">S</text>
                <text textAnchor="start"  x={9}   y={6} fontSize={16} fill="#9CA3AF" fontFamily="system-ui">E</text>
                <text textAnchor="end"    x={-9}  y={6} fontSize={16} fill="#9CA3AF" fontFamily="system-ui">W</text>
              </g>
            )}

            {/* Scale ruler */}
            <g transform={`translate(${vbX1 + 20}, ${vbY2 - 50})`}>
              <rect width={100} height={9}  fill="#374151" rx={2} />
              <rect x={100}    width={100} height={9}  fill="#6B7280" rx={2} />
              {[0,100,200].map(x => <line key={x} x1={x} y1={0} x2={x} y2={18} stroke="#374151" strokeWidth={2.5} />)}
              {[{x:0,t:"0"},{x:100,t:"1m"},{x:200,t:"2m"}].map(({x,t})=>(
                <text key={t} x={x} y={34} textAnchor="middle" fontSize={17} fill="#374151" fontFamily="system-ui">{t}</text>
              ))}
            </g>

            {/* ── DEBUG: NWES direction labels — commented out for production.
                 Re-enable to debug coord directions in 全局图 (2D). ── */}
            {/* {(() => {
              const cx = (vbX1 + vbX2) / 2;
              const cy = (vbY1 + vbY2) / 2;
              const fs = 56;
              const labels = [
                { x: cx, y: vbY1 + 40, t: "N (small Y / top of plan)" },
                { x: cx, y: vbY2 - 10, t: "S (large Y / bottom of plan)" },
                { x: vbX1 + 40, y: cy, t: "W (small X)" },
                { x: vbX2 - 40, y: cy, t: "E (large X)" },
              ];
              return labels.map((l, i) => (
                <text key={i} x={l.x} y={l.y}
                  textAnchor={l.x === vbX2 - 40 ? "end" : (l.x === vbX1 + 40 ? "start" : "middle")}
                  fontSize={fs} fontWeight={900} fill="#FF1493" stroke="#FFFFFF" strokeWidth={4}
                  paintOrder="stroke" style={{ pointerEvents: "none", userSelect: "none" }}>
                  {l.t}
                </text>
              ));
            })()} */}
          </svg>
          </div>

          {/* Zoom controls — floating bottom-right, 抬到 AI 渲染 FAB（bottom-4 right-4）上方避免重叠，
              与 HouseCanvas 的缩放列同一约定（让出右下角给全局 AI 入口）。 */}
          <div className="absolute bottom-16 right-3 flex items-center rounded-xl shadow-md bg-white border border-gray-200 overflow-hidden">
            <button onClick={() => setZoomLevel(p => Math.max(0.3, p * 0.8))}
              className="px-2 py-1 text-gray-500 hover:text-gray-800 hover:bg-gray-50 text-sm font-bold"
              style={{ minWidth: 28 }}>−</button>
            <span className="text-[10px] text-gray-500 px-2 font-mono min-w-[40px] text-center border-x border-gray-200">{Math.round(zoomLevel * 100)}%</span>
            <button onClick={() => setZoomLevel(p => Math.min(5, p * 1.25))}
              className="px-2 py-1 text-gray-500 hover:text-gray-800 hover:bg-gray-50 text-sm font-bold"
              style={{ minWidth: 28 }}>＋</button>
            <button onClick={() => setZoomLevel(1)}
              className="px-2 py-1 text-gray-400 hover:text-gray-700 text-[10px] border-l border-gray-200">{t.fpZoomReset}</button>
          </div>
        </div>}
      </div>

      {/* In-app dialog (prompt/confirm/alert replacement) */}
      {dialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
          onClick={() => {
            if (dialog.type === "prompt")  { dialog.resolve(null); setDialog(null); }
            if (dialog.type === "confirm") { dialog.resolve(false); setDialog(null); }
            if (dialog.type === "alert")   { dialog.resolve(); setDialog(null); }
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl p-5 w-[92vw] max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="text-sm font-bold text-gray-800 mb-3">{dialog.title}</div>
            {dialog.type === "prompt" && (
              <input
                autoFocus
                value={dialogInput}
                onChange={e => setDialogInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { dialog.resolve(dialogInput); setDialog(null); }
                  if (e.key === "Escape") { dialog.resolve(null); setDialog(null); }
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 mb-3"
              />
            )}
            <div className="flex gap-2 justify-end">
              {(dialog.type === "prompt" || dialog.type === "confirm") && (
                <button onClick={() => {
                  if (dialog.type === "prompt")  dialog.resolve(null);
                  if (dialog.type === "confirm") dialog.resolve(false);
                  setDialog(null);
                }}
                  className="px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-100 rounded-lg"
                >{t.fpCancel}</button>
              )}
              <button onClick={() => {
                if (dialog.type === "prompt")  dialog.resolve(dialogInput);
                if (dialog.type === "confirm") dialog.resolve(true);
                if (dialog.type === "alert")   dialog.resolve();
                setDialog(null);
              }}
                className="px-3 py-1.5 text-xs font-bold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >{t.fpConfirm}</button>
            </div>
          </div>
        </div>
      )}

      {/* Layout picker modal */}
      {layoutPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setLayoutPickerOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-5 max-w-3xl w-[92vw] max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center mb-3">
              <h3 className="text-base font-black text-gray-800">{t.fpHouseTemplateModalTitle}</h3>
              <button onClick={() => setLayoutPickerOpen(false)}
                className="ml-auto text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
            </div>
            <p className="text-[11px] text-gray-500 mb-3">
              {t.fpHouseTemplateDesc}
            </p>

            {/* ── AI 文字生成设计 ── */}
            <div className="mb-4 p-3 rounded-xl" style={{ background: "linear-gradient(135deg,#EFF6FF,#F0FDF4)" }}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-sm">✨</span>
                <span className="text-[11px] font-bold text-blue-700">{locale === "en" ? "AI Smart Design" : "AI 智能设计"}</span>
                <span className="text-[9px] text-blue-400 bg-blue-50 px-2 py-0.5 rounded-full">{locale === "en" ? "Describe needs, auto-generate floor plan + exterior" : "描述需求，自动生成平面图 + 外观"}</span>
              </div>
              <div className="flex gap-2">
                <textarea
                  className="flex-1 text-[11px] rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 resize-none outline-none focus:border-blue-400 placeholder-gray-400 text-gray-700"
                  rows={2}
                  placeholder={locale === "en" ? "e.g. 3 bed 2 living 2 bath, 120㎡, south-facing master with ensuite, modern minimal style, garage needed" : "例如：三室两厅两卫，120㎡，主卧朝南带卫生间，现代简约风，需要车库"}
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleAiGenerate(); }}
                  disabled={aiLoading}
                />
                <button
                  onClick={handleAiGenerate}
                  disabled={aiLoading || !aiInput.trim()}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#3B82F6,#10B981)" }}
                >
                  {aiLoading ? (locale === "en" ? "Generating…" : "生成中…") : (locale === "en" ? "Generate" : "生成")}
                </button>
              </div>
              {aiError   && <p className="mt-1.5 text-[10px] text-red-500">⚠ {aiError}</p>}
              {aiSummary && <p className="mt-1.5 text-[10px] text-green-600">✅ {aiSummary}</p>}
              <p className="mt-1.5 text-[9px] text-gray-400">{locale === "en" ? "Ctrl+Enter to generate quickly · supports Chinese descriptions" : "Ctrl+Enter 快速生成 · 支持中文描述"}</p>
            </div>
            <div className="border-t border-gray-200 mb-3" />

            {/* ── 别墅项目模板 (multi-floor + yard) ── */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">✨ {locale === "en" ? "Villa Project Templates" : "别墅项目模板"}</div>
                <div className="text-[9px] text-gray-400 bg-indigo-50 px-2 py-0.5 rounded-full">{locale === "en" ? "Two floors + exterior + yard, one-click load" : "双层 + 外观 + 院子一键加载"}</div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                {PROJECT_TEMPLATES.map(tpl => (
                  <button key={tpl.id}
                    onClick={() => {
                      confirmDialog(locale === "en" ? `Loading "${tpl.nameEn}" will replace all floor plans, exterior settings and yard layout. Continue?` : `加载「${tpl.name}」将替换所有楼层平面图、外观设置和院子布局，确认吗？`).then(ok => {
                        if (!ok) return;
                        applyProjectTemplate(tpl.id);
                        setLayoutPickerOpen(false);
                        setViewMode("exterior");
                      });
                    }}
                    className="flex flex-col gap-1.5 p-3 rounded-xl border-2 hover:border-indigo-400 hover:bg-indigo-50 transition-all text-left"
                    style={{ borderColor: "#C7D2FE", background: "linear-gradient(135deg,#F5F3FF,#EEF2FF)" }}
                  >
                    {/* Palette strip */}
                    <div className="w-full h-4 rounded-md overflow-hidden flex gap-px">
                      <div className="flex-1" style={{ background: tpl.palette[0] }} />
                      <div className="w-5"   style={{ background: tpl.palette[1] }} />
                      <div className="w-3"   style={{ background: tpl.palette[2] }} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-lg">{tpl.emoji}</span>
                      <div>
                        <div className="text-[11px] font-bold text-gray-800">{locale === "en" ? tpl.nameEn : tpl.name}</div>
                        <div className="text-[9px] text-gray-500">{tpl.areaSqm}㎡ · {tpl.floorLayouts.length}{locale === "en" ? "F" : "层"}</div>
                      </div>
                    </div>
                    <div className="text-[9px] text-indigo-600 leading-relaxed">{locale === "en" ? tpl.descriptionEn : tpl.description}</div>
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-200 mb-3" />
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">📐 {locale === "en" ? "Single-floor layouts" : "单层平面户型"}</div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {FLOORPLAN_LAYOUTS.map(layout => {
                // Compute preview bbox for the thumbnail
                const xs = layout.rooms.flatMap(r => [r.x, r.x + r.width]);
                const ys = layout.rooms.flatMap(r => [r.y, r.y + r.depth]);
                const minX = Math.min(...xs), maxX = Math.max(...xs);
                const minY = Math.min(...ys), maxY = Math.max(...ys);
                const pw = maxX - minX, ph = maxY - minY;
                return (
                  <button key={layout.id}
                    onClick={() => {
                      confirmDialog(t.fpHouseTemplateConfirm(localizeLayoutName(layout, locale))).then(ok => {
                        if (!ok) return;
                        pushLayoutHistory();
                        applyFloorplanLayout(layout.id);
                        setLayoutPickerOpen(false);
                      });
                    }}
                    className="flex flex-col gap-2 p-3 rounded-xl border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-all text-left"
                  >
                    <svg viewBox={`${minX - 20} ${minY - 20} ${pw + 40} ${ph + 40}`}
                      className="w-full aspect-[5/4] bg-gray-100 rounded-lg">
                      {layout.rooms.map((r, i) => {
                        const isPoly = r.shape && r.shape.preset !== "rect";
                        return isPoly ? (
                          <polygon key={i}
                            points={r.shape!.points.map(([x, y]) => `${r.x + x},${r.y + y}`).join(" ")}
                            fill="#E0E7FF" stroke="#6366F1" strokeWidth={6} strokeLinejoin="round"
                          />
                        ) : (
                          <rect key={i} x={r.x} y={r.y} width={r.width} height={r.depth}
                            fill="#E0E7FF" stroke="#6366F1" strokeWidth={6} />
                        );
                      })}
                      {layout.rooms.map((r, i) => (
                        <text key={`t-${i}`} x={r.x + r.width / 2} y={r.y + r.depth / 2}
                          textAnchor="middle" dominantBaseline="middle"
                          fontSize={Math.min(r.width, r.depth) * 0.18}
                          fill="#4338CA" fontFamily="system-ui" fontWeight="700">
                          {ROOM_DEFS[r.room].icon}
                        </text>
                      ))}
                    </svg>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-bold text-gray-800">{localizeLayoutName(layout, locale)}</span>
                      <span className="text-[10px] text-gray-500 ml-auto">{t.fpRoomCount(layout.rooms.length)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
