import type { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/utils";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

const EXPANDED_KEY = "t3code:thread-details:server-health-expanded";

type Level = "ok" | "warn" | "bad";

interface Metric {
  readonly label: string;
  readonly value: string;
  readonly level: Level;
  /** Shown in the collapsed header when present. */
  readonly summary?: string;
}

const LEVEL_CLASS: Record<Level, string> = {
  ok: "text-foreground/80",
  warn: "text-warning",
  bad: "text-destructive",
};

const level = (value: number, warn: number, bad: number): Level =>
  value >= bad ? "bad" : value >= warn ? "warn" : "ok";

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/**
 * Basic health of a remote server: connection latency and host load. Polls
 * while mounted, so a slow server can be told apart from a slow connection.
 */
export function ServerHealthSection(props: { readonly environmentId: EnvironmentId }) {
  const [expanded, setExpanded] = useLocalStorage(EXPANDED_KEY, false, Schema.Boolean);
  const query = useEnvironmentQuery(
    serverEnvironment.hostHealth({ environmentId: props.environmentId, input: {} }),
  );
  const health = query.data;
  const snapshot = health?.snapshot;

  const memoryUsed = snapshot ? 1 - snapshot.availableMemoryBytes / snapshot.totalMemoryBytes : 0;
  const metrics: Metric[] = health
    ? [
        {
          label: "Latency",
          summary: `${health.latencyMs} ms`,
          value: `${health.latencyMs} ms`,
          level: level(health.latencyMs, 150, 400),
        },
        snapshot?.cpuUtilization != null
          ? {
              label: "CPU",
              summary: `CPU ${percent(snapshot.cpuUtilization)}`,
              value: `${percent(snapshot.cpuUtilization)} of ${snapshot.cpuCount} cores`,
              level: level(snapshot.cpuUtilization, 0.7, 0.9),
            }
          : null,
        snapshot?.loadAverage1m !== undefined
          ? {
              label: "Load (1 min)",
              value: snapshot.loadAverage1m.toFixed(2),
              level: level(snapshot.loadAverage1m / Math.max(1, snapshot.cpuCount), 1, 2),
            }
          : null,
        snapshot && snapshot.totalMemoryBytes > 0
          ? {
              label: "Memory",
              summary: `Mem ${percent(memoryUsed)}`,
              value: `${formatBytes(snapshot.totalMemoryBytes - snapshot.availableMemoryBytes)} of ${formatBytes(snapshot.totalMemoryBytes)}`,
              level: level(memoryUsed, 0.8, 0.92),
            }
          : null,
        snapshot?.eventLoopUtilization !== undefined
          ? {
              label: "Server busy",
              value: percent(snapshot.eventLoopUtilization),
              level: level(snapshot.eventLoopUtilization, 0.5, 0.8),
            }
          : null,
        snapshot?.serverRssBytes !== undefined
          ? { label: "Server memory", value: formatBytes(snapshot.serverRssBytes), level: "ok" }
          : null,
      ].filter((metric): metric is Metric => metric !== null)
    : [];
  const worst = metrics.some((metric) => metric.level === "bad")
    ? "bad"
    : metrics.some((metric) => metric.level === "warn")
      ? "warn"
      : "ok";

  const summary = health
    ? metrics.flatMap((metric) => (metric.summary ? [metric.summary] : [])).join(" · ")
    : query.error
      ? "Unavailable"
      : "Checking…";

  return (
    <ThreadDetailsSection
      headingId="thread-details-server-health-heading"
      title="Server health"
      showHeading={false}
    >
      <CollapsibleSectionHeader
        variant="panel"
        expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        accessory={
          // Zero width keeps the summary out of the card's fit-content width; it
          // grows into the free space and truncates instead.
          <span
            className={cn(
              "w-0 grow-100 truncate text-end tabular-nums",
              query.error && !health ? "text-destructive" : LEVEL_CLASS[worst],
            )}
          >
            {summary}
          </span>
        }
      >
        Server
      </CollapsibleSectionHeader>
      {expanded ? (
        <dl className="flex flex-col gap-1 px-2.5 pt-1 text-xs">
          {query.error ? <p className="text-destructive">{query.error}</p> : null}
          {metrics.map((metric) => (
            <div key={metric.label} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{metric.label}</dt>
              <dd className={cn("tabular-nums", LEVEL_CLASS[metric.level])}>{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </ThreadDetailsSection>
  );
}
