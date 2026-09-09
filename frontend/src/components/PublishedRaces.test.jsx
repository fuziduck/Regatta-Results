import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}));
jest.mock("@/lib/api", () => ({
  api: {
    getRaces: jest.fn(),
    getBoats: jest.fn(),
    getClasses: jest.fn(),
  },
}));

import PublishedRaces from "./PublishedRaces";
const mockApi = require("@/lib/api").api;

let container;
let root;

const renderSchedule = async (races = []) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <PublishedRaces
        seriesId="series-1"
        series={{ planned_races: 5, schedule: ["2026-04-04", "2026-04-11", "2026-04-18", "2026-04-25", "2026-05-02"] }}
        classId="class-1"
        clubId="club-1"
        clubSlug="medway-yacht-club"
      />,
    );
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => {
  mockApi.getRaces.mockResolvedValue([]);
  mockApi.getBoats.mockResolvedValue([]);
  mockApi.getClasses.mockResolvedValue([{ id: "class-1", default_start_time: "10:30" }]);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  jest.clearAllMocks();
});

test("shows every scheduled slot in race-number order and links only completed results", async () => {
  mockApi.getRaces.mockResolvedValue([
    { id: "r3", race_number: 3, date: "2026-04-18", start_time: "11:00", status: "published", results: [] },
    { id: "r1", race_number: 1, date: "2026-04-04", status: "published", results: [] },
    { id: "r4", race_number: 4, date: "2026-04-25", status: "setup", postponed: true, results: [] },
    { id: "r5", race_number: 5, date: "2026-05-02", status: "setup", cancelled: true, results: [] },
  ]);

  await renderSchedule();

  const rows = [...container.querySelectorAll('[data-testid^="schedule-row-"]')];
  expect(rows).toHaveLength(5);
  expect(rows.map((row) => row.querySelector("td")?.textContent)).toEqual(["R1", "R2", "R3", "R4", "R5"]);
  expect(rows.map((row) => row.textContent)).toEqual(expect.arrayContaining([
    expect.stringContaining("Completed"),
    expect.stringContaining("Planned"),
    expect.stringContaining("Postponed"),
    expect.stringContaining("Cancelled"),
  ]));
  expect(rows[0].querySelector('a[href="/club/medway-yacht-club/race/r1"]')).not.toBeNull();
  expect(rows[2].querySelector('a[href="/club/medway-yacht-club/race/r3"]')).not.toBeNull();
  expect(rows[1].querySelector("a")).toBeNull();
  expect(rows[3].querySelector("a")).toBeNull();
  expect(rows[4].querySelector("a")).toBeNull();
});

test("uses the class default start time for planned races and preserves a race's start time", async () => {
  mockApi.getClasses.mockResolvedValue([{ id: "class-1", default_start_time: "09:45" }]);
  mockApi.getRaces.mockResolvedValue([
    { id: "r1", race_number: 1, date: "2026-04-04", start_time: "10:15", status: "published", results: [] },
  ]);

  await renderSchedule();

  const rows = [...container.querySelectorAll('[data-testid^="schedule-row-"]')];
  expect(rows[0].textContent).toContain("10:15");
  expect(rows[1].textContent).toContain("09:45");
});
