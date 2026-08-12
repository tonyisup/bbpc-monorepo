// @ts-check
/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation.
 * This is especially useful for Docker builds.
 */
await import("./src/env.mjs");

import createPWA from "@ducanh2912/next-pwa";

const withPWA = createPWA({
  dest: "public",
  register: true,
  workboxOptions: {
    skipWaiting: true,
  },
  disable:
    process.env.NODE_ENV === "development" ||
    process.env.BBPC_DISABLE_PWA_BUILD === "1",
});

const config = withPWA({
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/tags",
        destination: "/history",
        permanent: true,
      },
      {
        source: "/tags/:path*",
        destination: "/history",
        permanent: true,
      },
    ];
  },
  i18n: {
    locales: ["en"],
    defaultLocale: "en",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        port: "",
        hostname: "i.ytimg.com",
        pathname: "/vi/**/*",
      },
      {
        protocol: "https",
        port: "",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**/*",
      },
      {
        protocol: "https",
        port: "",
        hostname: "tools.applemediaservices.com",
        pathname: "/api/badges/**/*",
      },
    ],
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
});

export default config;
