import { Suspense } from "react";
import ViewerClient from "./ViewerClient";

export const metadata = {
  title: "方案预览 · 筑雅 ZHUYA",
  description: "查看别人分享的装修方案",
};

export default function ViewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-gray-900">
          <div className="text-gray-400 text-sm">加载中…</div>
        </div>
      }
    >
      <ViewerClient />
    </Suspense>
  );
}
