import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";

import { toastManager } from "~/components/ui/toast";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { projectEnvironment } from "~/state/projects";
import { primaryServerSettingsAtom } from "~/state/server";
import { environmentThreadShells } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import {
  countPendingWorkReportThreads,
  workReportCountSince,
  workReportDueAtMs,
} from "./workReport.logic";

/** Open while the user picks the reports folder for a first report. */
export const useWorkReportFolderDialog = create<{
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

/** Keyed by `since` and the reports project so the count only recomputes when they change. */
const pendingCountAtom = Atom.family((key: string) =>
  Atom.make((get): number => {
    const [since = "", reportsProjectId = ""] = key.split("|");
    const environmentId = get(primaryEnvironmentIdAtom);
    if (environmentId === null) return 0;
    const threads = get(environmentThreadShells.threadShellsAtom).filter(
      (thread) => thread.environmentId === environmentId,
    );
    return countPendingWorkReportThreads(threads, {
      since,
      reportsProjectId: reportsProjectId || null,
    });
  }),
);

/** Starts (or reopens) the work report on the primary environment. */
export function useWorkReport() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const settings = useAtomValue(primaryServerSettingsAtom).workReport;
  const startWorkReport = useAtomCommand(projectEnvironment.startWorkReport, {
    reportFailure: false,
  });
  const navigate = useNavigate();
  const setFolderDialogOpen = useWorkReportFolderDialog((state) => state.setOpen);

  /** Resolves true once the report thread is open. */
  const start = useCallback(
    async (folder?: string): Promise<boolean> => {
      if (environmentId === null) return false;
      const result = await startWorkReport({
        environmentId,
        input: folder === undefined ? {} : { folder },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Could not start the work report",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return false;
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, result.value.threadId)),
      });
      return true;
    },
    [environmentId, navigate, startWorkReport],
  );

  const run = useCallback(() => {
    if (settings.projectId === null) {
      setFolderDialogOpen(true);
      return;
    }
    void start();
  }, [setFolderDialogOpen, settings.projectId, start]);

  return { run, start, available: environmentId !== null };
}

/**
 * What the sidebar shows: a running report, or threads waiting once
 * `nudgeAfterHours` passed since the last one. Null hides the row.
 */
export function useWorkReportNudge(): {
  readonly running: boolean;
  readonly pending: number;
} | null {
  const settings = useAtomValue(primaryServerSettingsAtom).workReport;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const dueAtMs = workReportDueAtMs(settings);
  const since = workReportCountSince(settings, nowMs);
  const pending = useAtomValue(pendingCountAtom(`${since}|${settings.projectId ?? ""}`));

  // One timer to the moment the nudge becomes due; nothing repaints until then.
  useEffect(() => {
    if (nowMs >= dueAtMs) return;
    const timer = window.setTimeout(
      () => setNowMs(Date.now()),
      Math.min(dueAtMs - nowMs, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [dueAtMs, nowMs]);

  if (settings.activeRun !== null) return { running: true, pending };
  if (nowMs < dueAtMs || pending === 0) return null;
  return { running: false, pending };
}
