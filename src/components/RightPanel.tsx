"use client";

import { useState, useEffect } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, getRoomArea } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { useT, useLocale } from "@/lib/i18n";
import { getFurnitureNameEn, getMaterialNameEn } from "@/locales/itemNames";


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
    <aside className="w-72 shrink-0 h-full overflow-y-auto bg-white border-l border-gray-200 flex flex-col">
      {/* Budget header */}
      <div className={`p-4 shrink-0 ${isOverBudget ? "bg-red-50" : "bg-gradient-to-br from-blue-600 to-indigo-500"}`}>
        <div className={`text-xs font-semibold mb-1 ${isOverBudget ? "text-red-600" : "text-blue-100"}`}>
          💰 {t.roomNames[activeRoom] ?? def.name} · {t.budgetTitle}
        </div>
        <div className={`text-3xl font-black mb-0.5 ${isOverBudget ? "text-red-600" : "text-white"}`}>
          ¥{totalCost.toLocaleString()}
        </div>
        <div className={`text-xs ${isOverBudget ? "text-red-400" : "text-blue-200"}`}>
          {totalItems} {t.budgetItems} · {t.budgetArea} {area.floor}㎡
        </div>
        {isOverBudget && (
          <div className="mt-2 text-xs text-red-600 font-semibold bg-red-100 rounded-lg px-2 py-1">
            ⚠️ {t.overBudget} ¥{(totalCost - budget).toLocaleString()}
          </div>
        )}
      </div>

      {/* Score */}
      {totalItems >= 2 && (
        <div className="px-4 py-3 border-b border-gray-100 shrink-0">
          <div className="text-[11px] font-bold text-gray-500 mb-2">{t.scoreTitle}</div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[11px] text-gray-600">
              <span className="w-14 shrink-0">{t.scoreStyle}</span>
              <ScoreBar score={scores.style} color="#3B82F6" />
              <span className="w-7 text-right font-bold text-blue-600">{scores.style}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-gray-600">
              <span className="w-14 shrink-0">{t.scoreSpace}</span>
              <ScoreBar score={scores.space} color="#10B981" />
              <span className="w-7 text-right font-bold text-emerald-600">{scores.space}</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-gray-600">
              <span className="w-14 shrink-0">{t.scoreLight}</span>
              <ScoreBar score={scores.light} color="#F59E0B" />
              <span className="w-7 text-right font-bold text-amber-500">{scores.light}</span>
            </div>
          </div>
          {scores.dominantStyle && (
            <div className="mt-2 inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
              {t.dominantStyle}{t.styleTags[scores.dominantStyle] ?? scores.dominantStyle}
            </div>
          )}
        </div>
      )}

      {/* Budget slider */}
      <div className="px-4 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
          <span>{t.budgetLimit}</span>
          <span className="font-bold text-gray-700">¥{(budget / 10000).toFixed(0)}万</span>
        </div>
        <input
          type="range" min={30000} max={500000} step={10000} value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          className="w-full h-1.5 accent-blue-500"
        />
        <div className="mt-1.5 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isOverBudget ? "bg-red-500" : "bg-blue-500"}`}
            style={{ width: `${budgetPercent}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-gray-400 mt-1">
          <span>¥{totalCost.toLocaleString()}</span>
          <span>¥{budget.toLocaleString()}</span>
        </div>
      </div>

      {/* Materials */}
      {materialItems.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-[11px] font-bold text-gray-500 mb-2">{t.sectionMaterials}</div>
          <div className="flex flex-col gap-2">
            {(materialItems as NonNullable<typeof materials.wall>[]).map((item) => {
              const qty = item.category === "wall" ? area.wall
                       : item.category === "floor" ? area.floor
                       : item.id === "light-spot" ? 8
                       : 1;
              const total = item.price * qty;
              return (
                <div key={item.id} className="flex items-start justify-between gap-2 group">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-5 h-5 rounded-md shrink-0 border border-gray-200" style={{ background: item.texture ?? item.color }} />
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-gray-800 truncate">{item.name}</div>
                      <div className="text-[9px] text-gray-400">
                        {item.category === "wall" || item.category === "floor" || item.category === "tile" ? `${qty}㎡` : item.id === "light-spot" ? "×8个" : "×1件"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[11px] font-bold text-gray-700">¥{total.toLocaleString()}</span>
                    <button
                      onClick={() => removeMaterial(item.category)}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs transition-all"
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
          <div className="text-[11px] font-bold text-gray-500 mb-2">{t.sectionFurniture} ({placedItems.length})</div>
          <div className="flex flex-col gap-2">
            {placedItems.map((placed) => {
              const f = getFurnitureById(placed.furnitureId);
              if (!f) return null;
              const isSelected = placed.instanceId === selectedId;
              return (
                <div
                  key={placed.instanceId}
                  className={`flex items-center justify-between gap-2 p-1.5 rounded-lg cursor-pointer group transition-colors ${isSelected ? "bg-blue-50 border border-blue-200" : "hover:bg-gray-50"}`}
                  onClick={() => selectInstance(isSelected ? null : placed.instanceId)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-md shrink-0 flex items-center justify-center text-sm" style={{ background: f.color }}>
                      <span style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.4))" }}>{f.icon}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-medium text-gray-800 truncate">{locale === "en" ? (getFurnitureNameEn(f.id) ?? f.name) : f.name}</div>
                      <div className="text-[9px] text-gray-400">
                        {(placed.x / 100).toFixed(1)}m, {(placed.z / 100).toFixed(1)}m · {placed.rotation}°
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[11px] font-bold text-gray-700">¥{f.price.toLocaleString()}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeItem(placed.instanceId); }}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-xs transition-all"
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
        <div className="flex-1 flex items-center justify-center text-xs text-gray-400 px-4 text-center whitespace-pre-line">
          {t.emptyState}
        </div>
      )}

      {/* AI suggestion */}
      {aiSuggestion && (
        <div className="mx-4 mb-3 p-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-100 shrink-0">
          <div className="text-[11px] font-bold text-blue-700 mb-1">{t.aiTitle}</div>
          <div className="text-[11px] text-blue-600 leading-relaxed">{aiSuggestion}</div>
        </div>
      )}

      {/* Export buttons */}
      <div className="p-4 border-t border-gray-100 space-y-2 shrink-0">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("openExport"))}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-colors"
        >
          {t.exportQuote}
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("openShare"))}
          className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-colors"
        >
          {t.sharePlan}
        </button>
      </div>
    </aside>
  );
}
