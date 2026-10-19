import * as Schema from "effect/Schema";

import { PositiveInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * What a listening process probably serves. The server guesses from the
 * process name and port, because a probe can crash a binary protocol
 * listener. Only a guessed HTTP server gets a request, which can make it
 * `https`. `tcp` means the guess found nothing.
 */
export const WorkspaceServerKind = Schema.Literals([
  "http",
  "https",
  "postgres",
  "mysql",
  "redis",
  "mongodb",
  "s3",
  "tcp",
]);
export type WorkspaceServerKind = typeof WorkspaceServerKind.Type;

/** Which network an address is on, so a client can tell if it can reach it. */
export const WorkspaceServerAddressScope = Schema.Literals(["loopback", "lan", "tailnet"]);
export type WorkspaceServerAddressScope = typeof WorkspaceServerAddressScope.Type;

export const WorkspaceServerAddress = Schema.Struct({
  scope: WorkspaceServerAddressScope,
  /** A URL for `http`, `https`, `s3`, and database kinds; `host:port` for `tcp`. */
  url: TrimmedNonEmptyString,
});
export type WorkspaceServerAddress = typeof WorkspaceServerAddress.Type;

/** A process listening on a port that runs in a thread's workspace. */
export const WorkspaceServer = Schema.Struct({
  port: PositiveInt.check(Schema.isLessThan(65536)),
  pid: PositiveInt,
  processName: Schema.NullOr(TrimmedNonEmptyString),
  /** The `<title>` of an HTTP server's root page, when it has one. */
  title: Schema.NullOr(TrimmedNonEmptyString),
  kind: WorkspaceServerKind,
  addresses: Schema.Array(WorkspaceServerAddress),
});
export type WorkspaceServer = typeof WorkspaceServer.Type;

export const WorkspaceServersInput = Schema.Struct({
  threadId: ThreadId,
  cwd: TrimmedNonEmptyString,
});
export type WorkspaceServersInput = typeof WorkspaceServersInput.Type;

export const WorkspaceServerList = Schema.Struct({
  servers: Schema.Array(WorkspaceServer),
  /** False when this host has no way to list processes, such as Windows. */
  supported: Schema.Boolean,
});
export type WorkspaceServerList = typeof WorkspaceServerList.Type;
