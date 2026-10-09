import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const WorkReportStartInput = Schema.Struct({
  /** Sets the reports folder first. The server creates it and adds it as a project when needed. */
  folder: Schema.optional(TrimmedNonEmptyString),
});
export type WorkReportStartInput = typeof WorkReportStartInput.Type;

export const WorkReportStartResult = Schema.Struct({
  threadId: ThreadId,
  /** False when a report thread was already running and the call returned it. */
  started: Schema.Boolean,
});
export type WorkReportStartResult = typeof WorkReportStartResult.Type;

export class WorkReportError extends Schema.TaggedError<WorkReportError>()("WorkReportError", {
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {}
