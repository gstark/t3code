import type {
  DesktopProxmoxCertificate,
  DesktopProxmoxConnectionTest,
  DesktopProxmoxSettings,
  DesktopProxmoxSettingsInput,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as ProxmoxApi from "./ProxmoxApi.ts";
import * as ProxmoxTls from "./ProxmoxTls.ts";

const ProxmoxSettingsDocument = Schema.Struct({
  version: Schema.Literal(1),
  apiUrl: Schema.String,
  tokenId: Schema.String,
  certificateFingerprint: Schema.String,
  node: Schema.NullOr(Schema.String),
  templateVmid: Schema.NullOr(Schema.Number),
  // Base64 safeStorage ciphertext.
  encryptedTokenSecret: Schema.NullOr(Schema.String),
  encryptedGithubToken: Schema.NullOr(Schema.String),
});
type ProxmoxSettingsDocument = typeof ProxmoxSettingsDocument.Type;

const ProxmoxSettingsDocumentJson = fromLenientJson(ProxmoxSettingsDocument);
const decodeDocumentJson = Schema.decodeEffect(ProxmoxSettingsDocumentJson);
const encodeDocumentJson = Schema.encodeEffect(ProxmoxSettingsDocumentJson);

export class DesktopProxmoxSettingsError extends Schema.TaggedError<DesktopProxmoxSettingsError>()(
  "DesktopProxmoxSettingsError",
  {
    operation: Schema.Literals([
      "read",
      "decode",
      "validate",
      "encryption-unavailable",
      "encrypt",
      "decrypt",
      "write",
      "remove",
    ]),
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Proxmox settings ${this.operation} failed: ${this.detail}`;
  }
}

export class DesktopProxmox extends Context.Service<
  DesktopProxmox,
  {
    readonly getSettings: Effect.Effect<
      Option.Option<DesktopProxmoxSettings>,
      DesktopProxmoxSettingsError
    >;
    readonly setSettings: (
      input: DesktopProxmoxSettingsInput,
    ) => Effect.Effect<DesktopProxmoxSettings, DesktopProxmoxSettingsError>;
    readonly clearSettings: Effect.Effect<void, DesktopProxmoxSettingsError>;
    readonly fetchCertificate: (
      apiUrl: string,
    ) => Effect.Effect<
      DesktopProxmoxCertificate,
      DesktopProxmoxSettingsError | ProxmoxTls.ProxmoxCertificateError
    >;
    /** Never fails: every problem becomes `{ ok: false, reason }` for the form. */
    readonly testConnection: (
      input: DesktopProxmoxSettingsInput,
    ) => Effect.Effect<DesktopProxmoxConnectionTest>;
  }
>()("@t3tools/desktop/proxmox/DesktopProxmox") {}

function validationError(detail: string) {
  return new DesktopProxmoxSettingsError({ operation: "validate", detail });
}

const validateApiUrl = (apiUrl: string) =>
  Effect.gen(function* () {
    const url = yield* Effect.try({
      try: () => new URL(apiUrl.trim()),
      catch: () => validationError("The API URL is not a valid URL."),
    });
    if (url.protocol !== "https:") {
      return yield* validationError("The API URL must use https.");
    }
    return url.origin;
  });

const validateInput = (input: DesktopProxmoxSettingsInput) =>
  Effect.gen(function* () {
    const apiUrl = yield* validateApiUrl(input.apiUrl);
    const tokenId = input.tokenId.trim();
    if (!/^[^@\s]+@[^!\s]+![^\s]+$/.test(tokenId)) {
      return yield* validationError("The token ID must look like user@realm!name.");
    }
    if (input.certificateFingerprint.trim() === "") {
      return yield* validationError("Fetch and confirm the certificate first.");
    }
    return { ...input, apiUrl, tokenId };
  });

function toPublicSettings(document: ProxmoxSettingsDocument): DesktopProxmoxSettings {
  return {
    apiUrl: document.apiUrl,
    tokenId: document.tokenId,
    certificateFingerprint: document.certificateFingerprint,
    node: document.node,
    templateVmid: document.templateVmid,
    hasTokenSecret: document.encryptedTokenSecret !== null,
    hasGithubToken: document.encryptedGithubToken !== null,
  };
}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
  const settingsPath = path.join(environment.stateDir, "proxmox-settings.json");

  const readDocument = fileSystem.readFileString(settingsPath).pipe(
    Effect.asSome,
    Effect.catch((cause) =>
      cause.reason._tag === "NotFound"
        ? Effect.succeed(Option.none<string>())
        : Effect.fail(
            new DesktopProxmoxSettingsError({ operation: "read", detail: settingsPath, cause }),
          ),
    ),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(Option.none<ProxmoxSettingsDocument>()),
        onSome: (raw) =>
          decodeDocumentJson(raw).pipe(
            Effect.asSome,
            Effect.mapError(
              (cause) =>
                new DesktopProxmoxSettingsError({
                  operation: "decode",
                  detail: settingsPath,
                  cause,
                }),
            ),
          ),
      }),
    ),
  );

  const writeDocument = Effect.fn("desktop.proxmox.writeDocument")(function* (
    document: ProxmoxSettingsDocument,
  ) {
    const writeError = (cause: unknown) =>
      new DesktopProxmoxSettingsError({ operation: "write", detail: settingsPath, cause });
    const encoded = yield* encodeDocumentJson(document).pipe(Effect.mapError(writeError));
    const suffix = yield* crypto.randomUUIDv4.pipe(Effect.mapError(writeError));
    const tempPath = `${settingsPath}.${suffix}.tmp`;
    yield* fileSystem
      .makeDirectory(path.dirname(settingsPath), { recursive: true })
      .pipe(Effect.mapError(writeError));
    yield* fileSystem
      .writeFileString(tempPath, `${encoded}\n`)
      .pipe(
        Effect.andThen(fileSystem.rename(tempPath, settingsPath)),
        Effect.mapError(writeError),
        Effect.ensuring(fileSystem.remove(tempPath, { force: true }).pipe(Effect.ignore)),
      );
  });

  const encryptSecret = Effect.fn("desktop.proxmox.encryptSecret")(function* (secret: string) {
    const available = yield* safeStorage.isEncryptionAvailable.pipe(
      Effect.mapError(
        (cause) =>
          new DesktopProxmoxSettingsError({ operation: "encrypt", detail: cause.message, cause }),
      ),
    );
    if (!available) {
      return yield* new DesktopProxmoxSettingsError({
        operation: "encryption-unavailable",
        detail: "This system has no secure storage, so secrets cannot be saved.",
      });
    }
    const bytes = yield* safeStorage
      .encryptString(secret)
      .pipe(
        Effect.mapError(
          (cause) =>
            new DesktopProxmoxSettingsError({ operation: "encrypt", detail: cause.message, cause }),
        ),
      );
    return Encoding.encodeBase64(bytes);
  });

  const decryptSecret = Effect.fn("desktop.proxmox.decryptSecret")(function* (encoded: string) {
    const decryptError = (cause: unknown) =>
      new DesktopProxmoxSettingsError({ operation: "decrypt", detail: settingsPath, cause });
    const bytes = yield* Effect.fromResult(Encoding.decodeBase64(encoded)).pipe(
      Effect.mapError(decryptError),
    );
    return yield* safeStorage.decryptString(bytes).pipe(Effect.mapError(decryptError));
  });

  /** A new non-empty secret replaces the stored one; an omitted secret keeps it. */
  const resolveEncryptedSecret = (next: string | undefined, stored: string | null) => {
    const trimmed = next?.trim();
    return trimmed === undefined || trimmed === ""
      ? Effect.succeed(stored)
      : encryptSecret(trimmed);
  };

  const setSettings = Effect.fn("desktop.proxmox.setSettings")(function* (
    input: DesktopProxmoxSettingsInput,
  ) {
    const valid = yield* validateInput(input);
    const existing = yield* readDocument;
    const stored = Option.getOrNull(existing);
    const document: ProxmoxSettingsDocument = {
      version: 1,
      apiUrl: valid.apiUrl,
      tokenId: valid.tokenId,
      certificateFingerprint: valid.certificateFingerprint.trim(),
      node: valid.node,
      templateVmid: valid.templateVmid,
      encryptedTokenSecret: yield* resolveEncryptedSecret(
        valid.tokenSecret,
        stored?.encryptedTokenSecret ?? null,
      ),
      encryptedGithubToken: yield* resolveEncryptedSecret(
        valid.githubToken,
        stored?.encryptedGithubToken ?? null,
      ),
    };
    yield* writeDocument(document);
    return toPublicSettings(document);
  });

  const testConnection = Effect.fn("desktop.proxmox.testConnection")(
    function* (input: DesktopProxmoxSettingsInput) {
      const valid = yield* validateInput(input);
      const typedSecret = input.tokenSecret?.trim();
      const storedSecret = Option.getOrNull(yield* readDocument)?.encryptedTokenSecret ?? null;
      const tokenSecret =
        typedSecret !== undefined && typedSecret !== ""
          ? typedSecret
          : storedSecret === null
            ? null
            : yield* decryptSecret(storedSecret);
      if (tokenSecret === null) {
        return { ok: false, reason: "Enter the token secret." } as const;
      }
      return yield* ProxmoxApi.testConnection({
        apiUrl: valid.apiUrl,
        tokenId: valid.tokenId,
        tokenSecret,
      }).pipe(
        Effect.provide(ProxmoxTls.pinnedHttpClientLayer(valid.certificateFingerprint)),
        Effect.scoped,
      );
    },
    Effect.catch((error) => Effect.succeed({ ok: false, reason: error.message } as const)),
  );

  return DesktopProxmox.of({
    getSettings: readDocument.pipe(
      Effect.map(Option.map(toPublicSettings)),
      Effect.withSpan("desktop.proxmox.getSettings"),
    ),
    setSettings,
    clearSettings: fileSystem.remove(settingsPath, { force: true }).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopProxmoxSettingsError({ operation: "remove", detail: settingsPath, cause }),
      ),
      Effect.withSpan("desktop.proxmox.clearSettings"),
    ),
    fetchCertificate: (apiUrl) =>
      validateApiUrl(apiUrl).pipe(
        Effect.flatMap(ProxmoxTls.readCertificate),
        Effect.withSpan("desktop.proxmox.fetchCertificate"),
      ),
    testConnection,
  });
});

export const layer = Layer.effect(DesktopProxmox, make);
