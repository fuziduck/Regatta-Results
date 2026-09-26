export const SITE_NAME = "SailScore";
export const DEFAULT_DESCRIPTION = "Club sailing race results, standings and race history from clubs across the UK.";

export function slugifySegment(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "results";
}

export function boatProfilePath(fleetId, name) {
  return `/boat/${encodeURIComponent(fleetId)}${name ? `/${slugifySegment(name)}` : ""}`;
}

export function classProfilePath(classId, name) {
  return `/class/${encodeURIComponent(classId)}${name ? `/${slugifySegment(name)}` : ""}`;
}

export function groupedClassPath(name) {
  const key = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `/class/group/${encodeURIComponent(key)}${name ? `/${slugifySegment(name)}` : ""}`;
}

export function seriesResultsPath(clubSlug, seriesId, name, year, classId) {
  const readableLabel = `${name || ""} ${year || ""}`.trim();
  const readableName = slugifySegment(readableLabel);
  const params = new URLSearchParams();
  if (classId) params.set("class", classId);
  if (year) params.set("year", String(year));
  const query = params.toString();
  return `/club/${encodeURIComponent(clubSlug)}/series/${encodeURIComponent(seriesId)}/${readableName}${query ? `?${query}` : ""}`;
}

export function raceResultPath(clubSlug, raceId, label) {
  return `/club/${encodeURIComponent(clubSlug)}/race/${encodeURIComponent(raceId)}${label ? `/${slugifySegment(label)}` : ""}`;
}

function ensureMeta(attribute, key) {
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  return element;
}

function ensureCanonical() {
  let element = document.head.querySelector('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }
  return element;
}

export function applyPageMetadata({
  title = "Club Sailing Results & Standings | SailScore",
  description = DEFAULT_DESCRIPTION,
  canonical,
  image,
  type = "website",
  robots = "index,follow",
  schema,
} = {}) {
  if (typeof document === "undefined") return;
  const url = canonical || window.location.href;
  const previewImage = image || `${window.location.origin}/sailscore-logo.png`;
  document.title = title;
  ensureMeta("name", "description").setAttribute("content", description);
  ensureMeta("name", "robots").setAttribute("content", robots);
  ensureCanonical().setAttribute("href", url);
  ensureMeta("property", "og:type").setAttribute("content", type);
  ensureMeta("property", "og:site_name").setAttribute("content", SITE_NAME);
  ensureMeta("property", "og:title").setAttribute("content", title);
  ensureMeta("property", "og:description").setAttribute("content", description);
  ensureMeta("property", "og:url").setAttribute("content", url);
  ensureMeta("property", "og:image").setAttribute("content", previewImage);
  ensureMeta("property", "og:image:alt").setAttribute("content", `${SITE_NAME} sailing results`);
  ensureMeta("property", "og:locale").setAttribute("content", "en_GB");
  ensureMeta("name", "twitter:card").setAttribute("content", "summary_large_image");
  ensureMeta("name", "twitter:title").setAttribute("content", title);
  ensureMeta("name", "twitter:description").setAttribute("content", description);
  ensureMeta("name", "twitter:image").setAttribute("content", previewImage);

  document.head.querySelector('script[data-sailscore-schema="true"]')?.remove();
  if (schema) {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.sailscoreSchema = "true";
    script.textContent = JSON.stringify(schema).replace(/</g, "\\u003c");
    document.head.appendChild(script);
  }
}

export function updateDocumentMetadata(metadata) {
  applyPageMetadata(metadata);
}
