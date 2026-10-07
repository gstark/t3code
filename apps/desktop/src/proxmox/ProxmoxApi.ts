import type { DesktopProxmoxConnectionTest, DesktopProxmoxTemplate } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/unstable/http";

export interface ProxmoxConnection {
  readonly apiUrl: string;
  readonly tokenId: string;
  readonly tokenSecret: string;
}

/** Privileges on `/` that the spike lifecycle uses: clone, configure, start, stop, destroy. */
const REQUIRED_PRIVILEGES = [
  "VM.Allocate",
  "VM.Clone",
  "VM.Audit",
  "VM.PowerMgmt",
  "VM.Config.CPU",
  "VM.Config.Memory",
  "VM.Config.Options",
  "Datastore.AllocateSpace",
  "SDN.Use",
] as const;

export class ProxmoxApiError extends Schema.TaggedError<ProxmoxApiError>()("ProxmoxApiError", {
  path: Schema.String,
  status: Schema.NullOr(Schema.Number),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.status === null
      ? `Proxmox request ${this.path} failed: ${this.detail}`
      : `Proxmox ${this.path} returned HTTP ${this.status}: ${this.detail}`;
  }
}

const decodeEnvelope = Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.Unknown }));
const decodeVersion = Schema.decodeUnknownEffect(Schema.Struct({ version: Schema.String }));
const decodeNodes = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ node: Schema.String, status: Schema.String })),
);
const decodeContainers = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      vmid: Schema.Union([Schema.Number, Schema.NumberFromString]),
      name: Schema.optionalKey(Schema.String),
      template: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
    }),
  ),
);
const decodePermissions = Schema.decodeUnknownEffect(
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)),
);

// Proxmox error bodies carry the reason, such as the missing privilege on a
// 403, in `message`, and parameter problems in `errors`.
const ErrorBody = Schema.Struct({
  message: Schema.optionalKey(Schema.NullOr(Schema.String)),
  errors: Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
});

const decodeErrorBody = Schema.decodeUnknownEffect(ErrorBody);

const errorDetail = (response: HttpClientResponse.HttpClientResponse) =>
  response.json.pipe(
    Effect.flatMap(decodeErrorBody),
    Effect.map((body) => {
      const message = body.message?.trim();
      if (message) return message;
      const errors = Object.entries(body.errors ?? {}).map(([key, value]) => `${key}: ${value}`);
      return errors.length > 0 ? errors.join("; ") : "request failed";
    }),
    Effect.orElseSucceed(() => "request failed"),
  );

const getData = <A>(
  connection: ProxmoxConnection,
  path: string,
  decode: (data: unknown) => Effect.Effect<A, Schema.SchemaError>,
): Effect.Effect<A, ProxmoxApiError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const fail = (status: number | null, detail: string) =>
      new ProxmoxApiError({ path, status, detail });
    const request = HttpClientRequest.get(
      `${connection.apiUrl.replace(/\/+$/, "")}/api2/json${path}`,
    ).pipe(
      HttpClientRequest.setHeader(
        "Authorization",
        `PVEAPIToken=${connection.tokenId}=${connection.tokenSecret}`,
      ),
      HttpClientRequest.acceptJson,
    );
    const response = yield* client
      .execute(request)
      .pipe(Effect.mapError((cause) => fail(null, cause.message)));
    if (response.status < 200 || response.status >= 300) {
      return yield* fail(response.status, yield* errorDetail(response));
    }
    const body = yield* response.json.pipe(
      Effect.mapError(() => fail(response.status, "response was not JSON")),
    );
    const unexpected = (cause: Schema.SchemaError) =>
      fail(response.status, `unexpected response: ${cause.message}`);
    const envelope = yield* decodeEnvelope(body).pipe(Effect.mapError(unexpected));
    return yield* decode(envelope.data).pipe(Effect.mapError(unexpected));
  });

const isTemplate = (template: number | string | undefined) => template === 1 || template === "1";

/**
 * Checks that the token works and reports what the settings form needs:
 * the node names, the container templates, and any missing privileges.
 */
export const testConnection = Effect.fn("desktop.proxmox.testConnection")(function* (
  connection: ProxmoxConnection,
) {
  const version = yield* getData(connection, "/version", decodeVersion);
  const nodes = yield* getData(connection, "/nodes", decodeNodes);
  const onlineNodes = nodes.filter((node) => node.status === "online").map((node) => node.node);
  const templates: DesktopProxmoxTemplate[] = [];
  for (const node of onlineNodes) {
    const containers = yield* getData(
      connection,
      `/nodes/${encodeURIComponent(node)}/lxc`,
      decodeContainers,
    );
    for (const container of containers) {
      if (isTemplate(container.template)) {
        templates.push({
          node,
          vmid: container.vmid,
          name: container.name ?? `CT ${container.vmid}`,
        });
      }
    }
  }
  const permissions = yield* getData(connection, "/access/permissions", decodePermissions);
  const rootPrivileges = permissions["/"] ?? {};
  const missingPrivileges = REQUIRED_PRIVILEGES.filter(
    (privilege) => !Object.hasOwn(rootPrivileges, privilege),
  );
  return {
    ok: true,
    version: version.version,
    nodes: onlineNodes,
    templates: templates.toSorted((left, right) => left.vmid - right.vmid),
    missingPrivileges,
  } satisfies DesktopProxmoxConnectionTest;
});
