// Official Notice Board page: renders the club ONB with a "Subscribe to ONB"
// button (per-club email subscription — new notices are emailed with their
// official PDF attached on publish).
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("react-router-dom", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useParams: () => ({ slug: "medway" }),
}));
jest.mock("@/lib/api", () => {
  const api = { getClubs: jest.fn(), getNoticeBoards: jest.fn(), getNoticeSections: jest.fn() };
  return { api, formatApiError: (d) => d || "error" };
});
jest.mock("@/components/HeaderMenu", () => () => <button type="button" data-testid="header-menu-btn" />);
jest.mock("@/components/NoticeBoard", () => () => <div data-testid="notice-board" />);

import NoticeBoardPage from "./NoticeBoardPage";

const mockApi = require("@/lib/api").api;

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!window.PointerEvent) {
  window.PointerEvent = class PointerEventPolyfill extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerType = params.pointerType || "mouse";
    }
  };
}

let container;
let root;
const renderPage = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<NoticeBoardPage />);
  });
  return container;
};

beforeEach(() => {
  mockApi.getClubs.mockResolvedValue([{ id: "c1", slug: "medway", name: "Medway Yacht Club" }]);
  mockApi.getNoticeBoards.mockResolvedValue([]);
  mockApi.getNoticeSections.mockResolvedValue([]);
});

afterEach(async () => {
  if (root) {
    // Flush the chained club -> board -> sections promises (macrotask) so no
    // state update lands after unmount.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  document.body.innerHTML = "";
  mockApi.getClubs.mockClear();
  mockApi.getNoticeBoards.mockClear();
  mockApi.getNoticeSections.mockClear();
});

describe("Notice Board page — ONB subscription", () => {
  it("renders a Subscribe to ONB button targeting the club", async () => {
    renderPage();
    await act(async () => {});
    const button = container.querySelector('[data-testid="subscribe-notice"]');
    expect(button).not.toBeNull();
    expect(button.textContent).toContain("Subscribe to ONB");
  });

  it("loads the club's notice board after the club resolves", async () => {
    renderPage();
    await act(async () => {});
    await act(async () => {});
    expect(mockApi.getNoticeBoards).toHaveBeenCalledWith({ club_id: "c1" });
    expect(container.querySelector('[data-testid="notice-board"]')).not.toBeNull();
  });
});
