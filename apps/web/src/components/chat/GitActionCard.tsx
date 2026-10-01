import type { GitActionActivityPayload } from "@t3tools/contracts";
import {
  ChevronRightIcon,
  CloudUploadIcon,
  GitBranchPlusIcon,
  GitCommitIcon,
  Trash2Icon,
} from "lucide-react";
import { type MouseEvent, type ReactNode, useState } from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { cn } from "~/lib/utils";

/**
 * Timeline record of a commit, push, pull request, or land made from the git
 * controls. Collapsed it shows the action's summary; expanded it lists each
 * step the action took.
 */
export function GitActionCard(props: {
  label: string;
  gitAction: GitActionActivityPayload;
  onOpenPr: (event: MouseEvent<HTMLElement>, url: string) => void;
}) {
  const { label, gitAction, onOpenPr } = props;
  const [expanded, setExpanded] = useState(false);
  const { branch, commit, push, pr, land } = gitAction;
  const merged = land?.fromSha && land.toSha ? { fromSha: land.fromSha, toSha: land.toSha } : null;
  const Icon = merged
    ? PullRequestGlyph.merged
    : land
      ? Trash2Icon
      : pr.status !== "skipped_not_requested"
        ? PullRequestGlyph.pullRequest
        : push.status === "pushed"
          ? CloudUploadIcon
          : GitCommitIcon;

  return (
    <div className="mt-2 rounded-lg bg-secondary dark:bg-input/20">
      <button
        type="button"
        aria-expanded={expanded}
        data-scroll-anchor-ignore
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-foreground"
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRightIcon
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 text-muted-foreground", expanded && "rotate-90")}
        />
      </button>
      {expanded ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-3 pb-3 text-xs">
          {branch.status === "created" && branch.name ? (
            <GitActionStep icon={<GitBranchPlusIcon />} term="Branch">
              Created <Code>{branch.name}</Code>
            </GitActionStep>
          ) : null}
          {commit.status === "created" ? (
            <GitActionStep icon={<GitCommitIcon />} term="Commit">
              {commit.commitSha ? <Code>{commit.commitSha.slice(0, 7)}</Code> : null}{" "}
              {commit.subject}
            </GitActionStep>
          ) : null}
          {land && merged ? (
            <GitActionStep icon={<PullRequestGlyph.merged />} term="Merge">
              <Code>{land.branch}</Code> into <Code>{land.baseBranch}</Code>
            </GitActionStep>
          ) : null}
          {push.status === "pushed" ? (
            <GitActionStep icon={<CloudUploadIcon />} term="Push">
              {push.branch ? <Code>{push.branch}</Code> : "Branch"}
              {push.upstreamBranch ? (
                <>
                  {" "}
                  to <Code>{push.upstreamBranch}</Code>
                </>
              ) : null}
              {push.setUpstream ? " (set upstream)" : null}
              {merged ? (
                <>
                  {" "}
                  <Code>
                    {merged.fromSha.slice(0, 7)}..{merged.toSha.slice(0, 7)}
                  </Code>
                </>
              ) : null}
            </GitActionStep>
          ) : null}
          {land ? (
            <GitActionStep icon={<Trash2Icon />} term="Cleanup">
              Removed worktree <Code>{land.removedWorktreePath}</Code> and branch{" "}
              <Code>{land.branch}</Code>
            </GitActionStep>
          ) : null}
          {pr.status !== "skipped_not_requested" ? (
            <GitActionStep
              icon={<PullRequestGlyph.pullRequest />}
              term={pr.status === "created" ? "Created" : "Opened"}
            >
              {pr.url ? (
                <a
                  href={pr.url}
                  className="underline-offset-2 hover:underline"
                  onClick={(event) => onOpenPr(event, event.currentTarget.href)}
                >
                  {pr.number ? `#${pr.number}` : null} {pr.title}
                </a>
              ) : (
                <>
                  {pr.number ? `#${pr.number}` : null} {pr.title}
                </>
              )}
              {pr.headBranch && pr.baseBranch ? (
                <span className="text-muted-foreground">
                  {" "}
                  <Code>{pr.headBranch}</Code> into <Code>{pr.baseBranch}</Code>
                </span>
              ) : null}
            </GitActionStep>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

function GitActionStep(props: { icon: ReactNode; term: string; children: ReactNode }) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-muted-foreground [&_svg]:size-3">
        {props.icon}
        {props.term}
      </dt>
      <dd className="min-w-0 break-words text-foreground">{props.children}</dd>
    </>
  );
}

function Code(props: { children: ReactNode }) {
  return <code className="font-mono">{props.children}</code>;
}
