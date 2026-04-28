"use client";

// Side-effect import: kicks off preload of the most common 3D assets
// 150ms after mount, so by the time the user opens 3D/全局/外观 views
// many GLTFs are already warm in the HTTP cache.
import "@/lib/preload";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import LeftPanel from "@/components/LeftPanel";
import RightPanel from "@/components/RightPanel";
import ExteriorPanel from "@/components/ExteriorPanel";
import TopBar from "@/components/TopBar";
import RoomSidebar from "@/components/RoomSidebar";
import RightPanelAll from "@/components/RightPanelAll";
import ExportModal from "@/components/ExportModal";
import ShareModal from "@/components/ShareModal";
import FloorPlan from "@/components/FloorPlan";
import FloorPlanAll, { RoomPanel as FloorPlanAllRoomPanel } from "@/components/FloorPlanAll";
import YardPlan, { YardPlanLibrary, YardPlanInspector } from "@/components/YardPlan";
// import OnboardingOverlay from "@/components/OnboardingOverlay";  // TODO: enable when ready
import AiRenderModal from "@/components/AiRenderModal";
import { useDesignerStore } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { decodeShare } from "@/lib/share";

function CanvasLoading({ bg, msgKey }: { bg: string; msgKey: "loading3dScene" | "loadingExteriorScene" | "global3dLoading" }) {
  const t = useT();
  return (
    <div className={`flex-1 flex items-center justify-center w-full h-full ${bg}`}>
      <div className="text-gray-400 text-sm animate-pulse">{t[msgKey]}</div>
    </div>
  );
}

const RoomCanvas = dynamic(() => import("@/components/RoomCanvas"), {
  ssr: false,
  loading: () => <CanvasLoading bg="bg-gray-900" msgKey="loading3dScene" />,
});

const HouseCanvas = dynamic(() => import("@/components/HouseCanvas"), {
  ssr: false,
  loading: () => <CanvasLoading bg="bg-gray-900" msgKey="loadingExteriorScene" />,
});

const GlobalCanvas = dynamic(() => import("@/components/GlobalCanvas"), {
  ssr: false,
  loading: () => <CanvasLoading bg="bg-gray-200" msgKey="global3dLoading" />,
});

// ─── Panel toggle tab button ──────────────────────────────
/** Cycles front-wall opacity: 0 → 0.5 → 1 → 0. Lets user see artwork
 *  placed on the front wall, which is cut away in the default dollhouse
 *  view. "0.5" is a frosted-glass look, "1" is a normal solid wall. */
function FrontWallToggle() {
  const opacity = useDesignerStore(s => s.frontWallOpacity);
  const setOpacity = useDesignerStore(s => s.setFrontWallOpacity);
  const t = useT();
  const label = opacity === 0 ? t.wallToggleHide : opacity === 0.5 ? t.wallToggleHalf : t.wallToggleSolid;
  const next = opacity === 0 ? 0.5 : opacity === 0.5 ? 1 : 0;
  const bg = opacity === 0 ? "rgba(30,30,50,0.72)"
           : opacity === 0.5 ? "rgba(59,130,246,0.9)"
           : "rgba(16,185,129,0.9)";
  return (
    <button
      onClick={() => setOpacity(next)}
      className="absolute bottom-4 left-4 z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold shadow-lg transition-all active:scale-95"
      style={{
        background: bg,
        color: "white",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
      title={t.wallToggleTitle}
    >
      {label}
    </button>
  );
}

/** Cycles ceiling opacity — same 3-stage UX as FrontWallToggle but for
 *  the top slab. Stacked right above the front-wall button. */
function CeilingToggle() {
  const opacity = useDesignerStore(s => s.ceilingOpacity);
  const setOpacity = useDesignerStore(s => s.setCeilingOpacity);
  const t = useT();
  const label = opacity === 0 ? t.ceilToggleHide : opacity === 0.5 ? t.ceilToggleHalf : t.ceilToggleSolid;
  const next = (opacity === 0 ? 0.5 : opacity === 0.5 ? 1 : 0) as 0 | 0.5 | 1;
  const bg = opacity === 0 ? "rgba(30,30,50,0.72)"
           : opacity === 0.5 ? "rgba(59,130,246,0.9)"
           : "rgba(16,185,129,0.9)";
  return (
    <button
      onClick={() => setOpacity(next)}
      className="absolute bottom-14 left-4 z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold shadow-lg transition-all active:scale-95"
      style={{
        background: bg,
        color: "white",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
      title={t.ceilToggleTitle}
    >
      {label}
    </button>
  );
}

function PanelToggle({
  side,
  open,
  onClick,
}: {
  side: "left" | "right";
  open: boolean;
  onClick: () => void;
}) {
  // Chevron direction: when left panel is open → show ◀ (collapse), closed → ▶ (expand)
  const chevron =
    side === "left"
      ? open ? "◀" : "▶"
      : open ? "▶" : "◀";

  const posClass =
    side === "left"
      ? "left-0 rounded-r-xl"
      : "right-0 rounded-l-xl";

  return (
    <button
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 z-20 flex items-center justify-center
        w-5 h-12 text-[11px] font-bold transition-all active:scale-95 select-none ${posClass}`}
      style={{
        background: "rgba(30,30,50,0.72)",
        color: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
      title={open ? "收起" : "展开"}
    >
      {chevron}
    </button>
  );
}

export default function Home() {
  const viewMode      = useDesignerStore((s) => s.viewMode);
  const loadFromShare = useDesignerStore((s) => s.loadFromShare);
  const t = useT();

  // Panels start OPEN on both server and client to avoid hydration
  // mismatch (server can't know window.innerWidth). A useEffect after
  // mount collapses them on mobile — a one-frame visual flash but no
  // React warning.
  const [leftOpen,  setLeftOpen]  = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [showAiRender, setShowAiRender] = useState(false);
  // zustand persist 在客户端水合时会用 localStorage 里的值覆盖 initial
  // state（比如 activeRoom / viewMode / floorPlans），和 SSR 渲出来的
  // 默认值不一致 → React 报 hydration mismatch（移动端 Chrome 尤其
  // 敏感）。等第一次 useEffect 跑完再渲染真正依赖 store 的内容。
  const [mounted, setMounted] = useState(false);

  // After mount, collapse panels on mobile viewports + flip mounted flag.
  useEffect(() => {
    setMounted(true);
    if (window.innerWidth < 768) {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, []);

  // Auto-collapse panels when switching to 2D / all / exterior on mobile
  useEffect(() => {
    if (window.innerWidth < 768) {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, [viewMode]);

  const isAll      = viewMode === "all";
  const isExterior = viewMode === "exterior";
  const isGlobal3d = viewMode === "global3d";
  const isYard2d   = viewMode === "yard2d";

  // Per-side panel routing. Each side picks the component that applies to
  // the current view (or null if that side has no panel in this view).
  // The room-sidebar (thin icon column) is its own separate left rail that
  // shows only in room/2d views.
  const showRoomSidebar = !isAll && !isExterior && !isGlobal3d && !isYard2d;
  const leftPanel = isAll
    ? <FloorPlanAllRoomPanel />
    : isYard2d ? <YardPlanLibrary />
    : (!isExterior && !isGlobal3d) ? <LeftPanel /> : null;
  const leftPanelWidth = isAll ? 224 : (isYard2d ? 240 : 256); // RoomPanel w-56
  const rightPanel = isAll
    ? <RightPanelAll />
    : isExterior ? <ExteriorPanel />
    : isYard2d   ? <YardPlanInspector />
    : isGlobal3d ? null
    : <RightPanel />;
  const rightPanelWidth = isExterior ? 256 : 288; // ExteriorPanel uses w-64
  const hasLeftPanel  = leftPanel  !== null;
  const hasRightPanel = rightPanel !== null;

  // Load shared plan from URL ?share= param (runs once after hydration)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("share");
    if (!encoded) return;
    const snapshot = decodeShare(encoded);
    if (snapshot) {
      loadFromShare(snapshot);
      const url = new URL(window.location.href);
      url.searchParams.delete("share");
      window.history.replaceState({}, "", url.toString());
    }
  }, [loadFromShare]);

  // Server render / pre-hydration: 只渲骨架（背景 + footer 占位）避免
  // zustand persist 水合后状态跳变触发 hydration mismatch。
  if (!mounted) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 overflow-hidden" suppressHydrationWarning>
        <div className="flex-1 flex items-center justify-center text-[11px] text-gray-300">
          加载中…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">

        {/* Room sidebar — always visible in room/2d views */}
        {showRoomSidebar && <RoomSidebar />}

        {/* Left panel with collapse — used by all views that have a left panel
            (LeftPanel in 3D/2D, FloorPlanAll's RoomPanel in 全局). */}
        {hasLeftPanel && (
          <div
            className="shrink-0 h-full overflow-hidden transition-all duration-300"
            style={{ width: leftOpen ? leftPanelWidth : 0 }}
          >
            {leftPanel}
          </div>
        )}

        {/* Main canvas + toggle buttons */}
        <main className="flex-1 relative overflow-hidden">
          {hasLeftPanel && (
            <PanelToggle side="left" open={leftOpen} onClick={() => setLeftOpen(v => !v)} />
          )}
          {hasRightPanel && (
            <PanelToggle side="right" open={rightOpen} onClick={() => setRightOpen(v => !v)} />
          )}

          {viewMode === "3d"       && <RoomCanvas />}
          {isExterior              && <HouseCanvas />}
          {isAll                   && <FloorPlanAll />}
          {isGlobal3d              && <GlobalCanvas />}
          {isYard2d                && <YardPlan />}
          {viewMode === "2d"       && <FloorPlan />}

          {/* AI Render floating button */}
          {(viewMode === "3d" || isExterior) && (
            <button
              onClick={() => setShowAiRender(true)}
              className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl text-white text-xs font-semibold shadow-lg transition-all active:scale-95 hover:scale-105"
              style={{
                background: "linear-gradient(135deg, #6366f1, #818cf8)",
                backdropFilter: "blur(6px)",
              }}
              title={t.aiRenderTitle}
            >
              {t.aiRenderBtn}
            </button>
          )}

          {/* Front wall + ceiling toggles — both in 3D only */}
          {viewMode === "3d" && <FrontWallToggle />}
          {viewMode === "3d" && <CeilingToggle />}
        </main>

        {/* Right panel with collapse — used by 3D/2D (RightPanel), 全局
            (RightPanelAll), and 外观 (ExteriorPanel). */}
        {hasRightPanel && (
          <div
            className="shrink-0 h-full overflow-hidden transition-all duration-300"
            style={{ width: rightOpen ? rightPanelWidth : 0 }}
          >
            {rightPanel}
          </div>
        )}
      </div>
      <ExportModal />
      <ShareModal />
      <AiRenderModal open={showAiRender} onClose={() => setShowAiRender(false)} />
      {/* <OnboardingOverlay /> */}
      <footer className="h-6 bg-white border-t border-gray-100 flex items-center justify-center shrink-0">
        <span className="text-[10px] text-gray-400">{t.disclaimer}</span>
      </footer>
    </div>
  );
}
