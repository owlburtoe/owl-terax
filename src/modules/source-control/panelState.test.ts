import { describe, expect, it } from "vitest";
import { deriveSourceControlPanelState } from "./panelState";

const base = {
  isOpen: true,
  isRestoring: false,
  hasFolder: true,
  isLoading: false,
  hasRepo: true,
  hasStatus: true,
  hasError: false,
};

describe("deriveSourceControlPanelState", () => {
  it("is closed when the panel is not open", () => {
    expect(deriveSourceControlPanelState({ ...base, isOpen: false })).toBe(
      "closed",
    );
  });

  it("shows loading while restoring (prevents empty-state flicker)", () => {
    expect(deriveSourceControlPanelState({ ...base, isRestoring: true })).toBe(
      "loading",
    );
  });

  it("shows no-folder when no project root is open", () => {
    expect(
      deriveSourceControlPanelState({
        ...base,
        hasFolder: false,
        hasRepo: false,
        hasStatus: false,
      }),
    ).toBe("no-folder");
  });

  it("shows error when a backend error occurred, NOT no-repo", () => {
    expect(
      deriveSourceControlPanelState({
        ...base,
        hasError: true,
        hasRepo: false,
        hasStatus: false,
      }),
    ).toBe("error");
  });

  it("shows no-repo for a valid folder with no git repo", () => {
    expect(
      deriveSourceControlPanelState({
        ...base,
        hasRepo: false,
        hasStatus: false,
      }),
    ).toBe("no-repo");
  });

  it("shows loading on initial fetch (folder open, nothing resolved yet)", () => {
    expect(
      deriveSourceControlPanelState({
        ...base,
        isLoading: true,
        hasRepo: false,
        hasStatus: false,
      }),
    ).toBe("loading");
  });

  it("shows ready when repo and status are present", () => {
    expect(deriveSourceControlPanelState(base)).toBe("ready");
  });

  it("prioritizes error over no-repo even when status is absent", () => {
    expect(
      deriveSourceControlPanelState({
        ...base,
        hasError: true,
        hasRepo: false,
        hasStatus: false,
        isLoading: false,
      }),
    ).toBe("error");
  });
});
