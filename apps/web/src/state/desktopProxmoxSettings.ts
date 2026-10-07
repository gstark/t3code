import type { DesktopProxmoxSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { appAtomRegistry } from "~/rpc/atomRegistry";

class DesktopProxmoxSettingsLoadError extends Schema.TaggedError<DesktopProxmoxSettingsLoadError>()(
  "DesktopProxmoxSettingsLoadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to load Proxmox settings.";
  }
}

/** Saved Proxmox settings, or null when none are saved or the desktop shell lacks them. */
export const desktopProxmoxSettingsAtom = Atom.make(
  Effect.tryPromise({
    try: async (): Promise<DesktopProxmoxSettings | null> => {
      const getSettings = window.desktopBridge?.getProxmoxSettings;
      return getSettings ? getSettings() : null;
    },
    catch: (cause) => new DesktopProxmoxSettingsLoadError({ cause }),
  }),
).pipe(Atom.keepAlive, Atom.withLabel("desktop:proxmox-settings:load"));

export function refreshDesktopProxmoxSettings(): void {
  appAtomRegistry.refresh(desktopProxmoxSettingsAtom);
}
