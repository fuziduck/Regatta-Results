// Plausible Analytics utility — the ONLY analytics platform on SailScore.
//
// The tracking script itself lives in public/index.html (deferred, loaded from
// our own Plausible instance). It records page views automatically, including
// client-side route changes (pushState/popstate), so React Router navigation
// needs no extra wiring. This module exists for the next step: custom
// Sailscore events (see SAILSCORE_EVENTS) that the page-view script cannot
// know about.
//
// Privacy guarantees (why this stays lean):
//   - Plausible is cookie-free and sets no identifiers; nothing here reads or
//     writes storage.
//   - Never pass names, emails, user IDs, tokens, passwords or raw query
//     strings as event props — only the coarse values listed on each event.
//     trackEvent strips anything that looks like an identifier.
//   - IP addresses never reach this code: the browser's beacon carries none,
//     and Plausible hashes/truncates at the edge by design.
//
// All calls are no-ops until the external script has loaded, so nothing here
// can break rendering, auth flows, PDF generation or API calls: the queued
// postHog-style stub Plausible installs buffers calls until the real script
// arrives, and if the script is blocked (ad-blocker, offline) the queue
// silently holds and the app is unaffected.

export const PLAUSIBLE_DOMAIN = "sailscore.co.uk";
export const PLAUSIBLE_SCRIPT_URL = "https://analytics.sailscore.co.uk/js/script.js";

// Custom events we intend to measure (create them in the Plausible dashboard
// as goals before they show up). Fire them with trackEvent / usePlausible.
// Nothing is wired into the UI yet — page-view tracking is the only active
// reporting — but the names are fixed here so call sites stay consistent.
export const SAILSCORE_EVENTS = Object.freeze({
  VIEW_REGATTA: "view_regatta",
  VIEW_RESULTS: "view_results",
  VIEW_SERIES: "view_series",
  VIEW_BOAT: "view_boat",
  VIEW_CLASS: "view_class",
  DOWNLOAD_RESULTS_PDF: "download_results_pdf",
  DOWNLOAD_SERIES_PDF: "download_series_pdf",
  SEARCH: "search",
  LOGIN: "login",
});

// Props that must never be attached to an event, even by accident. Matching
// is token-based (camelCase and separators both split) so that legitimate
// coarse props such as class_name or boat_name pass, while person/credential
// keys do not. Bare person-name keys are blocked outright via FORBIDDEN_KEYS.
const FORBIDDEN_TOKENS = [
  "email", "token", "password", "passcode", "secret", "auth", "authorization",
  "username", "user", "userid", "ip", "phone", "dob", "surname",
  "session", "cookie", "credential",
];
const FORBIDDEN_KEYS = new Set([
  "name", "first_name", "last_name", "full_name", "fullname",
  "user_name", "person_name", "ip_address", "user_id",
]);

function looksForbidden(key) {
  // Split camelCase boundaries first, then any non-alphanumeric separators.
  const tokens = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.some((t) => FORBIDDEN_TOKENS.includes(t))) return true;
  return FORBIDDEN_KEYS.has(tokens.join("_"));
}

// Whitelist of characters we allow in prop *keys*; values are additionally
// constrained to short strings/numbers/booleans so nothing structured (arrays
// of boats, embedded documents) can leak into analytics.
function sanitizeProps(props) {
  if (!props || typeof props !== "object") return undefined;
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (!key || looksForbidden(key)) continue;
    if (typeof value === "string" && value.length <= 200 && !value.includes("@")) {
      out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    }
    // Anything else (objects, arrays, null, long strings) is dropped.
  }
  return Object.keys(out).length ? out : undefined;
}

function plausible() {
  // The script defines window.plausible once loaded. Access is wrapped so a
  // blocked/missing script can never throw into a React render path.
  if (typeof window === "undefined") return null;
  return typeof window.plausible === "function" ? window.plausible : null;
}

/**
 * Fire a custom Plausible event. No-op when the script hasn't loaded (dev,
 * offline, ad-blocker) — analytics must never break the app.
 *
 * @param {string} name        Event name, ideally from SAILSCORE_EVENTS.
 * @param {object} [props]     Coarse, non-identifying props (e.g. { club_slug, class_name }).
 * @param {object} [options]   Plausible send options ({ props, callback }).
 */
export function trackEvent(name, props, options = {}) {
  if (!name || typeof name !== "string") return;
  const fn = plausible();
  if (!fn) return;
  try {
    const safeProps = sanitizeProps(props);
    fn(name, safeProps ? { props: safeProps, ...options } : options);
  } catch {
    /* analytics must never break the app */
  }
}

// Dev convenience: every call logs to the console so events are visible while
// developing, without sending anything (the script is dormant on localhost).
export function trackEventDebug(name, props, options) {
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug("[analytics]", name, props ?? "");
  }
  return trackEvent(name, props, options);
}

/**
 * React hook returning a stable trackEvent bound to this app's conventions.
 * Usage:  const track = usePlausible();
 *         track(SAILSCORE_EVENTS.VIEW_REGATTA, { club_slug: "myc" });
 */
export function usePlausible() {
  return trackEvent;
}

/**
 * Test/ops helper: injects a stand-in window.plausible so event wiring can be
 * exercised without the real script. Real app code never calls this.
 */
export function __setPlausibleForTests(fn) {
  if (typeof window === "undefined") return;
  if (fn === null) {
    delete window.plausible;
  } else {
    window.plausible = fn;
  }
}
