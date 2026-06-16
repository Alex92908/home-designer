"use client";

/**
 * ShowcaseClient — 样板间画廊 + 外形图查看器。
 *
 * 画廊：列出 SHOWCASE_TEMPLATES（现在 1 套，结构留口给以后用户投稿）。
 * 点卡片 → 把该方案临时灌进 store，全屏渲染 <HouseCanvas/> 外观图。
 *
 * 关键：查看样板会改动全局 store。为不破坏用户自己的设计，进入查看前备份
 * store 相关字段 + localStorage，返回/卸载/关页时还原。
 */
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useDesignerStore } from "@/lib/store";
import { useLocale } from "@/lib/i18n";
import { SHOWCASE_TEMPLATES, type ShowcaseTemplate } from "@/lib/showcaseTemplates";

const PERSIST_KEY = "home-designer-v2";

const HouseCanvas = dynamic(() => import("@/components/HouseCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-400 text-sm">
      渲染外形图…
    </div>
  ),
});

export default function ShowcaseClient() {
  const locale = useLocale();
  const en = locale === "en";
  const [activeId, setActiveId] = useState<string | null>(null);

  // 备份用户当前 store（首次进入查看时拍一次）。
  const backup = useRef<{
    floorPlans: unknown;
    exterior: unknown;
    viewMode: unknown;
    activeFloor: number;
    ls: string | null;
  } | null>(null);

  const ensureBackup = () => {
    if (backup.current) return;
    const s = useDesignerStore.getState();
    backup.current = {
      floorPlans: s.floorPlans,
      exterior: s.exterior,
      viewMode: s.viewMode,
      activeFloor: s.activeFloor,
      ls: typeof window !== "undefined" ? window.localStorage.getItem(PERSIST_KEY) : null,
    };
  };

  const restore = () => {
    const b = backup.current;
    if (!b) return;
    useDesignerStore.setState({
      floorPlans: b.floorPlans as never,
      exterior: b.exterior as never,
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

  // 卸载（路由切走）时还原；关页（beforeunload）时至少把 localStorage 写回，
  // 避免用户设计被样板覆盖丢失。
  useEffect(() => {
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
  }, []);

  const openTemplate = (t: ShowcaseTemplate) => {
    ensureBackup();
    const { floorPlans, exterior } = t.load();
    useDesignerStore.setState((s) => ({
      floorPlans,
      exterior: { ...s.exterior, ...exterior },
      viewMode: "exterior" as never,
      activeFloor: 0,
    }));
    setActiveId(t.id);
  };

  const backToGallery = () => {
    restore();
    setActiveId(null);
  };

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

  // ── 外形图查看器 ──
  if (activeId) {
    const t = SHOWCASE_TEMPLATES.find((x) => x.id === activeId);
    return (
      <div className="relative h-screen w-screen bg-gray-900 overflow-hidden">
        <HouseCanvas />
        <button
          onClick={backToGallery}
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

  // ── 画廊 ──
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/10">
        <div>
          <div className="text-xl font-bold">{en ? "Showroom" : "样板间"}</div>
          <p className="text-sm text-gray-400">
            {en ? "Browse the 3D exterior of curated home designs" : "浏览精选住宅设计的 3D 外观"}
          </p>
        </div>
        <a
          href="/"
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: "#007AFF" }}
        >
          {en ? "Open designer" : "进入设计器"}
        </a>
      </header>

      <main className="p-6 grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {SHOWCASE_TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => openTemplate(t)}
            className="text-left rounded-2xl overflow-hidden border border-white/10 bg-gray-800/60 hover:bg-gray-800 transition shadow-lg"
          >
            {/* 缩略占位（外形图缩略图后续可换成预渲染图） */}
            <div
              className="h-40 flex items-center justify-center text-5xl"
              style={{ background: "linear-gradient(135deg,#2b3242,#1b2230)" }}
            >
              🏝️
            </div>
            <div className="p-4">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-semibold">{en ? t.nameEn : t.nameZh}</span>
                {t.tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-300">
                    {tag}
                  </span>
                ))}
              </div>
              <p className="text-sm text-gray-400 mb-3">{en ? t.descEn : t.descZh}</p>
              <span className="text-sm font-semibold" style={{ color: "#5AA9FF" }}>
                {en ? "View exterior →" : "查看外形 →"}
              </span>
            </div>
          </button>
        ))}
      </main>

      {/* ── SEO 内容区：给搜索引擎/AI 提供可索引的真实中文内容，也是给用户的产品介绍 ── */}
      <section className="px-6 pb-16 pt-4 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-3">
          {en ? "ZHUYA — Free Online AI Home Design Tool" : "筑雅 ZHUYA —— 免费在线 AI 家装设计工具"}
        </h1>
        <p className="text-gray-300 leading-relaxed mb-8">
          {en
            ? "ZHUYA turns a text prompt or a floor-plan photo into an editable 3D home: design interiors with real-time pricing, walk through the rooms, shape the building exterior and the yard, then share the whole plan with one link — all in your browser, for free."
            : "筑雅 ZHUYA 把一句话或一张户型照片,变成可编辑的 3D 住宅:在浏览器里实时装修并即时报价、沉浸式漫游房间、设计建筑外观立面与院子景观,再一键分享整套方案。无需下载,完全免费。"}
        </p>

        <h2 className="text-lg font-semibold mb-4">{en ? "Features" : "核心功能"}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-10">
          {(en
            ? [
                ["🤖 AI floor plans", "Generate a full layout from a text prompt or a floor-plan photo."],
                ["🛋️ Real-time 3D interior", "Furnish rooms, change materials, see live cost estimates."],
                ["🚶 Immersive walkthrough", "Walk through every room and out into the yard."],
                ["🏛️ Exterior & facade", "Design the building's exterior, windows and roofline."],
                ["🌳 Yard & landscape", "Lay out pools, paths, trees and the whole courtyard."],
                ["🔗 One-click share", "Share the full plan with a single link."],
              ]
            : [
                ["🤖 AI 文生户型", "一句话或一张户型照片,自动生成整套布局。"],
                ["🛋️ 3D 实时装修", "摆家具、换材质,装修成本即时报价。"],
                ["🚶 沉浸式漫游", "走进每个房间,还能走到院子里。"],
                ["🏛️ 外观与立面", "设计建筑外观、门窗与屋顶造型。"],
                ["🌳 庭院景观", "泳池、步道、树木,排布整个院子。"],
                ["🔗 一键分享", "整套方案,一个链接分享出去。"],
              ]
          ).map(([title, desc]) => (
            <div key={title} className="rounded-xl border border-white/10 bg-gray-800/40 p-4">
              <div className="font-semibold mb-1">{title}</div>
              <div className="text-sm text-gray-400">{desc}</div>
            </div>
          ))}
        </div>

        <h2 className="text-lg font-semibold mb-4">{en ? "FAQ" : "常见问题"}</h2>
        <div className="space-y-4">
          {(en
            ? [
                ["Is ZHUYA free?", "Yes. Designing, 3D walkthrough and sharing are free to use in the browser."],
                ["Do I need to install anything?", "No. ZHUYA runs entirely in your web browser."],
                ["What can I design?", "Interior decoration, building exterior / facade, and the yard & landscape — for houses and villas."],
              ]
            : [
                ["筑雅是免费的吗?", "是的。设计、3D 漫游、分享都可以在浏览器里免费使用。"],
                ["需要下载安装吗?", "不需要。筑雅完全在网页浏览器里运行。"],
                ["能设计哪些内容?", "室内装修、建筑外观立面、院子景观,适用于住宅与别墅。"],
              ]
          ).map(([q, a]) => (
            <div key={q}>
              <div className="font-semibold mb-1">{q}</div>
              <div className="text-sm text-gray-400">{a}</div>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <a href="/" className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white inline-block" style={{ background: "#007AFF" }}>
            {en ? "Start designing for free →" : "免费开始设计 →"}
          </a>
        </div>
        <footer className="mt-12 pt-6 border-t border-white/10 text-xs text-gray-500">
          <a href="/credits" className="underline hover:text-gray-300">
            {en ? "Asset credits" : "素材致谢"}
          </a>
          <span className="mx-2">·</span>
          <span>© 筑雅 ZHUYA</span>
        </footer>
      </section>
    </div>
  );
}
