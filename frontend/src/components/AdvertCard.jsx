// Advert card shown interleaved on the public pages (1 in every 3 grid
// columns). Cards stretch to fill their grid cell, so they sit cleanly
// alongside content cards whose heights vary.
//
// Rotation: adverts roll on each page load — up to MAX_ADVERTS_PER_LOAD are
// shown at once, cycling through the active pool. With fewer than that many
// active adverts, only the active ones ever appear. The roll offset is
// captured once per page load (useAdvertsRoll) so a page shows a stable
// batch; refreshing the page advances to the next batch.

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export const MAX_ADVERTS_PER_LOAD = 10;

// Read + advance the session-wide rotation counter. Returns the offset for
// this page load; the next load (or tab) sees the following window.
export function nextAdRoll() {
  try {
    const n = Number(sessionStorage.getItem("ad_roll") || "0");
    sessionStorage.setItem("ad_roll", String(n + 1));
    return n;
  } catch {
    // sessionStorage unavailable (private mode) — time-based roll instead
    return Math.floor(Date.now() / 60000);
  }
}

// Fetch the active adverts once; the roll offset is fixed for the page load.
export function useAdverts() {
  const [adverts, setAdverts] = useState([]);
  const [roll] = useState(nextAdRoll);
  useEffect(() => {
    api.getAdverts().then(setAdverts).catch(() => {});
  }, []);
  return { adverts, roll };
}

// Pick the rolling window of `slots` adverts from the active pool, starting
// at the given roll offset.
export function pickAdverts(active, slots, roll) {
  if (!active || !active.length || slots <= 0) return [];
  const pool = active.filter((a) => a.active !== false);
  if (!pool.length) return [];
  const count = Math.min(slots, MAX_ADVERTS_PER_LOAD, pool.length);
  const offset = (roll || 0) % pool.length;
  const out = [];
  for (let i = 0; i < count; i++) out.push(pool[(offset + i) % pool.length]);
  return out;
}

// Insert adverts into a list of cards so that every 3rd position (1-based) is
// an advert: [card, card, ad, card, card, ad, ...]. Adverts are placed at
// indices 2, 5, 8, ... — matching the home page's 3-column grid, where each
// row shows two content cards and one advert.
export function interleaveWithAdverts(items, adverts) {
  if (!adverts || !adverts.length) return items;
  const out = [];
  let ai = 0;
  items.forEach((item, i) => {
    out.push(item);
    if ((i + 1) % 2 === 0 && ai < adverts.length) {
      out.push({ __advert: adverts[ai++] });
    }
  });
  return out;
}

// Aspect-ratio presets used when the webmaster picks a named shape.
// Landscape/portrait/square standardise the card box; "auto" detects the
// uploaded image's intrinsic ratio so the full image always fits.
const RATIOS = { landscape: 4 / 3, portrait: 3 / 4, square: 1 };

export default function AdvertCard({ advert, className = "" }) {
  const [natRatio, setNatRatio] = useState(null);
  if (!advert) return null;
  const format = advert.format || "auto";
  const preset = RATIOS[format] || null;
  // Use the named shape if set, otherwise fall back to the image's own
  // natural ratio; until the image loads, default to landscape so the
  // card has a recognised shape from the first frame.
  const ratio = preset || natRatio || RATIOS.landscape;

  const img = (
    <>
      <div className="absolute inset-0 flex items-center justify-center p-3">
        <img
          src={advert.image}
          alt={advert.name || "Advertisement"}
          onLoad={(e) => {
            const w = e.target.naturalWidth, h = e.target.naturalHeight;
            if (w && h) setNatRatio(w / h);
          }}
          style={{ aspectRatio: ratio }}
          className="max-w-full max-h-full object-contain rounded-lg"
        />
      </div>
      <span className="absolute top-2 right-2 rounded-full bg-black/45 text-white text-[9px] uppercase tracking-widest px-2 py-0.5 backdrop-blur-sm">
        Sponsored
      </span>
    </>
  );
  const body = (
    <div
      data-testid={`advert-${advert.id}`}
      className={`relative w-full h-full min-h-36 overflow-hidden rounded-2xl border border-border/70 bg-muted ${className}`}
    >
      {img}
    </div>
  );
  if (advert.link_url) {
    return (
      <a href={advert.link_url} target="_blank" rel="noopener noreferrer" className="block h-full min-h-36 group">
        {body}
      </a>
    );
  }
  return body;
}
