// A confirmed delete waits out an undo window before the server is told, and
// that window used to live only in this page's timers: a refresh (or a closed
// tab) inside it destroyed the timer, so the delete was never sent and the race
// came back with every result still attached. The remembered delete is what a
// reloaded page replays.
import {
  __resetPendingDeletes,
  flushDeferredDeletes,
  forgetDeferredDelete,
  pendingDeletes,
  rememberDeferredDelete,
} from "./pending-deletes";

const KEY = "sailscore.pendingDeletes";
const ENTRY = { token: "t1", path: "/races/r1" };

beforeEach(() => {
  __resetPendingDeletes();
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
  __resetPendingDeletes();
});

describe("remembered deletes", () => {
  it("stores a confirmed delete so a later page can replay it", () => {
    rememberDeferredDelete({ ...ENTRY, expiresAt: Date.now() + 60_000 });

    expect(JSON.parse(window.localStorage.getItem(KEY))).toEqual([
      { ...ENTRY, expiresAt: expect.any(Number) },
    ]);
    expect(pendingDeletes().map((e) => e.path)).toEqual(["/races/r1"]);
  });

  it("forgets the delete when the officer takes it back", () => {
    rememberDeferredDelete(ENTRY);
    forgetDeferredDelete("t1");

    expect(pendingDeletes()).toEqual([]);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("replays it with the session cookie, then clears it", async () => {
    rememberDeferredDelete(ENTRY);
    global.fetch.mockResolvedValue({ ok: true, status: 204 });

    await flushDeferredDeletes();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(String(url)).toContain("/api/races/r1");
    expect(opts).toMatchObject({ method: "DELETE", credentials: "include" });
    expect(pendingDeletes()).toEqual([]);
  });

  it("keeps a delete that could not be sent so the next load retries", async () => {
    rememberDeferredDelete(ENTRY);
    global.fetch.mockRejectedValue(new Error("offline"));

    await flushDeferredDeletes();

    expect(pendingDeletes()).toHaveLength(1);
  });

  it("drops a delete the server no longer has", async () => {
    rememberDeferredDelete(ENTRY);
    global.fetch.mockResolvedValue({ ok: false, status: 404 });

    await flushDeferredDeletes();

    expect(pendingDeletes()).toEqual([]);
  });

  it("ignores an intent that has gone stale", () => {
    rememberDeferredDelete({ ...ENTRY, expiresAt: Date.now() - 1 });

    expect(pendingDeletes()).toEqual([]);
  });

  it("marks the replay keepalive when it runs as the page goes away", async () => {
    rememberDeferredDelete(ENTRY);
    global.fetch.mockResolvedValue({ ok: true, status: 204 });

    await flushDeferredDeletes({ keepalive: true });

    expect(global.fetch.mock.calls[0][1]).toMatchObject({ keepalive: true });
  });
});
