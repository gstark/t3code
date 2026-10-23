import type { AgentScript } from "./agent-script.ts";
import type { Scenario } from "./environment.ts";

// A small notes app that the walkthroughs change. Plain JavaScript, so the
// agent's `node --test` runs for real with nothing to install.
export const notesProject: Scenario["project"] = {
  title: "Notes",
  folder: "notes",
  commits: [
    {
      message: "Start the notes app",
      files: {
        "README.md": "# Notes\n\nA tiny notes app for the terminal.\n",
        "package.json": `${JSON.stringify(
          { name: "notes", private: true, type: "module", scripts: { test: "node --test" } },
          null,
          2,
        )}\n`,
        "src/notes.js": [
          'export function createNote(title, body = "") {',
          "  return { title, body, createdAt: new Date() };",
          "}",
          "",
        ].join("\n"),
        "src/footer.js": [
          "export function footer(note) {",
          "  return `Created ${note.createdAt.toLocaleDateString()}`;",
          "}",
          "",
        ].join("\n"),
        "test/footer.test.js": [
          'import { test } from "node:test";',
          'import assert from "node:assert/strict";',
          'import { footer } from "../src/footer.js";',
          "",
          'test("footer shows the date", () => {',
          '  const note = { title: "a", body: "", createdAt: new Date(2026, 9, 1) };',
          "  assert.match(footer(note), /^Created /);",
          "});",
          "",
        ].join("\n"),
      },
    },
    {
      message: "Add a justfile",
      files: {
        justfile: ["# Run the tests", "test:", "    npm test", ""].join("\n"),
      },
    },
  ],
};

// The word count change in the note footer, with a test.
export const wordCountFooter = [
  "export function footer(note) {",
  "  const words = note.body.split(/\\s+/).filter(Boolean).length;",
  "  return `Created ${note.createdAt.toLocaleDateString()} · ${words} words`;",
  "}",
  "",
].join("\n");

const wordCountTest = [
  'import { test } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { footer } from "../src/footer.js";',
  "",
  'test("footer shows the date", () => {',
  '  const note = { title: "a", body: "", createdAt: new Date(2026, 9, 1) };',
  "  assert.match(footer(note), /^Created /);",
  "});",
  "",
  'test("footer counts the words", () => {',
  '  const note = { title: "a", body: "one two  three", createdAt: new Date() };',
  "  assert.match(footer(note), /3 words$/);",
  "});",
  "",
].join("\n");

// One turn that adds the word count and ends with "both tests pass".
export const wordCountAgent: AgentScript = {
  execMs: 1500,
  exec: {
    subject: "Show a word count in the note footer",
    body: "",
    title: "Word count in the footer",
    branch: "word-count",
  },
  turns: [
    {
      steps: [
        { think: { text: "Find where the footer is built.", ms: 1200 } },
        { run: { command: "grep -rn footer src test", ms: 700 } },
        { edit: { path: "src/footer.js", content: wordCountFooter } },
        { edit: { path: "test/footer.test.js", content: wordCountTest } },
        { run: { command: "node --test", ms: 1200 } },
        {
          say: {
            text: "The footer now shows the word count after the date. I added a test for it, and both tests pass.",
            ms: 2200,
          },
        },
      ],
    },
  ],
};
