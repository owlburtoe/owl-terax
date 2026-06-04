# Design: Explicit Project Root ("Open Folder")

- **Date:** 2026-06-03
- **Branch:** `feat/workspace-root`
- **Status:** Approved (pending final spec review)

## Problem

Terax has no first-class "project root." The file tree (`FileExplorer`) and Source
Control both **infer** their root from a fragile chain:

```
active terminal cwd  →  explorerRoot (last/any terminal cwd)  →  home (/Users/<user>)
```

(`src/modules/tabs/lib/useWorkspaceCwd.ts:24-30`, `src/app/App.tsx:915-924`).

Consequences observed:

- Source Control reports **"No Repository"** whenever the inferred path lands on a
  non-repo directory (commonly `home`, which is not a git repo) — even though the
  user's actual project is a healthy git repo. The panel is pointed at the wrong
  directory; git detection itself is fine (`git rev-parse --show-toplevel` walks up
  from any path *inside* a repo and succeeds).
- The Source Control panel's state machine checks `!hasRepo` **before** `localError`
  (`src/modules/source-control/useSourceControlPanel.ts:567-592`,
  `src/modules/source-control/useSourceControl.ts:327-336`), so **every** thrown
  backend error (`git not installed`, `not a directory`, spawn/timeout,
  authorization rejection) collapses silently into "No Repository," discarding the
  real message in `localError`.
- Silent `home` fallback invites accidental huge directory scans, ambiguous launch
  behavior, and a poor security posture (the app browses `$HOME` with no explicit
  user intent).

## Goals

1. Introduce an **explicit, persisted, single project root** (VS Code single-folder
   model) that is the sole source of truth for the file tree and Source Control.
2. **Pin** that root: terminal cwd, active editor path, and tab focus must not
   mutate the workspace root.
3. Replace the silent `home` fallback with an explicit **empty / no-folder** state.
4. Fix the error-masking defect so genuine backend errors are surfaced distinctly
   from a genuine "no git repository."

## Non-goals (explicitly out of scope)

- **Multi-root workspaces.** Exactly one project folder is open at a time. The data
  model is shaped as a list to leave room for multi-root later, but no multi-root UI
  or logic ships now.
- **Nested-repo discovery / repo selection.** `git rev-parse --show-toplevel` only
  resolves the repo *containing* the provided path. If the opened folder is itself
  not a repo but contains child repos (e.g. `~/work/{app-a/.git, app-b/.git}` with
  `~/work` not a repo), Source Control will correctly show **No Repository**. This is
  acceptable and intended for this spec; nested discovery is future multi-root work.
- **Workspace files** (`.code-workspace`-style multi-folder definitions).
- Changing how new terminals inherit their cwd (`inheritedCwdForNewTab` is unchanged).

## Core invariant

> Once a project root is opened, the file tree and Source Control are rooted in that
> project root until the user explicitly opens or closes a folder. Terminal cwd,
> active editor path, and tab focus do not change either surface.

## Workspace & Source Control states

Two distinct state enums make the `no-folder` ≠ `no-repo` distinction explicit.

```ts
type WorkspaceState = "restoring" | "empty" | "opened";

type SourceControlViewState =
  | "no-folder"   // no project root open — do NOT attempt git discovery
  | "loading"
  | "error"       // a backend error occurred (real message shown)
  | "no-repo"     // valid, accessible folder is open, but no git repo resolved
  | "repo";
```

Meaning of `"no-repo"`: *the selected project folder is a valid, accessible
directory, but git repo resolution found no repository.* Nothing else collapses into
this state.

## Architecture

### New module: `src/modules/workspace/useProjectRoots.ts`

Owns project-root state and lifecycle. Returns:

```ts
{
  roots: string[];            // canonical absolute paths; length 0 or 1 today
  primaryRoot: string | null; // roots[0] ?? null
  isRestoring: boolean;       // true during launch restore — prevents empty-state flicker
  openFolder: () => Promise<void>;
  closeFolder: () => void;
}
```

**`openFolder()`** — the dialog is path-selection only; `workspace_authorize`
remains the security boundary:

```ts
const selected = await open({ directory: true, multiple: false }); // @tauri-apps/plugin-dialog
if (!selected) return;                       // user cancelled
let canonical: string;
try {
  canonical = await native.workspaceAuthorize(selected); // canonicalizes + registers root
} catch (e) {
  // surface the error; DO NOT persist or mutate roots
  return;
}
setRoots([canonical]);
await persistRoots([canonical]);             // persist the canonical path
```

**`closeFolder()`**:

- Clear `roots` → `[]`.
- Persist `[]`.
- Explorer → empty state; Source Control → `no-folder` (not `no-repo`).
- Does **not** kill existing terminals.

**Launch restore / promotion** (runs once at startup; `isRestoring` is `true` until
it settles):

Precedence (highest first):

1. **CLI arg** (`terax /path`) — promoted to a real project root: authorize → set
   `roots[0]` → persist → becomes `primaryRoot`. Behaves exactly like the user chose
   Open Folder.
   - If the CLI path is invalid or `workspace_authorize` fails, show **empty/error**
     state. Do **not** silently restore the previous root — CLI arg has highest
     precedence, so its failure must be visible.
2. **Restored persisted roots** — for each persisted path: `workspace_authorize`
   (canonicalizes; missing/unauthorizable paths throw and are dropped), dedupe,
   take the first (single-root). The in-memory `WorkspaceRegistry` resets per launch,
   so re-authorization here is required.
3. **Empty state** — no CLI arg, nothing restorable.

### CLI vs default launch cwd (important subtlety)

`get_launch_dir` (`src-tauri/src/lib.rs:12-15`) is drained once and returns `Some`
**only** when an explicit directory arg was passed. The current
`src/lib/launchDir.ts` merges `get_launch_dir() ?? workspace_current_dir()` — but
`workspace_current_dir` returns the launch cwd/home, which we must **not** promote to
a project root.

Change: `launchDir.ts` captures the **raw** `get_launch_dir` result separately and
exposes two accessors:

- `getCliDir(): string | undefined` — only the explicit CLI directory arg (used for
  project-root promotion).
- `getLaunchDir(): string | undefined` — existing merged value (used unchanged for
  the **initial terminal's** cwd).

This keeps a single drain of `get_launch_dir` while distinguishing "user asked for
this folder" from "process happened to start here."

### Resolution wiring — `useWorkspaceCwd.ts` + `App.tsx`

Strict, no-leak fallback. `null` means "no folder opened," never "fall back to home":

```ts
// Explorer is pinned hard to the project root.
const explorerRoot = primaryRoot;            // null when no folder open

// Source Control: project root wins; only explicit git tabs may supply a path.
// Terminal cwd / editor path / home MUST NOT leak in.
const gitTabRoot =
  activeTab?.kind === "git-diff" ||
  activeTab?.kind === "git-commit-file" ||
  activeTab?.kind === "git-history"
    ? activeTab.repoRoot
    : null;
const sourceControlContextPath = primaryRoot ?? gitTabRoot ?? null;
```

- The badge context path also keys off `primaryRoot` (no `workspaceFallbackPath`).
- `inheritedCwdForNewTab()` is unchanged — terminals keep their own cwd inheritance.
- Other current consumers of `explorerRoot` (AI composer workspace root at
  `App.tsx:1222,1247`; `NewEditorDialog` rootPath at `App.tsx:1545`) now receive the
  pinned root or `null`; their existing `?? home` guards remain acceptable for those
  surfaces (they are not the workspace-root authority), but they no longer influence
  Explorer or Source Control.

### Error-masking fix — `useSourceControlPanel.ts` + `SourceControlPanel.tsx`

Reorder the panel state machine to the precedence:

```
closed        (sidebar not open)
restoring     → render as loading (prevents flicker)
no-folder     (primaryRoot is null and not restoring)
loading
error         (summary.localError present)
no-repo       (folder open, valid dir, no git repo)
repo
```

The discriminator already exists in `useSourceControl`: a genuine non-repo leaves
`localError === null`; a thrown backend error sets `localError`. The fix is purely in
the **panel** ordering plus passing a `hasFolder` / workspace-state signal into it so
`no-folder` can be distinguished from `no-repo`.

`SourceControlPanel` renders:

- `no-folder`: an **Open Folder** call-to-action (not "No repository").
- `error`: the actual `localError` message (e.g. "git is not installed", "not a
  directory").
- `no-repo`: "No repository — this folder is not inside a Git repository."

### Persistence — `src/modules/settings/store.ts`

Follow the existing `@tauri-apps/plugin-store` (`LazyStore`) pattern
(`store.ts:206-341`):

- Key: `const KEY_PROJECT_ROOTS = "projectRoots";`
- `Preferences.projectRoots: string[]` (default `[]`).
- `loadPreferences()`: `projectRoots: get<string[]>(KEY_PROJECT_ROOTS) ?? []`.
- `export async function setProjectRoots(roots: string[]): Promise<void>` →
  `writePref(KEY_PROJECT_ROOTS, roots)` (auto-emits the cross-window
  `terax://prefs-changed` event).

Stored as an array (room for multi-root) holding 0 or 1 canonical absolute path
today. Paths are the canonical strings returned by `workspace_authorize` (symlink-
resolved), which gives normalization and natural dedupe of path variants.

### Rust / Tauri

- Add `@tauri-apps/plugin-dialog` to `package.json` and `tauri-plugin-dialog` to
  `src-tauri/Cargo.toml`.
- Register `.plugin(tauri_plugin_dialog::init())` in `src-tauri/src/lib.rs`.
- Add the `dialog:default` capability to `src-tauri/capabilities/default.json`.
- No new authorization command: reuse `workspace::workspace_authorize`
  (`src-tauri/src/modules/workspace.rs:124-134`), which canonicalizes, registers the
  root in `WorkspaceRegistry`, and returns the canonical path string.

### UI — `FileExplorer.tsx` + `SidebarPanelHost.tsx`

- Add an **Open Folder** ghost-icon button (FolderOpen icon) to the Explorer header
  toolbar (`FileExplorer.tsx:365-425`), matching the existing button pattern. Threaded
  as `onOpenFolder` (App → `SidebarPanelHost` → `FileExplorer`), alongside the
  existing `onOpenFile` / `onRevealInTerminal` props.
- Replace the empty state (`FileExplorer.tsx:233-247`, currently "No current
  directory" — terminal/cwd language) with project/workspace language and a CTA:

  ```
  No folder opened
  Open a folder to start working in Terax.
  [Open Folder]
  ```

- While `isRestoring`, the Explorer shows a quiet loading state (not the empty CTA),
  to avoid the empty → restored-root flicker.
- Optional (nice-to-have, not required): a command/shortcut (e.g. ⌘O) bound to
  `openFolder`.

## Spec'd behaviors for the two judgment calls (verbatim for implementers)

> When a project root is open, Explorer and Source Control are pinned to that root.
> Terminal cwd, active editor path, and tab focus do not change either surface.
> Terminals may still start in their existing default cwd behavior, but they are no
> longer treated as workspace-root authority.

> When no project root is available from CLI or persisted settings, Terax launches
> into an explicit empty workspace state. It does not fall back to the user's home
> directory. Explorer shows an Open Folder call-to-action, and Source Control shows a
> no-folder state rather than attempting Git discovery against home.

## Testing (TDD)

Frontend (Vitest):

- **Resolution precedence:** `explorerRoot === primaryRoot`; when `primaryRoot` set,
  terminal cwd / editor path do **not** change `explorerRoot` or
  `sourceControlContextPath`. When `primaryRoot` is null, both are `null` (no `home`
  leak); only a git-* tab supplies `sourceControlContextPath`.
- **Launch restore:** CLI arg > restored > empty; missing/unauthorizable persisted
  roots are dropped; CLI-arg failure yields empty/error and does **not** restore the
  previous root; `isRestoring` is true until restore settles.
- **Panel state machine:** `localError` → `error` (with message), not `no-repo`;
  `primaryRoot === null` → `no-folder`, not `no-repo`; genuine non-repo folder →
  `no-repo`; `isRestoring` → loading (no empty flicker).
- **openFolder:** cancel → no-op; authorize failure → no persist, no root mutation,
  error surfaced; success → canonical path set + persisted.

Rust:

- Reuse existing `WorkspaceRegistry` auth tests
  (`src-tauri/src/modules/workspace.rs` `auth_tests`). Add a case only if new Rust
  logic lands (the design reuses `workspace_authorize`, so likely none).

## Files touched

| File | Change |
|------|--------|
| `src/modules/settings/store.ts` | persist `projectRoots: string[]` |
| `src/modules/workspace/useProjectRoots.ts` (new) | root state, open/close/restore, authorize, persist, `isRestoring` |
| `src/lib/launchDir.ts` | expose `getCliDir()` distinct from `getLaunchDir()` |
| `src/app/App.tsx` | wire `primaryRoot` into `explorerRoot` / `sourceControlContextPath`; restore/promote on launch; thread `onOpenFolder`; pass workspace state to SC panel |
| `src/modules/tabs/lib/useWorkspaceCwd.ts` | accept `primaryRoot` override (pin); strict no-leak fallback |
| `src/modules/explorer/FileExplorer.tsx` | Open Folder button; no-folder empty state; restoring state |
| `src/modules/sidebar/SidebarPanelHost.tsx` | thread `onOpenFolder` |
| `src/modules/source-control/useSourceControlPanel.ts` | state-machine reorder; `no-folder` vs `no-repo` |
| `src/modules/source-control/SourceControlPanel.tsx` | render `no-folder` / `error` / `no-repo` distinctly |
| `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` | dialog plugin + capability |
| `package.json` | `@tauri-apps/plugin-dialog` |
```
