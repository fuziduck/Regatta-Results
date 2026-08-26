// BoatSearchBox: the prominent boat search embedded in the landing heroes.
// Typing 2+ characters runs the fleet search live (debounced) and drops down
// matches that link to each boat's career page, plus a footer link to the
// full /boats search page.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}));
// react-scripts sets resetMocks:true, so implementations must be attached in
// beforeEach, never in the factory.
jest.mock("@/lib/api", () => {
  const api = { fleetSearch: jest.fn() };
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

beforeEach(() => {
  mockApi.fleetSearch.mockResolvedValue([
    { fleet_id: "f1", name: "Watersong", sail_no: "8420", clubs: ["Medway Yacht Club"], classes: ["Sonata"], records: 3 },
    { fleet_id: "f2", name: "Silver Lining", sail_no: "8421", clubs: ["Medway Yacht Club"], classes: ["Sonata"], records: 1 },
  ]);
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
  mockApi.fleetSearch.mockClear();
});

const setNativeValue = (el, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const typeSearch = async (term) => {
  act(() => setNativeValue(container.querySelector('[data-testid="boat-search-input"]'), term));
  // Flush the 300ms debounce + the fleetSearch promise.
  await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
};

describe("BoatSearchBox", () => {
  it("searches once two characters are typed and shows matching boats", async () => {
    renderBox();
    await typeSearch("wa");
    expect(mockApi.fleetSearch).toHaveBeenCalledWith("wa");
    expect(container.querySelector('[data-testid="boat-search-results"]')).not.toBeNull();
    const links = container.querySelectorAll('[data-testid^="boat-result-"]');
    expect(links.length).toBe(2);
    expect(links[0].getAttribute("href")).toBe("/boat/f1");
    expect(links[0].textContent).toContain("Watersong");
    expect(links[0].textContent).toContain("8420");
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
    expect(mockApi.fleetSearch).not.toHaveBeenCalled();
  });

  it("shows an empty state when nothing matches", async () => {
    mockApi.fleetSearch.mockResolvedValue([]);
    renderBox();
    await typeSearch("zzz");
    expect(container.querySelector('[data-testid="boat-search-empty"]')).not.toBeNull();
  });
});
