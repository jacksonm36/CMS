import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hostpanel/ui", "@hostpanel/types"],
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      { protocol: "https", hostname: "**" },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
