import { ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveCompactDisabledReason,
  resolveContextWindowModelDisplayName,
  shouldReserveContextWindowMeter,
} from "./ContextWindowMeter.logic";

describe("resolveContextWindowModelDisplayName", () => {
  it("uses the selected model from the exact provider instance", () => {
    const primaryInstanceId = ProviderInstanceId.make("codex");
    const selectedInstanceId = ProviderInstanceId.make("codex-work");
    const modelOptionsByInstance = new Map([
      [
        primaryInstanceId,
        [{ slug: "gpt-5.6-sol", name: "Primary profile model", shortName: "Primary" }],
      ],
      [selectedInstanceId, [{ slug: "gpt-5.6-sol", name: "GPT-5.6 Sol", shortName: "5.6 Sol" }]],
    ]);

    expect(
      resolveContextWindowModelDisplayName(
        {
          instanceId: selectedInstanceId,
          model: "gpt-5.6-sol",
        },
        modelOptionsByInstance,
      ),
    ).toBe("GPT-5.6 Sol");
  });
});

describe("shouldReserveContextWindowMeter", () => {
  const loadingStartedThread = {
    threadLoading: true,
    providerReportsContextWindow: true,
  };

  it("holds the meter's slot while a started thread's detail loads", () => {
    expect(shouldReserveContextWindowMeter(loadingStartedThread)).toBe(true);
  });

  it("reserves while the thread's provider is not in the catalog yet", () => {
    expect(
      shouldReserveContextWindowMeter({
        ...loadingStartedThread,
        providerReportsContextWindow: null,
      }),
    ).toBe(true);
  });
});

describe("resolveCompactDisabledReason", () => {
  const ready = {
    canOperateThread: true,
    hasProject: true,
    isServerThread: true,
    providerSupportsCompaction: true,
    hasCompactableConversation: true,
    environmentUnavailable: false,
    threadDetailLoading: false,
    isPreparingWorktree: false,
    isWorking: false,
    isRevertingCheckpoint: false,
    hasPendingApproval: false,
    hasPendingUserInput: false,
    feedbackUploading: false,
  };

  it("allows compaction when nothing blocks it", () => {
    expect(resolveCompactDisabledReason(ready)).toBeNull();
  });

  it("names the blocking condition", () => {
    expect(resolveCompactDisabledReason({ ...ready, isWorking: true })).toBe(
      "Wait for the agent to finish before compacting",
    );
    expect(resolveCompactDisabledReason({ ...ready, hasPendingUserInput: true })).toBe(
      "Answer the agent's question before compacting",
    );
    expect(resolveCompactDisabledReason({ ...ready, hasCompactableConversation: false })).toBe(
      "Send a message before compacting",
    );
  });

  it("reports a missing provider capability before a transient block", () => {
    expect(
      resolveCompactDisabledReason({
        ...ready,
        providerSupportsCompaction: false,
        isWorking: true,
      }),
    ).toBe("Compaction is unavailable for this provider");
  });
});
