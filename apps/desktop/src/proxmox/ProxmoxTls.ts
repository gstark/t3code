// @effect-diagnostics nodeBuiltinImport:off - Certificate pinning needs a custom node:https agent.
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodeNet from "node:net";
import type * as NodeStream from "node:stream";
import * as NodeTls from "node:tls";

import type { DesktopProxmoxCertificate } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";

const CERTIFICATE_READ_TIMEOUT_MS = 10_000;

export class ProxmoxCertificateError extends Schema.TaggedError<ProxmoxCertificateError>()(
  "ProxmoxCertificateError",
  {
    apiUrl: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not read the TLS certificate of ${this.apiUrl}.`;
  }
}

/** Compares fingerprints written with or without colons and in any case. */
function fingerprintsMatch(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/[^0-9a-f]/gi, "").toUpperCase();
  return normalize(left) !== "" && normalize(left) === normalize(right);
}

function connectOptions(apiUrl: string): NodeTls.ConnectionOptions {
  const url = new URL(apiUrl);
  return {
    host: url.hostname,
    port: url.port === "" ? 443 : Number(url.port),
    ...(NodeNet.isIP(url.hostname) === 0 ? { servername: url.hostname } : {}),
    // The certificate is self-signed; trust comes from the pinned fingerprint.
    rejectUnauthorized: false,
  };
}

/** Reads the server certificate without trusting it, for trust on first use. */
export const readCertificate = (apiUrl: string) =>
  Effect.callback<DesktopProxmoxCertificate, ProxmoxCertificateError>((resume) => {
    let socket: NodeTls.TLSSocket;
    try {
      socket = NodeTls.connect(connectOptions(apiUrl));
    } catch (cause) {
      resume(Effect.fail(new ProxmoxCertificateError({ apiUrl, cause })));
      return;
    }
    socket.setTimeout(CERTIFICATE_READ_TIMEOUT_MS, () =>
      socket.destroy(new Error("Timed out waiting for the TLS handshake.")),
    );
    socket.once("error", (cause) =>
      resume(Effect.fail(new ProxmoxCertificateError({ apiUrl, cause }))),
    );
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      const commonName = certificate.subject?.CN;
      resume(
        Effect.succeed({
          fingerprint256: certificate.fingerprint256,
          subject: (Array.isArray(commonName) ? commonName[0] : commonName) ?? null,
          validTo: certificate.valid_to || null,
        }),
      );
    });
    return Effect.sync(() => socket.destroy());
  });

/**
 * Hands the socket to the request only after the peer certificate matches
 * the pinned fingerprint, so the API token never reaches another server.
 */
class PinnedHttpsAgent extends NodeHttps.Agent {
  readonly #fingerprint: string;

  constructor(fingerprint: string) {
    super({ keepAlive: true });
    this.#fingerprint = fingerprint;
  }

  override createConnection(
    options: NodeHttp.ClientRequestArgs,
    callback?: (error: Error | null, stream: NodeStream.Duplex) => void,
  ): undefined {
    const socket = NodeTls.connect({
      ...(options as NodeTls.ConnectionOptions),
      rejectUnauthorized: false,
    });
    let settled = false;
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      if (error !== null) socket.destroy();
      callback?.(error, socket);
    };
    socket.once("error", settle);
    socket.once("secureConnect", () => {
      const actual = socket.getPeerCertificate().fingerprint256;
      settle(
        fingerprintsMatch(actual, this.#fingerprint)
          ? null
          : new Error(
              `Proxmox certificate fingerprint ${actual} does not match the pinned fingerprint.`,
            ),
      );
    });
    return undefined;
  }
}

/** An `HttpClient` that only talks to a server presenting the pinned certificate. */
export const pinnedHttpClientLayer = (fingerprint: string) =>
  NodeHttpClient.layerNodeHttpNoAgent.pipe(
    Layer.provide(
      Layer.effect(
        NodeHttpClient.HttpAgent,
        Effect.acquireRelease(
          Effect.sync(() => ({
            http: new NodeHttp.Agent(),
            https: new PinnedHttpsAgent(fingerprint),
          })),
          (agents) =>
            Effect.sync(() => {
              agents.http.destroy();
              agents.https.destroy();
            }),
        ),
      ),
    ),
  );
