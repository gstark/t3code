import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as WorkReport from "../../../workReport/WorkReport.ts";
import { WorkReportToolkit } from "./tools.ts";

const make = Effect.gen(function* () {
  const workReport = yield* WorkReport.WorkReport;
  const callerThreadId = Effect.map(
    McpInvocationContext.McpInvocationContext,
    (scope) => scope.threadId,
  );

  return WorkReportToolkit.of({
    list_settled_threads: () => Effect.flatMap(callerThreadId, workReport.listSettledThreads),
    get_thread_digest: (input) =>
      Effect.flatMap(callerThreadId, (reportThreadId) =>
        workReport.getThreadDigest({
          reportThreadId,
          threadId: input.threadId,
          cursor: input.cursor ?? 0,
        }),
      ),
    complete_work_report: () => Effect.flatMap(callerThreadId, workReport.complete),
  });
});

export const WorkReportToolkitHandlersLive = WorkReportToolkit.toLayer(make);
