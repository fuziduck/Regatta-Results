globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";


jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
  useParams: () => ({ slug: "harbour-club", seriesId: undefined }),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));
jest.mock("@/lib/api", () => ({ api: {
  getClubs: jest.fn(),
  getClasses: jest.fn(),
  getNotifications: jest.fn(),
  getSeasons: jest.fn(),
  getSeries: jest.fn(),
  overallStandings: jest.fn(),
  getRegattas: jest.fn(),
  getClassRaceReports: jest.fn(),
  seriesStandings: jest.fn(),
} }));
jest.mock("react-fast-marquee", () => ({ children }) => <div>{children}</div>);
jest.mock("@/components/YearSwitcher", () => () => <div />);
jest.mock("@/components/StandingsTable", () => ({
  SeriesStandings: ({ data }) => <div data-testid="series-standings">{data?.series_name || "No series data"}</div>,
  OverallStandings: () => <div data-testid="overall-standings">Overall standings</div>,
}));
jest.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }));
jest.mock("@/components/ui/badge", () => ({ Badge: ({ children, ...props }) => <span {...props}>{children}</span> }));
jest.mock("@/components/AdvertCard", () => ({
  __esModule: true,
  default: () => null,
  useAdverts: () => ({ adverts: [], roll: 0 }),
  pickAdverts: () => [],
}));
jest.mock("@/components/HeaderMenu", () => () => <span />);
jest.mock("@/components/OfficialsLink", () => () => null);
jest.mock("@/components/CopyLinkButton", () => () => null);
jest.mock("@/components/Logo", () => () => <span />);
jest.mock("@/components/BoatSearchBox", () => () => null);
jest.mock("@/components/ResultsSubscription", () => () => null);
jest.mock("@/components/PublishedRaces", () => () => null);
// Rendered rather than stubbed out, so the page hierarchy can be asserted:
// every crumb that has a destination must stay a working link.
jest.mock("@/components/Breadcrumbs", () => ({ items = [] }) => (
  <nav data-testid="breadcrumbs">
    {items.map((item, index) => (item.href
      ? <a key={index} href={item.href} data-testid={`crumb-${item.label}`}>{item.label}</a>
      : <span key={index} data-testid={`crumb-${item.label}`}>{item.label}</span>))}
  </nav>
));
jest.mock("@/lib/exportPdf", () => ({ exportSeriesPdf: jest.fn(), exportOverallPdf: jest.fn() }));
jest.mock("@/lib/analytics", () => ({
  SAILSCORE_EVENTS: { VIEW_CLASS: "view-class", VIEW_SERIES: "view-series", VIEW_RESULTS: "view-results", VIEW_REGATTA: "view-regatta", DOWNLOAD_RESULTS_PDF: "download-results-pdf", DOWNLOAD_SERIES_PDF: "download-series-pdf" },
  trackEvent: jest.fn(),
  useTrackView: jest.fn(),
}));

import Landing from "./Landing";
import { CURRENT_YEAR } from "@/lib/helpers";
const mockApi = require("@/lib/api").api;

const club = { id: "club-1", name: "Harbour Club", slug: "harbour-club" };
const classes = [
  { id: "dragon", name: "Dragon" },
  { id: "sonata", name: "Sonata" },
];
const dragonSeries = [
  { id: "dragon-spring", class_id: "dragon", year: CURRENT_YEAR, name: "Spring", series_type: "club_championship" },
  { id: "dragon-autumn", class_id: "dragon", year: CURRENT_YEAR, name: "Autumn", series_type: "club_championship" },
];
const sonataSeries = [
  { id: "sonata-spring", class_id: "sonata", year: CURRENT_YEAR, name: "Early Spring", series_type: "club_championship" },
  { id: "sonata-autumn", class_id: "sonata", year: CURRENT_YEAR, name: "Early Autumn", series_type: "club_championship" },
];
const allSeries = [...dragonSeries, ...sonataSeries];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

let root;
let container;

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function renderPage() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Landing />);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  await flush();
}

function click(testId) {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`Could not find ${testId}`);
  act(() => element.click());
}

beforeEach(() => {
  mockApi.getClubs.mockResolvedValue([club]);
  mockApi.getClasses.mockResolvedValue(classes);
  mockApi.getNotifications.mockResolvedValue([]);
  mockApi.getSeasons.mockResolvedValue({ years: [CURRENT_YEAR] });
  mockApi.getSeries.mockImplementation((params) => {
    if (params.class_id === "dragon") return Promise.resolve(dragonSeries);
    if (params.class_id === "sonata") return Promise.resolve(sonataSeries);
    return Promise.resolve(allSeries);
  });
  mockApi.overallStandings.mockResolvedValue({ standings: [{ boat_id: "boat-1" }] });
  mockApi.getRegattas.mockResolvedValue([]);
  mockApi.getClassRaceReports.mockResolvedValue([]);
  mockApi.seriesStandings.mockImplementation((seriesId) => Promise.resolve({ series_name: allSeries.find((item) => item.id === seriesId)?.name, standings: [] }));
});

afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

test("the club crumb and header button lead back to the club's results index", async () => {
  await renderPage();

  // A series opened from the club home is otherwise a one-way trip: the club
  // step of the breadcrumb must stay clickable.
  expect(container.querySelector('[data-testid="crumb-Harbour Club"]').getAttribute("href"))
    .toBe("/club/harbour-club");
  expect(container.querySelector('[data-testid="club-home-btn"]').closest("a").getAttribute("href"))
    .toBe("/club/harbour-club");
});

test("selecting a different class and then its series keeps the requested series", async () => {
  await renderPage();
  click("browse-tree-toggle");
  click("class-tab-Sonata");
  await flush();
  click("series-tab-Early Autumn");
  await flush();

  expect(container.querySelector("main h3")?.textContent).toBe("Early Autumn Series");
  click("browse-tree-toggle");
  expect(container.querySelector('[data-testid="series-tab-Early Autumn"]')?.getAttribute("aria-current")).toBe("true");
});

test("selecting a series during the current class request is applied after the request completes", async () => {
  const currentClassRequest = deferred();
  mockApi.getSeries.mockImplementation((params) => {
    if (params.class_id === "dragon") return currentClassRequest.promise;
    if (params.class_id === "sonata") return Promise.resolve(sonataSeries);
    return Promise.resolve(allSeries);
  });

  await renderPage();
  click("browse-tree-toggle");
  click("series-tab-Autumn");
  await flush();

  await act(async () => {
    currentClassRequest.resolve(dragonSeries);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  expect(container.querySelector("main h3")?.textContent).toBe("Autumn Series");
});

test("a late series response from the previous class cannot reset a pending series choice", async () => {
  const oldClassRequest = deferred();
  const selectedClassRequest = deferred();
  mockApi.getSeries.mockImplementation((params) => {
    if (params.class_id === "dragon") return oldClassRequest.promise;
    if (params.class_id === "sonata") return selectedClassRequest.promise;
    return Promise.resolve(allSeries);
  });

  await renderPage();
  click("browse-tree-toggle");
  click("class-tab-Sonata");
  await flush();
  click("series-tab-Early Autumn");
  await flush();

  await act(async () => {
    selectedClassRequest.resolve(sonataSeries);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  expect(container.querySelector("main h3")?.textContent).toBe("Early Autumn Series");

  await act(async () => {
    oldClassRequest.resolve(dragonSeries);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
  expect(container.querySelector("main h3")?.textContent).toBe("Early Autumn Series");
});
