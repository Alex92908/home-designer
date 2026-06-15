import { Suspense } from "react";
import ShowcaseClient from "./ShowcaseClient";

export const metadata = {
  title: "样板间 · 筑雅 ZHUYA",
  description: "浏览精选住宅设计的 3D 外观",
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
