// Regression tests for the responsive console navigation. The desktop item
// row and the mobile menu both render from the same items list, so the tests
// assert the two critical guarantees: every item (Exit included) is always
// present, and the menu opens/closes cleanly.
import { act } from "react";
import { createRoot } from "react-dom/client";

const mockLogout = jest.fn();
const mockNavigate = jest.fn();
const mockUpdate = jest.fn();

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ role: "webmaster", logout: mockLogout, updateSession: mockUpdate }),
}));
jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }));
jest.mock("@/components/ThemeToggle", () => () => <button type="button" data-testid="theme-toggle" />);

import ConsoleNav from "./ConsoleNav";

// jsdom lacks the browser APIs Radix popper/portal rely on.
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
const renderNav = (props) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<ConsoleNav {...props} />);
  });
  return container;
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
  // The Radix menu portals into <body>; make sure it is gone between tests.
  document.body.innerHTML = "";
});

const baseProps = (overrides = {}) => ({
  items: [
    { key: "officer", label: "Officer", icon: null, testId: "nav-officer", onClick: jest.fn() },
    { key: "switch", label: "Switch club", icon: null, testId: "nav-switch", menuTestId: "menu-switch", onClick: jest.fn() },
    { key: "webmaster", label: "Webmaster", icon: null, menuTestId: "menu-webmaster", onClick: jest.fn() },
  ],
  onChangedPasscode: mockUpdate,
  logoutTestId: "logout-btn",
  ...overrides,
});

const openMenu = () => {
  const trigger = container.querySelector('[data-testid="console-menu-btn"]');
  expect(trigger).not.toBeNull();
  act(() => {
    trigger.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("ConsoleNav desktop row", () => {
  it("renders every item plus Exit in the desktop row", () => {
    renderNav(baseProps());
    const row = container.querySelector(".hidden.lg\\:flex");
    expect(row).not.toBeNull();
    expect(row.querySelector('[data-testid="nav-officer"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="nav-switch"]')).not.toBeNull();
    expect(row.textContent).toContain("Webmaster");
    expect(row.querySelector('[data-testid="logout-btn"]')).not.toBeNull();
    expect(row.textContent).toContain("Exit");
    expect(row.querySelector('[data-testid="change-passcode-btn"]')).not.toBeNull();
  });

  it("filters items with show:false out of the bar", () => {
    renderNav(baseProps({ items: [
      { key: "a", label: "A", icon: null, show: false, onClick: jest.fn() },
      { key: "b", label: "B", icon: null, onClick: jest.fn() },
    ] }));
    const row = container.querySelector(".hidden.lg\\:flex");
    expect(row.textContent).toContain("B");
    expect(row.textContent).not.toContain("A");
  });

  it("runs an item's onClick from the desktop button", () => {
    const onClick = jest.fn();
    renderNav(baseProps({ items: [{ key: "a", label: "A", icon: null, testId: "nav-a", onClick }] }));
    act(() => {
      container.querySelector('[data-testid="nav-a"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalled();
  });
});

describe("ConsoleNav mobile menu", () => {
  it("opens and lists every item plus Exit and Change passcode", () => {
    renderNav(baseProps());
    openMenu();
    expect(document.body.querySelector('[data-testid="menu-switch"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="menu-webmaster"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="menu-change-passcode"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="menu-logout-btn"]')).not.toBeNull();
  });

  it("closes the menu with Escape", () => {
    renderNav(baseProps());
    openMenu();
    expect(document.body.querySelector('[data-testid="menu-logout-btn"]')).not.toBeNull();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.body.querySelector('[data-testid="menu-logout-btn"]')).toBeNull();
  });

  it("runs an item's onClick from the menu and closes it", () => {
    const onClick = jest.fn();
    renderNav(baseProps({ items: [{ key: "a", label: "Admin", icon: null, menuTestId: "menu-a", onClick }] }));
    openMenu();
    act(() => {
      document.body.querySelector('[data-testid="menu-a"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="menu-a"]')).toBeNull();
  });

  it("logs out and navigates home from the menu Exit", () => {
    renderNav(baseProps());
    openMenu();
    act(() => {
      document.body.querySelector('[data-testid="menu-logout-btn"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockLogout).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("logs out and navigates home from the desktop Exit", () => {
    renderNav(baseProps());
    act(() => {
      container.querySelector('[data-testid="logout-btn"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockLogout).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });

  it("opens the passcode dialog from the menu", () => {
    renderNav(baseProps());
    openMenu();
    act(() => {
      document.body.querySelector('[data-testid="menu-change-passcode"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
