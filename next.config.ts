import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/shortcuts/published/:slug",
        destination: "/p/:slug",
        permanent: true,
      },
      {
        source: "/shortcuts/published/:slug/opengraph-image",
        destination: "/p/:slug/opengraph-image",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
