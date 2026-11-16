"use client";

/**
 * ShowcaseIdHandler — ?id= 直达链接处理（极小客户端组件）。
 *
 * /showcase?id=set-cafe 这类链接直接打开对应场景的查看器；id 非法或缺失时
 * 什么都不做（回落到画廊）。只在挂载时读一次 searchParams。
 *
 * 单独成组件、包在 Suspense 里：useSearchParams 会让所在组件跳过服务端
 * 渲染——隔离出来后，画廊卡片与 SEO 文字仍能正常进 SSR HTML。
 */
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { SHOWCASE_META } from "@/lib/showcaseMeta";

export default function ShowcaseIdHandler({
  onDeepLink,
}: {
  onDeepLink: (id: string) => void;
}) {
  const searchParams = useSearchParams();

  useEffect(() => {
    const id = searchParams.get("id");
    if (id && SHOWCASE_META.some((t) => t.id === id)) onDeepLink(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
