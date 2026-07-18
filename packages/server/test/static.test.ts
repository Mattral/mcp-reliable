import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountDashboard, resolveDashboardDist } from "../src/static.js";

describe("mountDashboard", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "mcp-reliable-dashboard-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns false and mounts nothing when the dashboard hasn't been built", () => {
    const app = new Hono();
    const mounted = mountDashboard(app, path.join(tempDir, "does-not-exist"));
    expect(mounted).toBe(false);
  });

  it("returns true and serves the built index.html when present", async () => {
    writeFileSync(path.join(tempDir, "index.html"), "<html><body>dashboard</body></html>");
    const app = new Hono();
    const mounted = mountDashboard(app, tempDir);
    expect(mounted).toBe(true);

    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("dashboard");
  });

  it("serves other static assets under the dist directory", async () => {
    writeFileSync(path.join(tempDir, "index.html"), "<html></html>");
    writeFileSync(path.join(tempDir, "app.js"), "console.log('hi');");
    const app = new Hono();
    mountDashboard(app, tempDir);

    const res = await app.request("/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log");
  });
});

describe("resolveDashboardDist", () => {
  let packageDir: string;

  beforeEach(() => {
    packageDir = mkdtempSync(path.join(tmpdir(), "mcp-reliable-package-dir-test-"));
  });

  afterEach(() => {
    rmSync(packageDir, { recursive: true, force: true });
  });

  it("prefers the bundled dashboard-dist/ next to the package, when present", () => {
    const bundled = path.join(packageDir, "dashboard-dist");
    mkdirSync(bundled, { recursive: true });
    expect(resolveDashboardDist(packageDir)).toBe(bundled);
  });

  it("falls back to the monorepo sibling packages/dashboard/dist when nothing is bundled", () => {
    // packageDir simulates .../packages/server — the sibling is .../packages/dashboard/dist
    const expectedSibling = path.resolve(packageDir, "..", "dashboard", "dist");
    expect(resolveDashboardDist(packageDir)).toBe(expectedSibling);
  });
});
