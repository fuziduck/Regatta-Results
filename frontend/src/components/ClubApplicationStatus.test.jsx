import { act } from "react";
import { createRoot } from "react-dom/client";

const mockAuth = { clubApplication: {
  id: "app-1", club_id: "club-1", club_slug: "harbour-sailing-club", status: "pending",
} };

jest.mock("@/context/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@/lib/api", () => ({ api: { getMyClubApplication: jest.fn() } }));
const mockApi = require("@/lib/api").api;
jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
}));

import ClubApplicationStatus from "./ClubApplicationStatus";

let root;
let container;

beforeEach(() => {
  mockApi.getMyClubApplication.mockImplementation(() => new Promise(() => {}));
  mockAuth.clubApplication = {
    id: "app-1", club_id: "club-1", club_slug: "harbour-sailing-club", status: "pending",
  };
});

afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
});

const render = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<ClubApplicationStatus />));
  return container;
};

test("shows pending owners that their workspace is private and previewable", () => {
  render();
  expect(container.querySelector('[data-testid="club-application-status"]')?.textContent).toContain("awaiting review");
  expect(container.querySelector('[data-testid="club-application-status"]')?.textContent).toContain("stay hidden");
  expect(container.querySelector('[data-testid="club-application-preview"]')?.getAttribute("href")).toBe("/club/harbour-sailing-club");
});

test("explains that rejection preserves the private workspace", () => {
  mockAuth.clubApplication.status = "rejected";
  render();
  expect(container.querySelector('[data-testid="club-application-status"]')?.textContent).toContain("application was rejected");
  expect(container.querySelector('[data-testid="club-application-status"]')?.textContent).toContain("still available and private");
});

test("switches to public-page copy after approval", () => {
  mockAuth.clubApplication.status = "approved";
  render();
  expect(container.querySelector('[data-testid="club-application-status"]')?.textContent).toContain("club is approved");
  expect(container.querySelector('[data-testid="club-application-preview"]')?.textContent).toContain("View public page");
});
