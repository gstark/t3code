import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { AgentScript } from "./agent-script.ts";

// What a walkthrough starts from: a demo repository and what the fake agent
// does in each turn.
export type Scenario = {
  project: {
    title: string;
    // Folder name of the checkout, which T3 Code shows in places.
    folder: string;
    // Commits made in order on `main`, each a message and the files it writes.
    commits: Commit[];
    // A branch to leave the main checkout on, made from `main`.
    branch?: string;
  };
  agent: AgentScript;
  // A second agent that speaks ACP, added as the "ACP Agent" provider.
  acpAgent?: AgentScript;
  // A second server, paired as a remote environment with this label. It has
  // its own clone of the project.
  remote?: { label: string };
};

export type Commit = { message: string; files: Record<string, string> };

export type Environment = {
  pairingUrl: string;
  home: string;
  workspace: string;
  origin: string;
  git: (...args: string[]) => string;
  // Pushes a commit to origin's `main` from another clone, as a teammate would.
  pushAsTeammate: (commit: Commit) => void;
  // The second server, when the scenario asks for one. `stop` takes it
  // offline.
  remote?: { label: string; pairingUrl: string; stop: () => Promise<void> };
  stop: () => Promise<void>;
};

const repoRoot = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const fakeCodex = NodeURL.fileURLToPath(new URL("./fake-codex.mjs", import.meta.url));
const fakeAcp = NodeURL.fileURLToPath(new URL("./fake-acp.mjs", import.meta.url));

// A dev server on its own ports, with a throwaway home. It never touches
// ~/.t3, a real agent account, or your own Git identity.
export async function startEnvironment(scenario: Scenario): Promise<Environment> {
  // A short fixed path, because the app shows worktree paths on screen.
  const root = process.env.WALKTHROUGH_ROOT ?? "/tmp/demo";
  // Only a folder an earlier run made, or an empty one, is safe to delete.
  const marker = NodePath.join(root, ".walkthrough-root");
  if (
    NodeFS.existsSync(root) &&
    NodeFS.readdirSync(root).length > 0 &&
    !NodeFS.existsSync(marker)
  ) {
    throw new Error(`${root} is not a walkthrough folder. Remove it or set WALKTHROUGH_ROOT.`);
  }
  NodeFS.rmSync(root, { recursive: true, force: true });
  NodeFS.mkdirSync(root, { recursive: true });
  NodeFS.writeFileSync(marker, "");
  const home = NodePath.join(root, "home");
  const workspace = NodePath.join(root, scenario.project.folder);
  const origin = NodePath.join(root, "origin.git");
  const gitConfig = NodePath.join(root, "gitconfig");

  NodeFS.writeFileSync(
    gitConfig,
    [
      "[user]",
      "  name = Sam Rivera",
      "  email = sam@example.com",
      "[init]",
      "  defaultBranch = main",
      "[commit]",
      "  gpgsign = false",
      "",
    ].join("\n"),
  );
  const env = { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: string[]) =>
    NodeChildProcess.execFileSync("git", args, { cwd: workspace, env, encoding: "utf8" }).trim();

  NodeFS.mkdirSync(workspace, { recursive: true });
  const commit = (cwd: string, { message, files }: Commit) => {
    for (const [path, content] of Object.entries(files)) {
      NodeFS.mkdirSync(NodePath.dirname(NodePath.join(cwd, path)), { recursive: true });
      NodeFS.writeFileSync(NodePath.join(cwd, path), content);
    }
    const run = (...args: string[]) =>
      NodeChildProcess.execFileSync("git", args, { cwd, env, stdio: "pipe" });
    run("add", "--all");
    run("commit", "--quiet", "-m", message);
  };

  git("init", "--quiet");
  for (const each of scenario.project.commits) commit(workspace, each);
  NodeChildProcess.execFileSync("git", ["init", "--quiet", "--bare", origin], { env });
  git("remote", "add", "origin", origin);
  git("push", "--quiet", "-u", "origin", "main");
  if (scenario.project.branch) git("switch", "--quiet", "-c", scenario.project.branch);

  const teammate = NodePath.join(root, "teammate");
  const pushAsTeammate = (each: Commit) => {
    if (!NodeFS.existsSync(teammate)) {
      NodeChildProcess.execFileSync("git", ["clone", "--quiet", origin, teammate], { env });
    }
    NodeChildProcess.execFileSync("git", ["pull", "--quiet", "--ff-only"], { cwd: teammate, env });
    commit(teammate, each);
    NodeChildProcess.execFileSync("git", ["push", "--quiet", "origin", "main"], {
      cwd: teammate,
      env,
    });
  };

  // T3 Code runs the Codex binary with its own environment, so the script
  // path goes in a wrapper rather than an environment variable.
  const agentScript = NodePath.join(root, "agent.json");
  const codex = NodePath.join(root, "codex");
  NodeFS.writeFileSync(agentScript, JSON.stringify(scenario.agent, null, 2));
  NodeFS.writeFileSync(
    codex,
    `#!/bin/sh\nexec "${process.execPath}" "${fakeCodex}" "${agentScript}" "$@"\n`,
  );
  NodeFS.chmodSync(codex, 0o755);

  const acpScript = NodePath.join(root, "acp-agent.json");
  const acp = NodePath.join(root, "acp-agent");
  if (scenario.acpAgent) {
    NodeFS.writeFileSync(acpScript, JSON.stringify(scenario.acpAgent, null, 2));
    NodeFS.writeFileSync(
      acp,
      `#!/bin/sh\nexec "${process.execPath}" "${fakeAcp}" "${acpScript}" "$@"\n`,
    );
    NodeFS.chmodSync(acp, 0o755);
  }

  const settings = {
    providerInstances: {
      codex: { driver: "codex", enabled: true, config: { binaryPath: codex } },
      claudeAgent: { driver: "claudeAgent", enabled: false },
      ...(scenario.acpAgent && {
        acpAgent: {
          driver: "acpRegistry",
          displayName: "ACP Agent",
          enabled: true,
          config: { source: "local", commandPath: acp },
        },
      }),
    },
  };
  // Offline: with no server running, the CLI writes the project itself.
  const prepareHome = (serverHome: string, checkout: string) => {
    NodeFS.mkdirSync(NodePath.join(serverHome, "userdata"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(serverHome, "userdata", "settings.json"),
      JSON.stringify(settings, null, 2),
    );
    NodeChildProcess.execFileSync(
      process.execPath,
      [
        "apps/server/src/bin.ts",
        "project",
        "add",
        "--base-dir",
        serverHome,
        "--title",
        scenario.project.title,
        checkout,
      ],
      { cwd: repoRoot, env, stdio: "pipe" },
    );
  };

  // As scripts/mobile-showcase.ts does: the machine label comes from a fake
  // scutil, and the login shell adds nothing from your profile.
  const shell = NodePath.join(root, "shell");
  NodeFS.writeFileSync(
    shell,
    `#!/bin/sh\nif [ "$1" = "-ilc" ] || [ "$1" = "-lic" ]; then exec /bin/sh -c "$2"; fi\nexec /bin/sh "$@"\n`,
  );
  NodeFS.chmodSync(shell, 0o755);
  const offset = Number(process.env.WALKTHROUGH_PORT_OFFSET ?? "47");
  const launch = (input: {
    name: string;
    label: string;
    mode: string;
    offset: number;
    env?: Record<string, string>;
  }) => {
    const bin = NodePath.join(root, input.name, "bin");
    NodeFS.mkdirSync(bin, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(bin, "scutil"),
      `#!/bin/sh\nif [ "$1" = "--get" ] && [ "$2" = "ComputerName" ]; then echo "${input.label}"; exit 0; fi\nexit 1\n`,
    );
    NodeFS.chmodSync(NodePath.join(bin, "scutil"), 0o755);
    return NodeChildProcess.spawn(
      process.execPath,
      ["scripts/dev-runner.ts", input.mode, "--home-dir", NodePath.join(root, input.name)],
      {
        cwd: repoRoot,
        env: {
          ...env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          SHELL: shell,
          T3CODE_PORT_OFFSET: String(input.offset),
          T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "0",
          ...input.env,
        },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  };

  prepareHome(home, workspace);
  const server = launch({ name: "home", label: "Demo Mac", mode: "dev", offset });

  // A second server with its own clone, which the browser pairs as a remote
  // environment. It runs the server only, on the next port offset, and takes
  // requests from the main server's web origin.
  let remoteServer: NodeChildProcess.ChildProcess | undefined;
  const startRemote = async (label: string) => {
    const remoteHome = NodePath.join(root, "remote");
    const checkout = NodePath.join(root, "remote-checkout", scenario.project.folder);
    NodeChildProcess.execFileSync("git", ["clone", "--quiet", origin, checkout], { env });
    prepareHome(remoteHome, checkout);
    remoteServer = launch({
      name: "remote",
      label,
      mode: "dev:server",
      offset: offset + 1,
      env: { T3CODE_DEV_ALLOWED_ORIGINS: new URL(await mainPairingUrl).origin },
    });
    const pairingUrl = await waitForPairingUrl(remoteServer);
    return { label, pairingUrl, stop: () => stopServer(remoteServer!) };
  };

  const stop = async () => {
    if (remoteServer) await stopServer(remoteServer);
    await stopServer(server);
    // The server can still be writing logs as it exits.
    if (!process.env.WALKTHROUGH_KEEP) {
      NodeFS.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    }
  };

  const mainPairingUrl = waitForPairingUrl(server);
  try {
    const pairingUrl = await mainPairingUrl;
    const remote = scenario.remote ? await startRemote(scenario.remote.label) : undefined;
    return { pairingUrl, home, workspace, origin, git, pushAsTeammate, remote, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

function waitForPairingUrl(server: NodeChildProcess.ChildProcess) {
  return new Promise<string>((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`No pairing URL after 90s:\n${log}`)), 90_000);
    const read = (chunk: Buffer) => {
      log += chunk.toString();
      const match = log.match(/pairingUrl:\s*(\S+)/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    server.stdout?.on("data", read);
    server.stderr?.on("data", read);
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`The dev server exited with code ${code}:\n${log}`));
    });
  });
}

// dev-runner starts Vite and the server as children, so stop the whole group.
async function stopServer(server: NodeChildProcess.ChildProcess) {
  if (server.pid === undefined || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  process.kill(-server.pid, "SIGTERM");
  const timeout = setTimeout(() => {
    if (server.pid !== undefined) process.kill(-server.pid, "SIGKILL");
  }, 10_000);
  await exited;
  clearTimeout(timeout);
}
