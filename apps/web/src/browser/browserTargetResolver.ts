import type {
  BrowserNavigationTarget,
  EnvironmentId,
  PreviewUrlResolution,
  WorkspaceServerAddress,
  WorkspaceServerAddressScope,
} from "@t3tools/contracts";
import { isLoopbackHost, normalizePreviewUrl } from "@t3tools/shared/preview";
import {
  isLocalLoopbackHost,
  isPrivateNetworkHost,
  isSharedAddressSpaceHost,
  isTailnetHost,
} from "@t3tools/shared/hostClassification";

import type { ConnectionTarget, PreparedConnection } from "@t3tools/client-runtime/connection";

import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import { isElectron } from "~/env";
import { readPreparedConnection } from "~/state/session";

export {
  normalizeHostname,
  isLocalLoopbackHost,
  isPrivateNetworkHost,
  isPublicFaviconHost,
} from "@t3tools/shared/hostClassification";

const readEnvironmentUrl = (environmentId: EnvironmentId): URL => {
  const connection = readPreparedConnection(environmentId);
  if (!connection) throw new Error(`Environment ${environmentId} is not connected.`);
  return new URL(connection.httpBaseUrl);
};

const resolveEnvironmentPortTarget = (
  environmentId: EnvironmentId,
  target: Extract<BrowserNavigationTarget, { readonly kind: "environment-port" }>,
  environmentUrl: URL,
  requestedUrl?: string,
  sourceUrl?: URL,
): PreviewUrlResolution => {
  if (!isPrivateNetworkHost(environmentUrl.hostname)) {
    throw new Error(
      "This environment port needs the planned authenticated preview gateway; its server address is not directly private-network reachable.",
    );
  }
  const protocol = target.protocol ?? "http";
  const path = target.path?.startsWith("/") ? target.path : `/${target.path ?? ""}`;
  const normalizedEnvironmentHost = environmentUrl.hostname.replace(/^\[|\]$/g, "");
  // Local loopback environments should advertise `localhost` so Chromium
  // dual-stack lookup can reach a Vite server bound only to ::1 or 127.0.0.1.
  const resolvedHost = isLocalLoopbackHost(normalizedEnvironmentHost)
    ? "localhost"
    : normalizedEnvironmentHost.includes(":")
      ? `[${normalizedEnvironmentHost}]`
      : normalizedEnvironmentHost;
  const resolved = sourceUrl
    ? new URL(sourceUrl)
    : new URL(path, `${protocol}://${resolvedHost}:${target.port}`);
  if (sourceUrl) {
    resolved.hostname = resolvedHost;
    resolved.port = String(target.port);
  }
  return {
    requestedUrl: requestedUrl ?? `${protocol}://localhost:${target.port}${path}`,
    resolvedUrl: resolved.toString(),
    resolutionKind: isLocalLoopbackHost(normalizedEnvironmentHost)
      ? "direct"
      : "direct-private-network",
    environmentId,
  };
};

export function resolveBrowserNavigationTarget(
  environmentId: EnvironmentId,
  target: BrowserNavigationTarget,
): PreviewUrlResolution {
  if (target.kind === "url") {
    return {
      requestedUrl: target.url,
      resolvedUrl: target.url,
      resolutionKind: "direct",
      environmentId,
    };
  }
  return resolveEnvironmentPortTarget(environmentId, target, readEnvironmentUrl(environmentId));
}

/**
 * Whether a discovered loopback server is reachable as-is from this client's
 * own browser tabs. The desktop app draws tabs on the machine that runs its
 * primary backend and any desktop-local backend (WSL). Its connection URL can
 * still be a LAN address (WSL NAT mode binds the distro IP), but a dev server
 * bound to loopback only answers on `localhost` there.
 */
const reachesEnvironmentLoopback = (target: ConnectionTarget): boolean =>
  isElectron &&
  (target._tag === "PrimaryConnectionTarget" || isDesktopLocalConnectionTarget(target));

const ALL_SCOPES: ReadonlySet<WorkspaceServerAddressScope> = new Set([
  "loopback",
  "lan",
  "tailnet",
]);
const NO_SCOPES: ReadonlySet<WorkspaceServerAddressScope> = new Set();

const addressHost = (url: string): string | null => {
  try {
    return new URL(url.includes("://") ? url : `tcp://${url}`).hostname;
  } catch {
    return null;
  }
};

/**
 * The networks this client can use to reach other servers on the
 * environment's host, judged by the host name the client uses to reach the
 * environment itself: the SSH host for SSH, else the connection URL host.
 * When that name is one of the host's own addresses, or the short form of
 * its MagicDNS name, the client is on that address's network. T3 Connect
 * tunnels only to T3, so it reaches nothing else.
 */
export function reachableServerScopes(
  connection: Pick<PreparedConnection, "httpBaseUrl" | "target"> | null,
  sshHostname: string | null,
  addresses: ReadonlyArray<WorkspaceServerAddress>,
): ReadonlySet<WorkspaceServerAddressScope> {
  if (connection === null) return NO_SCOPES;
  if (reachesEnvironmentLoopback(connection.target)) return ALL_SCOPES;
  if (connection.target._tag === "RelayConnectionTarget") return NO_SCOPES;
  const routeHost =
    connection.target._tag === "SshConnectionTarget"
      ? sshHostname?.toLowerCase()
      : addressHost(connection.httpBaseUrl);
  if (!routeHost) return NO_SCOPES;
  if (isLocalLoopbackHost(routeHost)) return ALL_SCOPES;
  const matched = new Set(
    addresses
      .filter((address) => {
        const host = addressHost(address.url);
        return host === routeHost || host?.startsWith(`${routeHost}.`);
      })
      .map((address) => address.scope),
  );
  if (matched.size > 0) return matched;
  if (isTailnetHost(routeHost) || isSharedAddressSpaceHost(routeHost)) return new Set(["tailnet"]);
  return isPrivateNetworkHost(routeHost) ? new Set(["lan"]) : NO_SCOPES;
}

export function resolveDiscoveredServerUrl(environmentId: EnvironmentId, rawUrl: string): string {
  try {
    const normalizedUrl = normalizePreviewUrl(rawUrl);
    const parsed = new URL(normalizedUrl);
    if (!isLoopbackHost(parsed.hostname)) return normalizedUrl;
    const target = readPreparedConnection(environmentId)?.target;
    if (target && reachesEnvironmentLoopback(target)) return normalizedUrl;
    return resolveEnvironmentPortTarget(
      environmentId,
      {
        kind: "environment-port",
        port: Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)),
        protocol: parsed.protocol === "https:" ? "https" : "http",
        path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
      },
      readEnvironmentUrl(environmentId),
      rawUrl,
      parsed,
    ).resolvedUrl;
  } catch {
    return rawUrl;
  }
}
