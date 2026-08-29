// Public ONB grouping: notices are grouped into the club's NOTICE AREAS (the
// officer-chosen publication area stored as `heading` — "Club Notices", "Open
// Event Notices" or a custom club area), each area splitting into its notice
// TYPES. Notice numbers are sequential per area, so within a type they are
// ordered by notice number, smallest first.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("@/lib/api", () => {
  const api = { getNotices: jest.fn(), getNotice: jest.fn(), getNoticeAreas: jest.fn() };
  return { api, formatApiError: (d) => d || "error" };
});
jest.mock("@/components/ui/accordion", () => {
  const Pass = ({ children }) => <div>{children}</div>;
  return { Accordion: Pass, AccordionItem: Pass, AccordionTrigger: Pass, AccordionContent: Pass };
});
jest.mock("@/components/NoticeBody", () => ({
  NoticeBodyView: () => null,
  NoticeFacts: () => null,
  noticeHeadingLine: ({ notice_type_label: t, notice_number: n }) => (
    <span data-testid="card-heading">{t} {n}</span>
  ),
  noticeContextLine: () => null,
}));

import NoticeBoard from "./NoticeBoard";

const mockApi = require("@/lib/api").api;

// `heading` is the officer-chosen notice AREA (backend stores it at creation
// from the chosen publication area); numbers are sequential per area.
const mk = (id, notice_type, label, notice_number, heading, overrides = {}) => ({
  id, notice_type, notice_type_label: label, notice_number, title: `${label} ${notice_number}`,
  status: "published", content_type: "generated", version: 1, heading,
  published_at: "2026-08-01T10:00:00",
  ...overrides,
});

let container;
let root;

beforeEach(() => {
  mockApi.getNotices.mockReset();
  mockApi.getNotice.mockReset().mockResolvedValue(null);
  mockApi.getNoticeAreas.mockReset();
});

afterEach(async () => {
  if (root) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  document.body.innerHTML = "";
});

const renderBoard = async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<NoticeBoard clubId="c1" embedded />);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return container;
};

it("groups the club's notice areas into their notice types, each by number", async () => {
  // The club's configured areas (in /notice-areas order): the two built-ins
  // plus one custom area. Race Postponement No. 2 sits in Club Notices while
  // Race Cancellation No. 1 shares the same area — proving areas split by
  // type, and cancellation numbers are supplied out of order to prove the
  // per-type sort.
  mockApi.getNoticeAreas.mockResolvedValue([
    { key: "club", title: "Club Notices" },
    { key: "open_event", title: "Open Event Notices" },
    { key: "custom:sailing-instructions", title: "Sailing Instructions" },
  ]);
  mockApi.getNotices.mockResolvedValue([
    mk("p2", "race_postponement", "Race Postponement", 2, "Club Notices"),
    mk("c1", "race_cancellation", "Race Cancellation", 1, "Club Notices"),
    mk("n1", "notice_to_competitors", "Notice to Competitors", 1, "Open Event Notices"),
    mk("g1", "general_club_notice", "General Club Notice", 1, "Sailing Instructions"),
  ]);

  await renderBoard();

  // Main areas are the section headers, in the club's configured order.
  const areas = [...container.querySelectorAll("h3")].map((h) => h.textContent.trim());
  expect(areas).toEqual(["Club Notices", "Open Event Notices", "Sailing Instructions"]);

  // Each area splits into its notice types (canonical type order within an area).
  const types = [...container.querySelectorAll("h4")].map((h) => h.textContent.trim());
  expect(types).toEqual(["Race Postponement", "Race Cancellation", "Notice to Competitors", "General Club Notice"]);

  // Within each type, notices are ordered by number ascending.
  const cards = [...container.querySelectorAll('[data-testid="card-heading"]')].map((c) => c.textContent);
  expect(cards).toEqual([
    "Race Postponement 2",
    "Race Cancellation 1",
    "Notice to Competitors 1",
    "General Club Notice 1",
  ]);
});

it("renders a link notice with a Visit website button", async () => {
  mockApi.getNoticeAreas.mockResolvedValue([{ key: "club", title: "Club Notices" }]);
  mockApi.getNotices.mockResolvedValue([
    { ...mk("l1", "general_club_notice", "General Club Notice", 1, "Club Notices"),
      content_type: "link", link_url: "https://example.com/sailing-results" },
  ]);

  await renderBoard();

  const link = container.querySelector('[data-testid="visit-link-l1"]');
  expect(link).not.toBeNull();
  expect(link.getAttribute("href")).toBe("https://example.com/sailing-results");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
});

it("falls back to built-in area order and Club Notices when areas are unavailable", async () => {
  // The areas fetch fails: the two built-in areas come first, then the rest
  // alphabetically, and a notice without a stored heading lands in Club
  // Notices. A raw publication-area KEY heading (legacy data) is normalised
  // to its display title.
  mockApi.getNoticeAreas.mockRejectedValue(new Error("network"));
  mockApi.getNotices.mockResolvedValue([
    mk("g1", "general_club_notice", "General Club Notice", 1, "Custom Zone"),
    mk("n1", "notice_to_competitors", "Notice to Competitors", 1, "open_event"),
    { ...mk("h1", "safety_notice", "Safety Notice", 1, "Safety"),
      heading: undefined, published_at: "2026-08-01T10:00:00" },
  ]);

  await renderBoard();

  const areas = [...container.querySelectorAll("h3")].map((h) => h.textContent.trim());
  expect(areas).toEqual(["Club Notices", "Open Event Notices", "Custom Zone"]);

  const cards = [...container.querySelectorAll('[data-testid="card-heading"]')].map((c) => c.textContent);
  expect(cards).toEqual(["Safety Notice 1", "Notice to Competitors 1", "General Club Notice 1"]);
});
