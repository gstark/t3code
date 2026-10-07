import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { DesktopProxmoxSettingsInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as DesktopProxmox from "./DesktopProxmox.ts";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function makeLayer(baseDir: string, encryptionAvailable: boolean) {
  const environmentLayer = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
    ),
  );
  const safeStorageLayer = Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, {
    isEncryptionAvailable: Effect.succeed(encryptionAvailable),
    encryptString: (value) => Effect.succeed(textEncoder.encode(`encrypted:${value}`)),
    decryptString: (value) => Effect.succeed(textDecoder.decode(value).slice("encrypted:".length)),
    selectedStorageBackend: Effect.succeedNone,
  } satisfies ElectronSafeStorage.ElectronSafeStorage["Service"]);
  return DesktopProxmox.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(environmentLayer, safeStorageLayer, NodeServices.layer)),
  );
}

const withProxmox = <A, E, R>(
  effect: (baseDir: string) => Effect.Effect<A, E, R | DesktopProxmox.DesktopProxmox>,
  encryptionAvailable = true,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-desktop-proxmox-" });
    return yield* effect(baseDir).pipe(Effect.provide(makeLayer(baseDir, encryptionAvailable)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

const input: DesktopProxmoxSettingsInput = {
  apiUrl: "https://192.168.0.230:8006/",
  tokenId: " agent@pve!harness ",
  certificateFingerprint: "AB:CD",
  node: "proxmox",
  templateVmid: 101,
  tokenSecret: "secret-uuid",
  githubToken: "github_pat_123",
};
const { tokenSecret: _tokenSecret, ...inputWithoutSecret } = input;

describe("DesktopProxmox settings", () => {
  it.effect("stores secrets encrypted and keeps them when a save omits them", () =>
    withProxmox((baseDir) =>
      Effect.gen(function* () {
        const proxmox = yield* DesktopProxmox.DesktopProxmox;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        assert.isTrue(Option.isNone(yield* proxmox.getSettings));
        yield* proxmox.setSettings(input);
        const saved = yield* proxmox.setSettings({
          ...inputWithoutSecret,
          templateVmid: 102,
          githubToken: "",
        });

        assert.deepStrictEqual(saved, {
          apiUrl: "https://192.168.0.230:8006",
          tokenId: "agent@pve!harness",
          certificateFingerprint: "AB:CD",
          node: "proxmox",
          templateVmid: 102,
          hasTokenSecret: true,
          hasGithubToken: true,
        });
        assert.deepStrictEqual(yield* proxmox.getSettings, Option.some(saved));
        const userDataDir = (yield* DesktopEnvironment.DesktopEnvironment).stateDir;
        const raw = yield* fileSystem.readFileString(
          path.join(userDataDir, "proxmox-settings.json"),
        );
        assert.notInclude(raw, "secret-uuid");
        assert.notInclude(raw, "github_pat_123");
        assert.include(userDataDir, baseDir);

        yield* proxmox.clearSettings;
        assert.isTrue(Option.isNone(yield* proxmox.getSettings));
      }),
    ),
  );

  it.effect("rejects an API URL that is not https", () =>
    withProxmox(() =>
      Effect.gen(function* () {
        const proxmox = yield* DesktopProxmox.DesktopProxmox;
        const error = yield* Effect.flip(
          proxmox.setSettings({ ...input, apiUrl: "http://192.168.0.230:8006" }),
        );
        assert.strictEqual(error.operation, "validate");
      }),
    ),
  );

  it.effect("refuses to save secrets without secure storage", () =>
    withProxmox(
      () =>
        Effect.gen(function* () {
          const proxmox = yield* DesktopProxmox.DesktopProxmox;
          const error = yield* Effect.flip(proxmox.setSettings(input));
          assert.strictEqual(error.operation, "encryption-unavailable");
          assert.isTrue(Option.isNone(yield* proxmox.getSettings));
        }),
      false,
    ),
  );

  it.effect("asks for the token secret before testing when none is stored", () =>
    withProxmox(() =>
      Effect.gen(function* () {
        const proxmox = yield* DesktopProxmox.DesktopProxmox;
        const result = yield* proxmox.testConnection(inputWithoutSecret);
        assert.deepStrictEqual(result, { ok: false, reason: "Enter the token secret." });
      }),
    ),
  );
});
