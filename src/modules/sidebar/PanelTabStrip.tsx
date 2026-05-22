import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SidebarViewId } from "./types";

export type PanelDescriptor = {
  id: SidebarViewId;
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  badge?: number;
};

type Props = {
  panels: PanelDescriptor[];
  activeView: SidebarViewId;
  onSelectView: (id: SidebarViewId) => void;
};

export const PANEL_TAB_STRIP_HEIGHT = 36;

export function PanelTabStrip({ panels, activeView, onSelectView }: Props) {
  if (panels.length === 0) return null;

  return (
    <div
      style={{ height: PANEL_TAB_STRIP_HEIGHT }}
      className="flex shrink-0 items-stretch gap-0.5 border-b border-border/60 bg-card/85 px-1.5 py-1 backdrop-blur"
    >
      {panels.map((panel) => {
        const isActive = panel.id === activeView;
        const showBadge = typeof panel.badge === "number" && panel.badge > 0;
        return (
          <Tooltip key={panel.id} delayDuration={400}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={panel.label}
                aria-pressed={isActive}
                onClick={() => onSelectView(panel.id)}
                className={cn(
                  "group relative flex h-full w-7 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-colors duration-150",
                  "focus-visible:ring-2 focus-visible:ring-primary/40",
                  isActive
                    ? "bg-foreground/[0.07] text-foreground dark:bg-foreground/[0.09]"
                    : "text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
                )}
              >
                <HugeiconsIcon
                  icon={panel.icon}
                  size={15}
                  strokeWidth={isActive ? 2 : 1.75}
                  className="shrink-0 transition-[stroke-width] duration-150"
                />
                {showBadge ? (
                  <span className="absolute -top-0.5 -right-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground/70 px-0.5 text-[8px] font-semibold leading-none tabular-nums text-background">
                    {panel.badge! > 99 ? "99+" : panel.badge}
                  </span>
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              {panel.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
