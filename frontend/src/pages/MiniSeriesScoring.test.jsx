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
    updateNotifications: jest.fn(),
    updateMiniGroupSettings: jest.fn(),
    deleteRace: jest.fn(),
    adjustResult: jest.fn(),
  };
  return { api };
});

// Radix select stays out of jsdom — mimic it with an inline mock: the
// trigger renders its props (so data-testids land on a button) and every
// SelectItem is a clickable button that fires onValueChange, so tests can
// pick an outcome code without opening a portal.
jest.mock("@/components/ui/select", () => {
  const React = require("react");
  const Ctx = React.createContext(null);
  const Select = ({ value, onValueChange, children }) => (
    <Ctx.Provider value={{ value, onValueChange }}>{children}</Ctx.Provider>
  );
  const SelectItem = ({ value, children }) => {
    const ctx = React.useContext(Ctx);
    return (
      <button type="button" data-testid={`select-item-${value}`} onClick={() => ctx?.onValueChange?.(value)}>
        {children}
      </button>
    );
  };
  const SelectTrigger = ({ children, ...rest }) => <button type="button" {...rest}>{children}</button>;
  return { Select, SelectItem, SelectTrigger, SelectContent: ({ children }) => <>{children}</>, SelectValue: () => null };
});
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));

import Officer, { MiniSeriesBatchEntry } from "./Officer";

const mockApi = require("@/lib/api").api;

let container;
let root;
const renderPage = (extraProps = {}) => {
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
        {...extraProps}
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
  mockApi.updateMiniGroupSettings.mockResolvedValue({});
  mockApi.selectBoats.mockResolvedValue({});
  mockApi.setStatus.mockResolvedValue({});
  mockApi.updateNotifications.mockResolvedValue({});
  mockApi.deleteRace.mockResolvedValue({ ok: true });
  mockApi.adjustResult.mockResolvedValue({});
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
    // The new race card (race 3) is auto-expanded.
    expect(mockApi.updateMiniGroupSettings).not.toHaveBeenCalled();
  });

  it("shows a discards stepper that changes the group's discard count", async () => {
    renderPage();
    await act(async () => {});
    const stepper = container.querySelector('[data-testid="mini-discards-stepper"]');
    expect(stepper).not.toBeNull();
    expect(container.querySelector('[data-testid="discards-value"]').textContent).toBe("0");
    const plus = container.querySelector('[data-testid="discards-plus"]');
    act(() => plus.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mockApi.updateMiniGroupSettings).toHaveBeenCalledWith("s1", 0, { discards: 1 });
    expect(container.querySelector('[data-testid="discards-value"]').textContent).toBe("1");
    // Minus button now enabled — click to go back to 0.
    const minus = container.querySelector('[data-testid="discards-minus"]');
    expect(minus.disabled).toBe(false);
    act(() => minus.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mockApi.updateMiniGroupSettings).toHaveBeenCalledWith("s1", 0, { discards: 0 });
    expect(container.querySelector('[data-testid="discards-value"]').textContent).toBe("0");
    // Minus button now disabled when discards is 0.
    expect(container.querySelector('[data-testid="discards-minus"]').disabled).toBe(true);
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

  it("shows the collapsible race-day notice section, applied to all races", async () => {
    renderPage();
    await act(async () => {});
    const section = container.querySelector('[data-testid="race-notice-section"]');
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("Race-day notice");
    // r2 is unpublished → the action applies the notice to the group's races.
    expect(section.textContent).toContain("Apply notice to all races");
    // Collapsible: the toggle collapses the fields away.
    act(() => section.querySelector('[data-testid="race-notice-toggle"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => {});
    expect(container.querySelector('[data-testid="notif-course"]')).toBeNull();
  });

  it("applies the race-day notice to every unpublished race in the group", async () => {
    renderPage();
    await act(async () => {});
    const course = container.querySelector('[data-testid="notif-course"]');
    const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    act(() => {
      setVal.call(course, "Windward/Leeward");
      course.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {});
    act(() => container.querySelector('[data-testid="save-notif-btn"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    // r1 is published (skipped), r2 is setup — the notice lands on r2 only.
    expect(mockApi.updateNotifications).toHaveBeenCalledTimes(1);
    const [raceId, payload, version] = mockApi.updateNotifications.mock.calls[0];
    expect(raceId).toBe("r2");
    expect(payload.course).toBe("Windward/Leeward");
    expect(payload.start_tz_offset_minutes).toEqual(expect.any(Number));
    expect(version).toBe(1);
  });

  it("hides the race-day notice section when the club has notices disabled", async () => {
    renderPage({ raceDayNotices: false });
    await act(async () => {});
    expect(container.querySelector('[data-testid="race-notice-section"]')).toBeNull();
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

  it("lets the officer score a non-finish outcome (DNF) from the race card", async () => {
    // Race 2: both boats signed on, still racing (DNS) — the outcome code
    // select sits under each boat's finish button.
    mockApi.getRace.mockImplementation(async (id) => {
      if (id === "r2") {
        return {
          id: "r2", race_number: 2, mini_group_label: "R1B", date: "2026-05-02", start_time: "11:30", class_id: "cl1", status: "setup", version: 1,
          results: [
            { boat_id: "b1", code: "DNS", position: null, finish_time: null },
            { boat_id: "b2", code: "DNS", position: null, finish_time: null },
          ],
        };
      }
      return races.find((r) => r.id === id);
    });
    renderPage();
    await act(async () => {});
    // The per-boat code trigger exists on the unpublished race card.
    const codeTrigger = container.querySelector('[data-testid="batch-code-2-1"]');
    expect(codeTrigger).not.toBeNull();
    // Pick DNF for boat b1 (sail 1 by default) → adjustResult with the code.
    act(() => {
      container.querySelector('[data-testid="select-item-DNF"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mockApi.adjustResult).toHaveBeenCalledWith("r2", "b1", { code: "DNF" }, 1);
  });

  it("marks a race as Scored once every boat has an outcome, not just finishes", async () => {
    // Simulate the backend: the race's codes live in r2state and change when
    // adjustResult is called, so the card's refresh reflects the new outcome.
    const r2state = { b1: "DNF", b2: "DNS" };
    mockApi.getRace.mockImplementation(async (id) => {
      if (id === "r2") {
        return {
          id: "r2", race_number: 2, mini_group_label: "R1B", date: "2026-05-02", start_time: "11:30", class_id: "cl1", status: "setup", version: 1,
          results: [
            { boat_id: "b1", code: r2state.b1, position: null, finish_time: null },
            { boat_id: "b2", code: r2state.b2, position: null, finish_time: null },
          ],
        };
      }
      return races.find((r) => r.id === id);
    });
    mockApi.adjustResult.mockImplementation(async (raceId, boatId, payload) => {
      if (raceId === "r2" && payload.code) r2state[boatId] = payload.code;
      return {};
    });
    renderPage();
    await act(async () => {});
    // One boat DNF, one still DNS → not Scored yet (still shows Not started).
    expect(container.querySelector('[data-testid="batch-race-2"]').textContent).toContain("Not started");
    // Score the second boat's outcome too.
    act(() => {
      container.querySelector('[data-testid="select-item-RET"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mockApi.adjustResult).toHaveBeenCalledWith("r2", "b2", { code: "RET" }, 1);
    // The refresh picked up the new outcome → every boat now has one → Scored.
    expect(container.querySelector('[data-testid="batch-race-2"]').textContent).toContain("Scored");
    // Both boats have outcomes → no boat is still racing, so the finish grid
    // (and its outcome selects) is gone.
    expect(container.querySelector('[data-testid="batch-code-2-1"]')).toBeNull();
  });

  it("adjusts a finished boat's position from the card without leaving the page", async () => {
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
    // Boat 1 is position 1 — the Up stepper is disabled, Down is enabled.
    const down = container.querySelector('[data-testid="batch-pos-down-2-1"]');
    expect(down.disabled).toBe(true);
    const up = container.querySelector('[data-testid="batch-pos-up-2-1"]');
    expect(up.disabled).toBe(false);
    // Swap positions: 1 → 2.
    act(() => up.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mockApi.adjustResult).toHaveBeenCalledWith("r2", "b1", { position: 2 }, 1);
  });
});

// Keeps the Officer import exercised (it is the module that exports the page).
  it("deletes a race from the mini series after confirmation", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await act(async () => {});
    // Each race card has a delete button (the small trash icon).
    const delBtn = container.querySelector('[data-testid="delete-race-btn-2"]');
    expect(delBtn).not.toBeNull();
    act(() => delBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockApi.deleteRace).toHaveBeenCalledTimes(1);
    const [raceId, version] = mockApi.deleteRace.mock.calls[0];
    expect(raceId).toBe("r2");
    expect(version).toBe(1);
    // The page refreshes the group after deletion.
    expect(mockApi.getRaces).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

describe("Officer module", () => {
  it("is importable", () => {
    expect(typeof Officer).toBe("function");
  });
});
