import * as NodeOS from "node:os";
import * as NodePerfHooks from "node:perf_hooks";
import type { HostResourcesSnapshot } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class HostResources extends Context.Service<
  HostResources,
  { readonly read: Effect.Effect<HostResourcesSnapshot> }
>()("t3/resourceTelemetry/HostResources") {}

function readCpu() {
  const cpus = NodeOS.cpus();
  const cpu = cpus.reduce(
    (sum, { times }) => ({
      idle: sum.idle + times.idle,
      total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq,
    }),
    { idle: 0, total: 0 },
  );
  return { ...cpu, count: cpus.length };
}

const PREVIOUS_SAMPLE_MAX_AGE_MS = 30_000;

function darwinAvailableMemory(output: string): number | null {
  const pageSize = /page size of (\d+) bytes/.exec(output)?.[1];
  const free = /^Pages free:\s+(\d+)\./m.exec(output)?.[1];
  const inactive = /^Pages inactive:\s+(\d+)\./m.exec(output)?.[1];
  const speculative = /^Pages speculative:\s+(\d+)\./m.exec(output)?.[1];
  if (!pageSize || !free || !inactive || !speculative) return null;
  // vm_stat excludes speculative from free; add it once, without overlapping purgeable pages.
  const available = (Number(free) + Number(inactive) + Number(speculative)) * Number(pageSize);
  return Number.isSafeInteger(available) && Number(pageSize) > 0 ? available : null;
}

const make = Effect.fn("makeHostResources")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  // CPU counters and event loop utilization need two readings. A recent
  // previous sample is the first reading, so polling clients get an average
  // over their poll interval and a fast reply. Idle servers do no polling.
  let previous: {
    readonly at: number;
    readonly cpu: ReturnType<typeof readCpu>;
    readonly elu: NodePerfHooks.EventLoopUtilization;
  } | null = null;

  const sample = Effect.fn("HostResources.sample")(function* () {
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    if (previous === null || now - previous.at > PREVIOUS_SAMPLE_MAX_AGE_MS) {
      previous = {
        at: now,
        cpu: readCpu(),
        elu: NodePerfHooks.performance.eventLoopUtilization(),
      };
      yield* Effect.sleep("200 millis");
    }
    const previousCpu = previous.cpu;
    const cpu = readCpu();
    const elu = NodePerfHooks.performance.eventLoopUtilization();
    const eventLoopUtilization = NodePerfHooks.performance.eventLoopUtilization(
      elu,
      previous.elu,
    ).utilization;
    const sampledAt = DateTime.toEpochMillis(yield* DateTime.now);
    previous = { at: sampledAt, cpu, elu };
    const totalDelta = cpu.total - previousCpu.total;
    const idleDelta = cpu.idle - previousCpu.idle;
    const cpuUtilization =
      previousCpu.count === cpu.count && totalDelta > 0 && idleDelta >= 0
        ? Math.min(1, Math.max(0, 1 - idleDelta / totalDelta))
        : null;
    const totalMemoryBytes = NodeOS.totalmem();
    // On Windows libuv returns GlobalMemoryStatusEx.ullAvailPhys, including standby memory.
    let availableMemoryBytes = NodeOS.freemem();
    if (platform === "linux") {
      const meminfo = yield* fs
        .readFileString("/proc/meminfo")
        .pipe(Effect.orElseSucceed(() => ""));
      const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
      if (available) availableMemoryBytes = Number(available) * 1024;
    } else if (platform === "darwin") {
      const output = yield* spawner
        .string(ChildProcess.make("/usr/bin/vm_stat", [], { stdin: "ignore", stderr: "ignore" }))
        .pipe(
          Effect.timeout("1 second"),
          Effect.orElseSucceed(() => ""),
        );
      availableMemoryBytes = darwinAvailableMemory(output) ?? availableMemoryBytes;
    }
    return {
      sampledAt,
      cpuUtilization,
      cpuCount: cpu.count,
      availableMemoryBytes: Math.min(totalMemoryBytes, Math.max(0, availableMemoryBytes)),
      totalMemoryBytes,
      ...(platform === "win32" ? {} : { loadAverage1m: NodeOS.loadavg()[0] ?? 0 }),
      eventLoopUtilization: Math.min(1, Math.max(0, eventLoopUtilization)),
      serverRssBytes: process.memoryUsage.rss(),
    };
  });

  const cache = yield* Cache.make({
    capacity: 1,
    lookup: (_key: "host") => sample(),
    timeToLive: "5 seconds",
  });
  return HostResources.of({ read: Cache.get(cache, "host") });
});

export const layer = Layer.effect(HostResources, make());
