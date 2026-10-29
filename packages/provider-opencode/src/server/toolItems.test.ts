import { describe, expect, it } from "vite-plus/test";
import { ThreadId, TurnItemId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { openCodeToolTurnItem } from "./toolItems.ts";

const base = {
  id: TurnItemId.make("item-1"),
  threadId: ThreadId.make("thread-1"),
  runId: null,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 0,
  status: "completed",
  title: "Shell",
  startedAt: null,
  completedAt: null,
  updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
} as const;

describe("openCodeToolTurnItem", () => {
  it("keeps the bash tool's description as the command's intent", () => {
    const item = openCodeToolTurnItem(base, {
      name: "bash",
      input: { command: "pwd", description: " Print working directory " },
      output: "/repo\n",
      completedMetadata: { exit: 0 },
    });
    expect(item).toMatchObject({
      type: "command_execution",
      input: "pwd",
      intent: "Print working directory",
    });
  });

  it("leaves the intent out when the bash tool has no description", () => {
    const item = openCodeToolTurnItem(base, {
      name: "bash",
      input: { command: "pwd" },
      output: undefined,
      completedMetadata: undefined,
    });
    expect(item.type === "command_execution" && "intent" in item).toBe(false);
  });
});
