"use client";

import { useDesignerStore } from "@/lib/store";
import { ROOM_DEFS } from "@/lib/types";
import { useT, useLocaleStore } from "@/lib/i18n";

export default function TopBar() {
  const activeRoom       = useDesignerStore((s) => s.activeRoom);
  const setActiveRoom    = useDesignerStore((s) => s.setActiveRoom);
  const viewMode         = useDesignerStore((s) => s.viewMode);
  const setViewMode      = useDesignerStore((s) => s.setViewMode);
  const scores           = useDesignerStore((s) => s.scores);
  const rooms            = useDesignerStore((s) => s.rooms);
  const enabledRooms     = useDesignerStore((s) => s.enabledRooms);
  const customRoomMeta   = useDesignerStore((s) => s.customRoomMeta);
  const roomClipboard    = useDesignerStore((s) => s.roomClipboard);
  const t                = useT();
  const locale           = useLocaleStore((s) => s.locale);
  const setLocale        = useLocaleStore((s) => s.setLocale);

  const openExport = () => window.dispatchEvent(new Event("openExport"));

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-1 shrink-0">
        <span className="text-xl">🏠</span>
        <span className="font-black text-gray-900 text-sm tracking-tight">{t.appName}</span>
        <span className="text-[10px] text-gray-400 font-medium bg-gray-100 px-1.5 py-0.5 rounded-full">{t.appTagline}</span>
      </div>

      {/* Room selector */}
      <div className="flex items-center gap-0.5 bg-gray-100 rounded-xl p-1 overflow-x-auto" style={{ maxWidth: "min(520px, 40vw)" }}>
        {enabledRooms.map((r) => {
          const def  = ROOM_DEFS[r];
          const meta = customRoomMeta[r];
          const name = meta?.name ?? def.name;
          const icon = meta?.icon ?? def.icon;
          const isActive = activeRoom === r && viewMode !== "all" && viewMode !== "exterior";
          const hasContent =
            Object.keys(rooms[r].materials).length > 0 ||
            rooms[r].placedItems.length > 0;

          return (
            <div key={r}>
              <button
                onClick={() => { setActiveRoom(r); if (viewMode === "all" || viewMode === "exterior") setViewMode("2d"); }}
                className={`
                  flex items-center gap-0.5 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150
                  ${isActive ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}
                `}
              >
                <span>{icon}</span>
                <span>{t.roomNames[r] ?? name}</span>
                {hasContent && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ml-0.5 shrink-0" />}
              </button>
            </div>
          );
        })}
      </div>

      {/* View mode toggle */}
      <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5 shrink-0">
        {(["3d","2d","all","exterior"] as const).map((mode) => (
          <button key={mode} onClick={() => setViewMode(mode)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
              viewMode === mode ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            }`}>
            <span>{t.viewIcons[mode]}</span>
            <span>{t.viewModes[mode]}</span>
          </button>
        ))}
      </div>

      {/* Style badge */}
      {scores.dominantStyle && (
        <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-blue-100 shrink-0">
          <span>✨</span>
          <span>{t.styleTags[scores.dominantStyle] ?? scores.dominantStyle}</span>
          <span className="text-blue-300">·</span>
          <span>{scores.style}</span>
        </div>
      )}

      {roomClipboard && (
        <div className="flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg shrink-0">
          <span>📋</span>
          <span>{roomClipboard.name}</span>
        </div>
      )}

      <div className="flex-1" />

      {/* Hint */}
      <span className="text-[11px] text-gray-400 hidden lg:block shrink-0">
        {t.hints[viewMode]}
      </span>

      {/* Language toggle */}
      <button
        onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
        className="flex items-center gap-1 px-2 py-1 rounded-lg border border-gray-200 text-[11px] text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors shrink-0 font-semibold"
        title="Switch language / 切换语言"
      >
        {locale === "zh" ? "🌐 EN" : "🌐 中"}
      </button>

      {/* Save/Export buttons */}
      <div className="flex items-center gap-1.5 shrink-0 ml-1">
        <div className="flex items-center gap-1 text-[10px] text-gray-400 hidden md:flex">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
          {t.autoSaved}
        </div>
        <button
          onClick={openExport}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors shrink-0"
        >
          <span>📄</span>
          <span>{t.exportPlan}</span>
        </button>
      </div>
    </header>
  );
}
