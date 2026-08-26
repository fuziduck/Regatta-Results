// Setting up a scheduled race from the race officer page: clicking "Score now"
// creates the race and opens its results console. Two failure paths are
// covered here — the scheduled slot can be stale (the race was already created
// by another tab/device, so createRace 400s) and the officer must land on the
// existing race's console instead of the click silently doing nothing; and a
// genuine error must surface as a toast, never as an unhandled rejection.
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
    getRace: jest.fn(),
    createRace: jest.fn(),
    get2faStatus: jest.fn(),
  };
  return { api, formatApiError: (d) => d || "error" };
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
const { toast } = require("sonner");

import Officer from "./Officer";

const TODAY = new Date().toISOString().slice(0, 10);

const scheduledItem = (overrides = {}) => ({
  series_id: "s1",
  series_name: "__LIVE_MS__",
  class_id: "c1",
  class_name: "Sonata",
  race_number: 7,
  date: TODAY,
  status: "scheduled",
  race_id: null,
  start_time: "13:50",
  ...overrides,
});

const raceDoc = (id, race_number) => ({
  id,
  date: TODAY,
  class_id: "c1",
  series_id: "s1",
  year: 2026,
  race_number,
  start_time: "13:50",
  start_tz_offset_minutes: 60,
  actual_start: null,
  course: "",
  special_rules: "",
  life_jackets: false,
  status: "setup",
  entries_count: 0,
  results: [],
  created_at: new Date().toISOString(),
  version: 1,
});

let container;
let root;
const render = async (el) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(el);
  });
  // Let the initial load effects (clubs/races/classes/series/scheduled) settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return container;
};

beforeEach(() => {
  mockApi.getClubs.mockResolvedValue([{ id: "c1", name: "Medway", slug: "medway", race_day_notices: true }]);
  mockApi.getClasses.mockResolvedValue([{ id: "c1", name: "Sonata", default_start_time: "13:50" }]);
  mockApi.getSeries.mockResolvedValue([{ id: "s1", name: "__LIVE_MS__", class_id: "c1", year: 2026, planned_races: 8, mini_series: false, mini_series_groups: [] }]);
  mockApi.getRaces.mockResolvedValue([]);
  mockApi.scheduledRaces.mockResolvedValue([]);
  mockApi.rrsCodes.mockResolvedValue([]);
  mockApi.getBoats.mockResolvedValue([]);
  mockApi.getRace.mockResolvedValue(raceDoc("r7", 7));
  mockApi.createRace.mockResolvedValue(raceDoc("r7", 7));
  mockApi.get2faStatus.mockResolvedValue({ enabled: false, email: "", has_email: false, methods: ["totp"] });
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

const clickScheduledRow = async () => {
  const row = container.querySelector('[data-testid="scheduled-Sonata-7"]');
  const btn = row.querySelector("button");
  await act(async () => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Let the async setup chain (createRace → loads → console fetch) settle.
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("setting up a scheduled race (officer page)", () => {
  it("creates the race and opens its results console on the happy path", async () => {
    mockApi.scheduledRaces.mockResolvedValue([scheduledItem()]);
    await render(<Officer />);
    await clickScheduledRow();

    expect(mockApi.createRace).toHaveBeenCalledWith(expect.objectContaining({
      series_id: "s1", race_number: 7, date: TODAY, class_id: "c1",
    }));
    expect(mockApi.getRace).toHaveBeenCalledWith("r7");
  });

  it("opens the existing race when the slot is stale and the race already exists (createRace 400)", async () => {
    // First fetch: slot not created yet. After the failed create, the refresh
    // discovers the race already exists and the officer lands on its console.
    mockApi.scheduledRaces
      .mockResolvedValueOnce([scheduledItem()])
      .mockResolvedValueOnce([scheduledItem({ race_id: "r7", status: "setup" })]);
    mockApi.createRace.mockRejectedValue({
      response: { status: 400, data: { detail: "Race 7 already exists in this series — use the next race number." } },
    });

    await render(<Officer />);
    await clickScheduledRow();

    // No silent failure: the existing race's console opens instead.
    expect(mockApi.getRace).toHaveBeenCalledWith("r7");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows a toast with the backend reason when the race genuinely cannot be set up", async () => {
    mockApi.scheduledRaces.mockResolvedValue([scheduledItem()]);
    mockApi.createRace.mockRejectedValue({
      response: { status: 400, data: { detail: "Race 7 already exists in this series — use the next race number." } },
    });

    await render(<Officer />);
    await clickScheduledRow();

    expect(toast.error).toHaveBeenCalledWith("Race 7 already exists in this series — use the next race number.");
    expect(mockApi.getRace).not.toHaveBeenCalled();
  });
});
