// Header burger menu: folds share, install-as-webapp, and day/night into one
// dropdown on the left, keeping the public headers clean.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("@/components/ui/dropdown-menu", () => {
  const React = require("react");
  const Root = ({ children }) => <div>{children}</div>;
  const Trigger = ({ children, ...rest }) => <button type="button" {...rest}>{children}</button>;
  const Content = ({ children }) => <div>{children}</div>;
  const Item = ({ children, onSelect, ...rest }) => <div onClick={onSelect} {...rest}>{children}</div>;
  return { DropdownMenu: Root, DropdownMenuTrigger: Trigger, DropdownMenuContent: Content, DropdownMenuItem: Item };
});
jest.mock("@/components/ui/dialog", () => {
  const React = require("react");
  const Dialog = ({ open, children }) => (open ? <>{children}</> : null);
  const Pass = ({ children, ...rest }) => <div {...rest}>{children}</div>;
  return { Dialog, DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass, DialogFooter: Pass };
});

// jsdom lacks matchMedia, which ThemeProvider's initial theme reads.
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {} });
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import HeaderMenu from "@/components/HeaderMenu";
import { ThemeProvider } from "@/context/ThemeContext";
import { toast } from "sonner";

function renderMenu(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ThemeProvider><HeaderMenu title="Medway Yacht Club · results" {...props} /></ThemeProvider>));
  return container;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete navigator.share;
  navigator.clipboard = { writeText: jest.fn().mockResolvedValue(undefined) };
  window.localStorage.removeItem("sailscore-theme");
});

it("copies the page link from the Share item with a toast", async () => {
  const container = renderMenu();
  await act(async () => {
    container.querySelector('[data-testid="header-menu-share"]').click();
    await new Promise((r) => setTimeout(r, 10));
  });
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith("http://localhost/");
  expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Link copied"));
});

it("opens the install-as-app dialog from the Add to Home Screen item", () => {
  const container = renderMenu();
  expect(container.querySelector('[data-testid="install-help-dialog"]')).toBeNull();
  act(() => container.querySelector('[data-testid="header-menu-install"]').click());
  const dialog = container.querySelector('[data-testid="install-help-dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain("Add to Home Screen");
});

it("toggles day/night from the theme item", async () => {
  const container = renderMenu();
  const item = () => container.querySelector('[data-testid="header-menu-theme"]');
  expect(item().textContent).toContain("Switch to night mode");
  act(() => item().click());
  expect(item().textContent).toContain("Switch to day mode");
  act(() => item().click());
  expect(item().textContent).toContain("Switch to night mode");
});