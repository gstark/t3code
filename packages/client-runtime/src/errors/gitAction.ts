import { GitCommandError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isGitCommandError = Schema.is(GitCommandError);

/**
 * The text to show a user when a Git action fails. A GitCommandError's message names the
 * internal operation and working directory, which helps logs but not people, so show
 * its detail instead.
 */
export function describeGitActionError(error: unknown, fallback: string): string {
  if (isGitCommandError(error)) return error.detail;
  return error instanceof Error ? error.message : fallback;
}
