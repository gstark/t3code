import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import type { OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import { threadTempDirName } from "./process/agentScope.ts";
import * as ThreadTempDirs from "./threadTempDirs.ts";

type ThreadState = "active" | "archived" | "deleted";

// Starts the service over temp directories for `threads`, replays `events`,
// and returns the thread ids whose directories remain.
const remainingAfter = (
  threads: Record<string, ThreadState>,
  events: ReadonlyArray<{ readonly type: string; readonly threadId: string }> = [],
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { stateDir } = yield* ServerConfig.ServerConfig;
    const root = path.join(stateDir, "tmp");
    for (const threadId of Object.keys(threads)) {
      const dir = path.join(root, threadTempDirName(threadId));
      yield* fs.makeDirectory(dir, { recursive: true });
      yield* fs.writeFileString(path.join(dir, "scratch"), "x");
    }
    const replayed = yield* Deferred.make<void>();
    const context = yield* Layer.build(ThreadTempDirs.layer).pipe(
      Effect.provideService(ProjectionStore.ProjectionStoreV2, {
        getThreadShell: (threadId: string) =>
          Effect.succeed(
            threads[threadId] === undefined || threads[threadId] === "deleted"
              ? null
              : { archivedAt: threads[threadId] === "archived" ? DateTime.nowUnsafe() : null },
          ),
      } as unknown as ProjectionStore.ProjectionStoreV2["Service"]),
      Effect.provideService(Orchestrator.OrchestratorV2, {
        streamDomainEvents: Stream.concat(
          Stream.fromIterable(events as ReadonlyArray<OrchestrationV2DomainEvent>),
          Stream.fromEffect(Deferred.succeed(replayed, undefined)).pipe(Stream.drain),
        ),
      } as unknown as Orchestrator.OrchestratorV2["Service"]),
    );
    yield* Deferred.await(replayed);
    yield* Context.get(context, ThreadTempDirs.ThreadTempDirs).drain;
    const names = yield* fs.readDirectory(root);
    return names.map((name) => decodeURIComponent(name)).toSorted();
  }).pipe(
    Effect.scoped,
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3-thread-temp-dirs-" }).pipe(
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );

describe("ThreadTempDirs", () => {
  it.effect("removes directories of archived, deleted, and unknown threads at start", () =>
    Effect.gen(function* () {
      const remaining = yield* remainingAfter({
        live: "active",
        "with.dots/and slash": "active",
        archived: "archived",
        deleted: "deleted",
      });
      expect(remaining).toEqual(["live", "with.dots/and slash"]);
    }),
  );

  it.effect("removes a thread's directory when the thread is archived or deleted", () =>
    Effect.gen(function* () {
      // The shells still read active, so only the events remove directories.
      const remaining = yield* remainingAfter({ a: "active", b: "active", c: "active" }, [
        { type: "thread.archived", threadId: "a" },
        { type: "thread.deleted", threadId: "b" },
        { type: "thread.unarchived", threadId: "c" },
      ]);
      expect(remaining).toEqual(["c"]);
    }),
  );
});
