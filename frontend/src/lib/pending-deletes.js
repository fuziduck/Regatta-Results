// A confirmed delete waits out an undo window before it is sent to the server,
// and that wait is only a timer in this page. A reload, a closed tab or a phone
// locking inside the window destroyed the timer, so the delete was silently
// dropped: the officer had watched the race go, and it came back with every
// result still attached. Remember the confirmed delete with just enough to
// replay it, send it as the page goes away, and retry it on the next load.
const STORAGE_KEY = "sailscore.pendingDeletes";
const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

// A remembered intent is only worth honouring for as long as the officer could
// still think of it as "just now". Anything older is dropped rather than
// deleting a race days later when they next sign in.
const TTL_MS = 24 * 60 * 60 * 1000;

const readAll = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    const now = Date.now();
    return list.filter((e) => e && e.token && e.path && (!e.expiresAt || e.expiresAt > now));
  } catch {
    return [];
  }
};

const writeAll = (list) => {
  try {
    if (list.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked or full — the in-page timer still covers this session.
  }
};

export function pendingDeletes() {
  return readAll();
}

export function rememberDeferredDelete(entry) {
  writeAll([...readAll().filter((e) => e.token !== entry.token), entry]);
}

export function forgetDeferredDelete(token) {
  const list = readAll();
  const next = list.filter((e) => e.token !== token);
  if (next.length !== list.length) writeAll(next);
}

/**
 * Send every remembered delete. `keepalive` lets the request outlive the
 * document, so a refresh straight after confirming still reaches the server.
 */
export async function flushDeferredDeletes({ keepalive = false } = {}) {
  const list = readAll();
  // Prune expired entries as we go, so a long-dead intent never comes back.
  if (list.length) writeAll(list);
  // Issue every request before awaiting any: on unload there is no time to
  // wait for the first one to come back.
  await Promise.all(list.map(async (entry) => {
    try {
      const res = await fetch(`${API}${entry.path}`, {
        method: entry.method || "DELETE",
        credentials: "include",
        keepalive,
      });
      // 404: already gone. 409: the record moved on (someone else edited it) —
      // either way this remembered intent is spent.
      if (res.ok || res.status === 404 || res.status === 409) forgetDeferredDelete(entry.token);
    } catch {
      // Offline, or the unload killed it: keep it for the next load.
    }
  }));
}

let installed = false;
export function installDeferredDeleteFlush() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("pagehide", () => {
    // Fire-and-forget: the request is keepalive so it survives the document.
    flushDeferredDeletes({ keepalive: true });
  });
}

// Tests need a clean slate between cases; the app never calls this.
export function __resetPendingDeletes() {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  installed = false;
}

export const DEFERRED_TTL_MS = TTL_MS;
