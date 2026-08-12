import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

const authConfigSource = readFileSync(
  new URL("./auth.config.ts", import.meta.url),
  "utf8",
);
const appConfigSource = readFileSync(
  new URL("./convex.config.ts", import.meta.url),
  "utf8",
);

describe("Clerk audience configuration", () => {
  test("keeps human and scoped machine audiences separate", () => {
    expect(authConfigSource).toContain(
      'applicationID: "convex"',
    );
    expect(authConfigSource).toContain(
      "applicationID: pipelineAudience",
    );
    expect(authConfigSource).toContain(
      "CLERK_M2M_AUDIENCE is required",
    );
  });

  test("declares the machine audience as deployment configuration", () => {
    expect(appConfigSource).toContain(
      "CLERK_M2M_AUDIENCE: v.string()",
    );
  });
});
