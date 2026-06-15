import { Suspense } from "react";
import ShowcaseClient from "./ShowcaseClient";

export const metadata = {
  title: "样板间 · 筑雅 ZHUYA AI 家装设计",
  description:
    "筑雅 ZHUYA 样板间：浏览精选住宅的 3D 外观与户型设计。免费在线 AI 家装工具，支持 AI 文生户型、3D 实时装修与漫游、建筑外观立面、庭院景观设计、实时装修报价与一键分享。",
  keywords: ["筑雅", "ZHUYA", "样板间", "AI 装修设计", "3D 户型", "别墅外观设计", "室内设计", "庭院设计", "装修效果图"],
  alternates: { canonical: "/showcase" },
  openGraph: {
    type: "website",
    siteName: "筑雅 ZHUYA",
    title: "样板间 · 筑雅 ZHUYA AI 家装设计",
    description: "浏览精选住宅设计的 3D 外观与户型，免费在线 AI 家装设计工具。",
    url: "/showcase",
    locale: "zh_CN",
  },
};

export default function ShowcasePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-gray-900">
          <div className="text-gray-400 text-sm">加载中…</div>
        </div>
      }
    >
      <ShowcaseClient />
    </Suspense>
  );
}
