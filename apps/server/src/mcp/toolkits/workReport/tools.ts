import { OrchestratorMcpFailure, ThreadId, WorkReportError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as WorkReport from "../../../workReport/WorkReport.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  WorkReport.WorkReport,
];

/** What the tools fail with, including the access gate's refusal. */
const WorkReportToolFailure = Schema.Union([WorkReportError, OrchestratorMcpFailure]);

const ONLY_REPORT_THREADS =
  "Works only in the running work report thread that T3 Code started; other threads get an error.";

const ListSettledThreadsTool = Tool.make("list_settled_threads", {
  description: `List the threads that settled in this work report's time window, with their project folder, repository, and linked pull requests. ${ONLY_REPORT_THREADS}`,
  success: WorkReport.ListSettledThreadsResult,
  failure: WorkReportToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "List settled threads for the work report")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const GetThreadDigestTool = Tool.make("get_thread_digest", {
  description: `Read a page of one settled thread's turns: the user message, the final assistant message, changed files, and failed commands. Call again with nextCursor until it is null. ${ONLY_REPORT_THREADS}`,
  parameters: Schema.Struct({
    threadId: ThreadId.annotate({ description: "A threadId from list_settled_threads." }),
    cursor: Schema.optional(
      Schema.Int.annotate({
        description: "The nextCursor of the previous page. Omit for the first page.",
      }),
    ),
  }),
  success: WorkReport.ThreadDigest,
  failure: WorkReportToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Read a settled thread digest")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const CompleteWorkReportTool = Tool.make("complete_work_report", {
  description: `Mark this work report's time window as reported, so the next report starts where this one ends. Call it once, after every report file is written. ${ONLY_REPORT_THREADS}`,
  success: WorkReport.CompleteWorkReportResult,
  failure: WorkReportToolFailure,
  dependencies,
})
  .annotate(Tool.Title, "Complete the work report")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const WorkReportToolkit = Toolkit.make(
  ListSettledThreadsTool,
  GetThreadDigestTool,
  CompleteWorkReportTool,
);
