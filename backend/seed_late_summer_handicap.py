"""Seed the 2026 Late Summer Series PM Handicap at Bough Beech SC from a
Sailwave HTML export.

Creates (idempotently, for the club named "Bough Beach Sailing Club"):
  - a "Handicap" class
  - the 6 entered boats (2000, SNIPE, SOLUTION) with their PY numbers
  - a "Late Summer Series PM Handicap" series (scoring_mode py, 1 discard,
    4 races R7-R10, finishers+1 DNF scoring per the Sailwave file)
  - the 4 published races with each boat's place / DNF / DNC result, plus the
    real start and finish times from the file so the elapsed/corrected columns
    reproduce it exactly

Usage:
    python seed_late_summer_handicap.py /path/to/sailwave-results.html

Scoring notes from the file: 6 entries -> DNC = 7.0 (entries + 1) everywhere;
R9's DNF scores 3.0 = the 2 finishers + 1 (RYA/Sailwave finishers convention,
the series' use_finishers flag). Corrected time = elapsed x 1000 / PY.
"""
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).parent / ".env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

YEAR = 2026
# Resolve the club by its stable slug (matches the display name "Bough
# Beech Sailing Club").
CLUB_NAME = "Bough Beech Sailing Club"
CLUB_SLUG = "bough-beech-sailing-club"
CLASS_NAME = "Handicap"
SERIES_NAME = "Late Summer Series PM Handicap"
# R7/R8 raced 19 Jul, R9/R10 on 26 Jul 2026 (from the file's race titles).
RACE_DATES = ["2026-07-19", "2026-07-19", "2026-07-26", "2026-07-26"]
# Obvious typos in the source file, normalised to the same people already in
# the system's Snipe Open fleet. (The file also mangles the crew of 28541.)
HELM_FIXES = {
    "9611": "Peter Wolstenholme / Matt Wolstenholme",
    "28541": "Matthew Wolstenholme / Eiichi Higuchi",
    "434": "Leigh Clark",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def cells_of(row_html):
    return [re.sub(r"<[^>]+>", "", c).strip()
            for c in re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.S)]


def parse_summary(path):
    """Return [(sail_no, helm, crew, boat_type, py, [R7..R10 cells], nett)]."""
    html = Path(path).read_text(encoding="ISO-8859-1")
    rows = re.findall(r'<tr class="(?:odd|even) summaryrow">(.*?)</tr>', html, re.S)
    assert rows, "no summary rows found"
    out = []
    for row in rows:
        cells = cells_of(row)
        # rank, sailno, helm, crew, class, py, R7..R10, total, nett
        assert len(cells) == 12, cells
        out.append((cells[1], cells[2], cells[3], cells[4],
                    float(cells[5]), cells[6:10], cells[11]))
    return out


def parse_cell(cell):
    """'3.0' -> ('FINISHED', 3); '7.0 DNC' -> ('DNC', None); '(3.0)' -> finish."""
    m = re.match(r"\(?(\d+(?:\.\d+)?)\)?(?:\s*([A-Z]+))?", cell)
    if not m:
        return "FINISHED", None
    value = float(m.group(1))
    code = m.group(2)
    if code in ("DNF", "RET", "UFD", "DNS", "OCS", "BFD", "DSQ", "NSC", "DNC", "RDG"):
        return code, None
    return "FINISHED", int(value)


def norm_time(txt):
    """'14:53:05' / '15.16.15' / '142800' -> '14:53:05' or None."""
    txt = txt.replace(".", ":")
    if ":" in txt:
        parts = txt.split(":")
        return ":".join(p.zfill(2) for p in parts[:3])
    if len(txt) == 6 and txt.isdigit():
        return f"{txt[:2]}:{txt[2:4]}:{txt[4:]}"
    return None


def parse_races(path):
    """Return {race_number: {'start': '14:28:00', 'finish': {sail_no: iso}}}."""
    html = Path(path).read_text(encoding="ISO-8859-1")
    races = {}
    for m in re.finditer(
            r'<h3 class="racetitle" id="r(\d+)">(.*?)</h3>\s*'
            r'<div class="caption racecaption">(.*?)</div>(.*?)</table>',
            html, re.S):
        num = int(m.group(1))
        caption = re.sub(r"<[^>]+>", "", m.group(3))
        body = m.group(4)
        start = None
        tm = re.search(r"Time:\s*(\d{6})", caption)
        if tm:
            start = norm_time(tm.group(1))
        finish = {}
        for row in re.findall(r'<tr class="(?:odd|even) racerow">(.*?)</tr>', body, re.S):
            cells = cells_of(row)
            if len(cells) < 8:
                continue
            sail = cells[1]
            if start is None and len(cells) >= 7:
                start = norm_time(cells[6])
            if len(cells) >= 8:
                ft = norm_time(cells[7])
                if ft:
                    finish[sail] = ft
        races[num] = {"start": start, "finish": finish}
    return races


def main(path):
    club = (db.clubs.find_one({"slug": CLUB_SLUG})
            or db.clubs.find_one({"name": CLUB_NAME}))
    if not club:
        raise SystemExit(f"club '{CLUB_NAME}' not found in DB")
    club_id = club["id"]

    # ---- clean previous seed (idempotent) ----
    cls = db.classes.find_one({"name": CLASS_NAME, "club_id": club_id})
    if cls:
        cid = cls["id"]
        for s in db.series.find({"class_id": cid}):
            db.races.delete_many({"series_id": s["id"]})
        db.series.delete_many({"class_id": cid})
        db.boats.delete_many({"class_id": cid})
        db.classes.delete_one({"id": cid})

    # ---- class ----
    cid = str(uuid.uuid4())
    db.classes.insert_one({"id": cid, "club_id": club_id, "name": CLASS_NAME,
                           "default_start_time": "10:30", "scoring_mode": "one_design",
                           "created_at": now_iso()})
    print("class:", CLASS_NAME)

    # ---- boats ----
    rows = parse_summary(path)
    boats = []
    for sail_no, helm, crew, boat_type, py, _cells, _nett in rows:
        helm = HELM_FIXES.get(sail_no, f"{helm} / {crew}" if crew else helm)
        doc = {"id": str(uuid.uuid4()), "name": sail_no, "sail_no": sail_no,
               "class_id": cid, "helm": helm, "year": YEAR,
               "active": True, "tcc": None, "py": py, "boat_type": boat_type,
               "home_club": club["name"], "created_at": now_iso()}
        db.boats.insert_one(doc)
        boats.append((sail_no, doc["id"]))
    print("boats:", len(boats))

    # ---- series (order = after the club's existing 2026 series) ----
    ids = [c["id"] for c in db.classes.find({"club_id": club_id}, {"_id": 0, "id": 1})]
    last_order = db.series.find_one({"class_id": {"$in": ids}, "year": YEAR},
                                    {"_id": 0, "order": 1}, sort=[("order", -1)])
    order = (last_order or {}).get("order", 0) + 1
    sid = str(uuid.uuid4())
    db.series.insert_one({"id": sid, "name": SERIES_NAME, "class_id": cid, "year": YEAR,
                          "scoring_mode": "py", "discards": 1, "included_in_overall": True,
                          "order": order, "planned_races": 4, "schedule": RACE_DATES,
                          "use_a5_3": False, "use_finishers": True, "created_at": now_iso()})
    print(f"series: {SERIES_NAME} (py, 1 discard, finishers+1, order {order})")

    # ---- races ----
    race_times = parse_races(path)
    expected_nets = {}
    corrected_checks = []
    for idx, rn in enumerate(range(7, 11)):
        placings = {}
        for sail_no, _h, _c, _t, _py, cells, nett in rows:
            code, pos = parse_cell(cells[idx])
            placings[sail_no] = (code, pos)
            if rn == 10:
                expected_nets[sail_no] = float(nett)
        date = RACE_DATES[idx]
        rt = race_times.get(rn, {"start": None, "finish": {}})
        start = rt["start"]
        results = []
        for sail_no, bid in boats:
            code, pos = placings[sail_no]
            ft = rt["finish"].get(sail_no)
            finish_time = f"{date}T{ft}+00:00" if ft else None
            results.append({"boat_id": bid, "code": code, "finish_time": finish_time,
                            "position": pos, "penalty_points": 0})
            if code == "FINISHED" and finish_time:
                py = next(p for s, _h, _c, _t, p, _cells, _n in rows if s == sail_no)
                corrected_checks.append((rn, sail_no, start, ft, py))
        actual_start = f"{date}T{start}+00:00" if start else None
        db.races.insert_one({"id": str(uuid.uuid4()), "date": date,
                             "class_id": cid, "series_id": sid, "year": YEAR,
                             "race_number": rn, "start_time": (start or "10:30")[:5],
                             "actual_start": actual_start, "course": "",
                             "special_rules": "", "life_jackets": False,
                             "status": "published", "entries_count": len(boats),
                             "results": results, "created_at": now_iso(),
                             "published_at": now_iso()})
        finished = sum(1 for c, _ in placings.values() if c == "FINISHED")
        print(f"  R{rn} {date} — {finished} finished (start {start})")

    # ---- verify nett scores and corrected times against the file ----
    import json
    import urllib.request
    base = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
    with urllib.request.urlopen(f"{base}/api/standings/series/{sid}") as resp:
        st = json.loads(resp.read())
    boats_by_id = {bid: sail for sail, bid in boats}
    ok = True
    print("\nverification (rank, sail, our net, sailwave nett, match):")
    for row in st["standings"]:
        sail = boats_by_id.get(row["boat_id"])
        exp = expected_nets.get(sail)
        match = exp is not None and abs(row["net"] - exp) < 0.01
        ok = ok and match
        print("  ", (row["rank"], sail, row["net"], exp, match))
    for rn, sail, start, ft, py in corrected_checks:
        el = (datetime.fromisoformat(f"2026-01-01T{ft}:00") -
              datetime.fromisoformat(f"2026-01-01T{start}:00")).total_seconds()
        ours = round(el * 1000 / py)
        print(f"  R{rn} {sail}: corrected {ours}s (elapsed {int(el)}s, PY {py:.0f})")
    if not ok:
        raise SystemExit("NET MISMATCH — check the seed")
    print("\nAll 6 nett scores match the Sailwave file.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
