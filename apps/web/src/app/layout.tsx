import { type Metadata, type Viewport } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";
import Link from "next/link";
import { ListenHere } from "@/components/ListenHere";
import { Providers } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";
import { ConvexAccountRecoveryBanner } from "@/components/ConvexAccountRecoveryBanner";
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

function getSiteUrl() {
  if (process.env.NODE_ENV === "production") {
    return "https://badboyspodcast.com";
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

export const viewport: Viewport = {
  themeColor: "black",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: "Bad Boys Podcast",
  description: "Random rants on all things movie",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Bad Boys Podcast",
  },
  icons: [
    { rel: "icon", url: "/favicon.ico" },
    { rel: "apple-touch-icon", url: "/icons/icon-192x192.png" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="description" content="Random rants on all things movie" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="black" />
        <meta
          name="google-site-verification"
          content="SC5A9TotM4gBLo9UVqxKOyJG-d4Soj6ayNxE5lk9HNs"
        />
        <title>Bad Boys Podcast</title>
      </head>
      <body className={`font-sans ${inter.variable} dark`}>
        <Providers>
          <div className="flex min-h-[100dvh] w-full min-w-0 flex-col items-center bg-[color:var(--bbpc-bg)]">
            <SiteHeader />
            <ConvexAccountRecoveryBanner />
            <main className="w-full min-w-0 flex-grow">
              <div className="main-mask flex w-full min-w-0 flex-col text-white">
                {children}
              </div>
            </main>
            <footer className="flex w-full flex-col items-center border-t border-white/10 bg-[color:var(--bbpc-surface)]">
              <ListenHere />
              <div className="flex flex-wrap justify-center gap-4 pb-8 text-xs text-gray-400">
                <Link href="/privacy" className="hover:underline">
                  Privacy Policy
                </Link>
                <Link href="/terms" className="hover:underline">
                  Terms of Service
                </Link>
                <Link href="/data-deletion" className="hover:underline">
                  Data Deletion
                </Link>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
