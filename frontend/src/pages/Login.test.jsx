// Login page: no role tabs — typing the webmaster username switches the form
// to the webmaster sign-in (club picker hidden). Two-step webmaster login:
// when the server answers { requires_2fa } the passcode form swaps to a
// second-factor step (authenticator code, or an emailed fallback code).
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

afterEach(async () => {
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
  mockAuth.login.mockClear();
  mockAuth.login2fa.mockClear();
  mockApi.sendEmailCode.mockClear();
  mockNavigate.mockClear();
});

const setNativeValue = (el, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const typeUsername = (value) => {
  act(() => setNativeValue(container.querySelector('[data-testid="username-input"]'), value));
};

const submitPasscode = async () => {
  await act(async () => {
    container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

describe("tab-free login", () => {
  it("has no role tabs and shows the club picker by default", async () => {
    renderLogin();
    expect(container.querySelector('[data-testid="role-officer-tab"]')).toBeNull();
    expect(container.querySelector('[data-testid="role-admin-tab"]')).toBeNull();
    expect(container.querySelector('[data-testid="role-webmaster-tab"]')).toBeNull();
    expect(container.querySelector('[data-testid="club-select"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="forgot-passcode-link"]')).not.toBeNull();
  });

  it("typing the webmaster username hides the club picker and switches the form", async () => {
    renderLogin();
    typeUsername("webmaster");
    expect(container.querySelector('[data-testid="club-select"]')).toBeNull();
    expect(container.querySelector("#username")).not.toBeNull();
    expect(container.textContent).toContain("no club needed here");
  });
});

describe("two-step webmaster login", () => {
  it("shows the second-factor step when the passcode answers requires_2fa", async () => {
    mockAuth.login.mockResolvedValue({ requires_2fa: true, methods: ["totp", "email"] });
    renderLogin();
    typeUsername("webmaster");
    act(() => setNativeValue(container.querySelector('[data-testid="pin-input"]'), "master2026"));
    await submitPasscode();
    expect(mockAuth.login).toHaveBeenCalledWith("webmaster", "webmaster", "master2026", null);
    expect(container.querySelector('[data-testid="otp-input"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="email-code-link"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pin-input"]')).toBeNull();
  });

  it("stays on the passcode form when 2FA is not required", async () => {
    mockApi.getClubs.mockResolvedValue([{ id: "c1", slug: "club", name: "Club" }]);
    mockAuth.login.mockResolvedValue({ role: "officer", club_id: "c1", club_name: "Club" });
    renderLogin();
    await act(async () => {}); // flush the clubs fetch so clubId is set
    typeUsername("officer@club.org");
    act(() => setNativeValue(container.querySelector('[data-testid="pin-input"]'), "test1234!"));
    await submitPasscode();
    expect(mockAuth.login).toHaveBeenCalledWith("officer", "officer@club.org", "test1234!", "c1");
    expect(mockNavigate).toHaveBeenCalledWith("/officer");
    expect(container.querySelector('[data-testid="otp-input"]')).toBeNull();
  });

  it("sends an emailed fallback code from the second-factor step", async () => {
    mockAuth.login.mockResolvedValue({ requires_2fa: true, methods: ["totp", "email"] });
    renderLogin();
    typeUsername("webmaster");
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
    typeUsername("webmaster");
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
