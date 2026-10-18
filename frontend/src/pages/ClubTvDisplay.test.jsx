import { act } from "react";
import { createRoot } from "react-dom/client";
import ClubTvDisplay, {
  buildRotationSlides,
  hasRaceDayContent,
  seriesColumnWeights,
  seriesSweepPositionAt,
  TV_POLL_INTERVAL_MS,
} from "./ClubTvDisplay";

let mockParams = { slug: "royal-harbour" };
let mockSearch = new URLSearchParams();

jest.mock("react-router-dom", () => ({
  useParams: () => mockParams,
  useSearchParams: () => [mockSearch, jest.fn()],
}));

jest.mock("@/lib/api", () => ({
  api: {
    getClubTvDisplay: jest.fn(),
  },
}));

const mockApi = require("@/lib/api").api;

const samplePayload = {
  club: {
    id: "club-1",
    name: "Royal Harbour Sailing Club",
    slug: "royal-harbour",
    color: "#0F4C81",
  },
  active_event: {
    title: "Summer Series (2026)",
    year: 2026,
  },
  config: {
    enabled: true,
    rotation_seconds: 15,
    display_mode: "full",
  },
  views: {
    overall: [
      {
        id: "overall-1",
        title: "Sonata Overall Standings",
        subtitle: "2026 Championship",
        class_name: "Sonata",
        scoring_label: "One-Design",
        race_count: 3,
        races: [{ race_number: 1 }, { race_number: 2 }, { race_number: 3 }],
        standings: [
          {
            boat_id: "b1",
            rank: 1,
            boat_name: "Bluebird",
            sail_no: "GBR 8123",
            class_name: "Sonata",
            helm: "Alice Smith",
            races_completed: 3,
            total: 4,
            net: 3,
            scores: [
              { points: 1, code: "FINISHED", discarded: false },
              { points: 2, code: "FINISHED", discarded: true },
              { points: 1, code: "FINISHED", discarded: false },
            ],
          },
          {
            boat_id: "b2",
            rank: 2,
            boat_name: "Tailwind",
            sail_no: "GBR 8456",
            class_name: "Sonata",
            helm: "Bob Jones",
            races_completed: 3,
            total: 6,
            net: 4,
            scores: [
              { points: 2, code: "FINISHED", discarded: false },
              { points: 1, code: "FINISHED", discarded: false },
              { points: 3, code: "FINISHED", discarded: true },
            ],
          },
        ],
      },
    ],
    classes: [
      {
        id: "class-sonata",
        class_id: "c-sonata",
        class_name: "Sonata",
        heading: "Sonata",
        series_name: "Summer Points",
        scoring_label: "One-Design",
        year: 2026,
        race_count: 3,
        standings: [
          {
            boat_id: "b1",
            rank: 1,
            boat_name: "Bluebird",
            sail_no: "GBR 8123",
            helm: "Alice Smith",
            races_completed: 3,
            total: 4,
            net: 3,
          },
        ],
      },
      {
        id: "class-cruiser-irc",
        class_id: "c-cruiser",
        class_name: "Cruiser Fleet",
        heading: "Cruiser Fleet — IRC",
        division_name: "IRC",
        series_name: "Summer Points",
        scoring_label: "IRC",
        year: 2026,
        race_count: 2,
        standings: [
          {
            boat_id: "b3",
            rank: 1,
            boat_name: "Zephyr",
            sail_no: "GBR 901",
            helm: "Charlie Brown",
            races_completed: 2,
            total: 2,
            net: 2,
          },
        ],
      },
    ],
    latest_races: [
      {
        id: "race-latest-1",
        race_id: "r2",
        race_number: 2,
        race_label: "Race 2",
        date: "2026-06-08",
        status: "provisional",
        is_provisional: true,
        class_name: "Sonata",
        series_name: "Summer Points",
        scoring_label: "One-Design",
        results: [
          {
            boat_id: "b2",
            boat_name: "Tailwind",
            sail_no: "GBR 8456",
            class_name: "Sonata",
            helm: "Bob Jones",
            position: 1,
            code: "FINISHED",
            points: 1,
            elapsed_formatted: "49:10",
          },
        ],
      },
    ],
    series_progress: [
      {
        id: "prog-1",
        series_id: "s1",
        series_name: "Summer Points",
        class_name: "Sonata",
        scoring_label: "One-Design",
        completed_races: 3,
        planned_races: 6,
        remaining_races: 3,
        abandoned_races: 0,
        discards: 1,
        next_race_date: "2026-06-15",
        upcoming_races: [{ race_number: 4, date: "2026-06-15" }],
        completed_race_list: [{ race_number: 1, date: "2026-06-01" }],
        standings: [
          {
            boat_id: "b1",
            rank: 1,
            boat_name: "Bluebird",
            sail_no: "GBR 8123",
            helm: "Alice Smith",
            total: 4,
            net: 3,
          },
        ],
      },
    ],
  },
  race_day: {
    title: "Commodore's Regatta Day",
    date: "2026-06-08",
    race_officer: "RO Sarah Jenkins",
    status: "racing",
    courses: "Course B: 1(P) - 2(P) - 4(S), 3 laps",
    course_diagram: "Start -> 1p -> 2p -> 4s -> Finish",
    start_sequence: "10:25 Warning · 10:30 Start",
    schedule: [
      {
        race_id: "r2",
        class_name: "Sonata",
        race_label: "Race 2",
        start_time: "10:30",
        course: "Course B",
        status: "racing",
      },
    ],
    notes: "Keep clear of main shipping channel.",
    life_jackets: true,
    announcements: "Prize giving in clubhouse bar at 16:30.",
    onb_notices: [{ id: "n1", title: "SI Amendment 1", summary: "Mark 4 moved 100m North" }],
  },
};

let container;
let root;

const render = (el) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return container;
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockParams = { slug: "royal-harbour" };
  mockSearch = new URLSearchParams();
  mockApi.getClubTvDisplay.mockResolvedValue(samplePayload);
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
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("series column weights", () => {
  it("gives the series table one column per race plus five, and the race table five", () => {
    expect(seriesColumnWeights(12)).toEqual({ series: 17, race: 5 });
    expect(seriesColumnWeights(3)).toEqual({ series: 8, race: 5 });
    expect(seriesColumnWeights(0)).toEqual({ series: 5, race: 5 });
  });
});

describe("series sweep position", () => {
  it("moves right to the end of the table and back within one slide", () => {
    // 15s slide, 300px of overflow: 2s pause, 5.5s right, 2s pause, 5.5s back.
    expect(seriesSweepPositionAt(0, 300, 15000)).toBe(0);
    expect(seriesSweepPositionAt(4750, 300, 15000)).toBe(150);
    expect(seriesSweepPositionAt(7500, 300, 15000)).toBe(300);
    expect(seriesSweepPositionAt(12250, 300, 15000)).toBe(150);
    expect(seriesSweepPositionAt(16000, 300, 15000)).toBe(0);
  });

  it("does not move when the table fits the panel", () => {
    expect(seriesSweepPositionAt(5000, 0, 15000)).toBe(0);
  });
});

describe("ClubTvDisplay race-day paired slides", () => {
  const raceDayPayload = {
    ...samplePayload,
    config: { ...samplePayload.config, display_mode: "race_day" },
    views: {
      overall: [],
      series_progress: [],
      classes: [
        {
          id: "class-sonata",
          class_id: "c-sonata",
          class_name: "Sonata",
          heading: "Sonata",
          series_name: "Summer Points",
          scoring_label: "One-Design",
          race_count: 3,
          standings: [
            { boat_id: "b1", rank: 1, boat_name: "Bluebird", sail_no: "GBR 8123", total: 4, net: 3 },
            { boat_id: "b2", rank: 2, boat_name: "Tailwind", sail_no: "GBR 8456", total: 6, net: 6 },
          ],
        },
        {
          id: "class-cruiser-irc",
          class_id: "c-cruiser",
          class_name: "Cruiser Fleet",
          division_name: "IRC",
          heading: "Cruiser Fleet — IRC",
          series_name: "Summer Points",
          scoring_label: "IRC",
          race_count: 2,
          standings: [
            { boat_id: "b3", rank: 1, boat_name: "Zephyr", sail_no: "GBR 901", total: 2, net: 2 },
          ],
        },
        {
          id: "class-laser",
          class_id: "c-laser",
          class_name: "Laser",
          heading: "Laser",
          series_name: "Summer Points",
          scoring_label: "One-Design",
          race_count: 3,
          standings: [
            { boat_id: "b4", rank: 1, boat_name: "Gull", sail_no: "GBR 1", total: 3, net: 3 },
          ],
        },
      ],
      latest_races: [
        {
          id: "race-latest-1",
          race_number: 2,
          race_label: "Race 2",
          date: "2026-06-08",
          is_provisional: true,
          class_id: "c-sonata",
          class_name: "Sonata",
          series_name: "Summer Points",
          scoring_label: "One-Design",
          results: [
            { boat_id: "b2", boat_name: "Tailwind", sail_no: "GBR 8456", position: 1, code: "FINISHED", points: 1, elapsed_formatted: "49:10" },
            { boat_id: "b1", boat_name: "Bluebird", sail_no: "GBR 8123", position: 2, code: "FINISHED", points: 2, elapsed_formatted: "50:02" },
          ],
        },
        {
          id: "race-cruiser-1",
          race_number: 2,
          race_label: "Race 2",
          date: "2026-06-08",
          class_id: "c-cruiser",
          division_name: "IRC",
          class_name: "Cruiser Fleet",
          series_name: "Summer Points",
          scoring_label: "IRC",
          results: [
            { boat_id: "b3", boat_name: "Zephyr", sail_no: "GBR 901", position: 1, code: "FINISHED", points: 1 },
          ],
        },
      ],
    },
  };

  it("pairs each raced class with its day result and keeps unpaired classes as class standings", () => {
    const slides = buildRotationSlides(raceDayPayload);
    expect(slides.map((s) => s.viewType)).toEqual(["E", "E", "B"]);
    expect(slides[0].title).toBe("Sonata");
    expect(slides[0].overallRows).toHaveLength(2);
    expect(slides[0].raceRows.map((r) => r.boat_name)).toEqual(["Tailwind", "Bluebird"]);
    expect(slides[1].title).toBe("Cruiser Fleet — IRC");
    expect(slides[1].race.id).toBe("race-cruiser-1");
    expect(slides[2].title).toBe("Laser");
  });

  it("renders overall standings and the day's results side by side on one page", async () => {
    mockApi.getClubTvDisplay.mockResolvedValue(raceDayPayload);
    render(<ClubTvDisplay />);
    await flush();

    expect(container.querySelector('[data-testid="tv-slide-E"]')).not.toBeNull();
    const overall = container.querySelector('[data-testid="tv-overall-panel"]');
    const race = container.querySelector('[data-testid="tv-race-panel"]');
    expect(overall.textContent).toContain("Series Results");
    expect(overall.textContent).toContain("Bluebird");
    expect(race.textContent).toContain("Race 2");
    expect(race.textContent).toContain("Tailwind");
    expect(race.textContent).toContain("Provisional");
  });

  it("shows every race in the series as a column in the first table, with the day's race marked", async () => {
    const seriesPayload = {
      ...raceDayPayload,
      views: {
        ...raceDayPayload.views,
        classes: [
          {
            ...raceDayPayload.views.classes[0],
            races: [{ race_number: 1 }, { race_number: 2 }, { race_number: 3 }],
            standings: [
              {
                boat_id: "b1",
                rank: 1,
                boat_name: "Bluebird",
                sail_no: "GBR 8123",
                total: 4,
                net: 2,
                scores: [
                  { points: 1, code: "FINISHED", discarded: false },
                  { points: 2, code: "FINISHED", discarded: true },
                  { points: 1, code: "FINISHED", discarded: false },
                ],
              },
              {
                boat_id: "b2",
                rank: 2,
                boat_name: "Tailwind",
                sail_no: "GBR 8456",
                total: 5,
                net: 5,
                scores: [
                  { points: 2, code: "FINISHED", discarded: false },
                  { points: 1, code: "FINISHED", discarded: false },
                  { points: 2, code: "FINISHED", discarded: false },
                ],
              },
            ],
          },
          ...raceDayPayload.views.classes.slice(1),
        ],
      },
    };
    mockApi.getClubTvDisplay.mockResolvedValue(seriesPayload);
    render(<ClubTvDisplay />);
    await flush();

    const overall = container.querySelector('[data-testid="tv-overall-table"]');
    const headers = [...overall.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    expect(headers).toEqual(["Pos", "Boat", "Sail", "R1", "R2", "R3", "Total", "Net"]);
    expect(overall.querySelector('th[data-day-race="true"]').textContent.trim()).toBe("R2");

    const bluebird = [...overall.querySelector('[data-testid="tv-overall-row-GBR 8123"]').querySelectorAll("td")].map(
      (td) => td.textContent.trim(),
    );
    expect(bluebird).toEqual(["1", "Bluebird", "GBR 8123", "1", "(2)", "1", "4", "2"]);

    // The day's race table is still shown alongside the series sheet.
    const race = container.querySelector('[data-testid="tv-race-table"]');
    expect(race.textContent).toContain("Tailwind");
  });

  it("sizes the series table by its number of races, so more races make it wider", async () => {
    const races = Array.from({ length: 12 }, (_, i) => ({ race_number: i + 1 }));
    const widePayload = {
      ...raceDayPayload,
      views: {
        ...raceDayPayload.views,
        classes: [
          {
            ...raceDayPayload.views.classes[0],
            races,
            standings: [
              {
                boat_id: "b1",
                rank: 1,
                boat_name: "Bluebird",
                sail_no: "GBR 8123",
                total: 12,
                net: 12,
                scores: races.map(() => ({ points: 1, code: "FINISHED", discarded: false })),
              },
            ],
          },
        ],
      },
    };
    mockApi.getClubTvDisplay.mockResolvedValue(widePayload);
    render(<ClubTvDisplay />);
    await flush();

    const grid = container.querySelector('[data-testid="tv-slide-grid"]');
    expect(grid.dataset.seriesColumns).toBe("17");
    expect(grid.dataset.raceColumns).toBe("5");
  });

  it("keeps a wide series table inside a scroll container so every race column can be reached", async () => {
    const races = Array.from({ length: 12 }, (_, i) => ({ race_number: i + 1 }));
    const wideRows = [
      {
        boat_id: "b1",
        rank: 1,
        boat_name: "Bluebird",
        sail_no: "GBR 8123",
        total: 12,
        net: 12,
        scores: races.map(() => ({ points: 1, code: "FINISHED", discarded: false })),
      },
    ];
    const widePayload = {
      ...raceDayPayload,
      views: {
        ...raceDayPayload.views,
        classes: [{ ...raceDayPayload.views.classes[0], races, standings: wideRows }],
      },
    };
    mockApi.getClubTvDisplay.mockResolvedValue(widePayload);
    render(<ClubTvDisplay />);
    await flush();

    expect(
      container.querySelector('[data-testid="tv-series-scroll"] [data-testid="tv-overall-table"]'),
    ).not.toBeNull();
  });

  it("shows elapsed and corrected times for a handicap race, in corrected finishing order", async () => {
    const handicapPayload = {
      ...raceDayPayload,
      views: {
        ...raceDayPayload.views,
        classes: [raceDayPayload.views.classes[1]],
        latest_races: [
          {
            id: "race-irc-1",
            race_number: 3,
            race_label: "Race 3",
            date: "2026-06-08",
            class_id: "c-cruiser",
            division_name: "IRC",
            class_name: "Cruiser Fleet",
            series_name: "Summer Points",
            scoring_label: "IRC",
            scoring_mode: "irc",
            results: [
              { boat_id: "b5", boat_name: "Slowpoke", sail_no: "GBR 5", position: 1, code: "FINISHED", elapsed_formatted: "52:00", corrected_formatted: "47:10" },
              { boat_id: "b6", boat_name: "Racer", sail_no: "GBR 6", position: 2, code: "FINISHED", elapsed_formatted: "50:00", corrected_formatted: "49:30" },
            ],
          },
        ],
      },
    };
    mockApi.getClubTvDisplay.mockResolvedValue(handicapPayload);
    render(<ClubTvDisplay />);
    await flush();

    const race = container.querySelector('[data-testid="tv-race-panel"]');
    const headers = [...race.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Elapsed", "Corrected"]));
    expect(headers.join(" ")).not.toContain("Pts");
    const names = [...race.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("td:nth-child(2)").textContent);
    expect(names).toEqual(["Slowpoke", "Racer"]);
    expect(race.textContent).toContain("47:10");
    expect(race.textContent).toContain("49:30");
  });

  it("shows elapsed and corrected time for a YTC race, not a points column", async () => {
    const ytcPayload = {
      ...raceDayPayload,
      views: {
        ...raceDayPayload.views,
        classes: [
          {
            id: "class-cruiser-ytc",
            class_id: "c-cruiser",
            class_name: "Cruiser Fleet",
            division_name: "YTC",
            heading: "Cruiser Fleet — YTC",
            series_name: "Summer Points",
            scoring_label: "YTC",
            race_count: 2,
            standings: [
              { boat_id: "b7", rank: 1, boat_name: "Mistral", sail_no: "GBR 7", total: 2, net: 2 },
            ],
          },
        ],
        latest_races: [
          {
            id: "race-cruiser-ytc-1",
            race_number: 3,
            race_label: "Race 3",
            date: "2026-06-08",
            class_id: "c-cruiser",
            division_name: "YTC",
            class_name: "Cruiser Fleet",
            series_name: "Summer Points",
            scoring_label: "YTC",
            scoring_mode: "ytc",
            shows_times: true,
            results: [
              { boat_id: "b7", boat_name: "Mistral", sail_no: "GBR 7", position: 1, code: "FINISHED", elapsed_formatted: "1:05:00", corrected_formatted: "1:10:39" },
              // No YTC number on this boat yet: the columns stay, the cell is blank.
              { boat_id: "b8", boat_name: "Zephyr", sail_no: "GBR 8", position: 2, code: "FINISHED", elapsed_formatted: "1:02:00" },
            ],
          },
        ],
      },
    };
    mockApi.getClubTvDisplay.mockResolvedValue(ytcPayload);
    render(<ClubTvDisplay />);
    await flush();

    const race = container.querySelector('[data-testid="tv-race-panel"]');
    const headers = [...race.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Elapsed", "Corrected"]));
    expect(headers.join(" ")).not.toContain("Pts");
    expect(race.textContent).toContain("1:10:39");
    expect(race.textContent).toContain("1:02:00");
  });

  it("keeps the YTC timing columns on the latest-race slide even with no corrected time yet", async () => {
    const ytcPayload = {
      ...samplePayload,
      views: {
        overall: [],
        classes: [],
        series_progress: [],
        latest_races: [
          {
            id: "race-ytc-2",
            race_number: 4,
            race_label: "Race 4",
            date: "2026-06-15",
            class_name: "Cruiser Fleet",
            series_name: "Summer Points",
            scoring_label: "YTC",
            scoring_mode: "ytc",
            shows_times: true,
            results: [
              { boat_id: "b7", boat_name: "Mistral", sail_no: "GBR 7", helm: "Diana Prince", position: 1, code: "FINISHED", elapsed_formatted: "1:05:00" },
            ],
          },
        ],
      },
    };
    mockApi.getClubTvDisplay.mockResolvedValue(ytcPayload);
    render(<ClubTvDisplay />);
    await flush();

    const table = container.querySelector('[data-testid="tv-latest-race-table"]');
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent);
    // Both time columns are there even though this race has no corrected value yet.
    expect(headers).toEqual(expect.arrayContaining(["Elapsed", "Corrected"]));
    expect(table.textContent).toContain("1:05:00");
  });

  it("shows a racing calendar summary in the race-day panel when calendar data is present", async () => {
    mockApi.getClubTvDisplay.mockResolvedValue({
      ...raceDayPayload,
      race_day: {
        calendar: [
          {
            date: "2099-01-01",
            races: [
              { series_name: "Summer Points", class_name: "Sonata", race_number: 2 },
              { series_name: "Cruiser Winter", class_name: "Cruiser Fleet", race_number: 1 },
            ],
          },
        ],
      },
    });
    render(<ClubTvDisplay />);
    await flush();

    const section = container.querySelector('[data-testid="tv-calendar-section"]');
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("Racing Calendar");
    const days = container.querySelectorAll('[data-testid="tv-calendar-day"]');
    expect(days).toHaveLength(1);
    expect(days[0].textContent).toContain("Sonata R2");
    expect(days[0].textContent).toContain("Cruiser Fleet R1");
  });

  it("drops the race-day side column when every section switch is off", async () => {
    mockApi.getClubTvDisplay.mockResolvedValue({
      ...samplePayload,
      config: {
        ...samplePayload.config,
        show_status: false,
        show_race_officer: false,
        show_courses: false,
        show_schedule: false,
        show_notes: false,
        show_announcements: false,
        show_calendar: false,
      },
      race_day: { title: "Sunday Racing", date: "2026-06-08" },
    });
    render(<ClubTvDisplay />);
    await flush();

    expect(container.querySelector('[data-testid="tv-race-day-panel"]')).toBeNull();
    expect(container.querySelector('[data-testid="tv-primary-results-area"]').className).toContain("col-span-1");
  });

  it("hides the calendar section and reports no race-day content when every section is switched off", async () => {
    // Shape the backend returns when all show_* switches are off: the
    // switched sections are blank, and the title is not switch-controlled.
    const blanked = {
      title: "",
      race_officer: "",
      status: "",
      courses: "",
      live_courses: [],
      course_diagram: "",
      start_sequence: "",
      schedule: [],
      notes: "",
      live_notes: [],
      life_jackets: false,
      announcements: "",
      onb_notices: [],
      calendar: [],
    };
    expect(hasRaceDayContent(blanked, { display_mode: "race_day" })).toBe(false);

    mockApi.getClubTvDisplay.mockResolvedValue({
      ...raceDayPayload,
      config: { ...raceDayPayload.config, show_calendar: false },
      race_day: blanked,
    });
    render(<ClubTvDisplay />);
    await flush();

    expect(container.querySelector('[data-testid="tv-calendar-section"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="tv-calendar-day"]')).toHaveLength(0);
  });
});

describe("ClubTvDisplay rotation & rendering", () => {
  it("builds rotation slides in order A -> B -> C -> D and skips empty views", () => {
    const slides = buildRotationSlides(samplePayload);
    expect(slides.map((s) => s.viewType)).toEqual(["A", "B", "B", "C", "D"]);
    expect(slides[0].title).toBe("Sonata Overall Standings");
    expect(slides[1].title).toBe("Sonata");
    expect(slides[2].title).toBe("Cruiser Fleet — IRC");
    expect(slides[3].isProvisional).toBe(true);
    expect(slides[4].categoryLabel).toBe("Series Progress");
  });

  it("paginates large competitor tables but keeps the configured time on every page", () => {
    const manyBoats = Array.from({ length: 14 }, (_, i) => ({
      boat_id: `b-${i + 1}`,
      rank: i + 1,
      boat_name: `Boat ${i + 1}`,
      sail_no: `GBR ${100 + i}`,
      total: i + 1,
      net: i + 1,
    }));
    const payload = {
      ...samplePayload,
      config: { ...samplePayload.config, rotation_seconds: 15, display_mode: "full" },
      views: {
        overall: [{ id: "ov-big", title: "Big Fleet", standings: manyBoats }],
        classes: [],
        latest_races: [],
        series_progress: [],
      },
    };
    const slides = buildRotationSlides(payload, 10);
    expect(slides).toHaveLength(2);
    expect(slides[0].pageIndex).toBe(1);
    expect(slides[0].pageCount).toBe(2);
    expect(slides[0].rows).toHaveLength(10);
    expect(slides[1].pageIndex).toBe(2);
    expect(slides[1].rows).toHaveLength(4);
    // The configured seconds are exact: a 15s setting is 15s on every slide,
    // so the bottom label matches what the admin set.
    expect(slides.length).toBeGreaterThan(1);
    expect(slides.every((s) => s.durationMs === 15000)).toBe(true);
  });

  it("opens on Overall Standings (View A) by default and displays persistent race-day panel", async () => {
    render(<ClubTvDisplay />);
    await flush();

    expect(container.querySelector('[data-testid="tv-club-name"]').textContent).toBe(
      "Royal Harbour Sailing Club"
    );
    expect(container.querySelector('[data-testid="tv-slide-A"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tv-leader-banner"]').textContent).toContain("Bluebird");
    expect(container.querySelector('[data-testid="tv-podium-badge-1"]').textContent).toBe("1");

    // Persistent race-day panel
    const panel = container.querySelector('[data-testid="tv-race-day-panel"]');
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain("Commodore's Regatta Day");
    expect(panel.textContent).toContain("RO Sarah Jenkins");
    expect(panel.textContent).toContain("Course B: 1(P) - 2(P) - 4(S), 3 laps");
    expect(panel.textContent).toContain("Prize giving in clubhouse bar at 16:30.");
    expect(container.querySelector('[data-testid="tv-life-jackets-alert"]')).not.toBeNull();
  });

  it("automatically rotates through Views A -> B -> C -> D and shows provisional banner on View C", async () => {
    render(<ClubTvDisplay />);
    await flush();

    // Starts on View A
    expect(container.querySelector('[data-testid="tv-slide-A"]')).not.toBeNull();

    // Advance 15s -> View B (Sonata)
    await act(async () => {
      jest.advanceTimersByTime(15100);
    });
    expect(container.querySelector('[data-testid="tv-slide-B"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tv-slide-title"]').textContent).toBe("Sonata");

    // Advance 15s -> View B (Cruiser Fleet — IRC)
    await act(async () => {
      jest.advanceTimersByTime(15100);
    });
    expect(container.querySelector('[data-testid="tv-slide-title"]').textContent).toBe("Cruiser Fleet — IRC");

    // Advance 15s -> View C (Latest Race - Provisional)
    await act(async () => {
      jest.advanceTimersByTime(15100);
    });
    expect(container.querySelector('[data-testid="tv-slide-C"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tv-provisional-banner"]')).not.toBeNull();

    // Advance 15s -> View D (Series Progress)
    await act(async () => {
      jest.advanceTimersByTime(15100);
    });
    expect(container.querySelector('[data-testid="tv-slide-D"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tv-progress-completed"]').textContent).toBe("3");
  });

  it("retains last retrieved results and current slide when a background poll fails", async () => {
    render(<ClubTvDisplay />);
    await flush();

    // Move to second slide (View B)
    await act(async () => {
      jest.advanceTimersByTime(15100);
    });
    expect(container.querySelector('[data-testid="tv-slide-title"]').textContent).toBe("Sonata");

    // Next background poll fails
    mockApi.getClubTvDisplay.mockRejectedValueOnce(new Error("Network error"));
    await act(async () => {
      jest.advanceTimersByTime(TV_POLL_INTERVAL_MS);
    });
    await flush();

    // Still showing results + offline warning badge
    expect(container.querySelector('[data-testid="tv-standings-table"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tv-connection-warning"]')).not.toBeNull();
  });

  it("shows empty state when no results are published yet", async () => {
    mockApi.getClubTvDisplay.mockResolvedValueOnce({
      ...samplePayload,
      views: { overall: [], classes: [], latest_races: [], series_progress: [] },
      race_day: {},
    });
    render(<ClubTvDisplay />);
    await flush();

    expect(container.querySelector('[data-testid="tv-empty-results"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tv-race-day-panel"]')).toBeNull();
  });

  it("does not show rotation controls or advance when there is only one view", async () => {
    mockApi.getClubTvDisplay.mockResolvedValueOnce({
      ...samplePayload,
      views: { overall: [samplePayload.views.overall[0]], classes: [], latest_races: [], series_progress: [] },
      race_day: {},
    });
    render(<ClubTvDisplay />);
    await flush();

    const title = container.querySelector('[data-testid="tv-slide-title"]').textContent;
    expect(container.querySelector('[data-testid="tv-progress-bar"]')).toBeNull();
    expect(container.querySelector('[data-testid="tv-rotation-indicators"]')).toBeNull();
    expect(container.textContent).not.toContain("Auto-rotating");

    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(container.querySelector('[data-testid="tv-slide-title"]').textContent).toBe(title);
  });

  it("bounds the club logo in the header so any uploaded icon stays small", async () => {
    mockApi.getClubTvDisplay.mockResolvedValueOnce({
      ...samplePayload,
      club: { ...samplePayload.club, icon: "data:image/png;base64,iVBORw0KGgo=" },
    });
    render(<ClubTvDisplay />);
    await flush();

    const logo = container.querySelector('[data-testid="tv-club-logo"]');
    expect(logo).not.toBeNull();
    expect(logo.className).toContain("h-12");
    expect(logo.className).toContain("max-w-[10rem]");
    expect(logo.className).toContain("object-contain");
    expect(logo.className).not.toContain("h-13");
  });

  it("shows race-day panel only when race-day fields are populated", () => {
    expect(hasRaceDayContent({}, { display_mode: "full" })).toBe(false);
    expect(hasRaceDayContent(null, { display_mode: "race_day" })).toBe(false);
    // A title alone is not a section, so it does not keep the side column.
    expect(hasRaceDayContent({ title: "Sunday Racing" }, { display_mode: "race_day" })).toBe(false);
    // Content only counts while its section switch is on.
    expect(hasRaceDayContent({ courses: "Course A" }, { show_courses: true })).toBe(true);
    expect(hasRaceDayContent({ courses: "Course A" }, { show_courses: false })).toBe(false);
  });
});
