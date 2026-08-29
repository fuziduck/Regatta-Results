// Share button (Web Share API with copy-link fallback) and the iOS/Android
// "install as an app" instructions dialog.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock("@/components/ui/dialog", () => {
  const React = require("react");
  const Dialog = ({ open, children }) => (open ? <>{children}</> : null);
  const Pass = ({ children, ...rest }) => <div {...rest}>{children}</div>;
  return { Dialog, DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass, DialogFooter: Pass };
});

import ShareInstall from "@/components/ShareInstall";
import { toast } from "sonner";

function renderButton(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ShareInstall title="Medway Yacht Club · results & standings" {...props} />));
  return container;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete navigator.share;
  navigator.clipboard = { writeText: jest.fn().mockResolvedValue(undefined) };
});

it("uses the Web Share API when available", async () => {
  navigator.share = jest.fn().mockResolvedValue(undefined);
  const container = renderButton();
  await act(async () => {
    container.querySelector('[data-testid="share-page-btn"]').click();
    await new Promise((r) => setTimeout(r, 10));
  });
  expect(navigator.share).toHaveBeenCalledWith(
    expect.objectContaining({ title: "Medway Yacht Club · results & standings", url: "http://localhost/" })
  );
});

it("copies the link and toasts when Web Share is unavailable", async () => {
  const container = renderButton();
  await act(async () => {
    container.querySelector('[data-testid="share-page-btn"]').click();
    await new Promise((r) => setTimeout(r, 10));
  });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("http://localhost/");
  expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Link copied"));
});

it("opens the install-as-app instructions dialog", () => {
  const container = renderButton();
  expect(container.querySelector('[data-testid="install-help-dialog"]')).toBeNull();
  act(() => container.querySelector('[data-testid="install-app-btn"]').click());
  const dialog = container.querySelector('[data-testid="install-help-dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain("Add to Home Screen");
});
