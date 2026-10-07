import { createFileRoute } from "@tanstack/react-router";

import { ProxmoxSettings } from "../components/settings/ProxmoxSettings";

function SettingsProxmoxRoute() {
  return <ProxmoxSettings />;
}

export const Route = createFileRoute("/settings/proxmox")({
  component: SettingsProxmoxRoute,
});
