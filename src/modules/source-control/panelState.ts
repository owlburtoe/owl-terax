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
