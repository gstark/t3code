import type { Ref } from "react";

/** Line-clamped to two lines; the slice bounds DOM text for very long prompts. */
const PINNED_PROMPT_MAX_CHARS = 600;

export function TimelinePinnedPrompt({
  ref,
  text,
  onSelect,
}: {
  ref: Ref<HTMLDivElement>;
  text: string;
  onSelect: () => void;
}) {
  return (
    <div
      ref={ref}
      className="chat-composer-lane pointer-events-none absolute inset-x-0 top-2 z-30"
      data-timeline-pinned-prompt
    >
      <div className="chat-content-lane flex justify-end">
        <button
          type="button"
          aria-description="Jump to this prompt"
          className="pointer-events-auto max-w-[80%] cursor-pointer rounded-2xl border border-border/70 bg-message px-3 py-1.5 text-left text-xs leading-5 text-message-foreground shadow-md/10 hover:border-border focus-visible:outline-2 focus-visible:outline-ring"
          onClick={onSelect}
        >
          <span className="line-clamp-2 break-words">{text.slice(0, PINNED_PROMPT_MAX_CHARS)}</span>
        </button>
      </div>
    </div>
  );
}
