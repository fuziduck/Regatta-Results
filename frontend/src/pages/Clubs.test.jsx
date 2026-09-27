import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

jest.mock("@/lib/api", () => ({
  api: {
    getSeasons: jest.fn(),
    getClubDirectory: jest.fn(),
    getClasses: jest.fn(),
    getClubs: jest.fn(),
    getAdverts: jest.fn(),
  },
}));
jest.mock("@/components/AdvertCard", () => ({
  __esModule: true,
  default: () => null,
  useAdverts: () => ({ adverts: [], roll: 0 }),
  pickAdverts: () => [],
}));
jest.mock("@/components/HeaderMenu", () => () => null);
jest.mock("@/components/OfficialsLink", () => () => null);
jest.mock("@/components/BoatSearchBox", () => () => null);
jest.mock("@/components/YearSwitcher", () => () => null);
jest.mock("@/components/ClubBadge", () => () => <span />);

import Clubs from "./Clubs";
const api = require("@/lib/api").api;

let root;
let container;

beforeEach(() => {
  api.getSeasons.mockResolvedValue({ years: [] });
  api.getClubDirectory.mockResolvedValue([]);
  api.getClasses.mockResolvedValue([
    { id: "public-class", name: "Sonata", club_id: "public-club", class_group_key: "sonata", scoring_mode: "handicap" },
  ]);
  api.getClubs.mockResolvedValue([
    { id: "public-club", name: "Harbour Sailing Club", slug: "harbour-club" },
  ]);
});

afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

test("renders only the approved public directory data", async () => {
  api.getClubDirectory.mockResolvedValue([
    { id: "public-club", name: "Harbour Sailing Club", slug: "harbour-club", classes: [] },
  ]);
  api.getClasses.mockResolvedValue([
    { id: "public-class", name: "Sonata", club_id: "public-club", class_group_key: "sonata", scoring_mode: "handicap" },
    { id: "private-class", name: "Secret Fleet", club_id: "pending-club", class_group_key: "secret-fleet", scoring_mode: "handicap" },
  ]);
  api.getClubs.mockResolvedValue([
    { id: "public-club", name: "Harbour Sailing Club", slug: "harbour-club", approval_status: "approved" },
    { id: "pending-club", name: "Secret Pending Club", slug: "secret-club", approval_status: "pending" },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter>
        <Clubs />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Harbour Sailing Club");
  expect(container.textContent).not.toContain("Secret Pending Club");
  expect(container.textContent).not.toContain("Secret Fleet");

  await act(async () => {
    const filter = container.querySelector('[data-testid="system-directory-filter"]');
    filter.value = "classes";
    filter.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Sonata");
  expect(container.textContent).not.toContain("Secret Pending Club");
  expect(container.textContent).not.toContain("Secret Fleet");
});
