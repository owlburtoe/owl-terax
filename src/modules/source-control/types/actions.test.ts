import { describe, expect, it } from "vitest";
import { COMMIT_ACTIONS, isHeadLikelyPublished } from "./actions";

describe("COMMIT_ACTIONS", () => {
  it("lists the five commit variants in menu order", () => {
    expect(COMMIT_ACTIONS.map((a) => a.id)).toEqual([
      "commit",
      "commit-push",
      "commit-sync",
      "amend",
      "commit-all",
    ]);
  });
});

describe("isHeadLikelyPublished", () => {
  it("is false when no upstream is configured", () => {
    expect(isHeadLikelyPublished({ upstream: null, ahead: 0 })).toBe(false);
  });

  it("is true when upstream set and not ahead", () => {
    expect(isHeadLikelyPublished({ upstream: "origin/main", ahead: 0 })).toBe(
      true,
    );
  });

  it("is false when local commits are ahead (tip not yet pushed)", () => {
    expect(isHeadLikelyPublished({ upstream: "origin/main", ahead: 2 })).toBe(
      false,
    );
  });

  it("is true (fail-safe) when ahead is unknown but upstream exists", () => {
    expect(
      isHeadLikelyPublished({ upstream: "origin/main", ahead: null }),
    ).toBe(true);
  });
});
