// Public ONB grouping: notices are grouped by TYPE (not heading), because
// notice numbers are sequential per type and several types share a heading.
// Within a type they are ordered by notice number, smallest first.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("@/lib/api", () => {
  const api = { getNotices: jest.fn(), getNotice: jest.fn() };
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

const mk = (id, notice_type, label, notice_number, overrides = {}) => ({
  id, notice_type, notice_type_label: label, notice_number, title: `${label} ${notice_number}`,
  status: "published", content_type: "generated", version: 1, heading: "Race Notices",
  published_at: "2026-08-01T10:00:00",
  ...overrides,
});

let container;
let root;

beforeEach(() => {
  mockApi.getNotices.mockReset();
  mockApi.getNotice.mockReset().mockResolvedValue(null);
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
  await act(async () => {});
  return container;
};

it("groups by notice type and orders each type by number", async () => {
  // Two types share the "Race Notices" heading, and cancellation numbers are
  // supplied out of numerical order to prove the per-type sort.
  const p1 = mk("p1", "race_postponement", "Race Postponement", 1);
  const c2 = mk("c2", "race_cancellation", "Race Cancellation", 2);
  const c1 = mk("c1", "race_cancellation", "Race Cancellation", 1);
  const c3 = mk("c3", "race_cancellation", "Race Cancellation", 3);
  mockApi.getNotices.mockResolvedValue([p1, c2, c1, c3, mk("n1", "notice_to_competitors", "Notice to Competitors", 1)]);

  await renderBoard();

  // The group headers appear in canonical type order, not alphabetical.
  const headers = [...container.querySelectorAll("h3")].map((h) => h.textContent.trim());
  expect(headers).toEqual(["Notice to Competitors", "Race Postponement", "Race Cancellation"]);

  // Within each type, notices are ordered by number ascending.
  const cards = [...container.querySelectorAll('[data-testid="card-heading"]')].map((c) => c.textContent);
  expect(cards).toEqual([
    "Notice to Competitors 1",
    "Race Postponement 1",
    "Race Cancellation 1",
    "Race Cancellation 2",
    "Race Cancellation 3",
  ]);
});