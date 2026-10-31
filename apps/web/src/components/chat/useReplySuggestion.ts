import { useEffect, useRef, useState } from "react";

/** A response can offer one completion, which expires on editing or changing threads. */
export function useReplySuggestion(input: {
  key: string | null;
  enabled: boolean;
  revision?: string;
  request: () => Promise<string>;
}) {
  const { key, enabled, request, revision = "" } = input;
  const pending = useRef<{ key: string; revision: string; promise: Promise<string> } | null>(null);
  const [result, setResult] = useState<{ key: string; revision: string; reply: string } | null>(
    null,
  );
  const [dismissed, setDismissed] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/react-effect-budget -- fetches the suggestion from the server when the reply key changes
  useEffect(() => {
    if (!key || !enabled) return;
    if (pending.current?.key !== key || pending.current.revision !== revision) {
      pending.current = { key, revision, promise: request() };
    }
    let stale = false;
    void pending.current.promise.then(
      (reply) => {
        if (!stale) setResult({ key, revision, reply });
      },
      () => {
        /* A suggestion failure leaves the normal composer available. */
      },
    );
    return () => {
      stale = true;
    };
  }, [key, enabled, request, revision]);
  const dismiss = () => setDismissed(key);
  return {
    reply:
      enabled && result?.key === key && result.revision === revision && dismissed !== key
        ? (result?.reply ?? "")
        : "",
    dismiss,
  };
}

export function replySuggestionKeyAction(
  key: string,
  event: {
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    isComposing: boolean;
    keyCode: number;
  },
  reply: string,
  prompt: string,
) {
  if (
    !reply ||
    prompt ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return null;
  return key === "Tab" ? "accept" : key === "Escape" ? "dismiss" : null;
}
