globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";

const mockRoute = { classId: "class-sonata", classKey: undefined };

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useParams: () => mockRoute,
  useLocation: () => ({ hash: "" }),
}));
jest.mock("@/lib/api", () => ({ api: {
  getClassDirectory: jest.fn(),
  getClassGroupDirectory: jest.fn(),
} }));
jest.mock("@/components/Logo", () => () => <span />);
jest.mock("@/components/ThemeToggle", () => () => <span />);
jest.mock("@/components/OfficialsLink", () => () => <span />);
jest.mock("@/components/RaceReports", () => ({ ClassRaceReports: () => null }));
jest.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }));
jest.mock("@/components/ui/badge", () => ({ Badge: ({ children, ...props }) => <span {...props}>{children}</span> }));
jest.mock("@/lib/analytics", () => ({
  SAILSCORE_EVENTS: { VIEW_CLASS: "view-class" },
  useTrackView: jest.fn(),
}));

import Class from "./Class";
import { CURRENT_YEAR } from "@/lib/helpers";
const mockApi = require("@/lib/api").api;

const directory = (extra = []) => ({
  class: { id: "class-sonata", name: "Sonata" },
  club: { id: "c1", name: "Harbour Sailing Club", slug: "harbour-club" },
  series: [
    { id: "spring", name: "Spring", class_id: "class-sonata", class_name: "Sonata", club_id: "c1", club_name: "Harbour Sailing Club", year: CURRENT_YEAR, race_count: 4 },
    ...extra,
  ],
});

let container;
let root;

const render = async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Class />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  mockRoute.classId = "class-sonata";
  mockRoute.classKey = undefined;
  mockApi.getClassDirectory.mockResolvedValue(directory());
  mockApi.getClassGroupDirectory.mockResolvedValue(directory());
});

afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

test("picks up a series set up after the class page opened when the tab is re-focused", async () => {
  await render();
  expect(container.querySelector('[data-testid="class-series-spring"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="class-series-autumn"]')).toBeNull();

  // The officer sets today's series up while the page is open: a visitor who
  // found their class earlier must see it on return, not keep the old list.
  mockApi.getClassDirectory.mockResolvedValue(directory([
    { id: "autumn", name: "Autumn", class_id: "class-sonata", class_name: "Sonata", club_id: "c1", club_name: "Harbour Sailing Club", year: CURRENT_YEAR, race_count: 0 },
  ]));
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.querySelector('[data-testid="class-series-autumn"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="class-series-spring"]')).not.toBeNull();
});
