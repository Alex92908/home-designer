import type { NextConfig } from "next";

// Set NEXT_EXPORT=1 to generate a fully static site (for self-hosting / China CDN)
const isStaticExport = process.env.NEXT_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(isStaticExport && {
    output: "export",
    distDir: "out",
    images: { unoptimized: true },
  }),
};

export default nextConfig;
