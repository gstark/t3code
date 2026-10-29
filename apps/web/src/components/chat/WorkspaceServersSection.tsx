import type {
  EnvironmentId,
  ThreadId,
  WorkspaceServerAddress,
  WorkspaceServerKind,
} from "@t3tools/contracts";
import { connectionRoutes } from "@t3tools/client-runtime/connection";
import { CheckIcon, CopyIcon, GlobeIcon, GlobeLockIcon } from "lucide-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { reachableServerScopes } from "../../browser/browserTargetResolver";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { usePreparedConnection } from "../../state/session";
import { Badge } from "../ui/badge";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

const EXPANDED_KEY = "t3code:thread-details:workspace-servers-expanded";

const KIND_LABEL: Record<WorkspaceServerKind, string> = {
  http: "HTTP",
  https: "HTTPS",
  postgres: "Postgres",
  mysql: "MySQL",
  redis: "Redis",
  mongodb: "MongoDB",
  s3: "S3",
  tcp: "TCP",
};

/** Kinds a browser can open; the rest copy their URL for a client app. */
const OPENABLE_KINDS: ReadonlySet<WorkspaceServerKind> = new Set(["http", "https", "s3"]);

function ServerKind(props: { readonly kind: WorkspaceServerKind }) {
  const label = KIND_LABEL[props.kind];
  if (props.kind === "http" || props.kind === "https") {
    const Icon = props.kind === "https" ? GlobeLockIcon : GlobeIcon;
    return (
      <Icon role="img" aria-label={label} className="size-3.5 shrink-0 text-muted-foreground">
        <title>{label}</title>
      </Icon>
    );
  }
  return (
    <Badge variant="secondary" size="sm">
      {label}
    </Badge>
  );
}

function ServerAddress(props: {
  readonly kind: WorkspaceServerKind;
  readonly address: WorkspaceServerAddress;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "server address" });
  if (OPENABLE_KINDS.has(props.kind)) {
    return (
      <a
        href={props.address.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block truncate text-info-foreground hover:underline"
      >
        {props.address.url}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Copy ${props.address.url}`}
      onClick={() => copyToClipboard(props.address.url)}
      className="flex w-full min-w-0 items-center gap-1 text-start text-foreground/80 hover:text-foreground"
    >
      <span className="truncate">{props.address.url}</span>
      {isCopied ? (
        <CheckIcon className="size-3 shrink-0" />
      ) : (
        <CopyIcon className="size-3 shrink-0" />
      )}
    </button>
  );
}

/**
 * Servers that run in the thread's directory, with only the addresses this
 * client can reach. Hidden until the workspace has one.
 */
export function WorkspaceServersSection(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const [expanded, setExpanded] = useLocalStorage(EXPANDED_KEY, true, Schema.Boolean);
  const query = useEnvironmentQuery(
    serverEnvironment.workspaceServers({
      environmentId: props.environmentId,
      input: { threadId: props.threadId },
    }),
  );
  const connection = Option.getOrNull(usePreparedConnection(props.environmentId));
  const environment = useEnvironment(props.environmentId);
  const servers = query.data?.servers ?? [];
  if (servers.length === 0) return null;

  const target = connection?.target;
  // SSH connections reach T3 through a tunnel; the SSH host is how this
  // device reaches the machine itself.
  const sshHostname =
    target?._tag === "SshConnectionTarget" && environment
      ? (connectionRoutes(environment.entry).flatMap((route) => {
          const profile = Option.getOrNull(route.profile);
          return profile?._tag === "SshConnectionProfile" &&
            profile.connectionId === target.connectionId
            ? [profile.target.hostname]
            : [];
        })[0] ?? null)
      : null;
  const scopes = reachableServerScopes(
    connection,
    sshHostname,
    servers.flatMap((server) => server.addresses),
  );

  return (
    <ThreadDetailsSection
      headingId="thread-details-workspace-servers-heading"
      title="Servers"
      showHeading={false}
    >
      <CollapsibleSectionHeader
        variant="panel"
        expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        accessory={
          <span className="w-0 grow-100 truncate text-end text-muted-foreground tabular-nums">
            {servers.map((server) => `:${server.port}`).join(" ")}
          </span>
        }
      >
        Servers
      </CollapsibleSectionHeader>
      {expanded ? (
        <ul className="flex flex-col gap-2 px-2.5 pt-1 text-xs">
          {servers.map((server) => {
            const addresses = server.addresses.filter((address) => scopes.has(address.scope));
            return (
              <li key={`${server.pid}:${server.port}`} className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <ServerKind kind={server.kind} />
                  <span className="truncate text-foreground/80">
                    {server.title ?? server.processName ?? `PID ${server.pid}`}
                  </span>
                  {server.title && server.processName ? (
                    <span className="shrink-0 text-foreground/64">({server.processName})</span>
                  ) : null}
                  <span className="ms-auto text-muted-foreground tabular-nums">:{server.port}</span>
                </div>
                {addresses.length > 0 ? (
                  addresses.map((address) => (
                    <ServerAddress key={address.url} kind={server.kind} address={address} />
                  ))
                ) : (
                  <p className="text-muted-foreground">Not reachable from this device</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </ThreadDetailsSection>
  );
}
