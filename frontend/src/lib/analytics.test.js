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
  trackViewEvent,
  clearViewEvent,
  resetTrackedViews,
  usePlausible,
  useTrackView,
  __setPlausibleForTests,
} from "@/lib/analytics";

const stubPlausible = () => {
  const calls = [];
  __setPlausibleForTests((...args) => calls.push(args));
  return calls;
};

afterEach(() => {
  __setPlausibleForTests(null);
  resetTrackedViews();
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

  it("drops people keys (helm, skipper, crew, owner) but keeps boat/class/club names", () => {
    const calls = stubPlausible();
    trackEvent(SAILSCORE_EVENTS.VIEW_BOAT, {
      boat_name: "Watersong",
      class_name: "Sonata",
      club: "myc",
      helm: "Jane Doe",
      skipper: "Jane Doe",
      crew_names: ["A", "B"],
      owner_email: "jane@example.org",
    });
    expect(calls[0][1].props).toEqual({
      boat_name: "Watersong",
      class_name: "Sonata",
      club: "myc",
    });
  });

  it("keeps the coarse role prop on login events but nothing identifying", () => {
    const calls = stubPlausible();
    trackEvent(SAILSCORE_EVENTS.LOGIN, {
      role: "admin",
      username: "officer1",
      user_id: "u-123",
      session_id: "sess-abc",
      // Club names are sailing data, not PII, so the guard keeps them —
      // but Login.jsx deliberately sends only `role` on login events.
      club_name: "Medway Yacht Club",
    });
    expect(calls[0][1].props).toEqual({ role: "admin", club_name: "Medway Yacht Club" });
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

describe("every SAILSCORE_EVENT can be tracked", () => {
  it("fires each event name with coarse props", () => {
    const calls = stubPlausible();
    const samples = {
      [SAILSCORE_EVENTS.VIEW_REGATTA]: { regatta_id: "r1", regatta_name: "Spring Open", club: "myc" },
      [SAILSCORE_EVENTS.VIEW_RESULTS]: { regatta_id: "r1", class_name: "Sonata" },
      [SAILSCORE_EVENTS.VIEW_SERIES]: { series_id: "s1", series_name: "Saturday Series", club: "myc" },
      [SAILSCORE_EVENTS.VIEW_BOAT]: { boat_id: "b1", boat_name: "Watersong", class_name: "Sonata" },
      [SAILSCORE_EVENTS.VIEW_CLASS]: { class_id: "c1", class_name: "Sonata", club: "myc" },
      [SAILSCORE_EVENTS.DOWNLOAD_RESULTS_PDF]: { regatta_id: "r1", series_id: "s1" },
      [SAILSCORE_EVENTS.DOWNLOAD_SERIES_PDF]: { series_id: "s1", club: "myc" },
      [SAILSCORE_EVENTS.SEARCH]: { search_type: "boat", result_count: 3 },
      [SAILSCORE_EVENTS.LOGIN]: { role: "officer" },
    };
    for (const [name, props] of Object.entries(samples)) {
      expect(trackEvent(name, props)).toBe(true);
    }
    expect(calls.map((c) => c[0])).toEqual(Object.keys(samples));
    calls.forEach(([, opts], i) => {
      expect(opts.props).toEqual(samples[calls[i][0]]);
    });
  });
});

describe("trackViewEvent dedupe", () => {
  it("fires once per identity, even when called repeatedly (rerenders)", () => {
    const calls = stubPlausible();
    const props = () => ({ regatta_id: "r1", regatta_name: "Spring Open" });
    expect(trackViewEvent(SAILSCORE_EVENTS.VIEW_REGATTA, "r1", props())).toBe(true);
    // Five more renders of the same logical view:
    for (let i = 0; i < 5; i += 1) {
      expect(trackViewEvent(SAILSCORE_EVENTS.VIEW_REGATTA, "r1", props())).toBe(false);
    }
    expect(calls).toHaveLength(1);
  });

  it("keeps separate identities and event names independent", () => {
    const calls = stubPlausible();
    trackViewEvent(SAILSCORE_EVENTS.VIEW_REGATTA, "r1");
    trackViewEvent(SAILSCORE_EVENTS.VIEW_REGATTA, "r2");
    trackViewEvent(SAILSCORE_EVENTS.VIEW_BOAT, "r1");
    expect(calls).toHaveLength(3);
  });

  it("re-fires after the view identity is cleared (a genuine second view)", () => {
    const calls = stubPlausible();
    trackViewEvent(SAILSCORE_EVENTS.VIEW_BOAT, "b1");
    clearViewEvent(SAILSCORE_EVENTS.VIEW_BOAT, "b1");
    expect(trackViewEvent(SAILSCORE_EVENTS.VIEW_BOAT, "b1")).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("does not consume the guard when the script is unavailable, so the view can still be recorded later", () => {
    __setPlausibleForTests(null);
    expect(trackViewEvent(SAILSCORE_EVENTS.VIEW_RESULTS, "r1")).toBe(false);
    const calls = stubPlausible();
    expect(trackViewEvent(SAILSCORE_EVENTS.VIEW_RESULTS, "r1")).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("ignores empty identities", () => {
    const calls = stubPlausible();
    trackViewEvent(SAILSCORE_EVENTS.VIEW_SERIES, null);
    trackViewEvent(SAILSCORE_EVENTS.VIEW_SERIES, undefined);
    trackViewEvent(SAILSCORE_EVENTS.VIEW_SERIES, "");
    expect(calls).toEqual([]);
  });
});

describe("useTrackView hook", () => {
  function renderTrackView(name, identityKey, props) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let latestProps = props;
    const setLatestProps = (p) => { latestProps = p; };
    function Probe() {
      useTrackView(name, identityKey, latestProps);
      return null;
    }
    act(() => root.render(<Probe />));
    return {
      rerender(nextProps) {
        if (nextProps) setLatestProps(nextProps);
        act(() => root.render(<Probe />));
      },
      unmount() {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it("fires once and survives rerenders with fresh prop objects", () => {
    const calls = stubPlausible();
    const view = renderTrackView(SAILSCORE_EVENTS.VIEW_REGATTA, "r1", { regatta_id: "r1" });
    // Rerenders pass new object literals, as React code naturally would.
    view.rerender({ regatta_id: "r1" });
    view.rerender({ regatta_id: "r1" });
    view.unmount();
    expect(calls).toEqual([["view_regatta", { props: { regatta_id: "r1" } }]]);
  });

  it("records a new view when the identity changes", () => {
    const calls = stubPlausible();
    const view = renderTrackView(SAILSCORE_EVENTS.VIEW_BOAT, "b1", { boat_id: "b1" });
    view.rerender();
    const second = renderTrackView(SAILSCORE_EVENTS.VIEW_BOAT, "b2", { boat_id: "b2" });
    second.unmount();
    view.unmount();
    expect(calls.map((c) => c[1].props.boat_id)).toEqual(["b1", "b2"]);
  });

  it("re-fires when the same component returns to the same identity after unmount", () => {
    const calls = stubPlausible();
    const first = renderTrackView(SAILSCORE_EVENTS.VIEW_CLASS, "c1", { class_id: "c1" });
    first.unmount();
    const second = renderTrackView(SAILSCORE_EVENTS.VIEW_CLASS, "c1", { class_id: "c1" });
    second.unmount();
    expect(calls).toHaveLength(2);
  });

  it("does not fire while the identity is null (page still loading)", () => {
    const calls = stubPlausible();
    const view = renderTrackView(SAILSCORE_EVENTS.VIEW_SERIES, null, { series_id: "s1" });
    view.rerender();
    view.unmount();
    expect(calls).toEqual([]);
  });

  it("does not fire when the script is missing, and never throws", () => {
    __setPlausibleForTests(null);
    const view = renderTrackView(SAILSCORE_EVENTS.VIEW_RESULTS, "r1", { regatta_id: "r1" });
    view.rerender();
    view.unmount();
    expect(() => {}).not.toThrow();
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
