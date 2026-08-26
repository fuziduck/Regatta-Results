// Single-race console (RaceConsole): each finish button carries the same
// non-finish outcome-code dropdown as the mini-series batch page, so the
// officer can score a boat DNF/DSQ/OCS/RET… straight from the finish grid.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("@/lib/api", () => {
  const api = {
    getRace: jest.fn(),
    getBoats: jest.fn(),
    getRaces: jest.fn(),
    selectBoats: jest.fn(),
    adjustResult: jest.fn(),
  };
  return { api, formatApiError: (d) => d || "error" };
});
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() } }));

// Radix select stays out of jsdom — mimic it inline: the trigger renders its
// props (so data-testids land on a button) and every SelectItem fires
// onValueChange when clicked.
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

import { RaceConsole } from "./Officer";

const mockApi = require("@/lib/api").api;

let container;
let root;
const race = {
  id: "r1", race_number: 1, date: "2026-05-02", start_time: "10:30", class_id: "cl1",
  series_id: "s1", status: "setup", version: 3, course: "", special_rules: "", life_jackets: false,
  results: [
    { boat_id: "b1", code: "DNS", position: null, finish_time: null },
    { boat_id: "b2", code: "DNS", position: null, finish_time: null },
  ],
};

beforeEach(() => {
  mockApi.getRace.mockResolvedValue(race);
  mockApi.getBoats.mockResolvedValue([
    { id: "b1", name: "Bluebell", sail_no: "1" },
    { id: "b2", name: "Screwloose", sail_no: "2" },
  ]);
  mockApi.getRaces.mockResolvedValue([]);
  mockApi.selectBoats.mockResolvedValue({});
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
  jest.clearAllMocks();
});

const renderConsole = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <RaceConsole
        raceId="r1"
        meta={{ class_id: "cl1", class_name: "Sonata", series_name: "Summer" }}
        series={null}
        clubId="c1"
        onBack={jest.fn()}
        rrsCodes={[]}
        dayRaces={[]}
        raceDayNotices={false}
      />
    );
  });
  return container;
};

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("RaceConsole finish buttons", () => {
  it("shows a non-finish outcome dropdown under every finish button", async () => {
    renderConsole();
    await flush();
    expect(container.querySelector('[data-testid="finish-btn-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="finish-btn-2"]')).not.toBeNull();
    // Each button carries the outcome-code menu (DNF, DSQ, OCS…).
    expect(container.querySelectorAll('[data-testid^="finish-code-"]').length).toBe(2);
    expect(container.textContent).toContain("DNF");
  });

  it("scores a non-finish outcome (DNF) straight from the finish grid", async () => {
    renderConsole();
    await flush();
    act(() => {
      container.querySelector('[data-testid="finish-code-1"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container.querySelector('[data-testid="select-item-DNF"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(mockApi.adjustResult).toHaveBeenCalledWith("r1", "b1", { code: "DNF" }, 3);
  });
});
