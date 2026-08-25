// Central source of truth for the SailScore site's identity and the
// owner/contact attribution shown in page footers and PDF exports. The
// attribution used to be copy-pasted across pages; everything reads from here
// so a change of contact details updates the site and the exports together.

export const SITE_NAME = "SailScore";
export const SITE_TAGLINE = "Connecting sailing, one club at a time.";
export const SITE_OWNER = "L Hopper";
export const SITE_CONTACT_EMAIL = "admin@sailscore.co.uk";

// e.g. "Website by L Hopper · Queries to admin@sailscore.co.uk"
export const SITE_ATTRIBUTION =
  `Website by ${SITE_OWNER} · Queries to ${SITE_CONTACT_EMAIL}`;

// Shown beneath the sponsor section in PDF exports.
export const SITE_SUPPORTERS_LINE =
  "Sponsored by our supporters — sponsors keep this software free for clubs.";
