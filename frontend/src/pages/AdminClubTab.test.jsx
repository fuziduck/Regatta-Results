// The club icon and the two notice-board switches used to sit above the tab
// bar, pushing the fleet tables off the first screen. They now live in their
// own "Club" tab, so the default view stays focused — these tests pin that
// arrangement so it can't quietly regress.
import { act } from "react";
import { createRoot } from "react-dom/client";

const mockAuth = {
  role: "admin",
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
  mockApi.getClubs.mockResolvedValue([
    { id: "c1", name: "Medway", slug: "medway", race_day_notices: true, official_notice_board: true },
  ]);
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

// Radix activates a tab on mousedown with the primary button, not on click.
const openTab = async (testId) => {
  const trigger = container.querySelector(`[data-testid="${testId}"]`);
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  await flush();
};

describe("Admin Club tab", () => {
  it("exposes a Club tab in the admin tab bar", async () => {
    render(<Admin />);
    await flush();
    expect(container.querySelector('[data-testid="tab-club"]')).not.toBeNull();
  });

  it("keeps the club icon and notice-board cards out of the default view", async () => {
    render(<Admin />);
    await flush();
    expect(container.querySelector('[data-testid="club-icon-upload"]')).toBeNull();
    expect(container.querySelector('[data-testid="official-notice-board-toggle-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="race-notice-toggle-card"]')).toBeNull();
  });

  it("shows the club icon and both notice-board switches on the Club tab", async () => {
    render(<Admin />);
    await flush();
    await openTab("tab-club");

    const content = container.querySelector('[data-testid="tab-club-content"]');
    expect(content).not.toBeNull();
    expect(content.querySelector('[data-testid="club-icon-upload"]')).not.toBeNull();
    expect(content.querySelector('[data-testid="official-notice-board-toggle-card"]')).not.toBeNull();
    expect(content.querySelector('[data-testid="race-notice-toggle-card"]')).not.toBeNull();
  });

  it("still persists a race-day notice toggle from the Club tab", async () => {
    render(<Admin />);
    await flush();
    await openTab("tab-club");

    const toggle = container.querySelector('[data-testid="race-notice-enabled"]');
    expect(toggle).not.toBeNull();
    await act(async () => {
      toggle.click();
    });
    await flush();

    expect(mockApi.updateClubSettings).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ race_day_notices: false })
    );
  });
});
