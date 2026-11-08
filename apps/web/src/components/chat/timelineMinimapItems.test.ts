import { describe, expect, it } from "vite-plus/test";
import { MessageId } from "@t3tools/contracts";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@t3tools/shared/composerContextReferences";

import { deriveTimelineMinimapItems, resolveTimelineMinimapPreview } from "./timelineMinimapItems";

describe("deriveTimelineMinimapItems", () => {
  it.each(["", "Ultrathink:\n"])(
    "omits bootstrap text from the minimap label and tooltip (%j)",
    (prefix) => {
      const at = "2026-10-01T00:00:00Z";
      const items = deriveTimelineMinimapItems([
        {
          kind: "message",
          id: "image-only",
          createdAt: at,
          showAssistantMeta: false,
          showAssistantCopyButton: false,
          assistantCopyStreaming: false,
          message: {
            id: MessageId.make("image-only"),
            role: "user",
            text: prefix + ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
            runId: null,
            streaming: false,
            createdAt: at,
            updatedAt: at,
          },
        },
      ]);
      expect(items).toMatchObject([
        { id: "image-only", rowIndex: 0, userText: "", assistantText: null, compaction: null },
      ]);
      expect(resolveTimelineMinimapPreview(items[0]!)?.userText).toBeNull();
    },
  );
  it("marks the turn whose rows hold a finished compaction", () => {
    const at = "2026-10-01T00:00:00Z";
    const user = (id: string) =>
      ({
        kind: "message",
        id,
        createdAt: at,
        showAssistantMeta: false,
        showAssistantTimestamp: false,
        showAssistantCopyButton: false,
        assistantCopyStreaming: false,
        message: {
          id: MessageId.make(id),
          role: "user",
          text: id,
          runId: null,
          streaming: false,
          createdAt: at,
          updatedAt: at,
        },
      }) as const;
    const compaction = (id: string, extra: object) =>
      ({
        kind: "context-compaction",
        id,
        createdAt: at,
        label: "Context compacted 120k → 30k tokens",
        tokenCounts: { before: "120k", after: "30k" },
        active: false,
        ...extra,
      }) as const;
    const items = deriveTimelineMinimapItems([
      user("first"),
      compaction("auto", { title: "Auto-compacted" }),
      user("second"),
      compaction("running", { active: true, label: "Compacting context", tokenCounts: null }),
      user("third"),
      compaction("failed", {
        label: "Context compaction failed",
        tokenCounts: null,
        failed: true,
        failure: "quota",
      }),
    ]);
    expect(items.map((item) => item.compaction)).toEqual([
      { label: "Auto-compacted 120k → 30k tokens", failed: false },
      null,
      { label: "Context compaction failed: quota", failed: true },
    ]);
  });
});

describe("resolveTimelineMinimapPreview", () => {
  it("previews a thread autolink as prose, not its URL", () => {
    const preview = resolveTimelineMinimapPreview({
      id: "turn-1",
      rowIndex: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      runId: null,
      userText: null,
      compaction: null,
      assistantText:
        "Started <t3-thread://v2/env-1/thread-1> and [Fix CI](t3-thread://v2/env-1/t2).",
    });
    expect(preview?.assistantText).toBe("Started a thread and Fix CI.");
  });
});
