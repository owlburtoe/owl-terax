/**
 * Pure helpers for the explicit project-root model. The hook
 * (`useProjectRoots`) owns side effects; everything here is deterministic and
 * unit-tested.
 */

/** Drop empty/whitespace entries and de-duplicate, preserving first-seen order. */
export function dedupeRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of roots) {
    const path = raw.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/** The single active root today (index 0). Null when no folder is open. */
export function selectPrimaryRoot(roots: string[]): string | null {
  return roots[0] ?? null;
}

/**
 * Launch precedence. A CLI directory argument wins outright and is NOT mixed
 * with restored roots — if it later fails authorization the result is empty
 * (no silent restore of the previous project). With no CLI arg, restore the
 * persisted roots.
 */
export function resolveLaunchRoots(input: {
  cliDir: string | null;
  restoredRoots: string[];
}): string[] {
  if (input.cliDir) return [input.cliDir];
  return input.restoredRoots;
}
