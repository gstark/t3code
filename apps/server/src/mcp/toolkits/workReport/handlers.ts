import * as Effect from "effect/Effect";

import * as WorkReport from "../../../workReport/WorkReport.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { WorkReportToolkit } from "./tools.ts";

/** The calling thread, which the work report checks is its running report thread. */
const callerThreadId = McpInvocationContext.McpInvocationContext.pipe(
  Effect.flatMap((scope) => McpInvocationContext.requireThreadScope(scope, "This tool")),
  Effect.map((scope) => scope.thread.threadId),
);

const handlers = {
  list_settled_threads: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const workReport = yield* WorkReport.WorkReport;
      return yield* workReport.listSettledThreads(yield* callerThreadId);
    }),
  ),
  get_thread_digest: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const workReport = yield* WorkReport.WorkReport;
      return yield* workReport.getThreadDigest({
        reportThreadId: yield* callerThreadId,
        threadId: input.threadId,
        cursor: input.cursor ?? 0,
      });
    }),
  ),
  complete_work_report: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const workReport = yield* WorkReport.WorkReport;
      return yield* workReport.complete(yield* callerThreadId);
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof WorkReportToolkit.tools>;

export const layer = McpToolAccess.toLayer(WorkReportToolkit, handlers);
