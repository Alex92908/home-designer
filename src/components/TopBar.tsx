"use client";

import { useDesignerStore } from "@/lib/store";
import { useT, useLocaleStore } from "@/lib/i18n";
import { ROOM_DEFS } from "@/lib/types";

export default function TopBar() {
  const viewMode          = useDesignerStore((s) => s.viewMode);
  const setViewMode       = useDesignerStore((s) => s.setViewMode);
  const scores            = useDesignerStore((s) => s.scores);
  const roomClipboard     = useDesignerStore((s) => s.roomClipboard);
  const activeRoom        = useDesignerStore((s) => s.activeRoom);
  const activeFloor       = useDesignerStore((s) => s.activeFloor);
  const exterior          = useDesignerStore((s) => s.exterior);
  const customRoomMeta    = useDesignerStore((s) => s.customRoomMeta);
  const furnitureHistory  = useDesignerStore((s) => s.furnitureHistory);
  const layoutHistory     = useDesignerStore((s) => s.layoutHistory);
  const undoFurniture     = useDesignerStore((s) => s.undoFurniture);
  const undoLayout        = useDesignerStore((s) => s.undoLayout);
  const t               = useT();
  const locale          = useLocaleStore((s) => s.locale);
  const setLocale       = useLocaleStore((s) => s.setLocale);

  const canUndo = viewMode === "all"
    ? layoutHistory.length > 0
    : furnitureHistory.length > 0;
  const handleUndo = viewMode === "all" ? undoLayout : undoFurniture;

  // Floor context: only meaningful in room-editing views (2d / 3d)
  const showFloorCtx = (viewMode === "2d" || viewMode === "3d") && exterior.floors > 1;
  const roomDef      = ROOM_DEFS[activeRoom];
  const roomMeta     = customRoomMeta[activeRoom];
  const roomLabel    = roomMeta?.name ?? (locale === "en" ? (t.roomNames[activeRoom] ?? roomDef?.name ?? activeRoom) : (roomDef?.name ?? activeRoom));
  const roomIcon     = roomMeta?.icon ?? roomDef?.icon ?? "🏠";

  const openExport = () => window.dispatchEvent(new Event("openExport"));

  return (
    <header
      className="h-12 flex items-center px-4 gap-3 shrink-0"
      style={{
        background: "var(--ds-surface)",
        borderBottom: "1px solid var(--ds-border)",
        boxShadow: "0 1px 0 var(--ds-border-soft), var(--ds-shadow-sm)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="w-7 h-7 rounded-xl flex items-center justify-center text-sm shrink-0"
          style={{ background: "#007AFF" }}
        >
          🏠
        </div>
        <span
          className="font-semibold text-sm tracking-tight"
          style={{ color: "var(--ds-text)", letterSpacing: "-0.02em" }}
        >
          {t.appName}
        </span>
        <span
          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
          style={{ background: "#E8F1FF", color: "#007AFF" }}
        >
          {t.appTagline}
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-5 shrink-0" style={{ background: "var(--ds-border)" }} />

      {/* View mode toggle */}
      <div
        className="flex items-center p-1 rounded-xl gap-0.5 shrink-0"
        style={{ background: "var(--ds-bg)", border: "1px solid var(--ds-border)" }}
      >
        {(["3d", "2d", "all", "global3d", "exterior"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-150"
            style={
              viewMode === mode
                ? { background: "var(--ds-surface)", color: "var(--ds-text)", boxShadow: "var(--ds-shadow-sm)" }
                : { color: "var(--ds-text-3)" }
            }
          >
            <span>{t.viewIcons[mode]}</span>
            <span className="hidden sm:block">{t.viewModes[mode]}</span>
          </button>
        ))}
      </div>

      {/* Floor + room context badge — visible in 2D/3D when multi-floor */}
      {showFloorCtx && (
        <div
          className="hidden sm:flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0"
          style={{
            background: activeFloor === 0 ? "#DBEAFE" : "#EDE9FE",
            color:      activeFloor === 0 ? "#1D4ED8" : "#6D28D9",
          }}
        >
          <span>{activeFloor + 1}F</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>{roomIcon}</span>
          <span>{roomLabel}</span>
        </div>
      )}

      {/* Undo button */}
      {viewMode !== "exterior" && (
        <button
          onClick={handleUndo}
          disabled={!canUndo}
          title={viewMode === "all" ? "撤销布局操作" : "撤销家具操作"}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-sm transition-all shrink-0 disabled:opacity-30"
          style={{
            background: canUndo ? "var(--ds-bg)" : "transparent",
            border: canUndo ? "1px solid var(--ds-border)" : "1px solid transparent",
            color: "var(--ds-text-2)",
          }}
        >
          ↩
        </button>
      )}

      {/* Style badge */}
      {scores.dominantStyle && (
        <div
          className="hidden md:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full shrink-0"
          style={{ background: "#E8F1FF", color: "#0055B3", border: "1px solid #CCE4FF" }}
          title={`${t.scoreStyle}: ${scores.style}/100`}
        >
          <span>✨</span>
          <span>{t.styleTags[scores.dominantStyle] ?? scores.dominantStyle}</span>
          <span style={{ color: "#C4B5FD" }}>·</span>
          <span style={{ color: "#007AFF" }}>{scores.style}</span>
          <span style={{ color: "#C4B5FD", fontSize: 9, fontWeight: 400 }}>/100</span>
        </div>
      )}

      {/* Room clipboard indicator */}
      {roomClipboard && (
        <div
          className="hidden lg:flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg shrink-0"
          style={{ background: "var(--ds-success-soft)", color: "var(--ds-success)", border: "1px solid #A7F3D0" }}
        >
          <span>📋</span>
          <span>{roomClipboard.name}</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Language toggle */}
      <button
        onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0"
        style={{ border: "1px solid var(--ds-border)", color: "var(--ds-text-2)", background: "var(--ds-surface)" }}
        title="Switch language / 切换语言"
      >
        {locale === "zh" ? "🌐 EN" : "🌐 中"}
      </button>

      {/* Auto-save + Export */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="hidden lg:flex items-center gap-1 text-[10px] font-medium"
          style={{ color: "var(--ds-text-3)" }}
        >
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--ds-success)" }} />
          {t.autoSaved}
        </div>
        <button onClick={openExport} className="ds-btn-primary flex items-center gap-1.5">
          <span>📄</span>
          <span>{t.exportPlan}</span>
        </button>
      </div>
    </header>
  );
}
