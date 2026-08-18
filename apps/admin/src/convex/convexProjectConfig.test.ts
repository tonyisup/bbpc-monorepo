import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Convex project configuration", () => {
  it("points accidental admin-side Convex commands at the shared backend", () => {
    const configPath = path.resolve(process.cwd(), "convex.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      functions?: string;
    };

    expect(config.functions).toBe("../../packages/convex-backend/convex");
    expect(
      fs.existsSync(path.resolve(path.dirname(configPath), config.functions!)),
    ).toBe(true);
  });
});
