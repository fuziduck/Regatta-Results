// Tests for the Plausible analytics utility. The real script is never loaded
// in tests; we stub window.plausible with __setPlausibleForTests and assert
// on the calls the utility makes.
import { act } from "react";
import { createRoot } from "react-dom/client";

// React 19 warns when act() runs outside a concurrent-act environment (jsdom
// test setup). The hook under test is synchronous, so silence it for this file.
beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

import {
  PLAUSIBLE_DOMAIN,
  PLAUSIBLE_SCRIPT_URL,
  SAILSCORE_EVENTS,
  trackEvent,
  trackEventDebug,
  usePlausible,
  __setPlausibleForTests,
} from "@/lib/analytics";

const stubPlausible = () => {
  const calls = [];
  __setPlausibleForTests((...args) => calls.push(args));
  return calls;
};

afterEach(() => {
  __setPlausibleForTests(null);
});

describe("analytics constants", () => {
  it("targets the Sailscore Plausible instance and domain", () => {
    expect(PLAUSIBLE_SCRIPT_URL).toBe("https://analytics.sailscore.co.uk/js/script.js");
    expect(PLAUSIBLE_DOMAIN).toBe("sailscore.co.uk");
  });

  it("declares the planned Sailscore event names", () => {
    expect(SAILSCORE_EVENTS).toEqual({
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
  });
});

describe("trackEvent", () => {
  it("forwards the event name and simple props to window.plausible", () => {
    const calls = stubPlausible();
    trackEvent(SAILSCORE_EVENTS.VIEW_BOAT, { fleet_id: 42, class_name: "Sonata" });
    expect(calls).toEqual([["view_boat", { props: { fleet_id: 42, class_name: "Sonata" } }]]);
  });

  it("sends no props argument when none are given", () => {
    const calls = stubPlausible();
    trackEvent(SAILSCORE_EVENTS.LOGIN);
    expect(calls).toEqual([["login", {}]]);
  });

  it("is a silent no-op when the Plausible script has not loaded", () => {
    __setPlausibleForTests(null);
    expect(() => trackEvent(SAILSCORE_EVENTS.SEARCH, { q: "x" })).not.toThrow();
  });

  it("never throws when window.plausible exists but misbehaves", () => {
    __setPlausibleForTests(() => {
      throw new Error("network down");
    });
    expect(() => trackEvent(SAILSCORE_EVENTS.VIEW_SERIES)).not.toThrow();
  });

  it("ignores empty or non-string event names", () => {
    const calls = stubPlausible();
    trackEvent("");
    trackEvent(null);
    trackEvent(undefined);
    trackEvent(42);
    expect(calls).toEqual([]);
  });
});

describe("trackEvent PII guard", () => {
  it("drops props whose keys look like identifiers (email, name, tokens…)", () => {
    const calls = stubPlausible();
    trackEvent(SAILSCORE_EVENTS.LOGIN, {
      email: "someone@example.org",
      user_name: "Jane",
      authToken: "secret-token",
      passcode: "1234",
      ip_address: "1.2.3.4",
      first_name: "Jane",
      club_slug: "myc",
    });
    expect(calls[0][1].props).toEqual({ club_slug: "myc" });
  });

  it("drops values that look like email addresses regardless of key", () => {
    const calls = stubPlausible();
    trackEvent(SAILSCORE_EVENTS.SEARCH, { query: "jane@example.org" });
    expect(calls[0][1].props).toBeUndefined();
  });

  it("keeps only short primitives: strings, finite numbers, booleans", () => {
    const calls = stubPlausible();
    trackEvent(SAILSCORE_EVENTS.DOWNLOAD_RESULTS_PDF, {
      race_label: "R1",
      race_number: 3,
      cancelled: false,
      long_string: "x".repeat(201),
      boat_list: ["A", "B"],
      nested: { a: 1 },
      nothing: null,
    });
    expect(calls[0][1].props).toEqual({ race_label: "R1", race_number: 3, cancelled: false });
  });

  it("sends no props key when everything is filtered out", () => {
    const calls = stubPlausible();
    trackEvent(SAILSCORE_EVENTS.VIEW_CLASS, { email: "x@y.org" });
    expect(calls[0]).toEqual(["view_class", {}]);
  });

  it("passes through explicit Plausible options (e.g. callback) alongside props", () => {
    const calls = stubPlausible();
    const callback = jest.fn();
    trackEvent(SAILSCORE_EVENTS.SEARCH, { q: "sonata" }, { callback });
    expect(calls[0][1]).toEqual({ props: { q: "sonata" }, callback });
  });
});

describe("trackEventDebug", () => {
  it("still forwards to window.plausible", () => {
    const calls = stubPlausible();
    trackEventDebug(SAILSCORE_EVENTS.VIEW_REGATTA, { club_slug: "myc" });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("view_regatta");
  });
});

describe("usePlausible", () => {
  function renderHook() {
    let value;
    function Probe() {
      value = usePlausible();
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<Probe />));
    root.unmount();
    container.remove();
    return value;
  }

  it("returns the shared trackEvent function", () => {
    const track = renderHook();
    expect(track).toBe(trackEvent);
    const calls = stubPlausible();
    act(() => track(SAILSCORE_EVENTS.VIEW_BOAT, { fleet_id: 7 }));
    expect(calls).toEqual([["view_boat", { props: { fleet_id: 7 } }]]);
  });
});
