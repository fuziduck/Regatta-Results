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
    deleteRace: jest.fn(),
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
import { UNDO_WINDOW_MS, setUndoWindowMs } from "@/hooks/use-delete-with-undo";

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
  setUndoWindowMs(UNDO_WINDOW_MS);
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

// Same-day races are stacked as separate cards, each with its own actions.
// An embedded console must not paint a viewport-wide fixed bottom bar: several
// of those landed on the same coordinates, so the last race in the DOM owned
// Publish for every race on the page.
describe("RaceConsole embedded in a same-day race card", () => {
  it("labels its own box and keeps the publish controls inside it", async () => {
    renderConsole(DEFAULT_META, { embedded: true });
    await flush();
    expect(container.querySelector('[data-testid="race-console-embedded-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="console-race-chip-1"]').textContent).toBe("R1");
    expect(container.querySelector('[class*="fixed bottom-0"]')).toBeNull();
    expect(container.querySelector('[data-testid="publish-btn"]')).not.toBeNull();
  });

  it("still pins its actions to the viewport when it is the whole page", async () => {
    renderConsole();
    await flush();
    expect(container.querySelector('[class*="fixed bottom-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="console-race-chip-1"]')).toBeNull();
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

    // The same editor stays in the timer for elapsed entry: a duration is
    // turned into a finish time from this start, and the race's official start
    // has to be right whichever mode the officer is typing in.
    chooseMode("elapsed");
    const elapsedInput = container.querySelector('[data-testid="start-time-input"]');
    expect(elapsedInput).not.toBeNull();
    type(elapsedInput, "10:38:00");
    await flush();
    expect(mockApi.startRace).toHaveBeenLastCalledWith("r1", new Date("2026-05-02T10:38:00").toISOString(), 3);
  });

  it("resets the gun from the elapsed-time view too", async () => {
    mockApi.getRace.mockResolvedValue({ ...race, actual_start: "2026-05-02T10:35:00Z" });
    renderConsole(HANDICAP_META);
    await flush();
    chooseMode("elapsed");

    const reset = container.querySelector('[data-testid="clear-gun-btn"]');
    expect(reset).not.toBeNull();
    click(reset);
    await flush();
    expect(mockApi.startRace).toHaveBeenCalledWith("r1", null, 3);
  });

  it("says so when elapsed times have no start to measure from", async () => {
    mockApi.getRace.mockResolvedValue({ ...race, start_time: "", actual_start: null });
    renderConsole(HANDICAP_META);
    await flush();
    chooseMode("elapsed");
    expect(container.querySelector('[data-testid="elapsed-no-start-note"]')).not.toBeNull();
    // ... and offers the fix in place, rather than sending the officer to
    // another mode to set it.
    expect(container.querySelector('[data-testid="start-time-input"]')).not.toBeNull();
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

  it("lets dual-scored series record one finish time for every scoring view", async () => {
    renderConsole(HANDICAP_META, {
      series: { scoring_mode: "irc", scoring_modes: ["irc", "ytc"] },
    });
    await flush();

    expect(container.textContent).toContain("IRC + YTC results from one finish-time entry");
    expect(container.querySelectorAll('[data-testid="time-entry-mode"]')).toHaveLength(1);
    click(container.querySelector('[data-testid="finish-btn-1"]'));
    await flush();
    expect(mockApi.recordFinish).toHaveBeenCalledTimes(1);
    expect(mockApi.recordFinish).toHaveBeenCalledWith("r1", "b1", expect.any(String), 3);
  });

  it("shows the scoring basis and a place per scoring system while times are entered", async () => {
    mockApi.getRace.mockResolvedValue({
      ...race,
      status: "provisional",
      scoring_positions: { irc: { b1: 2, b2: 1 }, ytc: { b1: 1, b2: 2 } },
      results: [
        { boat_id: "b1", code: "FINISHED", position: 2, finish_time: "2026-05-02T11:02:00Z" },
        { boat_id: "b2", code: "FINISHED", position: 1, finish_time: "2026-05-02T11:01:00Z" },
      ],
    });
    renderConsole(HANDICAP_META, { series: { scoring_mode: "irc", scoring_modes: ["irc", "ytc"] } });
    await flush();
    chooseMode("clock");

    const basis = container.querySelector('[data-testid="scoring-basis"]').textContent;
    expect(basis).toContain("Scoring: IRC (TCC) + YTC (YTC number)");
    expect(basis).toContain("one finish time produces a corrected result in each");

    const table = container.querySelector('[data-testid="time-entry-clock"]');
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent))
      .toEqual(expect.arrayContaining(["IRC Pos", "YTC Pos"]));
    expect(table.querySelector('[data-testid="time-pos-irc-1"]').textContent).toBe("2");
    expect(table.querySelector('[data-testid="time-pos-ytc-1"]').textContent).toBe("1");

    // The provisional table carries both places too.
    expect(container.querySelector('[data-testid="adjust-pos-head-irc"]').textContent).toBe("IRC Pos");
    expect(container.querySelector('[data-testid="adjust-pos-ytc-2"]').textContent).toBe("2");
  });

  it("leaves a system's place blank when the boat has no certificate for it", async () => {
    mockApi.getRace.mockResolvedValue({
      ...race,
      scoring_positions: { irc: { b1: 1 } },
      results: [
        { boat_id: "b1", code: "FINISHED", position: 1, finish_time: "2026-05-02T11:02:00Z" },
        { boat_id: "b2", code: "FINISHED", position: 2, finish_time: "2026-05-02T11:03:00Z" },
      ],
    });
    renderConsole(HANDICAP_META, { series: { scoring_mode: "irc", scoring_modes: ["irc", "ytc"] } });
    await flush();
    chooseMode("clock");

    // b1 is IRC-rated only, b2 is rated for neither: neither gets an invented
    // place in a table they do not belong to.
    expect(container.querySelector('[data-testid="time-pos-irc-1"]').textContent).toBe("1");
    expect(container.querySelector('[data-testid="time-pos-ytc-1"]').textContent).toBe("—");
    expect(container.querySelector('[data-testid="time-pos-irc-2"]').textContent).toBe("—");
  });

  it("marks an unrated boat in a split class and gives her no place there", async () => {
    mockApi.getBoats.mockResolvedValue([
      { id: "b1", name: "Bluebell", sail_no: "1", tcc: 1.01 },
      { id: "b2", name: "Screwloose", sail_no: "2", ytc: 1000 },
      { id: "b3", name: "Unrated", sail_no: "3" },
    ]);
    mockApi.getRace.mockResolvedValue({
      ...race,
      results: [
        { boat_id: "b1", code: "FINISHED", position: 1, finish_time: "2026-05-02T11:01:00Z" },
        { boat_id: "b2", code: "FINISHED", position: 1, finish_time: "2026-05-02T11:02:00Z" },
        { boat_id: "b3", code: "FINISHED", position: 1, finish_time: "2026-05-02T11:03:00Z" },
      ],
    });
    renderConsole({
      ...HANDICAP_META,
      divisions: [
        { name: "IRC", scoring_mode: "irc" },
        { name: "YTC", scoring_mode: "ytc" },
      ],
    });
    await flush();
    chooseMode("clock");

    expect(container.querySelector('[data-testid="time-division-1"]').textContent).toBe("IRC");
    expect(container.querySelector('[data-testid="time-division-2"]').textContent).toBe("YTC");
    expect(container.querySelector('[data-testid="time-unrated-3"]').textContent).toBe("No rating");
    expect(container.querySelector('[data-testid="time-pos-3"]').textContent).toBe("—");
    expect(container.querySelector('[data-testid="row-unrated-3"]').textContent).toBe("No rating");
    expect(container.querySelector('[data-testid="pos-input-3"]')).toBeNull();
    expect(container.querySelector('[data-testid="adjust-pos-3"]').textContent).toBe("—");
  });

  it("names the certificate a single-system race scores by and who it leaves out", async () => {
    mockApi.getBoats.mockResolvedValue([
      { id: "b1", name: "Bluebell", sail_no: "1", tcc: 1.01 },
      { id: "b2", name: "Screwloose", sail_no: "2", ytc: 1000 },
    ]);
    mockApi.getRace.mockResolvedValue({
      ...race,
      results: [
        { boat_id: "b1", code: "FINISHED", position: 1, finish_time: "2026-05-02T11:01:00Z" },
        { boat_id: "b2", code: "FINISHED", position: null, finish_time: "2026-05-02T11:02:00Z" },
      ],
    });
    renderConsole(HANDICAP_META);
    await flush();
    chooseMode("clock");

    const basis = container.querySelector('[data-testid="scoring-basis"]').textContent;
    expect(basis).toContain("Scoring: IRC (TCC)");
    expect(basis).toContain("a boat without one gets no place here");

    // The TCC boat is placed; the YTC-only boat is not scored in this race,
    // but her finish time still stands (it scores her in the YTC series).
    expect(container.querySelector('[data-testid="time-pos-1"]').textContent).toBe("1");
    expect(container.querySelector('[data-testid="time-pos-2"]').textContent).toBe("—");
    expect(container.querySelector('[data-testid="time-unrated-2"]').textContent).toBe("No IRC rating");
    expect(container.querySelector('[data-testid="clock-input-2"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="row-unrated-2"]').textContent).toBe("No IRC rating");
    expect(container.querySelector('[data-testid="pos-input-2"]')).toBeNull();
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

  // The defect: those two menus bound their value straight to the STORED code.
  // TLE writes immediately, so it stuck — but DPI/RDG deliberately hold the
  // pick until the committee's points arrive, so `r.code` never changed and the
  // select snapped back to DNS/Code…. The officer's RDG click looked ignored.
  it("holds an RDG picked from the finish grid instead of snapping back", async () => {
    renderConsole();
    await flush();
    // Both fixture boats are DNS, so both sit in the tap grid.
    act(() => {
      container.querySelector('[data-testid="finish-code-1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container.querySelector('[data-testid="select-item-RDG"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.querySelector('[data-testid="finish-code-1"]').textContent).toContain("RDG");
    expect(container.querySelector('[data-testid="pending-decision-1"]')).not.toBeNull();
    // Still nothing written — the points are what make RDG legal.
    expect(mockApi.adjustResult).not.toHaveBeenCalled();
    // The panel it leads to is open down in the provisional table.
    expect(container.querySelector('[data-testid="decision-points-1"]')).not.toBeNull();
  });

  it("holds an RDG picked from the typed-entry table too", async () => {
    renderConsole(HANDICAP_META);
    await flush();
    chooseMode("clock");
    const row = rowOf(container.querySelector('[data-testid="time-entry-clock"]'), 0);
    clickIn(row, '[data-testid="time-code-1"]');
    clickIn(row, '[data-testid="select-item-RDG"]');
    await flush();

    expect(row.querySelector('[data-testid="time-code-1"]').textContent).toContain("RDG");
    expect(row.querySelector('[data-testid="time-pending-1"]')).not.toBeNull();
    expect(mockApi.adjustResult).not.toHaveBeenCalled();
  });

  // Every result is created with `penalty_points: 0`. Prefilling that into a
  // FRESH decision would let a bare save score the boat 0 points, which the
  // engine treats as a committee-decided score.
  it("never pre-fills a fresh RDG with the stored 0 points", async () => {
    mockApi.getRace.mockResolvedValue({ ...race, results: [
      { boat_id: "b1", code: "FINISHED", position: 1, finish_time: null },
      { boat_id: "b2", code: "OCS", position: null, finish_time: null, penalty_points: 0 },
    ] });
    renderConsole();
    await flush();
    const row = rowOf(container.querySelector('[data-testid="adjust-table"]'), 1);
    clickIn(row, '[data-testid="code-select-2"]');
    clickIn(row, '[data-testid="select-item-RDG"]');
    await flush();

    expect(container.querySelector('[data-testid="decision-points-2"]').value).toBe("");
  });

  it("keeps points already typed when the same code is picked again", async () => {
    const row = await pick("RDG");
    type(scoreOf(2), "4");

    clickIn(row, '[data-testid="select-item-RDG"]'); // re-pick, e.g. to reopen
    await flush();

    expect(container.querySelector('[data-testid="decision-points-2"]').value).toBe("4");
  });
});

// Deleting a race is the one irreversible action on the console, so it asks
// first — and the officer stays on the page until the delete actually lands.
describe("RaceConsole delete confirmation", () => {
  it("asks before deleting, then deletes and steps back", async () => {
    setUndoWindowMs(0);
    mockApi.deleteRace.mockResolvedValue({ ok: true });
    const onBack = jest.fn();
    renderConsole(DEFAULT_META, { onBack });
    await flush();

    const delBtn = container.querySelector('[data-testid="delete-race-btn"]');
    expect(delBtn).not.toBeNull();
    act(() => delBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();

    // Nothing happens until the officer confirms.
    expect(mockApi.deleteRace).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="confirm-delete-dialog"]')).not.toBeNull();

    act(() => document.querySelector('[data-testid="confirm-delete-confirm"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(mockApi.deleteRace).toHaveBeenCalledWith("r1", 3);
    expect(onBack).toHaveBeenCalled();
  });

  it("keeps the race when the confirmation is cancelled", async () => {
    mockApi.deleteRace.mockResolvedValue({ ok: true });
    const onBack = jest.fn();
    renderConsole(DEFAULT_META, { onBack });
    await flush();

    act(() => container.querySelector('[data-testid="delete-race-btn"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();
    act(() => document.querySelector('[data-testid="confirm-delete-cancel"]')
      .dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

    expect(mockApi.deleteRace).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });
});
