import type { MetadataRoute } from "next";

// output: export（静态导出）要求元数据路由显式声明静态，否则 build 失败。
export const dynamic = "force-static";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://zhuyahome.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  // 只收录可独立访问的内容页。/view 是分享链接查看器（需 ?d= 参数），
  // /api/* 已在 robots 屏蔽，均不入站点地图。
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/showcase`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE_URL}/credits`, lastModified: now, changeFrequency: "monthly", priority: 0.2 },
  ];
}
