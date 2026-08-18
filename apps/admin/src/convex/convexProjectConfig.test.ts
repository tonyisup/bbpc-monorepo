import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Convex project configuration", () => {
  it("points accidental admin-side Convex commands at the shared backend", () => {
    const configPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../convex.json"
    );
    const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      functions?: string;
    };

    expect(config.functions).toBe("../../packages/convex-backend/convex");
    if (typeof config.functions !== "string") {
      throw new Error("The admin Convex config must define a functions path.");
    }
    expect(
      fs.existsSync(path.resolve(path.dirname(configPath), config.functions))
    ).toBe(true);
  });
});
