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

export function SyncSplitButton({ busy, hasUpstream, onSync, onAction }: SyncSplitButtonProps) {
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
          <DropdownMenuItem onSelect={() => onAction("push")}>Push</DropdownMenuItem>
          <DropdownMenuItem disabled={!hasUpstream} onSelect={() => onAction("pull")}>
            Pull
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!hasUpstream} onSelect={() => onAction("pull-rebase")}>
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
      {busy ? "Working..." : "Sync"}
    </SplitButton>
  );
}
