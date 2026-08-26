// Mini-series scoring page (MiniSeriesBatchEntry): the officer-facing page for
// scoring all races in a mini series. Covers the combined-result preview and
// the on-the-day "Add race" action.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}));
// react-scripts sets resetMocks:true, so implementations must be attached in
// beforeEach, never in the factory.
jest.mock("@/lib/api", () => {
  const api = {
    getRaces: jest.fn(),
    getRace: jest.fn(),
    getBoats: jest.fn(),
    seriesStandings: jest.fn(),
    addMiniRace: jest.fn(),
  };
  return { api };
});
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));

import Officer, { MiniSeriesBatchEntry } from "./Officer";

const mockApi = require("@/lib/api").api;

let container;
let root;
const renderPage = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <MiniSeriesBatchEntry
        group={{ name: "Day", race_numbers: [1, 2], discards: 0, scoring: "combined" }}
        groupIndex={0}
        seriesId="s1"
        clubId="c1"
        classes={{}}
        seriesMap={{}}
        onClose={jest.fn()}
      />
    );
  });
  return container;
};

const races = [
  { id: "r1", race_number: 1, mini_group_label: "R1A", date: "2026-05-02", start_time: "10:30", class_id: "cl1", status: "published", version: 2, results: [{ boat_id: "b1", code: "FINISHED", position: 1, finish_time: "2026-05-02T10:45:00Z" }, { boat_id: "b2", code: "FINISHED", position: 2, finish_time: "2026-05-02T10:46:00Z" }] },
  { id: "r2", race_number: 2, mini_group_label: "R1B", date: "2026-05-02", start_time: "11:30", class_id: "cl1", status: "setup", version: 1, results: [{ boat_id: "b1", code: "DNC", position: null, finish_time: null }, { boat_id: "b2", code: "DNC", position: null, finish_time: null }] },
];

beforeEach(() => {
  mockApi.getRaces.mockResolvedValue([{ id: "r1", race_number: 1, class_id: "cl1" }, { id: "r2", race_number: 2, class_id: "cl1" }]);
  mockApi.getRace.mockImplementation(async (id) => races.find((r) => r.id === id));
  mockApi.getBoats.mockResolvedValue([
    { id: "b1", name: "Bluebell", sail_no: "1" },
    { id: "b2", name: "Screwloose", sail_no: "2" },
  ]);
  mockApi.seriesStandings.mockResolvedValue({
    races: [{ race_number: 1, mini_name: "Day" }, { race_number: 2 }],
    mini_combined: { discards: 0 },
    standings: [
      { rank: 1, boat_id: "b1", boat_name: "Bluebell", sail_no: "1", scores: [{ points: 1, discarded: false }, { points: 2, discarded: false }], combined_average: 1.5 },
    ],
  });
  mockApi.addMiniRace.mockResolvedValue({
    group: { name: "Day", race_numbers: [1, 2, 3], discards: 0, scoring: "combined" },
    race: { id: "r3", race_number: 3, mini_group_label: "R1C", mini_group_id: 0 },
  });
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
  Object.values(mockApi).forEach((fn) => fn.mockClear());
});

describe("Mini series scoring page", () => {
  it("shows each child race with its parent/child label and a status badge", async () => {
    renderPage();
    await act(async () => {});
    expect(container.querySelector('[data-testid="batch-race-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="batch-race-2"]')).not.toBeNull();
    // Child labels (R1A / R1B) instead of plain numbers.
    expect(container.textContent).toContain("R1A");
    expect(container.textContent).toContain("R1B");
    expect(container.textContent).toContain("Not started");
  });

  it("renders the combined-result preview for combined scoring", async () => {
    renderPage();
    await act(async () => {});
    const preview = container.querySelector('[data-testid="combined-preview"]');
    expect(preview).not.toBeNull();
    expect(preview.textContent).toContain("View combined result");
    expect(preview.textContent).toContain("Bluebell");
    expect(preview.textContent).toContain("1.5"); // daily average
  });

  it("adds a race to the mini series on the day", async () => {
    renderPage();
    await act(async () => {});
    const btn = container.querySelector('[data-testid="add-mini-race-btn"]');
    expect(btn).not.toBeNull();
    act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mockApi.addMiniRace).toHaveBeenCalledWith("s1", 0, {});
    // The page reloads the group's races after adding.
    expect(mockApi.getRaces).toHaveBeenCalled();
  });
});

// Keeps the Officer import exercised (it is the module that exports the page).
describe("Officer module", () => {
  it("is importable", () => {
    expect(typeof Officer).toBe("function");
  });
});
