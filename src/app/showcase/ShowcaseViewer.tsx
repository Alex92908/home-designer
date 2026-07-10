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
import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useDesignerStore } from "@/lib/store";
import { useLocale } from "@/lib/i18n";
import { SHOWCASE_TEMPLATES } from "@/lib/showcaseTemplates";

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
    if (t.projectTemplateId) {
      // 片场类：走完整的项目模板管线（户型+风格家具+furnitureOverrides），
      // 再切外观视角。备份已在上面拍好，卸载时还原。
      useDesignerStore.getState().applyProjectTemplate(t.projectTemplateId);
      useDesignerStore.setState({ viewMode: "exterior" as never, activeFloor: 0 });
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
    useDesignerStore.setState({ viewMode: "3d" as never, activeFloor: 0 });
    window.location.href = "/";
  };

  return (
    <div className="relative h-screen w-screen bg-gray-900 overflow-hidden">
      <HouseCanvas />
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
