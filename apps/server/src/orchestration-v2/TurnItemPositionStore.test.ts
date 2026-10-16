import { assert, it } from "@effect/vitest";
import { RunId, ThreadId, TurnItemId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as TurnItemPositionStore from "./TurnItemPositionStore.ts";

const layerTest = TurnItemPositionStore.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);

const threadId = ThreadId.make("thread:positions");

it.effect("places runless items after everything already in the thread", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const positions = yield* TurnItemPositionStore.TurnItemPositionStoreV2;
    const allocate = (id: string, runId: RunId | null) =>
      positions.allocate({ threadId, turnItemId: TurnItemId.make(id), runId });
    const runId = RunId.make("run:3");

    assert.equal(yield* allocate("before-runs", null), 1);

    yield* sql`
      INSERT INTO orchestration_v2_projection_runs
        (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
      VALUES (${runId}, ${threadId}, 3, 'codex', 'completed', '2026-10-16T00:00:00.000Z', '{}')
    `;
    assert.equal(yield* allocate("run-item", runId), 3_000_001);
    assert.equal(yield* allocate("collapse", null), 3_000_002);
    assert.equal(yield* allocate("next-run-item", runId), 3_000_003);
  }).pipe(Effect.provide(layerTest)),
);
