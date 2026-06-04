import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  native,
  type GitCommitFileChange,
  type GitLogEntry,
} from "@/modules/ai/lib/native";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  GraphRail,
  MAX_VISIBLE_LANES,
  railWidth,
} from "@/modules/git-history/GraphRail";
import {
  EMPTY_GRAPH_STATE,
  layoutGraph,
  type GraphRow,
  type GraphState,
} from "@/modules/git-history/lib/graph";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

const PAGE_SIZE = 40;
const ROW_HEIGHT = 28;
const NEAR_BOTTOM_PX = 200;
const FILES_CACHE_LIMIT = 16;
const RAIL_RESERVED_PX = railWidth(MAX_VISIBLE_LANES);

type Props = {
  repoRoot: string;
  onOpenGitGraph?: () => void;
};

type LoadStatus = "idle" | "initial" | "more" | "error";

type FilesEntry =
  | { state: "loading" }
  | { state: "loaded"; files: GitCommitFileChange[] }
  | { state: "error"; error: string };

function normalizeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return "";
  return normalized.slice(0, index);
}

function absoluteTime(secs: number): string {
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeTime(secs: number): string {
  if (!secs) return "";
  const sec = Math.round((Date.now() - secs * 1000) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function statusTone(code: string): string {
  switch (code.toUpperCase()) {
    case "A":
      return "text-emerald-600 dark:text-emerald-400";
    case "M":
      return "text-amber-600 dark:text-amber-300";
    case "D":
      return "text-rose-600 dark:text-rose-400";
    case "R":
    case "C":
      return "text-sky-600 dark:text-sky-300";
    default:
      return "text-muted-foreground";
  }
}

export function SourceControlGraph({ repoRoot, onOpenGitGraph }: Props) {
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [endReached, setEndReached] = useState(false);

  const requestIdRef = useRef(0);
  const inflightMoreRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const filesCacheRef = useRef(new Map<string, FilesEntry>());
  const filesInflightRef = useRef(new Set<string>());
  const [filesTick, setFilesTick] = useState(0);
  const bumpFiles = useCallback(() => setFilesTick((n) => n + 1), []);
  const graphCacheRef = useRef<{
    byCommit: Map<string, GraphRow>;
    tail: GraphState;
    firstSha: string | null;
    len: number;
    maxLaneCount: number;
  }>({
    byCommit: new Map(),
    tail: EMPTY_GRAPH_STATE,
    firstSha: null,
    len: 0,
    maxLaneCount: 1,
  });

  const { graphByCommit, maxLaneCount } = useMemo(() => {
    const cache = graphCacheRef.current;
    if (commits.length === 0) {
      cache.byCommit = new Map();
      cache.tail = EMPTY_GRAPH_STATE;
      cache.firstSha = null;
      cache.len = 0;
      cache.maxLaneCount = 1;
      return { graphByCommit: cache.byCommit, maxLaneCount: 1 };
    }
    const firstSha = commits[0].sha;
    const canAppend = cache.firstSha === firstSha && commits.length >= cache.len;
    if (!canAppend) {
      const { rows, state } = layoutGraph(commits);
      const byCommit = new Map<string, GraphRow>();
      let max = 1;
      for (const row of rows) {
        byCommit.set(row.sha, row);
        if (row.laneCount > max) max = row.laneCount;
      }
      cache.byCommit = byCommit;
      cache.tail = state;
      cache.firstSha = firstSha;
      cache.len = commits.length;
      cache.maxLaneCount = max;
      return { graphByCommit: byCommit, maxLaneCount: max };
    }
    if (commits.length > cache.len) {
      const delta = commits.slice(cache.len);
      const { rows: newRows, state } = layoutGraph(delta, cache.tail);
      let max = cache.maxLaneCount;
      for (const row of newRows) {
        cache.byCommit.set(row.sha, row);
        if (row.laneCount > max) max = row.laneCount;
      }
      cache.tail = state;
      cache.len = commits.length;
      cache.maxLaneCount = max;
    }
    return { graphByCommit: cache.byCommit, maxLaneCount: cache.maxLaneCount };
  }, [commits]);

  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index) => commits[index]?.sha ?? index,
  });

  const loadInitial = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoadStatus("initial");
    setError(null);
    setEndReached(false);
    filesInflightRef.current.clear();
    filesCacheRef.current.clear();
    bumpFiles();
    try {
      const entries = await native.gitLog(repoRoot, { limit: PAGE_SIZE });
      if (requestId !== requestIdRef.current) return;
      setCommits(entries);
      setLoadStatus("idle");
      if (entries.length < PAGE_SIZE) setEndReached(true);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(normalizeError(err));
      setLoadStatus("error");
    }
  }, [bumpFiles, repoRoot]);

  const loadMore = useCallback(async () => {
    if (inflightMoreRef.current || endReached) return;
    if (loadStatus !== "idle") return;
    const last = commits[commits.length - 1];
    if (!last) return;
    inflightMoreRef.current = true;
    setLoadStatus("more");
    try {
      const entries = await native.gitLog(repoRoot, {
        limit: PAGE_SIZE,
        beforeSha: last.sha,
      });
      setCommits((prev) => {
        const seen = new Set(prev.map((c) => c.sha));
        const merged = [...prev];
        for (const e of entries) if (!seen.has(e.sha)) merged.push(e);
        return merged;
      });
      if (entries.length < PAGE_SIZE) setEndReached(true);
      setLoadStatus("idle");
    } catch (err) {
      setError(normalizeError(err));
      setLoadStatus("error");
    } finally {
      inflightMoreRef.current = false;
    }
  }, [commits, endReached, loadStatus, repoRoot]);

  useEffect(() => {
    setCommits([]);
    void loadInitial();
  }, [loadInitial]);

  const fetchFiles = useCallback(
    async (sha: string) => {
      if (filesInflightRef.current.has(sha)) return;
      const cache = filesCacheRef.current;
      const existing = cache.get(sha);
      if (existing && existing.state !== "error") return;
      filesInflightRef.current.add(sha);
      cache.set(sha, { state: "loading" });
      bumpFiles();
      try {
        const files = await native.gitCommitFiles(repoRoot, sha);
        cache.set(sha, { state: "loaded", files });
        while (cache.size > FILES_CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined || oldest === sha) break;
          cache.delete(oldest);
        }
        bumpFiles();
      } catch (err) {
        cache.set(sha, { state: "error", error: normalizeError(err) });
        bumpFiles();
      } finally {
        filesInflightRef.current.delete(sha);
      }
    },
    [bumpFiles, repoRoot],
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < NEAR_BOTTOM_PX) void loadMore();
  }, [loadMore]);

  // Rows read freshly cached files from the ref; this read re-renders them
  // when a hover fetch resolves.
  void filesTick;

  if (loadStatus === "initial" && commits.length === 0) {
    return (
      <GraphCenter>
        <Spinner className="size-3.5" />
        <span className="text-[10.5px] text-muted-foreground">Loading…</span>
      </GraphCenter>
    );
  }

  if (loadStatus === "error" && commits.length === 0) {
    return (
      <GraphCenter>
        <div className="text-[11px] font-medium">Could not load graph</div>
        <div className="max-w-[200px] text-[10px] leading-relaxed text-muted-foreground">
          {error ?? "Unknown error"}
        </div>
        <Button
          size="xs"
          variant="ghost"
          className="h-6 cursor-pointer text-[11px]"
          onClick={() => void loadInitial()}
        >
          Retry
        </Button>
      </GraphCenter>
    );
  }

  if (commits.length === 0) {
    return (
      <GraphCenter>
        <div className="text-[10.5px] text-muted-foreground">No commits yet</div>
      </GraphCenter>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
          width: "100%",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const commit = commits[virtualRow.index];
          if (!commit) return null;
          return (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <GraphCommitRow
                commit={commit}
                graphRow={graphByCommit.get(commit.sha) ?? null}
                maxLaneCount={maxLaneCount}
                filesEntry={filesCacheRef.current.get(commit.sha) ?? null}
                onOpen={onOpenGitGraph}
                onHover={fetchFiles}
              />
            </div>
          );
        })}
      </div>
      {loadStatus === "more" ? (
        <div className="flex items-center justify-center gap-2 py-2 text-[10.5px] text-muted-foreground">
          <Spinner className="size-3" />
          Loading more…
        </div>
      ) : null}
      {loadStatus === "error" && commits.length > 0 ? (
        <div className="flex items-center justify-center gap-2 py-2 text-[10.5px] text-destructive">
          {error ?? "Failed to load more"}
          <Button
            size="xs"
            variant="ghost"
            className="h-6 cursor-pointer text-[10.5px]"
            onClick={() => void loadMore()}
          >
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function GraphCenter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-center">
      {children}
    </div>
  );
}

type GraphCommitRowProps = {
  commit: GitLogEntry;
  graphRow: GraphRow | null;
  maxLaneCount: number;
  filesEntry: FilesEntry | null;
  onOpen?: () => void;
  onHover: (sha: string) => void;
};

const GraphCommitRow = memo(function GraphCommitRow({
  commit,
  graphRow,
  maxLaneCount,
  filesEntry,
  onOpen,
  onHover,
}: GraphCommitRowProps) {
  return (
    <HoverCard
      openDelay={260}
      closeDelay={120}
      onOpenChange={(open) => {
        if (open) onHover(commit.sha);
      }}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => onOpen?.()}
          className="group flex h-full w-full cursor-pointer items-center gap-2 pl-1 pr-2 text-left transition-colors hover:bg-accent/30"
        >
          <span
            className="flex shrink-0 items-center justify-start"
            style={{ width: RAIL_RESERVED_PX }}
          >
            {graphRow ? (
              <GraphRail
                row={graphRow}
                rowHeight={ROW_HEIGHT}
                maxLaneCount={maxLaneCount}
              />
            ) : null}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11.5px] leading-tight text-foreground/95">
            {commit.subject || (
              <span className="text-muted-foreground">(no subject)</span>
            )}
          </span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
            {commit.shortSha}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0 shadow-xl"
      >
        <CommitHoverCard commit={commit} filesEntry={filesEntry} />
      </HoverCardContent>
    </HoverCard>
  );
});

function CommitHoverCard({
  commit,
  filesEntry,
}: {
  commit: GitLogEntry;
  filesEntry: FilesEntry | null;
}) {
  const totalStat = commit.insertions + commit.deletions;
  return (
    <div className="flex max-h-[60vh] min-h-0 flex-col">
      <div className="shrink-0 border-b border-border/45 p-3">
        <div className="flex items-start gap-2">
          <span className="mt-px shrink-0 rounded bg-muted/65 px-1.5 py-0.5 font-mono text-[10.5px] leading-none tabular-nums text-muted-foreground">
            {commit.shortSha}
          </span>
          <div className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug text-foreground">
            {commit.subject || (
              <span className="text-muted-foreground">(no subject)</span>
            )}
          </div>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span className="truncate">{commit.author || "Unknown"}</span>
          {commit.authorEmail ? (
            <>
              <span className="text-muted-foreground/45">·</span>
              <span className="truncate text-muted-foreground/85">
                {commit.authorEmail}
              </span>
            </>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <span
            className="shrink-0 tabular-nums"
            title={absoluteTime(commit.timestampSecs)}
          >
            {relativeTime(commit.timestampSecs)}
          </span>
          {commit.filesChanged > 0 ? (
            <>
              <span className="text-muted-foreground/45">·</span>
              <span className="shrink-0 tabular-nums">
                {commit.filesChanged}{" "}
                {commit.filesChanged === 1 ? "file" : "files"}
              </span>
            </>
          ) : null}
          {totalStat > 0 ? (
            <span className="ml-auto flex shrink-0 items-center gap-1.5 font-mono tabular-nums">
              {commit.insertions > 0 ? (
                <span className="font-semibold text-emerald-600/90 dark:text-emerald-400/90">
                  +{commit.insertions}
                </span>
              ) : null}
              {commit.deletions > 0 ? (
                <span className="font-semibold text-rose-600/90 dark:text-rose-400/90">
                  −{commit.deletions}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
      <CommitHoverFiles filesEntry={filesEntry} />
    </div>
  );
}

function CommitHoverFiles({ filesEntry }: { filesEntry: FilesEntry | null }) {
  if (!filesEntry || filesEntry.state === "loading") {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-[11px] text-muted-foreground">
        <Spinner className="size-3" />
        Loading files…
      </div>
    );
  }
  if (filesEntry.state === "error") {
    return (
      <div className="px-3 py-3 text-[11px] text-destructive">
        {filesEntry.error}
      </div>
    );
  }
  if (filesEntry.files.length === 0) {
    return (
      <div className="px-3 py-3 text-[11px] text-muted-foreground">
        No file changes.
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/85">
        <span>Files</span>
        <span className="rounded-sm bg-muted/55 px-1 py-px text-[9.5px] tabular-nums normal-case tracking-normal text-muted-foreground/85">
          {filesEntry.files.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
        <ul className="space-y-px px-1.5 pb-2">
          {filesEntry.files.map((file) => (
            <li key={file.path}>
              <HoverFileRow file={file} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const HoverFileRow = memo(function HoverFileRow({
  file,
}: {
  file: GitCommitFileChange;
}) {
  const fileName = basename(file.path);
  const dir = dirname(file.path);
  const iconUrl = fileIconUrl(fileName);
  return (
    <div className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left">
      {iconUrl ? (
        <img src={iconUrl} alt="" className="size-3.5 shrink-0" />
      ) : (
        <span className="size-3.5 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5 leading-none">
        <span className="truncate text-[11.5px] font-medium leading-tight">
          {fileName}
        </span>
        {dir ? (
          <span className="min-w-0 flex-1 truncate text-[10px] leading-tight text-muted-foreground/80">
            {dir}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums">
        {file.isBinary ? (
          <span className="text-muted-foreground/70">binary</span>
        ) : (
          <>
            {file.added > 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                +{file.added}
              </span>
            ) : null}
            {file.removed > 0 ? (
              <span className="text-rose-600 dark:text-rose-400">
                −{file.removed}
              </span>
            ) : null}
          </>
        )}
      </div>
      <span
        className={cn(
          "inline-flex w-4 shrink-0 justify-center text-[9.5px] font-bold leading-none tabular-nums",
          statusTone(file.status),
        )}
        title={file.statusLabel}
      >
        {file.status.toUpperCase()}
      </span>
    </div>
  );
});
