globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";

const mockRoute = { slug: "harbour-club", seriesId: undefined };
let mockQuery = "";
jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useParams: () => mockRoute,
  useSearchParams: () => [new URLSearchParams(mockQuery)],
}));
jest.mock("@/lib/api", () => ({ api: {
  getClubs: jest.fn(), getClasses: jest.fn(), getSeries: jest.fn(), getRegattas: jest.fn(), getRaces: jest.fn(),
} }));
jest.mock("@/components/HeaderMenu", () => () => <span />);
jest.mock("@/components/Logo", () => () => <span />);
jest.mock("@/pages/Landing", () => () => <div data-testid="legacy-results-page" />);

import ClubHome, { buildClubResultsRows } from "./ClubHome";
import { CURRENT_YEAR } from "@/lib/helpers";
const mockApi = require("@/lib/api").api;

const club = { id: "c1", name: "Harbour Sailing Club", slug: "harbour-club", color: "#123456" };
const classes = [
  { id: "class-sonata", name: "Sonata" },
  { id: "class-cruiser", name: "Cruiser Class 1" },
];
const series = [
  { id: "club-2025", class_id: "class-sonata", name: "Summer Series", year: 2025, series_type: "club_championship" },
  { id: "club-cruiser-2025", class_id: "class-cruiser", name: "Autumn Series", year: 2025, series_type: "club_championship" },
  { id: "class-2024", class_id: "class-cruiser", name: "Autumn Series", year: 2024, series_type: "championship" },
  { id: "linked-event", class_id: "class-sonata", name: "Harbour Regatta · Sonata", year: 2026, regatta_id: "event-2026" },
];
const competitions = [
  { id: "event-2026", name: "Harbour Regatta", year: 2026, competition_type: "regatta", classes: ["Sonata"], series: [{ id: "linked-event", class_id: "class-sonata", class_name: "Sonata" }] },
  { id: "event-2024", name: "Winter Trophy", year: 2024, competition_type: "championship", championship_scope: "class", series: [{ id: "class-2024", class_id: "class-cruiser", class_name: "Cruiser Class 1" }] },
];
const races = [
  { id: "r-2026", series_id: "linked-event", date: "2026-08-10", race_number: 3, status: "published" },
  { id: "r-club-cruiser", series_id: "club-cruiser-2025", date: "2025-10-03", race_number: 2, status: "published" },
  { id: "r-2025-latest", series_id: "club-2025", date: "2025-10-04", race_number: 6, status: "published" },
  { id: "r-2025", series_id: "club-2025", date: "2025-09-20", race_number: 5, status: "published" },
  { id: "r-2024", series_id: "class-2024", date: "2024-05-12", race_number: 2, status: "published" },
];

let container;
let root;

const render = async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<ClubHome />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  mockRoute.slug = "harbour-club";
  mockRoute.seriesId = undefined;
  mockQuery = "";
  mockApi.getClubs.mockResolvedValue([club]);
  mockApi.getClasses.mockResolvedValue(classes);
  mockApi.getSeries.mockResolvedValue(series);
  mockApi.getRegattas.mockResolvedValue(competitions);
  mockApi.getRaces.mockResolvedValue(races);
});

afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

test("builds a recent-first index grouped by championship type with class-level links", () => {
  const rows = buildClubResultsRows({ classes, series, competitions, races, slug: "harbour-club" });
  expect(rows.map((row) => row.latestRace?.date)).toEqual(["2026-08-10", "2025-10-04", "2025-10-03", "2024-05-12"]);
  expect(rows.map((row) => row.typeLabel)).toEqual(["Regatta", "Club Championship", "Club Championship", "Class Championship"]);
  expect(rows.map((row) => row.title)).toEqual(["Harbour Regatta · Sonata", "Summer Series", "Autumn Series", "Autumn Series"]);
  expect(rows[0]).toMatchObject({ className: "Sonata", href: "/club/harbour-club/series/linked-event" });
  expect(rows.find((row) => row.key === "series:club-2025").href).toBe("/club/harbour-club/series/club-2025");
  expect(rows[3].className).toBe("Cruiser Class 1");
});

test("renders grouped tables newest first and lets visitors open result pages", async () => {
  await render();
  expect(mockApi.getRaces).toHaveBeenCalledWith({ club_id: "c1", status: "published" });
  const initialYear = container.querySelector('[data-testid="club-results-year"]');
  expect(initialYear.value).toBe(String(CURRENT_YEAR));
  expect([...initialYear.options].map((option) => option.textContent)).toEqual(["All years", ...[...new Set([CURRENT_YEAR, ...series.map((item) => item.year)])].sort((a, b) => b - a).map(String)]);
  expect(container.querySelectorAll('[data-testid="club-result-card"]')).toHaveLength(series.filter((item) => item.year === CURRENT_YEAR).length);
  expect([...container.querySelectorAll('[data-testid="club-results-tables"] > section[id^="results-"]')]
    .map((section) => section.querySelector("h2").textContent.replace(/\\d+ results pages?/, "").trim())).toEqual(["Regatta"]);
  act(() => {
    initialYear.value = "all";
    initialYear.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const sections = [...container.querySelectorAll('[data-testid="club-results-tables"] > section[id^="results-"]')];
  expect(sections.map((section) => section.querySelector("h2").textContent.replace(/\\d+ results pages?/, "").trim())).toEqual([
    "Regatta", "Club Championship", "Class Championship",
  ]);
  const clubChampionship = sections[1];
  const classGroups = [...clubChampionship.querySelectorAll('[data-testid="club-result-class-group"]')];
  expect(classGroups.map((group) => group.querySelector("h3").textContent)).toEqual(["Sonata", "Cruiser Class 1"]);
  expect(classGroups[0].querySelectorAll('[data-testid="club-result-row"]')).toHaveLength(1);
  expect(classGroups[0].querySelectorAll('[data-testid="club-result-card"]')).toHaveLength(1);
  expect(classGroups[1].querySelectorAll('[data-testid="club-result-row"]')).toHaveLength(1);
  expect(classGroups[1].querySelectorAll('[data-testid="club-result-card"]')).toHaveLength(1);
  const rows = [...container.querySelectorAll('[data-testid="club-result-row"]')];
  expect(container.querySelector('[data-testid="club-results-tables"]').textContent).not.toMatch(/Latest activity|No published races/);
  expect(rows.map((row) => row.getAttribute("data-result-date"))).toEqual(["2026-08-10", "2025-10-04", "2025-10-03", "2024-05-12"]);
  expect(container.querySelector('[data-testid="club-results-year"]').value).toBe("all");
  expect(container.querySelector('[data-testid="club-result-card"] .font-heading').textContent).toBe("Harbour Regatta · Sonata");
  expect(container.querySelector('[data-testid="club-result-card"]').textContent).not.toMatch(/Latest activity|No published races/);
  expect(container.querySelector('[data-testid="club-result-card"]').className).toContain("min-h-16");
  expect(container.querySelector('a[href="/club/harbour-club/series/club-2025"]')).not.toBeNull();
  expect(container.querySelector('a[href="/club/harbour-club/series/club-cruiser-2025"]')).not.toBeNull();
  expect(container.querySelector('a[href="/club/harbour-club/series/class-2024"]')).not.toBeNull();
  expect(container.querySelector('a[href="/club/harbour-club/series/linked-event"]')).not.toBeNull();
  expect(container.querySelectorAll('[data-testid="club-result-card"]')).toHaveLength(series.length);

  const sort = container.querySelector('[data-testid="club-results-sort"]');
  act(() => {
    sort.value = "alphabetical";
    sort.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const alphabeticalSections = [...container.querySelectorAll('[data-testid="club-results-tables"] > section[id^="results-"]')];
  expect(alphabeticalSections.map((section) => section.querySelector("h2").textContent.replace(/\\d+ results pages?/, "").trim())).toEqual([
    "Class Championship", "Club Championship", "Regatta",
  ]);
  const alphabeticalClubGroups = [...alphabeticalSections[1].querySelectorAll('[data-testid="club-result-class-group"] h3')];
  expect(alphabeticalClubGroups.map((heading) => heading.textContent)).toEqual(["Cruiser Class 1", "Sonata"]);
  expect(alphabeticalSections[1].querySelector('[data-testid="club-result-card"] .font-heading').textContent).toBe("Autumn Series");

  const year = container.querySelector('[data-testid="club-results-year"]');
  act(() => {
    year.value = "2025";
    year.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const filteredSections = [...container.querySelectorAll('[data-testid="club-results-tables"] > section[id^="results-"]')];
  expect(filteredSections.map((section) => section.querySelector("h2").textContent.replace(/\\d+ results pages?/, "").trim())).toEqual(["Club Championship"]);
  expect(container.querySelector('[data-testid="club-results-sort"]').value).toBe("alphabetical");
  expect(container.querySelectorAll('[data-testid="club-result-card"]')).toHaveLength(2);
  expect([...container.querySelectorAll('[data-testid="club-result-card"] .font-heading')].map((title) => title.textContent)).toEqual([
    "Autumn Series", "Summer Series",
  ]);
});

test("keeps existing query and path-based results deep links on the standings page", async () => {
  mockQuery = "series=club-2025";
  await render();
  expect(container.querySelector('[data-testid="legacy-results-page"]')).not.toBeNull();
  expect(mockApi.getClubs).not.toHaveBeenCalled();

  act(() => root.unmount());
  container.remove();
  container = null;
  root = null;
  mockQuery = "";
  mockRoute.seriesId = "club-2025";
  await render();
  expect(container.querySelector('[data-testid="legacy-results-page"]')).not.toBeNull();
});
