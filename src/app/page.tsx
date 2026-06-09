"use client";

// Side-effect import: kicks off preload of the most common 3D assets
// 150ms after mount, so by the time the user opens 3D/全局/外观 views
// many GLTFs are already warm in the HTTP cache.
import "@/lib/preload";

// Module-level flag: tracks whether we've triggered the sample-load this
// browser session. Survives React Strict Mode's double-invocation of effects
// (which resets useState/useRef, but NOT module-level variables).
const _VISITED_KEY = "home-designer-visited";
let _sampleLoadedThisSession = false;
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import LeftPanel from "@/components/LeftPanel";
import RightPanel from "@/components/RightPanel";
import ExteriorPanel from "@/components/ExteriorPanel";
import ExteriorRoomList from "@/components/ExteriorRoomList";
import TopBar from "@/components/TopBar";
import RoomSidebar from "@/components/RoomSidebar";
import RightPanelAll from "@/components/RightPanelAll";
import ExportModal from "@/components/ExportModal";
import ShareModal from "@/components/ShareModal";
import FloorPlan from "@/components/FloorPlan";
import AiEntryMenu from "@/components/AiEntryMenu";
import FloorPlanAll, { RoomPanel as FloorPlanAllRoomPanel } from "@/components/FloorPlanAll";
import YardPlan, { YardPlanLibrary, YardPlanInspector } from "@/components/YardPlan";
// import OnboardingOverlay from "@/components/OnboardingOverlay";  // TODO: enable when ready
import AiRenderModal from "@/components/AiRenderModal";
import ImageImportModal from "@/components/ImageImportModal";
import CommandPalette from "@/components/CommandPalette";
import { useDesignerStore } from "@/lib/store";
import { useT, useLocale, useLocaleStore } from "@/lib/i18n";
import { decodeShare } from "@/lib/share";
import { decodeSnapshot } from "@/lib/shareUrl";
import { getSampleGlassVillaFloorPlans, SAMPLE_GLASS_VILLA_EXTERIOR } from "@/lib/sampleGlassVilla";

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
/** Cycles south-wall opacity: 0 → 0.5 → 1 → 0. Lets user see artwork
 *  placed on the south wall, which is cut away in the default dollhouse
 *  view (camera looks north → south wall is closest to viewer).
 *  "0.5" is a frosted-glass look, "1" is a normal solid wall. */
function SouthWallToggle() {
  const opacity = useDesignerStore(s => s.southWallOpacity);
  const setOpacity = useDesignerStore(s => s.setSouthWallOpacity);
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

/** Cycles ceiling opacity — same 3-stage UX as SouthWallToggle but for
 *  the top slab. Stacked right above the south-wall button. */
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
  const viewMode           = useDesignerStore((s) => s.viewMode);
  const setViewMode        = useDesignerStore((s) => s.setViewMode);
  const loadFromShare      = useDesignerStore((s) => s.loadFromShare);
  const aiRenderRequested  = useDesignerStore((s) => s.aiRenderRequested);
  const clearAiRenderRequest = useDesignerStore((s) => s.clearAiRenderRequest);
  const activeRoom         = useDesignerStore((s) => s.activeRoom);
  const activeFloor        = useDesignerStore((s) => s.activeFloor);
  const setActiveFloor     = useDesignerStore((s) => s.setActiveFloor);
  const setActiveRoom      = useDesignerStore((s) => s.setActiveRoom);
  const floorPlans         = useDesignerStore((s) => s.floorPlans);
  const t = useT();
  const locale = useLocale();

  // Panels start OPEN on both server and client to avoid hydration
  // mismatch (server can't know window.innerWidth). A useEffect after
  // mount collapses them on mobile — a one-frame visual flash but no
  // React warning.
  const [leftOpen,  setLeftOpen]  = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [showAiRender,  setShowAiRender]  = useState(false);
  const [showImport,    setShowImport]    = useState(false);
  // zustand persist 在客户端水合时会用 localStorage 里的值覆盖 initial
  // state（比如 activeRoom / viewMode / floorPlans），和 SSR 渲出来的
  // 默认值不一致 → React 报 hydration mismatch（移动端 Chrome 尤其
  // 敏感）。等第一次 useEffect 跑完再渲染真正依赖 store 的内容。
  const [mounted, setMounted] = useState(false);

  // After mount, collapse panels on mobile viewports + flip mounted flag.
  // On first-ever visit (no persisted state), load the glass-villa sample so
  // new users immediately see a complete coherent design across all views.
  useEffect(() => {
    setMounted(true);
    if (window.innerWidth < 768) {
      setLeftOpen(false);
      setRightOpen(false);
    }

    // First-visit: load sample data + show a DOM-injected welcome banner.
    // We use direct DOM injection (not React state) because zustand's
    // useSyncExternalStore triggers synchronous re-renders that race with
    // useState updates. Direct DOM manipulation is immune to this.
    const isFirstVisit = !localStorage.getItem(_VISITED_KEY);
    if (isFirstVisit && !_sampleLoadedThisSession) {
      _sampleLoadedThisSession = true;
      localStorage.setItem(_VISITED_KEY, "1");
      useDesignerStore.setState(s => ({
        floorPlans: getSampleGlassVillaFloorPlans(),
        exterior: { ...s.exterior, ...(SAMPLE_GLASS_VILLA_EXTERIOR as Partial<typeof s.exterior>) },
        activeFloor: 0,
        activeRoom: "living" as const,
        viewMode: "all" as const,
      }));

      // Inject the welcome banner directly into the DOM — synchronously inside
      // the effect so it's guaranteed to fire on every first-visit page load.
      if (!document.getElementById("sample-welcome-banner")) {
        const locale = useLocaleStore.getState().locale;
        const el = document.createElement("div");
        el.id = "sample-welcome-banner";
        el.style.cssText = [
          "position:fixed",
          "top:64px",
          "left:50%",
          "transform:translateX(-50%)",
          "z-index:9999",
          "display:flex",
          "align-items:center",
          "gap:12px",
          "padding:10px 16px",
          "border-radius:16px",
          "background:linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,58,95,0.95))",
          "backdrop-filter:blur(14px)",
          "border:1px solid rgba(99,102,241,0.55)",
          "color:white",
          "font-size:12px",
          "font-family:inherit",
          "box-shadow:0 8px 32px rgba(0,0,0,0.4)",
          "min-width:260px",
          "max-width:min(500px,calc(100vw - 32px))",
          "animation:fadeInDown 0.5s ease",
          "pointer-events:auto",
        ].join(";");
        el.innerHTML = `
          <span style="font-size:22px;flex-shrink:0">🏡</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:12px;color:#BFDBFE;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${locale === "en" ? "Modern Glass-Curtain Villa · sample loaded" : "现代玻璃幕墙别墅 · 样板已加载"}</div>
            <div style="font-size:10px;color:rgba(191,219,254,0.6);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${locale === "en" ? "Click the tabs in order → Floor Plan → Render → Global 3D → Exterior" : "依次点击标签探索 → 平面图 → 效果图 → 全局3D → 外观"}</div>
          </div>
          <button id="sample-banner-close" style="flex-shrink:0;width:20px;height:20px;border:none;background:rgba(255,255,255,0.1);border-radius:50%;color:white;font-size:9px;cursor:pointer;opacity:0.6;display:flex;align-items:center;justify-content:center">✕</button>
        `;
        document.body.appendChild(el);
        document.getElementById("sample-banner-close")?.addEventListener("click", () => el.remove());
        setTimeout(() => el.remove(), 7000);
      }
    }
  }, []);

  // Auto-collapse panels when switching to 2D / all / exterior on mobile
  useEffect(() => {
    if (window.innerWidth < 768) {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, [viewMode]);

  // When any component calls requestAiRender() (e.g. VillaTo3D after
  // adding a GLB model), open AiRenderModal and clear the flag.
  useEffect(() => {
    if (aiRenderRequested) {
      setShowAiRender(true);
      clearAiRenderRequest();
    }
  }, [aiRenderRequested, clearAiRenderRequest]);

  // Canonical view-mode groups
  const isAll      = viewMode === "all";
  const isYard2d   = viewMode === "yard2d";
  const isGlobal3d = viewMode === "global3d";
  const isExterior = viewMode === "exterior" || isYard2d;

  // Per-side panel routing.
  const showRoomSidebar = !isAll && !isExterior && !isGlobal3d;
  const leftPanel = isAll
    ? <FloorPlanAllRoomPanel />
    : isYard2d ? <YardPlanLibrary />
    : (viewMode === "exterior") ? <ExteriorRoomList />
    : (viewMode === "3d" || viewMode === "2d" || isGlobal3d) ? <LeftPanel />
    : null;
  const leftPanelWidth = isAll ? 224 : isYard2d ? 200 : (viewMode === "exterior") ? 232 : 256;
  const rightPanel = isAll
    ? <RightPanelAll />
    : isYard2d    ? <YardPlanInspector />
    : isExterior  ? <ExteriorPanel />
    : <RightPanel />;
  const rightPanelWidth = isExterior ? 256 : 288;
  const hasLeftPanel  = leftPanel  !== null;
  const hasRightPanel = rightPanel !== null;

  // Listen for TopBar-dispatched events (same pattern as openExport)
  useEffect(() => {
    const onAiRender = () => setShowAiRender(true);
    const onImport   = () => setShowImport(true);
    window.addEventListener("openAiRender", onAiRender);
    window.addEventListener("openImport",   onImport);
    return () => {
      window.removeEventListener("openAiRender", onAiRender);
      window.removeEventListener("openImport",   onImport);
    };
  }, []);

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

  // Load exterior-only view snapshot from ?loadView= (from /view page "在设计器中编辑" button)
  const setExterior    = useDesignerStore(s => s.setExterior);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("loadView");
    if (!encoded) return;
    decodeSnapshot(encoded).then(data => {
      setExterior(data.exterior);
      setActiveFloor(0);
      if (data.floors[0]?.yardPlan) {
        useDesignerStore.setState(s => {
          const plans = [...s.floorPlans];
          plans[0] = {
            ...plans[0],
            yardPlan: data.floors[0].yardPlan,
            enabledRooms: (data.floors[0].enabledRooms as never[]) ?? plans[0].enabledRooms,
            roomLayout: (data.floors[0].roomLayout as never) ?? plans[0].roomLayout,
            roomDimensions: (data.floors[0].roomDimensions as never) ?? plans[0].roomDimensions,
          };
          return { floorPlans: plans };
        });
      }
      const url = new URL(window.location.href);
      url.searchParams.delete("loadView");
      window.history.replaceState({}, "", url.toString());
    }).catch(() => { /* ignore bad params */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server render / pre-hydration: 只渲骨架（背景 + footer 占位）避免
  // zustand persist 水合后状态跳变触发 hydration mismatch。
  if (!mounted) {
    return (
      <div className="flex flex-col h-screen bg-gray-50 overflow-hidden" suppressHydrationWarning>
        <div className="flex-1 flex items-center justify-center text-[11px] text-gray-300">
          {locale === "en" ? "Loading…" : "加载中…"}
        </div>
      </div>
    );
  }

  // Banner is injected directly into DOM via the effect above (DOM injection
  // is immune to React state races and Fast Refresh resets). No JSX needed here.

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

          {viewMode === "3d"  && <RoomCanvas />}
          {viewMode === "2d"  && <FloorPlan />}
          {isAll      && <FloorPlanAll />}
          {isGlobal3d && <GlobalCanvas />}
          {isExterior && viewMode === "yard2d" && <YardPlan />}
          {viewMode === "exterior" && <HouseCanvas />}

          {/* 统一 AI 入口 — 六站全覆盖：单按钮 + 分层菜单（⚡一键 / 🎨选预设 / ✨生成式精修 / 📷导入参考图）。
              ✨ 与 📷 通过 openAiRender / openImport window 事件触发（与 TopBar 一致）。 */}
          {/* z-40：要盖过单间平面图右下角的楼层小地图（FloorPlanMinimap z-30）。
              菜单弹层自身虽是 z-50，但它在本容器的堆叠上下文内，容器若 < 小地图
              就整体被压下去 → 弹层被小地图挡住。把容器抬到 40 让整棵子树都在上面。 */}
          <div className="absolute bottom-4 right-4 z-40 flex flex-col gap-2 items-end transition-opacity duration-200 opacity-100">
            <AiEntryMenu />
          </div>

          {/* Front wall + ceiling toggles — both in 3D only */}
          {viewMode === "3d" && <SouthWallToggle />}
          {viewMode === "3d" && <CeilingToggle />}

          {/* Stair navigation — shown when viewing a stair room in 3D */}
          {viewMode === "3d" && activeRoom === "stair" && (() => {
            const hasUp   = activeFloor < floorPlans.length - 1 && floorPlans[activeFloor + 1]?.enabledRooms?.includes("stair" as const);
            const hasDown = activeFloor > 0 && floorPlans[activeFloor - 1]?.enabledRooms?.includes("stair" as const);
            if (!hasUp && !hasDown) return null;
            return (
              <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 flex gap-3">
                {hasUp && (
                  <button
                    onClick={() => { setActiveFloor(activeFloor + 1); setActiveRoom("stair"); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold shadow-xl active:scale-95 transition-all"
                    style={{ background: "linear-gradient(135deg,rgba(30,58,138,0.92),rgba(59,130,246,0.92))", backdropFilter: "blur(12px)", border: "1px solid rgba(147,197,253,0.4)" }}
                  >
                    {locale === "en" ? `↑ Up ${activeFloor + 2}F` : `↑ 上楼 ${activeFloor + 2}F`}
                  </button>
                )}
                {hasDown && (
                  <button
                    onClick={() => { setActiveFloor(activeFloor - 1); setActiveRoom("stair"); }}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold shadow-xl active:scale-95 transition-all"
                    style={{ background: "linear-gradient(135deg,rgba(30,58,138,0.92),rgba(59,130,246,0.92))", backdropFilter: "blur(12px)", border: "1px solid rgba(147,197,253,0.4)" }}
                  >
                    {locale === "en" ? `↓ Down ${activeFloor}F` : `↓ 下楼 ${activeFloor}F`}
                  </button>
                )}
              </div>
            );
          })()}
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
      <ImageImportModal open={showImport}   onClose={() => setShowImport(false)} />
      <AiRenderModal    open={showAiRender} onClose={() => setShowAiRender(false)} />
      {/* Command Palette — Cmd+K / Ctrl+K (borrowed from pascal editor) */}
      <CommandPalette />
      {/* <OnboardingOverlay /> */}
      <footer className="h-6 bg-white border-t border-gray-100 flex items-center justify-center shrink-0" style={{ pointerEvents: "none" }}>
        <span className="text-[10px] text-gray-400">{t.disclaimer}</span>
      </footer>
    </div>
  );
}
