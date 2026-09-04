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

// Keep the visual meaning of a competition tag in one place. The labels are
// deliberately distinct so club, class, and open championships are not
// reduced to the same generic amber badge.
export function competitionTagClass(competition) {
  const label = competitionTypeLabel(competition);
  if (label === "Regatta") {
    return "border-cyan-300 bg-cyan-100 text-cyan-800 dark:border-cyan-500/40 dark:bg-cyan-500/15 dark:text-cyan-200";
  }
  if (label === "Club Championship") {
    return "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200";
  }
  if (label === "Class Championship") {
    return "border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200";
  }
  if (label === "Open Championship") {
    return "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800 dark:border-fuchsia-500/40 dark:bg-fuchsia-500/15 dark:text-fuchsia-200";
  }
  return "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200";
}

export function competitionStatusLabel(competition) {
  return competition?.status || "Complete";
}

export function pluraliseCount(value, singular, plural = `${singular}s`) {
  const count = Number(value) || 0;
  return `${count} ${count === 1 ? singular : plural}`;
}
