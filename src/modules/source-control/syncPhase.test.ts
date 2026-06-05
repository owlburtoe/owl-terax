import { describe, expect, it } from "vitest";
import { syncPhaseLabel } from "./useSourceControl";

describe("syncPhaseLabel", () => {
  it("labels each sync phase failure distinctly", () => {
    expect(syncPhaseLabel("fetch")).toBe("Fetch failed");
    expect(syncPhaseLabel("pull")).toBe("Pull failed");
    expect(syncPhaseLabel("push")).toBe("Push failed");
  });
});
