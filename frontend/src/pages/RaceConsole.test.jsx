// Single-race console (RaceConsole): each finish button carries the same
// non-finish outcome-code dropdown as the mini-series batch page, so the
// officer can score a boat DNF/DSQ/OCS/RET… straight from the finish grid.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("@/lib/api", () => {
  const api = {
    getRace: jest.fn(),
    getBoats: jest.fn(),
    getRaces: jest.fn(),
    selectBoats: jest.fn(),
    adjustResult: jest.fn(),
    recordFinish: jest.fn(),
    startRace: jest.fn(),
  };
  return { api, formatApiError: (d) => d || "error" };
});
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));

// Radix select stays out of jsdom — mimic it inline: the trigger renders its
// props (so data-testids land on a button) and every SelectItem fires
// onValueChange when clicked.
jest.mock("@/components/ui/select", () => {
  const React = require("react");
  const Ctx = React.createContext(null);
  const Select = ({ value, onValueChange, children }) => (
    <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
  );
  const SelectItem = ({ value, children }) => {
    const ctx = React.useContext(Ctx);
    return (
      <button type="button" data-testid={`select-item-${value}`} onClick={() => ctx?.onValueChange?.(value)}>
        {children}
      </button>
    );
  };
  const SelectTrigger = ({ children, ...rest }) => <button type="button" {...rest}>{children}</button>;
  // Radix shows the selected item's text in the closed trigger (its placeholder
  // when the value is empty) — the mock renders the controlled value so tests
  // can assert what the officer actually sees there.
  const SelectValue = ({ placeholder }) => {
    const ctx = React.useContext(Ctx);
    return <span>{ctx?.value ? ctx.value : (placeholder || null)}</span>;
  };
  return { Select, SelectItem, SelectTrigger, SelectContent: ({ children }) => <>{children}</>, SelectValue };
});

import { RaceConsole } from "./Officer";

const mockApi = require("@/lib/api").api;

let container;
let root;
const race = {
  id: "r1", race_number: 1, date: "2026-05-02", start_time: "10:30", class_id: "cl1",
  series_id: "s1", status: "setup", version: 3, course: "", special_rules: "", life_jackets: false,
  results: [
    { boat_id: "b1", code: "DNS", position: null, finish_time: null },
    { boat_id: "b2", code: "DNS", position: null, finish_time: null },
  ],
};

beforeEach(() => {
  mockApi.getRace.mockResolvedValue(race);
  mockApi.getBoats.mockResolvedValue([
    { id: "b1", name: "Bluebell", sail_no: "1" },
    { id: "b2", name: "Screwloose", sail_no: "2" },
  ]);
  mockApi.getRaces.mockResolvedValue([]);
  mockApi.selectBoats.mockResolvedValue({});
  mockApi.adjustResult.mockResolvedValue({});
  mockApi.recordFinish.mockResolvedValue({});
  mockApi.startRace.mockResolvedValue({});
  window.localStorage.clear();
});

afterEach(async () => {
  if (root) {
    await act(async () => {});
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  document.body.innerHTML = "";
  window.localStorage.clear();
  jest.clearAllMocks();
});

const DEFAULT_META = { class_id: "cl1", class_name: "Sonata", series_name: "Summer" };

// A slice of the /rrs-codes Appendix A catalogue. The console takes every code
// menu from that one list (the page fetches it), so the fixture supplies it.
const CODES = [
  { code: "FINISHED", label: "Finished (use position)" },
  { code: "DNS", label: "DNS — Did not start (other than DNC and OCS)" },
  { code: "OCS", label: "OCS — Did not start; on the course side at her starting signal" },
  { code: "DNF", label: "DNF — Did not finish" },
  { code: "DSQ", label: "DSQ — Disqualified" },
  { code: "DGM", label: "DGM — Disqualification for gross misconduct, not excludable under rule 90.3(b)" },
  { code: "DPI", label: "DPI — Discretionary penalty imposed (committee-entered points)" },
  { code: "RDG", label: "RDG — Redress given (committee-entered points)" },
];

const renderConsole = (meta = DEFAULT_META, extraProps = {}) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <RaceConsole
        raceId="r1"
        meta={meta}
        series={null}
        clubId="c1"
        onBack={jest.fn()}
        rrsCodes={CODES}
        dayRaces={[]}
        raceDayNotices={false}
        {...extraProps}
      />
    );
  });
  return container;
};

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("RaceConsole finish buttons", () => {
  it("shows a non-finish outcome dropdown under every finish button", async () => {
    renderConsole();
    await flush();
    expect(container.querySelector('[data-testid="finish-btn-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="finish-btn-2"]')).not.toBeNull();
    // Each button carries the outcome-code menu (DNF, DSQ, OCS…).
    expect(container.querySelectorAll('[data-testid^="finish-code-"]').length).toBe(2);
    expect(container.textContent).toContain("DNF");
  });

  it("scores a non-finish outcome (DNF) straight from the finish grid", async () => {
    renderConsole();
    await flush();
    act(() => {
      container.querySelector('[data-testid="finish-code-1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container.querySelector('[data-testid="select-item-DNF"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mockApi.adjustResult).toHaveBeenCalledWith("r1", "b1", { code: "DNF" }, 3);
  });
});

// Handicap races score on elapsed/corrected time, so the officer picks how
// times are entered: tapped live, typed as a finish time of day, or typed as
// an elapsed duration. All three go through the same finish endpoints, so the
// scoring engine never sees a difference.
const HANDICAP_META = { ...DEFAULT_META, class_name: "IRC Cruisers", scoring_mode: "irc" };

const click = (el) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

const type = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
};

const chooseMode = (id) => click(container.querySelector(`[data-testid="time-entry-mode-${id}"]`));

describe("RaceConsole handicap time entry", () => {
  it("swaps the tap grid for a typed table and remembers the choice", async () => {
    renderConsole(HANDICAP_META);
    await flush();
    expect(container.querySelector('[data-testid="finish-grid"]')).not.toBeNull();

    chooseMode("clock");
    expect(container.querySelector('[data-testid="time-entry-clock"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="finish-grid"]')).toBeNull();
    expect(window.localStorage.getItem("sailscore-time-entry")).toBe("clock");

    chooseMode("elapsed");
    expect(container.querySelector('[data-testid="time-entry-elapsed"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="time-entry-clock"]')).toBeNull();

    chooseMode("live");
    expect(container.querySelector('[data-testid="finish-grid"]')).not.toBeNull();
  });

  it("records a typed finish time of day against the race date", async () => {
    renderConsole(HANDICAP_META);
    await flush();
    chooseMode("clock");
    type(container.querySelector('[data-testid="clock-input-1"]'), "13:45:00");
    await flush();
    expect(mockApi.recordFinish).toHaveBeenCalledWith("r1", "b1", new Date("2026-05-02T13:45:00").toISOString(), 3);
  });

  it("records a typed elapsed duration", async () => {
    renderConsole(HANDICAP_META);
    await flush();
    chooseMode("elapsed");
    const fields = container.querySelectorAll('[data-testid="time-entry-elapsed"] tbody tr:first-child input');
    type(fields[0], "1");
    type(fields[1], "2");
    type(fields[2], "3");
    await flush();
    expect(mockApi.adjustResult).toHaveBeenCalledWith("r1", "b1", { elapsed_seconds: 3723 }, 3);
  });

  it("serialises rapid typed entries so a boat's own write cannot invalidate the next", async () => {
    let release;
    mockApi.recordFinish.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ version: 4 }); }));
    renderConsole(HANDICAP_META);
    await flush();
    chooseMode("clock");
    // Two rows keyed in quick succession, before the first round trip lands.
    type(container.querySelector('[data-testid="clock-input-1"]'), "13:00:00");
    type(container.querySelector('[data-testid="clock-input-2"]'), "13:01:00");
    await flush(); // the first send is now in flight; the second waits behind it
    expect(mockApi.recordFinish).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await Promise.resolve(); });
    expect(mockApi.recordFinish).toHaveBeenCalledTimes(2);
  });

  it("types the start every finish time is measured from", async () => {
    renderConsole(HANDICAP_META);
    await flush();
    // Prefilled from the scheduled class start until the real start is known.
    const input = container.querySelector('[data-testid="start-time-input"]');
    expect(input.value).toBe("10:30");
    type(input, "10:35:00");
    await flush();
    expect(mockApi.startRace).toHaveBeenCalledWith("r1", new Date("2026-05-02T10:35:00").toISOString(), 3);

    // Elapsed entry measures from the start rather than the finish, so that
    // mode carries no start editor.
    chooseMode("elapsed");
    expect(container.querySelector('[data-testid="start-time-input"]')).toBeNull();
  });

  it("says so when elapsed times have no start to measure from", async () => {
    mockApi.getRace.mockResolvedValue({ ...race, start_time: "", actual_start: null });
    renderConsole(HANDICAP_META);
    await flush();
    chooseMode("elapsed");
    expect(container.querySelector('[data-testid="elapsed-no-start-note"]')).not.toBeNull();
  });

  it("never shows a missing start time as null", async () => {
    mockApi.getRace.mockResolvedValue({ ...race, start_time: null, actual_start: null });
    renderConsole(HANDICAP_META);
    await flush();
    expect(container.textContent).not.toMatch(/Start null/);
    expect(container.textContent).not.toMatch(/Scheduled null/);
    expect(container.querySelector('[data-testid="race-clock-note"]').textContent)
      .toBe("No start set — press Start race, or type the actual start");
  });

  it("labels the race timer by what its number actually measures", async () => {
    // No gun fired: the number is time since the planned start, and the strip
    // says so instead of presenting it as the official race time.
    renderConsole(HANDICAP_META);
    await flush();
    let strip = container.querySelector('[data-testid="timing-strip"]');
    expect(strip.textContent).toContain("Since planned start");
    expect(container.querySelector('[data-testid="race-clock-note"]').textContent)
      .toBe("Not started — timing from the planned 10:30");

    // Gun fired: the same number becomes the official race time.
    mockApi.getRace.mockResolvedValue({ ...race, actual_start: `2026-05-02T10:30:00Z` });
    renderConsole(HANDICAP_META);
    await flush();
    strip = container.querySelector('[data-testid="timing-strip"]');
    expect(strip.textContent).toContain("Race timer");
    expect(container.querySelector('[data-testid="race-clock-note"]').textContent).toMatch(/^Started /);
  });

  it("keeps one-design races on tap order", async () => {
    renderConsole();
    await flush();
    expect(container.querySelector('[data-testid="time-entry-mode"]')).toBeNull();
    expect(container.querySelector('[data-testid="finish-grid"]')).not.toBeNull();
  });
});

// A code has to be reversible: an OCS that was not one, a protest dismissed, a
// redress withdrawn. FINISHED leads the code menus for exactly that. Each row
// carries its own menu, so the clicks are scoped to the row under test.
const clickIn = (scope, selector) =>
  act(() => scope.querySelector(selector).dispatchEvent(new MouseEvent("click", { bubbles: true })));
const rowOf = (table, n) => table.querySelectorAll("tbody tr")[n];

describe("RaceConsole clearing a code", () => {
  it("returns a penalised boat to a finish with the next place (one-design)", async () => {
    mockApi.getRace.mockResolvedValue({ ...race, results: [
      { boat_id: "b1", code: "FINISHED", position: 1, finish_time: null },
      { boat_id: "b2", code: "OCS", position: null, finish_time: null },
    ] });
    renderConsole(DEFAULT_META, { rrsCodes: [{ code: "FINISHED" }, { code: "OCS" }] });
    await flush();

    const row = rowOf(container.querySelector('[data-testid="adjust-table"]'), 1); // the OCS boat
    clickIn(row, '[data-testid="code-select-2"]');
    clickIn(row, '[data-testid="select-item-FINISHED"]');
    await flush();

    expect(mockApi.adjustResult).toHaveBeenCalledWith("r1", "b2", { code: "FINISHED", position: 2 }, 3);
  });

  it("leaves a handicap place to corrected time when the code is cleared", async () => {
    renderConsole(HANDICAP_META);
    await flush();
    chooseMode("clock");

    const row = rowOf(container.querySelector('[data-testid="time-entry-clock"]'), 0);
    clickIn(row, '[data-testid="time-code-1"]');
    clickIn(row, '[data-testid="select-item-FINISHED"]');
    await flush();

    expect(mockApi.adjustResult).toHaveBeenCalledWith("r1", "b1", { code: "FINISHED" }, 3);
  });
});

// DPI/RDG cannot be applied on the spot — the committee's points have to be
// entered with them — so picking one must hold the row in a pending state.
// The defect this pins: the select snapped back to the previous code, so the
// officer's click looked ignored (the row still read OCS) and nothing said
// what was waiting to be saved.
describe("RaceConsole committee decisions (DPI / RDG)", () => {
  const ocsRace = { ...race, results: [
    { boat_id: "b1", code: "FINISHED", position: 1, finish_time: null },
    { boat_id: "b2", code: "OCS", position: null, finish_time: null },
  ] };
  const pick = async (code) => {
    mockApi.getRace.mockResolvedValue(ocsRace);
    renderConsole();
    await flush();
    const row = rowOf(container.querySelector('[data-testid="adjust-table"]'), 1); // the OCS boat
    clickIn(row, '[data-testid="code-select-2"]');
    clickIn(row, `[data-testid="select-item-${code}"]`);
    await flush();
    return row;
  };
  const scoreOf = (sailNo) => container.querySelector(`[data-testid="decision-points-${sailNo}"]`);

  it("shows the picked RDG on the row while its points are entered", async () => {
    const row = await pick("RDG");

    expect(row.querySelector('[data-testid="pos-badge-2"]').textContent).toBe("RDG");
    expect(row.querySelector('[data-testid="code-select-2"]').textContent).toContain("RDG");
    expect(container.textContent).toContain("Not recorded yet");
    // Nothing is written until the points are saved — never inferred.
    expect(mockApi.adjustResult).not.toHaveBeenCalled();

    type(scoreOf(2), "4");
    click(container.querySelector('[data-testid="decision-save-2"]'));
    await flush();
    expect(mockApi.adjustResult).toHaveBeenCalledWith("r1", "b2", { code: "RDG", penalty_points: 4 }, 3);
  });

  it("will not save a decision without the committee's points", async () => {
    await pick("DPI");
    click(container.querySelector('[data-testid="decision-save-2"]'));
    await flush();
    expect(mockApi.adjustResult).not.toHaveBeenCalled();
  });

  it("offers one Appendix A catalogue in the typed-entry table as well", async () => {
    renderConsole(HANDICAP_META);
    await flush();
    chooseMode("clock");
    const row = rowOf(container.querySelector('[data-testid="time-entry-clock"]'), 0);
    ["FINISHED", "DNS", "DGM", "RDG", "DPI"].forEach((c) =>
      expect(row.querySelector(`[data-testid="select-item-${c}"]`)).not.toBeNull());
  });
});
