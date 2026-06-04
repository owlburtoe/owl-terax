import { describe, expect, it } from "vitest";
import { dedupeRoots, resolveLaunchRoots, selectPrimaryRoot } from "./projectRoots";

describe("dedupeRoots", () => {
  it("removes duplicates while preserving first-seen order", () => {
    expect(dedupeRoots(["/a", "/b", "/a", "/c"])).toEqual(["/a", "/b", "/c"]);
  });

  it("drops empty / whitespace-only entries", () => {
    expect(dedupeRoots(["/a", "", "  ", "/b"])).toEqual(["/a", "/b"]);
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeRoots([])).toEqual([]);
  });
});

describe("selectPrimaryRoot", () => {
  it("returns the first root", () => {
    expect(selectPrimaryRoot(["/a", "/b"])).toBe("/a");
  });

  it("returns null when there are no roots", () => {
    expect(selectPrimaryRoot([])).toBeNull();
  });
});

describe("resolveLaunchRoots", () => {
  it("uses the CLI dir alone when present (does NOT fall back to restored)", () => {
    expect(
      resolveLaunchRoots({ cliDir: "/cli", restoredRoots: ["/saved"] }),
    ).toEqual(["/cli"]);
  });

  it("uses restored roots when there is no CLI dir", () => {
    expect(
      resolveLaunchRoots({ cliDir: null, restoredRoots: ["/saved"] }),
    ).toEqual(["/saved"]);
  });

  it("returns empty when neither is present", () => {
    expect(resolveLaunchRoots({ cliDir: null, restoredRoots: [] })).toEqual([]);
  });
});
