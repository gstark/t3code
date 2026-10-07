import * as Schema from "effect/Schema";

/**
 * Desktop-only Proxmox settings as the renderer sees them. Secrets stay in
 * desktop main; the renderer only learns whether one is stored.
 */
export const DesktopProxmoxSettingsSchema = Schema.Struct({
  apiUrl: Schema.String,
  tokenId: Schema.String,
  /** SHA-256 fingerprint of the API certificate, pinned on first use. */
  certificateFingerprint: Schema.String,
  node: Schema.NullOr(Schema.String),
  templateVmid: Schema.NullOr(Schema.Number),
  hasTokenSecret: Schema.Boolean,
  hasGithubToken: Schema.Boolean,
});
export type DesktopProxmoxSettings = typeof DesktopProxmoxSettingsSchema.Type;

/** Save or test input. An omitted secret keeps the stored one. */
export const DesktopProxmoxSettingsInputSchema = Schema.Struct({
  apiUrl: Schema.String,
  tokenId: Schema.String,
  certificateFingerprint: Schema.String,
  node: Schema.NullOr(Schema.String),
  templateVmid: Schema.NullOr(Schema.Number),
  tokenSecret: Schema.optionalKey(Schema.String),
  githubToken: Schema.optionalKey(Schema.String),
});
export type DesktopProxmoxSettingsInput = typeof DesktopProxmoxSettingsInputSchema.Type;

export const DesktopProxmoxCertificateSchema = Schema.Struct({
  fingerprint256: Schema.String,
  subject: Schema.NullOr(Schema.String),
  validTo: Schema.NullOr(Schema.String),
});
export type DesktopProxmoxCertificate = typeof DesktopProxmoxCertificateSchema.Type;

export const DesktopProxmoxTemplateSchema = Schema.Struct({
  node: Schema.String,
  vmid: Schema.Number,
  name: Schema.String,
});
export type DesktopProxmoxTemplate = typeof DesktopProxmoxTemplateSchema.Type;

export const DesktopProxmoxConnectionTestSchema = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    version: Schema.String,
    nodes: Schema.Array(Schema.String),
    templates: Schema.Array(DesktopProxmoxTemplateSchema),
    /** Privileges the spike lifecycle needs that the token lacks on `/`. */
    missingPrivileges: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    reason: Schema.String,
  }),
]);
export type DesktopProxmoxConnectionTest = typeof DesktopProxmoxConnectionTestSchema.Type;
