// A scripted stand-in for the Codex CLI, so a walkthrough shows real turns
// without a real account. T3 Code runs it as the Codex binary:
//
//   fake-codex.mjs <script.json> --version
//   fake-codex.mjs <script.json> app-server        JSON-RPC over stdio
//   fake-codex.mjs <script.json> exec ... -        commit messages, titles
//
// Each turn runs its steps for real in the turn's cwd: a `run` step runs the
// command with bash, and an `edit` step writes the file. So the worktree holds
// the agent's work when the walkthrough lands it. Plain Node, stdlib only.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeTimersPromises from "node:timers/promises";

const [scriptPath, ...args] = process.argv.slice(2);
const script = JSON.parse(NodeFS.readFileSync(scriptPath, "utf8"));

if (args.includes("--version")) {
  console.log("codex-cli 999.0.0");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log("Usage: codex app-server [OPTIONS]");
  process.exit(0);
}
if (args[0] === "exec") {
  await exec(args);
  process.exit(0);
}
if (args[0] !== "app-server") {
  console.error(`fake-codex: unsupported arguments: ${args.join(" ")}`);
  process.exit(2);
}

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method, params) => write({ jsonrpc: "2.0", method, params });
const now = () => Date.now();
const turnsUsed = new Set();
const tokens = { input: 0, output: 0 };
let queue = Promise.resolve();

NodeReadline.createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (method === undefined) return;
  switch (method) {
    case "initialize":
      return write({
        id,
        result: {
          userAgent: "codex-cli/999.0.0",
          codexHome: NodeOS.tmpdir(),
          platformFamily: "unix",
          platformOs: "macos",
        },
      });
    case "account/read":
      return write({ id, result: { account: { type: "apiKey" }, requiresOpenaiAuth: false } });
    case "skills/list":
    case "model/list":
      return write({ id, result: { data: [] } });
    case "thread/start":
      return write({ id, result: threadResponse(NodeCrypto.randomUUID(), params) });
    case "thread/resume":
      return write({ id, result: threadResponse(params.threadId, params) });
    case "turn/start": {
      const turn = { ...turnShape(NodeCrypto.randomUUID()), startedAt: Math.floor(now() / 1000) };
      write({ id, result: { turn } });
      // One turn at a time, as the real agent does.
      queue = queue.then(() => runTurn(params, turn)).catch((error) => console.error(error));
      return;
    }
    default:
      if (id !== undefined) write({ id, result: {} });
  }
});

function threadResponse(threadId, params) {
  const cwd = params?.cwd ?? process.cwd();
  const created = Math.floor(now() / 1000);
  return {
    thread: {
      id: threadId,
      extra: null,
      sessionId: threadId,
      forkedFromId: null,
      parentThreadId: null,
      preview: "",
      projectId: null,
      ephemeral: false,
      historyMode: "legacy",
      modelProvider: "openai",
      createdAt: created,
      updatedAt: created,
      recencyAt: created,
      status: { type: "idle" },
      path: NodePath.join(NodeOS.tmpdir(), `${threadId}.jsonl`),
      cwd,
      cliVersion: "999.0.0",
      source: "vscode",
      canAcceptDirectInput: true,
      threadSource: null,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [],
    },
    model: params?.model ?? "gpt-5.5",
    modelProvider: "openai",
    serviceTier: "default",
    cwd,
    runtimeWorkspaceRoots: [cwd],
    instructionSources: [],
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "dangerFullAccess" },
    activePermissionProfile: null,
    reasoningEffort: "medium",
    multiAgentMode: "explicitRequestOnly",
  };
}

function turnShape(id) {
  return {
    id,
    items: [],
    itemsView: "notLoaded",
    status: "inProgress",
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  };
}

// The first unused turn whose `match` finds the prompt; a turn with no
// `match` takes any prompt.
function pickTurn(prompt) {
  const index = script.turns.findIndex(
    (turn, i) => !turnsUsed.has(i) && (!turn.match || new RegExp(turn.match, "i").test(prompt)),
  );
  if (index === -1) return { steps: [{ say: { text: "Done." } }] };
  turnsUsed.add(index);
  return script.turns[index];
}

async function runTurn(params, turn) {
  const threadId = params.threadId;
  const cwd = params.cwd ?? process.cwd();
  const prompt = (params.input ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
  const began = now();
  const ids = { threadId, turnId: turn.id };

  notify("thread/status/changed", { threadId, status: { type: "active", activeFlags: [] } });
  notify("turn/started", { threadId, turn });

  const picked = pickTurn(prompt);
  for (const step of picked.steps) {
    const [kind, value] = Object.entries(step)[0];
    await steps[kind](value, { ...ids, cwd });
  }

  tokens.input += (picked.context ?? 18_000) + prompt.length;
  const usage = {
    totalTokens: tokens.input + tokens.output,
    inputTokens: tokens.input,
    cachedInputTokens: Math.floor(tokens.input * 0.8),
    cacheWriteInputTokens: 0,
    outputTokens: tokens.output,
    reasoningOutputTokens: 0,
  };
  notify("thread/tokenUsage/updated", {
    ...ids,
    tokenUsage: { total: usage, last: usage, modelContextWindow: 258_400 },
  });
  notify("turn/completed", {
    threadId,
    turn: {
      ...turn,
      status: "completed",
      completedAt: Math.floor(now() / 1000),
      durationMs: now() - began,
    },
  });
  notify("thread/status/changed", { threadId, status: { type: "idle" } });
}

const steps = {
  async think({ text, ms = 1500 }, ids) {
    const id = `rs_${NodeCrypto.randomUUID()}`;
    notify("item/started", {
      item: { type: "reasoning", id, summary: [], content: [] },
      ...ids,
      startedAtMs: now(),
    });
    notify("item/reasoning/summaryPartAdded", { ...ids, itemId: id, summaryIndex: 0 });
    await stream(text, ms, (delta) =>
      notify("item/reasoning/summaryTextDelta", { ...ids, itemId: id, delta, summaryIndex: 0 }),
    );
    notify("item/completed", {
      item: { type: "reasoning", id, summary: [text], content: [] },
      ...ids,
      completedAtMs: now(),
    });
  },

  async say({ text, ms = 1800 }, ids) {
    const id = `msg_${NodeCrypto.randomUUID()}`;
    const item = {
      type: "agentMessage",
      id,
      text: "",
      phase: "final_answer",
      memoryCitation: null,
    };
    notify("item/started", { item, ...ids, startedAtMs: now() });
    await stream(text, ms, (delta) =>
      notify("item/agentMessage/delta", { ...ids, itemId: id, delta }),
    );
    tokens.output += Math.ceil(text.length / 4);
    notify("item/completed", { item: { ...item, text }, ...ids, completedAtMs: now() });
  },

  // Runs for real; `ms` is the least time the row shows as running.
  async run({ command, ms = 800 }, ids) {
    const id = `exec-${NodeCrypto.randomUUID()}`;
    const item = {
      type: "commandExecution",
      id,
      pluginId: null,
      scriptPath: null,
      command: `/bin/bash -lc ${JSON.stringify(command)}`,
      cwd: ids.cwd,
      processId: String(process.pid),
      source: "unifiedExecStartup",
      status: "inProgress",
      commandActions: [{ type: "unknown", command }],
      aggregatedOutput: null,
      exitCode: null,
      durationMs: null,
    };
    const began = now();
    notify("item/started", { item, ...ids, startedAtMs: began });
    const [result] = await Promise.all([bash(command, ids.cwd), NodeTimersPromises.setTimeout(ms)]);
    notify("item/completed", {
      item: {
        ...item,
        status: result.code === 0 ? "completed" : "failed",
        aggregatedOutput: result.output,
        exitCode: result.code,
        durationMs: now() - began,
      },
      ...ids,
      completedAtMs: now(),
    });
  },

  async edit({ path, content, ms = 600 }, ids) {
    const absolute = NodePath.isAbsolute(path) ? path : NodePath.join(ids.cwd, path);
    const existed = NodeFS.existsSync(absolute);
    const before = existed ? NodeFS.readFileSync(absolute, "utf8") : "";
    const id = `exec-${NodeCrypto.randomUUID()}`;
    const item = {
      type: "fileChange",
      id,
      changes: [
        {
          path: absolute,
          kind: { type: existed ? "update" : "add" },
          diff: existed
            ? unifiedDiff(NodePath.relative(ids.cwd, absolute), before, content)
            : content,
        },
      ],
      status: "inProgress",
    };
    notify("item/started", { item, ...ids, startedAtMs: now() });
    await NodeTimersPromises.setTimeout(ms);
    NodeFS.mkdirSync(NodePath.dirname(absolute), { recursive: true });
    NodeFS.writeFileSync(absolute, content);
    tokens.output += Math.ceil(content.length / 4);
    notify("item/completed", {
      item: { ...item, status: "completed" },
      ...ids,
      completedAtMs: now(),
    });
  },

  async plan({ explanation = null, steps: plan }, ids) {
    notify("turn/plan/updated", { ...ids, explanation, plan });
    await NodeTimersPromises.setTimeout(400);
  },

  async wait({ ms }) {
    await NodeTimersPromises.setTimeout(ms);
  },
};

// Sends text in word-sized pieces spread over `ms`, as a model streams.
async function stream(text, ms, send) {
  const pieces = text.match(/\S+\s*|\s+/g) ?? [];
  const gap = pieces.length ? ms / pieces.length : 0;
  for (const piece of pieces) {
    send(piece);
    await NodeTimersPromises.setTimeout(gap);
  }
}

function bash(command, cwd) {
  return new Promise((resolve) => {
    const child = NodeChildProcess.spawn("/bin/bash", ["-c", command], { cwd });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

function unifiedDiff(name, before, after) {
  const work = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "fake-codex-"));
  NodeFS.writeFileSync(NodePath.join(work, "a"), before);
  NodeFS.writeFileSync(NodePath.join(work, "b"), after);
  const result = NodeChildProcess.spawnSync(
    "/usr/bin/diff",
    [
      "-u",
      "--label",
      `a/${name}`,
      "--label",
      `b/${name}`,
      NodePath.join(work, "a"),
      NodePath.join(work, "b"),
    ],
    { encoding: "utf8" },
  );
  return result.stdout;
}

// `codex exec --output-schema S --output-last-message O -`: T3 Code asks for
// JSON that fits the schema. Each property comes from the script's `exec`
// values by name, such as `subject` for a commit message.
async function exec(argv) {
  const schemaPath = argv[argv.indexOf("--output-schema") + 1];
  const outputPath = argv[argv.indexOf("--output-last-message") + 1];
  const schema = JSON.parse(NodeFS.readFileSync(schemaPath, "utf8"));
  const input = NodeFS.readFileSync(0, "utf8");
  const values = {
    ...script.exec,
    ...script.execFor?.find(({ match }) => new RegExp(match, "i").test(input))?.values,
  };
  const output = Object.fromEntries(
    Object.entries(schema.properties ?? {})
      .filter(([key]) => key in values || (schema.required ?? []).includes(key))
      .map(([key, property]) => [key, values[key] ?? placeholder(property)]),
  );
  await NodeTimersPromises.setTimeout(script.execMs ?? 1200);
  NodeFS.writeFileSync(outputPath, JSON.stringify(output));
}

function placeholder(property) {
  if (property.type === "array") return [];
  if (property.type === "boolean") return false;
  if (property.type === "number" || property.type === "integer") return 0;
  return "Update files";
}
