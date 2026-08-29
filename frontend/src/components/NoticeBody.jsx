// Shared HTML presentation of a notice — the primary, mobile-friendly
// reading experience on the Official Notice Board (spec 41). Also used by the
// wizard's preview step (the user sees EXACTLY what competitors will see) and
// the officer's management list. Generated notices render their structured
// label/value rows; uploaded notices render their metadata + the official
// document actions and never reproduce the document's content (spec 48).

export function noticeHeadingLine(notice = {}) {
  const label = (notice.notice_type_label || "Notice").toUpperCase();
  return notice.notice_number ? `${label} No. ${notice.notice_number}` : label;
}

export function noticeContextLine(notice = {}) {
  const parts = [];
  if (notice.event_name || notice.series_name) parts.push(notice.event_name || notice.series_name);
  if (notice.race_number) parts.push(`Race ${notice.race_number}`);
  if (notice.class_name) parts.push(notice.class_name);
  return parts.join(" · ");
}

export function fmtNoticeWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).replace("T", " ");
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// The structured content of a GENERATED notice: one labelled section per
// stored field, in the server-rendered order. Placeholders can never appear —
// only stored values come back from the API.
export function NoticeBodyView({ notice }) {
  if (!notice) return null;
  const rows = notice.body || [];
  if (!rows.length) return null;
  return (
    <div className="space-y-3" data-testid="notice-body">
      {rows.map((row, i) => (
        <div key={i}>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{row.label}</div>
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{row.value}</div>
        </div>
      ))}
    </div>
  );
}

// Facts strip: publication + effective timestamps and issuing authority
// (spec 39 — both content methods carry the same publication metadata).
export function NoticeFacts({ notice = null }) {
  if (!notice || typeof notice !== "object") return null;
  const facts = [
    notice.published_at && ["Published", fmtNoticeWhen(notice.published_at)],
    notice.effective_at && ["Effective", fmtNoticeWhen(notice.effective_at)],
    notice.race_date && !notice.race_number && ["Race date", notice.race_date],
  ].filter(Boolean);
  if (!facts.length) return null;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground" data-testid="notice-facts">
      {facts.map(([k, v]) => (
        <span key={k}><span className="font-semibold uppercase tracking-wide">{k}:</span> {v}</span>
      ))}
    </div>
  );
}
