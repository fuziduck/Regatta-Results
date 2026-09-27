// The competition category used to be a picker inside the Add series dialog,
// which let a series be created with a category that disagreed with where the
// admin thought they were working. It now comes from the tab you are on:
// Championship and Club Championship hold standalone series, and anything
// belonging to a named competition is set up from the Regattas tab.
import { act } from "react";
import { createRoot } from "react-dom/client";

const mockAuth = { role: "admin", clubId: "c1", clubName: "Medway", logout: jest.fn(), updateSession: jest.fn() };
const mockSetParams = jest.fn();

jest.mock("@/context/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: jest.fn() }) }));
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(), mockSetParams],
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}));

jest.mock("@/lib/api", () => {
  const api = {
    getClubs: jest.fn(),
    getClasses: jest.fn(),
    getSeries: jest.fn(),
    getSeriesDuplicates: jest.fn(),
    getSeriesSnapshots: jest.fn(),
    getSeriesSnapshot: jest.fn(),
    restoreSeriesSnapshot: jest.fn(),
    getRegattas: jest.fn(),
    getRaces: jest.fn(),
    scheduledRaces: jest.fn(),
    rrsCodes: jest.fn(),
    getBoats: jest.fn(),
    createBoat: jest.fn(),
    getSeasons: jest.fn(),
    updateClubSettings: jest.fn(),
    get2faStatus: jest.fn(),
  };
  return { api, formatApiError: (d) => d || "error" };
});
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}
if (!window.PointerEvent) {
  window.PointerEvent = class PointerEventPolyfill extends MouseEvent {
    constructor(type, params = {}) { super(type, params); this.pointerType = params.pointerType || "mouse"; }
  };
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const mockApi = require("@/lib/api").api;

import Admin from "./Admin";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CURRENT_YEAR } from "@/lib/helpers";

// The app wraps every route in TooltipProvider (App.js); the series dialog
// holds a tooltip, so rendering Admin bare would throw when it opens.
const Harness = () => <TooltipProvider delayDuration={200}><Admin /></TooltipProvider>;

const seriesBase = { class_id: "cl1", year: 2026, version: 1, discards: 0, planned_races: 5, included_in_overall: true, scoring_mode: "one_design", lock_status: "open", schedule: [], scoring_config: {} };

// Two club championship series sharing a class, one in a second class, a
// standalone championship series, and one belonging to the "2026 Regatta"
// competition.
const SERIES = [
  { ...seriesBase, id: "s-club", name: "Early Spring", class_id: "cl1", series_type: "club_championship", order: 1 },
  { ...seriesBase, id: "s-club2", name: "Late Spring", class_id: "cl1", series_type: "club_championship", order: 2 },
  { ...seriesBase, id: "s-club3", name: "Cruiser Autumn", class_id: "cl2", series_type: "club_championship", order: 1 },
  { ...seriesBase, id: "s-champ", name: "Open Nationals", class_id: "cl1", series_type: "championship", order: 3 },
  { ...seriesBase, id: "s-reg", name: "2026 Regatta", class_id: "cl1", series_type: "championship", regatta_id: "r1", order: 4 },
];
const REGATTAS = [{
  id: "r1", name: "2026 Regatta", year: 2026, competition_type: "regatta",
  class_count: 1, race_count: 3, lock_status: "open",
  series: [{ id: "s-reg", class_id: "cl1", name: "2026 Regatta" }],
}];

let container;
let root;

const render = (el) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(el); });
  return container;
};

const flush = async (ms = 20) => {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
};

// Radix activates a tab on mousedown with the primary button, not on click.
const openTab = async (testId) => {
  const trigger = container.querySelector(`[data-testid="${testId}"]`);
  expect(trigger).not.toBeNull();
  await act(async () => { trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
  await flush();
};

const query = (testId) => document.querySelector(`[data-testid="${testId}"]`);
const inPage = (testId) => container.querySelector(`[data-testid="${testId}"]`);

beforeEach(() => {
  mockApi.getClubs.mockResolvedValue([{ id: "c1", name: "Medway", slug: "medway" }]);
  mockApi.getClasses.mockResolvedValue([
    { id: "cl1", name: "Sonata", scoring_mode: "one_design" },
    { id: "cl2", name: "Cruiser Class 1", scoring_mode: "irc" },
  ]);
  mockApi.getSeries.mockResolvedValue(SERIES);
  mockApi.getSeriesDuplicates.mockResolvedValue([]);
  mockApi.getSeriesSnapshots.mockResolvedValue([]);
  mockApi.getSeriesSnapshot.mockResolvedValue({});
  mockApi.restoreSeriesSnapshot.mockResolvedValue({ version: 3 });
  mockApi.getRegattas.mockResolvedValue(REGATTAS);
  mockApi.getRaces.mockResolvedValue([]);
  mockApi.scheduledRaces.mockResolvedValue([]);
  mockApi.rrsCodes.mockResolvedValue([]);
  mockApi.getBoats.mockResolvedValue([]);
  mockApi.createBoat.mockResolvedValue({});
  mockApi.getSeasons.mockResolvedValue({ years: [CURRENT_YEAR] });
  mockApi.updateClubSettings.mockResolvedValue({});
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

describe("Admin boat season copying", () => {
  it("copies selected boats into another year while preserving details and shared identity", async () => {
    const sourceBoats = [{
      id: "boat-2025", fleet_id: "shared-fleet", class_id: "cl1", year: CURRENT_YEAR - 1,
      name: "Repeat Offender", sail_no: "GBR 597", helm: "Sailor One", home_club: "Medway",
      active: false, tcc: 0.98, py: 1010, ytc: 1020, division: "IRC", boat_type: "Sigma 33",
    }];
    mockApi.getBoats.mockImplementation(({ year } = {}) => Promise.resolve(year === CURRENT_YEAR - 1 ? sourceBoats : []));
    render(<Admin />);
    await flush();

    await act(async () => { inPage("copy-boats-open").click(); });
    await flush();

    expect(query("copy-boats-from-year").textContent).toContain(String(CURRENT_YEAR - 1));
    expect(query("copy-boats-to-year").textContent).toContain(String(CURRENT_YEAR));
    expect(query("copy-boat-checkbox-boat-2025").checked).toBe(true);
    await act(async () => { query("copy-boats-submit").click(); });
    await flush();

    expect(mockApi.createBoat).toHaveBeenCalledWith({
      name: "Repeat Offender", sail_no: "GBR 597", class_id: "cl1", helm: "Sailor One",
      year: CURRENT_YEAR, active: true, tcc: 0.98, py: 1010, ytc: 1020, division: "IRC",
      boat_type: "Sigma 33", home_club: "Medway", fleet_id: "shared-fleet",
    });
    expect(query("copy-boats-dialog")).toBeNull();
  });

  it("prevents copying a boat already present in the destination season", async () => {
    const source = [
      { id: "boat-copy", fleet_id: "fleet-copy", class_id: "cl1", name: "Copy Me", sail_no: "123", helm: "A", year: CURRENT_YEAR - 1 },
      { id: "boat-existing-source", fleet_id: "fleet-existing", class_id: "cl1", name: "Already There", sail_no: "456", helm: "B", year: CURRENT_YEAR - 1 },
    ];
    const target = [{ id: "boat-existing-target", fleet_id: "fleet-existing", class_id: "cl1", name: "Already There", sail_no: "456", helm: "B", year: CURRENT_YEAR }];
    mockApi.getBoats.mockImplementation(({ year } = {}) => Promise.resolve(year === CURRENT_YEAR - 1 ? source : target));
    render(<Admin />);
    await flush();

    await act(async () => { inPage("copy-boats-open").click(); });
    await flush();

    expect(query("copy-boat-checkbox-boat-copy").checked).toBe(true);
    expect(query("copy-boat-checkbox-boat-existing-source").disabled).toBe(true);
    expect(query("copy-boats-list").textContent).toContain("Already in target season");
  });
});

describe("Admin competition tabs", () => {
  it("defaults boat, championship, club championship, regatta and historic filters to the current year", async () => {
    render(<Admin />);
    await flush();

    expect(mockApi.getBoats).toHaveBeenCalledWith({ year: CURRENT_YEAR, club_id: "c1" });

    await openTab("tab-championship");
    expect(mockApi.getSeries).toHaveBeenCalledWith({ year: CURRENT_YEAR, club_id: "c1" });

    await openTab("tab-club-championship");
    expect(mockApi.getSeries).toHaveBeenCalledWith({ year: CURRENT_YEAR, club_id: "c1" });

    await openTab("tab-regattas");
    expect(mockApi.getRegattas).toHaveBeenCalledWith({ year: CURRENT_YEAR, club_id: "c1" });

    await openTab("tab-historic");
    expect(mockApi.getSeries).toHaveBeenCalledWith({ year: CURRENT_YEAR, club_id: "c1" });
  });

  it("offers a Championship, Club Championship and Regattas tab", async () => {
    render(<Admin />);
    await flush();
    expect(inPage("tab-championship")).not.toBeNull();
    expect(inPage("tab-club-championship")).not.toBeNull();
    expect(inPage("tab-regattas")).not.toBeNull();
    // The old single Series tab is gone.
    expect(inPage("tab-series")).toBeNull();
  });

  it("shows lock and unlock comments in snapshot history", async () => {
    mockApi.getSeriesSnapshots.mockResolvedValue([{
      version: 1, status: "superseded", locked_at: "2026-09-01T10:00:00Z",
      locked_by: "admin@example.com", lock_reason: "Final results approved",
      unlocked_at: "2026-09-02T10:00:00Z", unlocked_by: "admin@example.com",
      unlock_reason: "Correcting a race result", engine_version: "2.2.0",
      scoring_config: { rrs_edition: "RRS 2025-2028" },
    }]);
    render(<Admin />);
    await flush();
    await openTab("tab-club-championship");

    await act(async () => { inPage("snapshots-Early Spring").click(); });
    await flush();

    const dialog = query("snapshots-dialog");
    expect(dialog.textContent).toContain("Lock comment: Final results approved");
    expect(dialog.textContent).toContain("Unlock comment: Correcting a race result");
    expect(dialog.textContent).toContain("by admin@example.com");
  });

  it("previews and restores a preserved snapshot, and has no archive action", async () => {
    const preservedPayload = {
      race_count: 2, planned_races: 2, discards: 0, races: [], schedule: [],
      standings: [{ boat_id: "b1", boat_name: "Boat One", sail_no: "1", helm: "Sailor", rank: 1, total: 2, net: 2, scores: [] }],
    };
    mockApi.getSeriesSnapshots.mockResolvedValue([
      { version: 2, status: "locked", locked_at: "2026-09-03T10:00:00Z", locked_by: "admin", payload_available: true, scoring_config: {} },
      { version: 1, status: "superseded", locked_at: "2026-09-01T10:00:00Z", locked_by: "admin", lock_reason: "Original", payload_available: true, scoring_config: {} },
    ]);
    mockApi.getSeriesSnapshot.mockResolvedValue({ version: 1, payload: preservedPayload });
    render(<Admin />);
    await flush();
    await openTab("tab-club-championship");

    expect(inPage("archive-Early Spring")).toBeNull();
    await act(async () => { inPage("snapshots-Early Spring").click(); });
    await flush();
    expect(query("snapshot-restore-1")).not.toBeNull();

    await act(async () => { query("snapshot-view-1").click(); });
    await flush();
    expect(mockApi.getSeriesSnapshot).toHaveBeenCalledWith("s-club", 1, "c1");
    expect(query("snapshot-preview").textContent).toContain("Preserved version 1 results");
    expect(query("snapshot-preview").textContent).toContain("Boat One");

    await act(async () => { query("snapshot-restore-1").click(); });
    await flush();
    const reason = query("snapshot-restore-reason");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(reason, "Restore approved original results");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { query("snapshot-restore-confirm").click(); });
    await flush();

    expect(mockApi.restoreSeriesSnapshot).toHaveBeenCalledWith("s-club", 1, "Restore approved original results", 1);
    expect(query("snapshot-restore-dialog")).toBeNull();
  });

  it("shows only club championship series on the Club Championship tab", async () => {
    render(<Admin />);
    await flush();
    await openTab("tab-club-championship");

    expect(inPage("series-row-Early Spring")).not.toBeNull();
    expect(inPage("series-row-Open Nationals")).toBeNull();
    // A series belonging to a competition is never listed as a standalone one.
    expect(inPage("series-row-2026 Regatta")).toBeNull();
  });

  it("shows only standalone championship series on the Championship tab", async () => {
    render(<Admin />);
    await flush();
    await openTab("tab-championship");

    expect(inPage("series-row-Open Nationals")).not.toBeNull();
    expect(inPage("series-row-Early Spring")).toBeNull();
    expect(inPage("series-row-2026 Regatta")).toBeNull();
  });

  it("lets an administrator choose multiple scoring systems for one series", async () => {
    render(<Harness />);
    await flush();
    await openTab("tab-club-championship");
    await act(async () => { inPage("add-series-btn").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog.querySelector('[data-testid="series-scoring-irc"]').checked).toBe(false);
    expect(dialog.querySelector('[data-testid="series-scoring-ytc"]').checked).toBe(false);
    await act(async () => {
      dialog.querySelector('[data-testid="series-scoring-one_design"]').click();
      dialog.querySelector('[data-testid="series-scoring-irc"]').click();
      dialog.querySelector('[data-testid="series-scoring-ytc"]').click();
    });
    expect(dialog.querySelector('[data-testid="series-scoring-one_design"]').checked).toBe(false);
    expect(dialog.querySelector('[data-testid="series-scoring-irc"]').checked).toBe(true);
    expect(dialog.querySelector('[data-testid="series-scoring-ytc"]').checked).toBe(true);
    expect(dialog.querySelector('[data-testid="multi-scoring-note"]')).not.toBeNull();

    // Saving the editor submits both configured modes but only one series
    // object/result set; there is no parallel-series creation behavior.
    const nameInput = dialog.querySelector('[data-testid="series-name-input"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(nameInput, "Dual-scored Cruiser Autumn");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mockApi.createSeries = jest.fn().mockResolvedValue({ id: "new-series" });
    expect(dialog.querySelector('[data-testid="save-series-btn"]')).not.toBeNull();
    await act(async () => { dialog.querySelector('[data-testid="save-series-btn"]').click(); });
    await flush();
    expect(mockApi.createSeries).toHaveBeenCalledWith(expect.objectContaining({
      name: "Dual-scored Cruiser Autumn",
      scoring_modes: ["irc", "ytc"],
      scoring_mode: "irc",
    }));
  });

  it("no longer asks for a series type in the Add series dialog", async () => {
    render(<Harness />);
    await flush();
    await openTab("tab-club-championship");
    await act(async () => { inPage("add-series-btn").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();

    const dialog = query("confirm-delete-dialog") ? null : document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    // The category picker (and the competition link that used to sit with it)
    // are gone — the bucket comes from the tab.
    expect(dialog.querySelector('[data-testid^="series-type-"]')).toBeNull();
    expect(dialog.querySelector('[data-testid="series-regatta-input"]')).toBeNull();
    expect(dialog.querySelector('[data-testid="series-bucket-note"]')).not.toBeNull();
    expect(dialog.textContent).toContain("Club Championship");
  });

  it("groups a competition's own series under it on the Regattas tab", async () => {
    render(<Admin />);
    await flush();
    await openTab("tab-regattas");

    const toggle = inPage("regatta-series-2026 Regatta");
    expect(toggle).not.toBeNull();
    await act(async () => { toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await flush();

    const panel = inPage("regatta-series-row-2026 Regatta");
    expect(panel).not.toBeNull();
    expect(panel.querySelector('[data-testid="series-row-2026 Regatta"]')).not.toBeNull();
    // The competition panel can set up new series for the competition.
    expect(panel.querySelector('[data-testid="add-series-btn"]')).not.toBeNull();
  });

  it("groups the series by class, dropping the Class and Mini columns", async () => {
    render(<Admin />);
    await flush();
    await openTab("tab-club-championship");

    const headers = [...container.querySelectorAll("thead th")].map((t) => t.textContent.trim());
    expect(headers).not.toContain("Class");
    expect(headers).not.toContain("Mini");

    // One band per class, ordered by class name, each naming its own count.
    const groups = [...container.querySelectorAll('[data-testid^="series-group-"]')];
    expect(groups.map((g) => g.getAttribute("data-testid")))
      .toEqual(["series-group-Cruiser Class 1", "series-group-Sonata"]);
    expect(groups[0].textContent).toContain("(1 series)");
    expect(groups[1].textContent).toContain("(2 series)");

    // Column count matches the header now that Class and Mini are gone.
    const row = inPage("series-row-Early Spring");
    expect(row.querySelectorAll("td")).toHaveLength(headers.length);

    // Names wrap within a deliberately narrow Series column so the rest of
    // the table remains visible without horizontal scrolling on desktop.
    const seriesHeader = [...container.querySelectorAll("thead th")].find((th) => th.textContent.trim() === "Series");
    expect(seriesHeader.className).toContain("w-32");
    expect(row.cells[1].className).toContain("whitespace-normal");
    expect(row.cells[1].className).toContain("break-words");
    expect(row.cells[1].className).not.toContain("whitespace-nowrap");
  });

  it("keeps a competition's series out of the standalone tabs", async () => {
    render(<Admin />);
    await flush();
    await openTab("tab-championship");
    expect(inPage("series-row-2026 Regatta")).toBeNull();
    await openTab("tab-club-championship");
    expect(inPage("series-row-2026 Regatta")).toBeNull();
  });
});
