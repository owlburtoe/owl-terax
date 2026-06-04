import type { Tab } from "@/modules/tabs";

export type TerminalFocusHandle = {
  focus: () => void;
};

type Ref<T> = {
  current: T;
};

type Schedule = (callback: () => void) => void;

export type FocusTerminalTabAfterOpenOptions = {
  tabId: number;
  tabsRef: Ref<Tab[]>;
  activeIdRef: Ref<number>;
  terminalRefs: Ref<Map<number, TerminalFocusHandle>>;
  schedule?: Schedule;
  maxAttempts?: number;
  settleAttempts?: number;
};

const scheduleNextFrame: Schedule = (callback) => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
};

export function focusTerminalTabAfterOpen({
  tabId,
  tabsRef,
  activeIdRef,
  terminalRefs,
  schedule = scheduleNextFrame,
  maxAttempts = 12,
  settleAttempts = 3,
}: FocusTerminalTabAfterOpenOptions): () => void {
  let cancelled = false;
  let attempts = 0;
  let settled = 0;

  const tick = () => {
    if (cancelled) return;
    attempts += 1;
    if (activeIdRef.current !== tabId) return;

    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "terminal") return;

    const terminal = terminalRefs.current.get(tab.activeLeafId);
    if (terminal) {
      terminal.focus();
      settled += 1;
      if (settled >= settleAttempts) return;
    }

    if (attempts >= maxAttempts) return;
    schedule(tick);
  };

  schedule(tick);

  return () => {
    cancelled = true;
  };
}
