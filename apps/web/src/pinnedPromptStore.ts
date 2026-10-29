import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

interface PinnedPromptStoreState {
  /** Threads default to showing the pinned prompt, so only opt-outs are stored. */
  hiddenByThreadKey: Record<string, true>;
  setPinnedPromptEnabled: (threadKey: string, enabled: boolean) => void;
}

export const usePinnedPromptStore = create<PinnedPromptStoreState>()(
  persist(
    (set) => ({
      hiddenByThreadKey: {},
      setPinnedPromptEnabled: (threadKey, enabled) =>
        set(({ hiddenByThreadKey }) => {
          const { [threadKey]: _, ...rest } = hiddenByThreadKey;
          return { hiddenByThreadKey: enabled ? rest : { ...rest, [threadKey]: true } };
        }),
    }),
    {
      name: "t3code:pinned-prompt:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ hiddenByThreadKey: state.hiddenByThreadKey }),
    },
  ),
);

export const usePinnedPromptEnabled = (threadKey: string) =>
  usePinnedPromptStore((state) => state.hiddenByThreadKey[threadKey] !== true);
