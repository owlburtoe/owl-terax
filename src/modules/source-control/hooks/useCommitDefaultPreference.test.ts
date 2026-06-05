import { describe, expect, it } from "vitest";
import { nextCommitDefault } from "./useCommitDefaultPreference";

describe("nextCommitDefault", () => {
  it("returns the chosen action as the new sticky default", () => {
    expect(nextCommitDefault("commit-push")).toBe("commit-push");
  });

  it("never makes amend sticky (one-off action)", () => {
    expect(nextCommitDefault("amend")).toBe("commit");
  });

  it("never makes commit-all sticky (one-off action)", () => {
    expect(nextCommitDefault("commit-all")).toBe("commit");
  });
});
