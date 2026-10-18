// The Race Officer changes the clubhouse TV from the console they are already
// in: an item in the top bar on desktop and in the burger menu on a phone.
// Choosing it opens the same settings card the Admin console uses.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";

const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ role: "officer", logout: jest.fn(), updateSession: jest.fn() }),
}));
// The TV card is exercised by its own tests; here an empty API is enough for
// it to render its defaults.
jest.mock("@/lib/api", () => ({ api: {} }));
jest.mock("@/components/ThemeToggle", () => () => <button type="button" data-testid="theme-toggle" />);
jest.mock("@/components/HelpSidebar", () => ({ openHelpSidebar: jest.fn() }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));

import { TopBar } from "./Officer";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!window.PointerEvent) {
  window.PointerEvent = class PointerEventPolyfill extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerType = params.pointerType || "mouse";
    }
  };
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

let container;
let root;

const renderTopBar = async (props = {}) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<TopBar clubName="Medway YC" clubSlug="medway-yc" clubId="club-a" {...props} />);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return container;
};

const openMenu = () => {
  const trigger = container.querySelector('[data-testid="console-menu-btn"]');
  act(() => {
    trigger.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

describe("Officer TopBar clubhouse TV entry", () => {
  it("offers the clubhouse TV in the desktop item row", async () => {
    await renderTopBar();
    const row = container.querySelector(".hidden.lg\\:flex");
    expect(row.querySelector('[data-testid="nav-tv"]')).not.toBeNull();
    expect(row.textContent).toContain("Clubhouse TV");
  });

  it("offers it in the burger menu and opens the TV settings", async () => {
    await renderTopBar();
    openMenu();
    const item = document.body.querySelector('[data-testid="menu-tv"]');
    expect(item).not.toBeNull();
    await act(async () => {
      item.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const dialog = document.body.querySelector('[data-testid="clubhouse-tv-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('[data-testid="tv-display-settings-card"]')).not.toBeNull();
  });

  it("hides the entry when no club is selected (webmaster picker)", async () => {
    await renderTopBar({ clubId: undefined });
    const row = container.querySelector(".hidden.lg\\:flex");
    expect(row.querySelector('[data-testid="nav-tv"]')).toBeNull();
  });
});
