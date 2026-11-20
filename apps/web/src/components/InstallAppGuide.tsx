"use client";

import { useState, type ReactNode } from "react";
import {
  CheckCircle2,
  Download,
  MoreHorizontal,
  MoreVertical,
  PlusSquare,
  Share,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useInstallApp } from "@/hooks/useInstallApp";

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="mt-4 list-decimal space-y-3 pl-5 leading-relaxed text-zinc-300 marker:font-bold marker:text-red-300">
      {children}
    </ol>
  );
}

/** An inline icon standing in for the button the listener has to find. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex translate-y-0.5 items-center text-white [&_svg]:h-4 [&_svg]:w-4">
      {children}
    </span>
  );
}

function Section({
  title,
  headingId,
  children,
}: {
  title: string;
  headingId: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={headingId} className="bbpc-panel mt-6 p-5">
      <h2 id={headingId} className="text-xl font-bold text-white">
        {title}
      </h2>
      {children}
    </section>
  );
}

function IphoneSteps() {
  return (
    <Section title="iPhone and iPad" headingId="install-ios">
      <Steps>
        <li>
          Open <strong className="text-white">badboyspodcast.com/app</strong>{" "}
          in Safari.
        </li>
        <li>
          Tap the Share button{" "}
          <Glyph>
            <Share aria-label="Share" />
          </Glyph>
          . On newer iPhones it&apos;s inside the{" "}
          <Glyph>
            <MoreHorizontal aria-label="More" />
          </Glyph>{" "}
          menu at the bottom of the screen.
        </li>
        <li>
          Tap <strong className="text-white">Add to Home Screen</strong>{" "}
          <Glyph>
            <PlusSquare aria-hidden="true" />
          </Glyph>
          . If you don&apos;t see it, scroll down or tap{" "}
          <strong className="text-white">View More</strong>.
        </li>
        <li>
          Tap <strong className="text-white">Add</strong>.
        </li>
      </Steps>
      <p className="mt-4 text-sm leading-relaxed text-zinc-400">
        The home screen app keeps its own sign-in, separate from Safari, so
        sign in once more the first time you open it.
      </p>
    </Section>
  );
}

function AndroidSteps() {
  return (
    <Section title="Android" headingId="install-android">
      <Steps>
        <li>
          Open <strong className="text-white">badboyspodcast.com/app</strong>{" "}
          in Chrome.
        </li>
        <li>
          Tap the menu{" "}
          <Glyph>
            <MoreVertical aria-label="Menu" />
          </Glyph>{" "}
          in the top corner.
        </li>
        <li>
          Tap <strong className="text-white">Install app</strong> or{" "}
          <strong className="text-white">Add to Home screen</strong>, then
          confirm.
        </li>
      </Steps>
    </Section>
  );
}

function InstallButton({
  promptInstall,
}: {
  promptInstall: () => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="bbpc-panel mt-6 p-5">
      <Button
        size="lg"
        className="w-full sm:w-auto"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void promptInstall().finally(() => setBusy(false));
        }}
      >
        <Download aria-hidden="true" />
        Install BBPC
      </Button>
      <p className="mt-3 text-sm text-zinc-400">
        Your browser will ask you to confirm.
      </p>
    </div>
  );
}

/**
 * Install instructions for the device in hand. Before hydration (and on
 * desktop) it shows every phone's steps, since the server can't tell which
 * device is asking.
 */
export function InstallAppGuide() {
  const { mode, promptInstall } = useInstallApp();

  if (mode === "installed") {
    return (
      <div
        className="bbpc-panel mt-6 flex items-start gap-3 p-5"
        role="status"
      >
        <CheckCircle2
          className="mt-0.5 h-5 w-5 shrink-0 text-green-400"
          aria-hidden="true"
        />
        <p className="leading-relaxed text-zinc-200">
          You&apos;re using the BBPC app. Find it on your home screen any time.
        </p>
      </div>
    );
  }
  if (mode === "prompt") {
    return <InstallButton promptInstall={promptInstall} />;
  }
  if (mode === "ios") return <IphoneSteps />;
  if (mode === "android") return <AndroidSteps />;

  return (
    <>
      <IphoneSteps />
      <AndroidSteps />
      <p className="mt-6 text-sm leading-relaxed text-zinc-400">
        On a computer, Chrome and Edge show an install button in the address
        bar.
      </p>
    </>
  );
}
