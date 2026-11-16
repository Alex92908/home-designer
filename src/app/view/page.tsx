import type { Metadata } from "next";
import { Suspense } from "react";
import ViewerClient from "./ViewerClient";
import LocalizedLoading from "@/components/LocalizedLoading";
import { decodeSnapshot } from "@/lib/shareUrl";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.zhuyahome.com";

// 动态 OG：分享链接带 ?d=<压缩快照>，快照里有可选的方案名（name）。
// 能解码且有名时，用方案名做标题/描述；否则回落到通用文案。
// OG 图：快照不绑定某个样板间场景，无法可靠取场景缩略图，故用站点默认
// opengraph-image（src/app/opengraph-image.png，Next.js 自动提供），
// 保证分享出去总有预览图，而不是没有 og:image。
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}): Promise<Metadata> {
  const fallback: Metadata = {
    title: "方案预览 · ZHUYA",
    description: "查看别人分享的装修方案 — 免费在线 AI 家装设计工具 ZHUYA。",
    alternates: { canonical: "/view" },
    openGraph: {
      type: "website",
      siteName: "ZHUYA",
      title: "方案预览 · ZHUYA",
      description: "查看别人分享的装修方案 — 免费在线 AI 家装设计工具 ZHUYA。",
      url: "/view",
      locale: "zh_CN",
      images: [{ url: `${SITE_URL}/opengraph-image.png`, alt: "ZHUYA 筑雅" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "方案预览 · ZHUYA",
      description: "查看别人分享的装修方案 — 免费在线 AI 家装设计工具 ZHUYA。",
      images: [`${SITE_URL}/opengraph-image.png`],
    },
  };

  const { d } = await searchParams;
  if (!d) return fallback;
  let name: string | undefined;
  try {
    const snapshot = await decodeSnapshot(d);
    name = snapshot.name?.trim();
  } catch {
    return fallback;
  }
  if (!name) return fallback;

  const title = `${name} · ZHUYA 方案预览`;
  const description = `查看「${name}」的 3D 装修方案 — 免费在线 AI 家装设计工具 ZHUYA。`;
  return {
    ...fallback,
    title,
    description,
    openGraph: {
      ...fallback.openGraph,
      title,
      description,
    },
    twitter: {
      ...fallback.twitter,
      title,
      description,
    },
  };
}

export default function ViewPage() {
  return (
    <Suspense fallback={<LocalizedLoading />}>
      <ViewerClient />
    </Suspense>
  );
}
