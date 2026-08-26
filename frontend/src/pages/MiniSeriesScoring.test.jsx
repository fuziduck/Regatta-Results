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
    selectBoats: jest.fn(),
    setStatus: jest.fn(),
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
  mockApi.addMiniRace.mockResolvedValue({
    group: { name: "Day", race_numbers: [1, 2, 3], discards: 0, scoring: "combined" },
    race: { id: "r3", race_number: 3, mini_group_label: "R1C", mini_group_id: 0 },
  });
  mockApi.selectBoats.mockResolvedValue({});
  mockApi.setStatus.mockResolvedValue({});
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

  it("shows the races as a timeline with per-race steps in order", async () => {
    renderPage();
    await act(async () => {});
    // 2 races → the timeline is pre-shown with both steps and connectors.
    const timeline = container.querySelector('[data-testid="race-timeline"]');
    expect(timeline).not.toBeNull();
    expect(container.querySelector('[data-testid="timeline-race-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="timeline-race-2"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="timeline-race-"]').length).toBe(2);
    // Statuses: R1 published, R2 pending → "Published" and "Score now".
    expect(container.querySelector('[data-testid="timeline-race-1"]').textContent).toContain("Published");
    expect(container.querySelector('[data-testid="timeline-race-2"]').textContent).toContain("Score now");
    // The next-race cue guides the officer race 1 → race 2.
    const nextBtn = container.querySelector('[data-testid="next-race-btn-1"]');
    expect(nextBtn).not.toBeNull();
    expect(nextBtn.textContent).toContain("R1B");
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

  it("shows the 3-step workflow banner and the fleet sign-on section", async () => {
    renderPage();
    await act(async () => {});
    expect(container.querySelector('[data-testid="workflow-steps"]')).not.toBeNull();
    expect(container.textContent).toContain("Sign on the fleet");
    expect(container.textContent).toContain("Score each race");
    expect(container.textContent).toContain("Publish results");
    // Fleet chips seeded from race 1's racing boats (both boats) with a count.
    expect(container.querySelector('[data-testid="fleet-boat-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="fleet-boat-2"]')).not.toBeNull();
    expect(container.textContent).toContain("2 of 2 boats");
  });

  it("applies the fleet selection to every unpublished race", async () => {
    renderPage();
    await act(async () => {});
    const apply = container.querySelector('[data-testid="fleet-apply-btn"]');
    expect(apply).not.toBeNull();
    act(() => apply.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    // r1 is published (skipped), r2 is setup — signed on with both boats.
    expect(mockApi.selectBoats).toHaveBeenCalledTimes(1);
    expect(mockApi.selectBoats).toHaveBeenCalledWith("r2", ["b1", "b2"], 1);
    // The page refreshes the group's races afterwards.
    expect(mockApi.getRaces).toHaveBeenCalled();
  });

  it("auto-expands unpublished race cards so scoring controls are visible", async () => {
    renderPage();
    await act(async () => {});
    // Race 2 is unpublished — its boat-selection controls show without clicking.
    expect(container.textContent).toContain("Boats racing");
    expect(container.querySelector('[data-testid="batch-race-2"]').textContent).toContain("Boats racing");
  });

  it("recalls a published race back to setup (like the main-series console)", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await act(async () => {});
    // Race 1 is published — the recall button sits in its card header.
    const recallBtn = container.querySelector('[data-testid="recall-btn-1"]');
    expect(recallBtn).not.toBeNull();
    expect(recallBtn.textContent).toContain("Recall");
    act(() => recallBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockApi.setStatus).toHaveBeenCalledWith("r1", "setup", 2);
    // The card refreshes to the recalled race afterwards.
    expect(mockApi.getRace).toHaveBeenCalledWith("r1");
    confirmSpy.mockRestore();
  });

  it("shows a Scored badge once every racing boat has finished", async () => {
    // Race 2 has both boats finished but is not yet published → "Scored".
    mockApi.getRace.mockImplementation(async (id) => {
      if (id === "r2") {
        return {
          id: "r2", race_number: 2, mini_group_label: "R1B", date: "2026-05-02", start_time: "11:30", class_id: "cl1", status: "setup", version: 1,
          results: [
            { boat_id: "b1", code: "FINISHED", position: 1, finish_time: "2026-05-02T11:45:00Z" },
            { boat_id: "b2", code: "FINISHED", position: 2, finish_time: "2026-05-02T11:46:00Z" },
          ],
        };
      }
      return races.find((r) => r.id === id);
    });
    renderPage();
    await act(async () => {});
    expect(container.querySelector('[data-testid="batch-race-2"]').textContent).toContain("Scored");
  });
});

// Keeps the Officer import exercised (it is the module that exports the page).
describe("Officer module", () => {
  it("is importable", () => {
    expect(typeof Officer).toBe("function");
  });
});
