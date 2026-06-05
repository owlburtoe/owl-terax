import { describe, expect, it } from "vitest";
import { resolveInheritedCwd } from "./resolveCwd";
import type { Tab, TerminalTab } from "./useTabs";

const home = "/home/user";
const defaultCwd = "/home/user/projects";
const lastCwd = "/home/user/work";
const projectRoot = "/home/user/repo";

function termTab(cwd: string): Tab {
  return {
    kind: "terminal",
    id: 1,
    title: "Terminal",
    cwd,
    paneTree: {} as TerminalTab["paneTree"],
    activeLeafId: 1,
  } satisfies TerminalTab;
}

function editorTab(): Tab {
  return {
    kind: "editor",
    id: 2,
    title: "Editor",
    path: "/file.ts",
    dirty: false,
    preview: false,
  };
}

describe("resolveInheritedCwd — priority chain", () => {
  it("returns active terminal cwd first", () => {
    expect(
      resolveInheritedCwd(termTab("/active"), lastCwd, projectRoot, defaultCwd, home),
    ).toBe("/active");
  });

  it("falls back to lastTerminalCwd when active tab is an editor", () => {
    expect(
      resolveInheritedCwd(editorTab(), lastCwd, projectRoot, defaultCwd, home),
    ).toBe(lastCwd);
  });

  it("falls back to the project root when lastTerminalCwd is null", () => {
    expect(
      resolveInheritedCwd(editorTab(), null, projectRoot, defaultCwd, home),
    ).toBe(projectRoot);
  });

  it("prefers the project root over the configured default directory", () => {
    expect(
      resolveInheritedCwd(editorTab(), null, projectRoot, defaultCwd, home),
    ).toBe(projectRoot);
  });

  it("falls back to defaultCwd when no project is open", () => {
    expect(
      resolveInheritedCwd(editorTab(), null, null, defaultCwd, home),
    ).toBe(defaultCwd);
  });

  it("falls back to home when project root, lastTerminalCwd and defaultCwd are absent", () => {
    expect(
      resolveInheritedCwd(editorTab(), null, null, null, home),
    ).toBe(home);
  });

  it("returns undefined when all sources are absent", () => {
    expect(
      resolveInheritedCwd(undefined, null, null, null, null),
    ).toBeUndefined();
  });

  it("treats empty string project root as absent (falls through to defaultCwd)", () => {
    expect(
      resolveInheritedCwd(editorTab(), null, "", defaultCwd, home),
    ).toBe(defaultCwd);
  });

  it("treats empty string defaultCwd as absent (falls through to home)", () => {
    expect(
      resolveInheritedCwd(editorTab(), null, null, "", home),
    ).toBe(home);
  });

  it("treats empty string lastTerminalCwd as absent (falls through to project root)", () => {
    expect(
      resolveInheritedCwd(editorTab(), "", projectRoot, defaultCwd, home),
    ).toBe(projectRoot);
  });

  it("returns undefined when active tab is undefined and all sources are null", () => {
    expect(
      resolveInheritedCwd(undefined, null, null, undefined, null),
    ).toBeUndefined();
  });
});
