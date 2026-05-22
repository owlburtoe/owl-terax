// src/modules/sidebar/panels/VerticalTabsPanel.tsx
import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import type { Tab } from "@/modules/tabs";
import {
  Cancel01Icon,
  ComputerTerminal02Icon,
  GitBranchIcon,
  GitCompareIcon,
  Globe02Icon,
  IncognitoIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

export type VerticalTabsPanelProps = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
};

function tabIcon(tab: Tab): React.ReactNode {
  if (tab.kind === "terminal") {
    return "private" in tab && tab.private ? (
      <HugeiconsIcon icon={IncognitoIcon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
    ) : (
      <HugeiconsIcon icon={ComputerTerminal02Icon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />
    );
  }
  if (tab.kind === "editor") {
    const url = "path" in tab && tab.path ? fileIconUrl(tab.path) : null;
    if (url) return <img src={url} alt="" className="h-3.5 w-3.5 shrink-0" />;
    return <HugeiconsIcon icon={PencilEdit02Icon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />;
  }
  if (tab.kind === "preview" || tab.kind === "markdown") {
    return <HugeiconsIcon icon={Globe02Icon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />;
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file" || tab.kind === "ai-diff") {
    return <HugeiconsIcon icon={GitCompareIcon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />;
  }
  if (tab.kind === "git-history") {
    return <HugeiconsIcon icon={GitBranchIcon} size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" />;
  }
  return null;
}

export function VerticalTabsPanel({ tabs, activeId, onSelect, onClose }: VerticalTabsPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: tabs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="h-full overflow-y-auto py-1">
      <div
        style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}
      >
        {rowVirtualizer.getVirtualItems().map((vItem) => {
          const tab = tabs[vItem.index];
          if (!tab) return null;
          const isActive = tab.id === activeId;
          const isDirty = tab.kind === "editor" && "dirty" in tab && tab.dirty;

          return (
            <div
              key={tab.id}
              data-index={vItem.index}
              ref={rowVirtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vItem.start}px)` }}
              className={cn(
                "group flex h-8 cursor-pointer items-center gap-1.5 px-2 text-[11.5px] select-none",
                isActive
                  ? "bg-foreground/[0.07] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
              )}
              onClick={() => onSelect(tab.id)}
            >
              {tabIcon(tab)}
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              {isDirty && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/50" />
              )}
              <button
                type="button"
                aria-label="Close tab"
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className="invisible shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-foreground/10 hover:text-foreground group-hover:visible"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
