// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Lint only src, but don't fail builds on ESLint errors
  eslint: {
    dirs: ["src"],
    ignoreDuringBuilds: true,
  },

  // Keep TS errors blocking builds
  typescript: {
    ignoreBuildErrors: false,
  },

  // The app renders plain <img> tags with local assets only; disabling the
  // optimizer keeps the sharp/libvips image pipeline unreachable.
  images: {
    unoptimized: true,
  },

  experimental: {
    optimizePackageImports: ["three", "@react-three/drei"],
  },

  compress: true,

  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/:all*\\.(png|jpg|jpeg|svg|gif|webp|avif|ico|woff|woff2|ttf|eot)$",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
