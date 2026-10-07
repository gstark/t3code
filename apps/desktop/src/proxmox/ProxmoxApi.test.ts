import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ProxmoxApi from "./ProxmoxApi.ts";

const connection: ProxmoxApi.ProxmoxConnection = {
  apiUrl: "https://192.168.0.230:8006",
  tokenId: "agent@pve!harness",
  tokenSecret: "secret-uuid",
};

function makeHttpClientLayer(
  routes: Record<string, unknown>,
  seen: HttpClientRequest.HttpClientRequest[] = [],
) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        seen.push(request);
        const path = new URL(request.url).pathname.replace("/api2/json", "");
        const route = routes[path];
        if (route instanceof Response) return HttpClientResponse.fromWeb(request, route);
        return HttpClientResponse.fromWeb(
          request,
          route === undefined
            ? Response.json({ data: null }, { status: 501 })
            : Response.json({ data: route }),
        );
      }),
    ),
  );
}

describe("ProxmoxApi.testConnection", () => {
  it.effect("lists online nodes, templates, and missing privileges", () => {
    const seen: HttpClientRequest.HttpClientRequest[] = [];
    const layer = makeHttpClientLayer(
      {
        "/version": { version: "9.2.1", release: "9.2" },
        "/nodes": [
          { node: "proxmox", status: "online" },
          { node: "spare", status: "offline" },
        ],
        "/nodes/proxmox/lxc": [
          { vmid: 101, name: "dev-base", template: 1 },
          { vmid: "9000", name: "base-layer", template: 1 },
          { vmid: 250, name: "spike-a", status: "running" },
        ],
        "/access/permissions": {
          "/": {
            "VM.Allocate": 1,
            "VM.Clone": 1,
            "VM.Audit": 1,
            "VM.PowerMgmt": 1,
            "VM.Config.CPU": 1,
            "VM.Config.Memory": 1,
            "Datastore.AllocateSpace": 1,
          },
        },
      },
      seen,
    );

    return Effect.gen(function* () {
      const result = yield* ProxmoxApi.testConnection(connection);

      assert.deepStrictEqual(result, {
        ok: true,
        version: "9.2.1",
        nodes: ["proxmox"],
        templates: [
          { node: "proxmox", vmid: 101, name: "dev-base" },
          { node: "proxmox", vmid: 9000, name: "base-layer" },
        ],
        missingPrivileges: ["VM.Config.Options", "SDN.Use"],
      });
      assert.strictEqual(
        seen[0]?.headers.authorization,
        "PVEAPIToken=agent@pve!harness=secret-uuid",
      );
      assert.isFalse(seen.some((request) => request.url.includes("/nodes/spare/")));
    }).pipe(Effect.provide(layer));
  });

  it.effect("reports the message Proxmox sends with an HTTP error", () => {
    const layer = makeHttpClientLayer({
      "/version": Response.json({ data: null, message: "invalid token value!\n" }, { status: 401 }),
    });

    return Effect.gen(function* () {
      const error = yield* Effect.flip(ProxmoxApi.testConnection(connection));

      assert.instanceOf(error, ProxmoxApi.ProxmoxApiError);
      assert.strictEqual(error.status, 401);
      assert.strictEqual(error.message, "Proxmox /version returned HTTP 401: invalid token value!");
    }).pipe(Effect.provide(layer));
  });
});
