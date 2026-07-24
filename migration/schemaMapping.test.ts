import { describe, expect, test } from "vitest";

import {
  pendingDomainDecisions,
  requiredIndexesByTarget,
  sourceTableMappings,
} from "./schemaMapping.js";
import schema from "../convex/schema.js";

const expectedSourceTables = [
  "Archive.Posts",
  "dbo.Account",
  "dbo.Assignment",
  "dbo.AssignmentPoints",
  "dbo.AssignmentReview",
  "dbo.AudioEpisodeMessage",
  "dbo.AudioMessage",
  "dbo.Banger",
  "dbo.Episode",
  "dbo.ExtraReview",
  "dbo.GamblingPoints",
  "dbo.GamblingType",
  "dbo.GamePointType",
  "dbo.GameType",
  "dbo.Guess",
  "dbo.Link",
  "dbo.Movie",
  "dbo.Point",
  "dbo.QuoteSubmission",
  "dbo.RankedItem",
  "dbo.RankedList",
  "dbo.RankedListType",
  "dbo.Rating",
  "dbo.Review",
  "dbo.Role",
  "dbo.Season",
  "dbo.Session",
  "dbo.Show",
  "dbo.Syllabus",
  "dbo.Tag",
  "dbo.TagVote",
  "dbo.User",
  "dbo.UserRole",
  "dbo.VerificationToken",
].sort();

interface ExportedSchema {
  tables: Array<{
    tableName: string;
    indexes: Array<{ indexDescriptor: string }>;
  }>;
}

describe("SQL-to-Convex source table mapping", () => {
  test("covers every census table exactly once", () => {
    const actual = sourceTableMappings
      .map((mapping) => mapping.source)
      .sort();

    expect(actual).toEqual(expectedSourceTables);
    expect(new Set(actual).size).toBe(34);
  });

  test("gives every migrated table one unique target", () => {
    const migrated = sourceTableMappings.filter(
      (mapping) => mapping.disposition === "migrate",
    );
    const targets = migrated.map((mapping) => mapping.target);

    expect(migrated).toHaveLength(31);
    expect(new Set(targets).size).toBe(targets.length);
  });

  test("retires only Auth.js secret/session tables", () => {
    const retired = sourceTableMappings
      .filter((mapping) => mapping.disposition === "retire")
      .map((mapping) => mapping.source)
      .sort();

    expect(retired).toEqual([
      "dbo.Account",
      "dbo.Session",
      "dbo.VerificationToken",
    ]);
  });

  test("defines every migrated target with its required indexes", () => {
    const targets = sourceTableMappings.flatMap((mapping) =>
      mapping.disposition === "migrate"
        ? [mapping.target]
        : [],
    );

    expect(Object.keys(requiredIndexesByTarget).sort()).toEqual(
      [...targets].sort(),
    );
    const exportableSchema = schema as unknown as {
      export(): string;
    };
    const exportedSchema = JSON.parse(
      exportableSchema.export(),
    ) as unknown as ExportedSchema;
    const tablesByName = new Map(
      exportedSchema.tables.map((table) => [
        table.tableName,
        table,
      ]),
    );
    for (const target of targets) {
      const table = tablesByName.get(target);
      expect(table, `missing schema table ${target}`).toBeDefined();
      if (!table) {
        continue;
      }
      const actualIndexes = table.indexes.map(
        (index) => index.indexDescriptor,
      );
      expect(
        actualIndexes,
        `missing required index on ${target}`,
      ).toEqual(
        expect.arrayContaining(
          [
            ...requiredIndexesByTarget[target],
          ],
        ),
      );
    }
  });

  test("records the approved production drift decisions", () => {
    const decisions = new Map(
      sourceTableMappings.map((mapping) => [
        mapping.source,
        mapping.decision,
      ]),
    );

    expect(decisions.get("dbo.Movie")).toContain("not merged");
    expect(decisions.get("dbo.Point")).toContain(
      "nullable adjustment distinctly from zero",
    );
    expect(decisions.get("dbo.QuoteSubmission")).toContain(
      "non-null point uniqueness",
    );
    expect(decisions.get("dbo.TagVote")).toContain(
      "legacyAwardTombstone",
    );
  });

  test("keeps unresolved transform choices explicit", () => {
    expect(pendingDomainDecisions.map((decision) => decision.id)).toEqual([
      "sql-datetime-timezone",
      "review-timestamp-precedence",
      "normalized-text-rule",
      "archive-posts-visibility",
    ]);
    expect(
      pendingDomainDecisions.every(
        (decision) =>
          decision.recommendation.length > 0 &&
          decision.evidence.length > 0,
      ),
    ).toBe(true);
  });
});
