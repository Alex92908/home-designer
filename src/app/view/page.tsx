import { Suspense } from "react";
import ViewerClient from "./ViewerClient";
import LocalizedLoading from "@/components/LocalizedLoading";

export const metadata = {
  title: "方案预览 · ZHUYA",
  description: "查看别人分享的装修方案",
};

export default function ViewPage() {
  return (
    <Suspense fallback={<LocalizedLoading />}>
      <ViewerClient />
    </Suspense>
  );
}
