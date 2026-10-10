// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - This host-side fixture creates an isolated local T3 environment.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export const SHOWCASE_PROJECT_ID = "t3code";
export const SHOWCASE_THREAD_ID = "remote-command-center";
export const SHOWCASE_TERMINAL_ID = "term-1";

export const SHOWCASE_SCENES = [
  "threads",
  "thread",
  "terminal",
  "review",
  "environments",
  "agent-activity",
] as const;
export type ShowcaseScene = (typeof SHOWCASE_SCENES)[number];

const PROJECTOR_NAMES = [
  "projection.projects",
  "projection.threads",
  "projection.thread-messages",
  "projection.thread-proposed-plans",
  "projection.thread-activities",
  "projection.thread-sessions",
  "projection.thread-turns",
  "projection.checkpoints",
  "projection.pending-approvals",
] as const;

const MODEL_SELECTION = JSON.stringify({ instanceId: "codex", model: "gpt-5.4" });
const PROJECT_SCRIPTS = JSON.stringify([
  {
    id: "dev",
    name: "Dev",
    command: "pnpm dev",
    icon: "play",
    runOnWorktreeCreate: false,
  },
  {
    id: "test",
    name: "Tests",
    command: "pnpm test",
    icon: "test",
    runOnWorktreeCreate: false,
  },
]);

const SHOWCASE_TERMINAL_PROMPT =
  "\u001b[1;32m→\u001b[0m \u001b[1;36mt3code\u001b[0m \u001b[1;34mgit:(\u001b[1;31mfeat/remote-command-center\u001b[1;34m)\u001b[0m \u001b[1;33m✗\u001b[0m ";

// A dev-server startup mirroring the web settings' terminal font preview:
// zsh-style prompt, brand line, addresses, the thread's 612-test summary,
// and a READY badge, so the scene exercises bold, dim, underline, the six
// accent colors, and a background cell.
export const SHOWCASE_TERMINAL_BUFFER = [
  `${SHOWCASE_TERMINAL_PROMPT}vpr dev`,
  "",
  "  \u001b[1;32mVITE\u001b[0m \u001b[32mv7.1.1\u001b[0m  \u001b[2mready in\u001b[0m \u001b[1m1.24s\u001b[0m",
  "",
  "  \u001b[32m→\u001b[0m  \u001b[2mLocal:\u001b[0m    \u001b[4;36mhttp://127.0.0.1:5173/\u001b[0m",
  "  \u001b[32m→\u001b[0m  \u001b[2mNetwork:\u001b[0m  \u001b[4;36mhttp://192.168.1.24:5173/\u001b[0m",
  "  \u001b[32m→\u001b[0m  \u001b[2mProject:\u001b[0m  \u001b[1mt3code\u001b[0m \u001b[2m— ~/Code/t3code\u001b[0m",
  "",
  "  \u001b[32m✓ 612 passed\u001b[0m   \u001b[33m△ 2 warnings\u001b[0m   \u001b[31m✗ 0 failed\u001b[0m",
  "",
  "  \u001b[42;30m READY \u001b[0m \u001b[2mwatching for changes — press\u001b[0m \u001b[1mq\u001b[0m \u001b[2mto quit\u001b[0m",
  "",
  SHOWCASE_TERMINAL_PROMPT,
].join("\r\n");

const BASE_ENVIRONMENT_PRESENCE = `export function environmentLabel(count: number): string {
  return \`${"${count}"} environments\`;
}
`;

const UPDATED_ENVIRONMENT_PRESENCE = `const PULSE = ["✦", "✧", "·", "✧"] as const;

export function environmentLabel(connected: number, total: number, frame: number): string {
  const pulse = PULSE[frame % PULSE.length];
  return \`${"${pulse} ${connected}/${total}"} ready\`;
}
`;

const REMOTE_HANDOFF_CARD = `import { View, Text } from "react-native";

export function RemoteHandoffCard(props: { machine: string; latencyMs: number }) {
  return (
    <View className="rounded-2xl bg-surface-2 p-4">
      <Text className="font-semibold">Ready on {props.machine}</Text>
      <Text className="text-success">Handoff in {props.latencyMs}ms</Text>
    </View>
  );
}
`;

const PROJECT_FAVICONS = {
  t3code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="10" fill="#000"/>
  <path d="M42.8841 90.797Q37.0018 90.797 31.97 88.9189Q26.9382 87.0408 23.2883 83.5682Q19.6385 80.0955 17.5832 75.3826Q15.5279 70.6697 15.5279 65Q15.5279 59.3303 17.5832 54.6174Q19.6385 49.9045 23.3237 46.4318Q27.009 42.9592 32.0763 41.0811Q37.1436 39.203 43.1676 39.203Q50.1838 39.203 55.7117 41.5417Q61.2397 43.8805 64.8541 48.2745L55.9243 56.3538Q53.373 53.5898 50.4319 52.2078Q47.4907 50.8258 43.8763 50.8258Q40.6871 50.8258 38.0649 51.818Q35.4427 52.8102 33.6 54.6883Q31.7574 56.5664 30.7298 59.1532Q29.7021 61.7399 29.7021 65Q29.7021 68.1183 30.7298 70.7405Q31.7574 73.3628 33.6 75.2408Q35.4427 77.1189 38.0295 78.1465Q40.6162 79.1742 43.7346 79.1742Q46.8529 79.1742 49.8295 78.1465Q52.806 77.1189 55.8535 74.6384L63.7201 84.4895Q59.4679 87.5369 53.8691 89.167Q48.2703 90.797 42.8841 90.797ZM63.7201 84.4895 51.3177 82.6468V63.9369H63.7201ZM87.958 90.797Q81.8631 90.797 76.2289 89.2733Q70.5946 87.7495 67.0511 85.3399L71.6577 74.9928Q74.9886 77.1189 79.3472 78.5009Q83.7057 79.8829 88.0289 79.8829Q90.9346 79.8829 92.7063 79.3514Q94.4781 78.8198 95.2931 77.9339Q96.1081 77.048 96.1081 75.8432Q96.1081 74.1423 94.549 73.1502Q92.9898 72.158 90.5093 71.5201Q88.0289 70.8823 85.0168 70.2444Q82.0048 69.6066 78.9928 68.6144Q75.9808 67.6222 73.5003 66.0276Q71.0198 64.433 69.4607 61.8462Q67.9015 59.2595 67.9015 55.2907Q67.9015 50.8258 70.3466 47.2114Q72.7916 43.597 77.6817 41.4Q82.5718 39.203 89.8715 39.203Q94.7616 39.203 99.4745 40.3015Q104.1874 41.4 107.8727 43.5261L103.5496 53.9441Q100.006 52.0306 96.5334 51.0739Q93.0607 50.1171 89.8006 50.1171Q86.8949 50.1171 85.1231 50.7195Q83.3514 51.3219 82.5718 52.3141Q81.7922 53.3063 81.7922 54.582Q81.7922 56.212 83.3159 57.1688Q84.8397 58.1255 87.3556 58.7279Q89.8715 59.3303 92.8835 59.9682Q95.8955 60.606 98.9075 61.5628Q101.9195 62.5195 104.4 64.1141Q106.8805 65.7087 108.4042 68.2955Q109.928 70.8823 109.928 74.7802Q109.928 79.1033 107.4829 82.7532Q105.0379 86.403 100.1832 88.6Q95.3286 90.797 87.958 90.797ZM84.6979 98.3093V31.6907H93.1316V98.3093Z" fill="#fff"/>
</svg>`,
  react: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#20232a"/>
  <g fill="none" stroke="#61dafb" stroke-width="2.8"><ellipse cx="32" cy="32" rx="25" ry="9"/><ellipse cx="32" cy="32" rx="25" ry="9" transform="rotate(60 32 32)"/><ellipse cx="32" cy="32" rx="25" ry="9" transform="rotate(120 32 32)"/></g>
  <circle cx="32" cy="32" r="4.8" fill="#61dafb"/>
</svg>`,
  linux: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#f7c948"/>
  <ellipse cx="32" cy="35" rx="17" ry="22" fill="#202124"/>
  <ellipse cx="32" cy="40" rx="12" ry="14" fill="#f5f5f2"/>
  <circle cx="27" cy="24" r="5" fill="white"/><circle cx="37" cy="24" r="5" fill="white"/>
  <circle cx="28" cy="25" r="2"/><circle cx="36" cy="25" r="2"/>
  <path d="M27 31l5-4 5 4-5 4z" fill="#f28c28"/><path d="M16 55h14l-7-5zM34 55h14l-7-5z" fill="#f28c28"/>
</svg>`,
} as const;

export const SHOWCASE_PROJECTS = [
  {
    id: "t3code",
    title: "T3 Code",
    directory: "t3code",
    repositoryUrl: "https://github.com/pingdotgg/t3code.git",
    favicon: PROJECT_FAVICONS.t3code,
  },
  {
    id: "react",
    title: "React",
    directory: "react",
    repositoryUrl: "https://github.com/facebook/react.git",
    favicon: PROJECT_FAVICONS.react,
  },
  {
    id: "linux",
    title: "Linux",
    directory: "linux",
    repositoryUrl: "https://github.com/torvalds/linux.git",
    favicon: PROJECT_FAVICONS.linux,
  },
] as const;

export const SHOWCASE_ENVIRONMENTS = [
  {
    id: "moonbase-terminal",
    label: "Moonbase Terminal",
    projectIds: ["t3code"],
  },
  {
    id: "suspense-station",
    label: "Suspense Station",
    projectIds: ["react"],
  },
  {
    id: "kernel-cabin",
    label: "Kernel Cabin",
    projectIds: ["linux"],
  },
] as const;

export const SHOWCASE_THREADS = [
  {
    id: SHOWCASE_THREAD_ID,
    projectId: "t3code",
    title: "Make remote coding feel local ✦",
    branch: "feat/remote-command-center",
    minutesAgo: 3,
    request:
      "Give T3 Code a remote-first command center. Make three machines feel one tap away, keep agent work in sync, and make every handoff feel instant.",
    response:
      "T3 Code now treats every machine like it is right here in the room. ✦\n\n- Moonbase, Suspense Station, and Kernel Cabin stay live together\n- Terminal state follows you without losing a single line\n- Agent work remains perfectly in sync across devices\n- Handoffs land before your train of thought can wander\n\nI also ran the changed workspace: **612 tests passed**.",
  },
  {
    id: "pocket-command-center",
    projectId: "t3code",
    title: "Put the command center in your pocket",
    branch: "feat/pocket-command-center",
    minutesAgo: 21,
    state: "approval" as const,
    request: "Make switching between desktop, phone, and tablet feel like one continuous session.",
    response:
      "The handoff flow preserves the selected thread, terminal buffer, and working diff. The final motion treatment is ready for approval.",
  },
  {
    id: "buttery-suspense",
    projectId: "react",
    title: "Make Suspense transitions buttery",
    branch: "perf/buttery-suspense",
    minutesAgo: 12,
    state: "working" as const,
    request:
      "Trace the last few dropped frames in nested Suspense transitions and make them disappear.",
    response: null,
  },
  {
    id: "hydration-haikus",
    projectId: "react",
    title: "Turn hydration warnings into haikus",
    branch: "dev/hydration-haikus",
    minutesAgo: 44,
    request:
      "Keep hydration errors precise, but make the development copy unexpectedly delightful.",
    response:
      "The diagnostics still lead with the exact mismatch and component stack. A tiny optional haiku now closes the expanded explanation.",
    snoozeMinutes: 90,
  },
  {
    id: "beautiful-boot",
    projectId: "linux",
    title: "Make boot logs oddly beautiful",
    branch: "feat/beautiful-boot",
    minutesAgo: 34,
    state: "plan" as const,
    request:
      "Design a clearer boot timeline that remains useful over serial and never hides kernel detail.",
    response:
      "The plan groups milestones without changing the underlying log stream, preserves plain-text output, and adds zero work to the hot path.",
  },
  {
    id: "patient-penguins",
    projectId: "linux",
    title: "Teach penguins to wait patiently",
    branch: "feat/patient-penguins",
    minutesAgo: 52,
    request: "Make delayed work easier to follow without adding noise to the scheduler trace.",
    response:
      "Delayed work now carries a concise reason through the trace, so the wait is legible without changing scheduling behavior.",
    snoozeMinutes: 8 * 60,
  },
  // Finished work, settled by hand: the list keeps it as a receded tail so
  // the active block above reads as everything still in flight. The active
  // block stays small enough that the settled tail begins above the fold —
  // a store screenshot has to show that history exists, not just imply it.
  {
    id: "handoff-haptics",
    projectId: "t3code",
    title: "Tune the handoff haptics",
    branch: "feat/handoff-haptics",
    minutesAgo: 5 * 60,
    settled: true,
    request: "Give the desktop-to-phone handoff a haptic that lands with the animation.",
    response:
      "The handoff now taps once as the thread lands and stays silent on failure, so the phone never celebrates a handoff that did not happen.",
  },
  {
    id: "streaming-shell",
    projectId: "react",
    title: "Stream the shell before the data",
    branch: "feat/streaming-shell",
    minutesAgo: 28 * 60,
    settled: true,
    request: "Get the app shell painted before any data request resolves.",
    response:
      "The shell now flushes on first byte and the data boundaries hydrate underneath it, so the first paint no longer waits on the slowest query.",
  },
  {
    id: "quieter-oom",
    projectId: "linux",
    title: "Make the OOM killer explain itself",
    branch: "feat/quieter-oom",
    minutesAgo: 2 * 24 * 60,
    settled: true,
    request: "Make out-of-memory kills legible without adding a single allocation to the hot path.",
    response:
      "Kills now report the winning heuristic and the runner-up alongside the usual dump, assembled entirely from data the path already had.",
  },
] as const;

function minutesBefore(now: number, minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

async function runGit(workspaceRoot: string, args: ReadonlyArray<string>): Promise<void> {
  await execFile("git", [...args], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Alex Rivera",
      GIT_AUTHOR_EMAIL: "alex@lumen.test",
      GIT_COMMITTER_NAME: "Alex Rivera",
      GIT_COMMITTER_EMAIL: "alex@lumen.test",
    },
  });
}

async function initializeRepository(input: {
  readonly workspaceRoot: string;
  readonly repositoryUrl: string;
  readonly commitMessage: string;
}): Promise<void> {
  await runGit(input.workspaceRoot, ["init", "-b", "main"]);
  await runGit(input.workspaceRoot, ["remote", "add", "origin", input.repositoryUrl]);
  await runGit(input.workspaceRoot, ["add", "."]);
  await runGit(input.workspaceRoot, ["commit", "-m", input.commitMessage]);
}

async function seedT3CodeWorkspace(workspaceRoot: string): Promise<void> {
  await NodeFSP.mkdir(NodePath.join(workspaceRoot, "apps/mobile/src/features/home"), {
    recursive: true,
  });
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "package.json"),
    `${JSON.stringify({ name: "t3code", private: true, scripts: { test: "vp test" } }, null, 2)}\n`,
  );
  await NodeFSP.writeFile(NodePath.join(workspaceRoot, "favicon.svg"), PROJECT_FAVICONS.t3code);
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/home/environmentPresence.ts"),
    BASE_ENVIRONMENT_PRESENCE,
  );
  await initializeRepository({
    workspaceRoot,
    repositoryUrl: "https://github.com/pingdotgg/t3code.git",
    commitMessage: "Show connected environments",
  });
  await runGit(workspaceRoot, ["checkout", "-b", "feat/remote-command-center"]);
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/home/environmentPresence.ts"),
    UPDATED_ENVIRONMENT_PRESENCE,
  );
  await NodeFSP.writeFile(
    NodePath.join(workspaceRoot, "apps/mobile/src/features/home/RemoteHandoffCard.tsx"),
    REMOTE_HANDOFF_CARD,
  );
}

async function seedCompanionWorkspace(input: {
  readonly workspaceRoot: string;
  readonly title: string;
  readonly repositoryUrl: string;
  readonly favicon: string;
}): Promise<void> {
  await NodeFSP.mkdir(input.workspaceRoot, { recursive: true });
  await NodeFSP.writeFile(NodePath.join(input.workspaceRoot, "favicon.svg"), input.favicon);
  await NodeFSP.writeFile(
    NodePath.join(input.workspaceRoot, "README.md"),
    `# ${input.title}\n\nSeeded by the T3 Code mobile screenshot harness.\n`,
  );
  await initializeRepository({
    workspaceRoot: input.workspaceRoot,
    repositoryUrl: input.repositoryUrl,
    commitMessage: `Seed ${input.title} workspace`,
  });
}

function insertThread(
  database: NodeSqlite.DatabaseSync,
  now: number,
  input: {
    readonly id: string;
    readonly projectId: string;
    readonly title: string;
    readonly branch: string;
    readonly minutesAgo: number;
    readonly state?: "working" | "approval" | "plan";
    readonly settled?: boolean;
    readonly snoozeMinutes?: number;
    readonly workspaceRoot: string;
  },
): void {
  const turnId = `${input.id}-turn`;
  const updatedAt = minutesBefore(now, input.minutesAgo);
  const isWorking = input.state === "working";
  const snoozedUntil =
    input.snoozeMinutes === undefined
      ? null
      : new Date(now + input.snoozeMinutes * 60_000).toISOString();
  const snoozedAt =
    input.snoozeMinutes === undefined
      ? null
      : minutesBefore(now, Math.max(1, Math.floor(input.minutesAgo / 2)));
  database
    .prepare(
      `INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
        branch, worktree_path, latest_turn_id, latest_user_message_at, pending_approval_count,
        pending_user_input_count, has_actionable_proposed_plan, created_at, updated_at,
        archived_at, deleted_at, settled_override, settled_at, snoozed_until, snoozed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.projectId,
      input.title,
      MODEL_SELECTION,
      "full-access",
      input.state === "plan" ? "plan" : "default",
      input.branch,
      input.workspaceRoot,
      turnId,
      minutesBefore(now, input.minutesAgo + 1),
      input.state === "approval" ? 1 : 0,
      input.state === "plan" ? 1 : 0,
      minutesBefore(now, input.minutesAgo + 120),
      updatedAt,
      input.settled ? "settled" : null,
      input.settled ? updatedAt : null,
      snoozedUntil,
      snoozedAt,
    );
  database
    .prepare(
      `INSERT INTO projection_turns (
        thread_id, turn_id, pending_message_id, assistant_message_id, state, requested_at,
        started_at, completed_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status,
        checkpoint_files_json, source_proposed_plan_thread_id, source_proposed_plan_id
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, NULL, '[]', NULL, NULL)`,
    )
    .run(
      input.id,
      turnId,
      isWorking ? null : `${input.id}-answer`,
      isWorking ? "running" : "completed",
      minutesBefore(now, input.minutesAgo + 2),
      minutesBefore(now, input.minutesAgo + 2),
      isWorking ? null : updatedAt,
    );
  database
    .prepare(
      `INSERT INTO projection_thread_sessions (
        thread_id, status, provider_name, provider_instance_id, provider_session_id,
        provider_thread_id, runtime_mode, active_turn_id, last_error, updated_at
      ) VALUES (?, ?, 'Codex', 'codex', NULL, NULL, 'full-access', ?, NULL, ?)`,
    )
    .run(input.id, isWorking ? "running" : "ready", isWorking ? turnId : null, updatedAt);
}

const SEEDED_PROJECTION_TABLES = [
  "projection_pending_approvals",
  "projection_thread_proposed_plans",
  "projection_thread_activities",
  "projection_thread_messages",
  "projection_thread_sessions",
  "projection_turns",
  "projection_threads",
  "projection_projects",
  "projection_state",
] as const;

const SEEDED_THREAD_COLUMNS = ["snoozed_until", "snoozed_at"] as const;

function hasSeedableSchema(dbPath: string): boolean {
  let database: NodeSqlite.DatabaseSync;
  try {
    database = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return false;
  }
  try {
    const tableCount = database
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (${SEEDED_PROJECTION_TABLES.map(() => "?").join(", ")})`,
      )
      .get(...SEEDED_PROJECTION_TABLES) as { count: number };
    if (tableCount.count !== SEEDED_PROJECTION_TABLES.length) return false;

    const threadColumns = database.prepare("PRAGMA table_info(projection_threads)").all() as Array<{
      name: string;
    }>;
    const threadColumnNames = new Set(threadColumns.map((column) => column.name));
    return SEEDED_THREAD_COLUMNS.every((column) => threadColumnNames.has(column));
  } catch {
    return false;
  } finally {
    database.close();
  }
}

async function waitForSeedableSchema(dbPath: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasSeedableSchema(dbPath)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The environment server did not migrate ${dbPath} within ${timeoutMs}ms.`);
}

function seedDatabase(
  dbPath: string,
  workspaceRoots: ReadonlyMap<string, string>,
  projects: ReadonlyArray<(typeof SHOWCASE_PROJECTS)[number]>,
  threads: ReadonlyArray<(typeof SHOWCASE_THREADS)[number]>,
  now: number,
): void {
  // The environment server is already running against this file and keeps
  // writing (migrations, projections) while we seed, so the write lock is
  // genuinely contended — without a busy timeout `BEGIN IMMEDIATE` fails
  // instantly with SQLITE_BUSY on a loaded machine.
  const database = new NodeSqlite.DatabaseSync(dbPath, { timeout: 30_000 });
  try {
    database.exec("BEGIN IMMEDIATE");
    for (const table of SEEDED_PROJECTION_TABLES) {
      database.exec(`DELETE FROM ${table}`);
    }
    const insertProject = database.prepare(
      `INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    for (const [index, project] of projects.entries()) {
      const workspaceRoot = workspaceRoots.get(project.id);
      if (!workspaceRoot) throw new Error(`Missing workspace root for ${project.id}.`);
      const latestThreadMinutes = Math.min(
        ...threads
          .filter((thread) => thread.projectId === project.id)
          .map((thread) => thread.minutesAgo),
      );
      insertProject.run(
        project.id,
        project.title,
        workspaceRoot,
        MODEL_SELECTION,
        PROJECT_SCRIPTS,
        minutesBefore(now, 60 * 24 * (90 - index * 12)),
        minutesBefore(now, latestThreadMinutes),
      );
    }

    for (const thread of threads) {
      const workspaceRoot = workspaceRoots.get(thread.projectId);
      if (!workspaceRoot) throw new Error(`Missing workspace root for ${thread.projectId}.`);
      insertThread(database, now, {
        ...thread,
        ...("state" in thread ? { state: thread.state } : {}),
        workspaceRoot,
      });
    }

    const insertMessage = database.prepare(
      `INSERT INTO projection_thread_messages (
        message_id, thread_id, turn_id, role, text, is_streaming, attachments_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
    );
    for (const thread of threads) {
      const turnId = `${thread.id}-turn`;
      const requestTime = minutesBefore(now, thread.minutesAgo + 5);
      insertMessage.run(
        `${thread.id}-request`,
        thread.id,
        turnId,
        "user",
        thread.request,
        requestTime,
        requestTime,
      );
      if (thread.response !== null) {
        const responseTime = minutesBefore(now, thread.minutesAgo);
        insertMessage.run(
          `${thread.id}-answer`,
          thread.id,
          turnId,
          "assistant",
          thread.response,
          responseTime,
          responseTime,
        );
      }
    }

    const turnId = `${SHOWCASE_THREAD_ID}-turn`;
    const insertActivity = database.prepare(
      `INSERT INTO projection_thread_activities (
        activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
      ) VALUES (?, ?, ?, 'tool', 'tool.completed', ?, ?, ?, ?)`,
    );
    insertActivity.run(
      "trace-remote-handoff",
      SHOWCASE_THREAD_ID,
      turnId,
      "Traced the remote handoff path",
      JSON.stringify({
        itemType: "command_execution",
        title: "Traced the remote handoff path",
        detail: "Three environments, one continuous workspace",
        status: "completed",
      }),
      1,
      minutesBefore(now, 8),
    );
    insertActivity.run(
      "sync-command-center",
      SHOWCASE_THREAD_ID,
      turnId,
      "Synced the command center",
      JSON.stringify({
        itemType: "file_change",
        title: "Synced the command center",
        detail: "2 files changed · instant handoffs · calm reconnects",
        status: "completed",
      }),
      2,
      minutesBefore(now, 6),
    );
    insertActivity.run(
      "run-changed-suite",
      SHOWCASE_THREAD_ID,
      turnId,
      "Ran the changed workspace",
      JSON.stringify({
        itemType: "command_execution",
        title: "Ran the changed workspace",
        detail: "612 tests passed · 3 environments online",
        status: "completed",
      }),
      3,
      minutesBefore(now, 4),
    );

    for (const [index, projector] of PROJECTOR_NAMES.entries()) {
      database
        .prepare(
          "INSERT INTO projection_state (projector, last_applied_sequence, updated_at) VALUES (?, ?, ?)",
        )
        .run(projector, index + 1, minutesBefore(now, 1));
    }
    database.exec("COMMIT");
  } catch (error) {
    // A failed BEGIN (or an error SQLite already auto-rolled back) leaves no
    // transaction, and the rollback's own "cannot rollback" error would then
    // replace the one that actually explains the failure.
    try {
      database.exec("ROLLBACK");
    } catch {
      // Nothing to roll back.
    }
    throw error;
  } finally {
    database.close();
  }
}

export async function seedShowcaseEnvironment(input: {
  readonly baseDir: string;
  readonly projectIds?: ReadonlyArray<string>;
  readonly now?: number;
}): Promise<{ readonly dbPath: string; readonly workspaceRoot: string }> {
  const now = input.now ?? Date.now();
  const selectedProjectIds = new Set(
    input.projectIds ?? SHOWCASE_PROJECTS.map((project) => project.id),
  );
  const projects = SHOWCASE_PROJECTS.filter((project) => selectedProjectIds.has(project.id));
  if (projects.length === 0) throw new Error("At least one showcase project must be selected.");
  const threads = SHOWCASE_THREADS.filter((thread) => selectedProjectIds.has(thread.projectId));
  const workspaceBase = NodePath.join(input.baseDir, "workspace");
  const workspaceRoots = new Map(
    projects.map(
      (project) => [project.id, NodePath.join(workspaceBase, project.directory)] as const,
    ),
  );
  const primaryProject =
    projects.find((project) => project.id === SHOWCASE_PROJECT_ID) ?? projects[0];
  if (!primaryProject) throw new Error("The primary showcase workspace is not configured.");
  const workspaceRoot = workspaceRoots.get(primaryProject.id);
  if (!workspaceRoot) throw new Error("The primary showcase workspace is not configured.");
  const dbPath = NodePath.join(input.baseDir, "userdata", "state.sqlite");
  if (primaryProject.id === SHOWCASE_PROJECT_ID) {
    await seedT3CodeWorkspace(workspaceRoot);
  }
  await Promise.all(
    projects
      .filter((project) => project.id !== SHOWCASE_PROJECT_ID)
      .map(async (project) => {
        const projectWorkspaceRoot = workspaceRoots.get(project.id);
        if (!projectWorkspaceRoot) throw new Error(`Missing workspace root for ${project.id}.`);
        await seedCompanionWorkspace({
          workspaceRoot: projectWorkspaceRoot,
          title: project.title,
          repositoryUrl: project.repositoryUrl,
          favicon: project.favicon,
        });
      }),
  );
  // The environment server begins listening before it finishes migrating the
  // database, so wait for the schema before deleting from and reseeding it.
  await waitForSeedableSchema(dbPath);
  seedDatabase(dbPath, workspaceRoots, projects, threads, now);

  const terminalDirectory = NodePath.join(input.baseDir, "userdata", "logs", "terminals");
  if (selectedProjectIds.has(SHOWCASE_PROJECT_ID)) {
    const safeThreadId = Buffer.from(SHOWCASE_THREAD_ID).toString("base64url");
    await NodeFSP.mkdir(terminalDirectory, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(terminalDirectory, `terminal_${safeThreadId}.log`),
      SHOWCASE_TERMINAL_BUFFER,
    );
  }
  return { dbPath, workspaceRoot };
}
