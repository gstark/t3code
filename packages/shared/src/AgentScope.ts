import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface AgentScopeShape {
  /**
   * With a `threadId`, the command gets the thread's own temp directory. The
   * scope also answers `oomKilled` for the thread unless `trackScope` is false,
   * for example for a terminal next to the agent.
   */
  readonly wrap: (input: {
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly name: string;
    readonly threadId?: string | undefined;
    readonly trackScope?: boolean | undefined;
    readonly env?: NodeJS.ProcessEnv | undefined;
    /** Terminals may survive restarts; agents must remain eligible for orphan cleanup. */
    readonly survivesRestart?: boolean | undefined;
    /**
     * Keep a shared process running after a tool OOM when supported.
     * Falls back to ordinary scope behavior on older systemd.
     */
    readonly shared?: boolean | undefined;
  }) => Effect.Effect<AgentScopeCommand>;
  readonly oomKilled: (threadId: string) => Effect.Effect<boolean>;
  /**
   * Reaps processes left after the owning agent exits, including setsid
   * descendants outside its process group. Preserves systemd OOM diagnosis.
   */
  readonly stop: (unit: string) => Effect.Effect<void>;
  /**
   * Forgets the thread's scope. The session manager calls it before it opens
   * a provider session, so a scope only answers for the session that launched
   * it, even when the next session runs without one (Cursor, OpenCode).
   */
  readonly clear: (threadId: string) => Effect.Effect<void>;
}

export interface AgentScopeCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** The systemd scope the command runs in, for `stop`. */
  readonly unit?: string | undefined;
}

export const AgentScope = Context.Reference<AgentScopeShape>("@t3tools/shared/AgentScope", {
  defaultValue: () => ({
    wrap: ({ command, args }) => Effect.succeed({ command, args }),
    oomKilled: () => Effect.succeed(false),
    stop: () => Effect.void,
    clear: () => Effect.void,
  }),
});

export const AgentScopeThreadId = Context.Reference<string | undefined>(
  "@t3tools/shared/AgentScope/ThreadId",
  { defaultValue: () => undefined },
);

export const AGENT_OOM_SCORE_ADJ = 800;

export const RAISE_OOM_SCORE_LINE = `{ echo ${AGENT_OOM_SCORE_ADJ} >/proc/self/oom_score_adj; } 2>/dev/null`;

// A tmpfs /tmp is charged to the agents slice as shared memory, so agents
// write temp files to a per-thread directory on disk. An empty $1 keeps the
// inherited temp directory.
const TEMP_DIR_LINES = ['if [ -n "$1" ]; then export TMPDIR="$1" TMP="$1" TEMP="$1"; fi', "shift"];

const LAUNCH_SCRIPT = [RAISE_OOM_SCORE_LINE, ...TEMP_DIR_LINES, 'exec "$@"'].join("\n");

// systemd-run needs XDG_RUNTIME_DIR to reach this user's manager.
const SCOPED_LAUNCH_SCRIPT = [
  RAISE_OOM_SCORE_LINE,
  ...TEMP_DIR_LINES,
  ': "${XDG_RUNTIME_DIR:=$1}"',
  "export XDG_RUNTIME_DIR",
  "shift",
  'exec "$@"',
].join("\n");

export interface AgentSystemdScope {
  readonly systemdRun: string;
  readonly slice: string;
  readonly unit: string;
  readonly runtimeDir: string;
  readonly options: ReadonlyArray<string>;
}

/** Exec at every step preserves the agent PID, stdio, and signals; systemd-run places it and descendants in the scope. */
export function agentScopeCommand(input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** Exported as TMPDIR, TMP, and TEMP. The directory must exist. */
  readonly tempDir?: string | undefined;
  readonly scope?: AgentSystemdScope | undefined;
}): AgentScopeCommand {
  const { command, args, scope } = input;
  const tempDir = input.tempDir ?? "";
  if (scope === undefined) {
    return {
      command: "/bin/sh",
      args: ["-c", LAUNCH_SCRIPT, "t3-agent", tempDir, command, ...args],
    };
  }
  return {
    command: "/bin/sh",
    args: [
      "-c",
      SCOPED_LAUNCH_SCRIPT,
      "t3-agent",
      tempDir,
      scope.runtimeDir,
      scope.systemdRun,
      "--user",
      "--scope",
      "--quiet",
      `--slice=${scope.slice}`,
      `--unit=${scope.unit}`,
      ...scope.options,
      "--",
      command,
      ...args,
    ],
  };
}
