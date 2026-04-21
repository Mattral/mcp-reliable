import { describe, expect, it } from "vitest";
import { slugify, tokenizeShellLike } from "../src/text-utils.js";

describe("tokenizeShellLike", () => {
  it("splits on whitespace", () => {
    expect(tokenizeShellLike("npx my-mcp-server")).toEqual(["npx", "my-mcp-server"]);
  });

  it("collapses repeated whitespace", () => {
    expect(tokenizeShellLike("npx    my-mcp-server   --flag")).toEqual(["npx", "my-mcp-server", "--flag"]);
  });

  it("respects double quotes", () => {
    expect(tokenizeShellLike('npx my-server --name "my server"')).toEqual([
      "npx",
      "my-server",
      "--name",
      "my server"
    ]);
  });

  it("respects single quotes", () => {
    expect(tokenizeShellLike("npx my-server --name 'my server'")).toEqual([
      "npx",
      "my-server",
      "--name",
      "my server"
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(tokenizeShellLike("   ")).toEqual([]);
    expect(tokenizeShellLike("")).toEqual([]);
  });
});

describe("slugify", () => {
  it("lowercases and dasherizes", () => {
    expect(slugify("My Cool Server")).toBe("my-cool-server");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("weather_api!! v2.0")).toBe("weather-api-v2-0");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("falls back to 'server' when nothing alphanumeric remains", () => {
    expect(slugify("!!!")).toBe("server");
  });
});
