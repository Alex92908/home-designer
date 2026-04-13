"use client";

import { useDesignerStore } from "@/lib/store";
import { useT, useLocaleStore } from "@/lib/i18n";

export default function TopBar() {
  const viewMode      = useDesignerStore((s) => s.viewMode);
  const setViewMode   = useDesignerStore((s) => s.setViewMode);
  const scores        = useDesignerStore((s) => s.scores);
  const roomClipboard = useDesignerStore((s) => s.roomClipboard);
  const t             = useT();
  const locale        = useLocaleStore((s) => s.locale);
  const setLocale     = useLocaleStore((s) => s.setLocale);

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
            <span className="hidden sm:block">{t.viewModes[mode]}</span>
          </button>
        ))}
      </div>

      {/* Style badge */}
      {scores.dominantStyle && (
        <div
          className="hidden md:flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full shrink-0"
          style={{ background: "#E8F1FF", color: "#0055B3", border: "1px solid #CCE4FF" }}
        >
          <span>✨</span>
          <span>{t.styleTags[scores.dominantStyle] ?? scores.dominantStyle}</span>
          <span style={{ color: "#C4B5FD" }}>·</span>
          <span>{scores.style}</span>
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
