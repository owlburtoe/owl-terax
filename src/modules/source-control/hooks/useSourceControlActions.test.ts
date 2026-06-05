import { describe, expect, it, vi } from "vitest";
import { runCommitThenRemote } from "./useSourceControlActions";

describe("runCommitThenRemote", () => {
  it("keeps the commit and reports the remote error on remote failure", async () => {
    const commit = vi.fn().mockResolvedValue({ ok: true });
    const remote = vi
      .fn()
      .mockResolvedValue({ ok: false, action: "push", error: "Push failed: x" });
    const result = await runCommitThenRemote(commit, remote);
    expect(commit).toHaveBeenCalledOnce();
    expect(remote).toHaveBeenCalledOnce();
    expect(result).toEqual({
      committed: true,
      remoteOk: false,
      error: "Push failed: x",
    });
  });

  it("does not run the remote step when commit fails", async () => {
    const commit = vi.fn().mockResolvedValue({ ok: false, error: "empty" });
    const remote = vi.fn();
    const result = await runCommitThenRemote(commit, remote);
    expect(remote).not.toHaveBeenCalled();
    expect(result).toEqual({
      committed: false,
      remoteOk: false,
      error: "empty",
    });
  });

  it("reports full success when both steps succeed", async () => {
    const commit = vi.fn().mockResolvedValue({ ok: true });
    const remote = vi.fn().mockResolvedValue({ ok: true, action: "push" });
    const result = await runCommitThenRemote(commit, remote);
    expect(result).toEqual({ committed: true, remoteOk: true, error: null });
  });
});
