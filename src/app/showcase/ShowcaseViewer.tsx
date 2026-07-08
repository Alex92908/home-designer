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
  const t = SHOWCASE_TEMPLATES.find((x) => x.id === templateId);

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
    const { floorPlans, exterior, yardPlan } = t.load();
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
    });

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
    <div className="relative h-screen w-screen bg-gray-900 overflow-hidden">
      {/* 移动端也渲染实时 3D，但走「轻量外观」模式：HouseCanvas 在移动端
          跳过所有 GLB（家具/院子树车泳池/villa 模型），只画程序化建筑体块 +
          门窗玻璃 + 透过玻璃可见的程序化房间/家具占位盒，可自由旋转，显存
          极低。桌面照常渲染完整 GLB 场景。 */}
      <HouseCanvas />
      {isMobile && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-[11px] text-white/80 whitespace-nowrap pointer-events-none"
             style={{ background: "rgba(20,22,32,0.7)", border: "1px solid rgba(255,255,255,0.14)" }}>
          {en ? "Lite exterior (no furniture/plants) · open on desktop for full detail" : "轻量外观（不含家具/植物）· 完整效果请用电脑打开"}
        </div>
      )}
      <button
        onClick={onBack}
        className="absolute top-4 left-4 z-50 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-lg"
        style={{ background: "rgba(20,22,32,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
      >
        ← {en ? "Back to gallery" : "返回样板间"}
      </button>
      {t && (
        <div
          className="absolute top-4 right-4 z-50 px-4 py-2 rounded-xl text-sm text-white shadow-lg"
          style={{ background: "rgba(20,22,32,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
        >
          <div className="font-semibold">{en ? t.nameEn : t.nameZh}</div>
          <div className="text-xs text-gray-300">{en ? t.descEn : t.descZh}</div>
        </div>
      )}
      {/* 在设计器中打开此方案（fork 成自己的设计去编辑） */}
      <button
        onClick={openInDesigner}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-xl text-sm font-semibold text-white shadow-xl"
        style={{ background: "#007AFF" }}
      >
        {en ? "Open this design in the editor →" : "在设计器中打开此方案 →"}
      </button>
    </div>
  );
}
