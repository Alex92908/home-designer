"use client";

// 注意：@/lib/preload（热门 GLB 预载）不要在这里静态 import——它会把
// three/drei 拉进首屏包。预载改由根 layout 的 ClientBoot 在 idle 后动态
// import；本文件只在需要时动态加载 roomPreload（见下方 effect）。

// Module-level flag: tracks whether we've triggered the sample-load this
// browser session. Survives React Strict Mode's double-invocation of effects
// (which resets useState/useRef, but NOT module-level variables).
const _VISITED_KEY = "home-designer-visited";
let _sampleLoadedThisSession = false;
import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import LeftPanel from "@/components/LeftPanel";
import RightPanel from "@/components/RightPanel";
import ExteriorPanel from "@/components/ExteriorPanel";
import ExteriorRoomList from "@/components/ExteriorRoomList";
import TopBar from "@/components/TopBar";
import RoomSidebar from "@/components/RoomSidebar";
import RightPanelAll from "@/components/RightPanelAll";
import FloorPlan from "@/components/FloorPlan";
import AiEntryMenu from "@/components/AiEntryMenu";
import FloorPlanAll, { RoomPanel as FloorPlanAllRoomPanel } from "@/components/FloorPlanAll";
import YardPlan, { YardPlanLibrary, YardPlanInspector } from "@/components/YardPlan";
// import OnboardingOverlay from "@/components/OnboardingOverlay";  // TODO: enable when ready
import { useDesignerStore } from "@/lib/store";
import { useT, useLocale, useLocaleStore } from "@/lib/i18n";
import { decodeShare } from "@/lib/share";
import { decodeSnapshot } from "@/lib/shareUrl";
import { getSampleGlassVillaFloorPlans, SAMPLE_GLASS_VILLA_EXTERIOR } from "@/lib/sampleGlassVilla";
import { isMobileDevice } from "@/lib/device";

// ─── 首屏不加载的重型弹窗（事件/按键触发才挂载）─────────────────────────
// ExportModal / ShareModal / AiDesignDialog / AiAgentPanelHost 平时只返回
// null（等 window 事件才打开），却因静态 import 把 exportPdf、AI 设计、
// agent 面板等代码打进首屏包；CommandPalette 同理（等 Cmd+K）。改成事件
// 到达时才加载 chunk：壳子先监听事件，加载完挂载弹窗，再重发一次事件，
// 让弹窗自身的监听器打开它。挂载后壳子撒手，弹窗自己接管后续开关。
// AiRenderModal / ImageImportModal 由本地 state（showAiRender/showImport）
// 控制开关，同样只在打开时才挂载（AiRenderModal 关时本来就会重置全部状态，
// 卸载重挂与开关等价）。
type AnyComp = ComponentType<Record<string, never>>;

const loadExportModal = () => import("@/components/ExportModal");
const loadShareModal = () => import("@/components/ShareModal");
const loadAiDesignDialog = () => import("@/components/AiDesignDialog");
const loadAiAgentPanelHost = () =>
  import("@/components/AiAgentPanel").then((m) => ({ default: m.AiAgentPanelHost }));
const loadCommandPalette = () => import("@/components/CommandPalette");

function useEventGatedModal(eventName: string, load: () => Promise<{ default: AnyComp }>): AnyComp | null {
  const [Comp, setComp] = useState<AnyComp | null>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    let dead = false;
    const onOpen = () => {
      if (mountedRef.current) return; // 已挂载：弹窗自己的监听器会处理
      void load().then((m) => {
        if (dead) return;
        mountedRef.current = true;
        setComp(() => m.default);
        // 弹窗在挂载 effect 里注册 open 事件监听；重发让本次点击直接打开。
        setTimeout(() => window.dispatchEvent(new Event(eventName)), 60);
      });
    };
    window.addEventListener(eventName, onOpen);
    return () => { dead = true; window.removeEventListener(eventName, onOpen); };
  }, [eventName, load]);
  return Comp;
}

function useKeyGatedCommandPalette(): AnyComp | null {
  const [Comp, setComp] = useState<AnyComp | null>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    let dead = false;
    const onKey = (e: KeyboardEvent) => {
      if (mountedRef.current) return; // 已挂载：面板自己接管 Cmd+K 开关
      if (!((e.metaKey || e.ctrlKey) && e.key === "k")) return;
      e.preventDefault();
      void loadCommandPalette().then((m) => {
        if (dead) return;
        mountedRef.current = true;
        setComp(() => m.default);
        // 面板挂载后重发一次同样的按键，让它自己的 keydown 监听打开。
        setTimeout(
          () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: e.metaKey, ctrlKey: e.ctrlKey, bubbles: true, cancelable: true })),
          60,
        );
      });
    };
    window.addEventListener("keydown", onKey);
    return () => { dead = true; window.removeEventListener("keydown", onKey); };
  }, []);
  return Comp;
}

const AiRenderModal = dynamic(() => import("@/components/AiRenderModal"), { ssr: false });
const ImageImportModal = dynamic(() => import("@/components/ImageImportModal"), { ssr: false });

function CanvasLoading({ bg, msgKey }: { bg: string; msgKey: "loading3dScene" | "loadingExteriorScene" | "global3dLoading" }) {
  const t = useT();
  return (
    <div className={`flex-1 flex items-center justify-center w-full h-full ${bg}`}>
      <div className="text-gray-400 text-sm animate-pulse">{t[msgKey]}</div>
    </div>
  );
}

/** 3D 画布局部错误边界 —— 重场景（外观图整院 GLB）加载太久/偶发失败时，
 *  异常原来一路抛到 app/error.tsx，整页被换成错误页（用户：外观图加载太久
 *  页面报错）。在画布这层截住：应用外壳、顶栏、面板都还活着，就地给
 *  「重试」（换 key 重挂载画布重新加载）。 */
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error) { console.error("[CanvasBoundary]", err); }
  retry = () => this.setState(s => ({ failed: false, attempt: s.attempt + 1 }));
  render() {
    if (this.state.failed) {
      const zh = typeof navigator === "undefined" || navigator.language.startsWith("zh");
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900 text-white">
          <div className="text-3xl">🏗️</div>
          <div className="text-sm font-semibold">{zh ? "3D 场景加载出错" : "3D scene failed to load"}</div>
          <div className="text-xs opacity-60 max-w-xs text-center leading-relaxed">
            {zh ? "多为网络较慢导致模型加载超时，点重试重新加载。" : "Usually a slow network timing out a model download — retry to reload."}
          </div>
          <button
            onClick={this.retry}
            className="mt-1 px-4 py-1.5 rounded-lg text-xs font-bold bg-white/10 border border-white/25 hover:bg-white/20 transition-all"
          >
            {zh ? "重试" : "Retry"}
          </button>
        </div>
      );
    }
    return <div key={this.state.attempt} className="absolute inset-0">{this.props.children}</div>;
  }
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
      // 竖屏手机上 bottom-4 会被 Safari 底部工具栏吃掉(用户实拍);横屏底栏很细所以没事,
      // 故只在窄屏抬高,sm 以上保持原位。
      className="absolute bottom-24 sm:bottom-4 left-4 z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold shadow-lg transition-all active:scale-95"
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
      // 同上:竖屏手机抬到 Safari 底栏之上,始终叠在「南墙」开关正上方。
      className="absolute bottom-[8.5rem] sm:bottom-14 left-4 z-20 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold shadow-lg transition-all active:scale-95"
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

export default function DesignerTool() {
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
  // Mobile (<768px): side panels render as overlay drawers over the canvas
  // instead of squeezing it to ~100px wide (the budget panel was
  // effectively unreachable on phones).
  const [isMobile, setIsMobile] = useState(false);
  const [showAiRender,  setShowAiRender]  = useState(false);
  const [showImport,    setShowImport]    = useState(false);

  // 事件/按键触发才挂载的重型弹窗（首屏不加载其 chunk，见文件顶部说明）。
  const ExportModalLazy = useEventGatedModal("openExport", loadExportModal);
  const ShareModalLazy = useEventGatedModal("openShare", loadShareModal);
  const AiDesignDialogLazy = useEventGatedModal("openAiDesign", loadAiDesignDialog);
  const AiAgentPanelHostLazy = useEventGatedModal("openAiAgent", loadAiAgentPanelHost);
  const CommandPaletteLazy = useKeyGatedCommandPalette();
  // zustand persist 在客户端水合时会用 localStorage 里的值覆盖 initial
  // state（比如 activeRoom / viewMode / floorPlans），和 SSR 渲出来的
  // 默认值不一致 → React 报 hydration mismatch（移动端 Chrome 尤其
  // 敏感）。等第一次 useEffect 跑完再渲染真正依赖 store 的内容。
  const [mounted, setMounted] = useState(false);

  // 预载当前房间的 GLB(桌面端):用户在 2D 里选房/改布局时就把该房间的
  // 模型下好解好,切「室内装修」直接命中缓存。已预载过的 URL 由 roomPreload
  // 内去重。400ms 延迟让 2D 首帧先画出来。移动端不做(内存紧张,按需加载)。
  // roomPreload 拉入 three/drei，首屏不静态 import，400ms 内动态加载。
  useEffect(() => {
    const placedItems = floorPlans[activeFloor]?.rooms?.[activeRoom]?.placedItems;
    if (!placedItems?.length) return;
    let cancelled = false;
    // 先启动 chunk 加载（与 400ms 等待并行），不要把 import 串在定时器之后。
    const modPromise = import("@/lib/roomPreload");
    const t = setTimeout(() => {
      void modPromise.then((m) => {
        if (cancelled) return;
        m.preloadGlbUrls(m.collectRoomGlbUrls(placedItems));
      });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [floorPlans, activeFloor, activeRoom]);

  // After mount, collapse panels on mobile viewports + flip mounted flag.
  // On first-ever visit (no persisted state), load the glass-villa sample so
  // new users immediately see a complete coherent design across all views.
  useEffect(() => {
    // ── 移动端防「重型视图崩溃循环」──────────────────────────
    // viewMode 持久化：上次停在 3D/全屋3D/外观 的用户刷新即恢复该重型
    // WebGL 视图。内存吃紧的 iPhone 挂载时就 OOM → 渲染进程被杀 →
    //「无法打开此网页」→ 重载又恢复同一视图 → 再崩，用户无法自救。
    // 在 setMounted(true) 之前把落地视图降级到轻量 2D —— 二者在同一
    // effect 里批处理成一次渲染，重型 Canvas（受 !mounted 门控）从不
    // 挂载。用户随后可显式点开 3D（此时已有降配渲染设置）。
    if (isMobileDevice()) {
      const HEAVY = new Set(["3d", "global3d", "exterior"]);
      const vm = useDesignerStore.getState().viewMode;
      if (HEAVY.has(vm)) useDesignerStore.getState().setViewMode("2d");
    }
    setMounted(true);
    if (window.innerWidth < 768) {
      setIsMobile(true);
      setLeftOpen(false);
      setRightOpen(false);
    }

    // First-visit: load sample data + show a DOM-injected welcome banner.
    // We use direct DOM injection (not React state) because zustand's
    // useSyncExternalStore triggers synchronous re-renders that race with
    // useState updates. Direct DOM manipulation is immune to this.
    // ⚠️ 只在「没有任何已存设计」时灌样板：已存设计可能来自别的页面——
    // 比如样板间查看器刚把某个片场灌进 store 并持久化了，而本页是该
    // 浏览器档案里第一次挂载 DesignerTool（_VISITED_KEY 还没写）。不
    // 检查就直接灌样板，会把用户刚选的片场冲掉（showcase → designer
    // 交接丢片场的根因：localStorage 在设计器启动 ~1s 内被样板覆盖）。
    const hasPersistedDesign = (() => {
      try {
        const raw = localStorage.getItem("home-designer-v2");
        if (!raw) return false;
        const parsed = JSON.parse(raw) as { state?: { floorPlans?: unknown[] }; floorPlans?: unknown[] };
        const fps = parsed?.state?.floorPlans ?? parsed?.floorPlans;
        return Array.isArray(fps) && fps.length > 0;
      } catch {
        return false;
      }
    })();
    const isFirstVisit = !localStorage.getItem(_VISITED_KEY);
    if (isFirstVisit && !_sampleLoadedThisSession && !hasPersistedDesign) {
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
            <div style="font-size:10px;color:rgba(191,219,254,0.6);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${locale === "en" ? "Click the tabs in order → Floor Plan → Decorate → House 3D → Exterior" : "依次点击标签探索 → 房间平面 → 室内装修 → 全屋3D → 整体外观"}</div>
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

  // Apply a template id passed in the URL (?template=set-cafe) — the
  // showcase "用这个片场出短片" / "在设计器中打开此方案" handoff. Runs
  // once after hydration, so it wins over whatever rehydration produced
  // (including a first-visit sample load). Unknown ids are ignored by
  // applyProjectTemplate. Consumed immediately so a later refresh doesn't
  // wipe edits the user made to the set afterwards.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const templateId = params.get("template");
    if (!templateId) return;
    useDesignerStore.getState().applyProjectTemplate(templateId);
    const url = new URL(window.location.href);
    url.searchParams.delete("template");
    window.history.replaceState({}, "", url.toString());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the short-film panel from ?shortfilm=1 (homepage featured card /
  // showcase viewer "出短片" entry). Runs once after hydration. The
  // CinematicPanel lives inside HouseCanvas, which only mounts in the
  // exterior view — so switch to it first, then open the panel.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get("shortfilm")) return;
    useDesignerStore.getState().setViewMode("exterior");
    // CinematicDirector（film/director 代码，含 three/fiber/sceneSets）平时
    // 不进首屏包；只有 ?shortfilm=1 才动态加载，加载完再打开面板（store
    // 在模块求值时创建，与 HouseCanvas 里的同一实例）。
    void import("@/components/CinematicDirector").then((m) => {
      m.useCineStore.getState().setMenuOpen(true);
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("shortfilm");
    window.history.replaceState({}, "", url.toString());
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
      <div className="flex flex-1 overflow-hidden relative">

        {/* Mobile drawer scrim — tap outside an open panel to close it */}
        {isMobile && (leftOpen || rightOpen) && (
          <div
            className="absolute inset-0 z-30"
            style={{ background: "rgba(0,0,0,0.3)" }}
            onClick={() => { setLeftOpen(false); setRightOpen(false); }}
          />
        )}

        {/* Room sidebar — always visible in room/2d views */}
        {showRoomSidebar && <RoomSidebar />}

        {/* Left panel with collapse — used by all views that have a left panel
            (LeftPanel in 3D/2D, FloorPlanAll's RoomPanel in 全局).
            Mobile: overlay drawer (absolute, capped at 86vw) instead of
            squeezing the canvas. */}
        {hasLeftPanel && (
          <div
            className={`h-full overflow-hidden transition-all duration-300 ${isMobile ? "absolute left-0 top-0 bottom-0 z-40 shadow-2xl" : "shrink-0"}`}
            style={{ width: leftOpen ? Math.min(leftPanelWidth, isMobile ? 335 : leftPanelWidth) : 0 }}
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

          {viewMode === "3d"  && <CanvasBoundary><RoomCanvas /></CanvasBoundary>}
          {viewMode === "2d"  && <FloorPlan />}
          {isAll      && <FloorPlanAll />}
          {isGlobal3d && <CanvasBoundary><GlobalCanvas /></CanvasBoundary>}
          {isExterior && viewMode === "yard2d" && <YardPlan />}
          {viewMode === "exterior" && <CanvasBoundary><HouseCanvas /></CanvasBoundary>}

          {/* 统一 AI 入口 — 六站全覆盖：单按钮 + 分层菜单（⚡一键 / 🎨选预设 / ✨生成式精修 / 📷导入参考图）。
              ✨ 与 📷 通过 openAiRender / openImport window 事件触发（与 TopBar 一致）。 */}
          {/* z-40：要盖过单间平面图右下角的楼层小地图（FloorPlanMinimap z-30）。
              菜单弹层自身虽是 z-50，但它在本容器的堆叠上下文内，容器若 < 小地图
              就整体被压下去 → 弹层被小地图挡住。把容器抬到 40 让整棵子树都在上面。 */}
          {/* 竖屏手机同样抬到 Safari 底栏之上(与左下角两个开关齐平),横屏/桌面保持原位。 */}
          <div className="absolute bottom-24 sm:bottom-4 right-4 z-40 flex flex-col gap-2 items-end transition-opacity duration-200 opacity-100">
            {AiDesignDialogLazy && <AiDesignDialogLazy />}
            {/* 对话式设计 agent(多轮工具调用改画布)—— 由 AI 助手菜单的 openAiAgent 事件打开 */}
            {AiAgentPanelHostLazy && <AiAgentPanelHostLazy />}
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
            // 上下楼按钮同样避开竖屏 Safari 底栏(80px 仍在其覆盖范围内)。
            return (
              <div className="absolute bottom-40 sm:bottom-20 left-1/2 -translate-x-1/2 z-30 flex gap-3">
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
            (RightPanelAll), and 外观 (ExteriorPanel).
            Mobile: overlay drawer, same as the left panel. */}
        {hasRightPanel && (
          <div
            className={`h-full overflow-hidden transition-all duration-300 ${isMobile ? "absolute right-0 top-0 bottom-0 z-40 shadow-2xl" : "shrink-0"}`}
            style={{ width: rightOpen ? Math.min(rightPanelWidth, isMobile ? 335 : rightPanelWidth) : 0 }}
          >
            {rightPanel}
          </div>
        )}
      </div>
      {ExportModalLazy && <ExportModalLazy />}
      {ShareModalLazy && <ShareModalLazy />}
      {showImport && <ImageImportModal open={showImport}   onClose={() => setShowImport(false)} />}
      {showAiRender && <AiRenderModal    open={showAiRender} onClose={() => setShowAiRender(false)} />}
      {/* Command Palette — Cmd+K / Ctrl+K (borrowed from pascal editor) */}
      {CommandPaletteLazy && <CommandPaletteLazy />}
      {/* <OnboardingOverlay /> */}
      <footer className="h-6 bg-white border-t border-gray-100 flex items-center justify-center shrink-0" style={{ pointerEvents: "none" }}>
        <span className="text-[10px] text-gray-400">{t.disclaimer}</span>
      </footer>
    </div>
  );
}
