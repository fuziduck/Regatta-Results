import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useParams: () => ({ slug: "medway-yacht-club" }),
}));
jest.mock("@/lib/api", () => ({
  api: { getClubs: jest.fn(), scheduledRaces: jest.fn() },
}));
jest.mock("@/components/HeaderMenu", () => () => <button type="button" data-testid="header-menu-btn" />);
jest.mock("@/components/Logo", () => () => <span data-testid="logo" />);

import ClubCalendar from "./ClubCalendar";

const mockApi = require("@/lib/api").api;
let container;
let root;

beforeEach(() => {
  mockApi.getClubs.mockResolvedValue([{ id: "club-1", slug: "medway-yacht-club", name: "Medway Yacht Club" }]);
  mockApi.scheduledRaces.mockResolvedValue([
    { series_id: "s1", series_name: "Early Autumn", class_name: "Sonata", race_number: 5, date: "2026-09-26", status: "scheduled", race_id: null, start_time: "13:50" },
    { series_id: "s2", series_name: "Late Autumn", class_name: "Sonata", race_number: 1, date: "2026-10-03", status: "scheduled", race_id: null, start_time: "13:50" },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  jest.clearAllMocks();
});

test("requests the selected club's scheduled races and renders compact race days", async () => {
  act(() => root.render(<ClubCalendar />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  expect(mockApi.scheduledRaces).toHaveBeenCalledWith({ club_id: "club-1" });
  expect(container.querySelector('[data-testid="club-calendar"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="calendar-day-2026-09-26"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="calendar-day-2026-10-03"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="calendar-day-2026-09-26"]').textContent).toContain("Early Autumn");
  expect(container.querySelectorAll('[data-testid^="calendar-day-"]')).toHaveLength(2);
  expect(container.querySelectorAll('[data-testid="calendar-race"]')).toHaveLength(2);
  expect(container.querySelector('[data-testid="calendar-race"]').tagName).toBe("DIV");
  expect(container.querySelector('[data-testid="calendar-race"]').closest("a")).toBeNull();
});
