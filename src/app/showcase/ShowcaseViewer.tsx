"use client";

/**
 * ShowcaseViewer — 样板外形图查看器（重组件，仅在点「查看外形」时动态加载）。
 *
 * 承担所有重依赖：store（全家具目录）+ <HouseCanvas/>（three.js 全家桶）+
 * showcaseTemplates 的 load() 方案工厂。画廊（ShowcaseClient）绝不静态引它，
 * 用 next/dynamic({ ssr:false }) 懒加载 → 画廊落地不必下载这几 MB。
 *
 * 关键：查看样板会改动全局 store。为不破坏用户自己的设计，进入前备份 store
 * 相关字段 + localStorage，返回/卸载/关页时还原。
 */
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useDesignerStore } from "@/lib/store";
import { useLocale } from "@/lib/i18n";
import { SHOWCASE_TEMPLATES } from "@/lib/showcaseTemplates";
import { isMobileDevice } from "@/lib/device";
import { ROOM_DEFS, type RoomType } from "@/lib/types";
import { getFurnitureById } from "@/lib/furniture";
import { useGLTF } from "@react-three/drei";

const PERSIST_KEY = "home-designer-v2";

const HouseCanvas = dynamic(() => import("@/components/HouseCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center gap-3 h-screen bg-gray-900 text-gray-400 text-sm">
      <div className="animate-pulse">渲染外形图…</div>
      <div className="text-xs text-gray-500 max-w-[260px] text-center leading-relaxed">
        首次打开需下载 3D 引擎，慢网络约需十几秒；模型随后按需逐件加载
      </div>
    </div>
  ),
});

export default function ShowcaseViewer({
  templateId,
  onBack,
}: {
  templateId: string;
  onBack: () => void;
}) {
  const locale = useLocale();
  const en = locale === "en";
  // 移动端不挂载 live HouseCanvas —— 整栋 + 院子几十个 GLB 的重型 WebGL 场景
  // 会把内存吃紧的 iPhone 渲染进程撑爆（用户：进样板间外观崩溃）。改为直接
  // 展示预渲染外观图（画廊卡片同款），零 WebGL = 零崩溃。想要实时 3D 走
  // 「在设计器中打开」（设计器在移动端落地轻量 2D，见 page.tsx）。
  const [isMobile] = useState(() => isMobileDevice());
  // 移动端「逐房间家具 GLB」：当前点亮的房型存 store（响应式）。默认 null =
  // 室内全占位盒（可靠打开）。点 chip 切房型 —— 不重挂 Canvas（同一 WebGL
  // context，避免 iOS context 数量上限导致的「有概率加载失败」），而是响应式
  // 重渲家具层，并在切走时显式 useGLTF.clear 上一间的模型（真正释放显存）。
  const glbRoom = useDesignerStore((s) => s.mobileGlbRoom);
  const setGlbRoomStore = useDesignerStore((s) => s.setMobileGlbRoom);
  const customFurniture = useDesignerStore((s) => s.customFurniture);
  const floorPlans = useDesignerStore((s) => s.floorPlans);

  // 某房型的家具 GLB url 集合（跨楼层）——切走该房间时用于 useGLTF.clear。
  const roomGlbUrls = (room: string): string[] => {
    const urls = new Set<string>();
    for (const fp of floorPlans) {
      for (const p of fp.rooms?.[room as RoomType]?.placedItems ?? []) {
        const f = getFurnitureById(p.furnitureId) ?? customFurniture.find((c) => c.id === p.furnitureId);
        const u = f?.model3d?.url;
        if (u) urls.add(u);
      }
    }
    return [...urls];
  };
  const pickRoom = (room: string | null) => setGlbRoomStore(room);
  // 切走某房间后（re-render 提交、上一间家具层已卸载）再 dispose 它的 GLB：
  // 只清「上一间独有、新一间不用」的 url，避免误伤新房间正在加载的共用模型。
  const prevRoomRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevRoomRef.current;
    prevRoomRef.current = glbRoom;
    if (!prev || prev === glbRoom) return;
    const keep = new Set(glbRoom ? roomGlbUrls(glbRoom) : []);
    for (const u of roomGlbUrls(prev)) {
      if (!keep.has(u)) {
        try { (useGLTF as unknown as { clear: (u: string) => void }).clear(u); } catch { /* noop */ }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glbRoom]);

  const t = SHOWCASE_TEMPLATES.find((x) => x.id === templateId);
  // 模板灌进 store 后，取「有家具的室内房型」列表做选择器（跨楼层去重）。
  const furnishedRooms = Array.from(
    new Set(
      floorPlans.flatMap((fp) =>
        (fp.enabledRooms ?? []).filter(
          (r) => !ROOM_DEFS[r]?.isOutdoor && (fp.rooms?.[r]?.placedItems?.length ?? 0) > 0,
        ),
      ),
    ),
  ) as RoomType[];

  // 备份用户当前 store（进入查看时拍一次）。
  const backup = useRef<{
    floorPlans: unknown;
    exterior: unknown;
    yardPlan: unknown;
    viewMode: unknown;
    activeFloor: number;
    ls: string | null;
  } | null>(null);

  const restore = () => {
    const b = backup.current;
    if (!b) return;
    useDesignerStore.setState({
      floorPlans: b.floorPlans as never,
      exterior: b.exterior as never,
      yardPlan: b.yardPlan as never,
      viewMode: b.viewMode as never,
      activeFloor: b.activeFloor,
    });
    try {
      if (b.ls != null) window.localStorage.setItem(PERSIST_KEY, b.ls);
    } catch {
      /* ignore */
    }
    backup.current = null;
  };

  // 挂载即备份 + 把该方案灌进 store；卸载（返回画廊 / 路由切走）时还原。
  // 关页（beforeunload）时至少把 localStorage 写回，避免用户设计被样板覆盖丢失。
  useEffect(() => {
    if (!t) return;
    const s = useDesignerStore.getState();
    backup.current = {
      floorPlans: s.floorPlans,
      exterior: s.exterior,
      yardPlan: s.yardPlan,
      viewMode: s.viewMode,
      activeFloor: s.activeFloor,
      ls: typeof window !== "undefined" ? window.localStorage.getItem(PERSIST_KEY) : null,
    };
    if (t.projectTemplateId) {
      // 片场类：走完整的项目模板管线（户型+风格家具+furnitureOverrides），
      // 再切外观视角。备份已在上面拍好，卸载时还原。
      useDesignerStore.getState().applyProjectTemplate(t.projectTemplateId);
      useDesignerStore.setState({
        viewMode: "exterior" as never,
        activeFloor: 0,
        mobileGlbRoom: null, // 进入模板：室内家具从「关」开始（可靠打开）
      });
    } else {
      const { floorPlans, exterior, yardPlan } = t.load!();
      // REPLACE the exterior wholesale (load() returns a complete exterior built
      // from defaultProject). Merging over s.exterior leaked the previously-opened
      // template's facade — e.g. the glass-curtain template set facadeSystem:
      // "curtain-wall" globally, so switching back to the modern-minimal villa
      // (whose exterior doesn't set facadeSystem) still rendered as glass.
      useDesignerStore.setState({
        floorPlans: floorPlans as never,
        exterior: exterior as never,
        yardPlan: yardPlan as never,
        viewMode: "exterior" as never,
        activeFloor: 0,
        mobileGlbRoom: null, // 进入模板：室内家具从「关」开始（可靠打开）
      });
    }

    const onUnload = () => {
      const b = backup.current;
      if (b?.ls != null) {
        try {
          window.localStorage.setItem(PERSIST_KEY, b.ls);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      useDesignerStore.getState().setMobileGlbRoom(null); // 离开查看器时复位
      restore();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // 「在设计器中打开此方案」：把当前查看的模板据为己有 —— 清掉备份（卸载时
  // 不再还原），让模板数据留在 store + localStorage，跳到设计器编辑。会替换
  // 用户当前设计，故先确认。
  const openInDesigner = () => {
    const msg = en
      ? "Open this design in the editor? It will replace your current design."
      : "在设计器中打开此方案？这会替换你当前的设计。";
    if (!window.confirm(msg)) return;
    backup.current = null; // 不还原 → 模板成为用户的新工作设计
    // 移动端进设计器落地轻量 2D（page.tsx 也会兜底降级），桌面进 3D。
    useDesignerStore.setState({ viewMode: (isMobile ? "2d" : "3d") as never, activeFloor: 0 });
    window.location.href = "/";
  };

  return (
    // 用 100dvh 而非 h-screen：dvh 是「可见视口」，随 Safari 上下工具栏
    // 收缩，底部控件不会被浏览器工具栏挡住（用户：挡住东西了）。
    <div className="relative w-screen bg-gray-900 overflow-hidden" style={{ height: "100dvh" }}>
      {/* 移动端默认：建筑 + 门窗 + 全院子 GLB + 室内占位盒（可靠打开）。
          底部房间 chip 点亮某间的完整家具 GLB —— 同一 Canvas 响应式切换、
          切走时 dispose 上一间，一次只亮一间。桌面永远全量高精度。 */}
      <HouseCanvas />

      {/* 返回键（左上）*/}
      <button
        onClick={onBack}
        className="absolute top-4 left-4 z-50 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-sm font-semibold text-white shadow-lg"
        style={{ background: "rgba(20,22,32,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
      >
        ← {en ? "Back" : "返回"}
      </button>

      {/* 标题卡：移动端另起一行(top-16)、整行宽度，避免和返回键重叠；
          桌面回到右上角。 */}
      {t && (
        <div
          className="absolute z-40 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-white shadow-lg
                     top-[4.25rem] left-4 right-4 sm:top-4 sm:left-auto sm:right-4 sm:max-w-xs"
          style={{ background: "rgba(20,22,32,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
        >
          <div className="font-semibold text-sm">{en ? t.nameEn : t.nameZh}</div>
          <div className="text-xs text-gray-300">{en ? t.descEn : t.descZh}</div>
        </div>
      )}

      {/* 底部控件：房间选择器 + 提示 + 打开按钮竖向堆叠，带安全区内边距，
          避开浏览器工具栏；容器不吃指针事件(不挡旋转)，控件单独可点。 */}
      <div
        className="absolute inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-3 pointer-events-none"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
      >
        {/* 逐房间家具开关（仅移动端、且有带家具的房间时显示）。一次点亮一间，
            释放上一间显存。 */}
        {isMobile && furnishedRooms.length > 0 && (
          <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto max-w-full pb-1"
               style={{ scrollbarWidth: "none" }}>
            <span className="text-[10px] text-white/50 shrink-0 pr-0.5">{en ? "Furniture:" : "看家具:"}</span>
            <button
              onClick={() => pickRoom(null)}
              className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all"
              style={glbRoom === null
                ? { background: "#007AFF", color: "#fff" }
                : { background: "rgba(20,22,32,0.8)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.14)" }}
            >
              {en ? "Off" : "关"}
            </button>
            {furnishedRooms.map((r) => (
              <button
                key={r}
                onClick={() => pickRoom(r)}
                className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all whitespace-nowrap"
                style={glbRoom === r
                  ? { background: "#007AFF", color: "#fff" }
                  : { background: "rgba(20,22,32,0.8)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.14)" }}
              >
                {ROOM_DEFS[r]?.icon} {ROOM_DEFS[r]?.name ?? r}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={openInDesigner}
          className="pointer-events-auto px-6 py-3 rounded-xl text-sm font-semibold text-white shadow-xl"
          style={{ background: "#007AFF" }}
        >
          {en ? "Open in the editor →" : "在设计器中打开此方案 →"}
        </button>
      </div>
    </div>
  );
}
