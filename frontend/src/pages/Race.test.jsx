import { act } from "react";
import { createRoot } from "react-dom/client";

const mockRace = {
  id: "r1", date: "2026-06-07", year: 2026, race_number: 6, class_id: "c1", series_id: "s1",
  club_id: "club1", start_time: "10:30", status: "published", entries_count: 2,
  results: [
    { boat_id: "b2", code: "FINISHED", position: 2, finish_time: "2026-06-07T10:32:00Z" },
    { boat_id: "b1", code: "FINISHED", position: 1, finish_time: "2026-06-07T10:31:00Z" },
    { boat_id: "b3", code: "DNC", position: null, finish_time: null },
  ],
};

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useParams: () => ({ slug: "medway-yacht-club", raceId: "r1" }),
}));
jest.mock("@/lib/api", () => ({
  api: {
    getRace: jest.fn(), getRaces: jest.fn(), getBoats: jest.fn(), getClasses: jest.fn(), getSeries: jest.fn(),
    getRegattas: jest.fn(), seriesStandings: jest.fn(),
  },
}));

import Race from "./Race";
const mockApi = require("@/lib/api").api;

let container;
let root;

beforeEach(() => {
  mockApi.getRace.mockResolvedValue(mockRace);
  mockApi.getRaces.mockResolvedValue([
    { id: "r5", race_number: 5, status: "published" },
    { id: "r1", race_number: 6, status: "published" },
    { id: "r7", race_number: 7, status: "published" },
  ]);
  mockApi.getBoats.mockResolvedValue([
    { id: "b1", fleet_id: "f1", name: "First Boat", sail_no: "GBR 1", helm: "A Helm", crew: "One Crew", boat_type: "Sonata" },
    { id: "b2", fleet_id: "f2", name: "Second Boat", sail_no: "GBR 2", helm: "B Helm", crew_names: ["Two Crew"], boat_type: "Sonata" },
    { id: "b3", fleet_id: "f3", name: "Third Boat", sail_no: "GBR 3", helm: "C Helm", boat_type: "Sonata" },
  ]);
  mockApi.getClasses.mockResolvedValue([{ id: "c1", name: "Sonata", scoring_mode: "one_design" }]);
  mockApi.getSeries.mockResolvedValue([{ id: "s1", name: "Summer Series", class_id: "c1", scoring_mode: "one_design", regatta_id: "reg1" }]);
  mockApi.getRegattas.mockResolvedValue([{ id: "reg1", name: "Summer Regatta", year: 2026 }]);
  mockApi.seriesStandings.mockResolvedValue({
    races: [{ race_number: 6, date: "2026-06-07" }],
    standings: [
      { boat_id: "b1", scores: [{ points: 1, code: "FINISHED" }] },
      { boat_id: "b2", scores: [{ points: 2, code: "FINISHED" }] },
      { boat_id: "b3", scores: [{ points: 3, code: "DNC" }] },
    ],
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  jest.clearAllMocks();
});

test("renders complete race metadata, sorted results, and parent links", async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Race />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  expect(container.querySelector('[data-testid="race-header"]').textContent).toContain("Summer Regatta");
  expect(container.querySelector('[data-testid="race-header"]').textContent).toContain("Summer Series");
  expect(container.querySelector('[data-testid="race-header"]').textContent).toContain("10:30");
  expect(container.querySelector('[data-testid="race-header"]').textContent).toContain("2");
  expect(container.querySelector('[data-testid="race-header"]').textContent).toContain("Boats entered");
  expect(container.querySelector('[data-testid="race-header"]').textContent).toContain("Class");
  expect(container.querySelector('[data-testid="race-header"]').textContent).toContain("Date");
  expect(container.querySelector('[aria-label="Navigate between races"] a[aria-label="Previous race 5"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Navigate between races"] a[aria-label="Next race 7"]')).not.toBeNull();
  expect(container.querySelector('a[href*="series=s1"]')).not.toBeNull();
  expect(container.querySelector('a[href="/club/medway-yacht-club/regatta/reg1/summer-regatta-2026"]')).not.toBeNull();

  const rows = [...container.querySelectorAll('[data-testid="race-results-table"] tbody tr')];
  expect(rows).toHaveLength(3);
  expect(rows[0].textContent).toContain("GBR 1");
  expect(rows[1].textContent).toContain("GBR 2");
  expect(rows[2].textContent).toContain("DNC");
  // One-design: elapsed and corrected columns should be hidden
  const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
  expect(headers).not.toContain("Elapsed");
  expect(headers).not.toContain("Corrected");
  expect(headers).toContain("Points");
  expect(headers).toContain("Sail Number");
  expect(headers).toContain("Boat Name");
  expect(rows[0].querySelector('a[href="/boat/f1/first-boat"]')).not.toBeNull();
  expect(rows[0].querySelector('a[href="/boat/f1/first-boat"]').className).not.toContain("text-ocean");
  expect(rows[0].className).toContain("bg-amber-100");
  expect(rows[1].className).toContain("bg-slate-100");
});

test("switches race positions, points and corrected-time basis between series scoring systems", async () => {
  mockApi.getSeries.mockResolvedValue([{ id: "s1", name: "Cruiser Autumn", class_id: "c1", scoring_mode: "irc", scoring_modes: ["irc", "ytc"] }]);
  mockApi.getClasses.mockResolvedValue([{ id: "c1", name: "Cruisers", scoring_mode: "irc" }]);
  mockApi.getBoats.mockResolvedValue([
    { id: "b1", name: "Fast hull", sail_no: "1", helm: "A", tcc: 1.05, ytc: 1100 },
    { id: "b2", name: "Slow hull", sail_no: "2", helm: "B", tcc: 0.95, ytc: 900 },
  ]);
  mockApi.getRace.mockResolvedValue({ ...mockRace, entries_count: 2, results: [
    { boat_id: "b1", code: "FINISHED", position: 2, finish_time: "2026-06-07T11:31:40Z" },
    { boat_id: "b2", code: "FINISHED", position: 1, finish_time: "2026-06-07T11:33:20Z" },
  ] });
  mockApi.seriesStandings.mockResolvedValue({
    races: [{ race_number: 6, date: "2026-06-07" }],
    divisions: [
      { division_name: "IRC", division_scoring_mode: "irc", standings: [
        { boat_id: "b2", positions: [1], scores: [{ points: 1, code: "FINISHED" }] },
        { boat_id: "b1", positions: [2], scores: [{ points: 2, code: "FINISHED" }] },
      ] },
      { division_name: "YTC", division_scoring_mode: "ytc", standings: [
        { boat_id: "b1", positions: [1], scores: [{ points: 1, code: "FINISHED" }] },
        { boat_id: "b2", positions: [2], scores: [{ points: 2, code: "FINISHED" }] },
      ] },
    ],
  });

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Race />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  expect(container.querySelector('[data-testid="race-scoring-irc"]')).not.toBeNull();
  let rows = [...container.querySelectorAll('[data-testid="race-results-table"] tbody tr')];
  expect(rows[0].querySelector("td").textContent).toBe("1");
  expect(rows[0].textContent).toContain("Slow hull");
  await act(async () => { container.querySelector('[data-testid="race-scoring-ytc"]').click(); });
  rows = [...container.querySelectorAll('[data-testid="race-results-table"] tbody tr')];
  expect(rows[0].querySelector("td").textContent).toBe("1");
  expect(rows[0].textContent).toContain("Fast hull");
  expect(container.querySelector('[data-testid="race-header"]').textContent).toContain("IRC + YTC");
});

test("shows elapsed and corrected times for handicap scoring", async () => {
  mockApi.getSeries.mockResolvedValue([{ id: "s1", name: "IRC Series", class_id: "c1", scoring_mode: "irc" }]);
  mockApi.getClasses.mockResolvedValue([{ id: "c1", name: "IRC", scoring_mode: "irc" }]);
  mockApi.getBoats.mockResolvedValue([
    { id: "b1", name: "Handicap Boat", sail_no: "1", helm: "Helm", tcc: 0.8, boat_type: "IRC" },
    { id: "b2", name: "Second", sail_no: "2", helm: "Helm", tcc: 0.9, boat_type: "IRC" },
  ]);
  mockApi.getRace.mockResolvedValue({ ...mockRace, entries_count: 2, results: mockRace.results.slice(0, 2) });

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Race />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  const headers = [...container.querySelectorAll('[data-testid="race-results-table"] thead th')].map((th) => th.textContent);
  expect(headers).toEqual(expect.arrayContaining(["Elapsed", "Corrected", "Points"]));
  expect(container.querySelector('[data-testid="race-results-table"]').textContent).toContain("01:00");
});
