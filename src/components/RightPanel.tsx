"use client";

import { useState, useEffect, useMemo } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS, getRoomArea } from "@/lib/types";
import type { RoomType, ExteriorWall, ExteriorWallDecorItem } from "@/lib/types";
import { FURNITURE, getFurnitureById } from "@/lib/furniture";
import { useT, useLocale } from "@/lib/i18n";
import { getFurnitureNameEn, getMaterialNameEn, getBrandNameEn } from "@/locales/itemNames";
import { formatPrice } from "@/lib/currency";
import { evaluateRoom } from "@/lib/clearance";


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
  const roomState = useDesignerStore((s) => s.floorPlans[s.activeFloor].rooms[activeRoom]);
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

  // ── Clearance evaluation for the active room ──
  const roomDims = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDimensions[activeRoom]);
  const roomW = roomDims?.width ?? def.width;
  const roomD = roomDims?.depth ?? def.depth;
  const hasDoor   = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomHasDoor[activeRoom] ?? true);
  const doorWall  = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorWall[activeRoom] ?? "bottom");
  const doorPosCm = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorPos[activeRoom] ?? 0);
  const doorLenCm = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomDoorLen?.[activeRoom] ?? 80);
  const roomWindows = useDesignerStore((s) => s.floorPlans[s.activeFloor].roomWindows[activeRoom] ?? []);
  const evaluation = useMemo(
    () => evaluateRoom(
      placedItems, getFurnitureById, roomW, roomD,
      hasDoor ? { hasDoor, wall: doorWall as "bottom" | "top" | "left" | "right", posCm: doorPosCm, lenCm: doorLenCm } : undefined,
      roomWindows,
    ),
    [placedItems, roomW, roomD, hasDoor, doorWall, doorPosCm, doorLenCm, roomWindows]
  );
  const evaluated = evaluation.items;
  const violations = useMemo(
    () => evaluated.flatMap(e => e.violations),
    [evaluated]
  );
  const hasRuleItems = useMemo(
    () => evaluated.some(e => e.zone !== null) || evaluation.doorSwing !== null,
    [evaluated, evaluation.doorSwing]
  );

  const budgetPercent = Math.min(100, (totalCost / budget) * 100);
  const aiSuggestion = t.aiSuggestions[scores.dominantStyle] ?? null;

  // Collect unique MaterialItem values. `materials` now also holds scalar
  // fields (wallSplitHeight) and can contain the same MaterialItem under
  // multiple keys (e.g. wall=X, wallBack=X when user sets both). Filter
  // to real items and dedupe by id.
  const materialItems = (() => {
    const seen = new Set<string>();
    const out: NonNullable<typeof materials.wall>[] = [];
    for (const v of Object.values(materials)) {
      if (!v || typeof v !== "object" || !("id" in v)) continue;
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v as NonNullable<typeof materials.wall>);
    }
    return out;
  })();
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

      {/* Clearance / ergonomic check */}
      {hasRuleItems && (
        <div className="px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--ds-border-soft)" }}>
          <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "var(--ds-text-3)" }}>
            {t.sectionClearance}
            {violations.length > 0 && (
              <span
                className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                style={{
                  background: violations.some(v => v.severity === "required") ? "#FEE2E2" : "#FEF3C7",
                  color: violations.some(v => v.severity === "required") ? "var(--ds-danger)" : "#92400E",
                }}
              >
                {violations.length}
              </span>
            )}
          </div>
          {violations.length === 0 ? (
            <div className="text-[11px]" style={{ color: "var(--ds-success)" }}>{t.clearanceOk}</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {violations.map((v, i) => {
                const isRed = v.severity === "required";
                const fName = locale === "en" ? (getFurnitureNameEn(
                  evaluated.find(e => e.placed.instanceId === v.instanceId)?.f.id ?? ""
                ) ?? v.furnitureName) : v.furnitureName;
                const oName = v.otherName && locale === "en"
                  ? (getFurnitureNameEn(
                      evaluated.find(e => e.placed.instanceId === v.otherId)?.f.id ?? ""
                    ) ?? v.otherName)
                  : v.otherName;
                return (
                  <div
                    key={i}
                    className="p-2 rounded-lg cursor-pointer transition-all"
                    style={{
                      background: isRed ? "#FFF5F5" : "#FFFBEB",
                      border: `1px solid ${isRed ? "#FECACA" : "#FDE68A"}`,
                    }}
                    onClick={() => selectInstance(v.instanceId)}
                  >
                    <div className="text-[11px] font-semibold" style={{ color: isRed ? "var(--ds-danger)" : "#92400E" }}>
                      {isRed ? "⚠️" : "💡"} {fName}
                    </div>
                    <div className="text-[10px] leading-snug mt-0.5" style={{ color: "var(--ds-text-2)" }}>
                      {v.kind === "overlap"
                        ? `${t.clearanceOverlap}「${oName ?? ""}」${t.clearanceOverlapSuffix}`
                        : v.kind === "door"
                          ? t.clearanceDoorBlocked
                          : v.kind === "window"
                            ? t.clearanceWindowBlocked
                            : v.kind === "hugWall"
                              ? v.reason
                              : v.kind === "relational"
                                ? v.reason
                                : `${t.clearanceWall} ${v.required}cm`}
                    </div>
                    {v.kind !== "door" && v.kind !== "relational" && v.kind !== "window" && v.kind !== "hugWall" && (
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--ds-text-3)" }}>
                        {v.reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
                      <div className="text-[11px] font-medium truncate" style={{ color: "var(--ds-text)" }}>{locale === "en" ? (getMaterialNameEn(item.id) ?? item.name) : item.name}</div>
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
          onClick={() => useDesignerStore.getState().autoDecorate()}
          className="w-full py-2 text-sm font-semibold rounded-xl transition-all"
          style={{
            background: "linear-gradient(135deg, #FDE68A 0%, #FCA5A5 100%)",
            color: "#7C2D12",
            border: "1px solid #FDE68A",
          }}
          title={t.autoDecorateHint}
        >
          ✨ {t.autoDecorate}
        </button>
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
            if (window.confirm(t.clearRoomConfirm)) {
              useDesignerStore.getState().clearRoom();
            }
          }}
          className="w-full py-2 text-sm font-semibold rounded-xl transition-all"
          style={{ background: "#FFF1F0", color: "#FF3B30", border: "1px solid #FFCDD0" }}
        >
          {t.clearRoomBtn}
        </button>
      </div>

      {/* Exterior decor for this room's outside walls */}
      <ExteriorDecorSection activeRoom={activeRoom} />
    </aside>
  );
}

// ─── Per-room exterior decor picker + editor ────────────────
const EXTERIOR_WALL_OPTIONS: Array<{ id: ExteriorWall; label: string }> = [
  { id: "front", label: "前（+Z）" },
  { id: "back",  label: "后（-Z）" },
  { id: "left",  label: "左（-X）" },
  { id: "right", label: "右（+X）" },
];

const EMPTY_EXT_DECOR: ExteriorWallDecorItem[] = [];

function ExteriorDecorSection({ activeRoom }: { activeRoom: RoomType }) {
  const decorRaw = useDesignerStore(s => s.floorPlans[s.activeFloor].rooms[activeRoom]?.exteriorDecor);
  const decor = decorRaw ?? EMPTY_EXT_DECOR;
  const selectedId = useDesignerStore(s => s.selectedExteriorDecorId);
  const setSelected = useDesignerStore(s => s.setSelectedExteriorDecor);
  const addItem = useDesignerStore(s => s.addRoomExteriorDecor);
  const removeItem = useDesignerStore(s => s.removeRoomExteriorDecor);
  const updateItem = useDesignerStore(s => s.updateRoomExteriorDecor);

  const [pickerWall, setPickerWall] = useState<ExteriorWall>("front");
  const decorItems = FURNITURE.filter(f => f.category === "exterior_wall_decor");
  const selected = decor.find(d => d.instanceId === selectedId);
  const selectedItem = selected ? getFurnitureById(selected.furnitureId) : null;

  return (
    <div className="px-4 pb-4 border-t border-gray-100 pt-3">
      <div className="text-[11px] font-black text-gray-800 mb-2">🏮 外墙装饰（{ROOM_DEFS[activeRoom].name}）</div>

      {/* Wall picker for placement */}
      <div className="mb-2 p-2 rounded-xl bg-gray-50 border border-gray-100">
        <div className="text-[9px] text-gray-500 mb-1">放到哪面外墙：</div>
        <div className="flex gap-1">
          {EXTERIOR_WALL_OPTIONS.map(w => (
            <button key={w.id}
              onClick={() => setPickerWall(w.id)}
              className={`flex-1 text-[10px] py-1 rounded-md transition-all ${
                pickerWall === w.id ? "bg-blue-500 text-white font-semibold" : "bg-white text-gray-600 border border-gray-200"
              }`}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* Library — click to place */}
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {decorItems.map(it => (
          <button key={it.id}
            onClick={() => addItem(activeRoom, it.id, pickerWall)}
            className="flex flex-col items-center gap-0.5 py-1.5 rounded-xl border border-gray-200 bg-white hover:border-blue-400 transition-all"
            title={`${it.name} — ${it.price}${it.unit}`}>
            <span className="text-lg">{it.icon}</span>
            <span className="text-[9px] text-gray-700 font-semibold leading-tight text-center px-0.5">{it.name}</span>
          </button>
        ))}
      </div>

      {/* Placed list */}
      {decor.length > 0 && (
        <div className="mb-2">
          <div className="text-[9px] text-gray-500 mb-1">已放置 ({decor.length})</div>
          <div className="flex flex-col gap-1">
            {decor.map(d => {
              const item = getFurnitureById(d.furnitureId);
              const wallLabel = EXTERIOR_WALL_OPTIONS.find(w => w.id === d.wall)?.label ?? d.wall;
              return (
                <div key={d.instanceId}
                  className={`flex items-center gap-2 p-1.5 rounded-lg border cursor-pointer transition-all ${
                    selectedId === d.instanceId ? "border-green-500 bg-green-50" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                  onClick={() => setSelected(d.instanceId)}>
                  <span className="text-base">{item?.icon ?? "⬜"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-semibold text-gray-700 truncate">{item?.name ?? d.furnitureId}</div>
                    <div className="text-[9px] text-gray-400">{wallLabel}</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); removeItem(activeRoom, d.instanceId); }}
                    className="text-red-400 hover:text-red-600 text-sm">🗑️</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Selected editor */}
      {selected && selectedItem && (
        <div className="p-2 rounded-xl bg-green-50 border border-green-200">
          <div className="text-[10px] font-bold text-green-700 mb-2">编辑：{selectedItem.name}</div>
          <div className="flex flex-col gap-2">
            <div>
              <div className="text-[9px] text-gray-500 mb-0.5">墙面</div>
              <div className="flex gap-1">
                {EXTERIOR_WALL_OPTIONS.map(w => (
                  <button key={w.id}
                    onClick={() => updateItem(activeRoom, selected.instanceId, { wall: w.id })}
                    className={`flex-1 text-[9px] py-1 rounded-md transition-all ${
                      selected.wall === w.id ? "bg-green-600 text-white font-semibold" : "bg-white text-gray-600 border border-gray-200"
                    }`}>
                    {w.label.slice(0, 1)}
                  </button>
                ))}
              </div>
            </div>
            <ExtSliderRow label="水平 u" value={selected.u} min={0.04} max={0.96} step={0.01}
              onChange={v => updateItem(activeRoom, selected.instanceId, { u: v })} />
            <ExtSliderRow label="垂直 v" value={selected.v} min={0.04} max={0.96} step={0.01}
              onChange={v => updateItem(activeRoom, selected.instanceId, { v: v })} />
            <ExtSliderRow label="宽度 ×" value={selected.scaleW ?? 1} min={0.3} max={3} step={0.05}
              onChange={v => updateItem(activeRoom, selected.instanceId, { scaleW: v })} />
            <ExtSliderRow label="高度 ×" value={selected.scaleH ?? 1} min={0.3} max={3} step={0.05}
              onChange={v => updateItem(activeRoom, selected.instanceId, { scaleH: v })} />
            <ExtSliderRow label="旋转°" value={selected.rotation ?? 0} min={-180} max={180} step={5}
              onChange={v => updateItem(activeRoom, selected.instanceId, { rotation: v })} />
          </div>
          <div className="mt-2 text-[9px] text-gray-500 italic">
            3D 视图里可直接拖拽装饰物到位置。
          </div>
        </div>
      )}
    </div>
  );
}

function ExtSliderRow({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center text-[9px] text-gray-500 mb-0.5">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-green-500 h-1" />
    </div>
  );
}
