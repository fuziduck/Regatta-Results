// Series navigation model for the results page (class + year).
//
// When a class/year has exactly ONE series — e.g. a single regatta — that
// series IS the year's result: the redundant "Overall" tab (which would just
// repeat the same standings) is hidden, the year defaults straight onto the
// series, and no "(excl.)" suffix is appended to its name. The series count
// is the results page's own series list for the class/year (the same
// `api.getSeries` payload that drives the tabs), so deleted/absent series are
// simply not in the list.
//
// With multiple series the previous behaviour is preserved exactly: the
// Overall tab appears whenever the overall championship has rows, it remains
// the default view, and series excluded from the overall championship keep
// their "(excl.)" label.

export function seriesNavModel(series, hasOverall) {
  const list = Array.isArray(series) ? series : [];
  const single = list.length === 1;

  // The Overall tab only exists for a multi-series year (more than one
  // series) AND when the overall standings actually have rows (some series
  // count towards the championship).
  const showOverall = list.length > 1 && !!hasOverall;

  // Where the page should land once the data is ready.
  const defaultTab = single
    ? list[0].id
    : showOverall
      ? "overall"
      : list.length > 0
        ? list[0].id
        : "overall";

  // "(excl.)" is only meaningful when there is more than one series to
  // compare against — a lone series never carries the suffix.
  const showExcl = (s) => !single && !(s && s.included_in_overall);

  return { single, showOverall, defaultTab, showExcl };
}
