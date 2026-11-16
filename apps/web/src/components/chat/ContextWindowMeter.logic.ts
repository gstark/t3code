import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { getDisplayModelName, type ModelEsque } from "./providerIconUtils";

export function resolveContextWindowModelDisplayName(
  selection: ModelSelection | null | undefined,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
): string | null {
  if (!selection) {
    return null;
  }

  const selectedModel = modelOptionsByInstance
    .get(selection.instanceId)
    ?.find((model) => model.slug === selection.model);

  return selectedModel ? getDisplayModelName(selectedModel) : selection.model;
}

export function formatContextWindowCompactionMessage(
  modelDisplayName: string | null | undefined,
  autoCompactThreshold?: number | null,
): string {
  if (typeof autoCompactThreshold === "number" && autoCompactThreshold > 0) {
    return `Compacts automatically at about ${autoCompactThreshold.toLocaleString("en-US")} tokens.`;
  }
  return modelDisplayName
    ? `Context for ${modelDisplayName} compacts automatically when needed.`
    : "Context compacts automatically when needed.";
}

export function threadShellHasStarted(
  shell:
    | Pick<EnvironmentThreadShell, "latestRun" | "latestUserMessageAt" | "runtime">
    | null
    | undefined,
): boolean {
  return Boolean(
    shell &&
    (shell.latestRun !== null || shell.latestUserMessageAt !== null || shell.runtime !== null),
  );
}

export function shouldReserveContextWindowMeter(input: {
  /** A started thread whose detail is still loading. */
  readonly threadLoading: boolean;
  readonly providerReportsContextWindow: boolean | null;
}): boolean {
  return input.threadLoading && input.providerReportsContextWindow !== false;
}

/**
 * Why manual compaction is blocked, or `null` when it can run. Checks run in
 * order, so the reason names the first thing the user must fix.
 */
export function resolveCompactDisabledReason(input: {
  readonly canOperateThread: boolean;
  readonly hasProject: boolean;
  readonly isServerThread: boolean;
  readonly providerSupportsCompaction: boolean;
  readonly hasCompactableConversation: boolean;
  readonly environmentUnavailable: boolean;
  readonly threadDetailLoading: boolean;
  readonly isPreparingWorktree: boolean;
  readonly isWorking: boolean;
  readonly isRevertingCheckpoint: boolean;
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
  readonly feedbackUploading: boolean;
}): string | null {
  if (!input.canOperateThread) return "This connection cannot change threads.";
  if (!input.hasProject) return "Choose a project before compacting";
  if (!input.providerSupportsCompaction) return "Compaction is unavailable for this provider";
  if (!input.isServerThread || !input.hasCompactableConversation) {
    return "Send a message before compacting";
  }
  if (input.environmentUnavailable) return "Reconnect to this environment to compact";
  if (input.threadDetailLoading) return "Wait for the thread to load";
  if (input.isPreparingWorktree) return "Wait for the worktree to be ready";
  if (input.isWorking) return "Wait for the agent to finish before compacting";
  if (input.isRevertingCheckpoint) return "Wait for the checkpoint restore to finish";
  if (input.hasPendingApproval) return "Answer the pending approval before compacting";
  if (input.hasPendingUserInput) return "Answer the agent's question before compacting";
  if (input.feedbackUploading) return "Wait for the feedback upload to finish";
  return null;
}

export function formatContextWindowCost(cost: {
  readonly amount: number;
  readonly currency: string;
}): string {
  const fractionDigits = Math.abs(cost.amount) > 0 && Math.abs(cost.amount) < 0.01 ? 4 : 2;
  return `${cost.currency} ${cost.amount.toFixed(fractionDigits)}`;
}
