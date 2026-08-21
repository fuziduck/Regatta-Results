export default function ClubBadge({ club, size = "w-14 h-14", textSize = "text-2xl", rounded = "rounded-2xl", className = "" }) {
  if (club?.icon) {
    return (
      <img
        src={club.icon}
        alt={club.name || "Club"}
        className={`${size} ${rounded} object-cover shadow-lg shrink-0 bg-white ${className}`}
      />
    );
  }
  return (
    <span
      className={`${size} ${rounded} grid place-items-center text-white font-heading ${textSize} uppercase shadow-lg shrink-0 ${className}`}
      style={{ backgroundColor: club?.color || "#0A369D" }}
    >
      {(club?.name || "C").charAt(0)}
    </span>
  );
}
