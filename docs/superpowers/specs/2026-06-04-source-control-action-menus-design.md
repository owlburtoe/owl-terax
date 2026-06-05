# Source Control Action Menus — Design

Date: 2026-06-04
Status: Approved for planning
Scope: Sub-project A of a three-part source control expansion

## Context

Terax's source control panel today exposes commit and push as two flat buttons,
plus header icons for fetch, fast-forward pull, and refresh. The backend
(`src-tauri/src/modules/git/`) already provides `git_status`, `git_diff`,
`git_stage`, `git_unstage`, `git_discard`, `git_commit`, `git_fetch`,
`git_pull_ff_only`, `git_push`, `git_log`, and commit-inspection commands, all
gated through the workspace authorization registry.

The goal is to bring the panel closer to the VSCode source control action
surface using split-buttons, without building the full ~30-command suite in one
pass. The work is decomposed into three independent specs:

- **A. Action menus** (this spec) — split-button suite for commit and remote
  variations. Reuses most existing backend; adds a few thin variants.
- **B. Branches** — create / switch / publish / rename / delete (own spec).
- **C. Stash** — stash / apply / pop / drop / list (own spec).

A is built first: highest value per unit of new backend, and it directly
answers the original request (a dropdown of actions next to the buttons).

## Goals

- Replace the flat Commit / Push row with two split-buttons: a Commit
  split-button and a Sync split-button.
- Replace the standalone header Pull icon with a Fetch split-button (Fetch /
  Fetch Prune); keep Refresh.
- Add commit variations (Commit & Push, Commit & Sync, Amend, Commit All) and
  remote variations (Push, Pull, Pull Rebase, Force Push, Sync, Fetch Prune).
- Guard destructive actions (Force Push, Amend of published history) safely by
  default.

## Non-goals (YAGNI)

Not built in this spec:

- Push to… / Pull from… remote pickers.
- Interactive rebase, merge, signed commits, cherry-pick.
- Branch and stash operations (separate specs B and C).

## UI components

### 1. Commit split-button (left, sticky default)

- The main button runs the remembered action. The caret opens a menu:
  - `Commit`
  - `Commit & Push`
  - `Commit & Sync`
  - (separator)
  - `Amend Last Commit`
  - `Commit All` — stage all tracked changes (`git add -u`), then commit
- Choosing a menu item runs it and sets it as the new sticky default. A check
  marks the current default.
- The sticky default persists across sessions in the preferences store.
- Disabled state and tooltip hints reuse the existing `canCommit`,
  `commitHint`, and `commitDisabledReason` logic. `Commit All` is enabled when
  there are unstaged tracked changes even if nothing is staged yet.

#### Commit All semantics

`Commit All` stages all modified and deleted tracked files using `git add -u`,
then commits. It does **not** stage untracked files (no `git add .`). This
matches the label and VSCode's "Commit All" behavior.

#### Amend semantics

`Amend Last Commit` uses the current commit message input as the replacement
message and runs `git commit --amend -m <message>`. If the input is empty, it
fails through the same validation path as a normal commit (no silent
`--no-edit`). Amending without editing the message is out of scope for this
spec.

### 2. Sync split-button (right)

- Main button = `Sync` (fetch, then fast-forward pull, then push).
- Caret menu:
  - `Push`
  - `Pull`
  - `Pull (Rebase)`
  - (separator)
  - `Force Push (lease)`
- Sync is *not* sticky; the main action is always Sync. The caret is for the
  one-off variants. Choosing Push or Pull from the caret runs that action but
  does not change the main button.
- `Force Push (lease)` is disabled unless the current branch has a configured
  upstream. Publishing a new branch is out of scope (Branches spec).

### 3. Header: Fetch split + Refresh

- The standalone Pull icon is removed (Pull now lives in the Sync menu).
- The Fetch icon becomes a split-button with a caret menu: `Fetch` /
  `Fetch (Prune)`.
- Fetch gets a dedicated cloud-download glyph, visually distinct from the
  Pull/download glyph used elsewhere. Exact icon chosen during implementation;
  reviewable.
- Refresh icon is unchanged.

### Shared primitive

Introduce a small reusable `SplitButton` component (shadcn `Button` +
`DropdownMenu`) and a `GitActionMenu` that renders the action list. All three
split-buttons compose these, so menu behavior, keyboard handling, and disabled
states are implemented and tested once. Keeps `SourceControlPanel.tsx` from
growing further and matches the project's many-small-files architecture rule.

## Behavior and safety

- **Amend**: shows a confirm dialog when HEAD appears to be published according
  to the configured upstream tracking ref. A helper `isHeadLikelyPublished`
  treats HEAD as published when an upstream is configured and the local branch
  is not ahead of its upstream per the last known tracking ref. If branch or
  upstream state cannot be determined safely, the confirm dialog is shown
  (fail safe — never silently amend possibly-published history). Otherwise
  amend runs directly. Reuses the existing `AlertDialog` used for discard.
- **Force Push**: always uses `--force-with-lease` and always shows a confirm
  dialog. The lease means a stale remote rejects the push instead of clobbering
  someone else's work. Disabled when no upstream is configured (see Sync menu).
- **Divergence**: Sync and Pull stay fast-forward-only. On a non-fast-forward
  they fail cleanly with a message pointing the user to `Pull (Rebase)`. No
  implicit merge commits are ever created.
- **Sync pipeline** = Fetch → Pull (ff-only) → Push. Failure reporting
  identifies the phase that failed (`Fetch failed`, `Pull failed`, or
  `Push failed`) so a user whose fetch+pull succeeded but push failed sees
  exactly that, not a vague "sync failed".
- **Composite actions** (Commit & Push, Commit & Sync): the commit runs first.
  If the commit succeeds but the remote step fails, the commit is kept and the
  remote error is surfaced in the feedback banner. The outcome is reported
  faithfully (committed, then the failing phase) rather than presented as a
  single all-or-nothing result.

## Backend

New gated commands in `git/commands.rs` with operations in `operations.rs`,
following the exact existing pattern (`WorkspaceEnv::from_option`, `blocking`,
`authorized_repo_root`, `ensure_git_available`, `NETWORK_TIMEOUT_SECS` for
remote operations):

- `git_commit_amend(repo_root, message)` — `git commit --amend -m <message>`.
  Empty message fails through the same validation as `git_commit`.
- `git_push_force_with_lease(repo_root)` — `git push --force-with-lease`.
  Returns a clear error when no upstream is configured (frontend also disables
  it; backend still guards).
- `git_pull_rebase(repo_root)` — `git pull --rebase`, run non-interactively (no
  editor prompt, no interactive credential hang; bounded by
  `NETWORK_TIMEOUT_SECS`). Typed cases:

  | Case | Mapped error |
  | --- | --- |
  | rebase hits conflicts | `RebaseConflict` |
  | unstaged local changes block rebase | `WorkingTreeDirty` or existing normalized git error |
  | remote diverged but rebase succeeds | success |
  | auth / network timeout | existing network error path |

  Do not introduce a new error variant if the existing taxonomy already covers
  the case.
- `git_fetch_prune(repo_root)` — `git fetch --prune`, via the same
  authorization path as `git_fetch`.

Composed client-side (no new backend):

- **Sync** = `gitFetch` then `gitPullFfOnly` then `gitPush`, with phase-aware
  error reporting (see Sync pipeline above).
- **Commit All** = `gitStage` of tracked changes (`git add -u`) then `gitCommit`.

Internal helper (only if warranted): if `fetch`/`pull`/`push` end up repeating
network/timeout setup, factor a private `run_git_remote_command_with_timeout`
helper. Do **not** refactor the existing remote operations during this
sub-project unless that duplication actually appears.

## Frontend wiring

- New `native.ts` wrappers: `gitCommitAmend`, `gitPushForceWithLease`,
  `gitPullRebase`, `gitFetchPrune`.
- Extend `SourceControlRemoteAction` with `force-push`, `pull-rebase`,
  `fetch-prune`, `sync`, and route them through `runRemoteAction`.
- `useSourceControlPanel` gains: `amend`, `commitAll`, `commitAndPush`,
  `commitAndSync`, the sticky-default state, and the published-HEAD check that
  drives the amend confirm gate.

### File layout

`SourceControlPanel.tsx` stays composition-only. It must not become the action
router; that logic lives in the hooks below.

```
src/modules/source-control/
  components/
    SplitButton.tsx
    GitActionMenu.tsx
    CommitSplitButton.tsx
    SyncSplitButton.tsx
    FetchSplitButton.tsx
  hooks/
    useSourceControlActions.ts        # runs amend / commitAll / composites / remote variants
    useCommitDefaultPreference.ts     # sticky default persistence
  types/
    actions.ts                        # action union + menu item descriptors
```

In the panel:

```tsx
<FetchSplitButton ... />
<CommitSplitButton ... />
<SyncSplitButton ... />
```

## Error handling

Reuses `normalizeError` and the `CommitFeedback` banner. New typed Rust errors
with actionable messages:

- `NotFastForward` — "Remote has diverged. Use Pull (Rebase) to integrate."
- `RebaseConflict` — "Rebase hit conflicts. Resolve them in the terminal."
- `ForcePushRejected` — "Remote moved since your last fetch. Fetch and review
  before force pushing."

Reuse existing normalized errors where they fit (e.g. a dirty working tree
blocking rebase) rather than minting new variants.

## Testing

Per the quality bar, each gated subsystem change locks an invariant.

Rust (`operations` tests, mirroring existing ones):

- Amend rewrites HEAD (parent unchanged, message/tree updated).
- Force-with-lease is rejected when the remote ref is stale.
- Pull rebase surfaces a conflict as `RebaseConflict` rather than hanging.
- Fetch prune removes refs deleted on the remote.
- Each new command rejects unauthorized repo roots (gating invariant).

Frontend:

- `SplitButton`: keyboard open/close, disabled main vs. enabled menu, focus.
- Sticky default persists and round-trips through the preferences store.
- Composite commit-then-remote reports partial failure (commit kept, remote
  error shown).
- Amend confirm gate fires only when HEAD is published; runs directly
  otherwise.

## Acceptance criteria

UI:

- Main Commit button label changes to match the sticky default.
- Menu item checkmark reflects the persisted default after a reload.
- Disabled menu items still render with an explanatory tooltip / accessible
  label.
- Commit All does not stage untracked files.
- Sync does not become sticky even after choosing Push or Pull from its caret.
- Force Push is disabled (and labeled why) when no upstream is configured.

Backend:

- `git_push_force_with_lease` rejects with a clear error when there is no
  upstream (and the frontend disables the action).
- `git_pull_rebase` does not leave the UI stuck in a loading state after a
  conflict — it resolves to a typed error.
- `git_fetch_prune` uses the same authorization path as `git_fetch`.
- `git_commit_amend` with an empty message fails like a normal empty commit.

## Implementation order

1. Add Rust commands and tests (`git_commit_amend`, `git_push_force_with_lease`,
   `git_pull_rebase`, `git_fetch_prune`).
2. Add `native.ts` wrappers.
3. Add the action type model (`types/actions.ts`).
4. Build `SplitButton` + tests.
5. Add `CommitSplitButton`, `SyncSplitButton`, `FetchSplitButton`.
6. Wire into `useSourceControlPanel` via `useSourceControlActions`.
7. Add the sticky default preference (`useCommitDefaultPreference`).
8. Add the confirm gates (amend-when-published, force push).
9. Add composite + phase-aware feedback tests.
10. Run full verification.

## Verification

`pnpm exec tsc --noEmit`, `pnpm test`, `cd src-tauri && cargo clippy && cargo
test --locked` must all pass before the work is considered done.
