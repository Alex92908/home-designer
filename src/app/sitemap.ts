import type { MetadataRoute } from "next";
import { SHOWCASE_META } from "@/lib/showcaseMeta";

// output: export（静态导出）要求元数据路由显式声明静态，否则 build 失败。
export const dynamic = "force-static";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.zhuyahome.com";

// 设计指南（/guides/*），与 src/app/guides/ 下的路由一一对应。
const GUIDE_SLUGS = [
  "cafe-design",
  "office-layout",
  "restaurant-plan",
  "renovation-quote",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  // /view 是分享链接查看器（需 ?d= 参数），/api/* 已在 robots 屏蔽，均不入站点地图。
  // 样板间单页（/showcase/[id]）与指南页（/guides/*）均为可独立访问的内容页，全部收录。
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/showcase`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...SHOWCASE_META.map((s) => ({
      url: `${SITE_URL}/showcase/${s.id}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...GUIDE_SLUGS.map((slug) => ({
      url: `${SITE_URL}/guides/${slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
    { url: `${SITE_URL}/credits`, lastModified: now, changeFrequency: "monthly", priority: 0.2 },
  ];
}
