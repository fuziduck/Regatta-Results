import {
  classGroupKey,
  competitionPath,
  competitionTagClass,
  competitionType,
  competitionTypeLabel,
  normalizeSeriesType,
} from "./competition";

describe("competition policy", () => {
  test.each([
    [undefined, "championship"],
    ["club_championship", "club_championship"],
    ["not-a-type", "championship"],
  ])("normalizes series type %s", (input, expected) => {
    expect(normalizeSeriesType(input)).toBe(expected);
  });

  test("linked parent wins over a contradictory child series type", () => {
    expect(competitionType({ series_type: "regatta", competition: { competition_type: "championship" } })).toBe("championship");
    expect(competitionTypeLabel({ series_type: "regatta", competition: { competition_type: "championship", championship_scope: "club" } })).toBe("Club Championship");
  });

  test("standalone legacy series and routes retain safe defaults", () => {
    expect(competitionType({})).toBe("championship");
    expect(competitionPath({ competition_type: "regatta", id: "r1" }, "club")).toBe("/club/club/regatta/r1");
    expect(competitionPath({ competition_type: "championship", id: "c1" }, "club")).toBe("/club/club/competition/c1");
  });

  test.each([
    ["championship", "Championship", "border-amber-300"],
    ["club_championship", "Club Championship", "border-emerald-300"],
    ["regatta", "Regatta", "border-cyan-300"],
  ])("assigns a distinct tag colour to %s", (type, label, colour) => {
    const competition = { series_type: type };
    expect(competitionTypeLabel(competition)).toBe(label);
    expect(competitionTagClass(competition)).toContain(colour);
  });

  test("class grouping ignores case and punctuation", () => {
    expect(classGroupKey(" Sonata One-Design ")).toBe("sonata one design");
    expect(classGroupKey("SONATA.ONE DESIGN")).toBe("sonata one design");
  });
});
