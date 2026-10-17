// The TV display settings offer two choices for what rotates: the full
// rotation or the race-day view. These tests pin that choice and check that
// the selected mode is the one saved.
import { act } from "react";
import { createRoot } from "react-dom/client";
import TvDisplaySettingsCard from "@/components/TvDisplaySettings";
import { api } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  api: {
    getClubTvConfig: jest.fn(),
    getClasses: jest.fn(),
    getSeries: jest.fn(),
    updateClubTvConfig: jest.fn(),
  },
}));

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function renderCard(tvConfig, { loadError, series = [] } = {}) {
  if (loadError) api.getClubTvConfig.mockRejectedValue(loadError);
  else api.getClubTvConfig.mockResolvedValue({ tv_config: tvConfig });
  api.getClasses.mockResolvedValue([]);
  api.getSeries.mockResolvedValue(series);
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

describe("TvDisplaySettingsCard series choice", () => {
  const SERIES = [
    { id: "s1", name: "Summer Series", year: 2026, class_id: "k1" },
    { id: "s2", name: "Winter Series", year: 2026, class_id: "k1" },
    { id: "s3", name: "Spring Cup", year: 2026, class_id: "k2" },
  ];

  afterEach(() => {
    document.body.innerHTML = "";
    jest.clearAllMocks();
  });

  it("lists the series as tickboxes in a dropdown and saves every ticked series", async () => {
    const { container, root } = await renderCard(
      { display_mode: "full", active_series_ids: ["s1"] },
      { series: SERIES },
    );

    await act(async () => {
      container.querySelector('[data-testid="tv-active-series-trigger"]').click();
    });
    expect(container.querySelector('[data-testid="tv-series-option-s1"]').checked).toBe(true);
    expect(container.querySelector('[data-testid="tv-series-option-s2"]').checked).toBe(false);

    await act(async () => {
      container.querySelector('[data-testid="tv-series-option-s2"]').click();
    });
    await act(async () => {
      container.querySelector('[data-testid="save-tv-config-btn"]').click();
    });
    await act(async () => {
      await flush();
    });

    const [, payload] = api.updateClubTvConfig.mock.calls[0];
    expect(payload.active_series_ids).toEqual(["s1", "s2"]);
    expect(payload.active_series_id).toBe("s1");

    await act(async () => root.unmount());
  });

  it("says all current-season series are shown when nothing is ticked", async () => {
    const { container, root } = await renderCard({ display_mode: "full" }, { series: SERIES });

    expect(container.querySelector('[data-testid="tv-active-series-trigger"]').textContent).toContain(
      "All current-season series",
    );

    await act(async () => root.unmount());
  });

  it("has no separate regatta selector", async () => {
    const { container, root } = await renderCard({ display_mode: "full" }, { series: SERIES });

    expect(container.querySelector('[data-testid="tv-active-regatta-select"]')).toBeNull();

    await act(async () => root.unmount());
  });
});

describe("TvDisplaySettingsCard race-day section switches", () => {
  const SECTION_KEYS = [
    "show_status",
    "show_race_officer",
    "show_courses",
    "show_schedule",
    "show_notes",
    "show_announcements",
    "show_calendar",
  ];

  const switchState = (container, key) =>
    container.querySelector(`[data-testid="tv-field-${key}"]`).getAttribute("aria-checked");

  afterEach(() => {
    document.body.innerHTML = "";
    jest.clearAllMocks();
  });

  it("says the race-day panel is hidden when every section is off", async () => {
    const off = Object.fromEntries(SECTION_KEYS.map((key) => [key, false]));
    const { container, root } = await renderCard({ display_mode: "full", ...off });

    expect(container.querySelector('[data-testid="tv-race-day-panel-hidden-note"]')).not.toBeNull();

    await act(async () => root.unmount());
  });

  it("renders each section switch from the saved config", async () => {
    const saved = Object.fromEntries(SECTION_KEYS.map((key) => [key, false]));
    const { container, root } = await renderCard({ display_mode: "full", ...saved });

    for (const key of SECTION_KEYS) {
      expect(switchState(container, key)).toBe("false");
    }

    await act(async () => root.unmount());
  });

  it("shows the saved switches for a club that is missing from the public club list", async () => {
    const saved = Object.fromEntries(SECTION_KEYS.map((key) => [key, false]));
    const { container, root } = await renderCard({ display_mode: "full", ...saved });

    for (const key of SECTION_KEYS) {
      expect(switchState(container, key)).toBe("false");
    }

    await act(async () => root.unmount());
  });

  it("does not let Save overwrite stored settings that failed to load", async () => {
    const { container, root } = await renderCard(null, { loadError: new Error("offline") });

    const save = container.querySelector('[data-testid="save-tv-config-btn"]');
    expect(save.disabled).toBe(true);

    await act(async () => root.unmount());
  });

  it("keeps switched-off sections off after save when the server echoes the config", async () => {
    const { container, root } = await renderCard({ display_mode: "full" });
    api.updateClubTvConfig.mockImplementation(async (_clubId, payload) => ({ tv_config: { ...payload } }));

    for (const key of SECTION_KEYS) {
      expect(switchState(container, key)).toBe("true");
      await act(async () => {
        container.querySelector(`[data-testid="tv-field-${key}"]`).click();
      });
      expect(switchState(container, key)).toBe("false");
    }

    await act(async () => {
      container.querySelector('[data-testid="save-tv-config-btn"]').click();
    });
    await act(async () => {
      await flush();
    });

    expect(api.updateClubTvConfig).toHaveBeenCalledTimes(1);
    const [, payload] = api.updateClubTvConfig.mock.calls[0];
    for (const key of SECTION_KEYS) {
      expect(payload[key]).toBe(false);
      expect(switchState(container, key)).toBe("false");
    }

    await act(async () => root.unmount());
  });
});
