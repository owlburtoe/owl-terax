# Source Control Action Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Commit / Push button row with a sticky Commit split-button and a Sync split-button, add a Fetch split-button in the header, and back them with new gated git commands (amend, force-with-lease, pull-rebase, plain fetch + fetch-prune).

**Architecture:** New git operations follow the existing functional-core pattern in `src-tauri/src/modules/git/operations.rs` (pure-ish wrappers over `run_git`, gated through `authorized_repo_root`), exposed as thin Tauri commands. The frontend gets a reusable `SplitButton` primitive plus three composed buttons, a sticky-default preference, and an actions hook; `SourceControlPanel.tsx` stays composition-only.

**Tech Stack:** Rust (Tauri 2, `portable-pty`-style command exec), React 19 + TypeScript, shadcn `Button` + `DropdownMenu`, Zustand preferences store, vitest (node env), `cargo test` with `tempfile`.

---

## Decisions baked into this plan (from spec review)

- **Fetch split = plain + prune.** Existing `operations::fetch` runs `git fetch --prune`. We change it to plain `git fetch` and add `fetch_prune` (`git fetch --prune`). Internal auto-fetch and the fetch-before-pull keep pruning by calling the prune variant.
- **Backend tests = harness for risky ops only.** A `tempfile`-based git-repo harness covers amend (rewrites HEAD) and force-with-lease (stale rejection). Fetch / pull-rebase / divergence are covered by pure stderr-classifier unit tests. `tempfile = "3"` is already a dependency.
- **Frontend tests = pure logic only.** The repo has no DOM test setup (`@testing-library/react`/jsdom absent). We unit-test the action model, sticky-default reducer, `isHeadLikelyPublished`, and composite/phase sequencing. SplitButton interaction is verified manually (see Manual Verification).

## File structure

Backend (`src-tauri/src/modules/git/`):
- `errors.rs` — add `NotFastForward`, `RebaseConflict`, `ForcePushRejected` variants + Display.
- `operations.rs` — add `classify_ff_pull_failure`, `classify_pull_rebase_failure`, `classify_force_push_failure`; modify `fetch`; add `fetch_prune`, `commit_amend`, `push_force_with_lease`, `pull_rebase`; add `#[cfg(test)] mod tests` with the repo harness.
- `commands.rs` — add `git_fetch_prune`, `git_commit_amend`, `git_push_force_with_lease`, `git_pull_rebase`.
- `src-tauri/src/lib.rs` — register the four new commands.

Frontend (`src/`):
- `modules/ai/lib/native.ts` — add `gitFetchPrune`, `gitCommitAmend`, `gitPushForceWithLease`, `gitPullRebase`.
- `modules/settings/store.ts` — add `scmCommitDefaultAction` to `Preferences` + load/save/default.
- `modules/source-control/types/actions.ts` (new) — `CommitAction` union, menu descriptors, `isHeadLikelyPublished`.
- `modules/source-control/types/actions.test.ts` (new) — unit tests.
- `modules/source-control/components/SplitButton.tsx` (new) — reusable primitive.
- `modules/source-control/components/CommitSplitButton.tsx` (new).
- `modules/source-control/components/SyncSplitButton.tsx` (new).
- `modules/source-control/components/FetchSplitButton.tsx` (new).
- `modules/source-control/hooks/useCommitDefaultPreference.ts` (new) + test.
- `modules/source-control/hooks/useSourceControlActions.ts` (new) + test.
- `modules/source-control/useSourceControl.ts` — extend `SourceControlRemoteAction` + `runRemoteAction`.
- `modules/source-control/SourceControlPanel.tsx` — swap the button row (lines ~748-792) and header (lines ~558-618) for the new components + amend/force-push confirm gates.

---

## Verification gates (mirror CI exactly)

CI (`.forgejo/workflows/ci.yml`) is the source of truth. Every task's checks are
a subset of these; the final task runs the full set. Run from the repo root
unless noted.

Frontend:
- `pnpm exec tsc --noEmit` — type-check
- `pnpm test` — vitest (run mode)
- `pnpm build` — `tsc && vite build` (full production build; the heaviest gate)

Rust (`working-directory: src-tauri`):
- `cargo check --all-targets --locked`
- `cargo clippy --all-targets --locked -- -D warnings` — **warnings fail CI**, so
  the new test harness code must be clippy-clean too (`--all-targets` includes tests)
- `cargo test --locked`

During a task you may scope the Rust run (e.g. `cargo test --locked git::`) for
speed, but before committing a backend task run
`cargo clippy --all-targets --locked -- -D warnings` so a warning in test code
does not surface only at the final gate. There is no eslint/prettier/biome and
no `cargo fmt` check in this repo; do not invent one.

---

## Backend

### Task B1: New typed git errors

**Files:**
- Modify: `src-tauri/src/modules/git/errors.rs`

- [ ] **Step 1: Add the variants**

In the `GitError` enum (after `EmptyCommitMessage`, before `CommandFailed`):

```rust
    EmptyCommitMessage,
    NotFastForward,
    RebaseConflict,
    ForcePushRejected,
    CommandFailed {
```

- [ ] **Step 2: Add Display arms**

In `impl Display`, after the `EmptyCommitMessage` arm:

```rust
            GitError::EmptyCommitMessage => write!(f, "commit message cannot be empty"),
            GitError::NotFastForward => write!(
                f,
                "remote has diverged; cannot fast-forward. Use Pull (Rebase) to integrate."
            ),
            GitError::RebaseConflict => write!(
                f,
                "rebase hit conflicts. Resolve them in the terminal, then continue or abort."
            ),
            GitError::ForcePushRejected => write!(
                f,
                "remote moved since your last fetch. Fetch and review before force pushing."
            ),
```

- [ ] **Step 3: Add a Display unit test**

Append to `errors.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::GitError;

    #[test]
    fn diverged_errors_have_actionable_messages() {
        assert!(GitError::NotFastForward
            .to_string()
            .contains("Pull (Rebase)"));
        assert!(GitError::RebaseConflict.to_string().contains("conflicts"));
        assert!(GitError::ForcePushRejected
            .to_string()
            .contains("force pushing"));
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test --locked git::errors`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/git/errors.rs
git commit -m "feat(git): add diverged/rebase/force-push error variants"
```

---

### Task B2: stderr classifiers (pure)

**Files:**
- Modify: `src-tauri/src/modules/git/operations.rs`

- [ ] **Step 1: Write the failing tests**

Add a test module at the end of `operations.rs` (the file has no `mod tests` yet):

```rust
#[cfg(test)]
mod tests {
    use super::{
        classify_ff_pull_failure, classify_force_push_failure, classify_pull_rebase_failure,
    };
    use crate::modules::git::errors::GitError;

    #[test]
    fn ff_pull_non_fast_forward_maps_to_not_fast_forward() {
        let err = classify_ff_pull_failure("fatal: Not possible to fast-forward, aborting.");
        assert!(matches!(err, GitError::NotFastForward));
    }

    #[test]
    fn rebase_conflict_maps_to_rebase_conflict() {
        let err = classify_pull_rebase_failure(
            "error: could not apply a1b2c3d... CONFLICT (content): Merge conflict in foo.rs",
        );
        assert!(matches!(err, GitError::RebaseConflict));
    }

    #[test]
    fn rebase_with_local_changes_is_not_a_conflict() {
        let err = classify_pull_rebase_failure(
            "error: cannot pull with rebase: You have unstaged changes.",
        );
        assert!(matches!(err, GitError::CommandFailed { .. }));
    }

    #[test]
    fn stale_lease_maps_to_force_push_rejected() {
        let err = classify_force_push_failure(
            "! [rejected] main -> main (stale info)\nerror: failed to push some refs",
        );
        assert!(matches!(err, GitError::ForcePushRejected));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test --locked git::operations::tests`
Expected: FAIL to compile ("cannot find function `classify_ff_pull_failure`").

- [ ] **Step 3: Implement the classifiers**

Add near the top of `operations.rs` (after the `use` block, before `resolve_repo`):

```rust
fn classify_ff_pull_failure(stderr: &str) -> GitError {
    let s = stderr.to_ascii_lowercase();
    if s.contains("not possible to fast-forward") || s.contains("non-fast-forward") {
        GitError::NotFastForward
    } else {
        GitError::command("git pull --ff-only failed", stderr.trim().to_string())
    }
}

fn classify_pull_rebase_failure(stderr: &str) -> GitError {
    let s = stderr.to_ascii_lowercase();
    if s.contains("could not apply") || s.contains("conflict") || s.contains("needs merge") {
        GitError::RebaseConflict
    } else if s.contains("cannot pull with rebase")
        || s.contains("unstaged changes")
        || s.contains("uncommitted changes")
    {
        GitError::command(
            "git pull --rebase",
            "you have local changes; commit or stash them first",
        )
    } else {
        GitError::command("git pull --rebase failed", stderr.trim().to_string())
    }
}

fn classify_force_push_failure(stderr: &str) -> GitError {
    let s = stderr.to_ascii_lowercase();
    if s.contains("stale info") || (s.contains("[rejected]") && s.contains("->")) {
        GitError::ForcePushRejected
    } else {
        GitError::command(
            "git push --force-with-lease failed",
            stderr.trim().to_string(),
        )
    }
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test --locked git::operations::tests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/git/operations.rs
git commit -m "feat(git): classify ff-pull/rebase/force-push failures"
```

---

### Task B3: Split fetch into plain + prune

**Files:**
- Modify: `src-tauri/src/modules/git/operations.rs:911-925` (the `fetch` fn)
- Modify: `src-tauri/src/modules/git/commands.rs`
- Modify: `src-tauri/src/lib.rs:157`

- [ ] **Step 1: Change `fetch` to plain and add `fetch_prune`**

Replace the existing `fetch` function (operations.rs ~911-925) with:

```rust
pub fn fetch(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        ["fetch"],
        NETWORK_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git fetch failed")
}

pub fn fetch_prune(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        ["fetch", "--prune"],
        NETWORK_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git fetch --prune failed")
}
```

- [ ] **Step 2: Add the `git_fetch_prune` command**

In `commands.rs`, after the `git_fetch` command (~line 168):

```rust
#[tauri::command]
pub async fn git_fetch_prune(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::fetch_prune(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}
```

- [ ] **Step 3: Register the command**

In `lib.rs`, after `git::commands::git_fetch,` (line 157):

```rust
            git::commands::git_fetch,
            git::commands::git_fetch_prune,
```

- [ ] **Step 4: Verify it builds + clippy is clean (CI form)**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked git::`
Expected: clean clippy (no warnings), all existing git tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/git/operations.rs src-tauri/src/modules/git/commands.rs src-tauri/src/lib.rs
git commit -m "feat(git): split fetch into plain and prune variants"
```

---

### Task B4: Test harness + amend operation

**Files:**
- Modify: `src-tauri/src/modules/git/operations.rs` (add to `mod tests` + new `commit_amend` fn)
- Modify: `src-tauri/src/modules/git/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing harness + amend test**

Add to the `mod tests` in `operations.rs` (extend the imports and body from B2):

```rust
    use super::{commit, commit_amend, stage};
    use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};
    use std::process::Command;

    fn git(dir: &std::path::Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .status()
            .expect("git runs");
        assert!(status.success(), "git {args:?} failed");
    }

    /// Create an authorized temp repo with one initial commit. Returns (registry, root, env).
    fn repo_with_initial_commit(
    ) -> (WorkspaceRegistry, String, WorkspaceEnv, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path();
        git(path, &["init", "-q", "-b", "main"]);
        git(path, &["config", "user.email", "test@terax.dev"]);
        git(path, &["config", "user.name", "Terax Test"]);
        std::fs::write(path.join("a.txt"), "one\n").unwrap();
        git(path, &["add", "a.txt"]);
        git(path, &["commit", "-q", "-m", "chore: initial"]);
        let registry = WorkspaceRegistry::default();
        let root = registry.authorize(path).unwrap();
        (
            registry,
            root.to_string_lossy().into_owned(),
            WorkspaceEnv::Local,
            dir,
        )
    }

    fn head_subject(dir: &std::path::Path) -> String {
        let out = Command::new("git")
            .args(["show", "-s", "--format=%s", "HEAD"])
            .current_dir(dir)
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn rev(dir: &std::path::Path, spec: &str) -> String {
        let out = Command::new("git")
            .args(["rev-parse", spec])
            .current_dir(dir)
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    #[test]
    fn amend_rewrites_head_keeps_parent() {
        let (registry, root, env, dir) = repo_with_initial_commit();
        let parent_before = rev(dir.path(), "HEAD~0").is_empty(); // sanity: HEAD exists
        assert!(!parent_before);
        std::fs::write(dir.path().join("a.txt"), "two\n").unwrap();
        stage(&registry, &root, &["a.txt".to_string()], &env).unwrap();

        commit_amend(&registry, &root, "chore: amended subject", &env).unwrap();

        assert_eq!(head_subject(dir.path()), "chore: amended subject");
        // Amending the root commit leaves it parentless; assert it is still a single commit.
        let count = Command::new("git")
            .args(["rev-list", "--count", "HEAD"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&count.stdout).trim(), "1");
    }

    #[test]
    fn amend_empty_message_is_rejected() {
        let (registry, root, env, _dir) = repo_with_initial_commit();
        let err = commit_amend(&registry, &root, "   ", &env).unwrap_err();
        assert!(matches!(err, GitError::EmptyCommitMessage));
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test --locked git::operations::tests::amend`
Expected: FAIL to compile ("cannot find function `commit_amend`").

- [ ] **Step 3: Implement `commit_amend`**

In `operations.rs`, after the `commit` fn (~line 425):

```rust
pub fn commit_amend(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    message: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitCommitResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let trimmed = message.trim();
    if trimmed.is_empty() {
        return Err(GitError::EmptyCommitMessage);
    }

    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        [
            OsStr::new("commit"),
            OsStr::new("--amend"),
            OsStr::new("-m"),
            OsStr::new(trimmed),
        ],
        DEFAULT_TIMEOUT_SECS,
    )?;
    ensure_success(&output, "git commit --amend failed")?;

    let combined = git_stdout_lines(
        &repo_root.workspace,
        &repo_root.git_path,
        ["show", "-s", "--format=%H%n%s", "HEAD"],
    )?;
    let sha = combined.first().cloned().ok_or(GitError::CommandFailed {
        context: "failed to resolve amended commit sha",
        detail: String::new(),
    })?;
    let summary = combined.get(1).cloned().unwrap_or_default();
    Ok(GitCommitResult {
        commit_sha: sha,
        summary,
    })
}
```

- [ ] **Step 4: Add command + register**

In `commands.rs`, after `git_commit`:

```rust
#[tauri::command]
pub async fn git_commit_amend(
    repo_root: String,
    message: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitCommitResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::commit_amend(r, &repo_root, &message, &workspace).map_err(Into::into)
    })
    .await
}
```

In `lib.rs`, after `git::commands::git_commit,` (line 156):

```rust
            git::commands::git_commit,
            git::commands::git_commit_amend,
```

- [ ] **Step 5: Run tests + commit**

Run: `cd src-tauri && cargo test --locked git::operations::tests::amend`
Expected: PASS (2 tests).

```bash
git add src-tauri/src/modules/git/operations.rs src-tauri/src/modules/git/commands.rs src-tauri/src/lib.rs
git commit -m "feat(git): add commit --amend operation with HEAD-rewrite test"
```

---

### Task B5: Force push with lease

**Files:**
- Modify: `src-tauri/src/modules/git/operations.rs` (new fn + test)
- Modify: `src-tauri/src/modules/git/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Add to `mod tests` in `operations.rs` (extend `use super::{...}` to include `push_force_with_lease`):

```rust
    /// Build an origin bare repo + a clone with upstream tracking. Returns clone harness.
    fn clone_with_upstream(
    ) -> (WorkspaceRegistry, String, WorkspaceEnv, tempfile::TempDir, tempfile::TempDir) {
        let origin = tempfile::tempdir().unwrap();
        git(origin.path(), &["init", "-q", "--bare", "-b", "main"]);
        let work = tempfile::tempdir().unwrap();
        git(
            work.path(),
            &["clone", "-q", origin.path().to_str().unwrap(), "."],
        );
        git(work.path(), &["config", "user.email", "test@terax.dev"]);
        git(work.path(), &["config", "user.name", "Terax Test"]);
        std::fs::write(work.path().join("a.txt"), "one\n").unwrap();
        git(work.path(), &["add", "a.txt"]);
        git(work.path(), &["commit", "-q", "-m", "chore: initial"]);
        git(work.path(), &["push", "-q", "-u", "origin", "main"]);
        let registry = WorkspaceRegistry::default();
        let root = registry.authorize(work.path()).unwrap();
        (
            registry,
            root.to_string_lossy().into_owned(),
            WorkspaceEnv::Local,
            origin,
            work,
        )
    }

    #[test]
    fn force_push_rejected_when_lease_is_stale() {
        let (registry, root, env, origin, work) = clone_with_upstream();
        // Another clone advances origin behind our back -> our lease is now stale.
        let other = tempfile::tempdir().unwrap();
        git(
            other.path(),
            &["clone", "-q", origin.path().to_str().unwrap(), "."],
        );
        git(other.path(), &["config", "user.email", "o@terax.dev"]);
        git(other.path(), &["config", "user.name", "Other"]);
        std::fs::write(other.path().join("b.txt"), "x\n").unwrap();
        git(other.path(), &["add", "b.txt"]);
        git(other.path(), &["commit", "-q", "-m", "chore: other"]);
        git(other.path(), &["push", "-q", "origin", "main"]);

        // We rewrite our local commit but never fetched the new origin tip.
        std::fs::write(work.path().join("a.txt"), "two\n").unwrap();
        git(work.path(), &["commit", "-q", "-am", "chore: local rewrite"]);

        let err = push_force_with_lease(&registry, &root, &env).unwrap_err();
        assert!(matches!(err, GitError::ForcePushRejected));
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test --locked git::operations::tests::force_push`
Expected: FAIL to compile ("cannot find function `push_force_with_lease`").

- [ ] **Step 3: Implement `push_force_with_lease`**

In `operations.rs`, after the `push` fn (~line 459):

```rust
pub fn push_force_with_lease(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<GitPushResult> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;

    let upstream = git_stdout_line_opt(
        &repo_root.workspace,
        &repo_root.git_path,
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )?;
    if upstream.is_none() {
        return Err(GitError::NoUpstream);
    }

    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        ["push", "--force-with-lease"],
        NETWORK_TIMEOUT_SECS,
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git push --force-with-lease"));
    }
    if output.exit_code != Some(0) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(classify_force_push_failure(&stderr));
    }

    let upstream = upstream.unwrap();
    let (remote, branch) = split_upstream(&upstream);
    Ok(GitPushResult {
        remote,
        branch,
        pushed: true,
    })
}
```

- [ ] **Step 4: Add command + register**

In `commands.rs`, after `git_push`:

```rust
#[tauri::command]
pub async fn git_push_force_with_lease(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitPushResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::push_force_with_lease(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}
```

In `lib.rs`, after `git::commands::git_push,` (line 159):

```rust
            git::commands::git_push,
            git::commands::git_push_force_with_lease,
```

- [ ] **Step 5: Run tests + commit**

Run: `cd src-tauri && cargo test --locked git::operations::tests::force_push`
Expected: PASS.

```bash
git add src-tauri/src/modules/git/operations.rs src-tauri/src/modules/git/commands.rs src-tauri/src/lib.rs
git commit -m "feat(git): add force-with-lease push with stale-lease test"
```

---

### Task B6: Pull with rebase

**Files:**
- Modify: `src-tauri/src/modules/git/operations.rs`
- Modify: `src-tauri/src/modules/git/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement `pull_rebase`**

In `operations.rs`, after `pull_ff_only` (~line 941):

```rust
pub fn pull_rebase(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        ["pull", "--rebase"],
        NETWORK_TIMEOUT_SECS,
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git pull --rebase"));
    }
    if output.exit_code != Some(0) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(classify_pull_rebase_failure(&stderr));
    }
    Ok(())
}
```

Note: `run_git` already sets `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=""`, `GCM_INTERACTIVE=Never` (process.rs:253-259), so the rebase runs non-interactively and a conflict returns non-zero rather than hanging.

- [ ] **Step 2: Also harden ff-pull divergence (reuse classifier)**

Replace the body tail of `pull_ff_only` so a non-fast-forward returns `NotFastForward`:

```rust
pub fn pull_ff_only(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    workspace: &WorkspaceEnv,
) -> Result<()> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    ensure_git_available(&repo_root.workspace)?;
    let output = run_git(
        &repo_root.workspace,
        Some(&repo_root.git_path),
        ["pull", "--ff-only"],
        NETWORK_TIMEOUT_SECS,
    )?;
    if output.timed_out {
        return Err(GitError::TimedOut("git pull --ff-only"));
    }
    if output.exit_code != Some(0) {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(classify_ff_pull_failure(&stderr));
    }
    Ok(())
}
```

- [ ] **Step 3: Add command + register**

In `commands.rs`, after `git_pull_ff_only`:

```rust
#[tauri::command]
pub async fn git_pull_rebase(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<(), String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |r| {
        operations::pull_rebase(r, &repo_root, &workspace).map_err(Into::into)
    })
    .await
}
```

In `lib.rs`, after `git::commands::git_pull_ff_only,` (line 158):

```rust
            git::commands::git_pull_ff_only,
            git::commands::git_pull_rebase,
```

- [ ] **Step 4: Verify build + full git tests + clippy (CI form)**

Run: `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked git::`
Expected: clean clippy (no warnings), all PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/git/operations.rs src-tauri/src/modules/git/commands.rs src-tauri/src/lib.rs
git commit -m "feat(git): add pull --rebase and harden ff-pull divergence"
```

---

## Frontend

### Task F1: native.ts wrappers

**Files:**
- Modify: `src/modules/ai/lib/native.ts:307-321`

- [ ] **Step 1: Add the four wrappers**

After `gitFetch` (line 311), add:

```typescript
  gitFetchPrune: (repoRoot: string) =>
    invoke<void>("git_fetch_prune", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
```

After `gitCommit` (line 306), add:

```typescript
  gitCommitAmend: (repoRoot: string, message: string) =>
    invoke<GitCommitResult>("git_commit_amend", {
      repoRoot,
      message,
      workspace: currentWorkspaceEnv(),
    }),
```

After `gitPullFfOnly` (line 316), add:

```typescript
  gitPullRebase: (repoRoot: string) =>
    invoke<void>("git_pull_rebase", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
```

After `gitPush` (line 321), add:

```typescript
  gitPushForceWithLease: (repoRoot: string) =>
    invoke<GitPushResult>("git_push_force_with_lease", {
      repoRoot,
      workspace: currentWorkspaceEnv(),
    }),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/modules/ai/lib/native.ts
git commit -m "feat(source-control): add native wrappers for new git commands"
```

---

### Task F2: Action model + isHeadLikelyPublished

**Files:**
- Create: `src/modules/source-control/types/actions.ts`
- Create: `src/modules/source-control/types/actions.test.ts`

- [ ] **Step 1: Write the failing test**

`src/modules/source-control/types/actions.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { COMMIT_ACTIONS, isHeadLikelyPublished } from "./actions";

describe("COMMIT_ACTIONS", () => {
  it("lists the five commit variants in menu order", () => {
    expect(COMMIT_ACTIONS.map((a) => a.id)).toEqual([
      "commit",
      "commit-push",
      "commit-sync",
      "amend",
      "commit-all",
    ]);
  });
});

describe("isHeadLikelyPublished", () => {
  it("is false when no upstream is configured", () => {
    expect(isHeadLikelyPublished({ upstream: null, ahead: 0 })).toBe(false);
  });

  it("is true when upstream set and not ahead", () => {
    expect(isHeadLikelyPublished({ upstream: "origin/main", ahead: 0 })).toBe(
      true,
    );
  });

  it("is false when local commits are ahead (tip not yet pushed)", () => {
    expect(isHeadLikelyPublished({ upstream: "origin/main", ahead: 2 })).toBe(
      false,
    );
  });

  it("is true (fail-safe) when ahead is unknown but upstream exists", () => {
    expect(
      isHeadLikelyPublished({ upstream: "origin/main", ahead: null }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/source-control/types/actions.test.ts`
Expected: FAIL ("Failed to resolve import ./actions").

- [ ] **Step 3: Implement the model**

`src/modules/source-control/types/actions.ts`:

```typescript
export type CommitAction =
  | "commit"
  | "commit-push"
  | "commit-sync"
  | "amend"
  | "commit-all";

export type CommitActionDescriptor = {
  id: CommitAction;
  label: string;
  /** A separator is rendered before this item when true. */
  separatorBefore?: boolean;
};

export const COMMIT_ACTIONS: readonly CommitActionDescriptor[] = [
  { id: "commit", label: "Commit" },
  { id: "commit-push", label: "Commit & Push" },
  { id: "commit-sync", label: "Commit & Sync" },
  { id: "amend", label: "Amend Last Commit", separatorBefore: true },
  { id: "commit-all", label: "Commit All" },
] as const;

export const COMMIT_ACTION_LABELS: Record<CommitAction, string> =
  Object.fromEntries(COMMIT_ACTIONS.map((a) => [a.id, a.label])) as Record<
    CommitAction,
    string
  >;

export const DEFAULT_COMMIT_ACTION: CommitAction = "commit";

/**
 * HEAD is treated as published when an upstream is configured and the local
 * branch is not ahead of it per the last known tracking ref. When ahead is
 * unknown we fail safe (treat as published) so amend always confirms.
 */
export function isHeadLikelyPublished(input: {
  upstream: string | null;
  ahead: number | null;
}): boolean {
  if (!input.upstream) return false;
  if (input.ahead === null) return true;
  return input.ahead === 0;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test src/modules/source-control/types/actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/source-control/types/actions.ts src/modules/source-control/types/actions.test.ts
git commit -m "feat(source-control): add commit action model and published-HEAD check"
```

---

### Task F3: SplitButton primitive

**Files:**
- Create: `src/modules/source-control/components/SplitButton.tsx`

- [ ] **Step 1: Implement the component**

`src/modules/source-control/components/SplitButton.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";

interface SplitButtonProps {
  /** Primary action label/content. */
  children: ReactNode;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryAriaLabel?: string;
  /** The menu items, already composed by the caller. */
  menu: ReactNode;
  menuDisabled?: boolean;
  menuAriaLabel: string;
  variant?: "default" | "secondary";
  className?: string;
}

export function SplitButton({
  children,
  onPrimary,
  primaryDisabled,
  primaryAriaLabel,
  menu,
  menuDisabled,
  menuAriaLabel,
  variant = "default",
  className,
}: SplitButtonProps) {
  return (
    <div className={cn("inline-flex w-full items-stretch", className)}>
      <Button
        size="xs"
        variant={variant}
        aria-label={primaryAriaLabel}
        disabled={primaryDisabled}
        onClick={onPrimary}
        className="h-7 flex-1 cursor-pointer rounded-r-none text-[11.5px] font-semibold tracking-tight shadow-sm disabled:cursor-not-allowed disabled:shadow-none"
      >
        {children}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="xs"
            variant={variant}
            aria-label={menuAriaLabel}
            disabled={menuDisabled}
            className="h-7 w-6 cursor-pointer rounded-l-none border-l border-background/25 px-0 shadow-sm disabled:cursor-not-allowed"
          >
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={2.2} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {menu}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS. (If `@/lib/utils` `cn` import path differs, match the import used in `SourceControlPanel.tsx`.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/source-control/components/SplitButton.tsx
git commit -m "feat(source-control): add reusable SplitButton primitive"
```

---

### Task F4: Sticky commit-default preference

**Files:**
- Modify: `src/modules/settings/store.ts`
- Create: `src/modules/source-control/hooks/useCommitDefaultPreference.ts`
- Create: `src/modules/source-control/hooks/useCommitDefaultPreference.test.ts`

- [ ] **Step 1: Add the preference field + key + default + load/save**

In `store.ts`:

- Add to the `Preferences` type (after `sidebarScmGraphCollapsed`, before `projectRoots`):

```typescript
  scmCommitDefaultAction: CommitAction;
```

- Add the import at the top of `store.ts`:

```typescript
import type { CommitAction } from "@/modules/source-control/types/actions";
```

- Add the storage key alongside the other `KEY_` consts:

```typescript
const KEY_SCM_COMMIT_DEFAULT_ACTION = "scmCommitDefaultAction";
```

- In the defaults object returned by `loadPreferences` (find where `sidebarScmGraphCollapsed` is defaulted) add:

```typescript
    scmCommitDefaultAction:
      (loaded[KEY_SCM_COMMIT_DEFAULT_ACTION] as CommitAction | undefined) ??
      "commit",
```

- In the save path (where individual keys are persisted, mirroring `sidebarScmGraphCollapsed`) add a setter that writes `KEY_SCM_COMMIT_DEFAULT_ACTION`.

Note: match the exact load/save mechanism already used for `sidebarScmGraphCollapsed` in this file — read it first and follow that pattern precisely (getter, setter, and the `usePreferencesStore` action).

- [ ] **Step 2: Write the failing hook test**

`src/modules/source-control/hooks/useCommitDefaultPreference.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { nextCommitDefault } from "./useCommitDefaultPreference";

describe("nextCommitDefault", () => {
  it("returns the chosen action as the new sticky default", () => {
    expect(nextCommitDefault("commit-push")).toBe("commit-push");
  });

  it("never makes amend sticky (one-off action)", () => {
    expect(nextCommitDefault("amend")).toBe("commit");
  });

  it("never makes commit-all sticky (one-off action)", () => {
    expect(nextCommitDefault("commit-all")).toBe("commit");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test src/modules/source-control/hooks/useCommitDefaultPreference.test.ts`
Expected: FAIL ("Failed to resolve import ./useCommitDefaultPreference").

- [ ] **Step 4: Implement the hook + pure helper**

`src/modules/source-control/hooks/useCommitDefaultPreference.ts`:

```typescript
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useCallback } from "react";
import type { CommitAction } from "../types/actions";

/**
 * One-off actions (amend, commit-all) must not become the persistent default;
 * running them resets the sticky default back to plain commit.
 */
const STICKY_ACTIONS: ReadonlySet<CommitAction> = new Set([
  "commit",
  "commit-push",
  "commit-sync",
]);

export function nextCommitDefault(chosen: CommitAction): CommitAction {
  return STICKY_ACTIONS.has(chosen) ? chosen : "commit";
}

export function useCommitDefaultPreference(): {
  defaultAction: CommitAction;
  setDefaultAction: (action: CommitAction) => void;
} {
  const defaultAction = usePreferencesStore(
    (state) => state.scmCommitDefaultAction,
  );
  const setScmCommitDefaultAction = usePreferencesStore(
    (state) => state.setScmCommitDefaultAction,
  );
  const setDefaultAction = useCallback(
    (action: CommitAction) => {
      setScmCommitDefaultAction(nextCommitDefault(action));
    },
    [setScmCommitDefaultAction],
  );
  return { defaultAction, setDefaultAction };
}
```

Note: `setScmCommitDefaultAction` must be added to the `usePreferencesStore` actions in `src/modules/settings/preferences.ts`, mirroring how `setSidebarScmGraphCollapsed` (or the closest existing SCM setter) is defined there. Read that file and follow the pattern.

- [ ] **Step 5: Run tests, typecheck, commit**

Run: `pnpm test src/modules/source-control/hooks/useCommitDefaultPreference.test.ts && pnpm exec tsc --noEmit`
Expected: PASS (3 tests), no type errors.

```bash
git add src/modules/settings/store.ts src/modules/settings/preferences.ts src/modules/source-control/hooks/useCommitDefaultPreference.ts src/modules/source-control/hooks/useCommitDefaultPreference.test.ts
git commit -m "feat(source-control): persist sticky commit default action"
```

---

### Task F5: Extend remote actions (force-push, pull-rebase, fetch-prune, sync)

**Files:**
- Modify: `src/modules/source-control/useSourceControl.ts:14` and `:368-411`

- [ ] **Step 1: Write the failing test for sync phase reporting**

Create `src/modules/source-control/syncPhase.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { syncPhaseLabel } from "./useSourceControl";

describe("syncPhaseLabel", () => {
  it("labels each sync phase failure distinctly", () => {
    expect(syncPhaseLabel("fetch")).toBe("Fetch failed");
    expect(syncPhaseLabel("pull")).toBe("Pull failed");
    expect(syncPhaseLabel("push")).toBe("Push failed");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/source-control/syncPhase.test.ts`
Expected: FAIL ("syncPhaseLabel is not a function").

- [ ] **Step 3: Extend the action union + add phase helper + handlers**

In `useSourceControl.ts`:

- Widen the type (line 14):

```typescript
export type SourceControlRemoteAction =
  | "fetch"
  | "pull"
  | "push"
  | "force-push"
  | "pull-rebase"
  | "fetch-prune"
  | "sync";
```

- Add an exported phase helper near `normalizeError`:

```typescript
export type SyncPhase = "fetch" | "pull" | "push";

export function syncPhaseLabel(phase: SyncPhase): string {
  return phase === "fetch"
    ? "Fetch failed"
    : phase === "pull"
      ? "Pull failed"
      : "Push failed";
}
```

- In `runRemoteAction`, replace the action dispatch (lines ~387-397) with:

```typescript
      try {
        if (action === "fetch") {
          await native.gitFetch(repo.repoRoot);
          touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
        } else if (action === "fetch-prune") {
          await native.gitFetchPrune(repo.repoRoot);
          touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
        } else if (action === "pull") {
          await native.gitFetchPrune(repo.repoRoot);
          touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
          await native.gitPullFfOnly(repo.repoRoot);
        } else if (action === "pull-rebase") {
          await native.gitFetchPrune(repo.repoRoot);
          touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
          await native.gitPullRebase(repo.repoRoot);
        } else if (action === "force-push") {
          await native.gitPushForceWithLease(repo.repoRoot);
        } else if (action === "sync") {
          try {
            await native.gitFetchPrune(repo.repoRoot);
          } catch (e) {
            throw new Error(`${syncPhaseLabel("fetch")}: ${normalizeError(e)}`);
          }
          touchAutoFetch(autoFetchByRepoRef.current, repo.repoRoot);
          try {
            await native.gitPullFfOnly(repo.repoRoot);
          } catch (e) {
            throw new Error(`${syncPhaseLabel("pull")}: ${normalizeError(e)}`);
          }
          try {
            await native.gitPush(repo.repoRoot);
          } catch (e) {
            throw new Error(`${syncPhaseLabel("push")}: ${normalizeError(e)}`);
          }
        } else {
          await native.gitPush(repo.repoRoot);
        }
        setState((current) => ({ ...current, lastRemoteError: null }));
        await refresh({ remote: "never" });
        return { ok: true, action };
```

Note: `getContextualAction` and the `missing-upstream` guard already block when `!status.upstream`, which correctly disables `force-push` and `sync` without an upstream. Leave that guard as-is.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test src/modules/source-control/syncPhase.test.ts && pnpm exec tsc --noEmit`
Expected: PASS (1 test), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/source-control/useSourceControl.ts src/modules/source-control/syncPhase.test.ts
git commit -m "feat(source-control): add force-push, pull-rebase, fetch-prune, sync actions"
```

---

### Task F6: Actions hook (composites + amend gate)

**Files:**
- Create: `src/modules/source-control/hooks/useSourceControlActions.ts`
- Create: `src/modules/source-control/hooks/useSourceControlActions.test.ts`

This hook centralizes action routing so `SourceControlPanel.tsx` stays composition-only. It exposes the composite + one-off runners and the amend-confirm decision. Commit and the basic remote actions still come from `useSourceControlPanel`; this hook composes them.

- [ ] **Step 1: Write the failing test for the pure sequencer**

`src/modules/source-control/hooks/useSourceControlActions.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { runCommitThenRemote } from "./useSourceControlActions";

describe("runCommitThenRemote", () => {
  it("keeps the commit and reports the remote error on remote failure", async () => {
    const commit = vi.fn().mockResolvedValue({ ok: true });
    const remote = vi
      .fn()
      .mockResolvedValue({ ok: false, action: "push", error: "Push failed: x" });
    const result = await runCommitThenRemote(commit, remote);
    expect(commit).toHaveBeenCalledOnce();
    expect(remote).toHaveBeenCalledOnce();
    expect(result).toEqual({
      committed: true,
      remoteOk: false,
      error: "Push failed: x",
    });
  });

  it("does not run the remote step when commit fails", async () => {
    const commit = vi.fn().mockResolvedValue({ ok: false, error: "empty" });
    const remote = vi.fn();
    const result = await runCommitThenRemote(commit, remote);
    expect(remote).not.toHaveBeenCalled();
    expect(result).toEqual({
      committed: false,
      remoteOk: false,
      error: "empty",
    });
  });

  it("reports full success when both steps succeed", async () => {
    const commit = vi.fn().mockResolvedValue({ ok: true });
    const remote = vi.fn().mockResolvedValue({ ok: true, action: "push" });
    const result = await runCommitThenRemote(commit, remote);
    expect(result).toEqual({ committed: true, remoteOk: true, error: null });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/modules/source-control/hooks/useSourceControlActions.test.ts`
Expected: FAIL ("Failed to resolve import").

- [ ] **Step 3: Implement the pure sequencer + hook shell**

`src/modules/source-control/hooks/useSourceControlActions.ts`:

```typescript
import type { SourceControlRemoteActionResult } from "../useSourceControl";

export type CommitStepResult = { ok: boolean; error?: string };
export type CommitThenRemoteResult = {
  committed: boolean;
  remoteOk: boolean;
  error: string | null;
};

/**
 * Commit first; only run the remote step if the commit succeeds. On remote
 * failure the commit is kept and the remote error is surfaced.
 */
export async function runCommitThenRemote(
  commit: () => Promise<CommitStepResult>,
  remote: () => Promise<SourceControlRemoteActionResult>,
): Promise<CommitThenRemoteResult> {
  const committed = await commit();
  if (!committed.ok) {
    return { committed: false, remoteOk: false, error: committed.error ?? null };
  }
  const remoteResult = await remote();
  return {
    committed: true,
    remoteOk: remoteResult.ok,
    error: remoteResult.ok ? null : (remoteResult.error ?? null),
  };
}
```

The React hook wrapper that wires `runCommitThenRemote`, amend, and commit-all into the panel state will be added in Task F8 where the panel handlers live, reusing the existing `scm.commit`, `scm.runRemoteAction`, `native.gitCommitAmend`, and `native.gitStage` calls. Keeping the sequencer pure here makes it testable without React.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm test src/modules/source-control/hooks/useSourceControlActions.test.ts && pnpm exec tsc --noEmit`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/source-control/hooks/useSourceControlActions.ts src/modules/source-control/hooks/useSourceControlActions.test.ts
git commit -m "feat(source-control): add commit-then-remote sequencer"
```

---

### Task F7: Panel hook wiring (amend, commit-all, composites, published flag)

**Files:**
- Modify: `src/modules/source-control/useSourceControlPanel.ts`

Add the new runners to the panel hook so the components call them directly.

- [ ] **Step 1: Add the methods to the `SourceControlPanelState` type**

In the type (after `push: () => Promise<void>;`):

```typescript
  amend: () => Promise<void>;
  commitAll: () => Promise<void>;
  commitAndPush: () => Promise<void>;
  commitAndSync: () => Promise<void>;
  headLikelyPublished: boolean;
```

- [ ] **Step 2: Implement them in the hook body**

Near the existing `commit`/`push` callbacks, add (reusing `runCommitThenRemote` from F6, `isHeadLikelyPublished` from F2, and existing `summary.runRemoteAction`):

```typescript
  const amend = useCallback(async () => {
    if (!repo || summary.busyAction) return;
    if (commitMessage.trim().length === 0) {
      setActionError("Commit message cannot be empty");
      return;
    }
    setLocalActionBusy("commit");
    setActionMessage(null);
    setActionError(null);
    try {
      const result = await native.gitCommitAmend(repo.repoRoot, commitMessage);
      setCommitMessage("");
      setActionMessage(
        `Amended ${result.commitSha.slice(0, 7)} ${result.summary}`,
      );
      invalidateRepoDiffs(repo.repoRoot);
      await summary.refresh({ remote: "never" });
    } catch (error) {
      setActionError(normalizeError(error));
    } finally {
      setLocalActionBusy(null);
    }
  }, [commitMessage, repo, summary]);

  const commitAll = useCallback(async () => {
    if (!repo || summary.busyAction) return;
    const tracked = (status?.changedFiles ?? [])
      .filter((f) => f.unstaged && !f.untracked)
      .map((f) => f.path);
    if (tracked.length > 0) {
      try {
        await native.gitStage(repo.repoRoot, tracked);
      } catch (error) {
        setActionError(normalizeError(error));
        return;
      }
    }
    await commit();
  }, [commit, repo, status, summary.busyAction]);

  const commitAndPush = useCallback(async () => {
    const result = await runCommitThenRemote(
      async () => {
        await commit();
        return { ok: actionErrorRef.current === null };
      },
      () => summary.runRemoteAction("push"),
    );
    if (result.committed && !result.remoteOk && result.error) {
      setActionError(result.error);
    }
  }, [commit, summary]);

  const commitAndSync = useCallback(async () => {
    const result = await runCommitThenRemote(
      async () => {
        await commit();
        return { ok: actionErrorRef.current === null };
      },
      () => summary.runRemoteAction("sync"),
    );
    if (result.committed && !result.remoteOk && result.error) {
      setActionError(result.error);
    }
  }, [commit, summary]);

  const headLikelyPublished = isHeadLikelyPublished({
    upstream: status?.upstream ?? null,
    ahead: status?.ahead ?? null,
  });
```

Add the imports at the top of the file:

```typescript
import { runCommitThenRemote } from "./hooks/useSourceControlActions";
import { isHeadLikelyPublished } from "./types/actions";
```

Add an `actionErrorRef` that mirrors `actionError` (so the composite can read commit success synchronously after `commit()` resolves):

```typescript
  const actionErrorRef = useRef<string | null>(null);
  useEffect(() => {
    actionErrorRef.current = actionError;
  }, [actionError]);
```

Then return the new methods + flag in the hook's return object.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/source-control/useSourceControlPanel.ts
git commit -m "feat(source-control): wire amend, commit-all and composite runners"
```

---

### Task F8: Composed buttons

**Files:**
- Create: `src/modules/source-control/components/CommitSplitButton.tsx`
- Create: `src/modules/source-control/components/SyncSplitButton.tsx`
- Create: `src/modules/source-control/components/FetchSplitButton.tsx`

- [ ] **Step 1: CommitSplitButton**

`src/modules/source-control/components/CommitSplitButton.tsx`:

```tsx
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { COMMIT_ACTIONS, type CommitAction } from "../types/actions";
import { useCommitDefaultPreference } from "../hooks/useCommitDefaultPreference";
import { SplitButton } from "./SplitButton";

const STICKY = new Set<CommitAction>(["commit", "commit-push", "commit-sync"]);

interface CommitSplitButtonProps {
  canCommit: boolean;
  busy: boolean;
  onRun: (action: CommitAction) => void;
}

export function CommitSplitButton({
  canCommit,
  busy,
  onRun,
}: CommitSplitButtonProps) {
  const { defaultAction, setDefaultAction } = useCommitDefaultPreference();
  const primary = COMMIT_ACTIONS.find((a) => a.id === defaultAction) ??
    COMMIT_ACTIONS[0];

  const run = (action: CommitAction) => {
    setDefaultAction(action);
    onRun(action);
  };

  return (
    <SplitButton
      onPrimary={() => run(defaultAction)}
      primaryDisabled={!canCommit || busy}
      primaryAriaLabel={primary.label}
      menuAriaLabel="Commit options"
      menuDisabled={busy}
      menu={COMMIT_ACTIONS.map((a) => (
        <span key={a.id}>
          {a.separatorBefore ? <DropdownMenuSeparator /> : null}
          {STICKY.has(a.id) ? (
            <DropdownMenuCheckboxItem
              checked={a.id === defaultAction}
              onSelect={() => run(a.id)}
            >
              {a.label}
            </DropdownMenuCheckboxItem>
          ) : (
            <DropdownMenuItem onSelect={() => run(a.id)}>
              {a.label}
            </DropdownMenuItem>
          )}
        </span>
      ))}
    >
      {busy ? "Working…" : primary.label}
    </SplitButton>
  );
}
```

- [ ] **Step 2: SyncSplitButton**

`src/modules/source-control/components/SyncSplitButton.tsx`:

```tsx
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { SplitButton } from "./SplitButton";

export type SyncMenuAction = "push" | "pull" | "pull-rebase" | "force-push";

interface SyncSplitButtonProps {
  busy: boolean;
  hasUpstream: boolean;
  onSync: () => void;
  onAction: (action: SyncMenuAction) => void;
}

export function SyncSplitButton({
  busy,
  hasUpstream,
  onSync,
  onAction,
}: SyncSplitButtonProps) {
  return (
    <SplitButton
      variant="secondary"
      onPrimary={onSync}
      primaryDisabled={busy || !hasUpstream}
      primaryAriaLabel="Sync (pull then push)"
      menuAriaLabel="Sync options"
      menuDisabled={busy}
      menu={
        <>
          <DropdownMenuItem onSelect={() => onAction("push")}>
            Push
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasUpstream}
            onSelect={() => onAction("pull")}
          >
            Pull
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!hasUpstream}
            onSelect={() => onAction("pull-rebase")}
          >
            Pull (Rebase)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={!hasUpstream}
            onSelect={() => onAction("force-push")}
          >
            Force Push (lease)
          </DropdownMenuItem>
        </>
      }
    >
      {busy ? "Working…" : "Sync"}
    </SplitButton>
  );
}
```

- [ ] **Step 3: FetchSplitButton (header)**

`src/modules/source-control/components/FetchSplitButton.tsx`:

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
// Dedicated fetch glyph, distinct from the Pull/Download01Icon used elsewhere.
import { CloudDownloadIcon } from "@hugeicons/core-free-icons";

interface FetchSplitButtonProps {
  busy: boolean;
  onFetch: () => void;
  onFetchPrune: () => void;
}

export function FetchSplitButton({
  busy,
  onFetch,
  onFetchPrune,
}: FetchSplitButtonProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Fetch options"
        disabled={busy}
        className={cn(
          "inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground/80 transition-colors",
          "hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-50",
        )}
      >
        <HugeiconsIcon icon={CloudDownloadIcon} size={14} strokeWidth={1.85} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={onFetch}>Fetch</DropdownMenuItem>
        <DropdownMenuItem onSelect={onFetchPrune}>
          Fetch (Prune)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

Note: confirm `CloudDownloadIcon` exists in `@hugeicons/core-free-icons`. If the exact name differs, pick the closest cloud-download glyph (the panel already imports from this package, e.g. `FolderCloudIcon`, `Download01Icon`). Do NOT reuse `Download01Icon` (that is the Pull glyph).

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/source-control/components/CommitSplitButton.tsx src/modules/source-control/components/SyncSplitButton.tsx src/modules/source-control/components/FetchSplitButton.tsx
git commit -m "feat(source-control): add commit, sync and fetch split-buttons"
```

---

### Task F9: Wire into the panel + confirm gates

**Files:**
- Modify: `src/modules/source-control/SourceControlPanel.tsx` (button row ~748-792, header ~558-600, dialog ~860)

- [ ] **Step 1: Replace the button row**

Replace the `<div className="grid w-full grid-cols-2 gap-1.5">...</div>` block (lines ~748-792) with:

```tsx
              <div className="grid w-full grid-cols-2 gap-1.5">
                <CommitSplitButton
                  canCommit={canCommit}
                  busy={!!scm.actionBusy}
                  onRun={handleCommitAction}
                />
                <SyncSplitButton
                  busy={!!scm.actionBusy}
                  hasUpstream={!!scm.status?.upstream}
                  onSync={() => void scm.runSync()}
                  onAction={handleSyncAction}
                />
              </div>
```

- [ ] **Step 2: Add the handlers + confirm state**

Near the other handlers in the component, add (the amend gate uses `scm.headLikelyPublished` from F7; force-push uses a confirm too):

```tsx
  const [pendingRisky, setPendingRisky] = useState<
    null | { kind: "amend" } | { kind: "force-push" }
  >(null);

  const handleCommitAction = (action: CommitAction) => {
    if (action === "amend" && scm.headLikelyPublished) {
      setPendingRisky({ kind: "amend" });
      return;
    }
    runCommitAction(action);
  };

  const runCommitAction = (action: CommitAction) => {
    if (action === "commit") void scm.commit();
    else if (action === "commit-push") void scm.commitAndPush();
    else if (action === "commit-sync") void scm.commitAndSync();
    else if (action === "amend") void scm.amend();
    else if (action === "commit-all") void scm.commitAll();
  };

  const handleSyncAction = (action: SyncMenuAction) => {
    if (action === "force-push") {
      setPendingRisky({ kind: "force-push" });
      return;
    }
    void scm.runRemoteAction(action === "pull-rebase" ? "pull-rebase" : action);
  };
```

Where `scm.runRemoteAction` is exposed from the panel hook (it already wraps `summary.runRemoteAction`); if not yet exposed, add a passthrough in `useSourceControlPanel` returning `summary.runRemoteAction`, and a `runSync` that calls `summary.runRemoteAction("sync")`.

- [ ] **Step 3: Add the confirm dialog**

Reuse the existing `AlertDialog` pattern (the discard dialog around line 860). Add a second dialog driven by `pendingRisky`:

```tsx
      <AlertDialog
        open={pendingRisky !== null}
        onOpenChange={(open) => !open && setPendingRisky(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRisky?.kind === "amend"
                ? "Amend a published commit?"
                : "Force push with lease?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRisky?.kind === "amend"
                ? "HEAD appears to be on the remote. Amending rewrites published history; you will need to force push afterward."
                : "This rewrites the remote branch using --force-with-lease. It will be rejected if the remote moved since your last fetch."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingRisky(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const kind = pendingRisky?.kind;
                setPendingRisky(null);
                if (kind === "amend") void scm.amend();
                else if (kind === "force-push")
                  void scm.runRemoteAction("force-push");
              }}
            >
              {pendingRisky?.kind === "amend" ? "Amend" : "Force Push"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

- [ ] **Step 4: Replace the header Pull icon with FetchSplitButton**

In the header action group (lines ~558-600), remove the standalone Pull `IconActionButton` (the `Download01Icon` one ~575-600) and replace the Fetch `IconActionButton` (~559-574) with:

```tsx
            <FetchSplitButton
              busy={fetchBusy || !!scm.actionBusy}
              onFetch={() => void scm.runRemoteAction("fetch")}
              onFetchPrune={() => void scm.runRemoteAction("fetch-prune")}
            />
```

Keep the Refresh `IconActionButton` as-is.

- [ ] **Step 5: Add imports, typecheck, commit**

Add to the import block of `SourceControlPanel.tsx`:

```tsx
import { CommitSplitButton } from "./components/CommitSplitButton";
import { SyncSplitButton, type SyncMenuAction } from "./components/SyncSplitButton";
import { FetchSplitButton } from "./components/FetchSplitButton";
import type { CommitAction } from "./types/actions";
```

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: PASS, no type errors.

```bash
git add src/modules/source-control/SourceControlPanel.tsx src/modules/source-control/useSourceControlPanel.ts
git commit -m "feat(source-control): replace button row and header with split-buttons"
```

---

### Task F10: Full verification

Run the complete CI gate set locally (matches `.forgejo/workflows/ci.yml`).

- [ ] **Step 1: Frontend gates (all three CI steps)**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: type-check clean, all tests PASS, production build succeeds.

- [ ] **Step 2: Rust gates (all three CI steps)**

Run:
```bash
cd src-tauri \
  && cargo check --all-targets --locked \
  && cargo clippy --all-targets --locked -- -D warnings \
  && cargo test --locked
```
Expected: check + clippy clean (no warnings), all tests PASS (including the new git tests).

- [ ] **Step 3: Manual verification (interactive UI, no DOM test infra)**

Launch the app (`pnpm tauri dev`) on a repo with an upstream and confirm:
- Commit split-button main action follows the sticky default; choosing Commit & Push from the menu makes it the new default after reload.
- Commit All commits tracked edits but leaves untracked files unstaged.
- Sync runs fetch -> ff-pull -> push; on a deliberately diverged branch it reports the failing phase, not a generic error.
- Amend on a published HEAD shows the confirm dialog; on a local-only commit it runs directly.
- Force Push shows the confirm dialog and is disabled with no upstream.
- Header Fetch menu offers Fetch and Fetch (Prune); the standalone Pull icon is gone.

- [ ] **Step 4: Final commit (if manual fixes were needed)**

```bash
git add -A
git commit -m "fix(source-control): manual-verification adjustments"
```

---

## Self-review notes

- **Spec coverage:** Commit variations (F8/F9), Sync split + phase errors (F5/F8/F9), Fetch split plain+prune (B3/F8/F9), amend gate (F7/F9), force-with-lease + confirm (B5/F9), pull-rebase (B6), divergence -> NotFastForward (B6), file layout (components/hooks/types), acceptance criteria (F9/F10 manual), implementation order followed.
- **Deviations from spec, by your approval:** backend tests cover risky ops only (amend, force-with-lease) behaviorally; fetch/pull-rebase/divergence via classifier units. Frontend tests are pure-logic; SplitButton interaction is manual (no DOM test infra in repo).
- **Type consistency:** `CommitAction`, `SourceControlRemoteAction` (incl. `sync`/`force-push`/`pull-rebase`/`fetch-prune`), `SyncMenuAction`, `nextCommitDefault`, `runCommitThenRemote`, `isHeadLikelyPublished`, `syncPhaseLabel` are defined once and reused across tasks.
- **Known follow-ups for the implementer to confirm against the live code (not placeholders, but verify):** exact `cn` import path; the precise load/save mechanism for a new preference key in `store.ts`/`preferences.ts` (mirror `sidebarScmGraphCollapsed`); the exact Hugeicons name for a cloud-download glyph; the exact line offsets in `SourceControlPanel.tsx` (they shift as edits land).
