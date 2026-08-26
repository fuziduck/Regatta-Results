// Verifies the boat-name wrapping wiring: names over 14 characters get the
// wrapping + capped-width classes on the boat cell, shorter names keep the
// single-line behaviour — in the real SeriesStandingsTable (which also serves
// mini-series and combined-mini-series views).
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { SeriesStandingsTable } from "./StandingsTable";

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

  it("renders the combined column header as a drill-down link when onOpenMini is given", () => {
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
    expect(link.textContent).toContain("Day");
    act(() => link.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(cb).toHaveBeenCalledWith(1);
  });

  it("renders a plain header without onOpenMini (no link)", () => {
    renderTable(combinedData());
    expect(container.querySelector("[data-testid^='open-mini-']")).toBeNull();
    expect(container.querySelector("thead").textContent).toContain("combined · 2 races");
  });
});
