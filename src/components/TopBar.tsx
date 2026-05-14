"use client";

import { useEffect, useRef, useState } from "react";
import { useDesignerStore, useTemporalStore } from "@/lib/store";
import { useT, useLocaleStore } from "@/lib/i18n";
import { ROOM_DEFS } from "@/lib/types";
import ShareButton from "./ShareButton";

const FLOOR_COLORS = ["#2563EB", "#7C3AED", "#059669", "#D97706", "#0891B2", "#BE185D"];

/**
 * Unified floor-switcher for the TopBar.
 * - ≤4 floors (+ optional rooftop): shows pill buttons inline.
 * - ≥5 floors or rooftop overflows: shows a compact dropdown "2F ▾" button.
 */
function FloorSwitcher() {
  const exterior       = useDesignerStore(s => s.exterior);
  const activeFloor    = useDesignerStore(s => s.activeFloor);
  const setActiveFloor = useDesignerStore(s => s.setActiveFloor);
  const setExterior    = useDesignerStore(s => s.setExterior);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { floors, hasRooftop } = exterior;
  const rooftopIdx = floors;
  const totalOptions = floors + (hasRooftop ? 1 : 0);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (floors <= 1 && !hasRooftop) return null;

  // Current floor label for dropdown trigger
  const isRooftopActive = hasRooftop && activeFloor === rooftopIdx;
  const activeColor = isRooftopActive ? "#DC2626" : FLOOR_COLORS[activeFloor % FLOOR_COLORS.length];
  const activeLabel = isRooftopActive ? "🏠屋顶" : `${activeFloor + 1}F`;

  // Use inline pills for ≤4 total options (fits nicely); dropdown for more
  const useDropdown = totalOptions > 4;

  const selectFloor = (idx: number) => {
    if (idx === rooftopIdx) {
      if (!hasRooftop) setExterior({ hasRooftop: true });
    }
    setActiveFloor(idx);
    setOpen(false);
  };

  if (!useDropdown) {
    // ── Inline pill buttons ───────────────────────────────────────────────
    return (
      <div className="flex items-center gap-1 shrink-0">
        {Array.from({ length: floors }).map((_, i) => {
          const isActive = activeFloor === i;
          const c = FLOOR_COLORS[i % FLOOR_COLORS.length];
          return (
            <button
              key={i}
              onClick={() => selectFloor(i)}
              className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold transition-all"
              style={{
                background: isActive ? c : "transparent",
                color:      isActive ? "white" : c,
                border:     `1.5px solid ${c}`,
              }}
            >
              {i + 1}F
            </button>
          );
        })}
        {hasRooftop && (() => {
          const isActive = activeFloor === rooftopIdx;
          return (
            <button
              onClick={() => selectFloor(rooftopIdx)}
              className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold transition-all"
              title="屋顶层"
              style={{
                background: isActive ? "#DC2626" : "transparent",
                color:      isActive ? "white" : "#DC2626",
                border:     "1.5px solid #DC2626",
              }}
            >
              🏠天台
            </button>
          );
        })()}
      </div>
    );
  }

  // ── Dropdown for 5+ floors ────────────────────────────────────────────────
  return (
    <div className="relative shrink-0" ref={ref}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold transition-all"
        style={{
          background: open ? activeColor : "transparent",
          color:      open ? "white" : activeColor,
          border:     `1.5px solid ${activeColor}`,
        }}
        title="切换楼层"
      >
        <span>{activeLabel}</span>
        <span style={{ fontSize: 8, opacity: 0.8 }}>▾</span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden shadow-xl"
          style={{
            background: "white",
            border: "1px solid #E5E7EB",
            minWidth: 80,
          }}
        >
          {Array.from({ length: floors }).map((_, i) => {
            const isActive = activeFloor === i;
            const c = FLOOR_COLORS[i % FLOOR_COLORS.length];
            return (
              <button
                key={i}
                onClick={() => selectFloor(i)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-bold transition-all hover:opacity-80"
                style={{
                  background: isActive ? c : "white",
                  color:      isActive ? "white" : c,
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: isActive ? "white" : c }}
                />
                {i + 1}F
              </button>
            );
          })}
          {/* Rooftop option */}
          {(() => {
            const isActive = hasRooftop && activeFloor === rooftopIdx;
            return (
              <button
                onClick={() => selectFloor(rooftopIdx)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] font-bold transition-all hover:opacity-80"
                title={hasRooftop ? "屋顶层" : "点击开启天台层"}
                style={{
                  background: isActive ? "#DC2626" : "white",
                  color:      isActive ? "white" : hasRooftop ? "#DC2626" : "#9CA3AF",
                  borderTop: "1px solid #F3F4F6",
                }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: isActive ? "white" : hasRooftop ? "#DC2626" : "#D1D5DB" }}
                />
                🏠屋顶
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// Sync design state to MCP server so AI agents can query/modify it
function useMCPSync() {
  const exterior = useDesignerStore(s => s.exterior);
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/mcp/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exterior }),
      }).catch(() => { /* silent — MCP sync is best-effort */ });
    }, 1500); // debounce
    return () => clearTimeout(timer);
  }, [exterior]);
}

export default function TopBar() {
  useMCPSync();
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

  // Zundo temporal undo/redo (design state: floorPlans, exterior, budget)
  const temporalUndo     = useTemporalStore((s) => s.undo);
  const temporalRedo     = useTemporalStore((s) => s.redo);
  const pastCount        = useTemporalStore((s) => s.pastStates.length);
  const futureCount      = useTemporalStore((s) => s.futureStates.length);

  const canUndo = viewMode === "all"
    ? layoutHistory.length > 0
    : furnitureHistory.length > 0;
  const handleUndo = viewMode === "all" ? undoLayout : undoFurniture;

  // Keyboard shortcuts: Ctrl+Z = temporal undo, Ctrl+Y / Ctrl+Shift+Z = temporal redo
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (pastCount > 0) temporalUndo();
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        if (futureCount > 0) temporalRedo();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [pastCount, futureCount, temporalUndo, temporalRedo]);

  // Floor switcher: show in all non-exterior views when multi-floor
  const showFloorSwitcher = viewMode !== "exterior" && viewMode !== "yard2d" && exterior.floors > 1;
  // Room label: only shown in 2d/3d (room-specific) views
  const showRoomCtx  = (viewMode === "2d" || viewMode === "3d") && exterior.floors > 1;
  const roomDef      = ROOM_DEFS[activeRoom];
  const roomMeta     = customRoomMeta[activeRoom];
  const roomLabel    = roomMeta?.name ?? (locale === "en" ? (t.roomNames[activeRoom] ?? roomDef?.name ?? activeRoom) : (roomDef?.name ?? activeRoom));
  const roomIcon     = roomMeta?.icon ?? roomDef?.icon ?? "🏠";

  const openExport   = () => window.dispatchEvent(new Event("openExport"));
  const openAiRender = () => window.dispatchEvent(new Event("openAiRender"));
  const openImport   = () => window.dispatchEvent(new Event("openImport"));

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
        {/* Primary tabs — all, 平面图, 效果图, 全局3D, 外观
            院子图 (yard2d) 已移除：用户在全局平面图缩小时就能看到院子，
            统一一个画布编辑，少一个 tab */}
        {(["all", "2d", "3d", "global3d", "exterior"] as const).map((mode) => {
          const isActive = viewMode === mode;
          return (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all duration-150"
              style={
                isActive
                  ? { background: "var(--ds-surface)", color: "var(--ds-text)", boxShadow: "var(--ds-shadow-sm)" }
                  : { color: "var(--ds-text-3)" }
              }
            >
              <span>{t.viewIcons[mode]}</span>
              <span className="hidden sm:block">{t.viewModes[mode]}</span>
            </button>
          );
        })}
      </div>

      {/* Unified floor switcher — visible in all non-exterior views when multi-floor */}
      {showFloorSwitcher && (
        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <FloorSwitcher />
          {/* Room label badge — only for 2d/3d where user is in a specific room */}
          {showRoomCtx && (
            <div
              className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "var(--ds-bg)", color: "var(--ds-text-2)", border: "1px solid var(--ds-border)" }}
            >
              <span>{roomIcon}</span>
              <span>{roomLabel}</span>
            </div>
          )}
        </div>
      )}

      {/* Undo / Redo buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Legacy per-room undo (furniture / layout) */}
        {viewMode !== "exterior" && (
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            title={viewMode === "all" ? "撤销布局操作" : "撤销家具操作"}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-sm transition-all disabled:opacity-30"
            style={{
              background: canUndo ? "var(--ds-bg)" : "transparent",
              border: canUndo ? "1px solid var(--ds-border)" : "1px solid transparent",
              color: "var(--ds-text-2)",
            }}
          >
            ↩
          </button>
        )}
        {/* Zundo design-state undo (Ctrl+Z) */}
        <button
          onClick={() => temporalUndo()}
          disabled={pastCount === 0}
          title={`撤销设计操作 (Ctrl+Z) · ${pastCount} 步可撤销`}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-sm transition-all disabled:opacity-30"
          style={{
            background: pastCount > 0 ? "#EEF2FF" : "transparent",
            border: pastCount > 0 ? "1px solid #C7D2FE" : "1px solid transparent",
            color: "#4F46E5",
          }}
        >
          ↩
        </button>
        {/* Zundo design-state redo (Ctrl+Y) */}
        <button
          onClick={() => temporalRedo()}
          disabled={futureCount === 0}
          title={`重做设计操作 (Ctrl+Y) · ${futureCount} 步可重做`}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-sm transition-all disabled:opacity-30"
          style={{
            background: futureCount > 0 ? "#EEF2FF" : "transparent",
            border: futureCount > 0 ? "1px solid #C7D2FE" : "1px solid transparent",
            color: "#4F46E5",
          }}
        >
          ↪
        </button>
      </div>

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

      {/* Command palette hint */}
      <button
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))}
        className="hidden md:flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-all shrink-0"
        style={{ border: "1px solid var(--ds-border)", color: "var(--ds-text-3)", background: "var(--ds-bg)" }}
        title="命令面板 (⌘K)"
      >
        <span>⌘K</span>
      </button>

      {/* Share button */}
      <ShareButton />

      {/* Language toggle */}
      <button
        onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0"
        style={{ border: "1px solid var(--ds-border)", color: "var(--ds-text-2)", background: "var(--ds-surface)" }}
        title="Switch language / 切换语言"
      >
        {locale === "zh" ? "🌐 EN" : "🌐 中"}
      </button>

      {/* Auto-save + AI actions + Export */}
      <div className="flex items-center gap-2 shrink-0">
        <div
          className="hidden lg:flex items-center gap-1 text-[10px] font-medium"
          style={{ color: "var(--ds-text-3)" }}
        >
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--ds-success)" }} />
          {t.autoSaved}
        </div>

        {/* Import reference photo */}
        <button
          onClick={openImport}
          className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
          style={{
            border: "1px dashed #6366f1",
            color: "#4f46e5",
            background: "#eef2ff",
          }}
          title="上传参考图，AI 自动识别建筑风格">
          📷 <span className="hidden md:inline">导入参考图</span>
        </button>

        {/* AI render */}
        <button
          onClick={openAiRender}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white transition-all"
          style={{ background: "linear-gradient(135deg,#6366f1,#818cf8)" }}
          title="AI 渲染效果图">
          🎨 <span className="hidden md:inline">AI 渲染</span>
        </button>

        <button onClick={openExport} className="ds-btn-primary flex items-center gap-1.5">
          <span>📄</span>
          <span>{t.exportPlan}</span>
        </button>
      </div>
    </header>
  );
}
