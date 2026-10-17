/**
 * WorkspaceServers - processes listening on a port that run in a thread's
 * workspace, with the addresses that reach them.
 *
 * A process belongs to a thread when its working directory is inside the
 * thread's directory, or when it runs in one of the thread's T3 terminals.
 * Listeners come from `lsof` on macOS and `ss` on Linux. The service never
 * connects to a listener: the kind is a guess from the process name and port,
 * because a probe can crash a binary protocol server.
 *
 * Clients poll this while the thread details panel shows it. One short cache
 * shares each scan between all clients and threads.
 */
import * as NodeOS from "node:os";
import type {
  WorkspaceServer,
  WorkspaceServerAddress,
  WorkspaceServerKind,
  WorkspaceServerList,
  WorkspaceServersInput,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { readTailscaleStatus } from "@t3tools/tailscale";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { resolveBoundEndpoints } from "../environment/DirectEndpoints.ts";
import * as PortScanner from "../preview/PortScanner.ts";
import * as ProcessRunner from "../processRunner.ts";

export class WorkspaceServers extends Context.Service<
  WorkspaceServers,
  {
    readonly list: (input: WorkspaceServersInput) => Effect.Effect<WorkspaceServerList>;
  }
>()("t3/workspaceServers/WorkspaceServers") {}

export interface Listener {
  readonly pid: number;
  readonly processName: string | null;
  /** Bind address without brackets or zone; `*` is the wildcard. */
  readonly host: string;
  readonly port: number;
}

/** The host addresses other machines can use, grouped by network. */
export interface HostNetwork {
  readonly lan: ReadonlyArray<string>;
  readonly tailnet: ReadonlyArray<string>;
  readonly magicDnsName: string | null;
}

const COMMAND_TIMEOUT = Duration.seconds(5);
const MAX_OUTPUT_BYTES = 1024 * 1024;

const parsePort = (raw: string): number | null => {
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
};

/** Splits `host:port`, `[v6]:port`, and `host%iface:port` into host and port. */
const splitHostPort = (raw: string): { host: string; port: number } | null => {
  const lastColon = raw.lastIndexOf(":");
  if (lastColon < 0) return null;
  const port = parsePort(raw.slice(lastColon + 1));
  if (port === null) return null;
  const host = raw
    .slice(0, lastColon)
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "");
  return host.length === 0 ? null : { host, port };
};

/** Parses `lsof -iTCP -sTCP:LISTEN -P -n -F pcn`. */
export const parseLsofListeners = (raw: string): ReadonlyArray<Listener> => {
  const listeners: Listener[] = [];
  let pid: number | null = null;
  let processName: string | null = null;
  for (const line of raw.split("\n")) {
    const value = line.slice(1);
    switch (line.charAt(0)) {
      case "p":
        pid = Number.parseInt(value, 10) || null;
        processName = null;
        break;
      case "c":
        processName = value.trim() || null;
        break;
      case "n": {
        const address = splitHostPort(value.split(" ", 1)[0] ?? "");
        if (pid !== null && address) listeners.push({ pid, processName, ...address });
        break;
      }
    }
  }
  return listeners;
};

/** Parses `ss -H -ltnp`. Only the current user's processes carry a pid. */
export const parseSsListeners = (raw: string): ReadonlyArray<Listener> =>
  raw.split("\n").flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    const address = splitHostPort(fields[3] ?? "");
    if (!address) return [];
    return [...line.matchAll(/\("([^"]*)",pid=(\d+)/g)].map((match) => ({
      pid: Number(match[2]),
      processName: match[1] || null,
      ...address,
    }));
  });

/** Parses `lsof -a -d cwd -p <pids> -F n` into working directories by pid. */
export const parseLsofCwds = (raw: string): ReadonlyMap<number, string> => {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("p")) pid = Number.parseInt(line.slice(1), 10) || null;
    else if (line.startsWith("n") && pid !== null) cwds.set(pid, line.slice(1));
  }
  return cwds;
};

/** POSIX only: process directories come from `lsof` and `/proc`, which never run on Windows. */
export const isInsideDirectory = (path: string, root: string): boolean => {
  const base = root.replace(/\/+$/, "");
  return path === base || path.startsWith(`${base}/`);
};

const DATABASE_PROCESSES: ReadonlyArray<readonly [RegExp, WorkspaceServerKind]> = [
  [/^postgres/, "postgres"],
  [/^(mysqld|mariadbd)/, "mysql"],
  [/^(redis-server|valkey-server)/, "redis"],
  [/^mongod$/, "mongodb"],
  [/^(minio|rustfs|localstack|s3rver)/, "s3"],
];

const DATABASE_PORTS: ReadonlyMap<number, WorkspaceServerKind> = new Map([
  [5432, "postgres"],
  [3306, "mysql"],
  [6379, "redis"],
  [27017, "mongodb"],
]);

/** Runtimes and servers that almost always listen with HTTP in development. */
const HTTP_PROCESS =
  /^(node|bun|deno|ruby|puma|rails|python[\d.]*|php|uvicorn|gunicorn|next-server|vite|nginx|caddy|httpd|hugo|java|dotnet|beam\.smp)\b/i;

export const classifyServer = (processName: string | null, port: number): WorkspaceServerKind => {
  const name = processName ?? "";
  const database = DATABASE_PROCESSES.find(([pattern]) => pattern.test(name))?.[1];
  if (database) return database;
  const byPort = DATABASE_PORTS.get(port);
  if (byPort) return byPort;
  return HTTP_PROCESS.test(name) ? "http" : "tcp";
};

const isLoopback = (host: string) =>
  host === "localhost" || host === "::1" || host.startsWith("127.");
const isWildcard = (host: string) => host === "*" || host === "0.0.0.0" || host === "::";

const URL_SCHEME: Record<WorkspaceServerKind, string | null> = {
  http: "http",
  s3: "http",
  postgres: "postgres",
  mysql: "mysql",
  redis: "redis",
  mongodb: "mongodb",
  tcp: null,
};

/** The addresses that reach a server bound to `hosts`, loopback first. */
export const buildAddresses = (input: {
  readonly kind: WorkspaceServerKind;
  readonly port: number;
  readonly hosts: ReadonlyArray<string>;
  readonly network: HostNetwork;
}): ReadonlyArray<WorkspaceServerAddress> => {
  const scheme = URL_SCHEME[input.kind];
  const format = (host: string) => {
    const authority = `${host.includes(":") ? `[${host}]` : host}:${input.port}`;
    return scheme === null ? authority : `${scheme}://${authority}`;
  };
  const addresses = new Map<string, WorkspaceServerAddress>();
  const add = (scope: WorkspaceServerAddress["scope"], host: string) => {
    const url = format(host);
    if (!addresses.has(url)) addresses.set(url, { scope, url });
  };
  const wildcard = input.hosts.some(isWildcard);
  if (wildcard || input.hosts.some(isLoopback)) add("loopback", "localhost");
  const bound = (host: string) => wildcard || input.hosts.includes(host);
  for (const host of input.network.lan) if (bound(host)) add("lan", host);
  const tailnet = input.network.tailnet.filter(bound);
  if (tailnet.length > 0 && input.network.magicDnsName) add("tailnet", input.network.magicDnsName);
  for (const host of tailnet) add("tailnet", host);
  return [...addresses.values()];
};

/** Groups listeners into one server per process and port. */
export const toWorkspaceServers = (
  listeners: ReadonlyArray<Listener>,
  network: HostNetwork,
): ReadonlyArray<WorkspaceServer> => {
  const groups = new Map<string, { listener: Listener; hosts: string[] }>();
  for (const listener of listeners) {
    const key = `${listener.pid}:${listener.port}`;
    const group = groups.get(key);
    if (group) group.hosts.push(listener.host);
    else groups.set(key, { listener, hosts: [listener.host] });
  }
  return [...groups.values()]
    .map(({ listener, hosts }) => {
      const kind = classifyServer(listener.processName, listener.port);
      return {
        port: listener.port,
        pid: listener.pid,
        processName: listener.processName,
        kind,
        addresses: buildAddresses({ kind, port: listener.port, hosts, network }),
      };
    })
    .toSorted((left, right) => left.port - right.port || left.pid - right.pid);
};

interface ProcessInfo {
  readonly cwd: string | null;
  readonly name: string | null;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const portDiscovery = yield* PortScanner.PortDiscovery;

  const run = (command: string, args: ReadonlyArray<string>) =>
    processRunner
      .run({ command, args, timeout: COMMAND_TIMEOUT, maxOutputBytes: MAX_OUTPUT_BYTES })
      .pipe(
        Effect.map((result) => result.stdout),
        Effect.catch((cause) =>
          Effect.logDebug("workspace server scan command failed", { command, cause }).pipe(
            Effect.as(""),
          ),
        ),
      );

  const readListeners =
    platform === "darwin"
      ? run("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "+c", "0", "-F", "pcn"]).pipe(
          Effect.map(parseLsofListeners),
        )
      : run("ss", ["-H", "-ltnp"]).pipe(Effect.map(parseSsListeners));

  // Linux reports the thread name (Node shows `MainThread`), so the name of
  // the executable replaces it there.
  const readProcesses = (pids: ReadonlyArray<number>) =>
    pids.length === 0
      ? Effect.succeed(new Map<number, ProcessInfo>())
      : platform === "darwin"
        ? run("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-F", "n"]).pipe(
            Effect.map(
              (raw) =>
                new Map(
                  [...parseLsofCwds(raw)].map(([pid, cwd]) => [pid, { cwd, name: null }] as const),
                ),
            ),
          )
        : Effect.forEach(
            pids,
            (pid) =>
              Effect.all({
                cwd: fileSystem.readLink(`/proc/${pid}/cwd`).pipe(Effect.orElseSucceed(() => null)),
                name: fileSystem.readLink(`/proc/${pid}/exe`).pipe(
                  Effect.map(
                    (exe) =>
                      exe
                        .split("/")
                        .at(-1)
                        ?.replace(/ \(deleted\)$/, "") || null,
                  ),
                  Effect.orElseSucceed(() => null),
                ),
              }).pipe(Effect.map((info) => [pid, info] as const)),
            { concurrency: 16 },
          ).pipe(Effect.map((entries) => new Map(entries)));

  const snapshotCache = yield* Cache.make({
    capacity: 1,
    timeToLive: "2 seconds",
    lookup: (_key: "host") =>
      Effect.gen(function* () {
        // The T3 server is the host, not a server the workspace runs.
        const found = (yield* readListeners).filter((listener) => listener.pid !== process.pid);
        const processes = yield* readProcesses([...new Set(found.map((listener) => listener.pid))]);
        const listeners = found.map((listener) => ({
          ...listener,
          processName: processes.get(listener.pid)?.name ?? listener.processName,
        }));
        return { listeners, processes };
      }),
  });

  const networkCache = yield* Cache.make({
    capacity: 1,
    timeToLive: "30 seconds",
    lookup: (_key: "host") =>
      Effect.gen(function* () {
        const endpoints = resolveBoundEndpoints({
          host: "0.0.0.0",
          port: 1,
          interfaces: NodeOS.networkInterfaces(),
        });
        const hostsOf = (kind: "lan" | "tailnet") =>
          endpoints
            .filter((endpoint) => endpoint.kind === kind)
            .map((endpoint) => new URL(endpoint.httpBaseUrl).hostname);
        const tailnet = hostsOf("tailnet");
        const magicDnsName =
          tailnet.length === 0
            ? null
            : yield* readTailscaleStatus.pipe(
                Effect.map((status) => status.magicDnsName),
                Effect.timeoutOption(Duration.seconds(3)),
                Effect.map(Option.getOrNull),
                Effect.orElseSucceed(() => null),
                Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
                Effect.provideService(HostProcess.Platform, platform),
              );
        return { lan: hostsOf("lan"), tailnet, magicDnsName } satisfies HostNetwork;
      }),
  });

  const list: WorkspaceServers["Service"]["list"] = Effect.fn("WorkspaceServers.list")(
    function* (input) {
      if (platform === "win32") return { servers: [], supported: false };
      const { listeners, processes } = yield* Cache.get(snapshotCache, "host");
      const terminalPids = yield* portDiscovery.threadTerminalProcessIds(input.threadId);
      const owned = listeners.filter((listener) => {
        if (terminalPids.has(listener.pid)) return true;
        const cwd = processes.get(listener.pid)?.cwd;
        return cwd != null && isInsideDirectory(cwd, input.cwd);
      });
      if (owned.length === 0) return { servers: [], supported: true };
      const network = yield* Cache.get(networkCache, "host");
      return { servers: toWorkspaceServers(owned, network), supported: true };
    },
  );

  return WorkspaceServers.of({ list });
});

export const layer = Layer.effect(WorkspaceServers, make);
