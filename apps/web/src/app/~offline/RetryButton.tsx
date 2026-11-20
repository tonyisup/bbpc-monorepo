"use client";

import { Button } from "@/components/ui/button";

export function RetryButton() {
  return (
    <Button className="mt-6" onClick={() => window.location.reload()}>
      Try again
    </Button>
  );
}
