import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "咖啡馆设计指南：78㎡小型咖啡馆布局、吧台与卡座规划 · ZHUYA",
  description:
    "小型咖啡馆怎么布局才不挤？从玻璃店面、吧台动线到卡座与书架墙，这篇指南结合筑雅的云横咖啡实景片场（78㎡），讲清小咖啡馆装修的关键做法。",
  keywords: ["咖啡馆设计", "咖啡馆布局", "咖啡馆装修", "吧台设计", "卡座", "小咖啡馆", "ZHUYA", "筑雅"],
  alternates: { canonical: "/guides/cafe-design" },
  openGraph: {
    type: "article",
    siteName: "ZHUYA",
    title: "咖啡馆设计指南：78㎡小型咖啡馆布局、吧台与卡座规划",
    description:
      "小型咖啡馆怎么布局才不挤？从玻璃店面、吧台动线到卡座与书架墙，结合筑雅云横咖啡实景片场（78㎡），讲清小咖啡馆装修的关键做法。",
    url: "/guides/cafe-design",
    locale: "zh_CN",
    images: [{ url: "/showcase/set-cafe.webp", alt: "云横咖啡 · 78㎡ 咖啡馆片场" }],
  },
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.zhuyahome.com";

export default function CafeDesignGuide() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "咖啡馆设计指南：78㎡小型咖啡馆布局、吧台与卡座规划",
    description:
      "小型咖啡馆怎么布局才不挤？从玻璃店面、吧台动线到卡座与书架墙，结合筑雅云横咖啡实景片场（78㎡），讲清小咖啡馆装修的关键做法。",
    url: `${SITE_URL}/guides/cafe-design`,
    image: `${SITE_URL}/showcase/set-cafe.webp`,
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
          <a href="/guides/cafe-design" className="underline">设计指南</a>
          {" · "}
          <a href="/showcase/set-cafe" className="underline">云横咖啡片场</a>
        </p>
        <h1 className="text-3xl font-bold leading-snug mb-3">
          咖啡馆设计指南：78㎡小型咖啡馆布局、吧台与卡座规划
        </h1>
        <p className="text-gray-600 leading-relaxed mb-8">
          小型咖啡馆怎么布局才不挤？从玻璃店面、吧台动线到卡座与书架墙，这篇指南结合筑雅的云横咖啡实景片场（78㎡），讲清小咖啡馆装修的关键做法。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">先定动线：从玻璃店面到吧台</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          小咖啡馆的第一步不是选家具，而是定动线。顾客从店面进来，第一眼看到的应该是吧台和菜单，而不是杂物或后场。筑雅的云横咖啡片场就是按这个逻辑排的：78㎡，玻璃店面朝外，吧台居中承接点单与出杯，顾客进门后自然分流到座位区，不用绕路。吧台长度要留出点单、制作、取餐三个工位，吧台后方留足一人通过的操作通道，避免高峰期两个人互相让路。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">卡座与散座怎么配</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          云横咖啡片场里是吧台加 4 组卡座的组合，这个比例值得参考：卡座适合 2–4 人久坐、聊天和办公，翻台慢但客单价和停留时间更高；散座灵活，适合 1–2 人的短暂停留。小店建议卡座占座位的一半左右，靠墙、靠窗优先放卡座，中间留散座，留白处不要塞满桌椅——过道太窄，端咖啡会撞到人。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">书架墙与氛围细节</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          书架墙是小咖啡馆性价比很高的氛围做法：一面墙的书架既是装饰，也是隔断，还能放绿植和杯子。注意别做成纯摆设的假书墙，留一部分可取阅的书和杂志，顾客才真的会停下来。灯光上，吧台上方用暖光重点照明，座位区光线放柔，整体色温保持一致，别让冷暖光混在一起。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">用筑雅先排一遍，再决定装修</h2>
        <p className="text-gray-700 leading-relaxed mb-6">
          在动工之前，先把平面图排出来比空想要可靠得多。在筑雅输入一段文字就能生成咖啡馆平面图，再进 3D 场景里走一走：看看从门口到吧台的视线通不通、卡座之间留的距离够不够、书架墙的位置会不会挡光。改方案在软件里是几分钟的事，改在工地上就是真金白银。
        </p>

        <div className="rounded-2xl bg-gray-50 border border-gray-200 p-5 mt-8">
          <p className="font-semibold mb-2">在筑雅打开云横咖啡片场试试</p>
          <p className="text-sm text-gray-600 mb-4">
            把你的店面尺寸换进去，排一版属于自己的咖啡馆布局。
          </p>
          <a
            href="/showcase/set-cafe"
            className="inline-block px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#007AFF" }}
          >
            打开云横咖啡片场 →
          </a>
        </div>

        <footer className="mt-12 pt-6 border-t border-gray-200 text-sm text-gray-500">
          <p className="mb-2">相关指南：</p>
          <a href="/guides/office-layout" className="underline mr-4">办公室布局指南</a>
          <a href="/guides/restaurant-plan" className="underline mr-4">餐厅平面设计指南</a>
          <a href="/guides/renovation-quote" className="underline">装修报价指南</a>
          <p className="mt-6 text-xs text-gray-400">© 筑雅 ZHUYA · 免费在线 AI 家装设计</p>
        </footer>
      </main>
    </div>
  );
}
