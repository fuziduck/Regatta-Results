// Presentation helpers for the Competition (Regatta / Championship) UI.
// The image is deliberately a remote placeholder so a competition can look
// complete before an official photo is uploaded from the admin console.
export const DEFAULT_COMPETITION_IMAGE =
  "https://images.unsplash.com/photo-1613578699399-82ae71be53a3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzN8MHwxfHNlYXJjaHwxfHxzYWlsYm9hdCUyMHJhY2luZyUyMHJlZ2F0dGF8ZW58MHx8fHwxNzg2MTI3MTgxfDA&ixlib=rb-4.1.0&q=85";

export const SERIES_TYPES = [
  { value: "championship", label: "Championship", description: "Class or open championship" },
  { value: "club_championship", label: "Club Championship", description: "Your club's championship" },
  { value: "regatta", label: "Regatta", description: "A specific racing occasion" },
];

export function normalizeSeriesType(value) {
  return SERIES_TYPES.some((type) => type.value === value) ? value : "championship";
}

export function classGroupKey(name) {
  return String(name || "").trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function competitionImage(competition) {
  return competition?.thumbnail || DEFAULT_COMPETITION_IMAGE;
}

export function competitionType(competition) {
  // A linked competition owns the public category of its child series. For a
  // standalone series, use its explicit series type; legacy records default
  // to Championship rather than accidentally becoming Regattas.
  const parent = competition?.competition;
  const type = parent?.competition_type || (competition?.regatta_id ? "regatta" : competition?.series_type || competition?.competition_type);

  if (type === "regatta") return "regatta";
  if (type === "club_championship") return "club_championship";
  return "championship";
}

export function competitionPath(competition, clubSlug) {
  const prefix = competitionType(competition) === "regatta" ? "regatta" : "competition";
  return `/club/${clubSlug}/${prefix}/${competition?.id || ""}`;
}

export function competitionTypeLabel(competition) {
  const type = competitionType(competition);
  if (type === "club_championship") return "Club Championship";
  if (type === "regatta") return "Regatta";
  const scope = competition?.competition?.championship_scope || competition?.championship_scope;
  if (scope === "club") return "Club Championship";
  if (scope === "class") return "Class Championship";
  if (scope === "open") return "Open Championship";
  return "Championship";
}

export function competitionStatusLabel(competition) {
  return competition?.status || "Complete";
}

export function pluraliseCount(value, singular, plural = `${singular}s`) {
  const count = Number(value) || 0;
  return `${count} ${count === 1 ? singular : plural}`;
}
