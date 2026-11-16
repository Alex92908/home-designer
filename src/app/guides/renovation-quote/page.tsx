import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "装修报价指南：装修多少钱？先看面积、材料与家具这三笔账 · ZHUYA",
  description:
    "装修报价由什么决定？面积、材料档次与家具选择都会影响总价。这篇指南讲清装修报价的构成，并用筑雅的真实家具价格举例，教你用实时报价算清自己的账。",
  keywords: ["装修报价", "装修多少钱", "装修预算", "家具价格", "装修费用", "ZHUYA", "筑雅"],
  alternates: { canonical: "/guides/renovation-quote" },
  openGraph: {
    type: "article",
    siteName: "ZHUYA",
    title: "装修报价指南：装修多少钱？先看面积、材料与家具这三笔账",
    description:
      "装修报价由什么决定？面积、材料档次与家具选择都会影响总价。讲清装修报价的构成，并用筑雅的真实家具价格举例，教你用实时报价算清自己的账。",
    url: "/guides/renovation-quote",
    locale: "zh_CN",
  },
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.zhuyahome.com";

export default function RenovationQuoteGuide() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "装修报价指南：装修多少钱？先看面积、材料与家具这三笔账",
    description:
      "装修报价由什么决定？面积、材料档次与家具选择都会影响总价。这篇指南讲清装修报价的构成，并用筑雅的真实家具价格举例，教你用实时报价算清自己的账。",
    url: `${SITE_URL}/guides/renovation-quote`,
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
          <a href="/guides/renovation-quote" className="underline">设计指南</a>
        </p>
        <h1 className="text-3xl font-bold leading-snug mb-3">
          装修报价指南：装修多少钱？先看面积、材料与家具这三笔账
        </h1>
        <p className="text-gray-600 leading-relaxed mb-8">
          装修报价由什么决定？面积、材料档次与家具选择都会影响总价。这篇指南讲清装修报价的构成，并用筑雅的真实家具价格举例，教你用实时报价算清自己的账。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">报价由三部分决定，别只看一个总数</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          装修报价不是一个神秘数字，它由三笔账组成：基础施工（拆改、水电、泥木、油漆）、主材与定制（地板、瓷砖、门、柜体）、家具与软装。面积决定了前两笔的规模，材料档次决定了单价，家具则是最容易被低估的一笔——很多人硬装谈好了，家具一算才发现超预算。看报价要看逐项明细，而不是只看一个打包总数。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">家具价格举例：先看真实标价，再做预算</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          筑雅的家具库里 587 件家具都带真实价格，可以直接拿来做预算参考。比如客厅：一张布艺三人沙发 ¥4,800，一张无腿榻榻米沙发 ¥3,800，想要质感更好的真皮 L 型沙发是 ¥15,800；茶几也有档次之分，橡木圆形茶几 ¥1,800，大理石方形茶几 ¥4,200。同一件家具，不同材质、尺寸，价格能差几倍——先定档次，再算总数，才不会越买越超支。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">材料与风格怎么影响预算</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          风格选择会直接影响材料预算。北欧轻奢的白墙橡木、日式侘寂的竹木自然，用材相对克制；轻奢现代的胡桃深木加大理石元素、新中式的禅意收藏，材料与工艺成本会更高；工业复古的水泥灰地与裸黑铁艺，省在饰面、贵在细节收口。没有哪种风格天生更贵，贵的是材料档次与工艺复杂度，选风格之前先想清楚自己愿意为哪些地方花钱。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">在筑雅用实时报价算自己的数</h2>
        <p className="text-gray-700 leading-relaxed mb-6">
          装修到底多少钱，没有放之四海皆准的每平米单价——面积、材料、家具一变，总价就跟着变。靠谱的做法是按自己的方案逐项算：在筑雅生成平面图、选好风格模板、把家具一件件摆进去，实时报价会按你选的家具逐项算出总价。换一张沙发、换一种茶几，总价立刻跟着变，改方案、控预算都在一处完成，比拿着一张打包报价单猜要清楚得多。
        </p>

        <div className="rounded-2xl bg-gray-50 border border-gray-200 p-5 mt-8">
          <p className="font-semibold mb-2">在筑雅打开设计器，算算你自己的装修报价</p>
          <p className="text-sm text-gray-600 mb-4">
            选一套风格模板、摆几件家具，看看你自己的装修报价实时是多少。
          </p>
          <a
            href="/"
            className="inline-block px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#007AFF" }}
          >
            免费开始设计 →
          </a>
        </div>

        <footer className="mt-12 pt-6 border-t border-gray-200 text-sm text-gray-500">
          <p className="mb-2">相关指南：</p>
          <a href="/guides/cafe-design" className="underline mr-4">咖啡馆设计指南</a>
          <a href="/guides/office-layout" className="underline mr-4">办公室布局指南</a>
          <a href="/guides/restaurant-plan" className="underline">餐厅平面设计指南</a>
          <p className="mt-6 text-xs text-gray-400">© 筑雅 ZHUYA · 免费在线 AI 家装设计</p>
        </footer>
      </main>
    </div>
  );
}
