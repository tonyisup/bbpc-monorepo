import type { Metadata } from "next";

import { InstallAppGuide } from "@/components/InstallAppGuide";

export const metadata: Metadata = {
  title: "Get the app | Bad Boys Podcast",
  description:
    "Put BBPC on your phone's home screen. It opens full screen like any other app, with no app store needed.",
};

export default function GetTheAppPage() {
  return (
    <div className="bbpc-page max-w-2xl">
      <p className="bbpc-kicker">BBPC on your phone</p>
      <h1 className="mt-1 text-4xl font-black tracking-tight text-white sm:text-5xl">
        Get the app
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-zinc-300">
        Add BBPC to your home screen and it opens full screen, like any other
        app. No app store, and it&apos;s always up to date.
      </p>
      <InstallAppGuide />
    </div>
  );
}
