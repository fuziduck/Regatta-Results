// A class no longer picks one scoring system: scoring belongs to each series,
// so the class form only names the fleet, its start time and any rating
// divisions. These tests pin that arrangement.
import { act } from "react";
import { createRoot } from "react-dom/client";

const mockAuth = {
  role: "admin",
  clubId: "c1",
  clubName: "Medway",
  logout: jest.fn(),
  updateSession: jest.fn(),
};

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));
jest.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: jest.fn() }),
}));
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
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
    getClubTvConfig: jest.fn(),
    updateClubTvConfig: jest.fn(),
    updateClubRaceDayInfo: jest.fn(),
    regattas: jest.fn(),
    get2faStatus: jest.fn(),
    getSeasons: jest.fn(),
    createClass: jest.fn(),
    updateClass: jest.fn(),
    deleteClass: jest.fn(),
  };
  return { api, formatApiError: (detail) => detail || "error" };
});
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));

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

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const openClasses = async () => {
  const trigger = container.querySelector('[data-testid="tab-classes"]');
  expect(trigger).not.toBeNull();
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  await flush();
};

beforeEach(() => {
  mockApi.getClubs.mockResolvedValue([
    { id: "c1", name: "Medway", slug: "medway", race_day_notices: true, official_notice_board: true },
  ]);
  mockApi.getClasses.mockResolvedValue([
    { id: "cl1", club_id: "c1", name: "Sonata", default_start_time: "10:30", scoring_mode: "one_design" },
    { id: "cl2", club_id: "c1", name: "Cruisers", default_start_time: "11:00", scoring_mode: "irc", divisions: [
      { name: "IRC", scoring_mode: "irc" }, { name: "YTC", scoring_mode: "ytc" }] },
  ]);
  mockApi.getSeries.mockResolvedValue([]);
  mockApi.getRaces.mockResolvedValue([]);
  mockApi.scheduledRaces.mockResolvedValue([]);
  mockApi.rrsCodes.mockResolvedValue([]);
  mockApi.getBoats.mockResolvedValue([]);
  mockApi.updateClubSettings.mockResolvedValue({});
  mockApi.getClubTvConfig.mockResolvedValue({ tv_config: { enabled: true, rotation_seconds: 15 } });
  mockApi.updateClubTvConfig.mockResolvedValue({ tv_config: { enabled: true, rotation_seconds: 20 } });
  mockApi.updateClubRaceDayInfo.mockResolvedValue({ race_day_info: {} });
  mockApi.regattas.mockResolvedValue([]);
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
  jest.clearAllMocks();
});

test("the class form asks for a fleet and its divisions, not a scoring system", async () => {
  render(<Admin />);
  await flush();
  await openClasses();

  const addClass = container.querySelector('[data-testid="add-class-btn"]');
  await act(async () => {
    addClass.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
  await flush();

  // Radix renders the dialog in a portal, outside the container.
  expect(document.querySelector('[data-testid="class-divisions-panel"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="class-name-input"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="class-scoring-input"]')).toBeNull();
});

test("the class table shows rating divisions instead of a single scoring system", async () => {
  render(<Admin />);
  await flush();
  await openClasses();

  const headers = [...container.querySelectorAll("table thead th")].map((th) => th.textContent);
  expect(headers).toContain("Divisions");
  expect(headers).not.toContain("Scoring");

  const split = container.querySelector('[data-testid="class-divisions-Cruisers"]');
  expect(split.textContent).toContain("IRC · IRC");
  expect(split.textContent).toContain("YTC · YTC");
  // A class without divisions names no system at all.
  expect(container.querySelector('[data-testid="class-divisions-Sonata"]').textContent.trim()).toBe("—");
});
