import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "办公室布局指南：240㎡开放式办公室工位、会议室与茶水间规划 · ZHUYA",
  description:
    "开放式办公室怎么排工位、会议室放哪里、茶水间多大才够用？这篇指南结合筑雅 240㎡ 办公室实景片场，讲清小办公室装修的布局要点。",
  keywords: ["办公室布局", "开放式办公室", "工位规划", "会议室", "茶水间", "办公室装修", "ZHUYA", "筑雅"],
  alternates: { canonical: "/guides/office-layout" },
  openGraph: {
    type: "article",
    siteName: "ZHUYA",
    title: "办公室布局指南：240㎡开放式办公室工位、会议室与茶水间规划",
    description:
      "开放式办公室怎么排工位、会议室放哪里、茶水间多大才够用？结合筑雅 240㎡ 办公室实景片场，讲清小办公室装修的布局要点。",
    url: "/guides/office-layout",
    locale: "zh_CN",
    images: [{ url: "/showcase/set-office.webp", alt: "办公室片场 · 240㎡ 开放式办公室" }],
  },
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.zhuyahome.com";

export default function OfficeLayoutGuide() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "办公室布局指南：240㎡开放式办公室工位、会议室与茶水间规划",
    description:
      "开放式办公室怎么排工位、会议室放哪里、茶水间多大才够用？结合筑雅 240㎡ 办公室实景片场，讲清小办公室装修的布局要点。",
    url: `${SITE_URL}/guides/office-layout`,
    image: `${SITE_URL}/showcase/set-office.webp`,
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
          <a href="/guides/office-layout" className="underline">设计指南</a>
          {" · "}
          <a href="/showcase/set-office" className="underline">办公室片场</a>
        </p>
        <h1 className="text-3xl font-bold leading-snug mb-3">
          办公室布局指南：240㎡开放式办公室工位、会议室与茶水间规划
        </h1>
        <p className="text-gray-600 leading-relaxed mb-8">
          开放式办公室怎么排工位、会议室放哪里、茶水间多大才够用？这篇指南结合筑雅 240㎡ 办公室实景片场，讲清小办公室装修的布局要点。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">开放工位：先算人数，再排桌子</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          开放式工位的核心是先定人数，再反推面积。工位不要贴墙排满，要按小组排成岛式或列式，组内面对面方便沟通，组与组之间留出主通道。筑雅的办公室片场是 240㎡ 的开放工位布局，工位区居中，通道环绕，任何一个工位走到门口、会议室或茶水间都不用穿过别人的工位区。工位桌面深度、显示器距离和椅子后退空间都要算进去，否则人坐满了才发现椅子顶着过道。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">会议室放在哪里最合适</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          会议室建议放在靠近入口或角落的位置：一是访客开会不用穿过整个办公区，二是会议的说话声离专注工位最远。小型会议室 6–8 人够用，配一面白板墙或投影面；如果经常开视频会，单独隔出一间小电话间或 2–3 人的小会议室，比大会议室更实用。玻璃隔断能借光、显通透，但要记得加磨砂条或百叶，避免开会时一览无余。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">茶水间与环形大堂别省</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          茶水间不是边角料，它是办公室的社交节点：水吧、微波炉、冰箱和储物集中放，地面选好打理的材质，插座留够。筑雅办公室片场的环形大堂值得借鉴——入口大堂环形贯通，访客、员工、会议人流各走各的，互不干扰。大堂可以放一组沙发和绿植，既是等候区，也是公司形象的第一面。
        </p>

        <h2 className="text-xl font-bold mt-10 mb-3">先在 3D 里走一遍再定稿</h2>
        <p className="text-gray-700 leading-relaxed mb-6">
          平面图看不出走路的感觉，3D 场景可以。把工位、会议室、茶水间按真实尺寸摆进筑雅的办公室片场，用第一人称走一遍：从门口到工位要几步、端着咖啡去茶水间会不会撞上开会的人、会议室的门开向会不会挡住通道。走一遍，问题基本都暴露了。
        </p>

        <div className="rounded-2xl bg-gray-50 border border-gray-200 p-5 mt-8">
          <p className="font-semibold mb-2">在筑雅打开办公室片场试试</p>
          <p className="text-sm text-gray-600 mb-4">
            按你团队的人数重新排一版工位与会议室。
          </p>
          <a
            href="/showcase/set-office"
            className="inline-block px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#007AFF" }}
          >
            打开办公室片场 →
          </a>
        </div>

        <footer className="mt-12 pt-6 border-t border-gray-200 text-sm text-gray-500">
          <p className="mb-2">相关指南：</p>
          <a href="/guides/cafe-design" className="underline mr-4">咖啡馆设计指南</a>
          <a href="/guides/restaurant-plan" className="underline mr-4">餐厅平面设计指南</a>
          <a href="/guides/renovation-quote" className="underline">装修报价指南</a>
          <p className="mt-6 text-xs text-gray-400">© 筑雅 ZHUYA · 免费在线 AI 家装设计</p>
        </footer>
      </main>
    </div>
  );
}
