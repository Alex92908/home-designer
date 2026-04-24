"use client";

import { useState, useEffect } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, getRoomArea } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { useT, useLocale } from "@/lib/i18n";
import { getFurnitureNameEn, getMaterialNameEn } from "@/locales/itemNames";
import { formatPrice } from "@/lib/currency";

// Compute cost for one room (mirrors store totalCost logic but for any room)
function calcRoomCost(
  roomId: string,
  materials: Record<string, { id: string; price: number; category: string } | undefined>,
  placedItems: Array<{ furnitureId: string }>,
  area: { wall: number; floor: number }
) {
  let total = 0;
  if (materials.wall)    total += (materials.wall.price ?? 0) * area.wall;
  if (materials.floor)   total += (materials.floor.price ?? 0) * area.floor;
  if (materials.ceiling) total += (materials.ceiling?.price ?? 0) * area.floor;
  if (materials.tile)    total += (materials.tile?.price ?? 0) * area.floor;
  if (materials.light) {
    total += (materials.light.price ?? 0) * (materials.light.id === "light-spot" ? 8 : 1);
  }
  for (const p of placedItems) {
    const f = getFurnitureById(p.furnitureId);
    if (f) total += f.price;
  }
  return total;
}

export default function RightPanelAll() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const t      = useT();
  const locale = useLocale();

  const floorPlans     = useDesignerStore(s => s.floorPlans);
  const activeFloor    = useDesignerStore(s => s.activeFloor);
  const rooms          = useDesignerStore(s => s.floorPlans[s.activeFloor].rooms);
  const enabledRooms   = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const customRoomMeta = useDesignerStore(s => s.customRoomMeta);
  const budgetRaw      = useDesignerStore(s => s.budget);
  const setBudget      = useDesignerStore(s => s.setBudget);
  const setActiveRoom  = useDesignerStore(s => s.setActiveRoom);
  const setViewMode    = useDesignerStore(s => s.setViewMode);

  const budget = mounted ? budgetRaw : 150000;

  // Per-room costs for current floor (for display)
  const roomCosts = enabledRooms.map(r => {
    const area = getRoomArea(r);
    const cost = calcRoomCost(r, rooms[r].materials as never, rooms[r].placedItems, area);
    return { r, cost, area };
  });

  // Total cost across ALL floors
  const totalCost = floorPlans.reduce((sum, fp) => {
    return sum + fp.enabledRooms.reduce((s2, room) => {
      const { materials, placedItems } = fp.rooms[room];
      const area = getRoomArea(room);
      return s2 + calcRoomCost(room, materials as never, placedItems, area);
    }, 0);
  }, 0);
  const budgetPct    = Math.min(100, (totalCost / budget) * 100);
  const isOverBudget = mounted && totalCost > budget;
  const configuredRooms = roomCosts.filter(x => x.cost > 0);

  // Expand state: which rooms are open
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (r: string) =>
    setExpanded(prev => {
      const s = new Set(prev);
      s.has(r) ? s.delete(r) : s.add(r);
      return s;
    });

  return (
    <aside
      className="w-72 shrink-0 h-full overflow-y-auto flex flex-col"
      style={{ background: "var(--ds-surface)", borderLeft: "1px solid var(--ds-border)" }}
    >
      {/* Total cost header — same style as RightPanel */}
      <div
        className="p-4 shrink-0"
        style={
          isOverBudget
            ? { background: "var(--ds-danger-soft)", borderBottom: "1px solid #FFCDD2" }
            : { background: "linear-gradient(160deg, #007AFF 0%, #5856D6 100%)" }
        }
      >
        <div className="text-xs font-semibold mb-1" style={{ color: isOverBudget ? "var(--ds-danger)" : "rgba(255,255,255,0.75)" }}>
          🏠 {locale === "en" ? "Whole House · Live Budget" : "全屋 · 实时预算"}
        </div>
        <div className="text-3xl font-black mb-0.5" style={{ color: isOverBudget ? "var(--ds-danger)" : "#fff" }}>
          {mounted ? formatPrice(totalCost, locale) : "—"}
        </div>
        <div className="text-xs" style={{ color: isOverBudget ? "#F87171" : "rgba(255,255,255,0.6)" }}>
          {configuredRooms.length} {locale === "en" ? "rooms configured" : "个房间已配置"}
        </div>
        {isOverBudget && (
          <div className="mt-2 text-xs font-semibold rounded-lg px-2 py-1" style={{ background: "#FEE2E2", color: "var(--ds-danger)" }}>
            ⚠️ {t.overBudget} {formatPrice(totalCost - budget, locale)}
          </div>
        )}
      </div>

      {/* Budget slider */}
      <div className="px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--ds-border-soft)" }}>
        <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: "var(--ds-text-2)" }}>
          <span>{t.budgetLimit}</span>
          <span className="font-bold" style={{ color: "var(--ds-text)" }}>
            {locale === "en" ? formatPrice(budget, locale) : `¥${(budget / 10000).toFixed(0)}万`}
          </span>
        </div>
        <input
          type="range" min={30000} max={500000} step={10000} value={budget}
          onChange={e => setBudget(Number(e.target.value))}
          className="w-full h-1.5"
          style={{ accentColor: "#007AFF" }}
        />
        <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--ds-bg)" }}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${budgetPct}%`, background: isOverBudget ? "#FF3B30" : "#007AFF" }} />
        </div>
        <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--ds-text-3)" }}>
          <span>{mounted ? formatPrice(totalCost, locale) : "—"}</span>
          <span>{formatPrice(budget, locale)}</span>
        </div>
      </div>

      {/* Room accordion list */}
      <div className="flex-1 overflow-y-auto">
        {configuredRooms.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs px-4 py-8 text-center" style={{ color: "var(--ds-text-3)" }}>
            {t.emptyState}
          </div>
        ) : (
          configuredRooms.map(({ r, cost, area }) => {
            const def      = ROOM_DEFS[r];
            const meta     = customRoomMeta[r];
            const name     = meta?.name ?? t.roomNames[r] ?? def.name;
            const icon     = meta?.icon ?? def.icon;
            const isOpen   = expanded.has(r);
            const { materials, placedItems } = rooms[r];
            const materialItems = Object.values(materials).filter(Boolean) as NonNullable<typeof materials.wall>[];

            return (
              <div key={r} style={{ borderBottom: "1px solid var(--ds-border-soft)" }}>
                {/* Room row header */}
                <button
                  className="w-full flex items-center gap-2 px-4 py-2.5 transition-all text-left"
                  style={{ background: isOpen ? "#F0F6FF" : "transparent" }}
                  onClick={() => toggle(r)}
                >
                  {/* Icon */}
                  <span className="text-base shrink-0">{icon}</span>

                  {/* Name */}
                  <span className="flex-1 text-[12px] font-semibold truncate" style={{ color: "var(--ds-text)" }}>
                    {name}
                  </span>

                  {/* Cost */}
                  <span className="text-[12px] font-black shrink-0" style={{ color: "#007AFF" }}>
                    {mounted ? formatPrice(cost, locale) : "—"}
                  </span>

                  {/* Chevron */}
                  <span
                    className="text-[10px] shrink-0 transition-transform duration-200"
                    style={{
                      color: "var(--ds-text-3)",
                      transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                      display: "inline-block",
                    }}
                  >
                    ▾
                  </span>
                </button>

                {/* Expanded detail — same item style as RightPanel */}
                {isOpen && (
                  <div className="pb-2" style={{ background: "#F8FBFF" }}>
                    {/* Jump to room button */}
                    <div className="px-4 pt-1 pb-2">
                      <button
                        onClick={() => { setActiveRoom(r); setViewMode("2d"); }}
                        className="text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all"
                        style={{ background: "#E8F1FF", color: "#007AFF" }}
                      >
                        {locale === "en" ? "→ Open room" : "→ 进入房间"}
                      </button>
                    </div>

                    {/* Materials */}
                    {materialItems.length > 0 && (
                      <div className="px-4 pb-2">
                        <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--ds-text-3)" }}>
                          {t.sectionMaterials}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {materialItems.map(item => {
                            const qty = item.category === "wall" ? area.wall
                                      : item.category === "floor" ? area.floor
                                      : item.id === "light-spot" ? 8 : 1;
                            return (
                              <div key={item.id} className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded shrink-0"
                                  style={{ background: item.texture ?? item.color, border: "1px solid var(--ds-border)" }} />
                                <span className="flex-1 text-[10px] truncate" style={{ color: "var(--ds-text)" }}>{locale === "en" ? (getMaterialNameEn(item.id) ?? item.name) : item.name}</span>
                                <span className="text-[9px]" style={{ color: "var(--ds-text-3)" }}>
                                  {item.category === "wall" || item.category === "floor" || item.category === "tile" ? `${qty}㎡` : item.id === "light-spot" ? "×8" : "×1"}
                                </span>
                                <span className="text-[10px] font-bold shrink-0" style={{ color: "var(--ds-text)" }}>
                                  {formatPrice(item.price * qty, locale)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Furniture */}
                    {placedItems.length > 0 && (
                      <div className="px-4">
                        <div className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--ds-text-3)" }}>
                          {t.sectionFurniture} ({placedItems.length})
                        </div>
                        <div className="flex flex-col gap-1">
                          {placedItems.map(placed => {
                            const f = getFurnitureById(placed.furnitureId);
                            if (!f) return null;
                            return (
                              <div key={placed.instanceId} className="flex items-center gap-2">
                                <div className="w-5 h-5 rounded shrink-0 flex items-center justify-center text-xs"
                                  style={{ background: f.color }}>
                                  {f.icon}
                                </div>
                                <span className="flex-1 text-[10px] truncate" style={{ color: "var(--ds-text)" }}>
                                  {locale === "en" ? (getFurnitureNameEn(f.id) ?? f.name) : f.name}
                                </span>
                                <span className="text-[10px] font-bold shrink-0" style={{ color: "var(--ds-text)" }}>
                                  {formatPrice(f.price, locale)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Export buttons — same as RightPanel */}
      <div className="p-4 space-y-2 shrink-0" style={{ borderTop: "1px solid var(--ds-border-soft)" }}>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("openExport"))}
          className="ds-btn-primary w-full py-2.5 text-sm"
        >
          {t.exportQuote}
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("openShare"))}
          className="w-full py-2 text-sm font-semibold rounded-xl transition-all"
          style={{ background: "var(--ds-bg)", color: "var(--ds-text-2)", border: "1px solid var(--ds-border)" }}
        >
          {t.sharePlan}
        </button>
        <button
          onClick={() => {
            if (window.confirm(t.resetConfirm)) {
              useDesignerStore.getState().resetAll();
            }
          }}
          className="w-full py-2 text-sm font-semibold rounded-xl transition-all"
          style={{ background: "#FFF1F0", color: "#FF3B30", border: "1px solid #FFCDD0" }}
        >
          {t.resetBtn}
        </button>
      </div>
    </aside>
  );
}
