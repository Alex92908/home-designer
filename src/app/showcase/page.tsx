import ShowcaseShell from "./ShowcaseShell";

export const metadata = {
  title: "样板间 · ZHUYA | 别墅外观与商业空间 3D 设计案例",
  description:
    "筑雅 ZHUYA 样板间：度假别墅、玻璃幕墙别墅的 3D 外观与户型，以及咖啡馆、办公室、餐厅三个商业片场。免费在线 AI 家装工具，支持 AI 文生户型、3D 实时装修与漫游、建筑外观立面、庭院景观设计、实时装修报价与一键分享。",
  keywords: ["筑雅", "ZHUYA", "样板间", "AI 装修设计", "3D 户型", "别墅外观设计", "室内设计", "庭院设计", "装修效果图", "咖啡馆设计", "办公室布局", "餐厅平面图"],
  alternates: { canonical: "/showcase" },
  openGraph: {
    type: "website",
    siteName: "ZHUYA",
    title: "样板间 · ZHUYA | 别墅外观与商业空间 3D 设计案例",
    description: "浏览精选住宅与商业空间的 3D 外观与户型：度假别墅、玻璃幕墙别墅、咖啡馆、办公室、餐厅。免费在线 AI 家装设计工具。",
    url: "/showcase",
    locale: "zh_CN",
  },
};

const FEATURES: Array<[string, string]> = [
  ["🤖 AI 文生户型", "一句话或一张户型照片，自动生成整套布局。"],
  ["🛋️ 3D 实时装修", "摆家具、换材质，装修成本即时报价。"],
  ["🚶 沉浸式漫游", "走进每个房间，还能走到院子里。"],
  ["🏛️ 外观与立面", "设计建筑外观、门窗与屋顶造型。"],
  ["🌳 庭院景观", "泳池、步道、树木，排布整个院子。"],
  ["🔗 一键分享", "整套方案，一个链接分享出去。"],
];

const FAQS: Array<[string, string]> = [
  ["筑雅是免费的吗？", "是的。设计、3D 漫游、分享都可以在浏览器里免费使用。"],
  ["需要下载安装吗？", "不需要。筑雅完全在网页浏览器里运行。"],
  ["能设计哪些内容？", "室内装修、建筑外观立面、院子景观，适用于住宅与别墅；样板间里还有咖啡馆、办公室、餐厅三个商业场景。"],
  ["样板间可以直接拿来改吗？", "可以。点开任意样板间查看 3D 外观，再点「进入设计器」就能在它的基础上改成自己的方案。"],
];

export default function ShowcasePage() {
  return (
    <>
      {/* 画廊 + 查看器（客户端交互；卡片文字会进 SSR HTML，?id= 直达隔离在 Suspense 内） */}
      <ShowcaseShell />

      {/* ── SEO 内容区（服务端渲染）：给搜索引擎 / AI 提供可索引的真实中文内容 ── */}
      <section className="bg-gray-900 text-gray-100">
        <div className="px-6 pb-16 pt-10 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-3">
          筑雅 ZHUYA —— 免费在线 AI 家装设计工具
        </h1>
        <p className="text-gray-300 leading-relaxed mb-8">
          筑雅 ZHUYA 把一句话或一张户型照片，变成可编辑的 3D 住宅：在浏览器里实时装修并即时报价、
          沉浸式漫游房间、设计建筑外观立面与院子景观，再一键分享整套方案。无需下载，完全免费。
          下面是五个可以直接打开的样板间：两栋别墅与三个商业片场（咖啡馆、办公室、餐厅），
          每个都有真实的 3D 外观与户型，点击卡片即可漫游查看。
        </p>

        <h2 className="text-lg font-semibold mb-4">核心功能</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-10">
          {FEATURES.map(([title, desc]) => (
            <div key={title} className="rounded-xl border border-white/10 bg-gray-800/40 p-4">
              <div className="font-semibold mb-1">{title}</div>
              <div className="text-sm text-gray-400">{desc}</div>
            </div>
          ))}
        </div>

        <h2 className="text-lg font-semibold mb-4">常见问题</h2>
        <div className="space-y-4">
          {FAQS.map(([q, a]) => (
            <div key={q}>
              <div className="font-semibold mb-1">{q}</div>
              <div className="text-sm text-gray-400">{a}</div>
            </div>
          ))}
        </div>

        <div className="mt-10">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white inline-block" style={{ background: "#007AFF" }}>
            免费开始设计 →
          </a>
        </div>
        <footer className="mt-12 pt-6 border-t border-white/10 text-xs text-gray-500">
          <a href="/credits" className="underline hover:text-gray-300">素材致谢</a>
          <span className="mx-2">·</span>
          <span>© 筑雅 ZHUYA</span>
        </footer>
        </div>
      </section>
    </>
  );
}
