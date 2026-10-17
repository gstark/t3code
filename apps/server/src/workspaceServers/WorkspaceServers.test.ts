import { describe, expect, it } from "vite-plus/test";

import {
  buildAddresses,
  classifyServer,
  isInsideDirectory,
  parseLsofCwds,
  parseLsofListeners,
  parseSsListeners,
  toWorkspaceServers,
  type HostNetwork,
} from "./WorkspaceServers.ts";

const NETWORK: HostNetwork = {
  lan: ["192.168.1.10"],
  tailnet: ["100.64.0.5"],
  magicDnsName: "box.tail1234.ts.net",
};

describe("parseLsofListeners", () => {
  it("reads every bind address of every process", () => {
    const raw = ["p100", "cnode", "n*:3000", "n[::1]:3000", "p200", "cpostgres", "n127.0.0.1:5432"]
      .join("\n")
      .concat("\n");
    expect(parseLsofListeners(raw)).toEqual([
      { pid: 100, processName: "node", host: "*", port: 3000 },
      { pid: 100, processName: "node", host: "::1", port: 3000 },
      { pid: 200, processName: "postgres", host: "127.0.0.1", port: 5432 },
    ]);
  });
});

describe("parseSsListeners", () => {
  it("reads addresses and every owning process", () => {
    const raw = [
      'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=10,fd=20),("node",pid=11,fd=20))',
      'LISTEN 0 244 [::1]:5432 [::]:* users:(("postgres",pid=12,fd=6))',
      "LISTEN 0 4096 127.0.0.53%lo:53 0.0.0.0:*",
    ].join("\n");
    expect(parseSsListeners(raw)).toEqual([
      { pid: 10, processName: "node", host: "0.0.0.0", port: 3000 },
      { pid: 11, processName: "node", host: "0.0.0.0", port: 3000 },
      { pid: 12, processName: "postgres", host: "::1", port: 5432 },
    ]);
  });
});

describe("parseLsofCwds", () => {
  it("maps each process to its working directory", () => {
    const raw = "p100\nfcwd\nn/work/app\np200\nfcwd\nn/work/db\n";
    expect([...parseLsofCwds(raw)]).toEqual([
      [100, "/work/app"],
      [200, "/work/db"],
    ]);
  });
});

describe("isInsideDirectory", () => {
  it("matches the directory and its children only", () => {
    expect(isInsideDirectory("/work/app", "/work/app/")).toBe(true);
    expect(isInsideDirectory("/work/app/web", "/work/app")).toBe(true);
    expect(isInsideDirectory("/work/app-other", "/work/app")).toBe(false);
    expect(isInsideDirectory("/work", "/work/app")).toBe(false);
  });
});

describe("classifyServer", () => {
  it("prefers the process name, then well-known database ports", () => {
    expect(classifyServer("postgres", 6000)).toBe("postgres");
    expect(classifyServer("minio", 9000)).toBe("s3");
    expect(classifyServer(null, 6379)).toBe("redis");
    expect(classifyServer("ruby", 3000)).toBe("http");
    expect(classifyServer("python3.12", 8000)).toBe("http");
    expect(classifyServer("mystery", 7000)).toBe("tcp");
  });
});

describe("buildAddresses", () => {
  it("lists loopback, LAN, and tailnet addresses for a wildcard bind", () => {
    expect(buildAddresses({ kind: "http", port: 3000, hosts: ["*"], network: NETWORK })).toEqual([
      { scope: "loopback", url: "http://localhost:3000" },
      { scope: "lan", url: "http://192.168.1.10:3000" },
      { scope: "tailnet", url: "http://box.tail1234.ts.net:3000" },
      { scope: "tailnet", url: "http://100.64.0.5:3000" },
    ]);
  });

  it("lists only loopback for a loopback bind", () => {
    expect(
      buildAddresses({ kind: "postgres", port: 5432, hosts: ["127.0.0.1"], network: NETWORK }),
    ).toEqual([{ scope: "loopback", url: "postgres://localhost:5432" }]);
  });

  it("lists only the bound address for a specific bind, without a scheme for tcp", () => {
    expect(
      buildAddresses({ kind: "tcp", port: 7000, hosts: ["100.64.0.5"], network: NETWORK }),
    ).toEqual([
      { scope: "tailnet", url: "box.tail1234.ts.net:7000" },
      { scope: "tailnet", url: "100.64.0.5:7000" },
    ]);
  });
});

describe("toWorkspaceServers", () => {
  it("merges the bind addresses of one process and port", () => {
    const servers = toWorkspaceServers(
      [
        { pid: 100, processName: "node", host: "127.0.0.1", port: 5173 },
        { pid: 100, processName: "node", host: "::1", port: 5173 },
      ],
      NETWORK,
    );
    expect(servers).toEqual([
      {
        port: 5173,
        pid: 100,
        processName: "node",
        kind: "http",
        addresses: [{ scope: "loopback", url: "http://localhost:5173" }],
      },
    ]);
  });
});
