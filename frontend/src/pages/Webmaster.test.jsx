// The webmaster console is the one screen with no club of its own to fall back
// on, so it has to offer an explicit route back to the public site — exactly
// the "View site" entry the officer and admin consoles provide. ConsoleNav is
// stubbed here just to expose the items the page hands it.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";

const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ role: "webmaster", clubId: null, clubName: "", updateSession: jest.fn(), logout: jest.fn() }),
}));
jest.mock("@/lib/api", () => ({
  api: { getClubsManage: jest.fn() },
  formatApiError: (detail) => detail || "error",
}));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));
jest.mock("@/components/ConsoleNav", () => ({ items = [] }) => (
  <div data-testid="console-nav">
    {items.map((item) => (
      <button key={item.key} data-testid={`console-item-${item.key}`} onClick={item.onClick}>{item.label}</button>
    ))}
  </div>
));
jest.mock("@/components/UsersManager", () => () => null);

// jsdom lacks the browser APIs Radix dialogs rely on.
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

const mockApi = require("@/lib/api").api;

import Webmaster from "./Webmaster";

let container;
let root;

async function renderPage() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Webmaster />);
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockApi.getClubsManage.mockResolvedValue([]);
});

afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  jest.clearAllMocks();
});

test("the webmaster console keeps a way back to the public site", async () => {
  await renderPage();

  const viewSite = container.querySelector('[data-testid="console-item-site"]');
  expect(viewSite).not.toBeNull();
  expect(viewSite.textContent).toContain("View site");

  act(() => viewSite.click());
  expect(mockNavigate).toHaveBeenCalledWith("/");
});
