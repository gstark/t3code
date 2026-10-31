import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";
import { Switch } from "~/components/ui/switch";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";

export function AgentTerminalAccessSwitch({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const settings = config?.settings;
  const canEdit = useAtomValue(
    serverEnvironment.updateSettings.permissionAtom(threadRef.environmentId),
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings);
  const [saving, setSaving] = useState(false);
  if (config?.environment.capabilities.agentTerminalAccess !== true) return null;
  return (
    <label className="flex shrink-0 items-center justify-between gap-3 border-b border-border/80 px-3 py-1.5 text-xs text-muted-foreground">
      <span>Agent terminal access</span>
      <Switch
        size="sm"
        aria-label="Agent terminal access"
        aria-description="Allow this thread's agent to read output and send input. Turn off to block further access immediately."
        checked={settings?.threadAgentTerminalAccess[threadRef.threadId] === true}
        disabled={!canEdit || settings === undefined || saving}
        onCheckedChange={async (enabled) => {
          setSaving(true);
          try {
            await updateSettings({
              environmentId: threadRef.environmentId,
              input: {
                patch: {
                  threadAgentTerminalAccess: { [threadRef.threadId]: enabled || null },
                },
              },
            });
          } finally {
            setSaving(false);
          }
        }}
      />
    </label>
  );
}
