// Keeps a walkthrough environment running to explore new steps:
//   node walkthroughs/support/explore.ts [scenario.json]
// More pairing URLs: `node apps/server/src/bin.ts auth pairing create --base-dir <home>`.
// Ctrl+C stops the server and removes the root folder.
import * as NodeFS from "node:fs";

import { notesProject } from "./demo-repo.ts";
import { type Scenario, startEnvironment } from "./environment.ts";

const file = process.argv[2];
const scenario: Scenario = file
  ? JSON.parse(NodeFS.readFileSync(file, "utf8"))
  : {
      project: notesProject,
      agent: {
        exec: { subject: "Show a word count", body: "", title: "Word count", branch: "word-count" },
        turns: [
          {
            steps: [
              { think: { text: "Find the footer.", ms: 500 } },
              { run: { command: "grep -rn footer src", ms: 300 } },
              {
                edit: {
                  path: "src/footer.js",
                  content:
                    "export function footer(note) {\n  return `Created ${note.createdAt.toLocaleDateString()} · ${note.body.split(/\\s+/).filter(Boolean).length} words`;\n}\n",
                },
              },
              { say: { text: "Done." } },
            ],
          },
        ],
      },
    };

const environment = await startEnvironment(scenario);
console.log(`home: ${environment.home}`);
console.log(`workspace: ${environment.workspace}`);
console.log(`pairingUrl: ${environment.pairingUrl}`);

process.once("SIGINT", () => {
  void environment.stop().then(() => process.exit(0));
});
