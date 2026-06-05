import { useCallback, useEffect, useRef } from "react";
import { resolveInheritedCwd } from "./resolveCwd";
import type { Tab } from "./useTabs";

type Result = {
  inheritedCwdForNewTab: () => string | undefined;
};

export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  home: string | null,
  defaultCwd?: string | null,
  projectRoot?: string | null,
): Result {
  const lastTerminalCwd = useRef<string | null>(null);

  useEffect(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) {
      lastTerminalCwd.current = activeTab.cwd;
    }
  }, [activeTab]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    // Editor tabs inherit the last terminal's cwd (or the open project root /
    // workspace home), not the file's folder — opening a new terminal from a
    // file shouldn't hijack the user's working directory context.
    return resolveInheritedCwd(
      activeTab,
      lastTerminalCwd.current,
      projectRoot ?? null,
      defaultCwd,
      home,
    );
  }, [activeTab, defaultCwd, home, projectRoot]);

  return { inheritedCwdForNewTab };
}
