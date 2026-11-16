import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "餐厅平面设计指南：320㎡餐厅大厅、包间与后厨布局 · ZHUYA",
  description:
    "餐厅平面图怎么画？大厅餐位排多密、包间放几个、后厨动线怎么走？这篇指南结合筑雅 320㎡ 餐厅实景片场，讲清饭店布局设计的关键。",
  keywords: ["餐厅平面图", "餐厅布局", "餐厅设计", "包间", "后厨动线", "饭店装修", "ZHUYA", "筑雅"],
  alternates: { canonical: "/guides/restaurant-plan" },
  openGraph: {
    type: "article",
    siteName: "ZHUYA",
    title: "餐厅平面设计指南：320㎡餐厅大厅、包间与后厨布局",
    description:
      "餐厅平面图怎么画？大厅餐位排多密、包间放几个、后厨动线怎么走？结合筑雅 320㎡ 餐厅实景片场，讲清饭店布局设计的关键。",
    url: "/guides/restaurant-plan",
    locale: "zh_CN",
    images: [{ url: "/showcase/set-restaurant.webp", alt: "餐厅片场 · 320㎡ 餐厅" }],
  },
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.zhuyahome.com";

export default function RestaurantPlanGuide() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "餐厅平面设计指南：320㎡餐厅大厅、包间与后厨布局",
    description:
      "餐厅平面图怎么画？大厅餐位排多密、包间放几个、后厨动线怎么走？结合筑雅 320㎡ 餐厅实景片场，讲清饭店布局设计的关键。",
    url: `${SITE_URL}/guides/restaurant-plan`,
    image: `${SITE_URL}/showcase/set-restaurant.webp`,
    inLanguage: "zh-CN",
  };
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main className="max-w-3xl mx-auto px-6 py-12">
        <p className="text-sm text-gray-400 mb-2">
          <a href="/guides/restaurant-plan" className="underline">设计指南</a>
          {" · "}
          <a href="/showcase/set-restaurant" className="underline">餐厅片场</a>
        </p>
        <h1 className="text-3xl font-bold leading-snug mb-3">
          餐厅平面设计指南：320㎡餐厅大厅、包间与后厨布局
        </h1>
        <p className="text-gray-600 leading-relaxed mb-8">
          餐厅平面图怎么画？大厅餐位排多密、包间放几个、后厨动线怎么走？这篇指南结合筑雅 320㎡ 餐厅实景片场，讲清饭店布局设计的关键。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">大厅：餐位密度决定翻台与体验</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          大厅是餐厅赚钱的主力区，餐位密度要算两笔账：排得太密，翻台快但顾客坐得难受、服务员上菜都转不开身；排得太松，坪效上不去。筑雅的餐厅片场是 320㎡，大厅以卡座加散台组合为主，卡座靠墙、靠窗，散台居中，主通道留出双向通行的宽度，服务员端着托盘能直行，不用侧身。桌与桌之间至少留出一人侧身通过的空隙，这是底线。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">包间与 VIP 房：安静、私密、好找</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          包间和 VIP 房要放在大厅的另一侧或二层，用走廊与大厅隔开，隔音做好，门一关就是独立空间。包间数量不必多，2–4 间、每间 8–12 人是常见配置，配独立的备餐柜和服务动线，避免服务员端菜穿过大厅。VIP 房可以配单独的入口或等候区，动线上与普通客流分开，体验感立刻不一样。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">后厨动线：进菜、出菜、收碗三条线别打架</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          后厨是餐厅的心脏，动线错了，全店都乱。基本原则是三条线分开：进货与粗加工从后门进，出菜口对着大厅最近的通道，收碗与洗消走另一条回路。冷菜、热菜、出餐口按出菜顺序排，减少厨师折返。吧台与等位区建议放在入口附近：等位的客人顺手点一杯饮品，既消化了等待时间，也多一份收入。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">用真实片场先排平面图，再谈装修</h2>
        <p className="text-gray-700 leading-relaxed mb-6">
          餐厅装修最怕开业才发现动线打架。在筑雅输入面积与需求生成平面图，再进 320㎡ 餐厅片场里走一遍：从门口到包间要经过大厅吗？出菜口到最远的卡座要走几步？吧台会不会挡住入口视线？这些问题在 3D 里一眼就能看出来，改起来也快。
        </p>

        <div className="rounded-2xl bg-gray-50 border border-gray-200 p-5 mt-8">
          <p className="font-semibold mb-2">在筑雅打开餐厅片场试试</p>
          <p className="text-sm text-gray-600 mb-4">
            把你的面积与包间数量换进去，排一版自己的餐厅平面图。
          </p>
          <a
            href="/showcase/set-restaurant"
            className="inline-block px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#007AFF" }}
          >
            打开餐厅片场 →
          </a>
        </div>

        <footer className="mt-12 pt-6 border-t border-gray-200 text-sm text-gray-500">
          <p className="mb-2">相关指南：</p>
          <a href="/guides/cafe-design" className="underline mr-4">咖啡馆设计指南</a>
          <a href="/guides/office-layout" className="underline mr-4">办公室布局指南</a>
          <a href="/guides/renovation-quote" className="underline">装修报价指南</a>
          <p className="mt-6 text-xs text-gray-400">© 筑雅 ZHUYA · 免费在线 AI 家装设计</p>
        </footer>
      </main>
    </div>
  );
}
