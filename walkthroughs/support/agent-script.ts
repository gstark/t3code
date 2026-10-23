// The script that fake-codex.mjs and fake-acp.mjs play back. Each turn is a list of steps,
// and each step is one key: { think }, { run }, { edit }, { say }, { plan },
// or { wait }.
export type AgentScript = {
  turns: AgentTurn[];
  // Values for `codex exec` replies, by schema property: `subject` and `body`
  // for a commit message, `title` for a thread title, `branch` for a branch.
  exec?: Record<string, string>;
  // Values that replace `exec` values when `match`, a case-insensitive
  // regular expression, matches the `codex exec` prompt. For example, a
  // title for each thread.
  execFor?: { match: string; values: Record<string, string> }[];
  // How long each `codex exec` reply takes.
  execMs?: number;
};

export type AgentTurn = {
  // A case-insensitive regular expression for the prompt. A turn with no
  // `match` takes the next prompt.
  match?: string;
  // The tokens that the turn adds to the context window, which holds
  // 258,400. The default is 18,000.
  context?: number;
  steps: AgentStep[];
};

export type AgentStep =
  | { think: { text: string; ms?: number } }
  | { say: { text: string; ms?: number } }
  // `reason` is why the agent runs the command. Only fake-acp.mjs sends it.
  | { run: { command: string; reason?: string; ms?: number } }
  | { edit: { path: string; content: string; ms?: number } }
  | {
      plan: {
        explanation?: string;
        steps: { step: string; status: "pending" | "inProgress" | "completed" }[];
      };
    }
  | { wait: { ms: number } };
