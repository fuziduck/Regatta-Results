"""Seed the 2026 Snipe Open at Bough Beech SC from a Sailwave HTML export.

Creates (idempotently, for the club named "Bough Beach Sailing Club"):
  - a "Snipe" class
  - the 21 entered Snipe boats (PY 1104) with their home clubs from the file
  - a "Snipe Open" series (scoring_mode py, 2 discards, 8 races)
  - the 8 published races with each boat's place / DNF / RET / UFD result,
    taken straight from the Sailwave summary table (points == places here)

Usage:
    python seed_snipe_open.py /path/to/sailwave-results.html

The event weekend is taken as Sat 4 + Sun 5 July 2026 (R6 of the file is
05/07/2026; the file's own R1-R4 dates are stale 2024 artifacts). Races run at
the class default start time. No finish times are fabricated — the file has
none, and positions are stored directly.
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
CLUB_SLUG = "bough-beech-sailing-club"
# R6 of the file is 05 July 2026; the event weekend is Sat 4 + Sun 5 July.
RACE_DATES = ["2026-07-04"] * 4 + ["2026-07-05"] * 4
PY = 1104.0
# Normalise the host club's name to the system's club (the file spells it
# "Bough Beech", including one row with a typo "Bough Bee3ch SC").
BB_ALIASES = {"Bough Beech SC", "Bough Beech Sailing Club", "Bough Bee3ch SC"}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def parse_summary(path):
    """Extract the 21 boat rows from the Sailwave summary table.

    Each row yields: (sail_no, helm, crew, club, [8 race cells]).
    """
    html = Path(path).read_text(encoding="ISO-8859-1")
    rows = re.findall(r'<tr class="(?:odd|even) summaryrow">(.*?)</tr>', html, re.S)
    assert rows, "no summary rows found"
    out = []
    for row in rows:
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        # rank, sailno, helm, crew, class, py, club, R1..R8, total, nett
        assert len(cells) == 17, cells
        out.append((cells[1], cells[2], cells[3], cells[6], cells[7:15], cells[16]))
    return out


def parse_cell(cell):
    """'1.0' -> ('FINISHED', 1); '22.0 RET' -> ('RET', None); '(3.0)' -> discarded finish."""
    m = re.match(r"\(?(\d+(?:\.\d+)?)\)?(?:\s*([A-Z]+))?", cell)
    if not m:
        return "FINISHED", None
    value = float(m.group(1))
    code = m.group(2)
    if code in ("DNF", "RET", "UFD", "DNS", "OCS", "BFD", "DSQ", "NSC", "DNC", "RDG"):
        return code, None
    return "FINISHED", int(value)


def main(path):
    club = db.clubs.find_one({"slug": CLUB_SLUG})
    if not club:
        raise SystemExit(f"club '{CLUB_SLUG}' not found in DB")
    club_id = club["id"]

    # ---- clean previous seed (idempotent) ----
    cls = db.classes.find_one({"name": "Snipe", "club_id": club_id})
    if cls:
        cid = cls["id"]
        for s in db.series.find({"class_id": cid}):
            db.races.delete_many({"series_id": s["id"]})
        db.series.delete_many({"class_id": cid})
        db.boats.delete_many({"class_id": cid})
        db.classes.delete_one({"id": cid})

    # ---- class ----
    cid = str(uuid.uuid4())
    db.classes.insert_one({"id": cid, "club_id": club_id, "name": "Snipe",
                           "default_start_time": "10:30", "scoring_mode": "one_design",
                           "created_at": now_iso()})
    print("class:", "Snipe")

    # ---- boats ----
    rows = parse_summary(path)
    boats = []
    for sail_no, helm, crew, club_txt, _, _nett in rows:
        home = CLUB_NAME if club_txt.strip() in BB_ALIASES else club_txt.strip()
        doc = {"id": str(uuid.uuid4()), "name": sail_no, "sail_no": sail_no,
               "class_id": cid, "helm": f"{helm} / {crew}", "year": YEAR,
               "active": True, "tcc": None, "py": PY, "boat_type": "Snipe",
               "home_club": home, "created_at": now_iso()}
        db.boats.insert_one(doc)
        boats.append((sail_no, doc["id"], home))
    print("boats:", len(boats))

    # ---- series ----
    sid = str(uuid.uuid4())
    db.series.insert_one({"id": sid, "name": "Snipe Open", "class_id": cid, "year": YEAR,
                          "scoring_mode": "py", "discards": 2, "included_in_overall": True,
                          "order": 1, "planned_races": 8, "schedule": RACE_DATES,
                          "use_a5_3": False, "created_at": now_iso()})
    print("series:", "Snipe Open (py, 2 discards)")

    # ---- races ----
    expected_nets = {}
    for rn in range(1, 9):
        placings = {}
        for sail_no, _h, _c, _t, cells, nett in rows:
            code, pos = parse_cell(cells[rn - 1])
            placings[sail_no] = (code, pos)
            if rn == 8:
                expected_nets[sail_no] = float(nett)
        results = []
        for sail_no, bid, _home in boats:
            code, pos = placings[sail_no]
            results.append({"boat_id": bid, "code": code, "finish_time": None,
                            "position": pos, "penalty_points": 0})
        db.races.insert_one({"id": str(uuid.uuid4()), "date": RACE_DATES[rn - 1],
                             "class_id": cid, "series_id": sid, "year": YEAR,
                             "race_number": rn, "start_time": "10:30", "course": "",
                             "special_rules": "", "life_jackets": False,
                             "status": "published", "entries_count": len(boats),
                             "results": results, "created_at": now_iso(),
                             "published_at": now_iso()})
        finished = sum(1 for c, _ in placings.values() if c == "FINISHED")
        print(f"  R{rn} {RACE_DATES[rn - 1]} — {finished} finished")

    # ---- verify against the file's nett scores via the live standings ----
    import json
    import urllib.request
    base = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
    with urllib.request.urlopen(f"{base}/api/standings/series/{sid}") as resp:
        st = json.loads(resp.read())
    boats_by_id = {bid: sail for sail, bid, _h in boats}
    rows_out = []
    ok = True
    for row in st["standings"]:
        sail = boats_by_id.get(row["boat_id"])
        exp = expected_nets.get(sail)
        match = exp is not None and abs(row["net"] - exp) < 0.01
        ok = ok and match
        rows_out.append((row["rank"], sail, row["net"], exp, match))
    print("\nverification (rank, sail, our net, sailwave nett, match):")
    for r in rows_out:
        print("  ", r)
    if not ok:
        raise SystemExit("NET MISMATCH — check the seed")
    print("\nAll 21 nett scores match the Sailwave file.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
