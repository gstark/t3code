import { DEFAULT_SERVER_SETTINGS, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  countPendingWorkReportThreads,
  workReportCountSince,
  workReportDueAtMs,
} from "./workReport.logic";

const settings = DEFAULT_SERVER_SETTINGS.workReport;
const reports = ProjectId.make("reports");
const client = ProjectId.make("client");

describe("work report nudge", () => {
  it("counts settled threads after the cursor, outside the reports project", () => {
    const threads = [
      {
        projectId: client,
        settledOverride: "settled" as const,
        settledAt: "2026-10-09T10:00:00.000Z",
      },
      {
        projectId: client,
        settledOverride: "settled" as const,
        settledAt: "2026-10-01T10:00:00.000Z",
      },
      { projectId: client, settledOverride: null, settledAt: null },
      {
        projectId: reports,
        settledOverride: "settled" as const,
        settledAt: "2026-10-09T11:00:00.000Z",
      },
    ];
    expect(
      countPendingWorkReportThreads(threads, {
        since: "2026-10-05T00:00:00.000Z",
        reportsProjectId: reports,
      }),
    ).toBe(1);
  });

  it("looks back 7 days, on an hour boundary, before the first report", () => {
    expect(workReportCountSince(settings, Date.parse("2026-10-09T12:34:56.000Z"))).toBe(
      "2026-10-02T12:00:00.000Z",
    );
    expect(workReportDueAtMs(settings)).toBe(0);
  });

  it("waits nudgeAfterHours after the last report", () => {
    const covered = { ...settings, coveredUntil: "2026-10-09T00:00:00.000Z", nudgeAfterHours: 16 };
    expect(workReportCountSince(covered, Date.now())).toBe("2026-10-09T00:00:00.000Z");
    expect(workReportDueAtMs(covered)).toBe(Date.parse("2026-10-09T16:00:00.000Z"));
  });
});
