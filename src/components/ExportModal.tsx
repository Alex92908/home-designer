"use client";

import { useEffect, useState, useCallback } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, getRoomArea, RoomType } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { generatePdf, generateAllRoomsPdf } from "@/lib/exportPdf";
import { useT, useLocale } from "@/lib/i18n";
import { getFurnitureNameEn, getMaterialNameEn, getBrandNameEn } from "@/locales/itemNames";
import { formatPrice } from "@/lib/currency";
import {
  generateRoomPrompt,
  generateBatchWorkflow,
  type GeneratedPrompt,
  type RoomPromptInput,
} from "@/lib/roomPrompt";

function ScoreBar({ val, color }: { val: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${val}%`, background: color }} />
      </div>
      <span className="text-xs font-bold w-6 text-right" style={{ color }}>{val}</span>
    </div>
  );
}

// ─── Per-room cost row ────────────────────────────────────────
function RoomCostRow({ room, cost }: { room: RoomType; cost: number }) {
  const def = ROOM_DEFS[room];
  const t = useT();
  const locale = useLocale();
  const setActiveRoom = useDesignerStore(s => s.setActiveRoom);
  const setViewMode   = useDesignerStore(s => s.setViewMode);
  if (cost === 0) return null;
  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
      onClick={() => { setActiveRoom(room); setViewMode("2d"); }}>
      <td className="py-1.5 text-xs font-medium text-gray-800">{def.icon} {t.roomNames[room] ?? def.name}</td>
      <td className="py-1.5 text-right text-xs font-bold text-gray-700">{formatPrice(cost, locale)}</td>
    </tr>
  );
}

export default function ExportModal() {
  const [open, setOpen]           = useState(false);
  const [tab, setTab]             = useState<"current" | "all" | "data" | "ai">("current");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [email, setEmail]         = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const t = useT();
  const locale = useLocale();

  const activeRoom      = useDesignerStore(s => s.activeRoom);
  const floorPlans      = useDesignerStore(s => s.floorPlans);
  const rooms           = useDesignerStore(s => s.floorPlans[s.activeFloor].rooms);
  const enabledRooms    = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const scores          = useDesignerStore(s => s.scores);
  const exterior        = useDesignerStore(s => s.exterior);
  const budget          = useDesignerStore(s => s.budget);
  const customRoomMeta  = useDesignerStore(s => s.customRoomMeta);
  const customFurniture = useDesignerStore(s => s.customFurniture);
  const blueprint       = useDesignerStore(s => s.blueprint);
  const resetAll        = useDesignerStore(s => s.resetAll);
  const wipeAll         = useDesignerStore(s => s.wipeAll);
  const loadFromShare   = useDesignerStore(s => s.loadFromShare);
  const roomDimensions  = useDesignerStore(s => s.floorPlans[s.activeFloor].roomDimensions);
  const roomWindows     = useDesignerStore(s => s.floorPlans[s.activeFloor].roomWindows);

  const roomState  = rooms[activeRoom];
  const def        = ROOM_DEFS[activeRoom];
  const area       = getRoomArea(activeRoom);
  const { materials, placedItems } = roomState;
  const materialItems = Object.values(materials).filter(Boolean) as NonNullable<typeof materials.wall>[];

  // Current-floor room costs (for display in "all" tab)
  const roomCosts = enabledRooms.map(r => {
    const rs = rooms[r];
    const a  = getRoomArea(r);
    let c = 0;
    if (rs.materials.wall)    c += rs.materials.wall.price * a.wall;
    if (rs.materials.floor)   c += rs.materials.floor.price * a.floor;
    if (rs.materials.ceiling) c += rs.materials.ceiling.price * a.floor;
    if (rs.materials.tile)    c += rs.materials.tile.price * a.floor;
    if (rs.materials.light)   c += rs.materials.light.price * (rs.materials.light.id === "light-spot" ? 8 : 1);
    for (const p of rs.placedItems) { const f = getFurnitureById(p.furnitureId); if (f) c += f.price; }
    return { room: r, cost: c };
  });
  // Sum across ALL floors for totals
  const totalAllCost = floorPlans.reduce((sum, fp) =>
    sum + fp.enabledRooms.reduce((s2, r) => {
      const rs = fp.rooms[r];
      const a = getRoomArea(r);
      let c = 0;
      if (rs.materials.wall)    c += rs.materials.wall.price * a.wall;
      if (rs.materials.floor)   c += rs.materials.floor.price * a.floor;
      if (rs.materials.ceiling) c += rs.materials.ceiling.price * a.floor;
      if (rs.materials.tile)    c += rs.materials.tile.price * a.floor;
      if (rs.materials.light)   c += rs.materials.light.price * (rs.materials.light.id === "light-spot" ? 8 : 1);
      for (const p of rs.placedItems) { const f = getFurnitureById(p.furnitureId); if (f) c += f.price; }
      return s2 + c;
    }, 0)
  , 0);
  const currentRoomCost = roomCosts.find(r => r.room === activeRoom)?.cost ?? 0;

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("openExport", handler);
    return () => window.removeEventListener("openExport", handler);
  }, []);

  if (!open) return null;

  const close = () => { setOpen(false); setSubmitted(false); setEmail(""); };

  const handleExportPdf = async () => {
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!isValidEmail) return;
    setExporting(true);
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "";
    fetch(`${apiBase}/api/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source: "export-modal" }),
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 300));
    generatePdf({ room: activeRoom, items: materialItems, placedItems, totalCost: currentRoomCost, scores, phone: email, locale });
    setSubmitted(true);
    setExporting(false);
  };

  const handleQuickView = () => {
    generatePdf({ room: activeRoom, items: materialItems, placedItems, totalCost: currentRoomCost, scores, phone: "guest", locale });
  };

  const handleExportAllPdf = () => {
    // Collect room details from all floors
    const roomDetails = floorPlans.flatMap((fp, floorIndex) =>
      fp.enabledRooms.map(r => {
        const a = getRoomArea(r);
        const rs = fp.rooms[r];
        let c = 0;
        if (rs.materials.wall)    c += rs.materials.wall.price * a.wall;
        if (rs.materials.floor)   c += rs.materials.floor.price * a.floor;
        if (rs.materials.ceiling) c += rs.materials.ceiling.price * a.floor;
        if (rs.materials.tile)    c += rs.materials.tile.price * a.floor;
        if (rs.materials.light)   c += rs.materials.light.price * (rs.materials.light.id === "light-spot" ? 8 : 1);
        for (const p of rs.placedItems) { const f = getFurnitureById(p.furnitureId); if (f) c += f.price; }
        return {
          room: r,
          cost: c,
          materials: Object.values(rs.materials).filter(Boolean) as NonNullable<typeof rs["materials"]["wall"]>[],
          placedItems: rs.placedItems,
          floorIndex,
        };
      })
    );
    generateAllRoomsPdf({ roomDetails, totalCost: totalAllCost, budget, locale, phone: "guest" }, "room");
  };

  // ─── Save/load JSON ───────────────────────────────────────
  // Coordinate convention in exported JSON:
  //   x, z = TOP-LEFT corner of the furniture item (cm from room's back-left corner)
  //   rotation, scaleW, scaleD unchanged
  // Internally the store uses CENTER coordinates; we convert on save/load.

  const handleSaveJson = () => {
    // Convert placed items center → top-left for all floors
    const exportFloorPlans = floorPlans.map(fp => ({
      ...fp,
      rooms: Object.fromEntries(
        Object.entries(fp.rooms).map(([roomId, roomState]) => {
          const convertedItems = roomState.placedItems.map(p => {
            const f = getFurnitureById(p.furnitureId);
            if (!f) return p;
            const hw = (f.width  * (p.scaleW ?? 1)) / 2;
            const hd = (f.depth  * (p.scaleD ?? 1)) / 2;
            return { ...p, x: p.x - hw, z: p.z - hd };
          });
          return [roomId, { ...roomState, placedItems: convertedItems }];
        })
      ),
    }));
    const data = {
      _version: 2,
      _coordSystem: "top-left",
      floorPlans: exportFloorPlans,
      exterior,
      budget,
      customRoomMeta,
      customFurniture,
      scores,
      blueprint,
      savedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    {
      const stem  = locale === "en" ? "home-design" : "装修方案";
      const stamp = new Date().toLocaleDateString(locale === "en" ? "en-CA" : "zh-CN").replace(/\//g, "-");
      a.download  = `${stem}_${stamp}.json`;
    }
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadDemo = async () => {
    if (!window.confirm(locale === "en"
      ? "Load the demo plan? This will replace your current design."
      : "载入样板方案？这将替换当前设计。")) return;
    try {
      const res = await fetch("/demo-plan.json");
      const data = await res.json();
      // loadFromShare handles both old flat format { rooms, enabledRooms } and new floorPlans format
      loadFromShare(data);
      setOpen(false);
    } catch {
      alert(locale === "en" ? "Failed to load demo." : "样板加载失败，请重试。");
    }
  };

  const handleLoadJson = () => {
    const input = document.createElement("input");
    input.type  = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          const isTopLeft = data._coordSystem === "top-left";

          // Helper: convert top-left → center for a rooms map
          const convertRooms = (roomsMap: Record<string, { placedItems: Array<{furnitureId:string;x:number;z:number;scaleW?:number;scaleD?:number}> }>) => {
            if (!isTopLeft) return roomsMap;
            return Object.fromEntries(
              Object.entries(roomsMap).map(([rid, rs]) => [
                rid,
                {
                  ...rs,
                  placedItems: rs.placedItems.map(p => {
                    const f = getFurnitureById(p.furnitureId);
                    if (!f) return p;
                    return { ...p, x: p.x + (f.width  * (p.scaleW ?? 1)) / 2,
                                   z: p.z + (f.depth  * (p.scaleD ?? 1)) / 2 };
                  }),
                },
              ])
            );
          };

          // Fields shared between v2 and legacy paths. Optional in older
          // exports — fall back to current persisted values so loading an
          // old file doesn't clobber what the user already has.
          const persisted = JSON.parse(localStorage.getItem("home-designer-v2") || '{"state":{}}').state ?? {};
          const extraState = {
            customRoomMeta:  data.customRoomMeta  ?? persisted.customRoomMeta  ?? {},
            customFurniture: data.customFurniture ?? persisted.customFurniture ?? [],
            scores:          data.scores          ?? persisted.scores          ?? { style: 0, space: 0, light: 0, dominantStyle: "" },
            blueprint:       data.blueprint       ?? persisted.blueprint       ?? { image: null, naturalW: 0, naturalH: 0, opacity: 0.4, offsetX: 0, offsetY: 0, scale: 1 },
          };

          // ── New format (v2): floorPlans array ──
          if (data._version === 2 && Array.isArray(data.floorPlans)) {
            const convertedFloorPlans = data.floorPlans.map((fp: { rooms: Record<string, { placedItems: Array<{furnitureId:string;x:number;z:number;scaleW?:number;scaleD?:number}> }> }) => ({
              ...fp,
              rooms: convertRooms(fp.rooms),
            }));
            const state = {
              floorPlans: convertedFloorPlans,
              exterior: data.exterior,
              budget: data.budget,
              activeFloor: 0,
              activeRoom: data.floorPlans[0]?.enabledRooms?.[0] ?? "living",
              ...extraState,
            };
            localStorage.setItem("home-designer-v2", JSON.stringify({ state, version: 0 }));
            window.location.reload();

          // ── Legacy format (v1): single-floor rooms + enabledRooms ──
          } else if (data.rooms && data.enabledRooms) {
            const convertedRooms = convertRooms(data.rooms);
            const state = {
              floorPlans: [{
                rooms: convertedRooms,
                enabledRooms: data.enabledRooms,
                roomLayout: data.roomLayout ?? {},
                roomDimensions: data.roomDimensions ?? {},
                roomWindows: data.roomWindows ?? {},
                roomDoorPos: data.roomDoorPos ?? {},
                roomHasDoor: data.roomHasDoor ?? {},
                roomDoorWall: data.roomDoorWall ?? {},
              }],
              exterior: data.exterior,
              budget: data.budget,
              activeFloor: 0,
              activeRoom: data.enabledRooms[0] ?? "living",
              ...extraState,
            };
            localStorage.setItem("home-designer-v2", JSON.stringify({ state, version: 0 }));
            window.location.reload();
          } else {
            alert(t.invalidFile);
          }
        } catch {
          alert(t.parseError);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const hasContent = materialItems.length > 0 || placedItems.length > 0;
  const totalRooms = roomCosts.filter(r => r.cost > 0).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 text-white" style={{ background: "linear-gradient(160deg, #007AFF 0%, #5856D6 100%)" }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xl font-black">{t.exportModalTitle}</div>
              <div className="text-sm text-white/70 mt-0.5">
                {totalRooms > 0 ? `${t.exportConfigured} ${totalRooms} ${t.exportRooms}` : t.exportNotConfigured} · {new Date().toLocaleDateString(locale === "en" ? "en-US" : "zh-CN")}
              </div>
            </div>
            <div className="text-right">
              <div className="text-3xl font-black">{formatPrice(totalAllCost, locale)}</div>
              <div className="text-xs text-blue-200">{t.exportTotal}</div>
            </div>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 mt-3 flex-wrap">
            {(["current","all","data","ai"] as const).map((tabKey) => (
              <button key={tabKey} onClick={() => setTab(tabKey)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  tab === tabKey ? "bg-white text-[#007AFF]" : "text-white/70 hover:bg-white/20"
                }`}>
                {tabKey === "current" ? t.exportTabCurrent
                  : tabKey === "all"  ? t.exportTabAll
                  : tabKey === "data" ? t.exportTabData
                  : locale === "en" ? "🎨 AI Prompts" : "🎨 AI提示词"}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">

          {/* ── Current room tab ── */}
          {tab === "current" && (
            <>
              {!hasContent ? (
                <div className="text-center text-gray-400 py-8">{t.exportEmptyRoom}</div>
              ) : (
                <>
                  {/* Scores */}
                  {scores.dominantStyle && (
                    <div className="bg-blue-50 rounded-xl p-3 mb-4 border border-blue-100">
                      <div className="text-xs font-bold text-[#007AFF] mb-2">{t.exportDomStyle}{t.styleTags[scores.dominantStyle] ?? scores.dominantStyle}</div>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: t.scoreStyle, val:scores.style, color:"#3B82F6" },
                          { label: t.scoreSpace, val:scores.space,  color:"#10B981" },
                          { label: t.scoreLight, val:scores.light,  color:"#F59E0B" },
                        ].map(({ label, val, color }) => (
                          <div key={label}>
                            <div className="text-[10px] text-gray-500 mb-1">{label}</div>
                            <ScoreBar val={val} color={color} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Materials */}
                  {materialItems.length > 0 && (
                    <table className="w-full text-sm mb-4">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left pb-2 text-xs text-gray-400 font-medium">{t.exportColCategory}</th>
                          <th className="text-left pb-2 text-xs text-gray-400 font-medium">{t.exportColMaterial}</th>
                          <th className="text-right pb-2 text-xs text-gray-400 font-medium">{t.exportColQty}</th>
                          <th className="text-right pb-2 text-xs text-gray-400 font-medium">{t.exportColSubtotal}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {materialItems.map(item => {
                          const qty = item.category === "wall" ? area.wall
                                    : item.category === "floor" ? area.floor
                                    : item.id === "light-spot" ? 8 : 1;
                          const qtyStr = ["wall","floor","tile"].includes(item.category) ? `${qty}㎡`
                                       : item.id === "light-spot" ? "×8" : "×1";
                          const displayName = locale === "en" ? (getMaterialNameEn(item.id) ?? item.name) : item.name;
                          return (
                            <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-2.5 text-xs text-gray-400">{t.categoryLabels[item.category] ?? item.category}</td>
                              <td className="py-2.5">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 rounded shrink-0 border border-gray-200"
                                    style={{ background: item.texture ?? item.color }} />
                                  <div className="text-xs font-medium text-gray-800">{displayName}</div>
                                </div>
                              </td>
                              <td className="py-2.5 text-right text-xs text-gray-500">{qtyStr}</td>
                              <td className="py-2.5 text-right text-xs font-bold text-gray-800">
                                {formatPrice(item.price * qty, locale)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  {/* Furniture */}
                  {placedItems.length > 0 && (
                    <table className="w-full text-sm mb-4">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left pb-2 text-xs text-gray-400 font-medium">{t.exportColFurniture}</th>
                          <th className="text-left pb-2 text-xs text-gray-400 font-medium">{t.exportColBrand}</th>
                          <th className="text-right pb-2 text-xs text-gray-400 font-medium">{t.exportColPrice}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {placedItems.map(placed => {
                          const f = getFurnitureById(placed.furnitureId);
                          if (!f) return null;
                          const displayName = locale === "en" ? (getFurnitureNameEn(f.id) ?? f.name) : f.name;
                          return (
                            <tr key={placed.instanceId} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-2 text-xs font-medium text-gray-800">{f.icon} {displayName}</td>
                              <td className="py-2 text-xs text-gray-400">{locale === "en" ? getBrandNameEn(f.brand) : f.brand}</td>
                              <td className="py-2 text-right text-xs font-bold text-gray-800">{formatPrice(f.price, locale)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}

                  <div className="flex justify-between items-center py-2 border-t border-gray-200 mb-4">
                    <span className="text-sm font-bold text-gray-700">{t.roomNames[activeRoom] ?? def.name}{t.exportRoomTotal}</span>
                    <span className="text-xl font-black text-[#007AFF]">{formatPrice(currentRoomCost, locale)}</span>
                  </div>

                  {/* Lead capture */}
                  {!submitted ? (
                    <div className="border border-blue-100 bg-blue-50/50 rounded-xl p-4">
                      <div className="text-sm font-semibold text-gray-800 mb-1">{t.exportPdfTitle}</div>
                      <div className="text-xs text-gray-500 mb-3">{t.exportPdfDesc}</div>
                      <div className="flex gap-2">
                        <input type="email" value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder={t.exportPhonePlaceholder}
                          className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-[#007AFF] bg-white" />
                        <button onClick={handleExportPdf}
                          disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || exporting}
                          className="px-4 py-2.5 bg-[#007AFF] text-white text-sm font-bold rounded-xl hover:bg-[#0071E3] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                          {exporting ? t.exportDownloading : t.exportDownloadPdf}
                        </button>
                      </div>
                      <button onClick={handleQuickView} className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline">
                        {t.exportSkipPhone}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                        <div className="text-green-700 font-bold mb-1">{t.exportSuccess}</div>
                        <div className="text-sm text-green-600">{t.exportConsultContact} {email}</div>
                      </div>
                      {/* Designer CTA */}
                      <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-100 flex items-start gap-3">
                        <div className="text-2xl shrink-0">🏡</div>
                        <div>
                          <div className="text-sm font-bold text-gray-800 mb-0.5">{t.shareDesignerTitle}</div>
                          <div className="text-xs text-gray-500 mb-2">{t.shareDesignerDesc}</div>
                          <button
                            onClick={() => { close(); window.dispatchEvent(new CustomEvent("openShare")); }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors"
                          >
                            {t.shareDesignerBtn}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── All rooms tab ── */}
          {tab === "all" && (
            <>
              <div className="mb-3 text-xs text-gray-500">{t.exportClickRoom}</div>
              {/* Budget vs cost bar */}
              <div className="mb-4">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-500">{t.exportBudgetLabel} {formatPrice(budget, locale)}</span>
                  <span className={totalAllCost > budget ? "text-red-500 font-bold" : "text-green-600 font-bold"}>
                    {totalAllCost > budget ? t.exportOverBudget : t.exportUnderBudget}
                  </span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${totalAllCost > budget ? "bg-red-500" : "bg-green-500"}`}
                    style={{ width: `${Math.min(100, (totalAllCost / budget) * 100)}%` }} />
                </div>
              </div>

              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left pb-2 text-xs text-gray-400 font-medium">{t.exportColRoom}</th>
                    <th className="text-right pb-2 text-xs text-gray-400 font-medium">{t.exportColCost}</th>
                  </tr>
                </thead>
                <tbody>
                  {roomCosts.map(r => <RoomCostRow key={r.room} room={r.room} cost={r.cost} />)}
                </tbody>
              </table>

              {totalRooms === 0 && (
                <div className="text-center text-gray-400 py-6">{t.exportNoRooms}</div>
              )}

              <div className="flex justify-between items-center py-2 border-t border-gray-200">
                <span className="text-sm font-bold text-gray-700">{t.exportAllTotal}</span>
                <span className="text-xl font-black text-[#007AFF]">{formatPrice(totalAllCost, locale)}</span>
              </div>

              {/* Export all-rooms PDF */}
              {totalRooms > 0 && (
                <button
                  onClick={handleExportAllPdf}
                  className="w-full mt-3 py-2.5 text-sm font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                  style={{ background: "#007AFF", color: "#fff" }}
                >
                  📄 {locale === "en" ? "Export Whole House Quote (PDF)" : "导出全屋报价单 (PDF)"}
                </button>
              )}

              {/* Exterior summary */}
              <div className="mt-3 bg-gray-50 rounded-xl px-3 py-2 flex items-center gap-3">
                <span className="text-sm">🏠</span>
                <div>
                  <div className="text-xs font-semibold text-gray-700">{t.exportExteriorTitle}</div>
                  <div className="text-[10px] text-gray-400">
                    {exterior.preset === "custom" ? t.exportExteriorCustom : exterior.preset} · {exterior.floors}{t.exportExteriorFloors} · {exterior.roofStyle}{t.exportExteriorRoof}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── Data management tab ── */}
          {tab === "data" && (
            <div className="flex flex-col gap-3">
              {/* Demo plan loader */}
              <div className="rounded-xl p-4 border" style={{ background: "linear-gradient(135deg,#f0f6ff,#e8f4ff)", borderColor: "#BFD7FF" }}>
                <div className="text-sm font-bold text-gray-800 mb-1">
                  🏠 {locale === "en" ? "Load Sample Plan" : "载入样板方案"}
                </div>
                <div className="text-xs text-gray-500 mb-3">
                  {locale === "en"
                    ? "Load a fully furnished 8-room Nordic-modern demo with materials, furniture, and budget preset."
                    : "载入一套完整样板：8个房间、北欧现代风格、材料+家具全配置，可直接体验所有功能。"}
                </div>
                <button onClick={handleLoadDemo}
                  className="w-full py-2.5 text-white text-sm font-bold rounded-xl transition-colors"
                  style={{ background: "#007AFF" }}>
                  ✨ {locale === "en" ? "Load Demo Plan" : "载入样板方案"}
                </button>
              </div>

              <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
                <div className="text-sm font-bold text-gray-800 mb-1">{t.saveTitle}</div>
                <div className="text-xs text-gray-500 mb-3">{t.saveDesc}</div>
                <button onClick={handleSaveJson}
                  className="w-full py-2.5 bg-[#007AFF] text-white text-sm font-bold rounded-xl hover:bg-[#0071E3] transition-colors">
                  {t.saveBtn}
                </button>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="text-sm font-bold text-gray-800 mb-1">{t.loadTitle}</div>
                <div className="text-xs text-gray-500 mb-3">{t.loadDesc}</div>
                <button onClick={handleLoadJson}
                  className="w-full py-2.5 bg-gray-700 text-white text-sm font-bold rounded-xl hover:bg-gray-800 transition-colors">
                  {t.loadBtn}
                </button>
              </div>

              <div className="bg-orange-50 rounded-xl p-4 border border-orange-100">
                <div className="text-sm font-bold text-gray-800 mb-1">{t.autoSaveTitle}</div>
                <div className="text-xs text-gray-500 mb-2">{t.autoSaveDesc}</div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-xs text-green-700 font-semibold">{t.autoSaveStatus}</span>
                </div>
              </div>

              <div className="bg-red-50 rounded-xl p-4 border border-red-100">
                <div className="text-sm font-bold text-gray-800 mb-1">{t.resetTitle}</div>
                <div className="text-xs text-gray-500 mb-3">{t.resetDesc}</div>
                {confirmReset ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => { resetAll(); setConfirmReset(false); close(); }}
                      className="flex-1 py-2.5 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 transition-colors"
                    >
                      {t.resetConfirmInline}
                    </button>
                    <button
                      onClick={() => setConfirmReset(false)}
                      className="px-4 py-2.5 bg-white text-gray-600 text-sm font-bold rounded-xl border border-gray-200 hover:bg-gray-50"
                    >
                      {t.wipeCancel}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="w-full py-2.5 bg-red-500 text-white text-sm font-bold rounded-xl hover:bg-red-600 transition-colors"
                  >
                    {t.resetBtn}
                  </button>
                )}
              </div>

              {/* 彻底清空 — 连房间都清光，只剩一张白纸，比"重置"更狠 */}
              <div className="bg-rose-50 rounded-xl p-4 border-2 border-rose-300">
                <div className="text-sm font-bold text-rose-900 mb-1">{t.wipeTitle}</div>
                <div className="text-xs text-rose-700 mb-3">{t.wipeDesc}</div>
                {confirmWipe ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => { wipeAll(); setConfirmWipe(false); close(); }}
                      className="flex-1 py-2.5 bg-rose-700 text-white text-sm font-bold rounded-xl hover:bg-rose-800 transition-colors"
                    >
                      {t.wipeConfirm}
                    </button>
                    <button
                      onClick={() => setConfirmWipe(false)}
                      className="px-4 py-2.5 bg-white text-gray-600 text-sm font-bold rounded-xl border border-gray-200 hover:bg-gray-50"
                    >
                      {t.wipeCancel}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmWipe(true)}
                    className="w-full py-2.5 bg-rose-600 text-white text-sm font-bold rounded-xl hover:bg-rose-700 transition-colors"
                  >
                    {t.wipeBtn}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── AI Prompts tab ── */}
          {tab === "ai" && (() => {
            // Build prompts for all configured rooms
            const prompts: GeneratedPrompt[] = enabledRooms
              .filter(r => {
                const rs = rooms[r];
                return Object.keys(rs.materials).length > 0 || rs.placedItems.length > 0;
              })
              .map(r => {
                const rs   = rooms[r];
                const dims = roomDimensions[r] ?? { width: ROOM_DEFS[r].width, depth: ROOM_DEFS[r].depth };
                const wins = roomWindows[r] ?? [];
                const input: RoomPromptInput = {
                  roomType:   r,
                  width:      dims.width,
                  depth:      dims.depth,
                  height:     ROOM_DEFS[r].height,
                  materials:  rs.materials as RoomPromptInput["materials"],
                  placedItems: rs.placedItems,
                  windows:    wins,
                };
                return generateRoomPrompt(input);
              });

            function copyText(text: string, key: string) {
              navigator.clipboard.writeText(text).then(() => {
                setCopiedKey(key);
                setTimeout(() => setCopiedKey(null), 1800);
              });
            }

            function downloadWorkflow() {
              const wf = generateBatchWorkflow(prompts, { model: "sd_xl_base_1.0.safetensors" });
              const blob = new Blob([JSON.stringify(wf, null, 2)], { type: "application/json" });
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement("a");
              a.href = url; a.download = "home_designer_comfyui_workflow.json"; a.click();
              URL.revokeObjectURL(url);
            }

            if (prompts.length === 0) {
              return (
                <div className="text-center text-gray-400 text-sm py-8">
                  {locale === "en"
                    ? "Add materials or furniture to rooms to generate prompts"
                    : "请先为房间添加材料或家具，才能生成提示词"}
                </div>
              );
            }

            return (
              <div className="flex flex-col gap-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-gray-700">
                      {locale === "en"
                        ? `${prompts.length} rooms · copy prompts into ComfyUI / Midjourney / SD WebUI`
                        : `${prompts.length} 个房间 · 将提示词粘贴到 ComfyUI / Midjourney / SD WebUI`}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {locale === "en"
                        ? "Recommended model: SDXL or FLUX.1-dev for photorealistic interiors"
                        : "推荐模型：SDXL 或 FLUX.1-dev，效果最佳"}
                    </p>
                  </div>
                  <button
                    onClick={downloadWorkflow}
                    className="shrink-0 px-3 py-1.5 rounded-xl text-white text-xs font-semibold transition-all active:scale-95"
                    style={{ background: "linear-gradient(135deg,#6366f1,#818cf8)" }}
                  >
                    {locale === "en" ? "⬇ ComfyUI Workflow" : "⬇ 下载ComfyUI工作流"}
                  </button>
                </div>

                {/* Per-room prompt cards */}
                {prompts.map((p, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 overflow-hidden">
                    {/* Card header */}
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-700 capitalize">{p.roomName}</span>
                      <button
                        onClick={() => copyText(p.positive, `pos-${i}`)}
                        className="text-[11px] px-2 py-0.5 rounded-lg border transition-colors"
                        style={{
                          borderColor: copiedKey === `pos-${i}` ? "#22c55e" : "#e5e7eb",
                          color:       copiedKey === `pos-${i}` ? "#16a34a" : "#6b7280",
                          background:  copiedKey === `pos-${i}` ? "#f0fdf4" : "#fff",
                        }}
                      >
                        {copiedKey === `pos-${i}`
                          ? (locale === "en" ? "✓ Copied" : "✓ 已复制")
                          : (locale === "en" ? "Copy" : "复制")}
                      </button>
                    </div>

                    {/* Positive prompt */}
                    <div className="p-3">
                      <p className="text-[10px] text-gray-400 font-medium mb-1 uppercase tracking-wider">
                        {locale === "en" ? "Positive" : "正向提示词"}
                      </p>
                      <p className="text-[11px] text-gray-700 leading-relaxed font-mono break-all">
                        {p.positive}
                      </p>
                    </div>

                    {/* Negative prompt */}
                    <div className="px-3 pb-3">
                      <p className="text-[10px] text-gray-400 font-medium mb-1 uppercase tracking-wider flex items-center justify-between">
                        <span>{locale === "en" ? "Negative" : "反向提示词"}</span>
                        <button
                          onClick={() => copyText(p.negative, `neg-${i}`)}
                          className="normal-case text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          {copiedKey === `neg-${i}` ? "✓" : (locale === "en" ? "copy" : "复制")}
                        </button>
                      </p>
                      <p className="text-[10px] text-gray-400 leading-relaxed font-mono break-all">
                        {p.negative}
                      </p>
                    </div>
                  </div>
                ))}

                {/* Tip box */}
                <div className="bg-indigo-50 rounded-xl p-3 border border-indigo-100 text-[11px] text-indigo-700 leading-relaxed">
                  <strong>{locale === "en" ? "💡 Tip" : "💡 使用方法"}</strong>
                  {locale === "en"
                    ? ": Download the workflow → drag into ComfyUI → change the checkpoint to your preferred model → Queue Prompt. Or paste the positive prompt directly into Midjourney with --ar 4:3."
                    : "：下载工作流 → 拖入 ComfyUI → 修改 checkpoint 为你喜欢的模型 → Queue Prompt。也可直接将正向提示词粘贴到 Midjourney 加上 --ar 4:3。"}
                </div>
              </div>
            );
          })()}
        </div>

        <div className="px-5 pb-4 border-t border-gray-100 pt-3 flex justify-end">
          <button onClick={close} className="text-sm text-gray-400 hover:text-gray-600">{t.closeBtn}</button>
        </div>
      </div>
    </div>
  );
}
