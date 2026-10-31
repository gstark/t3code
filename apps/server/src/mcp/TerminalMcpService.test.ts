import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  TerminalNotRunningError,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type TerminalSummary,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Settings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as TerminalMcpService from "./TerminalMcpService.ts";
import { liveThreadShell } from "./McpToolAccess.testkit.ts";

const threadId = ThreadId.make("terminal-caller");
const otherThreadId = ThreadId.make("other-thread");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("environment:terminal"),
  requestNamespace: "terminal-test",
  issuedAt: 0,
  thread: {
    threadId,
    providerSessionId: "terminal-test",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["orchestration"]),
};
const terminal: TerminalSummary = {
  threadId,
  terminalId: "term-1",
  cwd: "/workspace",
  worktreePath: null,
  status: "running",
  pid: 123,
  exitCode: null,
  exitSignal: null,
  hasRunningSubprocess: false,
  label: "Shell",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const fixture = Effect.gen(function* () {
  const calls = yield* Ref.make<Array<{ threadId: string; data?: string }>>([]);
  const caller = yield* Ref.make<OrchestrationV2ThreadShell>(liveThreadShell(threadId));
  const status = yield* Ref.make<TerminalSummary["status"]>("running");
  const terminals = Layer.mock(TerminalManager.TerminalManager)({
    list: (threadId) =>
      Ref.update(calls, (calls) => [...calls, { threadId }]).pipe(Effect.as([terminal])),
    read: (input) =>
      Effect.gen(function* () {
        yield* Ref.update(calls, (calls) => [...calls, input]);
        return {
          terminal: { ...terminal, status: yield* Ref.get(status) },
          output: "hello",
          cursor: "1",
          unchanged: false,
          truncated: false,
        };
      }),
    write: (input, options) =>
      Effect.gen(function* () {
        if (options?.requireRunning && (yield* Ref.get(status)) !== "running")
          return yield* new TerminalNotRunningError(input);
        yield* Ref.update(calls, (calls) => [...calls, input]);
      }),
  });
  const layer = TerminalMcpService.layer.pipe(
    Layer.provide(terminals),
    Layer.provide(
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Ref.get(caller),
      }),
    ),
    Layer.provideMerge(ThreadCommandExecutor.layer),
  );
  return { calls, caller, status, layer };
});

it.effect("requires an explicit own-thread grant and revokes reads and writes immediately", () =>
  Effect.gen(function* () {
    const { layer, calls } = yield* fixture;
    const settings = yield* Settings.ServerSettingsService;
    yield* Effect.gen(function* () {
      const service = yield* TerminalMcpService.TerminalMcpService;
      expect((yield* Effect.flip(service.list(scope))).code).toBe("capability_denied");
      yield* settings.updateSettings({ threadAgentTerminalAccess: { [otherThreadId]: true } });
      expect((yield* Effect.flip(service.read(scope, { terminalId: "term-1" }))).code).toBe(
        "capability_denied",
      );
      expect(yield* Ref.get(calls)).toEqual([]);
      yield* settings.updateSettings({ threadAgentTerminalAccess: { [threadId]: true } });
      expect(yield* service.list(scope)).toEqual([terminal]);
      expect((yield* service.read(scope, { terminalId: "term-1" })).output).toBe("hello");
      const suppliedTarget = { terminalId: "term-1", data: "pwd\r", threadId: otherThreadId };
      yield* service.write(scope, suppliedTarget);
      yield* service.write(scope, { terminalId: "term-1", data: "\u0003" });
      const beforeRevocation = yield* Ref.get(calls);
      expect(beforeRevocation.every((call) => call.threadId === threadId)).toBe(true);
      expect(beforeRevocation.filter((call) => call.data).map((call) => call.data)).toEqual([
        "pwd\r",
        "\u0003",
      ]);
      yield* settings.updateSettings({ threadAgentTerminalAccess: { [threadId]: null } });
      for (const operation of [
        service.list(scope),
        service.read(scope, { terminalId: "term-1" }),
        service.write(scope, { terminalId: "term-1", data: "ls\r" }),
      ]) {
        expect((yield* Effect.flip(operation)).code).toBe("capability_denied");
      }
      expect(yield* Ref.get(calls)).toEqual(beforeRevocation);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(Settings.layerTest())),
);

it.effect.each([
  { runtimeMode: "approval-required", interactionMode: "default" },
  { runtimeMode: "auto-accept-edits", interactionMode: "default" },
  { runtimeMode: "auto", interactionMode: "default" },
  { runtimeMode: "full-access", interactionMode: "plan" },
] as const)("refuses input in $runtimeMode/$interactionMode", (modes) =>
  Effect.gen(function* () {
    const { layer, caller, calls } = yield* fixture;
    yield* Ref.set(caller, liveThreadShell(threadId, modes));
    yield* Effect.gen(function* () {
      const service = yield* TerminalMcpService.TerminalMcpService;
      expect(
        (yield* Effect.flip(service.write(scope, { terminalId: "term-1", data: "ls\r" }))).code,
      ).toBe("capability_denied");
      expect(yield* Ref.get(calls)).toEqual([]);
      expect((yield* service.read(scope, { terminalId: "term-1" })).output).toBe("hello");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(Settings.layerTest({ threadAgentTerminalAccess: { [threadId]: true } }))),
);

it.effect("rejects outside clients, ended runs, and input to exited terminals", () =>
  Effect.gen(function* () {
    const { layer, caller, calls, status } = yield* fixture;
    yield* Effect.gen(function* () {
      const service = yield* TerminalMcpService.TerminalMcpService;
      const outside = { ...scope, thread: undefined };
      expect((yield* Effect.flip(service.list(outside))).code).toBe("thread_credential_required");
      yield* Ref.set(caller, liveThreadShell(threadId, { activeRunId: null }));
      expect((yield* Effect.flip(service.read(scope, { terminalId: "term-1" }))).code).toBe(
        "parent_not_active",
      );
      expect(yield* Ref.get(calls)).toEqual([]);
      yield* Ref.set(caller, liveThreadShell(threadId));
      yield* Ref.set(status, "exited");
      expect(
        (yield* Effect.flip(service.write(scope, { terminalId: "term-1", data: "ls\r" }))).code,
      ).toBe("invalid_request");
      expect((yield* Ref.get(calls)).some((call) => call.data)).toBe(false);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(Settings.layerTest({ threadAgentTerminalAccess: { [threadId]: true } }))),
);

it.effect("rejects queued input when access is revoked before the thread lock is released", () =>
  Effect.gen(function* () {
    const { layer, calls } = yield* fixture;
    const settings = yield* Settings.ServerSettingsService;
    yield* Effect.gen(function* () {
      const service = yield* TerminalMcpService.TerminalMcpService;
      const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
      const locked = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const requested = yield* Deferred.make<void>();
      const holder = yield* executor
        .withLock(
          threadId,
          Effect.gen(function* () {
            yield* Deferred.succeed(locked, undefined);
            yield* Deferred.await(release);
          }),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(locked);
      const writing = yield* Effect.gen(function* () {
        yield* Deferred.succeed(requested, undefined);
        yield* service.write(scope, { terminalId: "term-1", data: "ls\r" });
      }).pipe(Effect.forkChild);
      yield* Deferred.await(requested);
      yield* settings.updateSettings({ threadAgentTerminalAccess: { [threadId]: null } });
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holder);
      expect((yield* Effect.flip(Fiber.join(writing))).code).toBe("capability_denied");
      expect(yield* Ref.get(calls)).toEqual([]);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(Settings.layerTest({ threadAgentTerminalAccess: { [threadId]: true } }))),
);
