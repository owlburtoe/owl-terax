import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Fragment } from "react";
import {
  COMMIT_ACTIONS,
  STICKY_COMMIT_ACTIONS,
  type CommitAction,
} from "../types/actions";
import { useCommitDefaultPreference } from "../hooks/useCommitDefaultPreference";
import { SplitButton } from "./SplitButton";

interface CommitSplitButtonProps {
  canCommit: boolean;
  busy: boolean;
  onRun: (action: CommitAction) => void;
}

export function CommitSplitButton({ canCommit, busy, onRun }: CommitSplitButtonProps) {
  const { defaultAction, setDefaultAction } = useCommitDefaultPreference();
  const primary =
    COMMIT_ACTIONS.find((a) => a.id === defaultAction) ?? COMMIT_ACTIONS[0];

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
        <Fragment key={a.id}>
          {a.separatorBefore ? <DropdownMenuSeparator /> : null}
          {STICKY_COMMIT_ACTIONS.has(a.id) ? (
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
        </Fragment>
      ))}
    >
      {busy ? "Working..." : primary.label}
    </SplitButton>
  );
}
