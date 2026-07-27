export const S2_ROLLBACK_ACTOR =
  "portable-restore-s2-rollback";

export function assertS2RollbackEvidence(evidence) {
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    evidence.runMatches !== true ||
    evidence.cutoverStageS0 !== true ||
    evidence.applicationWritesDisabled !== true ||
    evidence.firstApplicationWriteAbsent !== true ||
    evidence.initializationAuditCount !== 1 ||
    evidence.transitionAuditCount !== 3 ||
    evidence.transitionSequenceValid !== true
  ) {
    throw new Error(
      "The disposable S2 rollback evidence is incomplete",
    );
  }
  return {
    validated: true,
    fromStage: "S2",
    toStage: "S0",
    applicationWritesDisabled: true,
    firstApplicationWriteAbsent: true,
    initializationAuditCount:
      evidence.initializationAuditCount,
    transitionAuditCount: evidence.transitionAuditCount,
    transitionSequenceValid: true,
  };
}
