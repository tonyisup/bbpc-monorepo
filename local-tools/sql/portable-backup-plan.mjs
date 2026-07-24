import {
  FINAL_SCRUB_OPERATIONS,
  MIGRATION_DOMAINS,
  MIGRATION_RAW_TABLES_BY_DOMAIN,
} from "../../convex/migration/constants.ts";

const CANONICAL_TABLE_BY_RAW_TABLE = {
  migrationRawUsers: "users",
  migrationRawRoles: "roles",
  migrationRawUserRoles: "userRoles",
  migrationRawMovies: "movies",
  migrationRawShows: "shows",
  migrationRawTags: "tags",
  migrationRawEpisodes: "episodes",
  migrationRawEpisodeLinks: "episodeLinks",
  migrationRawBangers: "bangers",
  migrationRawEpisodeAudioMessages: "episodeAudioMessages",
  migrationRawAssignments: "assignments",
  migrationRawAssignmentAudioMessages: "assignmentAudioMessages",
  migrationRawAssignmentPointLinks: "assignmentPointLinks",
  migrationRawSyllabusEntries: "syllabusEntries",
  migrationRawRatings: "ratings",
  migrationRawReviews: "reviews",
  migrationRawAssignmentReviews: "assignmentReviews",
  migrationRawExtraReviews: "extraReviews",
  migrationRawGameTypes: "gameTypes",
  migrationRawGamePointTypes: "gamePointTypes",
  migrationRawSeasons: "seasons",
  migrationRawPoints: "points",
  migrationRawGuesses: "guesses",
  migrationRawGamblingTypes: "gamblingTypes",
  migrationRawGamblingEntries: "gamblingEntries",
  migrationRawTagVotes: "tagVotes",
  migrationRawQuoteSubmissions: "quoteSubmissions",
  migrationRawRankedListTypes: "rankedListTypes",
  migrationRawRankedLists: "rankedLists",
  migrationRawRankedItems: "rankedItems",
  migrationRawArchivePosts: "archivePosts",
};

function validateRawCounts(rawCounts) {
  const expectedRawTables = Object.values(
    MIGRATION_RAW_TABLES_BY_DOMAIN,
  ).flat();
  if (
    typeof rawCounts !== "object" ||
    rawCounts === null ||
    Object.keys(rawCounts).length !== expectedRawTables.length
  ) {
    throw new Error("Every raw-table count is required");
  }
  for (const table of expectedRawTables) {
    if (
      !Object.hasOwn(rawCounts, table) ||
      !Number.isSafeInteger(rawCounts[table]) ||
      rawCounts[table] < 0
    ) {
      throw new Error(`Invalid raw-table count for ${table}`);
    }
  }
}

export function portableCountsFromRawCounts(rawCounts) {
  validateRawCounts(rawCounts);
  const canonicalCounts = {};
  for (const [rawTable, canonicalTable] of Object.entries(
    CANONICAL_TABLE_BY_RAW_TABLE,
  )) {
    canonicalCounts[canonicalTable] = rawCounts[rawTable];
  }
  const domainRows = Object.fromEntries(
    MIGRATION_DOMAINS.map((domain) => [
      domain,
      MIGRATION_RAW_TABLES_BY_DOMAIN[domain].reduce(
        (total, table) => total + rawCounts[table],
        0,
      ),
    ]),
  );
  return {
    canonicalCounts: Object.freeze(canonicalCounts),
    domainRows: Object.freeze(domainRows),
    totalRows: Object.values(canonicalCounts).reduce(
      (total, count) => total + count,
      0,
    ),
  };
}

function validateBatchResult(result, label) {
  if (
    typeof result !== "object" ||
    result === null ||
    typeof result.done !== "boolean" ||
    !Number.isSafeInteger(result.deletedThisBatch) ||
    result.deletedThisBatch < 0 ||
    !Number.isSafeInteger(result.totalDeleted) ||
    result.totalDeleted < 0
  ) {
    throw new Error(`${label} returned an invalid scrub result`);
  }
}

async function runUntilDone({
  label,
  maxAttempts,
  invoke,
  onProgress,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await invoke();
    validateBatchResult(result, label);
    onProgress(label, {
      attempt,
      done: result.done,
      totalDeleted: result.totalDeleted,
    });
    if (result.done) {
      return result;
    }
  }
  throw new Error(`${label} exceeded its bounded retry budget`);
}

export async function executePortableScrub({
  runId,
  batchSize,
  domainRows,
  invoke,
  onProgress = () => undefined,
}) {
  if (
    typeof runId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,100}$/u.test(runId)
  ) {
    throw new Error("A safe portable scrub run ID is required");
  }
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 100
  ) {
    throw new Error(
      "Portable scrub batch size must be from 1 through 100",
    );
  }
  if (
    typeof invoke !== "function" ||
    typeof domainRows !== "object" ||
    domainRows === null ||
    !MIGRATION_DOMAINS.every(
      (domain) =>
        Number.isSafeInteger(domainRows[domain]) &&
        domainRows[domain] >= 0,
    )
  ) {
    throw new Error("Valid portable scrub inputs are required");
  }

  const start = await invoke(
    "migration/scrub:startFinalScrub",
    {
      cutoverRunId: runId,
      operationId: FINAL_SCRUB_OPERATIONS.start,
    },
  );
  if (
    typeof start !== "object" ||
    start === null ||
    start.status !== "running"
  ) {
    throw new Error("Portable scrub did not start");
  }

  const rawRowsDeleted = {};
  for (const domain of MIGRATION_DOMAINS) {
    const expected = domainRows[domain];
    const result = await runUntilDone({
      label: `Scrub raw ${domain}`,
      maxAttempts:
        Math.max(1, Math.ceil(expected / batchSize)) + 1,
      invoke: async () =>
        await invoke(
          "migration/scrub:scrubFinalRawDomainBatch",
          {
            cutoverRunId: runId,
            operationId: FINAL_SCRUB_OPERATIONS.raw[domain],
            domain,
            batchSize,
          },
        ),
      onProgress,
    });
    if (result.totalDeleted !== expected) {
      throw new Error(
        `Portable scrub count mismatch for ${domain}: expected ${String(expected)}, received ${String(result.totalDeleted)}`,
      );
    }
    rawRowsDeleted[domain] = result.totalDeleted;
  }

  const metadata = await runUntilDone({
    label: "Scrub migration metadata",
    maxAttempts: 1000,
    invoke: async () =>
      await invoke(
        "migration/scrub:scrubFinalMigrationMetadataBatch",
        {
          cutoverRunId: runId,
          operationId:
            FINAL_SCRUB_OPERATIONS.migrationMetadata,
          batchSize,
        },
      ),
    onProgress,
  });
  const control = await runUntilDone({
    label: "Scrub deployment control",
    maxAttempts: 1000,
    invoke: async () =>
      await invoke(
        "migration/scrub:scrubFinalDeploymentControlBatch",
        {
          cutoverRunId: runId,
          operationId:
            FINAL_SCRUB_OPERATIONS.deploymentControl,
          batchSize,
        },
      ),
    onProgress,
  });
  const completed = await invoke(
    "migration/scrub:finishFinalScrub",
    {
      cutoverRunId: runId,
      operationId: FINAL_SCRUB_OPERATIONS.finish,
    },
  );
  if (
    typeof completed !== "object" ||
    completed === null ||
    completed.status !== "completed" ||
    completed.systemStateDeleted !== true ||
    typeof completed.rawRowsDeleted !== "object" ||
    completed.rawRowsDeleted === null ||
    !MIGRATION_DOMAINS.every(
      (domain) =>
        completed.rawRowsDeleted[domain] ===
        rawRowsDeleted[domain],
    )
  ) {
    throw new Error("Portable scrub did not finish safely");
  }
  return {
    ...completed,
    metadataDeleted: metadata.totalDeleted,
    deploymentControlDeleted: control.totalDeleted,
  };
}
