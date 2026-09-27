import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...props }) => <a href={to} {...props}>{children}</a>,
}));

jest.mock("@/lib/api", () => ({ api: {
  getClubApplicationsManage: jest.fn(),
  reviewClubApplication: jest.fn(),
  retryClubApplicationNotification: jest.fn(),
} }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

import ClubApplicationsQueue from "./ClubApplicationsQueue";
const api = require("@/lib/api").api;
const toast = require("sonner").toast;

let root;
let container;

const pending = {
  id: "app-1", club_id: "club-1", club_name: "Harbour Sailing Club",
  club_slug: "harbour-sailing-club", applicant_name: "Alex Sailor",
  email: "alex@harbour.org", status: "pending", submitted_at: "2026-09-01T10:00:00Z",
  webmaster_notification_sent: false,
};

const flush = async () => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};

const renderQueue = async (onOpenEmailSettings = jest.fn()) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<ClubApplicationsQueue onOpenEmailSettings={onOpenEmailSettings} />); });
  await flush();
  return container;
};

beforeEach(() => {
  api.getClubApplicationsManage.mockResolvedValue({ items: [pending], notification_configured: true });
  api.reviewClubApplication.mockResolvedValue({ ...pending, status: "approved" });
  api.retryClubApplicationNotification.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  if (root) {
    await act(async () => {});
    act(() => root.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

test("shows a verified application with preview, approval, rejection, and notification retry", async () => {
  await renderQueue();
  expect(container.querySelector('[data-testid="application-app-1"]')?.textContent).toContain("Harbour Sailing Club");
  expect(container.querySelector('[data-testid="application-preview-app-1"]')?.getAttribute("href")).toBe("/club/harbour-sailing-club");
  expect(container.querySelector('[data-testid="application-approve-app-1"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="application-reject-app-1"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="application-notify-app-1"]')).not.toBeNull();
});

test("approves a private application and reloads the durable queue", async () => {
  await renderQueue();
  await act(async () => { container.querySelector('[data-testid="application-approve-app-1"]').click(); });
  await flush();
  expect(api.reviewClubApplication).toHaveBeenCalledWith("app-1", "approved");
  expect(api.getClubApplicationsManage).toHaveBeenCalledTimes(2);
  expect(toast.success).toHaveBeenCalledWith("Club application approved");
});

test("shows email configuration warning and offers settings shortcut", async () => {
  api.getClubApplicationsManage.mockResolvedValue({ items: [], notification_configured: false });
  const openSettings = jest.fn();
  await renderQueue(openSettings);
  expect(container.querySelector('[data-testid="applications-email-warning"]')).not.toBeNull();
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent.includes("Email settings"));
  await act(async () => { button.click(); });
  expect(openSettings).toHaveBeenCalled();
});

test("rejected applications can be approved again", async () => {
  api.getClubApplicationsManage.mockResolvedValue({
    items: [{ ...pending, status: "rejected", webmaster_notification_sent: true }],
    notification_configured: true,
  });
  await renderQueue();
  expect(container.querySelector('[data-testid="application-approve-app-1"]')?.textContent).toContain("Approve again");
  expect(container.querySelector('[data-testid="application-reject-app-1"]')).toBeNull();
});
