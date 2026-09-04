// Presentation helpers for the Competition (Regatta / Championship) UI.
// The image is deliberately a remote placeholder so a competition can look
// complete before an official photo is uploaded from the admin console.
export const DEFAULT_COMPETITION_IMAGE =
  "https://images.unsplash.com/photo-1613578699399-82ae71be53a3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzN8MHwxfHNlYXJjaHwxfHxzYWlsYm9hdCUyMHJhY2luZyUyMHJlZ2F0dGF8ZW58MHx8fHwxNzg2MTI3MTgxfDA&ixlib=rb-4.1.0&q=85";

export function competitionImage(competition) {
  return competition?.thumbnail || DEFAULT_COMPETITION_IMAGE;
}

export function competitionTypeLabel(competition) {
  if ((competition?.competition_type || "regatta") !== "championship") return "Regatta";
  const scope = competition?.championship_scope;
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
