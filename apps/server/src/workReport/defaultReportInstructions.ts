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

Find the moments where an agent struggled: a user corrected it, a command
failed again and again, it redid work, or it lacked information. A smooth
thread has nothing to teach. Skip it.

Before you suggest a change to a repository, read its AGENTS.md or CLAUDE.md,
its lint config, and its CI config. Do not suggest what already exists. If a
check exists but nothing runs it, suggest that something runs it.

Group by repository. Under each repository, put each suggestion under the fix
that matches the problem:

- \`### Navigation pointers\`: the agent took long to find a file or fact.
  Give the line to add to AGENTS.md.
- \`### Checks\`: a lint rule, type, test, hook, or CI job could have caught
  the mistake. Name the tool and the rule.
- \`### Review rules\`: a judgement call that no check can enforce. Write the
  rule for a code reviewer, not for AGENTS.md.
- \`### Access\`: the agent needed information it could not get.
- \`### Skills\`: a workflow that the threads repeated. Give its name, a
  one-line description, and its steps.
- \`### Deletions\`: AGENTS.md lines that the threads show do nothing.

If a repository has no pre-commit hook and no CI job that runs lint,
typecheck, and tests, report that first.

Each suggestion must cite the thread titles and turn indexes that show the
problem. Do not write a suggestion that you cannot cite. Sort by the number
of threads that show the problem, then by cost. An empty section is correct
when no thread shows a need.

Do not edit any repository other than this folder. The suggestions are for the
user to apply.
`;
