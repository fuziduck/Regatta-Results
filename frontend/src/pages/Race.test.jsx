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
    getRace: jest.fn(), getBoats: jest.fn(), getClasses: jest.fn(), getSeries: jest.fn(),
    getRegattas: jest.fn(), seriesStandings: jest.fn(),
  },
}));

import Race from "./Race";
const mockApi = require("@/lib/api").api;

let container;
let root;

beforeEach(() => {
  mockApi.getRace.mockResolvedValue(mockRace);
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
  expect(container.querySelector('a[href*="series=s1"]')).not.toBeNull();
  expect(container.querySelector('a[href="/club/medway-yacht-club/regatta/reg1"]')).not.toBeNull();

  const rows = [...container.querySelectorAll('[data-testid="race-results-table"] tbody tr')];
  expect(rows).toHaveLength(3);
  expect(rows[0].textContent).toContain("GBR 1");
  expect(rows[1].textContent).toContain("GBR 2");
  expect(rows[2].textContent).toContain("DNC");
  expect(rows[0].textContent).toContain("Not applicable");
  expect(rows[0].className).toContain("bg-amber-100");
  expect(rows[1].className).toContain("bg-slate-100");
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

  const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
  expect(headers).toEqual(expect.arrayContaining(["Elapsed", "Corrected", "Points"]));
  expect(container.querySelector('[data-testid="race-results-table"]').textContent).toContain("01:00");
});
