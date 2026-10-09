import type { OrchestrationThreadShell, WorkReportSettings } from "@t3tools/contracts";

const HOUR_MS = 60 * 60 * 1000;
/** Matches the server: a first report, with no cursor yet, covers the last 7 days. */
const FIRST_REPORT_LOOKBACK_MS = 7 * 24 * HOUR_MS;

/**
 * The settle time after which a thread counts toward the next report. The
 * first-run cutoff rounds down to the hour so it stays stable as a cache key.
 */
export function workReportCountSince(settings: WorkReportSettings, nowMs: number): string {
  if (settings.coveredUntil !== null) return settings.coveredUntil;
  const cutoff = nowMs - FIRST_REPORT_LOOKBACK_MS;
  return new Date(cutoff - (cutoff % HOUR_MS)).toISOString();
}

/** Threads settled after `since`, leaving out the reports folder's own threads. */
export function countPendingWorkReportThreads(
  threads: ReadonlyArray<
    Pick<OrchestrationThreadShell, "projectId" | "settledOverride" | "settledAt">
  >,
  input: { readonly since: string; readonly reportsProjectId: string | null },
): number {
  let count = 0;
  for (const thread of threads) {
    if (thread.settledOverride !== "settled" || thread.settledAt === null) continue;
    if (thread.projectId === input.reportsProjectId) continue;
    if (thread.settledAt > input.since) count++;
  }
  return count;
}

/** When the nudge may show: right away before the first report, else `nudgeAfterHours` later. */
export function workReportDueAtMs(settings: WorkReportSettings): number {
  if (settings.coveredUntil === null) return 0;
  return Date.parse(settings.coveredUntil) + settings.nudgeAfterHours * HOUR_MS;
}
