import { EXPECTED_SOURCE_FINGERPRINT } from "./manifest.mjs";

export const REHEARSAL_DOMAINS = [
  "identity",
  "catalog",
  "episodes",
  "assignments",
  "reviews",
  "games",
  "rankings",
  "archive",
];

const COUNT_FIELDS = {
  migrationRawUsers: "expectedUsers",
  migrationRawRoles: "expectedRoles",
  migrationRawUserRoles: "expectedUserRoles",
  migrationRawMovies: "expectedMovies",
  migrationRawShows: "expectedShows",
  migrationRawTags: "expectedTags",
  migrationRawEpisodes: "expectedEpisodes",
  migrationRawEpisodeLinks: "expectedLinks",
  migrationRawBangers: "expectedBangers",
  migrationRawEpisodeAudioMessages: "expectedAudioMessages",
  migrationRawAssignments: "expectedAssignments",
  migrationRawAssignmentAudioMessages: "expectedAudioMessages",
  migrationRawAssignmentPointLinks: "expectedPointLinks",
  migrationRawSyllabusEntries: "expectedSyllabusEntries",
  migrationRawRatings: "expectedRatings",
  migrationRawReviews: "expectedReviews",
  migrationRawAssignmentReviews: "expectedAssignmentReviews",
  migrationRawExtraReviews: "expectedExtraReviews",
  migrationRawGameTypes: "expectedGameTypes",
  migrationRawGamePointTypes: "expectedGamePointTypes",
  migrationRawSeasons: "expectedSeasons",
  migrationRawPoints: "expectedPoints",
  migrationRawGuesses: "expectedGuesses",
  migrationRawGamblingTypes: "expectedGamblingTypes",
  migrationRawGamblingEntries: "expectedGamblingEntries",
  migrationRawTagVotes: "expectedTagVotes",
  migrationRawQuoteSubmissions: "expectedQuoteSubmissions",
  migrationRawRankedListTypes: "expectedListTypes",
  migrationRawRankedLists: "expectedLists",
  migrationRawRankedItems: "expectedItems",
  migrationRawArchivePosts: "expectedPosts",
};

function startStep(label, functionName, operationId, tables, counts) {
  const args = {
    sourceSchemaFingerprint: EXPECTED_SOURCE_FINGERPRINT,
  };
  for (const table of tables) {
    const field = COUNT_FIELDS[table];
    const count = counts[table];
    if (
      typeof field !== "string" ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw new Error(`Missing validated rehearsal count for ${table}`);
    }
    args[field] = count;
  }
  return {
    kind: "once",
    label,
    functionName,
    operationId,
    args,
    completion: {
      kind: "domainExists",
      domain: operationId.split(".")[0],
    },
  };
}

function batchStep(
  label,
  functionName,
  operationId,
  table,
  counts,
) {
  const expectedCount = counts[table];
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
    throw new Error(`Missing validated rehearsal count for ${table}`);
  }
  return {
    kind: "batch",
    label,
    functionName,
    operationId,
    sourceTable: table,
    expectedCount,
    completion: {
      kind: "checkpointCompleted",
      operation: operationId,
    },
  };
}

function onceStep(label, functionName, operationId) {
  const domain = operationId.split(".")[0];
  return {
    kind: "once",
    label,
    functionName,
    operationId,
    args: {},
    completion: operationId.includes(".reconcile.finish")
      ? { kind: "domainReconciled", domain }
      : { kind: "domainTransformed", domain },
  };
}

export function countsFromVerifiedManifests(verifiedDomains) {
  const counts = {};
  for (const domain of REHEARSAL_DOMAINS) {
    const verified = verifiedDomains[domain];
    if (!verified || !Array.isArray(verified.files)) {
      throw new Error(`Missing verified ${domain} manifest`);
    }
    for (const file of verified.files) {
      if (
        typeof file.table !== "string" ||
        !Object.hasOwn(COUNT_FIELDS, file.table) ||
        !Number.isSafeInteger(file.rowCount) ||
        file.rowCount < 0 ||
        Object.hasOwn(counts, file.table)
      ) {
        throw new Error(
          `Invalid or duplicate rehearsal count for ${String(file.table)}`,
        );
      }
      counts[file.table] = file.rowCount;
    }
  }
  const expectedTables = Object.keys(COUNT_FIELDS);
  if (
    Object.keys(counts).length !== expectedTables.length ||
    !expectedTables.every((table) => Object.hasOwn(counts, table))
  ) {
    throw new Error("Verified manifests do not cover every raw table");
  }
  return Object.freeze({ ...counts });
}

export function buildRehearsalPlan(counts) {
  const steps = [];
  const addStart = (
    label,
    functionName,
    operationId,
    tables,
  ) => {
    steps.push(
      startStep(label, functionName, operationId, tables, counts),
    );
  };
  const addBatch = (
    label,
    functionName,
    operationId,
    table,
  ) => {
    steps.push(
      batchStep(
        label,
        functionName,
        operationId,
        table,
        counts,
      ),
    );
  };
  const addOnce = (label, functionName, operationId) => {
    steps.push(onceStep(label, functionName, operationId));
  };

  addStart(
    "Start identity",
    "migration/identity:startIdentityRun",
    "identity.start",
    [
      "migrationRawUsers",
      "migrationRawRoles",
      "migrationRawUserRoles",
    ],
  );
  addBatch(
    "Transform roles",
    "migration/identity:transformRolesBatch",
    "identity.roles",
    "migrationRawRoles",
  );
  addBatch(
    "Transform users",
    "migration/identity:transformUsersBatch",
    "identity.users",
    "migrationRawUsers",
  );
  addBatch(
    "Transform user-role links",
    "migration/identity:transformUserRolesBatch",
    "identity.userRoles",
    "migrationRawUserRoles",
  );
  addOnce(
    "Finish identity transform",
    "migration/identity:finishIdentityRun",
    "identity.finish",
  );
  addBatch(
    "Reconcile users",
    "migration/identityReconciliation:reconcileUsersBatch",
    "identity.reconcile.users",
    "migrationRawUsers",
  );
  addBatch(
    "Reconcile roles",
    "migration/identityReconciliation:reconcileRolesBatch",
    "identity.reconcile.roles",
    "migrationRawRoles",
  );
  addBatch(
    "Reconcile user-role links",
    "migration/identityReconciliation:reconcileUserRolesBatch",
    "identity.reconcile.userRoles",
    "migrationRawUserRoles",
  );
  addOnce(
    "Finish identity reconciliation",
    "migration/identityReconciliation:finishIdentityReconciliation",
    "identity.reconcile.finish",
  );

  addStart(
    "Start catalog",
    "migration/catalog:startCatalogRun",
    "catalog.start",
    [
      "migrationRawMovies",
      "migrationRawShows",
      "migrationRawTags",
    ],
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Transform movies",
      "migration/catalog:transformMoviesBatch",
      "catalog.movies",
      "migrationRawMovies",
    ],
    [
      "Transform shows",
      "migration/catalog:transformShowsBatch",
      "catalog.shows",
      "migrationRawShows",
    ],
    [
      "Transform tags",
      "migration/catalog:transformTagsBatch",
      "catalog.tags",
      "migrationRawTags",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }
  addOnce(
    "Finish catalog transform",
    "migration/catalog:finishCatalogRun",
    "catalog.finish",
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Reconcile movies",
      "migration/catalogReconciliation:reconcileMoviesBatch",
      "catalog.reconcile.movies",
      "migrationRawMovies",
    ],
    [
      "Reconcile shows",
      "migration/catalogReconciliation:reconcileShowsBatch",
      "catalog.reconcile.shows",
      "migrationRawShows",
    ],
    [
      "Reconcile tags",
      "migration/catalogReconciliation:reconcileTagsBatch",
      "catalog.reconcile.tags",
      "migrationRawTags",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }
  addOnce(
    "Finish catalog reconciliation",
    "migration/catalogReconciliation:finishCatalogReconciliation",
    "catalog.reconcile.finish",
  );

  addStart(
    "Start episodes",
    "migration/episodes:startEpisodeRun",
    "episodes.start",
    [
      "migrationRawEpisodes",
      "migrationRawEpisodeLinks",
      "migrationRawBangers",
      "migrationRawEpisodeAudioMessages",
    ],
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Transform episodes",
      "migration/episodes:transformEpisodesBatch",
      "episodes.episodes",
      "migrationRawEpisodes",
    ],
    [
      "Transform episode links",
      "migration/episodes:transformEpisodeLinksBatch",
      "episodes.links",
      "migrationRawEpisodeLinks",
    ],
    [
      "Transform bangers",
      "migration/episodes:transformBangersBatch",
      "episodes.bangers",
      "migrationRawBangers",
    ],
    [
      "Transform episode audio metadata",
      "migration/episodes:transformEpisodeAudioMessagesBatch",
      "episodes.audioMessages",
      "migrationRawEpisodeAudioMessages",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }
  addOnce(
    "Finish episode transform",
    "migration/episodes:finishEpisodeRun",
    "episodes.finish",
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Reconcile episodes",
      "migration/episodeReconciliation:reconcileEpisodesBatch",
      "episodes.reconcile.episodes",
      "migrationRawEpisodes",
    ],
    [
      "Reconcile episode links",
      "migration/episodeReconciliation:reconcileEpisodeLinksBatch",
      "episodes.reconcile.links",
      "migrationRawEpisodeLinks",
    ],
    [
      "Reconcile bangers",
      "migration/episodeReconciliation:reconcileBangersBatch",
      "episodes.reconcile.bangers",
      "migrationRawBangers",
    ],
    [
      "Reconcile episode audio metadata",
      "migration/episodeReconciliation:reconcileEpisodeAudioMessagesBatch",
      "episodes.reconcile.audioMessages",
      "migrationRawEpisodeAudioMessages",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }
  addOnce(
    "Finish episode reconciliation",
    "migration/episodeReconciliation:finishEpisodeReconciliation",
    "episodes.reconcile.finish",
  );

  addStart(
    "Start assignments",
    "migration/assignments:startAssignmentRun",
    "assignments.start",
    [
      "migrationRawAssignments",
      "migrationRawAssignmentAudioMessages",
      "migrationRawAssignmentPointLinks",
      "migrationRawSyllabusEntries",
    ],
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Transform assignments",
      "migration/assignments:transformAssignmentsBatch",
      "assignments.assignments",
      "migrationRawAssignments",
    ],
    [
      "Transform assignment audio metadata",
      "migration/assignments:transformAssignmentAudioMessagesBatch",
      "assignments.audioMessages",
      "migrationRawAssignmentAudioMessages",
    ],
    [
      "Transform syllabus entries",
      "migration/assignments:transformSyllabusEntriesBatch",
      "assignments.syllabusEntries",
      "migrationRawSyllabusEntries",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }

  addStart(
    "Start reviews",
    "migration/reviews:startReviewRun",
    "reviews.start",
    [
      "migrationRawRatings",
      "migrationRawReviews",
      "migrationRawAssignmentReviews",
      "migrationRawExtraReviews",
    ],
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Transform ratings",
      "migration/reviews:transformRatingsBatch",
      "reviews.ratings",
      "migrationRawRatings",
    ],
    [
      "Transform reviews",
      "migration/reviews:transformReviewsBatch",
      "reviews.reviews",
      "migrationRawReviews",
    ],
    [
      "Transform assignment reviews",
      "migration/reviews:transformAssignmentReviewsBatch",
      "reviews.assignmentReviews",
      "migrationRawAssignmentReviews",
    ],
    [
      "Transform extra reviews",
      "migration/reviews:transformExtraReviewsBatch",
      "reviews.extraReviews",
      "migrationRawExtraReviews",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }
  addOnce(
    "Finish review transform",
    "migration/reviews:finishReviewRun",
    "reviews.finish",
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Reconcile ratings",
      "migration/reviewReconciliation:reconcileRatingsBatch",
      "reviews.reconcile.ratings",
      "migrationRawRatings",
    ],
    [
      "Reconcile reviews",
      "migration/reviewReconciliation:reconcileReviewsBatch",
      "reviews.reconcile.reviews",
      "migrationRawReviews",
    ],
    [
      "Reconcile assignment reviews",
      "migration/reviewReconciliation:reconcileAssignmentReviewsBatch",
      "reviews.reconcile.assignmentReviews",
      "migrationRawAssignmentReviews",
    ],
    [
      "Reconcile extra reviews",
      "migration/reviewReconciliation:reconcileExtraReviewsBatch",
      "reviews.reconcile.extraReviews",
      "migrationRawExtraReviews",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }
  addOnce(
    "Finish review reconciliation",
    "migration/reviewReconciliation:finishReviewReconciliation",
    "reviews.reconcile.finish",
  );

  addStart(
    "Start games",
    "migration/gameFoundation:startGameRun",
    "games.start",
    [
      "migrationRawGameTypes",
      "migrationRawGamePointTypes",
      "migrationRawSeasons",
      "migrationRawPoints",
      "migrationRawGuesses",
      "migrationRawGamblingTypes",
      "migrationRawGamblingEntries",
      "migrationRawTagVotes",
      "migrationRawQuoteSubmissions",
    ],
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Transform game types",
      "migration/gameFoundation:transformGameTypesBatch",
      "games.gameTypes",
      "migrationRawGameTypes",
    ],
    [
      "Transform game point types",
      "migration/gameFoundation:transformGamePointTypesBatch",
      "games.gamePointTypes",
      "migrationRawGamePointTypes",
    ],
    [
      "Transform seasons",
      "migration/gameFoundation:transformSeasonsBatch",
      "games.seasons",
      "migrationRawSeasons",
    ],
    [
      "Transform points",
      "migration/gameFoundation:transformPointsBatch",
      "games.points",
      "migrationRawPoints",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }

  addBatch(
    "Transform assignment-point links",
    "migration/assignments:transformAssignmentPointLinksBatch",
    "assignments.pointLinks",
    "migrationRawAssignmentPointLinks",
  );
  addOnce(
    "Finish assignment transform",
    "migration/assignments:finishAssignmentRun",
    "assignments.finish",
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Reconcile assignments",
      "migration/assignmentReconciliation:reconcileAssignmentsBatch",
      "assignments.reconcile.assignments",
      "migrationRawAssignments",
    ],
    [
      "Reconcile assignment audio metadata",
      "migration/assignmentReconciliation:reconcileAssignmentAudioMessagesBatch",
      "assignments.reconcile.audioMessages",
      "migrationRawAssignmentAudioMessages",
    ],
    [
      "Reconcile syllabus entries",
      "migration/assignmentReconciliation:reconcileSyllabusEntriesBatch",
      "assignments.reconcile.syllabusEntries",
      "migrationRawSyllabusEntries",
    ],
    [
      "Reconcile assignment-point links",
      "migration/assignmentReconciliation:reconcileAssignmentPointLinksBatch",
      "assignments.reconcile.pointLinks",
      "migrationRawAssignmentPointLinks",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }
  addOnce(
    "Finish assignment reconciliation",
    "migration/assignmentReconciliation:finishAssignmentReconciliation",
    "assignments.reconcile.finish",
  );

  for (const [label, functionName, operationId, table] of [
    [
      "Transform guesses",
      "migration/gameRelationships:transformGuessesBatch",
      "games.guesses",
      "migrationRawGuesses",
    ],
    [
      "Transform gambling types",
      "migration/gameRelationships:transformGamblingTypesBatch",
      "games.gamblingTypes",
      "migrationRawGamblingTypes",
    ],
    [
      "Transform gambling entries",
      "migration/gameRelationships:transformGamblingEntriesBatch",
      "games.gamblingEntries",
      "migrationRawGamblingEntries",
    ],
    [
      "Transform tag votes",
      "migration/gameRelationships:transformTagVotesBatch",
      "games.tagVotes",
      "migrationRawTagVotes",
    ],
    [
      "Transform quote submissions",
      "migration/gameRelationships:transformQuoteSubmissionsBatch",
      "games.quoteSubmissions",
      "migrationRawQuoteSubmissions",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }
  addOnce(
    "Finish game transform",
    "migration/gameRelationships:finishGameRun",
    "games.finish",
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Reconcile game types",
      "migration/gameReconciliation:reconcileGameTypesBatch",
      "games.reconcile.gameTypes",
      "migrationRawGameTypes",
    ],
    [
      "Reconcile game point types",
      "migration/gameReconciliation:reconcileGamePointTypesBatch",
      "games.reconcile.gamePointTypes",
      "migrationRawGamePointTypes",
    ],
    [
      "Reconcile seasons",
      "migration/gameReconciliation:reconcileSeasonsBatch",
      "games.reconcile.seasons",
      "migrationRawSeasons",
    ],
    [
      "Reconcile points",
      "migration/gameReconciliation:reconcilePointsBatch",
      "games.reconcile.points",
      "migrationRawPoints",
    ],
    [
      "Reconcile guesses",
      "migration/gameReconciliation:reconcileGuessesBatch",
      "games.reconcile.guesses",
      "migrationRawGuesses",
    ],
    [
      "Reconcile gambling types",
      "migration/gameReconciliation:reconcileGamblingTypesBatch",
      "games.reconcile.gamblingTypes",
      "migrationRawGamblingTypes",
    ],
    [
      "Reconcile gambling entries",
      "migration/gameReconciliation:reconcileGamblingEntriesBatch",
      "games.reconcile.gamblingEntries",
      "migrationRawGamblingEntries",
    ],
    [
      "Reconcile tag votes",
      "migration/gameReconciliation:reconcileTagVotesBatch",
      "games.reconcile.tagVotes",
      "migrationRawTagVotes",
    ],
    [
      "Reconcile quote submissions",
      "migration/gameReconciliation:reconcileQuoteSubmissionsBatch",
      "games.reconcile.quoteSubmissions",
      "migrationRawQuoteSubmissions",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }
  addOnce(
    "Finish game reconciliation",
    "migration/gameReconciliation:finishGameReconciliation",
    "games.reconcile.finish",
  );

  addStart(
    "Start rankings",
    "migration/rankings:startRankingRun",
    "rankings.start",
    [
      "migrationRawRankedListTypes",
      "migrationRawRankedLists",
      "migrationRawRankedItems",
    ],
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Transform ranked-list types",
      "migration/rankings:transformListTypesBatch",
      "rankings.listTypes",
      "migrationRawRankedListTypes",
    ],
    [
      "Transform ranked lists",
      "migration/rankings:transformListsBatch",
      "rankings.lists",
      "migrationRawRankedLists",
    ],
    [
      "Transform ranked items",
      "migration/rankings:transformItemsBatch",
      "rankings.items",
      "migrationRawRankedItems",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }
  addOnce(
    "Finish ranking transform",
    "migration/rankings:finishRankingRun",
    "rankings.finish",
  );
  for (const [label, functionName, operationId, table] of [
    [
      "Reconcile ranked-list types",
      "migration/rankingReconciliation:reconcileListTypesBatch",
      "rankings.reconcile.listTypes",
      "migrationRawRankedListTypes",
    ],
    [
      "Reconcile ranked lists",
      "migration/rankingReconciliation:reconcileListsBatch",
      "rankings.reconcile.lists",
      "migrationRawRankedLists",
    ],
    [
      "Reconcile ranked items",
      "migration/rankingReconciliation:reconcileItemsBatch",
      "rankings.reconcile.items",
      "migrationRawRankedItems",
    ],
  ]) {
    addBatch(label, functionName, operationId, table);
  }
  addOnce(
    "Finish ranking reconciliation",
    "migration/rankingReconciliation:finishRankingReconciliation",
    "rankings.reconcile.finish",
  );

  addStart(
    "Start archive",
    "migration/archive:startArchiveRun",
    "archive.start",
    ["migrationRawArchivePosts"],
  );
  addBatch(
    "Transform archive posts",
    "migration/archive:transformArchivePostsBatch",
    "archive.posts",
    "migrationRawArchivePosts",
  );
  addOnce(
    "Finish archive transform",
    "migration/archive:finishArchiveRun",
    "archive.finish",
  );
  addBatch(
    "Reconcile archive posts",
    "migration/archiveReconciliation:reconcileArchivePostsBatch",
    "archive.reconcile.posts",
    "migrationRawArchivePosts",
  );
  addOnce(
    "Finish archive reconciliation",
    "migration/archiveReconciliation:finishArchiveReconciliation",
    "archive.reconcile.finish",
  );

  return Object.freeze(
    steps.map((step) => Object.freeze({ ...step })),
  );
}

export async function executeRehearsalPlan({
  steps,
  runId,
  batchSize,
  invoke,
  isComplete = async () => false,
  onProgress = () => undefined,
}) {
  if (
    typeof runId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,100}$/u.test(runId)
  ) {
    throw new Error("A safe rehearsal run ID is required");
  }
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 100
  ) {
    throw new Error("Rehearsal batch size must be from 1 through 100");
  }
  if (
    !Array.isArray(steps) ||
    typeof invoke !== "function" ||
    typeof isComplete !== "function"
  ) {
    throw new Error("A valid rehearsal plan and invoker are required");
  }
  for (const step of steps) {
    if (await isComplete(step)) {
      onProgress(step, {
        attempts: 0,
        completed: true,
        skipped: true,
      });
      continue;
    }
    const baseArgs = {
      cutoverRunId: runId,
      operationId: step.operationId,
      ...(step.args ?? {}),
    };
    if (step.kind === "once") {
      await invoke(step, baseArgs);
      onProgress(step, {
        attempts: 1,
        completed: true,
        skipped: false,
      });
      continue;
    }
    if (
      step.kind !== "batch" ||
      !Number.isSafeInteger(step.expectedCount) ||
      step.expectedCount < 0
    ) {
      throw new Error(`Invalid rehearsal step ${String(step.label)}`);
    }
    const maxAttempts =
      Math.max(1, Math.ceil(step.expectedCount / batchSize)) + 1;
    let completed = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await invoke(step, {
        ...baseArgs,
        batchSize,
      });
      if (
        typeof result !== "object" ||
        result === null ||
        (result.status !== "running" &&
          result.status !== "completed")
      ) {
        throw new Error(
          `Rehearsal step ${step.label} returned an invalid checkpoint`,
        );
      }
      if (result.status === "completed") {
        onProgress(step, {
          attempts: attempt,
          completed: true,
          skipped: false,
        });
        completed = true;
        break;
      }
    }
    if (!completed) {
      throw new Error(
        `Rehearsal step ${step.label} exceeded its bounded retry budget`,
      );
    }
  }
}

export function isRehearsalStepComplete(step, progress) {
  if (
    typeof progress !== "object" ||
    progress === null ||
    typeof progress.domainStatuses !== "object" ||
    progress.domainStatuses === null ||
    typeof progress.checkpointStatuses !== "object" ||
    progress.checkpointStatuses === null
  ) {
    throw new Error("Invalid local rehearsal progress");
  }
  const completion = step.completion;
  if (!completion || typeof completion.kind !== "string") {
    throw new Error(`Rehearsal step ${String(step.label)} has no completion rule`);
  }
  if (completion.kind === "checkpointCompleted") {
    return (
      progress.checkpointStatuses[completion.operation] ===
      "completed"
    );
  }
  const domainStatus =
    progress.domainStatuses[completion.domain];
  if (domainStatus === "failed") {
    throw new Error(
      `The ${completion.domain} migration domain is failed`,
    );
  }
  if (completion.kind === "domainExists") {
    return typeof domainStatus === "string";
  }
  if (completion.kind === "domainTransformed") {
    return (
      domainStatus === "transformed" ||
      domainStatus === "reconciled"
    );
  }
  if (completion.kind === "domainReconciled") {
    return domainStatus === "reconciled";
  }
  throw new Error(
    `Unknown completion rule for ${String(step.label)}`,
  );
}
