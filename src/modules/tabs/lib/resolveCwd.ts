import type { Tab } from "./useTabs";

/**
 * Resolve the cwd a new terminal tab should inherit.
 *
 * Priority (highest → lowest):
 *   1. Active terminal tab's live cwd
 *   2. Last cwd seen from any terminal (tracked by the caller)
 *   3. Open project root (the pinned folder, when one is open)
 *   4. User-configured default directory (Settings → General → Default directory)
 *   5. Workspace home directory
 *   6. undefined (caller decides)
 *
 * The project root outranks the configured default and home so that "having a
 * folder open" makes new terminals land in that folder — but a live terminal
 * you're actively working in (1, 2) still wins, preserving cwd inheritance.
 */
export function resolveInheritedCwd(
  activeTab: Tab | undefined,
  lastTerminalCwd: string | null,
  projectRoot: string | null | undefined,
  defaultCwd: string | null | undefined,
  home: string | null,
): string | undefined {
  if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
  // Use || not ?? so that empty strings (the store default for an unconfigured
  // defaultCwd) are treated the same as null/undefined and fall through.
  return lastTerminalCwd || projectRoot || defaultCwd || home || undefined;
}
