import * as Effect from "effect/Effect";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as TerminalMcpService from "../../TerminalMcpService.ts";
import { TerminalToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(TerminalToolkit, {
  terminal_list: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const service = yield* TerminalMcpService.TerminalMcpService;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return { terminals: yield* service.list(scope) };
    }),
  ),
  terminal_read: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const service = yield* TerminalMcpService.TerminalMcpService;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return yield* service.read(scope, input);
    }),
  ),
  terminal_write: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const service = yield* TerminalMcpService.TerminalMcpService;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      yield* service.write(scope, input);
      return { sent: true as const };
    }),
  ),
});
