/**
 * The AGENTS.md the work report writes into the reports folder when the file
 * does not exist. After that the user owns it, so report format changes need
 * no code change.
 */
export const DEFAULT_REPORT_INSTRUCTIONS = `# Work report

This folder holds work reports. A T3 Code report thread runs here. Its first
message names the time window to cover.

## Tools

The \`t3-code\` MCP server gives you these tools. They work only in a report
thread of this folder.

- \`list_settled_threads\`: the threads that settled in the window of this run.
- \`get_thread_digest\`: one thread's turns, with user messages, final
  assistant messages, changed files, and failed commands. Follow
  \`nextCursor\` until it is null.
- \`complete_work_report\`: marks the window as reported. Call it once, after
  you write every file.

## Steps

1. Call \`list_settled_threads\`.
2. Read \`clients.md\`. If it does not exist, create it.
3. Find each thread's client from its \`workspaceRoot\` or \`repository\`. For
   each project that \`clients.md\` does not list, ask the user which client
   owns it, or if it is personal work. Ask about all unknown projects in one
   message. Record the answers in \`clients.md\` before you continue.
4. Read the digest of each thread. Read them one at a time. If you can run
   subagents, give each subagent a group of threads and ask for notes.
5. Write the files below.
6. Call \`complete_work_report\`.
7. Reply with a short summary and the paths of the files you wrote.

## clients.md format

\`\`\`markdown
## Acme Corp

- Contact: Jane Doe <jane@acme.example>
- /Users/me/dev/acme-web
- github.com/acme/api

## Personal

- /Users/me/dev/side-project
\`\`\`

## Files to write

Use the date of the window end as \`YYYY-MM-DD\`.

### reports/YYYY-MM-DD/<client-slug>.md

Write one file for each client with work in the window. Do not write one for
personal work.

- \`## Executive summary\`: an email the user can send to the client. Use plain
  language. Describe outcomes, not mechanics. Do not name internal files,
  tools, agents, or threads. Keep it under 250 words.
- \`## Technical summary\`: new approaches, solutions, and decisions, with the
  reason for each decision. Name the repository for each item.

### reports/YYYY-MM-DD/personal.md

Write the technical summary for personal work, if there was any.

### reports/YYYY-MM-DD/suggestions.md

Group by repository. Under each repository:

- \`### AGENTS.md entries\`: rules an agent would have needed to avoid
  mistakes or wasted turns in these threads. Write each one in the words it
  would have in AGENTS.md.
- \`### Skills\`: workflows that the threads repeated and that a skill could
  hold. Give each a name, a one-line description, and its steps.
- \`### Lint rules\`: rules that would have caught rework or failures in these
  threads. Name the linter and the rule, or describe a custom rule. Each lint
  rule must cite the thread title and the failure behind it. Do not suggest
  generic rules that no thread shows a need for.

Do not edit any repository other than this folder. The suggestions are for the
user to apply.
`;
