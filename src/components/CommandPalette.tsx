"use client";

/**
 * CommandPalette — Cmd+K / Ctrl+K command palette
 * Borrowed from pascal editor's command-palette pattern, using cmdk.
 *
 * Features:
 * - View mode switching
 * - Undo/redo
 * - Export / AI render triggers
 * - Room selection
 * - Style presets
 */

import { useEffect, useState, useCallback } from "react";
import { Command } from "cmdk";
import { useDesignerStore, useTemporalStore } from "@/lib/store";
import { useT } from "@/lib/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────
interface PaletteItem {
  id: string;
  label: string;
  icon?: string;
  group: string;
  shortcut?: string;
  action: () => void;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const t            = useT();
  const viewMode     = useDesignerStore(s => s.viewMode);
  const setViewMode  = useDesignerStore(s => s.setViewMode);
  const setExterior  = useDesignerStore(s => s.setExterior);
  const exterior     = useDesignerStore(s => s.exterior);
  const temporalUndo = useTemporalStore(s => s.undo);
  const temporalRedo = useTemporalStore(s => s.redo);
  const pastCount    = useTemporalStore(s => s.pastStates.length);
  const futureCount  = useTemporalStore(s => s.futureStates.length);

  // Open on Cmd+K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = useCallback((action: () => void) => {
    action();
    setOpen(false);
    setSearch("");
  }, []);

  // ── Command registry ──────────────────────────────────────────────────────
  const commands: PaletteItem[] = [
    // View modes
    { id: "view-3d",       label: "3D 室内视图",     icon: "🛋️", group: "视图", action: () => setViewMode("3d") },
    { id: "view-2d",       label: "2D 平面图",        icon: "📐", group: "视图", action: () => setViewMode("2d") },
    { id: "view-all",      label: "全局平面图",        icon: "🗺️", group: "视图", action: () => setViewMode("all") },
    { id: "view-exterior", label: "外立面 3D",         icon: "🏠", group: "视图", action: () => setViewMode("exterior") },
    { id: "view-yard2d",   label: "院子图",           icon: "🌿", group: "视图", action: () => setViewMode("yard2d") },
    { id: "view-global3d", label: "全局 3D",          icon: "🌐", group: "视图", action: () => setViewMode("global3d") },

    // Undo/redo
    { id: "undo", label: `撤销 (${pastCount}步)`,   icon: "↩", group: "编辑", shortcut: "⌘Z",  action: () => { if (pastCount > 0) temporalUndo(); } },
    { id: "redo", label: `重做 (${futureCount}步)`, icon: "↪", group: "编辑", shortcut: "⌘Y",  action: () => { if (futureCount > 0) temporalRedo(); } },

    // Actions
    { id: "export",    label: "导出方案 PDF",     icon: "📄", group: "操作", action: () => window.dispatchEvent(new Event("openExport")) },
    { id: "ai-render", label: "AI 渲染效果图",   icon: "🎨", group: "操作", action: () => window.dispatchEvent(new Event("openAiRender")) },
    { id: "import",    label: "导入参考图",       icon: "📷", group: "操作", action: () => window.dispatchEvent(new Event("openImport")) },
    { id: "share",     label: "分享方案链接",     icon: "🔗", group: "操作", action: () => window.dispatchEvent(new Event("openShare")) },

    // Style presets (exterior)
    { id: "preset-modern",  label: "外立面：现代简约",  icon: "🏢", group: "风格预设", action: () => setExterior({ preset: "modern",  roofStyle: "flat",    wallColor: "#F2EEE6", wallMaterial: "render",   roofColor: "#3A3A3A", accentColor: "#2A2A2A" }) },
    { id: "preset-chinese", label: "外立面：中式传统",  icon: "🏯", group: "风格预设", action: () => setExterior({ preset: "chinese", roofStyle: "chinese", wallColor: "#F0E8D0", wallMaterial: "render",   roofColor: "#1E2238", accentColor: "#882020" }) },
    { id: "preset-med",     label: "外立面：地中海",    icon: "🏛️", group: "风格预设", action: () => setExterior({ preset: "mediterranean", roofStyle: "hip", wallColor: "#FFF8E8", wallMaterial: "render", roofColor: "#B83820", accentColor: "#9B6B3A" }) },
    { id: "preset-euro",    label: "外立面：欧式古典",  icon: "🏰", group: "风格预设", action: () => setExterior({ preset: "european", roofStyle: "mansard", wallColor: "#E8D8C0", wallMaterial: "brick",   roofColor: "#4A5870", accentColor: "#7A7050" }) },
    { id: "preset-villa",   label: "外立面：现代别墅",  icon: "🏡", group: "风格预设", action: () => setExterior({ preset: "modern_villa", roofStyle: "gable", wallColor: "#FFFFFF", wallMaterial: "render", roofColor: "#2A4060", accentColor: "#2A4060" }) },

    // Floor count
    { id: "floors-1", label: "设为 1 层",  icon: "🏠", group: "楼层", action: () => setExterior({ floors: 1 }) },
    { id: "floors-2", label: "设为 2 层",  icon: "🏘️", group: "楼层", action: () => setExterior({ floors: 2 }) },
    { id: "floors-3", label: "设为 3 层",  icon: "🏢", group: "楼层", action: () => setExterior({ floors: 3 }) },
    { id: "floors-4", label: "设为 4 层",  icon: "🏬", group: "楼层", action: () => setExterior({ floors: 4 }) },
  ];

  // Group by section
  const groups = Array.from(new Set(commands.map(c => c.group)));

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-2xl overflow-hidden"
        style={{
          background: "var(--ds-surface)",
          border: "1px solid var(--ds-border)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
        }}
        onClick={e => e.stopPropagation()}
      >
        <Command className="flex flex-col" shouldFilter>
          {/* Search input */}
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--ds-border)" }}>
            <span className="text-gray-400">⌘</span>
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="输入命令或搜索…"
              autoFocus
              className="flex-1 bg-transparent outline-none text-sm placeholder-gray-400"
              style={{ color: "var(--ds-text)" }}
            />
            <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--ds-bg)", color: "var(--ds-text-3)", border: "1px solid var(--ds-border)" }}>ESC</kbd>
          </div>

          {/* Command list */}
          <Command.List className="max-h-80 overflow-y-auto p-1.5">
            <Command.Empty className="py-8 text-center text-sm text-gray-400">
              没有找到匹配的命令
            </Command.Empty>

            {groups.map(group => {
              const items = commands.filter(c => c.group === group);
              return (
                <Command.Group key={group}>
                  <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    {group}
                  </div>
                  {items.map(item => (
                    <Command.Item
                      key={item.id}
                      value={`${item.group} ${item.label}`}
                      onSelect={() => run(item.action)}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-pointer text-sm transition-colors"
                      style={{ color: "var(--ds-text)" }}
                    >
                      {item.icon && <span className="text-base w-5 text-center">{item.icon}</span>}
                      <span className="flex-1">{item.label}</span>
                      {item.shortcut && (
                        <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--ds-bg)", color: "var(--ds-text-3)", border: "1px solid var(--ds-border)" }}>
                          {item.shortcut}
                        </kbd>
                      )}
                      {item.id === `view-${viewMode}` && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "#EEF2FF", color: "#4F46E5" }}>当前</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>

          {/* Footer hint */}
          <div className="flex items-center gap-3 px-4 py-2 border-t text-[10px] text-gray-400" style={{ borderColor: "var(--ds-border)" }}>
            <span>↑↓ 导航</span>
            <span>↵ 执行</span>
            <span>ESC 关闭</span>
            <div className="flex-1" />
            <span>⌘K 打开/关闭</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
