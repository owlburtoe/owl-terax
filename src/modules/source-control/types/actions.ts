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
