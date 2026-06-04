import { native } from "@/modules/ai/lib/native";
import {
  loadPreferences,
  setProjectRoots,
} from "@/modules/settings/store";
import { getCliDir } from "@/lib/launchDir";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { dedupeRoots, resolveLaunchRoots, selectPrimaryRoot } from "./projectRoots";

export type ProjectRoots = {
  roots: string[];
  primaryRoot: string | null;
  /** True until the launch-time restore settles (prevents empty-state flicker). */
  isRestoring: boolean;
  openFolder: () => Promise<void>;
  closeFolder: () => void;
};

/** Authorize each path; keep only those that succeed (drops missing/denied). */
async function authorizeAll(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    try {
      out.push(await native.workspaceAuthorize(p));
    } catch {
      // Missing or unauthorizable — drop it.
    }
  }
  return dedupeRoots(out);
}

export function useProjectRoots(): ProjectRoots {
  const [roots, setRoots] = useState<string[]>([]);
  const [isRestoring, setIsRestoring] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Launch-time restore / CLI promotion (runs once).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cliDir = getCliDir() ?? null;
      const restoredRoots = cliDir ? [] : (await loadPreferences()).projectRoots;
      const candidates = resolveLaunchRoots({ cliDir, restoredRoots });
      const authorized = (await authorizeAll(candidates)).slice(0, 1);
      if (cancelled) return;
      setRoots(authorized);
      setIsRestoring(false);
      // Persist the cleaned set: promotes a CLI arg, or drops a now-missing
      // persisted root so it isn't retried forever.
      await setProjectRoots(authorized);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openFolder = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Open Folder",
    });
    if (typeof selected !== "string") return; // cancelled
    let canonical: string;
    try {
      canonical = await native.workspaceAuthorize(selected);
    } catch {
      // Authorization is the security boundary; do not set or persist on failure.
      return;
    }
    if (!mounted.current) return;
    const next = [canonical];
    setRoots(next);
    await setProjectRoots(next);
  }, []);

  const closeFolder = useCallback(() => {
    setRoots([]);
    void setProjectRoots([]);
  }, []);

  return {
    roots,
    primaryRoot: selectPrimaryRoot(roots),
    isRestoring,
    openFolder,
    closeFolder,
  };
}
