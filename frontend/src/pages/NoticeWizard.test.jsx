// Notice creation wizard: publication and effective date/time default to the
// moment the notice started being created (captured on mount), so an officer
// uploading a notice never publishes it with an empty or stale timestamp.
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams()],
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ role: "officer", clubId: "c1", clubName: "Medway Yacht Club" }),
}));
jest.mock("@/lib/api", () => {
  const api = {
    noticeMeta: jest.fn(),
    nextNoticeNumber: jest.fn(),
    getNoticeAreas: jest.fn(),
    getClasses: jest.fn(),
    getSeries: jest.fn(),
    getRaces: jest.fn(),
    getClubs: jest.fn(),
    noticeContext: jest.fn(),
    addNoticeArea: jest.fn(),
    createNotice: jest.fn(),
    uploadNotice: jest.fn(),
  };
  return { api, formatApiError: (d) => d || "error" };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import NoticeWizard from "./NoticeWizard";

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

const toLocalDatetime = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

let container;
let root;

beforeEach(() => {
  mockApi.noticeMeta.mockResolvedValue({
    types: [
      {
        key: "notice_to_competitors",
        label: "Notice to Competitors",
        heading: "Notices to Competitors",
        description: "General instructions for competitors.",
        fields: [
          { key: "subject", label: "Subject", kind: "text", required: true },
          { key: "instruction", label: "Instruction", kind: "textarea", required: true },
        ],
      },
    ],
  });
  mockApi.nextNoticeNumber.mockResolvedValue(1);
  mockApi.getNoticeAreas.mockResolvedValue([]);
  mockApi.getClasses.mockResolvedValue([]);
  mockApi.getSeries.mockResolvedValue([]);
  mockApi.getRaces.mockResolvedValue([]);
});

afterEach(async () => {
  if (root) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  document.body.innerHTML = "";
});

const renderWizard = () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<NoticeWizard />));
  return container;
};

// Walk to the "Notice details" step as the uploaded-document method.
const reachDetailsStep = async () => {
  renderWizard();
  await act(async () => {}); // meta catalogue load
  await act(async () => {
    container.querySelector('[data-testid="type-notice_to_competitors"]').click();
    container.querySelector('[data-testid="type-next"]').click();
  });
  await act(async () => {});
  await act(async () => {
    document.getElementById("method-uploaded").click();
    container.querySelector('[data-testid="method-next"]').click();
  });
  await act(async () => {});
};

describe("NoticeWizard — publication/effective date-time defaults", () => {
  it("pre-fills both date-times with the moment creation started", async () => {
    await reachDetailsStep();
    const before = new Date(Date.now() - 2 * 60 * 1000);
    const after = new Date(Date.now() + 2 * 60 * 1000);
    for (const testid of ["field-publication-datetime", "field-effective-datetime"]) {
      const value = container.querySelector(`[data-testid="${testid}"]`).value;
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
      const t = new Date(value).getTime();
      expect(t).toBeGreaterThanOrEqual(new Date(toLocalDatetime(before)).getTime());
      expect(t).toBeLessThanOrEqual(new Date(toLocalDatetime(after)).getTime());
    }
  });

  it("keeps the effective date-time editable alongside the default", async () => {
    await reachDetailsStep();
    const input = container.querySelector('[data-testid="field-effective-datetime"]');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "2026-09-01T09:30");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("2026-09-01T09:30");
  });
});
