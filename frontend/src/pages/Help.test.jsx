globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot } from "react-dom/client";
import Help from "./Help";
import { FAQS, HELP_TOPICS, QUICK_STARTS, getHelpTopic } from "@/lib/helpContent";

const mockRoute = { guide: undefined };
const mockLocation = { pathname: "/help" };
jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useParams: () => mockRoute,
  useLocation: () => mockLocation,
}));
jest.mock("@/components/HeaderMenu", () => () => <button type="button" data-testid="header-menu-btn" />);
jest.mock("@/components/HelpSidebar", () => () => <button type="button" data-testid="help-sidebar" />);
jest.mock("@/components/Logo", () => () => <span>SailScore</span>);

let container;
let root;
const render = async (guide, pathname) => {
  if (root) act(() => root.unmount());
  mockRoute.guide = guide;
  mockLocation.pathname = pathname || (guide === "faq" ? "/faq" : guide ? `/help/quick-start/${guide}` : "/help");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Help />); });
  return container;
};

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
  container = null;
});

test("provides role-specific interactive checklists with completion progress", async () => {
  const page = await render("officer");
  expect(page.textContent).toContain("Race Officer quick start");
  expect(page.textContent).toContain("0 of 7 complete");
  await act(async () => { page.querySelector('[data-testid="quick-start-step-0"]').click(); });
  expect(page.textContent).toContain("1 of 7 complete");
  expect((await render("admin")).textContent).toContain("Race Admin quick start");
});

test("searches the full FAQ content", async () => {
  const page = await render("faq");
  expect(page.querySelectorAll('[data-testid="faq-question"]').length).toBeGreaterThan(10);
  const input = page.querySelector('[data-testid="faq-search"]');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "mini-series");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(page.querySelectorAll('[data-testid="faq-question"]')).toHaveLength(1);
  expect(page.textContent).toContain("What is a mini-series day?");
});

test("contextual topics cover public, officer, admin, and webmaster routes", () => {
  expect(getHelpTopic("/").id).toBe("directory");
  expect(getHelpTopic("/officer").id).toBe("officer");
  expect(getHelpTopic("/admin").id).toBe("admin");
  expect(getHelpTopic("/webmaster").id).toBe("webmaster");
  expect(HELP_TOPICS.length).toBeGreaterThanOrEqual(10);
  expect(FAQS.length).toBeGreaterThanOrEqual(20);
  expect(QUICK_STARTS.officer.steps.length).toBeGreaterThan(5);
  expect(QUICK_STARTS.admin.steps.length).toBeGreaterThan(5);
});
