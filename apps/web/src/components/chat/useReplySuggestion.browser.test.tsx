import { StrictMode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { replySuggestionKeyAction, useReplySuggestion } from "./useReplySuggestion";

type Input = Parameters<typeof useReplySuggestion>[0];

function Probe(props: { input: Input }) {
  const suggestion = useReplySuggestion(props.input);
  return (
    <>
      <output>{suggestion.reply}</output>
      <button type="button" onClick={suggestion.dismiss}>
        Dismiss
      </button>
    </>
  );
}

const probe = (input: Input) => (
  <StrictMode>
    <Probe input={input} />
  </StrictMode>
);

describe("reply completion", () => {
  it("generates once in StrictMode and stays dismissed after typing then clearing", async () => {
    const request = vi.fn(async () => "Yes, do that.");
    const input = { key: "env/thread/message", enabled: true, request };
    await using screen = await render(probe(input));
    await expect.element(screen.getByRole("status")).toHaveTextContent("Yes, do that.");
    expect(request).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await screen.rerender(probe({ ...input, enabled: false }));
    await screen.rerender(probe(input));
    await expect.element(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refreshes a late native suggestion without undoing dismissal", async () => {
    const request = vi.fn(async () => "");
    const input = { key: "A", enabled: true, revision: "", request };
    await using screen = await render(probe(input));
    request.mockResolvedValue("Go ahead.");
    await screen.rerender(probe({ ...input, revision: "Go ahead." }));
    await expect.element(screen.getByRole("status")).toHaveTextContent("Go ahead.");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    request.mockResolvedValue("Continue.");
    await screen.rerender(probe({ ...input, revision: "Continue." }));
    await expect.element(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("rejects a late response from another thread", async () => {
    let resolveFirst!: (reply: string) => void;
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    await using screen = await render(probe({ key: "A", enabled: true, request: () => first }));
    await screen.rerender(probe({ key: "B", enabled: true, request: async () => "Continue B." }));
    await expect.element(screen.getByRole("status")).toHaveTextContent("Continue B.");
    await act(async () => {
      resolveFirst("Continue A.");
      await first;
    });
    await expect.element(screen.getByRole("status")).toHaveTextContent("Continue B.");
  });

  it("leaves the normal placeholder on generation failure", async () => {
    const request = vi.fn(async () => {
      throw new Error("unavailable");
    });
    await using screen = await render(probe({ key: "A", enabled: true, request }));
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    await expect.element(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("does not generate while the composer is unavailable", async () => {
    const request = vi.fn(async () => "Yes.");
    await using screen = await render(probe({ key: "A", enabled: false, request }));
    expect(request).not.toHaveBeenCalled();
    await screen.rerender(probe({ key: "A", enabled: true, request }));
    await expect.element(screen.getByRole("status")).toHaveTextContent("Yes.");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("accepts with Tab, dismisses with Escape, and leaves Enter to normal submission", () => {
    const event = {
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      keyCode: 0,
    };
    expect(replySuggestionKeyAction("Tab", event, "Yes.", "")).toBe("accept");
    expect(replySuggestionKeyAction("Escape", event, "Yes.", "")).toBe("dismiss");
    expect(replySuggestionKeyAction("Enter", event, "Yes.", "")).toBeNull();
    expect(replySuggestionKeyAction("Tab", event, "Yes.", "My reply")).toBeNull();
    for (const field of ["shiftKey", "altKey", "ctrlKey", "metaKey", "isComposing"]) {
      expect(replySuggestionKeyAction("Tab", { ...event, [field]: true }, "Yes.", "")).toBeNull();
    }
    expect(replySuggestionKeyAction("Tab", { ...event, keyCode: 229 }, "Yes.", "")).toBeNull();
  });
});
