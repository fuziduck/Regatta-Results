import {
  applyPageMetadata,
  boatProfilePath,
  classProfilePath,
  groupedClassPath,
  raceResultPath,
  seriesResultsPath,
} from "./seo";

describe("public SEO route helpers", () => {
  test("builds stable readable entity URLs", () => {
    expect(boatProfilePath("f/1", "Watersong")).toBe("/boat/f%2F1/watersong");
    expect(classProfilePath("c1", "Sonata One Design")).toBe("/class/c1/sonata-one-design");
    expect(groupedClassPath("Sonata One-Design")).toBe("/class/group/sonata%20one%20design/sonata-one-design");
    expect(seriesResultsPath("myc", "s1", "Summer Series", 2026, "c1"))
      .toBe("/club/myc/series/s1/summer-series-2026?class=c1&year=2026");
    expect(raceResultPath("myc", "r1", "Sonata Race 6"))
      .toBe("/club/myc/race/r1/sonata-race-6");
  });
});

describe("applyPageMetadata", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.title = "";
  });

  test("updates page title, canonical, social cards, and structured data", () => {
    applyPageMetadata({
      title: "Medway Regatta 2026 Results | SailScore",
      description: "Results from Medway Yacht Club",
      canonical: "https://www.sailscore.co.uk/club/medway/regatta/r1/medway-regatta-2026",
      image: "https://www.sailscore.co.uk/regatta.jpg",
      type: "article",
      robots: "index,follow",
      schema: { "@context": "https://schema.org", "@type": "SportsEvent", name: "Medway Regatta" },
    });

    expect(document.title).toBe("Medway Regatta 2026 Results | SailScore");
    expect(document.querySelector('meta[name="description"]').content).toBe("Results from Medway Yacht Club");
    expect(document.querySelector('meta[name="robots"]').content).toBe("index,follow");
    expect(document.querySelector('link[rel="canonical"]').href).toBe("https://www.sailscore.co.uk/club/medway/regatta/r1/medway-regatta-2026");
    expect(document.querySelector('meta[property="og:url"]').content).toBe("https://www.sailscore.co.uk/club/medway/regatta/r1/medway-regatta-2026");
    expect(document.querySelector('meta[property="og:type"]').content).toBe("article");
    expect(document.querySelector('meta[name="twitter:card"]').content).toBe("summary_large_image");
    expect(JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)["@type"]).toBe("SportsEvent");
  });

  test("replaces stale schema and marks private pages noindex", () => {
    applyPageMetadata({ title: "Private workspace", robots: "noindex,nofollow" });
    expect(document.querySelector('meta[name="robots"]').content).toBe("noindex,nofollow");
    expect(document.querySelector('script[data-sailscore-schema="true"]')).toBeNull();
  });
});
