// 2FA settings live in the MAIN console sections for club staff (Race
// Officer page section + Race Admin tab) — not in the top bar, which the
// webmaster also uses. These tests render each page with the auth role held
// in a mutable holder so we can assert the section appears for club staff
// and stays hidden for the webmaster (who manages 2FA in their own console).
import { act } from "react";
import { createRoot } from "react-dom/client";

const mockAuth = {
  role: "officer",
  clubId: "c1",
  clubName: "Medway",
  logout: jest.fn(),
  updateSession: jest.fn(),
};
const mockSetParams = jest.fn();

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));
jest.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: jest.fn() }),
}));
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(), mockSetParams],
}));

jest.mock("@/lib/api", () => {
  const api = {
    getClubs: jest.fn(),
    getClasses: jest.fn(),
    getSeries: jest.fn(),
    getRaces: jest.fn(),
    scheduledRaces: jest.fn(),
    rrsCodes: jest.fn(),
    getBoats: jest.fn(),
    updateClubSettings: jest.fn(),
    get2faStatus: jest.fn(),
    getSeasons: jest.fn(),
  };
  return { api, formatApiError: (d) => d || "error" };
});
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));

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

const mockApi = require("@/lib/api").api;

import Admin from "./Admin";
import Officer from "./Officer";
import ConsoleNav from "@/components/ConsoleNav";

let container;
let root;
const render = (el) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return container;
};

beforeEach(() => {
  mockApi.getClubs.mockResolvedValue([{ id: "c1", name: "Medway", slug: "medway", race_day_notices: true }]);
  mockApi.getClasses.mockResolvedValue([]);
  mockApi.getSeries.mockResolvedValue([]);
  mockApi.getRaces.mockResolvedValue([]);
  mockApi.scheduledRaces.mockResolvedValue([]);
  mockApi.rrsCodes.mockResolvedValue([]);
  mockApi.getBoats.mockResolvedValue([]);
  mockApi.updateClubSettings.mockResolvedValue({});
  mockApi.get2faStatus.mockResolvedValue({ enabled: false, email: "", has_email: false, methods: ["totp"] });
  mockApi.getSeasons.mockResolvedValue({ years: [2026] });
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
  jest.clearAllMocks();
});

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("Security (2FA) placement", () => {
  it("shows the 2FA settings in the Officer page main section for club staff", async () => {
    mockAuth.role = "officer";
    render(<Officer />);
    await flush();
    const section = container.querySelector('[data-testid="officer-security-section"]');
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("Two-factor authentication");
  });

  it("hides the Officer Security section from the webmaster", async () => {
    mockAuth.role = "webmaster";
    render(<Officer />);
    await flush();
    expect(container.querySelector('[data-testid="officer-security-section"]')).toBeNull();
  });

  it("shows the Security tab in the Admin console for club admins", async () => {
    mockAuth.role = "admin";
    render(<Admin />);
    await flush();
    const tab = container.querySelector('[data-testid="tab-security"]');
    expect(tab).not.toBeNull();
  });

  it("hides the Admin Security tab from the webmaster", async () => {
    mockAuth.role = "webmaster";
    render(<Admin />);
    await flush();
    expect(container.querySelector('[data-testid="tab-security"]')).toBeNull();
  });

  it("no longer renders a Security entry in the console top bar", async () => {
    mockAuth.role = "officer";
    render(
      <ConsoleNav
        items={[{ key: "a", label: "Item", icon: null, testId: "nav-a", onClick: jest.fn() }]}
        onChangedPasscode={jest.fn()}
        logoutTestId="logout-btn"
      />
    );
    await flush();
    expect(container.querySelector('[data-testid="security-btn"]')).toBeNull();
  });
});