import { describe, expect, it } from "vitest";
import {
  dedupeRoots,
  resolveLaunchRoots,
  selectPrimaryRoot,
  shouldSyncTerminalsToRoot,
} from "./projectRoots";

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

describe("shouldSyncTerminalsToRoot", () => {
  it("syncs when switching to a different project", () => {
    expect(shouldSyncTerminalsToRoot("/a", "/b")).toBe(true);
  });

  it("syncs when opening the first project from no folder", () => {
    expect(shouldSyncTerminalsToRoot(null, "/b")).toBe(true);
  });

  it("does not sync when the root is unchanged", () => {
    expect(shouldSyncTerminalsToRoot("/a", "/a")).toBe(false);
  });

  it("does not sync when closing the folder", () => {
    expect(shouldSyncTerminalsToRoot("/a", null)).toBe(false);
  });

  it("does not sync when there was and is no folder", () => {
    expect(shouldSyncTerminalsToRoot(null, null)).toBe(false);
  });
});
