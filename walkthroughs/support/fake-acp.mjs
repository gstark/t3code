// A scripted ACP agent, so a walkthrough shows an ACP provider without a real
// account. T3 Code runs it as a local ACP Registry command:
//
//   fake-acp.mjs <script.json>        ACP JSON-RPC over stdio
//
// It plays the same AgentScript as fake-codex.mjs. A `run` step runs the
// command with bash in the session cwd and sends its `reason` as
// `rawInput.description`, as Grok does. An `edit` step writes the file.
// `plan` steps and `context` are not sent. Plain Node, stdlib only.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeTimersPromises from "node:timers/promises";

const [scriptPath] = process.argv.slice(2);
const script = JSON.parse(NodeFS.readFileSync(scriptPath, "utf8"));

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
const turnsUsed = new Set();
const sessions = new Map();
const models = [{ modelId: "fake-acp", name: "Demo Agent" }];
let queue = Promise.resolve();

NodeReadline.createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (id === undefined || method === undefined) return;
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: 1,
        agentInfo: { name: "demo-agent", version: "1.0.0" },
        agentCapabilities: { loadSession: true },
      });
      break;
    case "session/new": {
      const sessionId = NodeCrypto.randomUUID();
      sessions.set(sessionId, params?.cwd ?? process.cwd());
      reply(id, { sessionId, models: { currentModelId: "fake-acp", availableModels: models } });
      break;
    }
    case "session/load":
    case "session/resume":
      sessions.set(params.sessionId, params?.cwd ?? process.cwd());
      reply(id, { models: { currentModelId: "fake-acp", availableModels: models } });
      break;
    case "session/prompt":
      // One turn at a time, as a real agent does.
      queue = queue
        .then(() => runTurn(params))
        .then(() => reply(id, { stopReason: "end_turn" }))
        .catch((error) => console.error(error));
      break;
    case "authenticate":
    case "session/set_model":
    case "session/set_mode":
    case "session/set_config_option":
    case "session/cancel":
    case "session/close":
      reply(id, {});
      break;
    default:
      write({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
});

async function runTurn({ sessionId, prompt = [] }) {
  const text = prompt.map((part) => (part.type === "text" ? part.text : "")).join("\n");
  const cwd = sessions.get(sessionId) ?? process.cwd();
  const update = (body) =>
    write({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: body } });
  for (const step of pickTurn(text).steps) {
    const [kind, value] = Object.entries(step)[0];
    await steps[kind]?.(value, { cwd, update });
  }
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

const chunk = (sessionUpdate, text) => ({ sessionUpdate, content: { type: "text", text } });

const steps = {
  async think({ text, ms = 1500 }, { update }) {
    await stream(text, ms, (piece) => update(chunk("agent_thought_chunk", piece)));
  },

  async say({ text, ms = 1800 }, { update }) {
    await stream(text, ms, (piece) => update(chunk("agent_message_chunk", piece)));
  },

  // Runs for real; `ms` is the least time the row shows as running.
  async run({ command, reason, ms = 800 }, { cwd, update }) {
    const toolCallId = `call_${NodeCrypto.randomUUID()}`;
    update({
      sessionUpdate: "tool_call",
      toolCallId,
      kind: "execute",
      title: command,
      status: "in_progress",
      rawInput: reason ? { command, description: reason } : { command },
    });
    const [result] = await Promise.all([bash(command, cwd), NodeTimersPromises.setTimeout(ms)]);
    update({
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: result.code === 0 ? "completed" : "failed",
      content: [{ type: "content", content: { type: "text", text: result.output } }],
      rawOutput: { output: result.output, exitCode: result.code },
    });
  },

  async edit({ path, content, ms = 600 }, { cwd, update }) {
    const absolute = NodePath.isAbsolute(path) ? path : NodePath.join(cwd, path);
    const oldText = NodeFS.existsSync(absolute) ? NodeFS.readFileSync(absolute, "utf8") : null;
    const toolCallId = `call_${NodeCrypto.randomUUID()}`;
    update({
      sessionUpdate: "tool_call",
      toolCallId,
      kind: "edit",
      title: `Edit ${path}`,
      status: "in_progress",
      locations: [{ path: absolute }],
    });
    await NodeTimersPromises.setTimeout(ms);
    NodeFS.mkdirSync(NodePath.dirname(absolute), { recursive: true });
    NodeFS.writeFileSync(absolute, content);
    update({
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "completed",
      content: [{ type: "diff", path: absolute, oldText, newText: content }],
    });
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
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}
