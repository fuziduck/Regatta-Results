// Verifies the boat-name wrapping wiring: names over 14 characters get the
// wrapping + capped-width classes on the boat cell, shorter names keep the
// single-line behaviour — in the real SeriesStandingsTable (which also serves
// mini-series and combined-mini-series views).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SeriesStandingsTable, SeriesStandings } from "./StandingsTable";

let container;
let root;

const data = () => ({
  race_count: 1,
  discards: 0,
  planned_races: 1,
  schedule: [],
  races: [{ race_number: 1, date: "2026-04-18" }],
  standings: [
    { rank: 1, boat_id: "b1", boat_name: "Bluebell", sail_no: "1", helm: "H", home_club: "C", net: 1, total: 1, scores: [{ points: 1, code: "FINISHED", discarded: false }] },
    { rank: 2, boat_id: "b2", boat_name: "The Flying Fish", sail_no: "2", helm: "H2", home_club: "C", net: 2, total: 2, scores: [{ points: 2, code: "FINISHED", discarded: false }] },
    { rank: 3, boat_id: "b3", boat_name: "ABCDEFGHIJKLMN", sail_no: "3", helm: "H3", home_club: "C", net: 3, total: 3, scores: [{ points: 3, code: "FINISHED", discarded: false }] },
  ],
});

const renderTable = (d = data()) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <SeriesStandingsTable data={d} />
      </MemoryRouter>
    );
  });
  return container;
};

afterEach(() => {
  if (root) act(() => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
});

const linkFor = (sail) => container.querySelector(`[data-testid="boat-link-${sail}"]`);

describe("boat-name wrapping in the standings table", () => {
  it("keeps short names (<=14 chars) on one unbroken line", () => {
    renderTable();
    const short = linkFor("1"); // "Bluebell" — 8 chars
    expect(short.className).toContain("whitespace-nowrap");
    expect(short.className).not.toContain("break-words");
    const exactly14 = linkFor("3"); // "ABCDEFGHIJKLMN"
    expect(exactly14.className).toContain("whitespace-nowrap");
    expect(exactly14.className).not.toContain("break-words");
  });

  it("wraps long names (>14 chars) onto a second line at a space", () => {
    renderTable();
    const long = linkFor("2"); // "The Flying Fish" — 15 chars
    expect(long.className).toContain("whitespace-pre-line");
    expect(long.className).toContain("break-words");
    expect(long.className).not.toContain("whitespace-nowrap");
    // The displayed text carries the break at the space ("The Flying\nFish").
    expect(long.textContent).toBe("The Flying\nFish");
    // The cell caps the column width so the name cannot widen the table.
    const cell = long.closest("td");
    expect(cell.className).toContain("max-w-52");
    const rowCells = [...container.querySelector('[data-testid="standing-row-2"]').querySelectorAll("td")];
    expect(rowCells.slice(-2).map((cell) => cell.textContent)).toEqual(["2", "2"]);
  });

  it("does not cap the width for short names (layout unchanged)", () => {
    renderTable();
    const cell = linkFor("1").closest("td");
    expect(cell.className).not.toContain("max-w-52");
  });

  it("renders boat names with only presentation changed (stored data untouched)", () => {
    renderTable();
    // Short names render verbatim; the long name only gains a line break.
    expect(linkFor("1").textContent).toBe("Bluebell");
    expect(linkFor("2").textContent).toBe("The Flying\nFish");
    expect(linkFor("3").textContent).toBe("ABCDEFGHIJKLMN");
    expect(linkFor("2").getAttribute("href")).toBe("/boat/b2"); // link intact
    expect(container.querySelector('[data-testid="boat-sail-link-2"]').textContent).toBe("2");
    expect(container.querySelector('[data-testid="boat-sail-link-2"]').getAttribute("href")).toBe("/boat/b2");
    const headers = [...container.querySelectorAll("thead th")];
    expect(headers.slice(0, 3).map((th) => th.textContent.trim())).toEqual(["#", "Boat", "Club"]);
    expect(headers.slice(-2).map((th) => th.textContent.trim())).toEqual(["Total", "Net"]);
    expect(container.querySelector('[data-testid="standing-row-2"] td:nth-child(2)').textContent).toContain("The Flying\nFish");
    expect(container.querySelector('[data-testid="standing-total-mobile-2"]')).toBeNull();
    expect(container.querySelector('[data-testid="standing-net-mobile-2"]')).toBeNull();
    expect(container.textContent).not.toContain("Swipe horizontally for race results");
  });
});

describe("series scoring legend", () => {
  it("explains the codes actually displayed once, including varying redress awards", () => {
    const d = data();
    d.race_count = 3;
    d.races = [1, 2, 3].map((race_number) => ({ race_number }));
    d.scoring_mode = "irc";
    d.scoring_config = { a5_convention: "a5_3", duty: { enabled: true, discards: "with" } };
    d.standings[0].scores = [{ code: "RDG", points: 1.5 }, { code: "DNC", points: 4, discarded: true }, { code: "OOD", points: 2 }];
    d.standings[1].scores = [{ code: "RDG", points: 2 }, { code: "DNF", points: 3 }, { code: "FINISHED", points: 1 }];
    renderTable(d);
    const legend = container.querySelector('[data-testid="series-scoring-legend"]');
    expect(legend.textContent).toContain("IRC places are based on corrected time");
    expect(legend.textContent).toContain("RRS A5.3");
    expect(legend.textContent).toContain("starting-area entries plus one");
    expect(legend.textContent).toContain("DNC: Did not start and did not come to the starting area");
    expect(legend.textContent).toContain("DNF: Did not finish");
    expect(legend.textContent).toContain("after applicable discards");
    expect(legend.textContent).toContain("RDG: Redress given");
    expect(legend.textContent).toContain("committee awards a score");
    expect(legend.querySelectorAll("dt")).toHaveLength(8);
    expect(legend.textContent).not.toContain("DSQ:");
    expect(container.querySelector('[data-testid="standing-row-1"]').textContent).toContain("1.5 RDG");
    expect(container.querySelector('[data-testid="standing-row-2"]').textContent).toContain("2 RDG");
  });

  it("describes the configured non-finish, time-limit and penalty rules", () => {
    const d = data();
    d.scoring_config = {
      a5_convention: "finishers",
      tle: { enabled: true, method: "last_finisher", increment: 2, time_limit_minutes: 60 },
      scp: { method: "percent", value: 20, cap_dnf: true },
      zfp: { method: "points", value: 3, cap_dnf: false },
      duty: { enabled: false },
    };
    d.races = [1, 2, 3, 4].map((race_number) => ({ race_number }));
    d.standings[0].scores = [{ code: "SCP", points: 2 }, { code: "ZFP", points: 4 }, { code: "TLE", points: 5 }, { code: "OOD", points: 5 }];
    renderTable(d);
    const legend = container.querySelector('[data-testid="series-scoring-legend"]');
    expect(legend.textContent).toContain("number of finishers plus one");
    expect(legend.textContent).toContain("2 more than the last finisher's points; time limit 60 minutes");
    expect(legend.textContent).toContain("20% of the non-finish score, rounded to whole points added to the finishing place, capped");
    expect(legend.textContent).toContain("3 points added to the finishing place");
    expect(legend.textContent).toContain("scored as a non-finish");
  });

  it("explains every supported result code without duplicating entries", () => {
    const codes = ["DNC", "DNS", "OCS", "UFD", "BFD", "ZFP", "SCP", "NSC", "DNF", "RET", "DSQ", "DNE", "DGM", "DPI", "RDG", "TLE", "OOD"];
    const d = data();
    d.races = codes.map((_, index) => ({ race_number: index + 1 }));
    d.standings[0].scores = codes.map((code) => ({ code, points: 1 }));
    renderTable(d);
    const legend = container.querySelector('[data-testid="series-scoring-legend"]');
    const labels = [...legend.querySelectorAll("dt")].map((dt) => dt.textContent.trim());
    codes.forEach((code) => expect(labels.filter((label) => label === `${code}:`)).toHaveLength(1));
    expect(legend.textContent).toContain("DNE: Disqualification that cannot be discarded");
    expect(legend.textContent).toContain("DGM: Disqualification for gross misconduct that cannot be discarded");
    expect(legend.textContent).toContain("DPI: Discretionary penalty imposed");
  });

  it("keeps historical payloads readable without inventing unavailable configuration", () => {
    const d = data();
    d.standings[0].scores = [{ code: "RDG", points: 1 }];
    renderTable(d);
    const legend = container.querySelector('[data-testid="series-scoring-legend"]');
    expect(legend.textContent).toContain("RDG: Redress given");
    expect(legend.textContent).not.toContain("Non-finish scoring:");
    expect(legend.textContent).not.toContain("undefined");
  });

  it("describes A5.2 and each configured time-limit scoring method", () => {
    const methods = {
      finishers_plus_1: "2 more than the number of finishers",
      last_finisher: "2 more than the last finisher's points",
      dnf: "the non-finish score",
      dnc: "series entries plus one",
    };
    const d = data();
    d.scoring_config = { a5_convention: "a5_2", tle: { enabled: true, method: "dnf", increment: 2 } };
    renderTable(d);
    for (const [method, text] of Object.entries(methods)) {
      d.scoring_config.tle.method = method;
      act(() => root.render(<MemoryRouter><SeriesStandingsTable data={d} /></MemoryRouter>));
      const legend = container.querySelector('[data-testid="series-scoring-legend"]');
      expect(legend.textContent).toContain("RRS A5.2");
      expect(legend.textContent).toContain(`TLE scores ${text}`);
    }
  });

  it("describes a combined day without inventing hidden race codes", () => {
    const d = data();
    d.races = [{ mini_name: "Day", mini_index: 1, combined: true }];
    d.standings[0].scores = [{ code: "MINI", points: 1 }];
    renderTable(d);
    const legend = container.querySelector('[data-testid="series-scoring-legend"]');
    expect(legend.textContent).toContain("Combined mini-series:");
    expect(legend.textContent).toContain("rank counts as one series score");
    expect(legend.textContent).not.toContain("MINI:");
  });
});

describe("combined mini-series drill-down link", () => {
  const combinedData = () => ({
    race_count: 1,
    discards: 0,
    planned_races: 3,
    schedule: [],
    mini_series: { enabled: true, groups: [{ name: "Day", race_numbers: [1, 2], discards: 0, scoring: "combined" }] },
    races: [{ race_number: null, date: "2026-05-02", mini_name: "Day", mini_races: 2, mini_index: 1, combined: true }],
    standings: [
      { rank: 1, boat_id: "b1", boat_name: "Bluebell", sail_no: "1", helm: "H", home_club: "C", net: 1, total: 1, scores: [{ points: 1, code: "MINI", discarded: false }] },
    ],
  });

  it("renders the combined column header as one mini-series link when onOpenMini is given", () => {
    const cb = jest.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <SeriesStandingsTable data={combinedData()} onOpenMini={cb} />
        </MemoryRouter>
      );
    });
    const link = container.querySelector('[data-testid="open-mini-1"]');
    expect(link).not.toBeNull();
    // The single link carries the mini-series icon plus the day's name.
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.textContent).toContain("Day");
    // No separate "view mini series results" affordance — the caption just
    // notes it was built from several races.
    expect(container.querySelector('[data-testid^="open-mini-link-"]')).toBeNull();
    expect(container.querySelector("thead").textContent).not.toContain("View mini series results");
    expect(container.querySelector("thead").textContent).toContain("combined · 2 races");
    act(() => link.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(cb).toHaveBeenCalledWith(1);
  });

  it("renders a plain header without onOpenMini (no link)", () => {
    renderTable(combinedData());
    expect(container.querySelector("[data-testid^='open-mini-']")).toBeNull();
    expect(container.querySelector("thead").textContent).toContain("combined · 2 races");
  });
});

describe("abandoned races", () => {
  const withAbandoned = () => ({
    race_count: 2,
    abandoned_race_count: 1,
    abandoned_races: [{ race_number: 2, date: "2026-05-09" }],
    discards: 0,
    planned_races: 4,
    schedule: [],
    // R1 and R3 are the only scored races; R2 was abandoned on the day.
    races: [{ race_number: 1, date: "2026-04-25" }, { race_number: 3, date: "2026-05-23" }],
    standings: [
      { rank: 1, boat_id: "b1", boat_name: "Bluebell", sail_no: "1", helm: "H", home_club: "C", net: 3, total: 3, scores: [{ points: 1, code: "FINISHED", discarded: false }, { points: 2, code: "FINISHED", discarded: false }] },
      { rank: 2, boat_id: "b2", boat_name: "Wren", sail_no: "2", helm: "H2", home_club: "C", net: 5, total: 5, scores: [{ points: 2, code: "FINISHED", discarded: false }, { points: 3, code: "FINISHED", discarded: false }] },
    ],
  });

  // The header cell carries the race label plus a sub-label (date, TBC or
  // Abandoned), so the race numbers are read from the label element alone.
  const headLabels = (root) => [...root.querySelectorAll("thead th")]
    .map((th) => (th.firstElementChild?.textContent || "").trim())
    .filter((text) => /^R\d/.test(text));

  it("shows a marked column for the abandoned race between the scored ones", () => {
    renderTable(withAbandoned());
    expect(headLabels(container)).toEqual(["R1", "R2", "R3", "R4"]);
    expect(container.querySelector('[data-testid="abandoned-race-head-2"]').textContent).toContain("Abandoned");
  });

  it("scores nothing in the abandoned column and leaves totals untouched", () => {
    renderTable(withAbandoned());
    const cells = [...container.querySelectorAll('[data-testid^="abandoned-race-cell-"]')];
    expect(cells).toHaveLength(2);
    expect(cells.every((cell) => cell.textContent === "–")).toBe(true);
    // The scored columns still line up with the series' own scores.
    const row = container.querySelector('[data-testid="standing-row-1"]');
    // #, Boat, Club come first, then one cell per column, then Total and Net.
    const rowCells = [...row.querySelectorAll("td")].map((td) => td.textContent);
    const columnCount = headLabels(container).length;
    expect(rowCells.slice(3, 3 + columnCount)).toEqual(["1", "–", "2", "–"]);
    expect(rowCells.slice(3 + columnCount)).toEqual(["3", "3"]);
  });

  it("keeps planned columns after an abandoned race instead of hiding them", () => {
    // R1-R3 all exist (R2 abandoned), so the remaining planned R4 is shown.
    renderTable(withAbandoned());
    expect(container.querySelector("thead").textContent).toContain("R4");
    expect(container.textContent).toContain("1 abandoned (not counted)");
  });

  it("does not invent a column for a race that is missing outright", () => {
    renderTable({ ...withAbandoned(), abandoned_races: [] });
    expect(headLabels(container)).toEqual(["R1", "R3"]);
  });
});

describe("SeriesStandings (rating divisions)", () => {
  const renderSplit = (d) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <SeriesStandings data={d} />
        </MemoryRouter>
      );
    });
    return container;
  };

  const split = () => ({
    ...data(),
    divisions: [
      { division_name: "IRC", division_scoring_mode: "irc", ...data() },
      { division_name: "YTC", division_scoring_mode: "ytc", ...data() },
    ],
  });

  it("renders one titled table per division", () => {
    renderSplit(split());
    expect(container.querySelectorAll("[data-testid='series-standings-table']").length).toBe(2);
    const headings = container.querySelectorAll("[data-testid^='division-']");
    expect([...headings].map((h) => h.textContent)).toEqual([
      "IRC IRC division",
      "YTC YTC division",
    ]);
  });

  it("labels series-wide scoring tables as results, not class divisions", () => {
    renderSplit({
      ...data(),
      divisions: [
        { division_name: "IRC", division_scoring_mode: "irc", table_kind: "scoring_mode", ...data() },
        { division_name: "YTC", division_scoring_mode: "ytc", table_kind: "scoring_mode", ...data() },
      ],
    });
    const headings = container.querySelectorAll("[data-testid^='division-']");
    expect([...headings].map((h) => h.textContent)).toEqual([
      "IRC results",
      "YTC results",
    ]);
  });

  it("gives each division its own legend and result codes", () => {
    const d = split();
    d.divisions[0].standings[0].scores = [{ code: "DNF", points: 4 }];
    d.divisions[1].standings[0].scores = [{ code: "RDG", points: 2 }];
    renderSplit(d);
    const legends = container.querySelectorAll('[data-testid="series-scoring-legend"]');
    expect(legends).toHaveLength(2);
    expect(legends[0].textContent).toContain("DNF: Did not finish");
    expect(legends[0].textContent).not.toContain("RDG:");
    expect(legends[1].textContent).toContain("RDG: Redress given");
    expect(legends[1].textContent).not.toContain("DNF:");
    expect(legends[1].textContent).toContain("YTC places are based on corrected time");
  });

  it("renders the single table with no division heading when the class is not split", () => {
    renderSplit(data());
    expect(container.querySelectorAll("[data-testid='series-standings-table']").length).toBe(1);
    expect(container.querySelector("[data-testid^='division-']")).toBeNull();
  });
});
