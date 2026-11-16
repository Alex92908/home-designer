"use client";

/**
 * ShowcaseShell — 样板间画廊外壳（轻量客户端组件）。
 *
 * 职责：画廊卡片 + ?id= 直达 + 实时 3D 查看器。只引 showcaseMeta（纯文案，
 * 零重依赖），绝不静态引 store / 家具目录 / three.js —— 那些几 MB 的东西
 * 只有点「查看外形」时才通过 next/dynamic 懒加载 ShowcaseViewer 拉进来。
 *
 * SSR 注意：本组件不用 useSearchParams（那样会阻塞服务端渲染），
 * ?id= 的读取隔离在 ShowcaseIdHandler（独立 Suspense 边界）里，
 * 因此画廊卡片的文字会进 SSR HTML；SEO 大段文字则在 page.tsx（服务端）里。
 */
import { Suspense, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLocale } from "@/lib/i18n";
import { SHOWCASE_META } from "@/lib/showcaseMeta";
import { isMobileDevice } from "@/lib/device";
import ShowcaseIdHandler from "./ShowcaseIdHandler";

// 查看器（重：store + three.js）——点卡片才加载，ssr:false 避免进服务端/首屏包。
const ShowcaseViewer = dynamic(() => import("./ShowcaseViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-400 text-sm">
      加载查看器…
    </div>
  ),
});

export default function ShowcaseShell() {
  const locale = useLocale();
  const en = locale === "en";
  const [activeId, setActiveId] = useState<string | null>(null);

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
    // 查看器里 HouseCanvas 是另一个 next/dynamic，预热这块 three.js 代码。
    import("@/components/HouseCanvas").catch(() => {});
    // villa GLB 只有桌面完整模式用；移动端轻量外观跳过所有 GLB，不预取。
    if (!isMobileDevice()) fetch("/models/villa_pbr.glb").catch(() => {});
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

  // ── 实时 3D 查看器（重组件，动态加载）──
  // 点卡片直接进实时 3D；加载期间幕布显示该样板的预渲染外观图（同机位截图，
  // 就绪后原位淡入接管），用户"秒见成品"且无多余步骤。
  if (activeId) {
    return <ShowcaseViewer templateId={activeId} onBack={() => setActiveId(null)} />;
  }

  // ── 画廊 ──
  // 卡片是真实链接（href 指向 /showcase/[id]，可索引、可右键新标签打开），
  // 普通点击则拦截默认跳转、就地打开 3D 查看器（保留原有交互）。
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* ?id= 直达：读一次 searchParams，合法 id 则打开对应查看器。
          独立 Suspense 边界 + 渲染 null，不阻塞画廊的服务端渲染。 */}
      <Suspense fallback={null}>
        <ShowcaseIdHandler onDeepLink={(id) => setActiveId(id)} />
      </Suspense>

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
          <a
            key={t.id}
            href={`/showcase/${t.id}`}
            onClick={(e) => {
              e.preventDefault();
              setActiveId(t.id);
            }}
            onMouseEnter={warmViewer}
            onFocus={warmViewer}
            onTouchStart={warmViewer}
            className="block text-left rounded-2xl overflow-hidden border border-white/10 bg-gray-800/60 hover:bg-gray-800 transition shadow-lg"
          >
            {/* 缩略图：预渲染 WebP 外观图 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.image} alt={en ? t.nameEn : t.nameZh} className="h-40 w-full object-cover" loading="lazy" />
            <div className="p-4">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-semibold">{en ? t.nameEn : t.nameZh}</span>
                {(en ? t.tagsEn : t.tagsZh).map((tag) => (
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
          </a>
        ))}
      </main>
    </div>
  );
}
