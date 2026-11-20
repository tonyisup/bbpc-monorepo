import { type Metadata, type Viewport } from "next";
import { Inter } from "next/font/google";
import "@/styles/globals.css";
import Link from "next/link";
import { ListenHere } from "@/components/ListenHere";
import { Providers } from "@/components/Providers";
import { SiteHeader } from "@/components/SiteHeader";
import { ConvexAccountRecoveryBanner } from "@/components/ConvexAccountRecoveryBanner";
import { ConvexSiteAnnouncements } from "@/components/ConvexSiteAnnouncements";
import { SendFeedback } from "@/components/SendFeedback";
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
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: "Bad Boys Podcast",
  description: "Random rants on all things movie",
  // The manifest, icons and Apple tags below are what make the site
  // installable from the browser; keep them in step with public/manifest.json.
  manifest: "/manifest.json",
  applicationName: "BBPC",
  appleWebApp: {
    capable: true,
    // The site is dark, so a black status bar keeps the installed app from
    // showing a white strip at the top on iOS.
    statusBarStyle: "black",
    // The home-screen label; a longer name is cut off under the icon.
    title: "BBPC",
  },
  icons: {
    icon: "/favicon.ico",
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
  verification: {
    google: "SC5A9TotM4gBLo9UVqxKOyJG-d4Soj6ayNxE5lk9HNs",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans ${inter.variable} dark`}>
        <Providers>
          <div className="flex min-h-[100dvh] w-full min-w-0 flex-col items-center bg-[color:var(--bbpc-bg)]">
            <SiteHeader />
            <ConvexSiteAnnouncements />
            <ConvexAccountRecoveryBanner />
            <main className="w-full min-w-0 flex-grow">
              <div className="main-mask flex w-full min-w-0 flex-col text-white">
                {children}
              </div>
            </main>
            <footer className="flex w-full flex-col items-center border-t border-white/10 bg-[color:var(--bbpc-surface)]">
              <SendFeedback />
              <ListenHere />
              <div className="flex flex-wrap justify-center gap-4 pb-8 text-xs text-gray-400">
                <Link href="/app" className="hover:underline">
                  Get the app
                </Link>
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
