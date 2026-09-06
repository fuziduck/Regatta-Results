// BoatSearchBox: the prominent site search embedded in the landing heroes.
// Typing 2+ characters runs the unified search (boats, clubs, series,
// classes) live and drops down grouped matches with type filter tabs, each
// linking to its page.
import { act } from "react";
import { createRoot } from "react-dom/client";

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => mockNavigate,
}));
// react-scripts sets resetMocks:true, so implementations must be attached in
// beforeEach, never in the factory.
jest.mock("@/lib/api", () => {
  const api = { siteSearch: jest.fn() };
  return { api };
});

import BoatSearchBox from "./BoatSearchBox";

const mockApi = require("@/lib/api").api;

let container;
let root;
const renderBox = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<BoatSearchBox />);
  });
  return container;
};

const empty = { clubs: [], classes: [], series: [], boats: [] };

beforeEach(() => {
  mockApi.siteSearch.mockResolvedValue({
    boats: [
      { fleet_id: "f1", name: "Watersong", sail_no: "8420", clubs: ["Medway Yacht Club"], classes: ["Sonata"], records: 3 },
    ],
    clubs: [{ id: "c1", name: "Medway Yacht Club", slug: "medway-yacht-club", classes: 5 }],
    series: [{ id: "s1", name: "Early Spring", year: 2026, class_id: "cl1", class_name: "Sonata", club_name: "Medway Yacht Club", club_slug: "medway-yacht-club" }],
    classes: [{ id: "cl1", name: "Sonata", club_name: "Medway Yacht Club", club_slug: "medway-yacht-club", series: 6 }],
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
  mockApi.siteSearch.mockClear();
  mockNavigate.mockClear();
});

const setNativeValue = (el, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const typeSearch = async (term) => {
  act(() => setNativeValue(container.querySelector('[data-testid="boat-search-input"]'), term));
  // Flush the 300ms debounce + the siteSearch promise.
  await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
};

const input = () => container.querySelector('[data-testid="boat-search-input"]');
const pressKey = (key, init = {}) => {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
};

describe("BoatSearchBox", () => {
  it("searches once two characters are typed and shows all entity types", async () => {
    renderBox();
    await typeSearch("wa");
    expect(mockApi.siteSearch).toHaveBeenCalledWith("wa");
    expect(container.querySelector('[data-testid="boat-search-results"]')).not.toBeNull();
    // Each type renders a section with a linking row.
    expect(container.querySelector('[data-testid="boat-result-f1"]').getAttribute("href")).toBe("/boat/f1");
    expect(container.querySelector('[data-testid="club-result-c1"]').getAttribute("href")).toBe("/club/medway-yacht-club");
    expect(container.querySelector('[data-testid="series-result-s1"]').getAttribute("href")).toBe("/club/medway-yacht-club?class=cl1&series=s1");
    expect(container.querySelector('[data-testid="class-result-cl1"]').getAttribute("href")).toBe("/club/medway-yacht-club?class=cl1");
  });

  it("type tabs filter the results", async () => {
    renderBox();
    await typeSearch("song");
    act(() => {
      container.querySelector('[data-testid="search-tab-clubs"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(container.querySelector('[data-testid="club-result-c1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="boat-result-f1"]')).toBeNull();
    expect(container.querySelector('[data-testid="series-result-s1"]')).toBeNull();
  });

  it("links through to the full boat search page", async () => {
    renderBox();
    await typeSearch("song");
    const allLink = container.querySelector('[data-testid="boat-search-all"]');
    expect(allLink).not.toBeNull();
    expect(allLink.getAttribute("href")).toBe("/boats");
  });

  it("does not search for a single character", async () => {
    renderBox();
    await typeSearch("w");
    expect(mockApi.siteSearch).not.toHaveBeenCalled();
  });

  it("shows an empty state when nothing matches", async () => {
    mockApi.siteSearch.mockResolvedValue(empty);
    renderBox();
    await typeSearch("zzz");
    expect(container.querySelector('[data-testid="boat-search-empty"]')).not.toBeNull();
  });

  it("highlights the first row with ArrowDown and Enter navigates to it", async () => {
    renderBox();
    await typeSearch("wa");
    pressKey("ArrowDown");
    const first = container.querySelector('[data-testid="boat-result-f1"]');
    expect(first.getAttribute("data-highlighted")).toBeDefined();
    expect(input().getAttribute("aria-activedescendant")).toBe(first.id);
    pressKey("Enter");
    expect(mockNavigate).toHaveBeenCalledWith("/boat/f1");
    expect(container.querySelector('[data-testid="boat-search-dropdown"]')).toBeNull();
  });

  it("wraps the highlight across type groups with arrow keys", async () => {
    renderBox();
    await typeSearch("wa");
    // Display order: 1 boat, 1 club, 1 series, 1 class = 4 rows; wrap both ways.
    const ids = () => [...container.querySelectorAll('[data-testid="boat-search-results"] a')].map((a) => a.getAttribute("data-testid"));
    pressKey("ArrowDown"); // from no highlight, opens at the first row (boat)
    expect(container.querySelector('[data-testid="boat-result-f1"]').hasAttribute("data-highlighted")).toBe(true);
    pressKey("ArrowUp"); // wraps backwards to the last row (class)
    expect(ids()[3]).toBe("class-result-cl1");
    expect(container.querySelector('[data-testid="class-result-cl1"]').hasAttribute("data-highlighted")).toBe(true);
    pressKey("ArrowDown"); // wraps forwards back to the first row (boat)
    expect(container.querySelector('[data-testid="boat-result-f1"]').hasAttribute("data-highlighted")).toBe(true);
  });

  it("Enter with no highlight follows the first result", async () => {
    renderBox();
    await typeSearch("wa");
    pressKey("Enter");
    expect(mockNavigate).toHaveBeenCalledWith("/boat/f1");
  });

  it("hovering a row moves the keyboard highlight to it", async () => {
    renderBox();
    await typeSearch("wa");
    act(() => {
      container.querySelector('[data-testid="club-result-c1"]').dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(container.querySelector('[data-testid="club-result-c1"]').hasAttribute("data-highlighted")).toBe(true);
    pressKey("Enter");
    expect(mockNavigate).toHaveBeenCalledWith("/club/medway-yacht-club");
  });

  it("first Escape closes the dropdown, second clears the query", async () => {
    renderBox();
    await typeSearch("wa");
    expect(container.querySelector('[data-testid="boat-search-dropdown"]')).not.toBeNull();
    pressKey("Escape");
    expect(container.querySelector('[data-testid="boat-search-dropdown"]')).toBeNull();
    expect(input().value).toBe("wa");
    pressKey("Escape");
    expect(input().value).toBe("");
  });

  it("a fresh query resets the highlight to nothing", async () => {
    renderBox();
    await typeSearch("wa");
    pressKey("ArrowDown");
    expect(container.querySelector('[data-testid="boat-result-f1"]').hasAttribute("data-highlighted")).toBe(true);
    await typeSearch("so");
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
    pressKey("Enter");
    // New result set (the mock always returns the boat first) — Enter picks row 0.
    expect(mockNavigate).toHaveBeenCalledWith("/boat/f1");
  });

  it("/ and Cmd+K focus the search from anywhere on the page", () => {
    renderBox();
    input().blur();
    const focusSpy = jest.spyOn(input(), "focus");
    const selectSpy = jest.spyOn(input(), "select");
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
    });
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true }));
    });
    expect(focusSpy).toHaveBeenCalledTimes(2);
    expect(selectSpy).toHaveBeenCalledTimes(2);
  });

  it("/ types a literal slash while typing in the input", () => {
    renderBox();
    input().focus();
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    act(() => { input().dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  });
});
