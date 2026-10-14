import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, vi } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as TerminalManager from "../terminal/Manager.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";

it.effect("resolves setup scripts through the standalone project service", () => {
  const open = vi.fn((input: Parameters<TerminalManager.TerminalManager["Service"]["open"]>[0]) =>
    Effect.succeed({
      threadId: input.threadId,
      terminalId: input.terminalId,
      cwd: input.cwd,
      worktreePath: input.worktreePath ?? null,
      status: "running" as const,
      pid: 123,
      history: "",
      exitCode: null,
      exitSignal: null,
      label: "Shell",
      updatedAt: "2026-06-20T00:00:00.000Z",
    }),
  );
  const write = vi.fn(
    (_input: Parameters<TerminalManager.TerminalManager["Service"]["write"]>[0]) => Effect.void,
  );
  const closeIdle = vi.fn(
    (_input: Parameters<TerminalManager.TerminalManager["Service"]["closeIdle"]>[0]) => Effect.void,
  );
  const listeners: Array<Parameters<TerminalManager.TerminalManager["Service"]["subscribe"]>[0]> =
    [];
  const subscribe: TerminalManager.TerminalManager["Service"]["subscribe"] = (listener) =>
    Effect.sync(() => {
      listeners.push(listener);
      return () => undefined;
    });
  const projectId = ProjectId.make("project:setup-runner-v2");
  const project = {
    id: projectId,
    title: "Project",
    workspaceRoot: "/repo",
    repositoryIdentity: null,
    faviconPath: null,
    defaultModelSelection: null,
    scripts: [
      {
        id: "setup",
        name: "Setup",
        command: "vp install",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
      },
      {
        id: "clean",
        name: "Clean",
        command: "cargo clean",
        icon: "build" as const,
        runOnWorktreeCreate: false,
        runOnSettle: true,
      },
    ],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    deletedAt: null,
  };
  const layer = ProjectSetupScriptRunner.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeed(Option.some(project)),
        }),
        Layer.mock(TerminalManager.TerminalManager)({ open, write, subscribe, closeIdle }),
        ServerSettings.layerTest(),
        NodeCrypto.layer,
        NodeServices.layer,
      ),
    ),
  );

  return Effect.gen(function* () {
    const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
    const result = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
    });
    assert.deepEqual(result, {
      status: "started",
      async: true,
      scriptId: "setup",
      scriptName: "Setup",
      scriptCommand: "vp install",
      terminalId: "setup-setup",
      cwd: "/repo-worktree",
    });
    assert.equal(open.mock.calls[0]?.[0].cwd, "/repo-worktree");
    assert.deepEqual(open.mock.calls[0]?.[0].env, {
      T3CODE_PROJECT_ROOT: "/repo",
      T3CODE_WORKTREE_PATH: "/repo-worktree",
      COLORTERM: "",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    });
    assert.equal(write.mock.calls[0]?.[0].data, "vp install\r");
    const lines: string[] = [];
    const observed = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
      observeCompletion: {
        onOutputLine: (line) =>
          Effect.sync(() => {
            lines.push(line);
          }),
      },
    });
    assert.equal(observed.status, "started");
    const listener = listeners[0]!;
    yield* listener({
      type: "output",
      threadId: "thread-1",
      terminalId: "setup-setup",
      data: "Downloading 10%\rDownloading 20%\r\nDone\n",
    });
    assert.deepEqual(lines, ["Downloading 10%", "Downloading 20%", "Done"]);
    yield* listener({ type: "closed", threadId: "thread-1", terminalId: "setup-setup" });

    const settle = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
      trigger: "settle",
    });
    const settleTerminalId = settle.status === "started" ? settle.terminalId : "";
    assert.match(settleTerminalId, /^settle-clean-/);
    assert.equal(write.mock.calls.at(-1)?.[0].data, "cargo clean\r");

    // A clean run closes its shell once the prompt is back, not at the
    // sentinel, so the prompt redraw is not taken for new activity.
    const observedSettle = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: "/repo-worktree",
      trigger: "settle",
      observeCompletion: {},
    });
    const observedTerminalId = observedSettle.status === "started" ? observedSettle.terminalId : "";
    // Each settle gets its own shell, so a busy one is never typed into.
    assert.notEqual(observedTerminalId, settleTerminalId);
    const token = /__T3_SETUP_DONE___(\w+):/.exec(write.mock.calls.at(-1)?.[0].data ?? "")?.[1];
    const settleListener = listeners.at(-1)!;
    const completion = yield* Effect.forkChild(
      observedSettle.status === "started" && observedSettle.completion
        ? observedSettle.completion
        : Effect.die("no completion"),
    );
    yield* settleListener({
      type: "output",
      threadId: "thread-1",
      terminalId: observedTerminalId,
      data: `\r\n__T3_SETUP_DONE___${token}:0\r\n`,
    });
    yield* Effect.yieldNow;
    assert.equal(closeIdle.mock.calls.length, 0);
    yield* settleListener({
      type: "output",
      threadId: "thread-1",
      terminalId: observedTerminalId,
      data: "$ ",
    });
    assert.deepEqual((yield* Fiber.join(completion)).exitCode, 0);
    assert.deepEqual(closeIdle.mock.calls[0]?.[0], {
      threadId: "thread-1",
      terminalId: observedTerminalId,
    });
  }).pipe(Effect.provide(layer));
});

const setupScript = {
  id: "setup",
  name: "Setup",
  command: "bun install",
  icon: "configure" as const,
  runOnWorktreeCreate: true,
};

const cleanScript = {
  id: "clean",
  name: "Clean",
  command: "cargo clean",
  icon: "build" as const,
  runOnWorktreeCreate: false,
  runOnSettle: true,
};

/** A runner whose project has `scripts`, recording every terminal write. */
const makeJustfileHarness = (scripts: ReadonlyArray<typeof setupScript | typeof cleanScript>) => {
  const writes: string[] = [];
  const projectId = ProjectId.make("project:setup-runner-just");
  const project = {
    id: projectId,
    title: "Project",
    workspaceRoot: "/repo",
    repositoryIdentity: null,
    faviconPath: null,
    defaultModelSelection: null,
    scripts: [...scripts],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    deletedAt: null,
  };
  const layer = ProjectSetupScriptRunner.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeed(Option.some(project)),
        }),
        Layer.mock(TerminalManager.TerminalManager)({
          open: (input) =>
            Effect.succeed({
              threadId: input.threadId,
              terminalId: input.terminalId,
              cwd: input.cwd,
              worktreePath: input.worktreePath ?? null,
              status: "running" as const,
              pid: 123,
              history: "",
              exitCode: null,
              exitSignal: null,
              label: "Shell",
              updatedAt: "2026-06-20T00:00:00.000Z",
            }),
          write: (input) => Effect.sync(() => void writes.push(input.data)),
          subscribe: () => Effect.succeed(() => undefined),
          closeIdle: () => Effect.void,
        }),
        ServerSettings.layerTest(),
        NodeCrypto.layer,
      ),
    ),
    // The tests write the worktree's justfile with the same file system.
    Layer.provideMerge(NodeServices.layer),
  );
  return { writes, projectId, layer };
};

/** A temp worktree whose justfile has a `worktree` recipe. */
const makeWorktreeWithJustfile = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const worktreePath = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-setup-just-" });
  yield* fileSystem.writeFileString(
    `${worktreePath}/justfile`,
    "# Prepare a new worktree\nworktree:\n    echo ready\n",
  );
  return worktreePath;
});

it.effect("runs the justfile's worktree recipe after the setup script", () => {
  const { writes, projectId, layer } = makeJustfileHarness([setupScript]);
  return Effect.gen(function* () {
    const worktreePath = yield* makeWorktreeWithJustfile;
    const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
    const result = yield* runner.runForThread({ threadId: "thread-1", projectId, worktreePath });
    assert.include(result, {
      status: "started",
      scriptId: "setup",
      scriptCommand: "bun install\njust worktree",
    });
    assert.deepEqual(writes, ["bun install\njust worktree\r"]);
  }).pipe(Effect.scoped, Effect.provide(layer));
});

it.effect("runs the justfile's worktree recipe alone when there is no setup script", () => {
  const { writes, projectId, layer } = makeJustfileHarness([]);
  return Effect.gen(function* () {
    const worktreePath = yield* makeWorktreeWithJustfile;
    const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
    const result = yield* runner.runForThread({ threadId: "thread-1", projectId, worktreePath });
    assert.include(result, {
      status: "started",
      scriptName: "just worktree",
      scriptCommand: "just worktree",
      terminalId: "setup-just-worktree",
    });
    assert.deepEqual(writes, ["just worktree\r"]);
  }).pipe(Effect.scoped, Effect.provide(layer));
});

it.effect("does not run the justfile's worktree recipe when a thread settles", () => {
  const { writes, projectId, layer } = makeJustfileHarness([cleanScript]);
  return Effect.gen(function* () {
    const worktreePath = yield* makeWorktreeWithJustfile;
    const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
    const result = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath,
      trigger: "settle",
    });
    assert.include(result, { status: "started", scriptCommand: "cargo clean" });
    assert.deepEqual(writes, ["cargo clean\r"]);
  }).pipe(Effect.scoped, Effect.provide(layer));
});
