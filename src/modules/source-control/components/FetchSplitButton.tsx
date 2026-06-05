import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { CloudDownloadIcon } from "@hugeicons/core-free-icons";

interface FetchSplitButtonProps {
  busy: boolean;
  onFetch: () => void;
  onFetchPrune: () => void;
}

export function FetchSplitButton({ busy, onFetch, onFetchPrune }: FetchSplitButtonProps) {
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
        <DropdownMenuItem onSelect={onFetchPrune}>Fetch (Prune)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
