import {
  DesktopProxmoxCertificateSchema,
  DesktopProxmoxConnectionTestSchema,
  DesktopProxmoxSettingsInputSchema,
  DesktopProxmoxSettingsSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopProxmox from "../../proxmox/DesktopProxmox.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getProxmoxSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_PROXMOX_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(DesktopProxmoxSettingsSchema),
  handler: Effect.fn("desktop.ipc.proxmox.getSettings")(function* () {
    const proxmox = yield* DesktopProxmox.DesktopProxmox;
    return Option.getOrNull(yield* proxmox.getSettings);
  }),
});

export const setProxmoxSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_PROXMOX_SETTINGS_CHANNEL,
  payload: DesktopProxmoxSettingsInputSchema,
  result: DesktopProxmoxSettingsSchema,
  handler: Effect.fn("desktop.ipc.proxmox.setSettings")(function* (input) {
    const proxmox = yield* DesktopProxmox.DesktopProxmox;
    return yield* proxmox.setSettings(input);
  }),
});

export const clearProxmoxSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CLEAR_PROXMOX_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.proxmox.clearSettings")(function* () {
    const proxmox = yield* DesktopProxmox.DesktopProxmox;
    yield* proxmox.clearSettings;
  }),
});

export const fetchProxmoxCertificate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.FETCH_PROXMOX_CERTIFICATE_CHANNEL,
  payload: Schema.String,
  result: DesktopProxmoxCertificateSchema,
  handler: Effect.fn("desktop.ipc.proxmox.fetchCertificate")(function* (apiUrl) {
    const proxmox = yield* DesktopProxmox.DesktopProxmox;
    return yield* proxmox.fetchCertificate(apiUrl);
  }),
});

export const testProxmoxConnection = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.TEST_PROXMOX_CONNECTION_CHANNEL,
  payload: DesktopProxmoxSettingsInputSchema,
  result: DesktopProxmoxConnectionTestSchema,
  handler: Effect.fn("desktop.ipc.proxmox.testConnection")(function* (input) {
    const proxmox = yield* DesktopProxmox.DesktopProxmox;
    return yield* proxmox.testConnection(input);
  }),
});
