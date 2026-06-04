import { invoke } from "@tauri-apps/api/core";

let cachedLaunch: string | undefined;
let cachedCli: string | undefined;

function normalize(dir: string | null): string | undefined {
  return dir ? dir.replace(/\\/g, "/") : undefined;
}

export async function initLaunchDir(): Promise<void> {
  // `get_launch_dir` is drained once by the backend; read it a single time and
  // derive both values from it.
  const cli = await invoke<string | null>("get_launch_dir").catch(() => null);
  const launch =
    cli ?? (await invoke<string>("workspace_current_dir").catch(() => null));
  cachedCli = normalize(cli);
  cachedLaunch = normalize(launch);
}

/** Merged launch dir (CLI arg or process cwd) — used for the initial terminal. */
export function getLaunchDir(): string | undefined {
  return cachedLaunch;
}

/** Only an explicit `terax <dir>` CLI argument — used to promote a project root. */
export function getCliDir(): string | undefined {
  return cachedCli;
}
