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
  - `Commit All` — stage all tracked changes, then commit
- Choosing a menu item runs it and sets it as the new sticky default. A check
  marks the current default.
- The sticky default persists across sessions in the preferences store.
- Disabled state and tooltip hints reuse the existing `canCommit`,
  `commitHint`, and `commitDisabledReason` logic. `Commit All` is enabled when
  there are unstaged tracked changes even if nothing is staged yet.

### 2. Sync split-button (right)

- Main button = `Sync` (fetch, then fast-forward pull, then push).
- Caret menu:
  - `Push`
  - `Pull`
  - `Pull (Rebase)`
  - (separator)
  - `Force Push (lease)`
- Sync is *not* sticky; the main action is always Sync. The caret is for the
  one-off variants.

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

- **Amend**: shows a confirm dialog *only* when HEAD is already published
  (upstream is set and `ahead === 0`, meaning the tip commit exists on the
  remote). Otherwise it runs directly. Reuses the existing `AlertDialog`
  used for discard.
- **Force Push**: always uses `--force-with-lease` and always shows a confirm
  dialog. The lease means a stale remote rejects the push instead of clobbering
  someone else's work.
- **Divergence**: Sync and Pull stay fast-forward-only. On a non-fast-forward
  they fail cleanly with a message pointing the user to `Pull (Rebase)`. No
  implicit merge commits are ever created.
- **Composite actions** (Commit & Push, Commit & Sync): the commit runs first.
  If the commit succeeds but the remote step fails, the commit is kept and the
  remote error is surfaced in the feedback banner. The outcome is reported
  faithfully (committed, then push/sync failed) rather than presented as a
  single all-or-nothing result.

## Backend

New gated commands in `git/commands.rs` with operations in `operations.rs`,
following the exact existing pattern (`WorkspaceEnv::from_option`, `blocking`,
`authorized_repo_root`, `ensure_git_available`, `NETWORK_TIMEOUT_SECS` for
remote operations):

- `git_commit_amend(repo_root, message)` — `git commit --amend -m <message>`.
- `git_push_force_with_lease(repo_root)` — `git push --force-with-lease`.
- `git_pull_rebase(repo_root)` — `git pull --rebase`; surfaces conflict/abort
  state as a typed error.
- `git_fetch_prune(repo_root)` — `git fetch --prune`.

Composed client-side (no new backend):

- **Sync** = `gitFetch` then `gitPullFfOnly` then `gitPush`.
- **Commit All** = `gitStage(all tracked)` then `gitCommit`.

## Frontend wiring

- New `native.ts` wrappers: `gitCommitAmend`, `gitPushForceWithLease`,
  `gitPullRebase`, `gitFetchPrune`.
- Extend `SourceControlRemoteAction` with `force-push`, `pull-rebase`,
  `fetch-prune`, `sync`, and route them through `runRemoteAction`.
- `useSourceControlPanel` gains: `amend`, `commitAll`, `commitAndPush`,
  `commitAndSync`, the sticky-default state, and the published-HEAD check that
  drives the amend confirm gate.

## Error handling

Reuses `normalizeError` and the `CommitFeedback` banner. New typed Rust errors
with actionable messages:

- `NotFastForward` — "Remote has diverged. Use Pull (Rebase) to integrate."
- `RebaseConflict` — "Rebase hit conflicts. Resolve them in the terminal."
- `ForcePushRejected` — "Remote moved since your last fetch. Fetch and review
  before force pushing."

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

## Verification

`pnpm exec tsc --noEmit`, `pnpm test`, `cd src-tauri && cargo clippy && cargo
test --locked` must all pass before the work is considered done.
