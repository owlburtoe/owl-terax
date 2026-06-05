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
