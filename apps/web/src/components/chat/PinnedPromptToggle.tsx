import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { PinIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { usePinnedPromptEnabled, usePinnedPromptStore } from "~/pinnedPromptStore";
import { Switch } from "../ui/switch";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_ROW_CLASS,
} from "./threadDetailsPanelStyles";

export function PinnedPromptToggle({ threadRef }: { threadRef: ScopedThreadRef }) {
  const threadKey = scopedThreadKey(threadRef);
  const enabled = usePinnedPromptEnabled(threadKey);
  return (
    <label className={cn(THREAD_DETAILS_PANEL_ROW_CLASS, "flex cursor-pointer items-center")}>
      <PinIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
      <span className={cn("min-w-0 flex-1 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
        Pin current prompt
      </span>
      <Switch
        size="sm"
        checked={enabled}
        onCheckedChange={(checked) =>
          usePinnedPromptStore.getState().setPinnedPromptEnabled(threadKey, checked)
        }
      />
    </label>
  );
}
