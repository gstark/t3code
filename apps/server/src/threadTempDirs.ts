import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerConfig from "./config.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import { threadTempDirName, threadTempDirsRoot } from "./process/agentScope.ts";
import { forkParked } from "./serverActivation.ts";

/**
 * Removes the per-thread temp directories that agents and terminals write to
 * (see `AgentScope.wrap`). A directory goes when its thread is archived or
 * deleted. At start, a sweep removes the directories of threads that went
 * while the server was down. An unarchived thread gets a new directory at its
 * next launch.
 */
export class ThreadTempDirs extends Context.Service<
  ThreadTempDirs,
  {
    /** Waits until queued removals and the start sweep are done. */
    readonly drain: Effect.Effect<void>;
  }
>()("t3/threadTempDirs") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = threadTempDirsRoot(path, config.stateDir);

  const remove = (name: string) =>
    fs.remove(path.join(root, name), { recursive: true, force: true });

  const keeps = (name: string) =>
    Effect.gen(function* () {
      const threadId = yield* Effect.try(() => decodeURIComponent(name));
      const thread = yield* projections.getThreadShell(ThreadId.make(threadId));
      return thread !== null && thread.archivedAt === null;
    }).pipe(Effect.orElseSucceed(() => false));

  const sweep = Effect.gen(function* () {
    const names = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed(() => []));
    for (const name of names) {
      if (!(yield* keeps(name))) yield* remove(name);
    }
  });

  // An undefined item runs the start sweep; a thread id removes its directory.
  const worker = yield* makeDrainableWorker((threadId: string | undefined) =>
    (threadId === undefined ? sweep : remove(threadTempDirName(threadId))).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Thread temp directory cleanup failed", { threadId, cause }),
      ),
    ),
  );

  yield* forkParked(
    worker.enqueue(undefined).pipe(
      Effect.andThen(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          event.type === "thread.archived" || event.type === "thread.deleted"
            ? worker.enqueue(event.threadId)
            : Effect.void,
        ),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Thread temp directory event stream failed", { cause }),
      ),
    ),
  );

  return ThreadTempDirs.of({ drain: worker.drain });
});

export const layer = Layer.effect(ThreadTempDirs, make);
