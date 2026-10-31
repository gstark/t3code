import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as Cleanup from "./ResourceCleanupService.ts";

const removed = ThreadId.make("removed-thread");
const kept = ThreadId.make("kept-thread");

it.effect("revokes a thread's agent terminal access with its terminals", () => {
  const closed: Array<string> = [];
  return Effect.gen(function* () {
    const cleanup = yield* Cleanup.ResourceCleanupService;
    const settings = yield* ServerSettings.ServerSettingsService;
    yield* cleanup.cleanupTerminals(removed);
    expect(closed).toEqual([removed]);
    expect((yield* settings.getSettings).threadAgentTerminalAccess).toEqual({ [kept]: true });
  }).pipe(
    Effect.provide(
      Cleanup.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.mock(TerminalManager.TerminalManager)({
              close: (input) => Effect.sync(() => void closed.push(input.threadId)),
            }),
            Layer.mock(PreviewManager.PreviewManager)({}),
            Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-resource-cleanup-" }),
            ServerSettings.ServerSettingsService.layerTest({
              threadAgentTerminalAccess: { [removed]: true, [kept]: true },
            }),
          ),
        ),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );
});
