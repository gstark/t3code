import {
  OrchestratorMcpFailure,
  type TerminalError,
  type TerminalReadInput,
  type TerminalReadResult,
  type TerminalSummary,
  type TerminalWriteInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Settings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import { assertFullAccess, assertLiveCaller, loadCaller, unavailable } from "./threadAccess.ts";

type Scope = McpInvocationContext.McpInvocationScope;
type ReadInput = Omit<TerminalReadInput, "threadId">;
type WriteInput = Omit<TerminalWriteInput, "threadId">;

export class TerminalMcpService extends Context.Service<
  TerminalMcpService,
  {
    readonly list: (
      scope: Scope,
    ) => Effect.Effect<ReadonlyArray<TerminalSummary>, OrchestratorMcpFailure>;
    readonly read: (
      scope: Scope,
      input: ReadInput,
    ) => Effect.Effect<TerminalReadResult, OrchestratorMcpFailure>;
    readonly write: (
      scope: Scope,
      input: WriteInput,
    ) => Effect.Effect<void, OrchestratorMcpFailure>;
  }
>()("t3/mcp/TerminalMcpService") {}

const make = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const terminals = yield* TerminalManager.TerminalManager;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;

  // The public methods below own the spans.
  const withAccess = Effect.fnUntraced(function* <A>(
    scope: Scope,
    writing: boolean,
    use: (threadId: ThreadId) => Effect.Effect<A, TerminalError>,
  ) {
    const { thread: callerThread } = yield* McpInvocationContext.requireThreadScope(
      scope,
      "Terminal access",
    );
    const operation = settings
      .withSettingsSnapshot((current) =>
        Effect.gen(function* () {
          if (current.threadAgentTerminalAccess[callerThread.threadId] !== true) {
            return yield* new OrchestratorMcpFailure({
              code: "capability_denied",
              message:
                "Agent terminal access is off for this thread. The user can enable it in the terminal panel.",
            });
          }
          const caller = yield* loadCaller().pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
            Effect.provideService(ThreadManagement.ThreadManagementService, threads),
          );
          yield* assertLiveCaller(caller);
          if (writing)
            yield* assertFullAccess(
              caller,
              "Terminal input requires full-access mode outside Plan mode.",
            );
          return yield* use(callerThread.threadId).pipe(
            Effect.mapError(
              (error) =>
                new OrchestratorMcpFailure({
                  code: "invalid_request",
                  message: error.message,
                }),
            ),
          );
        }),
      )
      .pipe(Effect.catchTags({ ServerSettingsError: () => Effect.fail(unavailable()) }));
    // Serialize input with mode changes, and hold the settings grant until input is sent.
    return yield* writing ? executor.withLock(callerThread.threadId, operation) : operation;
  });

  return TerminalMcpService.of({
    list: Effect.fn("TerminalMcpService.list")(function (scope: Scope) {
      return withAccess(scope, false, (threadId) => terminals.list(threadId));
    }),
    read: Effect.fn("TerminalMcpService.read")(function (scope: Scope, input: ReadInput) {
      return withAccess(scope, false, (threadId) => terminals.read({ ...input, threadId }));
    }),
    write: Effect.fn("TerminalMcpService.write")(function (scope: Scope, input: WriteInput) {
      return withAccess(scope, true, (threadId) =>
        terminals.write({ ...input, threadId }, { requireRunning: true }),
      );
    }),
  });
});

export const layer = Layer.effect(TerminalMcpService, make);
