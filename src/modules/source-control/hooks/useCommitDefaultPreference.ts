import { usePreferencesStore } from "@/modules/settings/preferences";
import { setScmCommitDefaultAction } from "@/modules/settings/store";
import { useCallback } from "react";
import { STICKY_COMMIT_ACTIONS, type CommitAction } from "../types/actions";

export function nextCommitDefault(chosen: CommitAction): CommitAction {
  return STICKY_COMMIT_ACTIONS.has(chosen) ? chosen : "commit";
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
