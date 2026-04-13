"use client";

import { useState, useEffect } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, getRoomArea } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { useT, useLocale } from "@/lib/i18n";
import { getFurnitureNameEn, getMaterialNameEn, getBrandNameEn } from "@/locales/itemNames";
import { formatPrice } from "@/lib/currency";


function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${score}%`, background: color }}
      />
    </div>
  );
}

export default function RightPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const t = useT();
  const locale = useLocale();

  const activeRoom = useDesignerStore((s) => s.activeRoom);
  const roomState = useDesignerStore((s) => s.rooms[activeRoom]);
  const scores = useDesignerStore((s) => s.scores);
  const totalCostRaw = useDesignerStore((s) => s.totalCost());
  const budgetRaw = useDesignerStore((s) => s.budget);
  const setBudget = useDesignerStore((s) => s.setBudget);
  const isOverBudgetRaw = useDesignerStore((s) => s.isOverBudget());

  // Use stable defaults until after hydration to prevent mismatch
  const totalCost = mounted ? totalCostRaw : 0;
  const budget = mounted ? budgetRaw : 150000;
  const isOverBudget = mounted ? isOverBudgetRaw : false;
  const removeMaterial = useDesignerStore((s) => s.removeMaterial);
  const removeItem = useDesignerStore((s) => s.removeItem);
  const selectInstance = useDesignerStore((s) => s.selectInstance);
  const selectedId = useDesignerStore((s) => s.selectedInstanceId);

  const def = ROOM_DEFS[activeRoom];
  const area = getRoomArea(activeRoom);
  const { materials, placedItems } = roomState;

  const budgetPercent = Math.min(100, (totalCost / budget) * 100);
  const aiSuggestion = t.aiSuggestions[scores.dominantStyle] ?? null;

  const materialItems = Object.values(materials).filter(Boolean) as typeof materials.wall[];
  const totalItems = materialItems.length + placedItems.length;

  return (
    <aside
      className="w-72 shrink-0 h-full overflow-y-auto flex flex-col"
      style={{ background: "var(--ds-surface)", borderLeft: "1px solid var(--ds-border)" }}
    >
      {/* Budget header */}
      <div
        className="p-4 shrink-0"
        style={
          isOverBudget
            ? { background: "var(--ds-danger-soft)", borderBottom: "1px solid #FFCDD2" }
            : {
                background: "linear-gradient(160deg, #007AFF 0%, #5856D6 100%)",
                borderBottom: "none",
              }
        }
      >
        <div className="text-xs font-semibold mb-1" style={{ color: isOverBudget ? "var(--ds-danger)" : "rgba(255,255,255,0.75)" }}>
          💰 {t.roomNames[activeRoom] ?? def.name} · {t.budgetTitle}
        </div>
        <div className="text-3xl font-black mb-0.5" style={{ color: isOverBudget ? "var(--ds-danger)" : "#fff" }}>
          {formatPrice(totalCost, locale)}
        </div>
        <div className="text-xs" style={{ color: isOverBudget ? "#F87171" : "rgba(255,255,255,0.6)" }}>
          {totalItems} {t.budgetItems} · {t.budgetArea} {area.floor}㎡
        </div>
        {isOverBudget && (
          <div className="mt-2 text-xs font-semibold rounded-lg px-2 py-1" style={{ background: "#FEE2E2", color: "var(--ds-danger)" }}>
            ⚠️ {t.overBudget} {formatPrice(totalCost - budget, locale)}
          </div>
        )}
      </div>

      {/* Score */}
      {totalItems >= 2 && (
        <div className="px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--ds-border-soft)" }}>
          <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--ds-text-3)" }}>{t.scoreTitle}</div>
          <div className="flex flex-col gap-2">
            {[
              { label: t.scoreStyle, val: scores.style, color: "#007AFF" },
              { label: t.scoreSpace, val: scores.space,  color: "var(--ds-success)" },
              { label: t.scoreLight, val: scores.light,  color: "#F59E0B" },
            ].map(({ label, val, color }) => (
              <div key={label} className="flex items-center gap-2 text-[11px]" style={{ color: "var(--ds-text-2)" }}>
                <span className="w-14 shrink-0">{label}</span>
                <ScoreBar score={val} color={color} />
                <span className="w-7 text-right font-bold" style={{ color }}>{val}</span>
              </div>
            ))}
          </div>
          {scores.dominantStyle && (
            <div
              className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "#E8F1FF", color: "#0055B3" }}
            >
              {t.dominantStyle}{t.styleTags[scores.dominantStyle] ?? scores.dominantStyle}
            </div>
          )}
        </div>
      )}

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
          onChange={(e) => setBudget(Number(e.target.value))}
          className="w-full h-1.5"
          style={{ accentColor: "#007AFF" }}
        />
        <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--ds-bg)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${budgetPercent}%`,
              background: isOverBudget ? "#FF3B30" : "#007AFF",
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] mt-1" style={{ color: "var(--ds-text-3)" }}>
          <span>{formatPrice(totalCost, locale)}</span>
          <span>{formatPrice(budget, locale)}</span>
        </div>
      </div>

      {/* Materials */}
      {materialItems.length > 0 && (
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--ds-border-soft)" }}>
          <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--ds-text-3)" }}>{t.sectionMaterials}</div>
          <div className="flex flex-col gap-2">
            {(materialItems as NonNullable<typeof materials.wall>[]).map((item) => {
              const qty = item.category === "wall" ? area.wall
                       : item.category === "floor" ? area.floor
                       : item.id === "light-spot" ? 8 : 1;
              const total = item.price * qty;
              return (
                <div key={item.id} className="flex items-start justify-between gap-2 group">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-5 h-5 rounded-md shrink-0"
                      style={{ background: item.texture ?? item.color, border: "1px solid var(--ds-border)" }}
                    />
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium truncate" style={{ color: "var(--ds-text)" }}>{item.name}</div>
                      <div className="text-[9px]" style={{ color: "var(--ds-text-3)" }}>
                        {item.category === "wall" || item.category === "floor" || item.category === "tile" ? `${qty}㎡` : item.id === "light-spot" ? "×8" : "×1"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[11px] font-bold" style={{ color: "var(--ds-text)" }}>{formatPrice(total, locale)}</span>
                    <button
                      onClick={() => removeMaterial(item.category)}
                      className="opacity-0 group-hover:opacity-100 text-xs transition-all"
                      style={{ color: "var(--ds-text-3)" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "var(--ds-danger)")}
                      onMouseLeave={e => (e.currentTarget.style.color = "var(--ds-text-3)")}
                    >✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Furniture */}
      {placedItems.length > 0 && (
        <div className="px-4 py-3 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--ds-text-3)" }}>{t.sectionFurniture} ({placedItems.length})</div>
          <div className="flex flex-col gap-1.5">
            {placedItems.map((placed) => {
              const f = getFurnitureById(placed.furnitureId);
              if (!f) return null;
              const isSelected = placed.instanceId === selectedId;
              return (
                <div
                  key={placed.instanceId}
                  className="flex items-center justify-between gap-2 p-1.5 rounded-lg cursor-pointer group transition-all"
                  style={
                    isSelected
                      ? { background: "#E8F1FF", border: "1px solid #CCE4FF" }
                      : { border: "1px solid transparent" }
                  }
                  onClick={() => selectInstance(isSelected ? null : placed.instanceId)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-md shrink-0 flex items-center justify-center text-sm" style={{ background: f.color }}>
                      <span style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.4))" }}>{f.icon}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium truncate" style={{ color: "var(--ds-text)" }}>
                        {locale === "en" ? (getFurnitureNameEn(f.id) ?? f.name) : f.name}
                      </div>
                      <div className="text-[9px]" style={{ color: "var(--ds-text-3)" }}>
                        {(placed.x / 100).toFixed(1)}m, {(placed.z / 100).toFixed(1)}m · {placed.rotation}°
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[11px] font-bold" style={{ color: "var(--ds-text)" }}>{formatPrice(f.price, locale)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeItem(placed.instanceId); }}
                      className="opacity-0 group-hover:opacity-100 text-xs transition-all"
                      style={{ color: "var(--ds-text-3)" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "var(--ds-danger)")}
                      onMouseLeave={e => (e.currentTarget.style.color = "var(--ds-text-3)")}
                    >✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {totalItems === 0 && (
        <div className="flex-1 flex items-center justify-center text-xs px-4 text-center whitespace-pre-line" style={{ color: "var(--ds-text-3)" }}>
          {t.emptyState}
        </div>
      )}

      {/* AI suggestion */}
      {aiSuggestion && (
        <div
          className="mx-4 mb-3 p-3 rounded-xl shrink-0"
          style={{ background: "#E8F1FF", border: "1px solid #CCE4FF" }}
        >
          <div className="text-[11px] font-bold mb-1" style={{ color: "#0055B3" }}>{t.aiTitle}</div>
          <div className="text-[11px] leading-relaxed" style={{ color: "#0055B3" }}>{aiSuggestion}</div>
        </div>
      )}

      {/* Export buttons */}
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
      </div>
    </aside>
  );
}
