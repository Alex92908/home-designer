"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useDesignerStore, useTemporalStore } from "@/lib/store";
import { useT, useLocaleStore , customRoomDisplayName} from "@/lib/i18n";
import { ROOM_DEFS } from "@/lib/types";
import ShareButton from "./ShareButton";
import { useMcpBridge } from "@/lib/useMcpBridge";
import { useMemHudOpen, setMemHudOpen } from "@/lib/sceneDiag";

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
  const locale         = useLocaleStore((s) => s.locale);
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
  const activeLabel = isRooftopActive ? (locale === "en" ? "🏠Roof" : "🏠屋顶") : `${activeFloor + 1}F`;

  // Use inline pills for ≤5 total options (4 floors + optional rooftop); dropdown for more
  const useDropdown = totalOptions > 5;

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
              title={locale === "en" ? "Rooftop floor" : "屋顶层"}
              style={{
                background: isActive ? "#DC2626" : "transparent",
                color:      isActive ? "white" : "#DC2626",
                border:     "1.5px solid #DC2626",
              }}
            >
              {locale === "en" ? "🏠Roof" : "🏠天台"}
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
        title={locale === "en" ? "Switch floor" : "切换楼层"}
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
                title={hasRooftop ? (locale === "en" ? "Rooftop floor" : "屋顶层") : (locale === "en" ? "Click to enable rooftop floor" : "点击开启天台层")}
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
                {locale === "en" ? "🏠Roof" : "🏠屋顶"}
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  // MCP 命令桥：推送完整设计快照 + 拉取外部 agent（Claude Code 等）的设计命令并应用。
  useMcpBridge();
  const viewMode          = useDesignerStore((s) => s.viewMode);
  const setViewMode       = useDesignerStore((s) => s.setViewMode);
  const showCompass       = useDesignerStore((s) => s.showCompass);
  const toggleCompass     = useDesignerStore((s) => s.toggleCompass);
  // ⚙ 显示设置菜单(NSWE 方位标识 / 内存诊断面板)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBtnRef    = useRef<HTMLButtonElement>(null);
  const [settingsPos, setSettingsPos] = useState({ left: 0, top: 0 });
  const memHudOpen        = useMemHudOpen();
  const roomClipboard     = useDesignerStore((s) => s.roomClipboard);
  const activeRoom        = useDesignerStore((s) => s.activeRoom);
  const exterior          = useDesignerStore((s) => s.exterior);
  const customRoomMeta    = useDesignerStore((s) => s.customRoomMeta);
  const t               = useT();
  const locale          = useLocaleStore((s) => s.locale);
  const setLocale       = useLocaleStore((s) => s.setLocale);

  // Zundo temporal undo/redo (design state: floorPlans, exterior, budget)
  const temporalUndo     = useTemporalStore((s) => s.undo);
  const temporalRedo     = useTemporalStore((s) => s.redo);
  const pastCount        = useTemporalStore((s) => s.pastStates.length);
  const futureCount      = useTemporalStore((s) => s.futureStates.length);

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
  const roomLabel    = customRoomDisplayName(roomMeta, locale) ?? (locale === "en" ? (t.roomNames[activeRoom] ?? roomDef?.name ?? activeRoom) : (roomDef?.name ?? activeRoom));
  const roomIcon     = roomMeta?.icon ?? roomDef?.icon ?? "🏠";

  const openExport   = () => window.dispatchEvent(new Event("openExport"));

  return (
    <header
      // 窄屏（手机）放不下全部工具时允许横向滑动，而不是把右侧按钮裁掉。
      // scrollbarWidth:none 隐藏滚动条，overscroll-x-contain 防止把整页拖走。
      className="h-12 flex items-center px-2 sm:px-4 gap-2 sm:gap-3 shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain"
      style={{
        background: "var(--ds-surface)",
        borderBottom: "1px solid var(--ds-border)",
        boxShadow: "0 1px 0 var(--ds-border-soft), var(--ds-shadow-sm)",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
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
      </div>

      {/* Divider */}
      <div className="w-px h-5 shrink-0" style={{ background: "var(--ds-border)" }} />

      {/* View mode toggle */}
      <div
        className="flex items-center p-1 rounded-xl gap-0.5 shrink-0"
        style={{ background: "var(--ds-bg)", border: "1px solid var(--ds-border)" }}
      >
        {/* 设计流程步骤条 — 按真实工作顺序排列：布局 → 平面 → 装修 →
            全屋3D 成型 → 把房子放进院子 → 外观 = 房子+院子的整体合成。
            带 ①-⑥ 序号 + 连接箭头，让用户一眼看懂"我在第几步、下一步去哪"。
            仍是自由切换，只是叙事有了顺序。 */}
        {(["all", "2d", "3d", "global3d", "yard2d", "exterior"] as const).map((mode, i, arr) => {
          const isActive = viewMode === mode;
          return (
            <div key={mode} className="flex items-center">
              <button
                onClick={() => setViewMode(mode)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-all duration-150"
                style={
                  isActive
                    ? { background: "var(--ds-surface)", color: "var(--ds-text)", boxShadow: "var(--ds-shadow-sm)" }
                    : { color: "var(--ds-text-3)" }
                }
              >
                <span>{t.viewIcons[mode]}</span>
                <span className="hidden sm:block">{t.viewModes[mode]}</span>
              </button>
              {i < arr.length - 1 && (
                <span className="text-[9px] px-0.5 select-none" style={{ color: "var(--ds-text-3)", opacity: 0.5 }}>›</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Unified floor switcher — visible in all non-exterior views when multi-floor.
          原来是 hidden sm:flex —— 手机上楼层(1F/2F/天台)和当前房间名整块消失(用户实拍),
          而手机左栏可收起、没有别处显示楼层,反而更需要它。改为始终显示;顶栏本身横向
          可滚动,窄屏放得下。 */}
      {showFloorSwitcher && (
        <div className="flex items-center gap-1.5 shrink-0">
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

      {/* Undo / Redo buttons — 合并为统一的两个按钮。
          旧版按房间的家具/布局撤销已冗余：zundo 设计态历史追踪 floorPlans
          （含每个房间的 placedItems）+ exterior + budget，Ctrl+Z 同样会回退
          家具与布局变更，故移除旧版灰色 ↩ 按钮，只保留下面统一的撤销/重做。 */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Zundo design-state undo (Ctrl+Z) */}
        <button
          onClick={() => temporalUndo()}
          disabled={pastCount === 0}
          title={locale === "en" ? `Undo design action (Ctrl+Z) · ${pastCount} step(s) available` : `撤销设计操作 (Ctrl+Z) · ${pastCount} 步可撤销`}
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
          title={locale === "en" ? `Redo design action (Ctrl+Y) · ${futureCount} step(s) available` : `重做设计操作 (Ctrl+Y) · ${futureCount} 步可重做`}
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

      {/* ⚙ 设置菜单 —— 收纳零散的显示开关(NSWE 方位标识、内存诊断面板),
          避免顶栏被小按钮占满。点外部或选完自动关闭。 */}
      <div className="relative shrink-0">
        <button
          ref={settingsBtnRef}
          onClick={() => {
            // 顶栏是横向可滚动容器,absolute 子元素会被 overflow 裁掉(实测弹窗只剩空框)。
            // 故用 fixed + 按钮实时坐标定位,脱离裁剪。
            const r = settingsBtnRef.current?.getBoundingClientRect();
            if (r) {
              // 钳到视口内:手机上 ⚙ 常在顶栏靠右(x≈335/屏宽375),不钳的话 256px 宽的
              // 弹窗整块溢出屏幕外,看起来就像「没弹出/被盖住」(用户实拍)。
              const W = 256, M = 8;
              const left = Math.max(M, Math.min(r.left, window.innerWidth - W - M));
              setSettingsPos({ left, top: r.bottom + 6 });
            }
            setSettingsOpen(o => !o);
          }}
          title={locale === "en" ? "Display settings" : "显示设置"}
          className="flex items-center justify-center px-2 h-7 rounded-lg text-[11px] font-bold transition-all"
          style={{
            background: settingsOpen ? "var(--ds-bg-2)" : "transparent",
            border: "1px solid var(--ds-border)",
            color: "var(--ds-text-3)",
          }}
        >
          ⚙<span className="hidden sm:inline">&nbsp;{locale === "en" ? "View" : "显示"}</span>
        </button>
        {/* 用 Portal 挂到 body:顶栏带 backdrop-filter,是定位+层叠上下文 —— 放在里面的
            absolute 会被 overflow 裁成空框(PC 实拍),即使改 fixed 也被困在该上下文里、
            被外面的浮层盖住(手机实拍)。Portal 到 body 才彻底脱离两者。 */}
        {settingsOpen && createPortal(
          <>
            {/* 点外部关闭 */}
            <div className="fixed inset-0" style={{ zIndex: 99998 }} onClick={() => setSettingsOpen(false)} />
            {/* 样式对齐 AiEntryMenu(AI 助手弹窗):白卡 + 分节标题 + 图标/标题/副标题行。
                注意 CSS 变量必须带兜底值(--ds-surface, #fff),否则变量不存在时白底白字看不见。 */}
            <div
              className="fixed w-64 rounded-2xl overflow-hidden"
              style={{
                left: settingsPos.left, top: settingsPos.top, zIndex: 99999,
                background: "var(--ds-surface, #fff)",
                border: "1px solid var(--ds-border, #e5e7eb)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
              }}
            >
              <div
                className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest"
                style={{ color: "var(--ds-text-3, #9ca3af)", borderBottom: "1px solid var(--ds-border, #e5e7eb)" }}
              >
                {locale === "en" ? "Display" : "显示设置"}
              </div>

              {/* NSWE 方位标识:平面图/效果图/漫游图各墙上的 N/S/W/E 标签。
                  这是**全局显示偏好**,菜单里常驻 —— 原先按 viewMode 条件显示,
                  切到「整体布局」等视图时整个开关就消失了(用户实拍),很难找。 */}
              <button
                onClick={() => { toggleCompass(); setSettingsOpen(false); }}
                className="flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors hover:bg-teal-50"
                style={{ borderBottom: "1px solid var(--ds-border-soft, #f3f4f6)" }}
              >
                <span className="text-xl w-7 text-center shrink-0">🧭</span>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-semibold leading-tight" style={{ color: "var(--ds-text, #111)" }}>
                    {locale === "en" ? "NSWE labels" : "NSWE 方位标识"}
                  </span>
                  <span className="text-[10px] mt-0.5" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
                    {locale === "en" ? "Direction labels on walls" : "各面墙上的东南西北标签"}
                  </span>
                </div>
                <span className="text-[10px] font-bold shrink-0" style={{ color: showCompass ? "#DB2777" : "var(--ds-text-3, #9ca3af)" }}>
                  {showCompass ? (locale === "en" ? "ON" : "开") : (locale === "en" ? "OFF" : "关")}
                </span>
              </button>

              {/* 内存诊断面板:GPU/CPU贴图/帧缓冲/已下载分项,定位移动端 OOM */}
              <button
                onClick={() => { setMemHudOpen(!memHudOpen); setSettingsOpen(false); }}
                className="flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors hover:bg-indigo-50"
              >
                <span className="text-xl w-7 text-center shrink-0">📊</span>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-semibold leading-tight" style={{ color: "var(--ds-text, #111)" }}>
                    {locale === "en" ? "Memory panel" : "内存面板"}
                  </span>
                  <span className="text-[10px] mt-0.5" style={{ color: "var(--ds-text-3, #9ca3af)" }}>
                    {locale === "en" ? "GPU / textures / framebuffer" : "显存 · 贴图 · 帧缓冲分项"}
                  </span>
                </div>
                <span className="text-[10px] font-bold shrink-0" style={{ color: memHudOpen ? "#DB2777" : "var(--ds-text-3, #9ca3af)" }}>
                  {memHudOpen ? (locale === "en" ? "ON" : "开") : (locale === "en" ? "OFF" : "关")}
                </span>
              </button>
            </div>
          </>,
          document.body,
        )}
      </div>

      {/* 风格评分徽章已下线 —— 完整评分（风格/空间/采光 + 主导风格）已在
          右侧 RightPanel 常驻展示，顶栏不再重复占位。 */}

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
        title={locale === "en" ? "Command palette (⌘K)" : "命令面板 (⌘K)"}
      >
        <span>⌘K</span>
      </button>

      {/* 样板间入口（独立页 /showcase：精选方案的 3D 外形图画廊）。
          用 next/link 做客户端跳转 + 预取——比整页 <a> 跳转秒开、更可靠
          （重 R3F 应用整页 reload 慢，dev 首访还要现编译，容易被误当成
          "点了没反应"）。 */}
      <Link
        href="/showcase"
        prefetch
        className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0"
        style={{ border: "1px solid var(--ds-border)", color: "var(--ds-text-2)", background: "var(--ds-surface)" }}
        title={locale === "en" ? "Showroom — exterior gallery" : "样板间 — 外形图画廊"}
      >
        🏝️<span className="hidden sm:inline">&nbsp;{locale === "en" ? "Showroom" : "样板间"}</span>
      </Link>

      {/* 反馈入口（mailto → 作者邮箱，零依赖） */}
      <a
        href={`mailto:zhuwen160@gmail.com?subject=${encodeURIComponent(
          locale === "en" ? "ZHUYA feedback" : "筑雅 ZHUYA 反馈",
        )}&body=${encodeURIComponent(
          (locale === "en"
            ? "Describe your issue or suggestion:\n\n\n---\nPage: "
            : "请描述你的问题或建议：\n\n\n---\n页面：") +
            (typeof window !== "undefined" ? window.location.href : ""),
        )}`}
        className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0"
        style={{ border: "1px solid var(--ds-border)", color: "var(--ds-text-2)", background: "var(--ds-surface)" }}
        title={locale === "en" ? "Send feedback" : "反馈问题 / 建议"}
      >
        {locale === "en" ? "💬 Feedback" : "💬 反馈"}
      </a>

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

      {/* Auto-save 指示已下线（用户不需要，自动保存照常运行）。 */}
      <div className="flex items-center gap-2 shrink-0">
        {/* AI 渲染 + 导入参考图入口已统一到右下角「✨ AI 渲染」分层菜单（⚡一键 / 🎨选预设 / ✨生成式精修 / 📷导入参考图）。 */}

        <button onClick={openExport} className="ds-btn-primary flex items-center gap-1.5">
          <span>📄</span>
          <span>{t.exportPlan}</span>
        </button>
      </div>
    </header>
  );
}
