// The TV display settings offer two choices for what rotates: the full
// rotation or the race-day view. These tests pin that choice and check that
// the selected mode is the one saved.
import { act } from "react";
import { createRoot } from "react-dom/client";
import TvDisplaySettingsCard from "@/components/TvDisplaySettings";
import { api } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  api: {
    getClubs: jest.fn(),
    getClasses: jest.fn(),
    getSeries: jest.fn(),
    getRegattas: jest.fn(),
    updateClubTvConfig: jest.fn(),
  },
}));

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function renderCard(tvConfig) {
  api.getClubs.mockResolvedValue([{ id: "c1", tv_config: tvConfig }]);
  api.getClasses.mockResolvedValue([]);
  api.getSeries.mockResolvedValue([]);
  api.getRegattas.mockResolvedValue([]);
  api.updateClubTvConfig.mockResolvedValue({});

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<TvDisplaySettingsCard clubId="c1" clubSlug="medway" />);
  });
  await act(async () => {
    await flush();
  });
  return { container, root };
}

describe("TvDisplaySettingsCard display modes", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    jest.clearAllMocks();
  });

  it("offers only the full rotation and race-day modes, with the saved mode selected", async () => {
    const { container, root } = await renderCard({ display_mode: "race_day" });

    const full = container.querySelector('[data-testid="tv-mode-full"]');
    const raceDay = container.querySelector('[data-testid="tv-mode-race-day"]');
    expect(full).not.toBeNull();
    expect(raceDay).not.toBeNull();
    expect(raceDay.checked).toBe(true);
    expect(full.checked).toBe(false);

    // The old per-view toggles are gone.
    expect(container.querySelector('[data-testid="tv-toggle-overall"]')).toBeNull();
    expect(container.querySelector('[data-testid="tv-toggle-classes"]')).toBeNull();
    expect(container.querySelector('[data-testid="tv-toggle-latest"]')).toBeNull();
    expect(container.querySelector('[data-testid="tv-toggle-series"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("saves the mode the user picks", async () => {
    const { container, root } = await renderCard({ display_mode: "full" });

    await act(async () => {
      container.querySelector('[data-testid="tv-mode-race-day"]').click();
    });
    await act(async () => {
      container.querySelector('[data-testid="save-tv-config-btn"]').click();
    });
    await act(async () => {
      await flush();
    });

    expect(api.updateClubTvConfig).toHaveBeenCalledTimes(1);
    const [clubId, payload] = api.updateClubTvConfig.mock.calls[0];
    expect(clubId).toBe("c1");
    expect(payload.display_mode).toBe("race_day");

    await act(async () => root.unmount());
  });
});
