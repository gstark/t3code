import type {
  DesktopProxmoxCertificate,
  DesktopProxmoxConnectionTest,
  DesktopProxmoxSettings,
  DesktopProxmoxSettingsInput,
} from "@t3tools/contracts";
import { useState } from "react";

import { isElectron } from "../../env";
import {
  desktopProxmoxSettingsAtom,
  refreshDesktopProxmoxSettings,
} from "../../state/desktopProxmoxSettings";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  SettingsPageContainer,
  SettingsSearchTarget,
  SettingsSection,
  SettingsUnavailableGroup,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

type Busy = "certificate" | "test" | "save" | "remove" | null;

function normalizeApiUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function templateKey(node: string, vmid: number): string {
  return `${node}:${vmid}`;
}

function parseTemplateKey(key: string | null): { node: string; vmid: number } | null {
  const match = key?.match(/^(.+):(\d+)$/);
  return match?.[1] && match[2] ? { node: match[1], vmid: Number(match[2]) } : null;
}

// Electron prefixes rejected IPC calls with the channel name.
function bridgeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (\w+: )?/, "");
}

export function ProxmoxSettings() {
  const query = useEnvironmentQuery(isElectron ? desktopProxmoxSettingsAtom : null);
  const supported = window.desktopBridge?.getProxmoxSettings !== undefined;

  return (
    <SettingsPageContainer>
      <SettingsSection title="Proxmox">
        <SettingsUnavailableGroup
          message={supported ? undefined : "Only available in the desktop app."}
        >
          <SettingsSearchTarget
            {...searchableSetting("proxmox-connection")}
            className="grid gap-4 px-3 py-3 sm:px-4"
          >
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Spikes run in containers cloned from a template on this Proxmox host. The token secret
              and GitHub token stay in this computer's secure storage.
            </p>
            {query.error ? <p className="text-xs text-destructive">{query.error}</p> : null}
            {supported && query.isSuccess ? (
              <ProxmoxConnectionForm
                // A save replaces the saved settings; drafts must start again from them.
                key={query.dataUpdatedAt}
                saved={query.data ?? null}
              />
            ) : null}
          </SettingsSearchTarget>
        </SettingsUnavailableGroup>
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function ProxmoxConnectionForm({ saved }: { readonly saved: DesktopProxmoxSettings | null }) {
  const [apiUrlDraft, setApiUrlDraft] = useState<string | null>(null);
  const [tokenIdDraft, setTokenIdDraft] = useState<string | null>(null);
  const [tokenSecret, setTokenSecret] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [certificate, setCertificate] = useState<{
    readonly apiUrl: string;
    readonly value: DesktopProxmoxCertificate;
  } | null>(null);
  const [trusted, setTrusted] = useState<{
    readonly apiUrl: string;
    readonly fingerprint: string;
  } | null>(null);
  const [test, setTest] = useState<DesktopProxmoxConnectionTest | null>(null);
  const [templateChoice, setTemplateChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const apiUrl = apiUrlDraft ?? saved?.apiUrl ?? "";
  const tokenId = tokenIdDraft ?? saved?.tokenId ?? "";
  const normalizedUrl = normalizeApiUrl(apiUrl);
  const pinnedFingerprint =
    trusted?.apiUrl === normalizedUrl
      ? trusted.fingerprint
      : saved !== null && saved.apiUrl === normalizedUrl
        ? saved.certificateFingerprint
        : null;
  const pendingCertificate =
    certificate?.apiUrl === normalizedUrl && certificate.value.fingerprint256 !== pinnedFingerprint
      ? certificate.value
      : null;
  const templates = test?.ok === true ? test.templates : [];
  const savedTemplateKey =
    saved?.node && saved.templateVmid !== null ? templateKey(saved.node, saved.templateVmid) : null;
  const selectedTemplate = parseTemplateKey(templateChoice ?? savedTemplateKey);
  const hasSecret = tokenSecret.trim() !== "" || saved?.hasTokenSecret === true;
  const input: DesktopProxmoxSettingsInput | null =
    pinnedFingerprint === null || tokenId.trim() === ""
      ? null
      : {
          apiUrl: normalizedUrl,
          tokenId,
          certificateFingerprint: pinnedFingerprint,
          node: selectedTemplate?.node ?? null,
          templateVmid: selectedTemplate?.vmid ?? null,
          ...(tokenSecret.trim() ? { tokenSecret } : {}),
          ...(githubToken.trim() ? { githubToken } : {}),
        };

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(bridgeErrorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const bridge = window.desktopBridge;
  const fetchCertificate = () =>
    run("certificate", async () => {
      const value = await bridge!.fetchProxmoxCertificate!(normalizedUrl);
      setCertificate({ apiUrl: normalizedUrl, value });
    });
  const testConnection = () =>
    run("test", async () => {
      if (input) setTest(await bridge!.testProxmoxConnection!(input));
    });
  const save = () =>
    run("save", async () => {
      if (!input) return;
      await bridge!.setProxmoxSettings!(input);
      refreshDesktopProxmoxSettings();
    });
  const remove = () =>
    run("remove", async () => {
      await bridge!.clearProxmoxSettings!();
      refreshDesktopProxmoxSettings();
    });

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (input && hasSecret) void save();
      }}
    >
      <fieldset disabled={busy !== null} className="contents">
        <div className="grid gap-1.5">
          <Label htmlFor="proxmox-api-url">API URL</Label>
          <div className="flex gap-2">
            <Input
              id="proxmox-api-url"
              size="sm"
              autoComplete="off"
              placeholder="https://192.168.0.230:8006"
              value={apiUrl}
              onChange={(event) => setApiUrlDraft(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={normalizedUrl === ""}
              onClick={() => void fetchCertificate()}
            >
              Fetch certificate
            </Button>
          </div>
          {pendingCertificate ? (
            <div className="grid gap-2 rounded-md border border-warning/40 p-3 text-xs">
              <p>
                Check this fingerprint against the Proxmox host before you trust it. In the Proxmox
                UI it is under the node's System, then Certificates.
              </p>
              <code className="break-all">{pendingCertificate.fingerprint256}</code>
              <p className="text-muted-foreground">
                {pendingCertificate.subject ?? "No subject"}
                {pendingCertificate.validTo ? `, valid until ${pendingCertificate.validTo}` : ""}
              </p>
              <div>
                <Button
                  size="xs"
                  onClick={() =>
                    setTrusted({
                      apiUrl: normalizedUrl,
                      fingerprint: pendingCertificate.fingerprint256,
                    })
                  }
                >
                  Trust this certificate
                </Button>
              </div>
            </div>
          ) : pinnedFingerprint ? (
            <p className="break-all text-xs text-muted-foreground">
              Pinned certificate: {pinnedFingerprint}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Fetch the certificate and trust it before you test or save.
            </p>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="proxmox-token-id">Token ID</Label>
          <Input
            id="proxmox-token-id"
            size="sm"
            autoComplete="off"
            placeholder="agent@pve!harness"
            value={tokenId}
            onChange={(event) => setTokenIdDraft(event.target.value)}
          />
        </div>
        <SecretInput
          id="proxmox-token-secret"
          label="Token secret"
          isSaved={saved?.hasTokenSecret === true}
          value={tokenSecret}
          onChange={setTokenSecret}
        />
        <SecretInput
          id="proxmox-github-token"
          label="GitHub token for spikes"
          isSaved={saved?.hasGithubToken === true}
          value={githubToken}
          onChange={setGithubToken}
        />
        <div className="grid gap-2">
          <div>
            <Button
              size="xs"
              variant="outline"
              disabled={input === null || !hasSecret}
              onClick={() => void testConnection()}
            >
              Test connection
            </Button>
          </div>
          {test?.ok === false ? <p className="text-xs text-destructive">{test.reason}</p> : null}
          {test?.ok === true ? (
            <div className="grid gap-1 text-xs">
              <p className="text-muted-foreground">Connected to Proxmox VE {test.version}.</p>
              {test.missingPrivileges.length > 0 ? (
                <p className="text-destructive">
                  The token lacks these privileges on /: {test.missingPrivileges.join(", ")}.
                </p>
              ) : null}
              {templates.length === 0 ? (
                <p className="text-destructive">No container templates found.</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="proxmox-template">Template</Label>
          <Select
            value={templateChoice ?? savedTemplateKey}
            onValueChange={(value) => setTemplateChoice(value)}
          >
            <SelectTrigger
              id="proxmox-template"
              size="sm"
              aria-label="Proxmox template"
              disabled={templates.length === 0 && savedTemplateKey === null}
            >
              <SelectValue>
                {(value: string | null) => {
                  const parsed = parseTemplateKey(value);
                  if (parsed === null) return "Test the connection to list templates";
                  const match = templates.find(
                    (template) => templateKey(template.node, template.vmid) === value,
                  );
                  return match ? `${match.vmid} ${match.name}` : `CT ${parsed.vmid}`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {templates.map((template) => (
                <SelectItem
                  key={templateKey(template.node, template.vmid)}
                  value={templateKey(template.node, template.vmid)}
                >
                  {template.vmid} {template.name}
                  {test?.ok === true && test.nodes.length > 1 ? ` (${template.node})` : ""}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          {saved !== null ? (
            <Button size="xs" variant="outline" onClick={() => void remove()}>
              Remove
            </Button>
          ) : null}
          <Button type="submit" size="xs" disabled={input === null || !hasSecret}>
            Save
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

/** A write-only secret field. It never shows the saved value; typing a new one replaces it. */
function SecretInput({
  id,
  label,
  isSaved,
  value,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly isSaved: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        size="sm"
        placeholder={isSaved ? "Stored secret, enter a new value to replace" : "Not set"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
