import { usePreferencesStore } from "@/modules/settings/preferences";
import { setScmCommitDefaultAction } from "@/modules/settings/store";
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
  const setDefaultAction = useCallback((action: CommitAction) => {
    void setScmCommitDefaultAction(nextCommitDefault(action));
  }, []);
  return { defaultAction, setDefaultAction };
}
