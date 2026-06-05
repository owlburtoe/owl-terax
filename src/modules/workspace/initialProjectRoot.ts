import { getCliDir } from "@/lib/launchDir";
import { native } from "@/modules/ai/lib/native";
import { loadPersistedProjectRoots } from "@/modules/settings/store";

let cached: string | undefined;
let resolved = false;

/**
 * Resolve (and authorize) the restored project root before first paint so the
 * initial terminal mounts in the open project instead of the user's home
 * directory. Mirrors the launch precedence in `useProjectRoots`:
 *   - A `terax <dir>` CLI argument is already surfaced by `getLaunchDir()`, so
 *     it is left for that path — we only seed the *restored* project here.
 *   - Otherwise the persisted primary root is authorized; a missing/denied
 *     root resolves to `undefined` and the caller falls back to the launch dir.
 *
 * Authorizing up front doubles as validation: a now-deleted project fails to
 * canonicalize, so we never hand the PTY a cwd it would reject.
 */
export async function initInitialProjectRoot(): Promise<void> {
  if (resolved) return;
  resolved = true;
  if (getCliDir()) return;
  try {
    const [first] = await loadPersistedProjectRoots();
    if (!first) return;
    cached = await native.workspaceAuthorize(first);
  } catch {
    cached = undefined; // missing or unauthorizable — fall back to launch dir.
  }
}

/** The authorized restored project root, or undefined when none was restored. */
export function getInitialProjectRoot(): string | undefined {
  return cached;
}
