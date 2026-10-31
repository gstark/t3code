import {
  OrchestratorMcpFailure,
  TerminalReadInput,
  TerminalReadResult,
  TerminalSummary,
  TerminalWriteInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as TerminalMcpService from "../../TerminalMcpService.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
    TerminalMcpService.TerminalMcpService,
  ],
};
const list = Tool.make("terminal_list", {
  ...shared,
  description:
    "List existing terminals in your own T3 thread. Requires the user's revocable Agent terminal access grant. Never starts a shell. No access to other threads or external terminals.",
  success: Schema.Struct({ terminals: Schema.Array(TerminalSummary) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const read = Tool.make("terminal_read", {
  ...shared,
  description:
    "Read a bounded tail of output from an existing terminal in your own T3 thread. Output includes terminal escape sequences, not an emulated screen. Defaults to 16,000 characters, maximum 65,536. Pass a prior cursor as afterCursor to return empty output with unchanged=true when nothing changed; otherwise returns the current tail, not a delta. Requires Agent terminal access on every call.",
  parameters: Schema.Struct({
    terminalId: TerminalReadInput.fields.terminalId,
    maxChars: TerminalReadInput.fields.maxChars,
    afterCursor: TerminalReadInput.fields.afterCursor,
  }),
  success: TerminalReadResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const write = Tool.make("terminal_write", {
  ...shared,
  description:
    "Send input to an existing terminal in your own T3 thread, shared with the user. Use \\r for Enter and \\u0003 for Ctrl+C. Input goes to the current foreground program; inspect output before typing. Requires Agent terminal access and full-access mode outside Plan mode. Does not create, restart, close, clear, or resize terminals.",
  parameters: Schema.Struct({
    terminalId: TerminalWriteInput.fields.terminalId,
    data: TerminalWriteInput.fields.data,
  }),
  success: Schema.Struct({ sent: Schema.Literal(true) }),
}).annotate(Tool.Destructive, true);
export const TerminalToolkit = Toolkit.make(list, read, write);
