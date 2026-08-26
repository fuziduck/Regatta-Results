// SailScore brand logo. The PNG has a transparent background and is drawn in
// dark navy + cyan — perfect on the light theme, but the navy reads as near
// black on a dark background. In dark mode we flip its luminance while
// preserving the blue/cyan hues (invert + 180° hue-rotate keeps the brand
// palette) so the logo stays clearly visible on the night theme.
export default function Logo({ className = "", alt = "SailScore" }) {
  return (
    <img
      src={`${process.env.PUBLIC_URL}/sailscore-logo.png`}
      alt={alt}
      className={`select-none dark:[filter:invert(1)_hue-rotate(180deg)] ${className}`}
      draggable={false}
    />
  );
}
