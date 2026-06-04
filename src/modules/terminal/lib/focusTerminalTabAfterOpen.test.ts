import type { Tab, TerminalTab } from "@/modules/tabs";
import { describe, expect, it, vi } from "vitest";
import { focusTerminalTabAfterOpen } from "./focusTerminalTabAfterOpen";

function terminalTab(id: number, leafId: number): TerminalTab {
  return {
    id,
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: leafId },
    activeLeafId: leafId,
  };
}

function editorTab(id: number): Tab {
  return {
    id,
    kind: "editor",
    title: "file.ts",
    path: "/file.ts",
    dirty: false,
    preview: false,
  };
}

function createScheduler() {
  const queue: (() => void)[] = [];
  return {
    schedule(callback: () => void) {
      queue.push(callback);
    },
    flushOne() {
      queue.shift()?.();
    },
    flushAll() {
      while (queue.length > 0) queue.shift()?.();
    },
    get pending() {
      return queue.length;
    },
  };
}

describe("focusTerminalTabAfterOpen", () => {
  it("focuses the new terminal once its handle is registered", () => {
    const scheduler = createScheduler();
    const tabsRef = { current: [terminalTab(3, 4)] as Tab[] };
    const activeIdRef = { current: 3 };
    const terminalRefs = { current: new Map() };
    const focus = vi.fn();

    focusTerminalTabAfterOpen({
      tabId: 3,
      tabsRef,
      activeIdRef,
      terminalRefs,
      schedule: scheduler.schedule,
      maxAttempts: 5,
      settleAttempts: 2,
    });

    scheduler.flushOne();
    expect(focus).not.toHaveBeenCalled();

    terminalRefs.current.set(4, { focus });
    scheduler.flushOne();
    expect(focus).toHaveBeenCalledTimes(1);

    scheduler.flushOne();
    expect(focus).toHaveBeenCalledTimes(2);
    expect(scheduler.pending).toBe(0);
  });

  it("stops when the opened tab is no longer active", () => {
    const scheduler = createScheduler();
    const tabsRef = { current: [terminalTab(3, 4)] as Tab[] };
    const activeIdRef = { current: 2 };
    const terminalRefs = { current: new Map([[4, { focus: vi.fn() }]]) };

    focusTerminalTabAfterOpen({
      tabId: 3,
      tabsRef,
      activeIdRef,
      terminalRefs,
      schedule: scheduler.schedule,
    });

    scheduler.flushAll();
    expect(terminalRefs.current.get(4)?.focus).not.toHaveBeenCalled();
  });

  it("ignores tabs that are not terminals", () => {
    const scheduler = createScheduler();
    const tabsRef = { current: [editorTab(3)] };
    const activeIdRef = { current: 3 };
    const terminalRefs = { current: new Map([[4, { focus: vi.fn() }]]) };

    focusTerminalTabAfterOpen({
      tabId: 3,
      tabsRef,
      activeIdRef,
      terminalRefs,
      schedule: scheduler.schedule,
    });

    scheduler.flushAll();
    expect(terminalRefs.current.get(4)?.focus).not.toHaveBeenCalled();
  });
});
