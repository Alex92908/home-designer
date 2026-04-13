"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS } from "@/lib/types";
import { useT, useLocaleStore } from "@/lib/i18n";

// ── Scrollable room tab strip with arrow + fade indicators ──
function RoomTabStrip() {
  const activeRoom     = useDesignerStore((s) => s.activeRoom);
  const setActiveRoom  = useDesignerStore((s) => s.setActiveRoom);
  const viewMode       = useDesignerStore((s) => s.viewMode);
  const setViewMode    = useDesignerStore((s) => s.setViewMode);
  const rooms          = useDesignerStore((s) => s.rooms);
  const enabledRooms   = useDesignerStore((s) => s.enabledRooms);
  const customRoomMeta = useDesignerStore((s) => s.customRoomMeta);
  const t              = useT();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft,  setCanLeft]  = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", updateArrows); ro.disconnect(); };
  }, [updateArrows, enabledRooms]);

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -120 : 120, behavior: "smooth" });
  };

  // Auto-scroll active tab into view when it changes
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLButtonElement>("[data-active='true']");
    active?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [activeRoom]);

  return (
    <div
      className="relative flex items-center shrink"
      style={{
        flex: "1 1 0",
        minWidth: 0,
        maxWidth: 620,
      }}
    >
      {/* Left arrow */}
      <button
        onClick={() => scroll("left")}
        className="absolute left-0 z-10 flex items-center justify-center w-6 h-full transition-all"
        style={{
          opacity: canLeft ? 1 : 0,
          pointerEvents: canLeft ? "auto" : "none",
          background: "linear-gradient(to right, var(--ds-bg) 60%, transparent)",
          color: "var(--ds-text-3)",
          fontSize: 11,
          borderRadius: "10px 0 0 10px",
        }}
        tabIndex={-1}
      >
        ‹
      </button>

      {/* Scrollable strip */}
      <div
        className="flex items-center gap-0.5 p-1 rounded-xl w-full"
        style={{
          background: "var(--ds-bg)",
          border: "1px solid var(--ds-border)",
          overflowX: "auto",
          scrollbarWidth: "none",
          // Mask edges for fade effect
          WebkitMaskImage: `linear-gradient(
            to right,
            transparent 0px,
            black ${canLeft ? "28px" : "0px"},
            black ${canRight ? "calc(100% - 28px)" : "100%"},
            transparent 100%
          )`,
          maskImage: `linear-gradient(
            to right,
            transparent 0px,
            black ${canLeft ? "28px" : "0px"},
            black ${canRight ? "calc(100% - 28px)" : "100%"},
            transparent 100%
          )`,
        }}
        ref={scrollRef}
      >
        {enabledRooms.map((r) => {
          const def      = ROOM_DEFS[r];
          const meta     = customRoomMeta[r];
          const name     = meta?.name ?? def.name;
          const icon     = meta?.icon ?? def.icon;
          const isActive = activeRoom === r && viewMode !== "all" && viewMode !== "exterior";
          const hasContent =
            Object.keys(rooms[r].materials).length > 0 ||
            rooms[r].placedItems.length > 0;

          return (
            <button
              key={r}
              data-active={isActive ? "true" : undefined}
              onClick={() => {
                setActiveRoom(r);
                if (viewMode === "all" || viewMode === "exterior") setViewMode("2d");
              }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 shrink-0"
              style={
                isActive
                  ? { background: "var(--ds-surface)", color: "var(--ds-text)", boxShadow: "var(--ds-shadow-sm)" }
                  : { color: "var(--ds-text-3)" }
              }
            >
              <span>{icon}</span>
              <span>{t.roomNames[r] ?? name}</span>
              {hasContent && (
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#007AFF" }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Right arrow */}
      <button
        onClick={() => scroll("right")}
        className="absolute right-0 z-10 flex items-center justify-center w-6 h-full transition-all"
        style={{
          opacity: canRight ? 1 : 0,
          pointerEvents: canRight ? "auto" : "none",
          background: "linear-gradient(to left, var(--ds-bg) 60%, transparent)",
          color: "var(--ds-text-3)",
          fontSize: 11,
          borderRadius: "0 10px 10px 0",
        }}
        tabIndex={-1}
      >
        ›
      </button>
    </div>
  );
}

export default function TopBar() {
  const viewMode       = useDesignerStore((s) => s.viewMode);
  const setViewMode    = useDesignerStore((s) => s.setViewMode);
  const scores         = useDesignerStore((s) => s.scores);
  const roomClipboard  = useDesignerStore((s) => s.roomClipboard);
  const t              = useT();
  const locale         = useLocaleStore((s) => s.locale);
  const setLocale      = useLocaleStore((s) => s.setLocale);

  const openExport = () => window.dispatchEvent(new Event("openExport"));

  return (
    <header
      className="h-14 flex items-center px-4 gap-3 shrink-0"
      style={{
        background: "var(--ds-surface)",
        borderBottom: "1px solid var(--ds-border)",
        boxShadow: "0 1px 0 var(--ds-border-soft), var(--ds-shadow-sm)",
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2 shrink-0">
        <div
          className="w-7 h-7 rounded-xl flex items-center justify-center text-sm shrink-0"
          style={{ background: "#007AFF" }}
        >
          🏠
        </div>
        <span
          className="font-semibold text-sm tracking-tight hidden sm:block"
          style={{ color: "var(--ds-text)", letterSpacing: "-0.02em" }}
        >
          {t.appName}
        </span>
        <span
          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full hidden sm:block"
          style={{ background: "#E8F1FF", color: "#007AFF" }}
        >
          {t.appTagline}
        </span>
      </div>

      {/* Room tabs — scrollable strip */}
      <RoomTabStrip />

      {/* View mode toggle */}
      <div
        className="flex items-center p-1 rounded-xl gap-0.5 shrink-0"
        style={{ background: "var(--ds-bg)", border: "1px solid var(--ds-border)" }}
      >
        {(["3d", "2d", "all", "exterior"] as const).map((mode) => (
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
            <span className="hidden md:block">{t.viewModes[mode]}</span>
          </button>
        ))}
      </div>

      {/* Style badge */}
      {scores.dominantStyle && (
        <div
          className="hidden lg:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full shrink-0"
          style={{ background: "#E8F1FF", color: "#0055B3", border: "1px solid #CCE4FF" }}
        >
          <span>✨</span>
          <span>{t.styleTags[scores.dominantStyle] ?? scores.dominantStyle}</span>
          <span style={{ color: "#C4B5FD" }}>·</span>
          <span>{scores.style}</span>
        </div>
      )}

      {roomClipboard && (
        <div
          className="hidden md:flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg shrink-0"
          style={{ background: "var(--ds-success-soft)", color: "var(--ds-success)", border: "1px solid #A7F3D0" }}
        >
          <span>📋</span>
          <span>{roomClipboard.name}</span>
        </div>
      )}

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
