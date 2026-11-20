"use client";

import { useState } from "react";
import { useDesignerStore } from "@/lib/store";
import { ALL_TEMPLATES, StyleTemplate } from "@/lib/templates";
import { PROJECT_TEMPLATES, type ProjectTemplate } from "@/lib/projectTemplates";
import { MATERIALS } from "@/lib/data";
import { useLocale } from "@/lib/i18n";
import { formatPrice } from "@/lib/currency";

interface Props {
  onLoaded?: () => void;
}

// Friendly room labels
const ROOM_LABEL_ZH: Record<string, string> = {
  living: "客厅", master: "主卧", bedroom: "次卧", dining: "餐厅",
  kitchen: "厨房", bathroom: "卫浴", study: "书房", closet: "衣帽间",
};
const ROOM_LABEL_EN: Record<string, string> = {
  living: "Living", master: "Master", bedroom: "Bed", dining: "Dining",
  kitchen: "Kitchen", bathroom: "Bath", study: "Study", closet: "Closet",
};

/** Derive 3 representative swatch colors from a template's living room materials */
function getSwatches(tpl: StyleTemplate): string[] {
  const living = tpl.rooms.living;
  if (!living) return [tpl.accent];
  const colors: string[] = [];
  for (const key of ["wall", "floor", "light"] as const) {
    const id = living.materialIds[key];
    if (!id) continue;
    const mat = MATERIALS.find(m => m.id === id);
    if (mat?.color) colors.push(mat.color);
    if (colors.length >= 3) break;
  }
  if (colors.length === 0) colors.push(tpl.accent);
  return colors;
}

/** Real-material preview colors for a style card: the living room's actual
 *  wall color (top band), floor color (bottom band) and light color, so the
 *  card shows what the style looks like instead of an emoji + 3 dots. */
function getPreviewColors(tpl: StyleTemplate): { wall: string; floor: string; light: string } {
  const living = tpl.rooms.living;
  const colorOf = (key: "wall" | "floor" | "light"): string | undefined => {
    const id = living?.materialIds[key];
    if (!id) return undefined;
    return MATERIALS.find(m => m.id === id)?.color;
  };
  return {
    wall:  colorOf("wall")  ?? tpl.accent,
    floor: colorOf("floor") ?? "#C8A882",
    light: colorOf("light") ?? "#FFF2D0",
  };
}

export default function TemplatesPanel({ onLoaded }: Props) {
  const loadTemplate         = useDesignerStore(s => s.loadTemplate);
  const applyProjectTemplate = useDesignerStore(s => s.applyProjectTemplate);
  const setViewMode          = useDesignerStore(s => s.setViewMode);
  const enabledRooms         = useDesignerStore(s => s.floorPlans[s.activeFloor].enabledRooms);
  const activeTemplateId     = useDesignerStore(s => s.activeTemplateId);
  const locale               = useLocale();

  const [loading,    setLoading]    = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // Closed-loop result banner: after a style is applied, show the
  // whole-house overall total (incl. labor) so the user sees the quote
  // immediately instead of hunting for it in the right panel.
  const [appliedBanner, setAppliedBanner] = useState<{ name: string; total: number } | null>(null);

  // Style template handler
  const handleStyleClick = (id: string) => {
    if (confirming === id) {
      setConfirming(null);
      setLoading(id);
      setTimeout(() => {
        loadTemplate(id);
        setLoading(null);
        setViewMode("3d");
        const tpl = ALL_TEMPLATES.find(t => t.id === id);
        const total = useDesignerStore.getState().wholeHouseBreakdown().total;
        setAppliedBanner({ name: locale === "en" ? (tpl?.nameEn ?? id) : (tpl?.name ?? id), total });
        window.setTimeout(() => setAppliedBanner(null), 8000);
        onLoaded?.();
      }, 60);
    } else {
      setConfirming(id);
    }
  };

  // Project (house layout) template handler
  const handleProjectClick = (id: string) => {
    if (confirming === id) {
      setConfirming(null);
      setLoading(id);
      setTimeout(() => {
        applyProjectTemplate(id);
        setLoading(null);
        setViewMode("exterior");
        onLoaded?.();
      }, 60);
    } else {
      setConfirming(id);
    }
  };

  const cancelConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(null);
  };

  return (
    <div className="px-3 py-2 flex flex-col gap-5">

      {/* One-click result: style applied → whole-house total (incl. labor) */}
      {appliedBanner && (
        <div
          className="p-3 rounded-xl shrink-0"
          style={{ background: "#E8F1FF", border: "1px solid #CCE4FF" }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[12px] font-bold" style={{ color: "#0055B3" }}>
                ✅ {locale === "en" ? "Applied" : "已应用"} {appliedBanner.name}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: "#0055B3" }}>
                {locale === "en" ? "Whole-house total (incl. labor): " : "整屋总价（含人工）："}
                <span className="font-black">{formatPrice(appliedBanner.total, locale)}</span>
              </div>
              <div className="text-[9px] mt-0.5" style={{ color: "rgba(0,85,179,0.65)" }}>
                {locale === "en" ? "See the itemized breakdown in the right panel." : "分项明细见右侧报价面板。"}
              </div>
            </div>
            <button
              onClick={() => setAppliedBanner(null)}
              className="text-xs shrink-0"
              style={{ color: "#0055B3" }}
            >✕</button>
          </div>
        </div>
      )}

      {/* ════════════════════ 房屋样板 ════════════════════ */}
      <section>
        <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "var(--ds-text-3)" }}>
          {locale === "en" ? "🏠 House Templates" : "🏠 房屋样板"}
        </div>
        <div className="text-[9px] mb-2" style={{ color: "var(--ds-text-3)" }}>
          {locale === "en"
            ? "One click sets floors, rooms, exterior & yard"
            : "一键替换楼层布局、外观与庭院，覆盖全套设计"}
        </div>

        <div className="flex flex-col gap-2">
          {PROJECT_TEMPLATES.map((tpl: ProjectTemplate) => {
            const isConfirming = confirming === tpl.id;
            const isLoading    = loading    === tpl.id;
            const [c0, c1, c2] = tpl.palette;
            const accent       = c2; // sky / glass blue used as accent

            return (
              <div key={tpl.id}>
                <button
                  onClick={() => handleProjectClick(tpl.id)}
                  disabled={isLoading}
                  className="w-full flex items-start gap-2.5 p-2.5 rounded-xl text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.98]"
                  style={
                    isConfirming
                      ? { background: accent, border: `2px solid ${accent}`, boxShadow: `0 0 0 3px ${accent}40, 0 4px 12px ${accent}50`, transform: "scale(1.01)" }
                      : { background: "var(--ds-surface)", border: "1px solid var(--ds-border)", opacity: isLoading ? 0.6 : 1 }
                  }
                >
                  {/* Composed preview — wall on top, accent strip, roof
                      below (palette = [wall, roof, accent]); the emoji
                      sits on top so the card still reads at a glance. */}
                  <div
                    className="w-14 h-14 rounded-xl shrink-0 overflow-hidden relative mt-0.5 border border-black/10 flex flex-col"
                    title={locale === "en" ? `Wall ${c0} · Roof ${c1} · Accent ${c2}` : `墙面 ${c0} · 屋顶 ${c1} · 点缀 ${c2}`}
                  >
                    <div className="flex-1" style={{ background: c0 }} />
                    <div className="h-[3px] shrink-0" style={{ background: c2 }} />
                    <div className="h-[38%] shrink-0" style={{ background: c1 }} />
                    <span
                      className="absolute inset-0 flex items-center justify-center text-xl leading-none"
                      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))" }}
                    >
                      {tpl.emoji}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[12px] font-bold truncate" style={{ color: isConfirming ? "#fff" : "var(--ds-text)" }}>
                        {locale === "en" ? tpl.nameEn : tpl.name}
                      </span>
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
                        style={{
                          background: isConfirming ? "rgba(255,255,255,0.2)" : c0 + "80",
                          color: isConfirming ? "#fff" : "var(--ds-text-2)",
                          border: `1px solid ${isConfirming ? "rgba(255,255,255,0.3)" : c1 + "60"}`,
                        }}
                      >
                        {tpl.areaSqm}㎡
                      </span>
                    </div>
                    <div className="text-[10px] leading-snug" style={{ color: isConfirming ? "rgba(255,255,255,0.9)" : "var(--ds-text-3)" }}>
                      {isConfirming
                        ? (locale === "en" ? "👆 Tap again to apply!" : "👆 再点一次立即应用！")
                        : (locale === "en" ? tpl.descriptionEn : tpl.description)}
                    </div>
                  </div>

                  {isLoading
                    ? <div className="w-4 h-4 mt-1.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                    : isConfirming
                    ? <div className="w-7 h-7 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-base font-black" style={{ background: "rgba(255,255,255,0.3)", color: "#fff" }}>✓</div>
                    : <span className="text-[11px] shrink-0 mt-1.5" style={{ color: "var(--ds-text-3)" }}>→</span>
                  }
                </button>

                {isConfirming && (
                  <button
                    onClick={cancelConfirm}
                    className="w-full text-[10px] py-0.5 font-semibold transition-opacity hover:opacity-70 rounded-b-lg"
                    style={{ color: accent }}
                  >
                    {locale === "en" ? "✕ cancel" : "✕ 取消"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ════════════════════ 风格样板 ════════════════════ */}
      <section>
        <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "var(--ds-text-3)" }}>
          {locale === "en" ? "🎨 Style Templates" : "🎨 风格样板"}
        </div>
        <div className="text-[9px] mb-2.5" style={{ color: "var(--ds-text-3)" }}>
          {locale === "en"
            ? "One click replaces materials + furniture in all enabled rooms"
            : "一键替换所有已启用房间的材质与家具"}
        </div>

        <div className="flex flex-col gap-2">
          {ALL_TEMPLATES.map(tpl => {
            const isConfirming = confirming === tpl.id;
            const isLoading    = loading    === tpl.id;
            const isActive     = activeTemplateId === tpl.id && !isConfirming && !isLoading;
            const coveredRooms = enabledRooms.filter(r => tpl.rooms[r]);
            const swatches     = getSwatches(tpl);
            const preview      = getPreviewColors(tpl);

            return (
              <div key={tpl.id}>
                <button
                  onClick={() => handleStyleClick(tpl.id)}
                  disabled={isLoading}
                  className="w-full flex items-start gap-2.5 p-2.5 rounded-xl text-left transition-all duration-200 hover:scale-[1.01] active:scale-[0.98]"
                  style={
                    isConfirming
                      ? { background: tpl.accent, border: `2px solid ${tpl.accent}`, boxShadow: `0 0 0 3px ${tpl.accent}40, 0 4px 12px ${tpl.accent}50`, transform: "scale(1.01)" }
                      : isActive
                      ? { background: tpl.accent + "15", border: `2px solid ${tpl.accent}`, boxShadow: `0 0 0 2px ${tpl.accent}25` }
                      : { background: "var(--ds-surface)", border: "1px solid var(--ds-border)", opacity: isLoading ? 0.6 : 1 }
                  }
                >
                  {/* Composed preview — the template's REAL materials:
                      wall color on top, accent strip, floor color below,
                      with the style emoji on top. Users see the palette
                      instead of applying blind. */}
                  <div
                    className="w-14 h-14 rounded-xl shrink-0 overflow-hidden relative mt-0.5 border flex flex-col"
                    style={
                      isConfirming
                        ? { background: "rgba(255,255,255,0.25)", border: "1.5px solid rgba(255,255,255,0.5)" }
                        : { border: `1.5px solid ${tpl.accent}50` }
                    }
                    title={locale === "en" ? `Wall ${preview.wall} · Floor ${preview.floor}` : `墙面 ${preview.wall} · 地面 ${preview.floor}`}
                  >
                    <div className="flex-1" style={{ background: preview.wall }} />
                    <div className="h-[3px] shrink-0" style={{ background: tpl.accent }} />
                    <div className="h-[38%] shrink-0" style={{ background: preview.floor }} />
                    <span
                      className="absolute inset-0 flex items-center justify-center text-xl leading-none"
                      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))" }}
                    >
                      {tpl.emoji}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[12px] font-bold truncate" style={{ color: isConfirming ? "#fff" : "var(--ds-text)" }}>
                        {locale === "en" ? tpl.nameEn : tpl.name}
                      </span>
                      {!isConfirming && (
                        <div className="flex gap-0.5 shrink-0">
                          {swatches.map((c, i) => (
                            <div key={i} className="w-3 h-3 rounded-full" style={{ background: c, border: "1px solid rgba(0,0,0,0.12)", boxShadow: "0 1px 2px rgba(0,0,0,0.15)" }} />
                          ))}
                        </div>
                      )}
                      {isActive && (
                        <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full shrink-0" style={{ background: tpl.accent, color: "#fff" }}>
                          {locale === "en" ? "✓ ON" : "✓ 已应用"}
                        </span>
                      )}
                    </div>

                    <div className="text-[10px] leading-snug font-semibold" style={{ color: isConfirming ? "rgba(255,255,255,0.9)" : "var(--ds-text-3)" }}>
                      {isConfirming
                        ? (locale === "en" ? "👆 Tap again to apply!" : "👆 再点一次立即应用！")
                        : (locale === "en" ? tpl.descriptionEn : tpl.description)}
                    </div>

                    {coveredRooms.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {coveredRooms.map(r => (
                          <span
                            key={r}
                            className="text-[8px] px-1.5 py-0.5 rounded-full font-medium"
                            style={
                              isConfirming
                                ? { background: "rgba(255,255,255,0.2)", color: "#fff", border: "1px solid rgba(255,255,255,0.35)" }
                                : { background: tpl.accent + "20", color: tpl.accent, border: `1px solid ${tpl.accent}40` }
                            }
                          >
                            {locale === "en" ? ROOM_LABEL_EN[r] ?? r : ROOM_LABEL_ZH[r] ?? r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {isLoading ? (
                    <div className="w-4 h-4 mt-1.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                  ) : isConfirming ? (
                    <div className="w-7 h-7 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-base font-black" style={{ background: "rgba(255,255,255,0.3)", color: "#fff" }}>✓</div>
                  ) : isActive ? (
                    <div className="w-5 h-5 rounded-full shrink-0 mt-1.5 flex items-center justify-center text-[10px] font-black" style={{ background: tpl.accent, color: "#fff" }}>✓</div>
                  ) : (
                    <span className="text-[11px] shrink-0 mt-1.5" style={{ color: "var(--ds-text-3)" }}>→</span>
                  )}
                </button>

                {isConfirming && (
                  <button onClick={cancelConfirm} className="w-full text-[10px] py-0.5 font-semibold transition-opacity hover:opacity-70 rounded-b-lg" style={{ color: tpl.accent }}>
                    {locale === "en" ? "✕ cancel" : "✕ 取消"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 text-[9px] leading-relaxed px-1" style={{ color: "var(--ds-text-3)" }}>
          {locale === "en"
            ? "Materials & furniture will be replaced. Room dimensions and windows stay unchanged."
            : "材质和家具会被替换，房间尺寸与窗户位置保持不变。"}
        </div>
      </section>

    </div>
  );
}
