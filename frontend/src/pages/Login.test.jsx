// Two-step webmaster login: when the server answers { requires_2fa } the
// passcode form must swap to a second-factor step (authenticator code, or an
// emailed fallback code), and completing it signs the user in.
import { act } from "react";
import { createRoot } from "react-dom/client";

// Jest factories cannot close over module-level consts (they are hoisted
// above them), so AuthContext is stubbed with a lazy holder object (read via
// the mock's own require) and the api module builds its mocks internally.
const mockAuth = { login: jest.fn(), login2fa: jest.fn() };
const mockNavigate = jest.fn();

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));
// react-scripts sets resetMocks:true, so any implementation attached at
// factory-creation time is wiped before the first test — implementations must
// be attached in beforeEach or inside the test bodies instead.
jest.mock("@/lib/api", () => {
  const api = { sendEmailCode: jest.fn(), getClubs: jest.fn() };
  return { api, formatApiError: (d) => d || "error" };
});
jest.mock("@/components/ThemeToggle", () => () => <button type="button" data-testid="theme-toggle" />);

import Login from "./Login";

// The api mock's functions are created inside its factory; grab the same
// (module-cached) instance to assert on calls.
const mockApi = require("@/lib/api").api;

// jsdom lacks browser APIs Radix/input-otp rely on.
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
// input-otp's password-manager badge probe calls elementFromPoint in a timer.
if (!document.elementFromPoint) {
  document.elementFromPoint = () => document.createElement("div");
}

let container;
let root;
const renderLogin = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<Login />);
  });
  return container;
};

beforeEach(() => {
  mockApi.getClubs.mockResolvedValue([]);
  mockApi.sendEmailCode.mockResolvedValue({ ok: true });
});

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
  mockAuth.login.mockClear();
  mockAuth.login2fa.mockClear();
  mockApi.sendEmailCode.mockClear();
  mockNavigate.mockClear();
});

const setNativeValue = (el, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const submitPasscode = async () => {
  await act(async () => {
    container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

describe("two-step webmaster login", () => {
  it("shows the second-factor step when the passcode answers requires_2fa", async () => {
    mockAuth.login.mockResolvedValue({ requires_2fa: true, methods: ["totp", "email"] });
    renderLogin();
    act(() => setNativeValue(container.querySelector('[data-testid="pin-input"]'), "master2026"));
    await submitPasscode();
    expect(mockAuth.login).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="otp-input"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="email-code-link"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pin-input"]')).toBeNull();
  });

  it("stays on the passcode form when 2FA is not required", async () => {
    mockAuth.login.mockResolvedValue({ role: "officer", club_id: "c1", club_name: "Club" });
    renderLogin();
    act(() => setNativeValue(container.querySelector('[data-testid="pin-input"]'), "test1234!"));
    await submitPasscode();
    expect(mockNavigate).toHaveBeenCalledWith("/officer");
    expect(container.querySelector('[data-testid="otp-input"]')).toBeNull();
  });

  it("sends an emailed fallback code from the second-factor step", async () => {
    mockAuth.login.mockResolvedValue({ requires_2fa: true, methods: ["totp", "email"] });
    mockApi.sendEmailCode.mockResolvedValue({ ok: true });
    renderLogin();
    act(() => setNativeValue(container.querySelector('[data-testid="pin-input"]'), "master2026"));
    await submitPasscode();
    await act(async () => {
      container.querySelector('[data-testid="email-code-link"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockApi.sendEmailCode).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="use-app-link"]')).not.toBeNull();
  });

  it("completes login with a verification code", async () => {
    mockAuth.login.mockResolvedValue({ requires_2fa: true, methods: ["totp", "email"] });
    mockAuth.login2fa.mockResolvedValue({ role: "webmaster", club_id: null, club_name: null });
    renderLogin();
    act(() => setNativeValue(container.querySelector('[data-testid="pin-input"]'), "master2026"));
    await submitPasscode();
    const otpEl = container.querySelector('[data-testid="otp-input"]');
    const hidden = otpEl.tagName === "INPUT" ? otpEl : otpEl.querySelector("input");
    act(() => setNativeValue(hidden, "123456"));
    await submitPasscode();
    expect(mockAuth.login2fa).toHaveBeenCalledWith("totp", "123456");
    expect(mockNavigate).toHaveBeenCalledWith("/webmaster");
  });
});
