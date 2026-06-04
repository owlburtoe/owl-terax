import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, KEY_SEP, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  getBindingTokens,
  SHORTCUTS,
  type ShortcutId,
} from "@/modules/shortcuts/shortcuts";
import type { Tab } from "@/modules/tabs";
import { TabBar } from "@/modules/tabs";
import { NotificationBell } from "@/modules/agents";
import {
  GridViewIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  Settings01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState, type RefObject } from "react";
import {
  SearchInline,
  type SearchInlineHandle,
  type SearchTarget,
} from "./SearchInline";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onClose: (id: number) => void;
  /** Promote a preview (transient) tab to persistent. */
  onPin: (id: number) => void;
  onToggleSidebar: () => void;
  onSplit: (dir: "row" | "col") => void;
  /** Active tab is a terminal and below the per-tab pane cap. */
  canSplit: boolean;
  onActivateAgent: (tabId: number, leafId: number) => void;
  onActivateLocalAgent: () => void;
  onOpenSettings: () => void;
  searchTarget: SearchTarget;
  searchRef: RefObject<SearchInlineHandle | null>;
  showTabBar: boolean;
};

const COMPACT_WIDTH = 720;

export function Header({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onClose,
  onPin,
  onToggleSidebar,
  onSplit,
  canSplit,
  onActivateAgent,
  onActivateLocalAgent,
  onOpenSettings,
  searchTarget,
  searchRef,
  showTabBar,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const userShortcuts = usePreferencesStore((s) => s.shortcuts);

  const tokensFor = (id: ShortcutId): string => {
    const s = SHORTCUTS.find((s) => s.id === id);
    if (!s) return "";
    const bindings = userShortcuts[id] || s.defaultBindings;
    if (!bindings || bindings.length === 0) return "";
    return getBindingTokens(bindings[0]).join(KEY_SEP);
  };

  const splitRightTokens = tokensFor("pane.splitRight");
  const splitDownTokens = tokensFor("pane.splitDown");

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCompact(w < COMPACT_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const settingsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onOpenSettings}
      title="Settings"
    >
      <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
    </Button>
  );

  return (
    <div
      ref={rootRef}
      data-tauri-drag-region
      className="relative grid h-10 shrink-0 border-b border-border/60 bg-card select-none"
      style={{
        // Left section mirrors the sidebar width so the divider lines up with
        // the sidebar's right border. The sidebar lives inside `.zoom-content`
        // (zoom: var(--app-zoom)) but this header does not, so the stored
        // (unzoomed) --sidebar-width must be scaled by --app-zoom to match the
        // sidebar's *rendered* width. The 140px floor stays unscaled — it sizes
        // the header's own (unzoomed) controls and keeps the toggle reachable
        // when the sidebar is collapsed (var → 0).
        gridTemplateColumns:
          "max(calc(var(--sidebar-width, 260px) * var(--app-zoom, 1)), 140px) 1fr",
      }}
    >
      <div
        className={`flex h-full items-center gap-0.5 overflow-hidden ${
          IS_MAC ? "pl-20" : "pl-2"
        }`}
        data-tauri-drag-region
      >
        <Button
          onClick={onToggleSidebar}
          title="Toggle sidebar"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={SidebarLeftIcon} size={18} strokeWidth={1.75} />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              title="Split terminal"
              disabled={!canSplit}
            >
              <HugeiconsIcon icon={GridViewIcon} size={16} strokeWidth={1.75} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuItem onSelect={() => onSplit("row")}>
              <HugeiconsIcon
                icon={LayoutTwoColumnIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Split right</span>
              {splitRightTokens && (
                <span className="text-xs text-muted-foreground">
                  {splitRightTokens}
                </span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSplit("col")}>
              <HugeiconsIcon
                icon={LayoutTwoRowIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Split down</span>
              {splitDownTokens && (
                <span className="text-xs text-muted-foreground">
                  {splitDownTokens}
                </span>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {!IS_MAC && (
          <NotificationBell
            onActivate={onActivateAgent}
            onActivateLocal={onActivateLocalAgent}
          />
        )}
      </div>

      <div
        className="flex h-full min-w-0 items-center gap-2 border-l border-border/60 pr-2"
        data-tauri-drag-region
      >
        {showTabBar ? (
          <>
            <TabBar
              tabs={tabs}
              activeId={activeId}
              onSelect={onSelect}
              onNew={onNew}
              onNewPrivate={onNewPrivate}
              onNewPreview={onNewPreview}
              onNewEditor={onNewEditor}
              onNewGitGraph={onNewGitGraph}
              onClose={onClose}
              onPin={onPin}
              compact={compact}
            />
            <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
          </>
        ) : (
          <div className="h-full min-w-2 flex-1" data-tauri-drag-region />
        )}

        <SearchInline ref={searchRef} target={searchTarget} compact={compact} />

        {IS_MAC && (
          <>
            <NotificationBell
              onActivate={onActivateAgent}
              onActivateLocal={onActivateLocalAgent}
            />
            {settingsButton}
          </>
        )}

        {!IS_MAC && settingsButton}
      </div>

      {USE_CUSTOM_WINDOW_CONTROLS && (
        <>
          <span className="ml-1 h-5 w-px shrink-0 bg-border" />
          <WindowControls />
        </>
      )}
    </div>
  );
}
