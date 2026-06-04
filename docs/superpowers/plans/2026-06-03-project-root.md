# Explicit Project Root ("Open Folder") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Terax a first-class, persisted, single project root (VS Code single-folder model) that pins the file tree and Source Control, replacing today's fragile "infer the root from terminal cwd → home" behavior, and stop the Source Control panel from masking real backend errors as "No Repository."

**Architecture:** A new `useProjectRoots` hook owns the canonical project root (stored as a `string[]` to leave room for multi-root; only index 0 is used today). The root is set via a native folder picker, authorized through the existing `workspace_authorize` command, persisted via the existing settings store, and restored on launch (CLI arg > persisted > empty). `explorerRoot` becomes exactly the project root; Source Control reads the project root (or an open git tab's repoRoot) and never leaks terminal cwd or `home`. The Source Control panel state machine is rebuilt as a pure function distinguishing `no-folder`, `error`, and `no-repo`.

**Tech Stack:** Tauri v2 (Rust), React + TypeScript, Vitest (pure-function tests, colocated `*.test.ts`), `@tauri-apps/plugin-store`, new `@tauri-apps/plugin-dialog`.

**Spec:** `docs/superpowers/specs/2026-06-03-project-root-design.md`

**Branch:** `feat/workspace-root` (already created)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/modules/workspace/projectRoots.ts` (new) | Pure helpers: dedupe roots, select primary, launch precedence |
| `src/modules/workspace/projectRoots.test.ts` (new) | Tests for the pure helpers |
| `src/modules/workspace/useProjectRoots.ts` (new) | Hook: state (roots/primaryRoot/isRestoring), openFolder, closeFolder, launch restore |
| `src/modules/settings/store.ts` (modify) | Persist `projectRoots: string[]` |
| `src/lib/launchDir.ts` (modify) | Expose `getCliDir()` (explicit arg) distinct from `getLaunchDir()` |
| `src/modules/source-control/panelState.ts` (new) | Pure SC panel-state derivation (no-folder vs error vs no-repo) |
| `src/modules/source-control/panelState.test.ts` (new) | Tests for the state machine |
| `src/modules/source-control/useSourceControlPanel.ts` (modify) | Use the pure state fn; accept workspace state; add `no-folder` |
| `src/modules/source-control/SourceControlPanel.tsx` (modify) | Render `no-folder`; thread workspace state |
| `src/modules/explorer/FileExplorer.tsx` (modify) | Open Folder button; no-folder / restoring empty states |
| `src/modules/sidebar/SidebarPanelHost.tsx` (modify) | Thread `onOpenFolder` / `isRestoring` / `hasFolder` |
| `src/app/App.tsx` (modify) | Wire `useProjectRoots`; `explorerRoot = primaryRoot`; rewrite SC context path; thread props |
| `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `package.json` (modify) | Add dialog plugin + capability + JS dep |

**Convention notes (match these exactly):**
- Tests: `import { describe, expect, it } from "vitest";` colocated next to source (see `src/modules/tabs/lib/resolveCwd.test.ts`). Run with `npm test` (`vitest run`).
- No React-testing-library/jsdom in this repo. All new *unit-tested* logic must be **pure functions**. Hooks/UI/Rust are verified by typecheck + build + manual run (Task 12), not unit tests.
- Settings setters follow the `writePref` pattern in `store.ts` (async, fire the `terax://prefs-changed` event automatically).

---

## Task 1: Persist `projectRoots` in the settings store

**Files:**
- Modify: `src/modules/settings/store.ts`

- [ ] **Step 1: Add the field to the `Preferences` type**

In `src/modules/settings/store.ts`, in the `Preferences` type (ends at line 95, after `sidebarPanelRecent: boolean;`), add:

```ts
  projectRoots: string[];
```

- [ ] **Step 2: Add the storage key constant**

After `const KEY_SIDEBAR_PANEL_RECENT = "sidebarPanelRecent";` (line 142), add:

```ts
const KEY_PROJECT_ROOTS = "projectRoots";
```

- [ ] **Step 3: Add the default**

In `DEFAULT_PREFERENCES` (after `sidebarPanelRecent: false,` at line 203), add:

```ts
  projectRoots: [],
```

- [ ] **Step 4: Load it**

In `loadPreferences()`, after the `sidebarPanelRecent:` entry (line 339-340), add:

```ts
    projectRoots:
      get<string[]>(KEY_PROJECT_ROOTS) ?? DEFAULT_PREFERENCES.projectRoots,
```

- [ ] **Step 5: Add the setter**

After `setSidebarPanelRecent` (line 556), add:

```ts
export async function setProjectRoots(value: string[]): Promise<void> {
  await writePref(KEY_PROJECT_ROOTS, value);
}
```

- [ ] **Step 6: Add the cross-window change mapping**

In `onPreferencesChange`, in the `map` object after `[KEY_SIDEBAR_PANEL_RECENT]: "sidebarPanelRecent",` (line 608), add:

```ts
    [KEY_PROJECT_ROOTS]: "projectRoots",
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (If `src/modules/settings/preferences.ts` declares an explicit subset of `Preferences` that omits `projectRoots`, that's fine — it does not need the field. If it spreads the full `Preferences`, it now includes `projectRoots` automatically.)

- [ ] **Step 8: Commit**

```bash
git add src/modules/settings/store.ts
git commit -m "feat(settings): persist projectRoots"
```

---

## Task 2: Pure project-root helpers (+ tests)

**Files:**
- Create: `src/modules/workspace/projectRoots.ts`
- Test: `src/modules/workspace/projectRoots.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/workspace/projectRoots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dedupeRoots, resolveLaunchRoots, selectPrimaryRoot } from "./projectRoots";

describe("dedupeRoots", () => {
  it("removes duplicates while preserving first-seen order", () => {
    expect(dedupeRoots(["/a", "/b", "/a", "/c"])).toEqual(["/a", "/b", "/c"]);
  });

  it("drops empty / whitespace-only entries", () => {
    expect(dedupeRoots(["/a", "", "  ", "/b"])).toEqual(["/a", "/b"]);
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeRoots([])).toEqual([]);
  });
});

describe("selectPrimaryRoot", () => {
  it("returns the first root", () => {
    expect(selectPrimaryRoot(["/a", "/b"])).toBe("/a");
  });

  it("returns null when there are no roots", () => {
    expect(selectPrimaryRoot([])).toBeNull();
  });
});

describe("resolveLaunchRoots", () => {
  it("uses the CLI dir alone when present (does NOT fall back to restored)", () => {
    expect(
      resolveLaunchRoots({ cliDir: "/cli", restoredRoots: ["/saved"] }),
    ).toEqual(["/cli"]);
  });

  it("uses restored roots when there is no CLI dir", () => {
    expect(
      resolveLaunchRoots({ cliDir: null, restoredRoots: ["/saved"] }),
    ).toEqual(["/saved"]);
  });

  it("returns empty when neither is present", () => {
    expect(resolveLaunchRoots({ cliDir: null, restoredRoots: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/modules/workspace/projectRoots.test.ts`
Expected: FAIL — `Cannot find module './projectRoots'`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/workspace/projectRoots.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/modules/workspace/projectRoots.test.ts`
Expected: PASS (3 describe blocks, 8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/workspace/projectRoots.ts src/modules/workspace/projectRoots.test.ts
git commit -m "feat(workspace): pure project-root helpers"
```

---

## Task 3: Split `launchDir.ts` into `getLaunchDir()` and `getCliDir()`

**Files:**
- Modify: `src/lib/launchDir.ts`

Rationale: `get_launch_dir` returns `Some` only for an explicit CLI directory arg, but the current code merges it with `workspace_current_dir` (= launch cwd/home). We must promote *only* an explicit CLI arg to a project root, while still using the merged value for the initial terminal's cwd. `get_launch_dir` is drained once, so capture both from a single call.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/lib/launchDir.ts` with:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (existing `getLaunchDir` callers are unchanged).

- [ ] **Step 3: Commit**

```bash
git add src/lib/launchDir.ts
git commit -m "feat(launch): expose getCliDir distinct from getLaunchDir"
```

---

## Task 4: `useProjectRoots` hook

**Files:**
- Create: `src/modules/workspace/useProjectRoots.ts`

This hook is orchestration over the (tested) pure helpers + native calls. It is verified by typecheck/build/manual run, not unit tests.

- [ ] **Step 1: Create the hook**

Create `src/modules/workspace/useProjectRoots.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck (will fail until the dialog plugin dep exists — that's Task 10)**

Run: `npx tsc --noEmit`
Expected: a single unresolved-module error for `@tauri-apps/plugin-dialog`. This is resolved in Task 10; everything else must be clean. If any *other* error appears, fix it now.

- [ ] **Step 3: Commit**

```bash
git add src/modules/workspace/useProjectRoots.ts
git commit -m "feat(workspace): useProjectRoots hook (open/close/restore)"
```

---

## Task 5: Pure Source Control panel-state machine (+ tests)

**Files:**
- Create: `src/modules/source-control/panelState.ts`
- Test: `src/modules/source-control/panelState.test.ts`

This is the bug fix: a real backend error must surface as `error` (not `no-repo`), and "no folder open" must be `no-folder` (not `no-repo`).

- [ ] **Step 1: Write the failing test**

Create `src/modules/source-control/panelState.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/modules/source-control/panelState.test.ts`
Expected: FAIL — `Cannot find module './panelState'`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/source-control/panelState.ts`:

```ts
export type SourceControlPanelState =
  | "closed"
  | "loading"
  | "no-folder"
  | "no-repo"
  | "ready"
  | "error";

export type PanelStateInput = {
  isOpen: boolean;
  isRestoring: boolean;
  hasFolder: boolean;
  isLoading: boolean;
  hasRepo: boolean;
  hasStatus: boolean;
  hasError: boolean;
};

/**
 * Precedence (highest first):
 *   closed     — panel not open
 *   loading    — launch restore in flight (avoid empty-state flicker)
 *   no-folder  — no project root open; do NOT attempt git discovery
 *   error      — a real backend error occurred (message shown elsewhere)
 *   loading    — first fetch, nothing resolved yet
 *   no-repo    — valid accessible folder, but no git repository
 *   ready      — repo + status present
 *
 * "no-repo" means ONLY: a valid folder is open but git found no repo. Backend
 * errors and "no folder" never collapse into it.
 */
export function deriveSourceControlPanelState(
  input: PanelStateInput,
): SourceControlPanelState {
  if (!input.isOpen) return "closed";
  if (input.isRestoring) return "loading";
  if (!input.hasFolder) return "no-folder";
  if (input.hasError) return "error";
  if (!input.hasRepo) {
    return input.isLoading && !input.hasStatus ? "loading" : "no-repo";
  }
  if (!input.hasStatus) return "loading";
  return "ready";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/modules/source-control/panelState.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/source-control/panelState.ts src/modules/source-control/panelState.test.ts
git commit -m "feat(source-control): pure panel-state machine (no-folder vs error vs no-repo)"
```

---

## Task 6: Use the pure state machine in `useSourceControlPanel`

**Files:**
- Modify: `src/modules/source-control/useSourceControlPanel.ts`

- [ ] **Step 1: Update the `PanelState` type alias**

At line 19, replace:

```ts
type PanelState = "closed" | "loading" | "no-repo" | "ready" | "error";
```

with:

```ts
import {
  deriveSourceControlPanelState,
  type SourceControlPanelState,
} from "./panelState";

type PanelState = SourceControlPanelState;
```

(Place the `import` with the other imports at the top of the file, and keep `type PanelState = SourceControlPanelState;` where the old alias was.)

- [ ] **Step 2: Add the workspace-state parameter**

At line 356-357, change the signature from:

```ts
export function useSourceControlPanel(
  isOpen: boolean,
```

to:

```ts
export function useSourceControlPanel(
  isOpen: boolean,
  workspace: { hasFolder: boolean; isRestoring: boolean },
```

(Insert `workspace` as the **second** parameter, before `summary`. The existing `summary` and `onOpenDiff` parameters follow it.)

- [ ] **Step 3: Rebuild the panel-state effect using the pure function**

Replace the effect body at lines 567-598 (the `useEffect` that starts `if (!isOpen) { setPanelState("closed"); ... }` and ends just before `setRepo(summary.repo); setStatus(summary.status); setPanelState("ready");`) with:

```ts
  useEffect(() => {
    const next = deriveSourceControlPanelState({
      isOpen,
      isRestoring: workspace.isRestoring,
      hasFolder: workspace.hasFolder,
      isLoading: summary.isLoading,
      hasRepo: summary.hasRepo,
      hasStatus: !!summary.status,
      hasError: !!summary.localError,
    });

    if (next === "closed") {
      setPanelState("closed");
      setSelectionTransition("none");
      return;
    }
    if (next === "loading") {
      setPanelState("loading");
      return;
    }
    if (next === "no-folder") {
      setRepo(null);
      setStatus(null);
      setSelected(null);
      setPanelState("no-folder");
      setSelectionTransition("none");
      return;
    }
    if (next === "no-repo") {
      setRepo(null);
      setStatus(null);
      setSelected(null);
      setPanelState("no-repo");
      setSelectionTransition("none");
      return;
    }
    if (next === "error") {
      setRepo(summary.repo);
      setStatus(null);
      setSelected(null);
      setPanelState("error");
      setSelectionTransition("none");
      return;
    }
    if (!summary.repo || !summary.status) {
      return;
    }

    setRepo(summary.repo);
    setStatus(summary.status);
    setPanelState("ready");
```

> Keep everything AFTER `setPanelState("ready");` (the `const current = selectedRef.current; ...` selection-reconciliation block at lines 604+) exactly as-is — only the leading branch ladder changes.

- [ ] **Step 4: Update the effect dependency array**

The effect's dependency array (just after the selection block, the array that currently includes `isOpen`, `summary`, etc. — around line 633) must also include `workspace.hasFolder` and `workspace.isRestoring`. Find the dep array ending the effect and add those two entries, e.g.:

```ts
  }, [isOpen, workspace.hasFolder, workspace.isRestoring, summary /* ...existing deps... */]);
```

(Preserve all existing dependencies; only add the two new ones.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only at the call site in `SourceControlPanel.tsx` (fixed in Task 7) and the `@tauri-apps/plugin-dialog` import from Task 4 (fixed in Task 10). No other errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/source-control/useSourceControlPanel.ts
git commit -m "refactor(source-control): drive panel state from pure machine + workspace state"
```

---

## Task 7: Render `no-folder` and thread workspace state through `SourceControlPanel`

**Files:**
- Modify: `src/modules/source-control/SourceControlPanel.tsx`

- [ ] **Step 1: Extend `Props`**

In the `Props` type (lines 57-68), add two fields:

```ts
type Props = {
  open: boolean;
  hasFolder: boolean;
  isRestoring: boolean;
  sourceControl: SourceControlSummary;
  onOpenGitGraph?: () => void;
  onOpenFolder?: () => void;
  onOpenDiff: (input: {
    path: string;
    repoRoot: string;
    mode: "+" | "-";
    originalPath: string | null;
    title?: string;
  }) => void;
};
```

- [ ] **Step 2: Destructure the new props and pass workspace state to the hook**

In `export const SourceControlPanel = memo(function SourceControlPanel({ ... })` (lines 130-135), update the destructure and the hook call:

```ts
export const SourceControlPanel = memo(function SourceControlPanel({
  open,
  hasFolder,
  isRestoring,
  sourceControl,
  onOpenGitGraph,
  onOpenFolder,
  onOpenDiff,
}: Props) {
  const scm = useSourceControlPanel(
    open,
    { hasFolder, isRestoring },
    sourceControl,
    onOpenDiff,
  );
```

- [ ] **Step 3: Add the `no-folder` render branch**

Immediately before the `{scm.panelState === "no-repo" ? (` block (line 532), add:

```tsx
        {scm.panelState === "no-folder" ? (
          <PanelCenter
            title="No folder opened"
            body="Open a folder to start working in Terax."
            action={
              onOpenFolder ? (
                <Button size="sm" onClick={() => onOpenFolder()}>
                  Open Folder
                </Button>
              ) : undefined
            }
          />
        ) : null}
```

- [ ] **Step 4: Reword the `no-repo` copy (terminal/cwd language → folder language)**

Replace the `no-repo` `PanelCenter` body (line 535):

```tsx
            body="The active workspace is not inside a Git repository."
```

with:

```tsx
            body="This folder is not inside a Git repository."
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only at the `SidebarPanelHost` call site (Task 9) and the dialog import (Task 10).

- [ ] **Step 6: Commit**

```bash
git add src/modules/source-control/SourceControlPanel.tsx
git commit -m "feat(source-control): render no-folder state with Open Folder CTA"
```

---

## Task 8: Open Folder button + no-folder / restoring states in `FileExplorer`

**Files:**
- Modify: `src/modules/explorer/FileExplorer.tsx`

- [ ] **Step 1: Extend `Props`**

In the `Props` type (lines 41-49), add:

```ts
type Props = {
  rootPath: string | null;
  isRestoring?: boolean;
  onOpenFolder?: () => void;
  onOpenFile: (path: string, pin?: boolean) => void;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  onOpenMarkdownPreview?: (path: string) => void;
};
```

Then add `isRestoring` and `onOpenFolder` to the destructured props of the `forwardRef` component (wherever `rootPath`, `onOpenFile`, … are destructured near the top of the component body).

- [ ] **Step 2: Replace the empty state**

Replace the `if (!rootPath) { return ( ... ); }` block (lines 233-247) with:

```tsx
    if (!rootPath) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <HugeiconsIcon
            icon={Folder01Icon}
            size={24}
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
          {isRestoring ? (
            <div className="text-xs text-muted-foreground">Restoring…</div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                No folder opened
              </div>
              {onOpenFolder ? (
                <Button size="sm" variant="secondary" onClick={() => onOpenFolder()}>
                  Open Folder
                </Button>
              ) : null}
            </>
          )}
        </div>
      );
    }
```

- [ ] **Step 3: Add an Open Folder button to the header toolbar**

In the header `<div className="flex h-8 ...">` (lines 372-425), insert a button before the Search button (line 387):

```tsx
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => onOpenFolder?.()}
            title="Open folder"
            aria-label="Open folder"
          >
            <HugeiconsIcon icon={Folder01Icon} size={13} strokeWidth={2} />
          </Button>
```

(`Folder01Icon` and `Button` are already imported in this file.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only at the `SidebarPanelHost` call site (Task 9) and dialog import (Task 10).

- [ ] **Step 5: Commit**

```bash
git add src/modules/explorer/FileExplorer.tsx
git commit -m "feat(explorer): Open Folder button + no-folder/restoring empty states"
```

---

## Task 9: Thread `onOpenFolder` / `isRestoring` / `hasFolder` through `SidebarPanelHost`

**Files:**
- Modify: `src/modules/sidebar/SidebarPanelHost.tsx`

- [ ] **Step 1: Extend the prop types**

In `ExplorerProps` (lines 39-48), add:

```ts
  isRestoring: boolean;
  onOpenFolder: () => void;
```

In `SourceControlProps` (lines 50-60), add:

```ts
  hasFolder: boolean;
  onOpenFolder: () => void;
```

(`isRestoring` is already added to `ExplorerProps`; `SourceControlProps` shares the same `onOpenFolder` field — declaring it in both is fine since `Props` is an intersection and the types match.)

- [ ] **Step 2: Destructure the new props in `SidebarPanelHost`**

Add `isRestoring`, `hasFolder`, and `onOpenFolder` to the destructured parameters of `SidebarPanelHost({ ... })` (lines 86-108).

- [ ] **Step 3: Pass them through the `renderPanel` context**

In the `renderPanel(m.id, { ... })` call object (lines 194-212), add:

```ts
              isRestoring,
              hasFolder,
              onOpenFolder,
```

- [ ] **Step 4: Add them to `PanelContext` and forward in `renderPanel`**

`PanelContext` (lines 220-224) is `ExplorerProps & SourceControlProps & TabsProps & { activeEditorHandle }`, so the new fields are already typed once Step 1 lands. Update the two child renders in `renderPanel`:

For `FileExplorer` (lines 230-239), add props:

```tsx
          rootPath={ctx.explorerRoot}
          isRestoring={ctx.isRestoring}
          onOpenFolder={ctx.onOpenFolder}
```

For `SourceControlPanel` (lines 242-249), add props:

```tsx
        <SourceControlPanel
          open
          hasFolder={ctx.hasFolder}
          isRestoring={ctx.isRestoring}
          sourceControl={ctx.sourceControl}
          onOpenFolder={ctx.onOpenFolder}
          onOpenDiff={ctx.onOpenDiff}
          onOpenGitGraph={ctx.onOpenGitGraph}
        />
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only at the `<SidebarPanelHost ... />` usage in `App.tsx` (Task 11) and the dialog import (Task 10).

- [ ] **Step 6: Commit**

```bash
git add src/modules/sidebar/SidebarPanelHost.tsx
git commit -m "feat(sidebar): thread project-root props to explorer + source control"
```

---

## Task 10: Add the Tauri dialog plugin

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add the JS dependency**

Run: `npm install @tauri-apps/plugin-dialog@^2`
Expected: `package.json` dependencies gains `"@tauri-apps/plugin-dialog": "^2..."` and `package-lock.json` updates.

- [ ] **Step 2: Add the Rust crate**

In `src-tauri/Cargo.toml`, in the `[dependencies]` section next to the other `tauri-plugin-*` lines (e.g. after line 39 `tauri-plugin-notification = "2"`), add:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 3: Register the plugin**

In `src-tauri/src/lib.rs`, in the builder chain next to the other `.plugin(...)` calls (after line 105 `.plugin(tauri_plugin_notification::init())`), add:

```rust
        .plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 4: Grant the capability**

In `src-tauri/capabilities/default.json`, add `"dialog:default"` to the `permissions` array (e.g. after `"notification:default",`):

```json
    "dialog:default",
```

- [ ] **Step 5: Verify the workspace builds and TS resolves**

Run: `npx tsc --noEmit`
Expected: the `@tauri-apps/plugin-dialog` import in `useProjectRoots.ts` now resolves. Remaining errors should only be the `App.tsx` integration points (Task 11).

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles with the new plugin (downloads `tauri-plugin-dialog`).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(tauri): add dialog plugin for folder picker"
```

---

## Task 11: Wire the project root into `App.tsx`

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Import the hook and `getCliDir`**

Add an import for `useProjectRoots` (from `@/modules/workspace/useProjectRoots`) alongside the other workspace imports. (`getLaunchDir` is already imported from `@/lib/launchDir`; no `getCliDir` import is needed in App.tsx since the hook reads it internally.)

```ts
import { useProjectRoots } from "@/modules/workspace/useProjectRoots";
```

- [ ] **Step 2: Call the hook and derive `explorerRoot` from the project root**

Change the `useWorkspaceCwd` destructure (lines 599-604) to drop `explorerRoot`, and add the project-root hook + a pinned `explorerRoot`:

```ts
  const { inheritedCwdForNewTab } = useWorkspaceCwd(
    activeTab,
    tabs,
    launchCwd ?? home,
    defaultTerminalCwd || null,
  );
  const {
    primaryRoot,
    isRestoring: isRestoringWorkspace,
    openFolder,
    closeFolder,
  } = useProjectRoots();
  const explorerRoot = primaryRoot; // pinned project root; null = no folder open
```

> `closeFolder` may be unused for now (no UI calls it yet); if the linter flags it, prefix with `void closeFolder;` near usage or omit it from the destructure. Keeping it documents the API. Prefer omitting it from the destructure if unused: `const { primaryRoot, isRestoring: isRestoringWorkspace, openFolder } = useProjectRoots();`

- [ ] **Step 3: Rewrite the Source Control context path (remove terminal/home leakage)**

Replace `workspaceFallbackPath` (lines 912-914) and `sourceControlContextPath` (lines 915-924) and `badgeContextPath` (line 940) so Source Control keys off the project root only:

Delete the `workspaceFallbackPath` declaration (lines 912-914). Replace the `sourceControlContextPath` IIFE (lines 915-924) with:

```ts
  const gitTabRoot =
    activeTab?.kind === "git-diff" ||
    activeTab?.kind === "git-commit-file" ||
    activeTab?.kind === "git-history"
      ? activeTab.repoRoot
      : null;
  // Pinned: Source Control reflects the open project root (or an explicit git
  // tab's repo). Terminal cwd / editor path / home never leak in.
  const sourceControlContextPath = primaryRoot ?? gitTabRoot ?? null;
```

Replace the `badgeContextPath` declaration (line 940) with:

```ts
  const badgeContextPath = primaryRoot;
```

(The `sourceControlPath` / `useSourceControl` lines 941-944 stay unchanged — they consume the two values above.)

Removing `workspaceFallbackPath` orphans `launchCwdResolved` (its only consumer). Remove that now-unused state too:
- Delete the `const [launchCwdResolved, setLaunchCwdResolved] = useState(false);` declaration (line 305).
- In the `workspace_current_dir` effect (lines 371-377), drop the `.finally(() => setLaunchCwdResolved(true))` call so it reads:

```ts
  useEffect(() => {
    native
      .workspaceCurrentDir()
      .then(setLaunchCwd)
      .catch(() => setLaunchCwd(null));
  }, []);
```

Keep `launchCwd` / `setLaunchCwd` — they are still used by `useWorkspaceCwd` (line 602) and the AI composer (lines 1222, 1247).

- [ ] **Step 4: Pass the new props to `SidebarPanelHost`**

In the `<SidebarPanelHost ... />` JSX (around lines 1436-1458), add:

```tsx
                    isRestoring={isRestoringWorkspace}
                    hasFolder={primaryRoot !== null}
                    onOpenFolder={() => void openFolder()}
```

(`explorerRoot={explorerRoot}` at line 1442 stays — it now carries `primaryRoot`.)

- [ ] **Step 5: Typecheck the whole frontend**

Run: `npx tsc --noEmit`
Expected: PASS — no errors.

- [ ] **Step 6: Run the full unit-test suite**

Run: `npm test`
Expected: PASS — all existing tests plus the new `projectRoots` and `panelState` suites.

- [ ] **Step 7: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(app): pin explorer + source control to the project root"
```

---

## Task 12: Verification (build + manual run)

**Files:** none (verification only)

- [ ] **Step 1: Frontend typecheck + tests + lint**

Run: `npx tsc --noEmit && npm test`
Expected: both pass. Also run the repo's lint if present (`npm run lint` if defined in `package.json`).

- [ ] **Step 2: Rust build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles cleanly.

- [ ] **Step 3: Manual run — reproduce the original bug is fixed**

Run: `npm run tauri dev`

Verify each:
1. On first launch with no persisted root and no CLI arg → Explorer shows **"No folder opened"** with an **Open Folder** button (not the home directory); Source Control panel shows **"No folder opened"** (not "No Repository").
2. Click **Open Folder**, choose `/Users/berto/Projects/GitHub/Shiftd` → Explorer roots at Shiftd; open Source Control → it shows the repo, branch, and changed files (the original bug: previously "No Repository").
3. `cd` to a different directory inside a terminal tab → Explorer and Source Control **stay** pinned to Shiftd (do not follow the terminal).
4. Quit and relaunch (`npm run tauri dev` again) → Shiftd is **restored** automatically (no flicker through an empty state).
5. Launch with a CLI arg: `npm run tauri dev -- --  /Users/berto/Projects/GitHub/terax` (or run the built binary with a path) → that folder becomes the project root, overriding the restored one.
6. Open a folder that is a valid directory but not a git repo → Source Control shows **"This folder is not inside a Git repository"** (`no-repo`), distinct from the no-folder state.

- [ ] **Step 4: Manual run — error surfacing (the masking fix)**

Temporarily rename `git` off your PATH for the dev process, or point at a directory where git resolution errors, and confirm Source Control shows a **"Source control error"** panel with the real message + Retry — **not** "No Repository". (Revert the PATH change afterward.)

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "fix(workspace): address project-root verification findings"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** ✅ project root state + persistence (Tasks 1,4); Open Folder + native picker (Tasks 4,8,10); restore + CLI precedence + `getCliDir` split (Tasks 3,4); `isRestoring` flicker guard (Tasks 4,5,8); pin behavior / no terminal-cwd leak (Task 11); `no-folder` vs `no-repo` (Tasks 5,6,7); error-masking fix (Tasks 5,6); authorize via existing command (Task 4); nested-repo discovery out of scope (documented in spec, not implemented — correct).

**Type consistency:** `dedupeRoots` / `selectPrimaryRoot` / `resolveLaunchRoots` (Task 2) used consistently in Task 4. `deriveSourceControlPanelState` + `SourceControlPanelState` (Task 5) consumed in Task 6. `useSourceControlPanel(open, { hasFolder, isRestoring }, summary, onOpenDiff)` signature matches between Tasks 6 and 7. `onOpenFolder` / `isRestoring` / `hasFolder` prop names consistent across Tasks 7,8,9,11.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Hook/UI/Rust steps that can't be pure-unit-tested in this repo are explicitly verified by typecheck/build/manual run (Task 12) rather than with hand-waved tests.
