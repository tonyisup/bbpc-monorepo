// PROTOTYPE ONLY (issue #94): three variants of the scorecard's Score tab card,
// switchable via ?variant=A|B|C on /year/scorecard/prototype. Real /year movies,
// scores kept in memory (nothing is saved). Lives on branch
// prototype/scorecard-score-card; never merge to main.

import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ScorecardPrototype } from "./ScorecardPrototype";

export default function ScorecardPrototypePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense>
      <ScorecardPrototype />
    </Suspense>
  );
}
