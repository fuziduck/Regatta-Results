// BoatSearchBox: the prominent site search embedded in the landing heroes.
// Typing 2+ characters runs the unified search (boats, clubs, series,
// classes) live and drops down grouped matches with type filter tabs, each
// linking to its page.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
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
});
