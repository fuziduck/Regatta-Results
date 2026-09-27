globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import HelpSidebar, { openHelpSidebar } from "./HelpSidebar";

let mediaMatches = true;
const mockMatchMedia = (query) => ({
  matches: query === "(min-width: 700px) and (min-height: 500px)" && mediaMatches,
  media: query,
  addEventListener() {},
  removeEventListener() {},
});
window.matchMedia = mockMatchMedia;

let container;
let root;

function ResultsPageHarness({ onPageAction }) {
  const [pathname, setPathname] = useState("/club/medway-yacht-club/series/autumn");
  return <>
    <button type="button" data-testid="results-action" onClick={() => {
      onPageAction();
      setPathname("/boat/countdown");
    }}>Open boat results</button>
    <output data-testid="current-path">{pathname}</output>
    <HelpSidebar pathname={pathname} />
  </>;
}
beforeEach(() => {
  mediaMatches = true;
  window.matchMedia = mockMatchMedia;
  window.history.replaceState({}, "", "/officer");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

test("opens contextual page topics with navigation to full guides", () => {
  act(() => root.render(<HelpSidebar />));
  act(() => container.querySelector('[data-testid="help-sidebar-trigger"]').click());
  expect(document.body.textContent).toContain("Race Officer");
  expect(document.body.textContent).toContain("Scheduled races");
  expect(document.body.querySelector('[data-testid="help-open-officer-quick-start"]')).not.toBeNull();
  expect(document.body.querySelector('a[href="/help/quick-start/admin"]')).not.toBeNull();
  expect(document.body.querySelector('a[href="/faq"]')).not.toBeNull();
});

test("pins the contextual help beside the results without dismissing it", () => {
  act(() => root.render(<HelpSidebar />));
  act(() => container.querySelector('[data-testid="help-sidebar-trigger"]').click());
  const pin = document.body.querySelector('[data-testid="help-sidebar-pin"]');
  expect(pin).not.toBeNull();
  act(() => pin.click());
  const pinnedPanel = document.body.querySelector('[data-testid="help-sidebar-pinned"]');
  expect(pinnedPanel).not.toBeNull();
  expect(pinnedPanel.textContent).toContain("Scheduled races");
  expect(document.documentElement.classList.contains("help-sidebar-pinned")).toBe(true);
  act(() => pinnedPanel.querySelector('[data-testid="help-sidebar-pin"]').click());
  expect(document.body.querySelector('[data-testid="help-sidebar-pinned"]')).toBeNull();
  expect(document.documentElement.classList.contains("help-sidebar-pinned")).toBe(false);
});

test("opens and pins the Race Officer quick start in the same sidebar", async () => {
  act(() => root.render(<HelpSidebar />));
  act(() => container.querySelector('[data-testid="help-sidebar-trigger"]').click());
  act(() => document.body.querySelector('[data-testid="help-open-officer-quick-start"]').click());
  expect(document.body.querySelector('[data-testid="officer-quick-start-panel"]')).not.toBeNull();
  expect(document.body.textContent).toContain("0 of 7 complete");
  act(() => document.body.querySelector('[data-testid="help-sidebar-pin"]').click());
  const pinnedPanel = () => document.body.querySelector('[data-testid="help-sidebar-pinned"]');
  expect(pinnedPanel()).not.toBeNull();
  expect(pinnedPanel().textContent).toContain("Race Officer quick start");
  expect(pinnedPanel().querySelector('[data-testid="help-sidebar-pin"]').getAttribute("aria-pressed")).toBe("true");
  expect(document.documentElement.classList.contains("help-sidebar-pinned")).toBe(true);
  act(() => pinnedPanel().querySelector('[data-testid="help-officer-step-0"]').click());
  expect(pinnedPanel().textContent).toContain("1 of 7 complete");
  act(() => pinnedPanel().querySelector('[data-testid="help-sidebar-pin"]').click());
  expect(document.body.querySelector('[data-testid="help-sidebar-pinned"]')).toBeNull();
  expect(document.body.querySelector('[data-testid="help-sidebar"] [data-testid="officer-quick-start-panel"]')).not.toBeNull();
  expect(document.body.querySelector('[data-testid="help-sidebar"] [data-testid="help-sidebar-pin"]').getAttribute("aria-pressed")).toBe("false");
  expect(document.body.querySelector('[data-testid="help-sidebar"] [data-testid="officer-quick-start-panel"]').textContent).toContain("1 of 7 complete");
});

test("stays pinned and usable while navigating from the results behind it", () => {
  const pageAction = jest.fn();
  act(() => root.render(<ResultsPageHarness onPageAction={pageAction} />));
  act(() => container.querySelector('[data-testid="help-sidebar-trigger"]').click());
  act(() => document.body.querySelector('[data-testid="help-open-officer-quick-start"]').click());
  act(() => document.body.querySelector('[data-testid="help-sidebar-pin"]').click());

  const pinnedPanel = document.body.querySelector('[data-testid="help-sidebar-pinned"]');
  expect(pinnedPanel).not.toBeNull();
  const resultsAction = container.querySelector('[data-testid="results-action"]');
  act(() => {
    resultsAction.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    resultsAction.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    resultsAction.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(pageAction).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[data-testid="current-path"]').textContent).toBe("/boat/countdown");
  expect(document.body.querySelector('[data-testid="help-sidebar-pinned"]')).not.toBeNull();
  expect(pinnedPanel.querySelector('[data-testid="help-sidebar-pin"]').getAttribute("aria-pressed")).toBe("true");

  act(() => pinnedPanel.querySelector('[data-testid="help-officer-step-0"]').click());
  expect(pinnedPanel.textContent).toContain("1 of 7 complete");
});

test("opens from the shared Help menu event without a local trigger", () => {
  act(() => root.render(<HelpSidebar showTrigger={false} />));
  expect(document.body.querySelector('[data-testid="help-sidebar"]')).toBeNull();
  act(() => openHelpSidebar());
  expect(document.body.querySelector('[data-testid="help-sidebar"]')).not.toBeNull();
});

test("does not offer pinning on phone-sized layouts", () => {
  mediaMatches = false;
  expect(window.matchMedia("(min-width: 700px) and (min-height: 500px)").matches).toBe(false);
  act(() => root.render(<HelpSidebar />));
  act(() => container.querySelector('[data-testid="help-sidebar-trigger"]').click());
  expect(document.body.querySelector('[data-testid="help-sidebar-pin"]')).toBeNull();
  expect(document.body.querySelector('[data-testid="help-sidebar-pinned"]')).toBeNull();
});

test("matches a new page topic when route changes", () => {
  window.history.replaceState({}, "", "/admin");
  act(() => root.render(<HelpSidebar />));
  act(() => container.querySelector('[data-testid="help-sidebar-trigger"]').click());
  expect(document.body.textContent).toContain("Race Admin");
  expect(document.body.textContent).toContain("Classes");
});
