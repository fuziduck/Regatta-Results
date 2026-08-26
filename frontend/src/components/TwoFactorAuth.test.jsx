// Regression: the 2FA panel reads status fields directly in the render, so it
// must not render them until get2faStatus resolves. Mounting with a pending
// status fetch used to throw "Cannot read properties of null (reading
// 'email')" and blank the page.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("@/lib/api", () => {
  const api = {
    get2faStatus: jest.fn(),
    setup2fa: jest.fn(),
    enable2fa: jest.fn(),
    disable2fa: jest.fn(),
    sendEmailCode: jest.fn(),
    update2faEmail: jest.fn(),
  };
  return { api, formatApiError: (d) => d || "error" };
});
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));

import TwoFactorAuth from "./TwoFactorAuth";

const mockApi = require("@/lib/api").api;

// jsdom lacks the browser APIs Radix dialogs / input-otp rely on.
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
if (!document.elementFromPoint) {
  document.elementFromPoint = () => document.createElement("div");
}

let container;
let root;
const renderPage = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<TwoFactorAuth />);
  });
  return container;
};

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
  mockApi.get2faStatus.mockClear();
});

describe("TwoFactorAuth", () => {
  it("does not crash while the status fetch is pending", async () => {
    // Never-resolving promise: the component mounts with status === null.
    mockApi.get2faStatus.mockReturnValue(new Promise(() => {}));
    renderPage();
    await act(async () => {});
    expect(container.textContent).toContain("Loading security settings");
  });

  it("renders the 2FA state once the status resolves", async () => {
    mockApi.get2faStatus.mockResolvedValue({ enabled: false, email: "", has_email: false, methods: ["totp"] });
    renderPage();
    await act(async () => {});
    expect(container.textContent).toContain("Two-factor authentication disabled");
    expect(container.querySelector('[data-testid="enable-2fa-btn"]')).not.toBeNull();
  });
});
