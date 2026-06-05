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
