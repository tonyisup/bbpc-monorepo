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
  // A flaky phone connection would otherwise reload the page and throw away
  // whatever the listener was typing or recording.
  reloadOnOnline: false,
  // Pages offline with no cached copy get src/app/~offline instead of the
  // browser's error page.
  fallbacks: { document: "/~offline" },
  // The scorecard's 90 illustrations (about 2 MB) load only on that private
  // page, so keep them out of the precache every visitor downloads.
  publicExcludes: ["!noprecache/**/*", "!scorecard/**/*"],
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    skipWaiting: true,
    runtimeCaching: [
      {
        // Clerk's session API answers differently per sign-in. The default
        // cross-origin rule would serve a stale cached answer whenever the
        // network takes over ten seconds, which can show a signed-in listener
        // as signed out, so always go to the network.
        urlPattern: ({ url }) =>
          url.hostname.startsWith("clerk.") ||
          url.hostname.endsWith(".clerk.accounts.dev"),
        handler: "NetworkOnly",
      },
    ],
  },
  disable:
    process.env.NODE_ENV === "development" ||
    process.env.BBPC_DISABLE_PWA_BUILD === "1",
});

const config = withPWA({
  reactStrictMode: true,
  transpilePackages: ["@bbpc/movie-search-hints", "@bbpc/episode-search", "@bbpc/youtube"],
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
    // Remote posters and thumbnails are already sized by TMDB and YouTube, and
    // Vercel Hobby caps image transformations, so serve every image as-is.
    // The settings below keep the variant count low if this is ever re-enabled.
    unoptimized: true,
    minimumCacheTTL: 60 * 60 * 24 * 7,
    formats: ["image/webp"],
    qualities: [75],
    remotePatterns: [
      {
        protocol: "https",
        port: "",
        hostname: "i.ytimg.com",
        pathname: "/vi/**/*",
      },
      // Catalog posters are stored at w342; older rows use w500.
      {
        protocol: "https",
        port: "",
        hostname: "image.tmdb.org",
        pathname: "/t/p/w342/**",
      },
      {
        protocol: "https",
        port: "",
        hostname: "image.tmdb.org",
        pathname: "/t/p/w500/**",
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
