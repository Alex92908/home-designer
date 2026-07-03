"use client";

/**
 * ShowcaseClient — 样板间画廊（轻量）。
 *
 * 只列卡片 + SEO 文案，依赖极少：只引 showcaseMeta（纯文案，零重依赖）。
 * 绝不静态引 store / 家具目录 / three.js —— 那些几 MB 的东西只有点「查看外形」
 * 时才通过 next/dynamic 懒加载 ShowcaseViewer 拉进来。这样 /showcase 落地几乎
 * 瞬间（静态 HTML + 极小 JS），而不是首屏就下整个 3D 应用。
 */
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale } from "@/lib/i18n";
import { SHOWCASE_META } from "@/lib/showcaseMeta";

// 查看器（重：store + three.js）——点卡片才加载，ssr:false 避免进服务端/首屏包。
const ShowcaseViewer = dynamic(() => import("./ShowcaseViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-400 text-sm">
      加载查看器…
    </div>
  ),
});

export default function ShowcaseClient() {
  const locale = useLocale();
  const en = locale === "en";
  const [activeId, setActiveId] = useState<string | null>(null);
  // 点卡片先秒开「预渲染大图」（photo）；点「进入实时 3D」才挂重查看器（live）。
  const [mode, setMode] = useState<"photo" | "live">("photo");

  // ── 预热查看器 ──
  // 「样板间→外观图」慢的下载大头是查看器的 ~711KB three.js 代码块。趁用户还在
  // 看画廊卡片时，后台把它（连同 store/HouseCanvas）+ 0.3MB 主外观模型预取进浏
  // 览器缓存，点下去就少等一截。用 fetch 预热 glb 而不 import three，避免把重
  // 依赖拉回画廊包。只跑一次。
  const warmed = useRef(false);
  const warmViewer = () => {
    if (warmed.current) return;
    warmed.current = true;
    import("./ShowcaseViewer").catch(() => {});
    fetch("/models/villa_pbr.glb").catch(() => {});
  };
  // 落地后空闲时也预热一次（不必等悬停）：首屏仍轻，进查看器却已就绪。
  useEffect(() => {
    const ric =
      (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 1500));
    const id = ric(() => warmViewer());
    return () => {
      const cic = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (cic) cic(id);
      else clearTimeout(id);
    };
  }, []);

  // 「在设计器中打开此方案」（photo 模式直达）：动态引入重模块，把方案灌进
  // store + localStorage 后跳设计器。会替换用户当前设计，故先确认。
  const openInDesigner = async (id: string) => {
    const msg = en
      ? "Open this design in the editor? It will replace your current design."
      : "在设计器中打开此方案？这会替换你当前的设计。";
    if (!window.confirm(msg)) return;
    const [{ SHOWCASE_TEMPLATES }, { useDesignerStore }] = await Promise.all([
      import("@/lib/showcaseTemplates"),
      import("@/lib/store"),
    ]);
    const t = SHOWCASE_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    const { floorPlans, exterior, yardPlan } = t.load();
    useDesignerStore.setState({
      floorPlans: floorPlans as never,
      exterior: exterior as never,
      yardPlan: yardPlan as never,
      viewMode: "3d" as never,
      activeFloor: 0,
    });
    window.location.href = "/";
  };

  // ── 实时 3D 查看器（重组件，动态加载）──
  if (activeId && mode === "live") {
    return <ShowcaseViewer templateId={activeId} onBack={() => setActiveId(null)} />;
  }

  // ── 预渲染外观大图（秒开）──
  if (activeId) {
    const t = SHOWCASE_META.find((x) => x.id === activeId);
    if (t) {
      return (
        <div className="relative h-screen w-screen bg-gray-900 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={t.image} alt={en ? t.nameEn : t.nameZh} className="absolute inset-0 w-full h-full object-cover" />
          <button
            onClick={() => setActiveId(null)}
            className="absolute top-4 left-4 z-50 px-4 py-2 rounded-xl text-sm font-semibold text-white shadow-lg"
            style={{ background: "rgba(20,22,32,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
          >
            ← {en ? "Back to gallery" : "返回样板间"}
          </button>
          <div
            className="absolute top-4 right-4 z-50 px-4 py-2 rounded-xl text-sm text-white shadow-lg"
            style={{ background: "rgba(20,22,32,0.85)", border: "1px solid rgba(255,255,255,0.18)" }}
          >
            <div className="font-semibold">{en ? t.nameEn : t.nameZh}</div>
            <div className="text-xs text-gray-300">{en ? t.descEn : t.descZh}</div>
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3">
            {/* 进实时 3D（此时才下载 three.js；悬停预热已在后台跑过） */}
            <button
              onClick={() => setMode("live")}
              className="px-5 py-3 rounded-xl text-sm font-semibold text-white shadow-xl"
              style={{ background: "rgba(20,22,32,0.85)", border: "1px solid rgba(255,255,255,0.25)" }}
            >
              {en ? "🎮 Interactive 3D" : "🎮 进入实时 3D（可旋转）"}
            </button>
            <button
              onClick={() => openInDesigner(t.id)}
              className="px-6 py-3 rounded-xl text-sm font-semibold text-white shadow-xl"
              style={{ background: "#007AFF" }}
            >
              {en ? "Open in editor →" : "在设计器中打开此方案 →"}
            </button>
          </div>
        </div>
      );
    }
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
        {/* 故意用整页跳转 <a> 而非 <Link>：<Link href="/"> 会在画廊空闲时预取
            整个设计器首页包（几 MB three.js），正是本页要避免的负担。 */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: "#007AFF" }}
        >
          {en ? "Open designer" : "进入设计器"}
        </a>
      </header>

      <main className="p-6 grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {SHOWCASE_META.map((t) => (
          <button
            key={t.id}
            onClick={() => { setMode("photo"); setActiveId(t.id); }}
            onMouseEnter={warmViewer}
            onFocus={warmViewer}
            onTouchStart={warmViewer}
            className="text-left rounded-2xl overflow-hidden border border-white/10 bg-gray-800/60 hover:bg-gray-800 transition shadow-lg"
          >
            {/* 预渲染外观缩略图（真实 3D 场景离线截图） */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.image} alt={en ? t.nameEn : t.nameZh} className="h-40 w-full object-cover" loading="lazy" />
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
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
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
