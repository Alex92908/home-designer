import type { NextConfig } from "next";

// Set NEXT_EXPORT=1 to generate a fully static site (for self-hosting / China CDN)
const isStaticExport = process.env.NEXT_EXPORT === "1";

const nextConfig: NextConfig = {
  // React 19 StrictMode double-mounts components, which @react-three/fiber
  // 9.5 doesn't handle cleanly — unmount disposes the WebGL context and
  // remount races on reading gl.getContextAttributes().alpha → runtime
  // error. Disabling until r3f fixes the lifecycle. (Affects dev only;
  // production builds don't use StrictMode.)
  reactStrictMode: false,
  ...(isStaticExport && {
    output: "export",
    distDir: "out",
    images: { unoptimized: true },
  }),
};

export default nextConfig;
