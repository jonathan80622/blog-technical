export function sourceCoverageResult(taskType: string, attempted: number, verified: number, failed: number) {
  if (failed > 0) return {
    outcome: "FAILED" as const,
    reason: `Indexed ${verified} of ${attempted} eligible official source(s); ${failed} source attempt(s) failed.`,
  };
  if (verified > 0) return {
    outcome: "VERIFIED" as const,
    reason: `Indexed ${verified} eligible official source(s).`,
  };
  return {
    outcome: "SEARCHED_UNRESOLVED" as const,
    reason: `Search completed; no eligible official ${taskType.toLowerCase()} source was found.`,
  };
}
