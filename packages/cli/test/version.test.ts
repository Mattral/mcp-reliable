import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

describe("VERSION", () => {
  it("matches this package's package.json version", () => {
    expect(VERSION).toBe(packageJson.version);
  });
});
