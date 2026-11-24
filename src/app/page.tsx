import type { Metadata } from "next";
import DesignerTool from "./DesignerTool";
import { ALL_TEMPLATES } from "@/lib/templates";
import { SHOWCASE_META } from "@/lib/showcaseMeta";
import { FILM_SET_META } from "@/lib/filmSetMeta";

export const metadata: Metadata = {
  title: "ZHUYA 筑雅 | 免费 AI 家装设计 — AI 文生户型 + 3D 装修",
  description:
    "筑雅 ZHUYA 是免费的在线 AI 家装设计工具：输入一句话或一张户型照片，AI 生成户型；在浏览器里 3D 装修、沉浸式漫游房间、设计建筑外观立面与庭院景观，装修实时报价，一键分享整套方案。无需下载，完全免费。",
  keywords: ["筑雅", "ZHUYA", "AI 装修", "3D 户型", "室内设计", "装修设计", "家装", "户型设计", "AI 文生户型", "3D 装修", "免费家装设计"],
  alternates: {
    canonical: "/",
    // 注意：本站语言（中/英文界面）目前存在 localStorage / zustand（hd-locale）
    // 而非 URL 中，因此中英文没有各自独立的可索引 URL。这里的 hreflang 是
    // 最小标注：同一首页同时服务中英文，x-default 指向中文首页。
    // 若后续做 URL 级 i18n 路由（如 /en/），需把这里改成对应语言的独立 URL。
    languages: {
      "zh-CN": "https://www.zhuyahome.com",
      en: "https://www.zhuyahome.com",
      "x-default": "https://www.zhuyahome.com",
    },
  },
  openGraph: {
    type: "website",
    siteName: "ZHUYA",
    title: "ZHUYA 筑雅 | 免费 AI 家装设计 — AI 文生户型 + 3D 装修",
    description:
      "免费在线 AI 家装设计：AI 文生户型、沉浸式 3D 装修与漫游、外观立面与庭院设计、实时装修报价、一键分享。",
    url: "/",
    locale: "zh_CN",
    alternateLocale: "en_US",
  },
};

const FEATURES: Array<[string, string]> = [
  ["🤖 AI 文生户型", "输入一句话或一张户型照片，AI 自动生成整套房间布局，不用从零画图。"],
  ["🛋️ 3D 实时装修", "587 件真实家具任选，摆家具、换墙面地面材质，装修成本即时报价。"],
  ["🚶 沉浸式漫游", "第一人称走进每个房间，还能走到院子里，从各个角度看自己的设计。"],
  ["🏛️ 外观与立面", "设计建筑外观、门窗、屋顶造型和庭院景观，住宅与别墅都适用。"],
  ["💰 实时装修报价", "选中的家具和材料逐项计价，改方案报价跟着变，预算心里有数。"],
  ["🔗 一键分享", "整套方案生成一个链接发给家人或设计师，对方打开就能看能改。"],
];

const HOW_IT_WORKS: Array<[string, string]> = [
  ["1. 描述你的家", "用一句话说清想要的户型（几室几厅、面积、风格），或直接上传一张户型照片。"],
  ["2. AI 生成布局", "AI 生成房间布局和家具摆放，平面图和 3D 场景同步出现，不满意可以再改。"],
  ["3. 3D 精修漫游", "换风格模板、调材质、挪家具，实时看报价；走进房间漫游，确认每个细节。"],
  ["4. 分享与导出", "一键生成分享链接，或导出效果图和报价清单，发给家人、施工方都方便。"],
];

const FAQS: Array<[string, string]> = [
  ["筑雅是免费的吗？", "是的。设计、3D 漫游、报价和分享都可以在浏览器里免费使用，无需下载安装。"],
  ["需要下载安装吗？", "不需要。筑雅完全在网页浏览器里运行，手机和电脑都能打开，设计会自动保存在浏览器本地。"],
  ["AI 能生成什么样的户型？", "输入房间数量、面积和风格，AI 会生成对应的房间布局；也可以上传户型照片识别。生成后每个房间都可以手动调整，家具和材质全部可以换。"],
  ["装修报价是怎么算的？", "报价按你实际选用的家具和材料逐项计算，587 件家具都有真实价格。改方案时报价实时更新，方便控制预算。"],
  ["能设计咖啡馆、办公室这类商业空间吗？", "可以。样板间里有咖啡馆、办公室和餐厅三个商业场景，带真实的桌位、工位、包间和后厨布局，可以直接打开参考或改造成自己的方案。"],
  ["设计好的方案怎么分享给别人？", "点分享会生成一个链接，对方打开链接就能看到你的整套 3D 方案；也可以导出效果图和报价清单。"],
];

export default function HomePage() {
  return (
    <>
      {/* 设计器（客户端交互工具，保持原样，首屏 100vh） */}
      <div id="designer">
        <DesignerTool />
      </div>

      {/* ── 以下为服务端渲染的营销内容（SEO / 低内容价值修复）──
          纯服务端组件：文字直接进 SSR HTML，搜索引擎与广告审核可见。
          设计器本身不受影响（仍在上方 100vh 内完整可用）。 */}
      <main className="bg-white text-gray-900">
        {/* Hero */}
        <section className="max-w-5xl mx-auto px-6 pt-16 pb-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold leading-snug mb-4">
            ZHUYA 筑雅 — 免费 AI 家装设计
          </h1>
          <p className="text-base sm:text-lg text-gray-600 leading-relaxed max-w-3xl mx-auto mb-6">
            输入一句话或一张户型照片，AI 生成户型；在浏览器里 3D 装修、沉浸式漫游房间、
            设计建筑外观立面与庭院景观，装修实时报价，一键分享整套方案。无需下载，完全免费。
          </p>
          <a
            href="#designer"
            className="inline-block px-6 py-3 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#007AFF" }}
          >
            免费开始设计 →
          </a>
          <p className="mt-3 text-xs text-gray-400">无需注册 · 打开即用 · 手机电脑都支持</p>
        </section>

        {/* 出短片 featured — 云横店一键出片（首页醒目位置） */}
        <section className="max-w-5xl mx-auto px-6 pb-10">
          <div
            className="rounded-3xl overflow-hidden text-white shadow-xl"
            style={{ background: "linear-gradient(135deg,#0B1220 0%,#1D2B4F 55%,#0B3D91 100%)" }}
          >
            <div className="px-6 py-10 sm:px-10 sm:py-12">
              <div className="text-5xl mb-4">🎬</div>
              <h2 className="text-3xl sm:text-4xl font-bold mb-3">一键出短片</h2>
              <p className="text-base sm:text-lg text-white/80 leading-relaxed max-w-2xl mb-6">
                机位预设 → 录短片 + 首尾帧，一键导出喂 AI 视频模型，片场直接变短片。
                50 种导演风格、分镜故事板，整套控制包一次拿走。
              </p>
              <div className="flex flex-wrap gap-2 mb-8">
                <span className="text-xs px-2.5 py-1 rounded-full bg-white/10 text-white/85">50 种导演风格</span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-white/10 text-white/85">分镜故事板</span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-white/10 text-white/85">首尾帧控制包</span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-white/10 text-white/85">喂 AI 视频 / ComfyUI</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <a
                  href="/?shortfilm=1"
                  className="inline-block px-8 py-4 rounded-xl text-base font-bold text-white shadow-lg"
                  style={{ background: "#007AFF" }}
                >
                  🎬 一键出短片 →
                </a>
                <a href="/showcase" className="text-sm text-white/75 underline hover:text-white">
                  先去样板间挑个片场 →
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* 全部片场 — 首页醒目位置：63 个片场完整列表 */}
        <section className="bg-gray-900 text-gray-100">
          <div className="max-w-5xl mx-auto px-6 py-10">
            <h2 className="text-2xl font-bold mb-2">🎬 全部片场 · {FILM_SET_META.length} 个</h2>
            <p className="text-sm text-gray-400 mb-6">
              每一个都是真实 3D 场景：点「打开片场」进设计器漫游改装，点「出短片」直接开拍。
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FILM_SET_META.map((s) => (
                <div key={s.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-2xl mb-1">{s.emoji}</div>
                  <div className="font-semibold">{s.name}</div>
                  <p className="text-sm text-gray-400 leading-relaxed mt-1">{s.desc}</p>
                  <div className="mt-3 flex gap-4 text-sm font-semibold">
                    <a href={`/?template=${s.id}`} style={{ color: "#4DA3FF" }}>
                      打开片场 →
                    </a>
                    <a href={`/?shortfilm=1&template=${s.id}`} className="text-white/85 underline">
                      🎬 出短片
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="max-w-5xl mx-auto px-6 py-10">
          <h2 className="text-2xl font-bold mb-6">核心功能</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([title, desc]) => (
              <div key={title} className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <div className="font-semibold mb-1">{title}</div>
                <p className="text-sm text-gray-600 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-5xl mx-auto px-6 py-10">
          <h2 className="text-2xl font-bold mb-6">怎么用</h2>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map(([title, desc]) => (
              <li key={title} className="rounded-2xl border border-gray-200 p-5">
                <div className="font-semibold mb-1">{title}</div>
                <p className="text-sm text-gray-600 leading-relaxed">{desc}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Style templates (server-rendered from ALL_TEMPLATES) */}
        <section className="max-w-5xl mx-auto px-6 py-10">
          <h2 className="text-2xl font-bold mb-2">8 套风格模板，一键套用</h2>
          <p className="text-sm text-gray-600 mb-6">
            每套模板都配好了墙面、地面、灯光和家具，进设计器点一下就能整屋换装，再按喜好微调。
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ALL_TEMPLATES.map((t) => (
              <div key={t.id} className="rounded-2xl border border-gray-200 p-5">
                <div className="text-2xl mb-2">{t.emoji}</div>
                <div className="font-semibold">{t.name}</div>
                <div className="text-xs text-gray-400 mb-1">{t.nameEn}</div>
                <p className="text-sm text-gray-600 leading-relaxed">{t.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Showcase preview (server-rendered from SHOWCASE_META) */}
        <section className="max-w-5xl mx-auto px-6 py-10">
          <h2 className="text-2xl font-bold mb-2">样板间：先看看能做成什么样</h2>
          <p className="text-sm text-gray-600 mb-6">
            住宅别墅与商业片场都有真实 3D 场景，点开就能漫游，也可以直接拿来改。
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SHOWCASE_META.map((s) => (
              <a
                key={s.id}
                href={`/showcase/${s.id}`}
                className="block rounded-2xl overflow-hidden border border-gray-200 hover:shadow-lg transition"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.image}
                  alt={s.nameZh}
                  className="h-40 w-full object-cover"
                  loading="lazy"
                />
                <div className="p-4">
                  <div className="font-semibold">{s.nameZh}</div>
                  <p className="text-sm text-gray-600 leading-relaxed mt-1">{s.descZh}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.tagsZh.map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </a>
            ))}
          </div>
          <div className="mt-6">
            <a href="/showcase" className="text-sm font-semibold" style={{ color: "#007AFF" }}>
              浏览全部样板间 →
            </a>
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-5xl mx-auto px-6 py-10">
          <h2 className="text-2xl font-bold mb-6">常见问题</h2>
          <div className="space-y-5">
            {FAQS.map(([q, a]) => (
              <div key={q}>
                <h3 className="font-semibold mb-1">{q}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-gray-200 mt-4">
          <div className="max-w-5xl mx-auto px-6 py-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
            <a href="/showcase" className="hover:text-gray-900">样板间</a>
            <a href="/guides/cafe-design" className="hover:text-gray-900">咖啡馆设计指南</a>
            <a href="/guides/office-layout" className="hover:text-gray-900">办公室布局指南</a>
            <a href="/guides/restaurant-plan" className="hover:text-gray-900">餐厅平面指南</a>
            <a href="/guides/renovation-quote" className="hover:text-gray-900">装修报价指南</a>
            <a href="/credits" className="hover:text-gray-900">素材致谢</a>
            <span className="ml-auto text-xs text-gray-400">© 筑雅 ZHUYA · 免费在线 AI 家装设计</span>
          </div>
        </footer>
      </main>
    </>
  );
}
