import { Suspense } from "react";

import { ConvexScorecardPage } from "./ConvexScorecardPage";

export default function ScorecardPage() {
  return (
    <Suspense>
      <ConvexScorecardPage />
    </Suspense>
  );
}
