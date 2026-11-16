import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SHOWCASE_META } from "@/lib/showcaseMeta";

// 静态导出（NEXT_EXPORT=1）要求动态路由显式声明可生成的参数，否则构建失败。
// 5 个样板间全部预渲染为独立页面。
export const dynamic = "force-static";

export function generateStaticParams() {
  return SHOWCASE_META.map((s) => ({ id: s.id }));
}

// 样板间面积（仓库实测数据）：
// - set-cafe 云横咖啡 78㎡；set-office 办公室 240㎡；set-restaurant 餐厅 320㎡
// - clear-glass-curtain-villa 豪华三层玻璃幕墙别墅 320㎡（3F，见 projectTemplates.ts）
// - resort-pool-villa 未在仓库中标注面积，仅按其特征描述（两层带天台露台），不编造数字。
const SCENE_AREA: Record<string, string> = {
  "set-cafe": "78㎡",
  "set-office": "240㎡",
  "set-restaurant": "320㎡",
  "clear-glass-curtain-villa": "320㎡（3 层）",
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.zhuyahome.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const scene = SHOWCASE_META.find((s) => s.id === id);
  if (!scene) return { title: "样板间 · ZHUYA" };
  const area = SCENE_AREA[id];
  const title = `${scene.nameZh} · ZHUYA 样板间`;
  const description = area
    ? `${scene.nameZh}（${area}）：${scene.descZh}。在筑雅免费查看 3D 外观与户型，AI 文生户型、3D 装修漫游、实时报价，一键分享。`
    : `${scene.nameZh}：${scene.descZh}。在筑雅免费查看 3D 外观与户型，AI 文生户型、3D 装修漫游、实时报价，一键分享。`;
  return {
    title,
    description,
    keywords: ["筑雅", "ZHUYA", "样板间", scene.nameZh, "3D 户型", "别墅外观设计", "室内设计"],
    alternates: { canonical: `/showcase/${id}` },
    openGraph: {
      type: "website",
      siteName: "ZHUYA",
      title,
      description,
      url: `/showcase/${id}`,
      locale: "zh_CN",
      images: [{ url: scene.image, alt: scene.nameZh }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [scene.image],
    },
  };
}

export default async function ShowcaseScenePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scene = SHOWCASE_META.find((s) => s.id === id);
  if (!scene) notFound();

  const area = SCENE_AREA[id];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: scene.nameZh,
    alternateName: scene.nameEn,
    description: scene.descZh,
    url: `${SITE_URL}/showcase/${id}`,
    image: `${SITE_URL}${scene.image}`,
    inLanguage: "zh-CN",
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="flex items-center justify-between px-6 py-5 border-b border-white/10">
        <div>
          <div className="text-xl font-bold">{scene.nameZh}</div>
          <p className="text-sm text-gray-400">{scene.nameEn}</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/showcase" className="text-sm text-gray-300 hover:text-white underline">
          ← 返回样板间
        </a>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={scene.image}
          alt={scene.nameZh}
          className="w-full rounded-2xl object-cover mb-6"
        />

        <h1 className="text-2xl font-bold mb-2">{scene.nameZh} · ZHUYA 样板间</h1>
        <p className="text-gray-300 leading-relaxed mb-4">{scene.descZh}</p>

        <div className="flex flex-wrap gap-2 mb-6">
          {area && (
            <span className="text-xs px-2 py-1 rounded bg-white/10 text-gray-200">面积 {area}</span>
          )}
          {scene.tagsZh.map((tag) => (
            <span key={tag} className="text-xs px-2 py-1 rounded bg-white/10 text-gray-300">
              {tag}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 mb-10">
          {/* 在样板间页就地打开 3D 查看器（?id= 直达，保留原有交互） */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href={`/showcase?id=${scene.id}`}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#007AFF" }}
          >
            3D 查看外形 →
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-white/25 text-gray-100 hover:bg-white/10"
          >
            在设计器中改造成自己的方案 →
          </a>
        </div>

        <section className="border-t border-white/10 pt-6">
          <h2 className="text-lg font-semibold mb-3">这个样板间能帮你做什么</h2>
          <p className="text-sm text-gray-300 leading-relaxed mb-4">
            这是筑雅的真实 3D 样板间：外观、户型与家具布局都可以在浏览器里直接查看与漫游。
            点「3D 查看外形」就地打开实时查看器；想改成自己的方案，点「在设计器中改造成自己的方案」，
            进设计器后换风格模板、调材质、挪家具，装修报价会实时更新。
          </p>
          <p className="text-sm text-gray-400 leading-relaxed">
            筑雅是免费的在线 AI 家装设计工具：AI 文生户型、沉浸式 3D 装修与漫游、
            建筑外观立面与庭院设计、实时装修报价、一键分享。无需下载，打开即用。
          </p>
        </section>

        <footer className="mt-10 pt-6 border-t border-white/10 text-xs text-gray-500">
          <a href="/showcase" className="underline hover:text-gray-300">全部样板间</a>
          <span className="mx-2">·</span>
          <a href="/" className="underline hover:text-gray-300">免费开始设计</a>
          <span className="mx-2">·</span>
          <span>© 筑雅 ZHUYA</span>
        </footer>
      </main>
    </div>
  );
}
