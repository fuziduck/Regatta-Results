// Forgot-password page: one unified form — club officials pick their club and
// enter their club email; the webmaster's reset goes to the backup email
// stored on the account (the backend resolves it regardless of the selected
// club). No role switcher on the page.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}));
// react-scripts sets resetMocks:true, so implementations must be attached in
// beforeEach, never in the factory.
jest.mock("@/lib/api", () => {
  const api = { getClubs: jest.fn(), forgotPassword: jest.fn() };
  return { api, formatApiError: (d) => d || "error" };
});
jest.mock("@/components/ThemeToggle", () => () => <button type="button" data-testid="theme-toggle" />);
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));

import ForgotPassword from "./ForgotPassword";

const mockApi = require("@/lib/api").api;

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

let container;
let root;
const renderPage = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<ForgotPassword />);
  });
  return container;
};

beforeEach(() => {
  mockApi.getClubs.mockResolvedValue([
    { id: "c1", name: "Bough Beech" },
    { id: "c2", name: "Medway" },
    { id: "c3", name: "Sonata" },
  ]);
  mockApi.forgotPassword.mockResolvedValue({ ok: true });
});

afterEach(async () => {
  // Flush any pending state updates (e.g. the clubs fetch) before unmounting
  // so React does not warn about updates not wrapped in act().
  if (root) {
    await act(async () => {});
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  document.body.innerHTML = "";
  mockApi.getClubs.mockClear();
  mockApi.forgotPassword.mockClear();
});

const setNativeValue = (el, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const submitForm = async () => {
  await act(async () => {
    container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

describe("Forgot password — unified form", () => {
  it("renders a single form with no role switcher", async () => {
    renderPage();
    await act(async () => {});
    // No club-official / webmaster toggle on the page.
    expect(container.querySelector('[data-testid="forgot-role-official"]')).toBeNull();
    expect(container.querySelector('[data-testid="forgot-role-webmaster"]')).toBeNull();
    // One email field; the club picker disambiguates club officials.
    expect(container.querySelector("#email")).not.toBeNull();
    expect(container.querySelector("#club")).not.toBeNull();
  });

  it("submits the selected club id with the email", async () => {
    renderPage();
    await act(async () => {});
    act(() => setNativeValue(container.querySelector("#email"), "officer@club.org"));
    await submitForm();
    expect(mockApi.forgotPassword).toHaveBeenCalledWith("c1", "officer@club.org");
  });

  it("webmaster backup email also goes through the same form", async () => {
    renderPage();
    await act(async () => {});
    act(() => setNativeValue(container.querySelector("#email"), "wm@example.org"));
    await submitForm();
    // The webmaster lookup is server-side; the client always sends the club id.
    expect(mockApi.forgotPassword).toHaveBeenCalledWith("c1", "wm@example.org");
  });
});
