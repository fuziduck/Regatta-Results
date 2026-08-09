"""Tests for handicap scoring (IRC/PY) and fleet regression.

Creates temporary classes/boats/series/races and cleans up at the end so the
seeded Dragon/Sonata/Wayfarer data is untouched.
"""
import os
import pytest
import requests
from datetime import datetime, timezone

BASE = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') + '/api'
YEAR = datetime.now(timezone.utc).year


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE}/auth/login", json={"role": "admin", "pin": "admin2026"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def officer_token():
    r = requests.post(f"{BASE}/auth/login", json={"role": "officer", "pin": "sail2026"})
    assert r.status_code == 200
    return r.json()["token"]


def h(tok): return {"Authorization": f"Bearer {tok}"}


# Cleanup registry
CREATED = {"classes": [], "series": [], "boats": [], "races": []}


@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin_token, officer_token):
    yield
    # delete in dependency order
    for rid in CREATED["races"]:
        requests.delete(f"{BASE}/races/{rid}", headers=h(officer_token))
    for sid in CREATED["series"]:
        requests.delete(f"{BASE}/series/{sid}", headers=h(admin_token))
    for bid in CREATED["boats"]:
        requests.delete(f"{BASE}/boats/{bid}", headers=h(admin_token))
    for cid in CREATED["classes"]:
        requests.delete(f"{BASE}/classes/{cid}", headers=h(admin_token))


def _make_class(admin_token, name, scoring_type):
    r = requests.post(f"{BASE}/classes", headers=h(admin_token),
                      json={"name": name, "default_start_time": "10:00", "scoring_type": scoring_type})
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    CREATED["classes"].append(cid)
    return cid


def _make_boat(admin_token, cid, name, sail, helm, rating=None):
    payload = {"name": name, "sail_no": sail, "class_id": cid, "helm": helm,
               "year": YEAR, "active": True, "rating": rating}
    r = requests.post(f"{BASE}/boats", headers=h(admin_token), json=payload)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    CREATED["boats"].append(bid)
    return bid


def _make_series(admin_token, cid, name):
    r = requests.post(f"{BASE}/series", headers=h(admin_token), json={
        "name": name, "class_id": cid, "year": YEAR, "discards": 0,
        "included_in_overall": True, "order": 99, "planned_races": 1,
    })
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    CREATED["series"].append(sid)
    return sid


def _make_race(officer_token, cid, sid, date="2026-05-02", start_time="10:00"):
    r = requests.post(f"{BASE}/races", headers=h(officer_token), json={
        "date": date, "class_id": cid, "series_id": sid,
        "race_number": 1, "start_time": start_time,
    })
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    CREATED["races"].append(rid)
    return rid


# ---- Classes: scoring_type CRUD --------------------------------------------
def test_class_scoring_type_persists(admin_token):
    cid_py = _make_class(admin_token, "TEST_PY_Class", "py")
    cid_irc = _make_class(admin_token, "TEST_IRC_Class", "irc")
    r = requests.get(f"{BASE}/classes")
    items = {c["id"]: c for c in r.json()}
    assert items[cid_py]["scoring_type"] == "py"
    assert items[cid_irc]["scoring_type"] == "irc"


# ---- Boats: rating field ----------------------------------------------------
def test_boat_rating_persists(admin_token):
    cid = _make_class(admin_token, "TEST_Rating_PY", "py")
    bid = _make_boat(admin_token, cid, "TEST_Rating_Boat", "T-R1", "Helm", rating=1100)
    r = requests.get(f"{BASE}/boats", params={"class_id": cid, "year": YEAR})
    b = [x for x in r.json() if x["id"] == bid][0]
    assert b["rating"] == 1100
    # update
    r2 = requests.put(f"{BASE}/boats/{bid}", headers=h(admin_token), json={
        "name": "TEST_Rating_Boat", "sail_no": "T-R1", "class_id": cid, "helm": "Helm",
        "year": YEAR, "active": True, "rating": 1050,
    })
    assert r2.status_code == 200
    assert r2.json()["rating"] == 1050


# ---- PY scoring correctness -------------------------------------------------
def test_py_corrected_time_ranking(admin_token, officer_token):
    cid = _make_class(admin_token, "TEST_PY_Race", "py")
    b_fast = _make_boat(admin_token, cid, "Fast", "F1", "F Helm", rating=900)      # PN 900
    b_mid = _make_boat(admin_token, cid, "Mid", "M1", "M Helm", rating=1100)
    b_slow = _make_boat(admin_token, cid, "Slow", "S1", "S Helm", rating=1300)
    sid = _make_series(admin_token, cid, "TEST_PY_Series")
    rid = _make_race(officer_token, cid, sid, date="2026-05-02", start_time="10:00")

    # select all 3
    requests.post(f"{BASE}/races/{rid}/select-boats", headers=h(officer_token),
                  json={"boat_ids": [b_fast, b_mid, b_slow]})
    # Record finishes in a specific tap order (Slow first, Fast last)
    # start = 2026-05-02T10:00:00Z
    # Fast finishes at 11:00 -> elapsed 3600s -> corrected = 3600*1000/900 = 4000
    # Mid  finishes at 11:20 -> elapsed 4800s -> corrected = 4800*1000/1100 = 4363.6
    # Slow finishes at 10:45 -> elapsed 2700s -> corrected = 2700*1000/1300 = 2076.9  (WINS)
    # Ranking by corrected asc: Slow(1) Fast(2) Mid(3)  -- NOT tap order
    taps = [
        (b_slow, "2026-05-02T10:45:00+00:00"),
        (b_fast, "2026-05-02T11:00:00+00:00"),
        (b_mid,  "2026-05-02T11:20:00+00:00"),
    ]
    for bid, ft in taps:
        r = requests.post(f"{BASE}/races/{rid}/finish", headers=h(officer_token),
                          json={"boat_id": bid, "finish_time": ft})
        assert r.status_code == 200

    race = requests.get(f"{BASE}/races/{rid}").json()
    by_boat = {r["boat_id"]: r for r in race["results"]}

    # elapsed
    assert by_boat[b_fast]["elapsed_seconds"] == 3600.0
    assert by_boat[b_slow]["elapsed_seconds"] == 2700.0
    # corrected math
    assert abs(by_boat[b_fast]["corrected_seconds"] - 4000.0) < 0.5
    assert abs(by_boat[b_mid]["corrected_seconds"] - 4363.6) < 0.5
    assert abs(by_boat[b_slow]["corrected_seconds"] - 2076.9) < 0.5
    # positions ranked by corrected ascending, NOT tap order
    assert by_boat[b_slow]["position"] == 1
    assert by_boat[b_fast]["position"] == 2
    assert by_boat[b_mid]["position"] == 3

    # publish and check standings
    requests.post(f"{BASE}/races/{rid}/status/published", headers=h(officer_token))
    st = requests.get(f"{BASE}/standings/series/{sid}").json()
    pts = {row["boat_id"]: row["net"] for row in st["standings"]}
    assert pts[b_slow] == 1.0
    assert pts[b_fast] == 2.0
    assert pts[b_mid] == 3.0


# ---- IRC scoring correctness ------------------------------------------------
def test_irc_corrected_time_ranking(admin_token, officer_token):
    cid = _make_class(admin_token, "TEST_IRC_Race", "irc")
    # TCC: higher = worse (multiplier). Corrected = elapsed * TCC.
    b_low = _make_boat(admin_token, cid, "LowTCC", "L1", "L Helm", rating=0.95)
    b_mid = _make_boat(admin_token, cid, "MidTCC", "M1", "M Helm", rating=1.00)
    b_high = _make_boat(admin_token, cid, "HighTCC", "H1", "H Helm", rating=1.05)
    sid = _make_series(admin_token, cid, "TEST_IRC_Series")
    rid = _make_race(officer_token, cid, sid, date="2026-05-03", start_time="10:00")

    requests.post(f"{BASE}/races/{rid}/select-boats", headers=h(officer_token),
                  json={"boat_ids": [b_low, b_mid, b_high]})
    # All finish at same time 11:00 -> elapsed 3600s. Corrected = 3600*TCC
    # low->3420  mid->3600  high->3780. Positions: low(1), mid(2), high(3).
    # Reverse tap order to prove ranking is by corrected.
    taps = [
        (b_high, "2026-05-03T11:00:00+00:00"),
        (b_mid,  "2026-05-03T11:00:00+00:00"),
        (b_low,  "2026-05-03T11:00:00+00:00"),
    ]
    for bid, ft in taps:
        requests.post(f"{BASE}/races/{rid}/finish", headers=h(officer_token),
                      json={"boat_id": bid, "finish_time": ft})

    race = requests.get(f"{BASE}/races/{rid}").json()
    by_boat = {r["boat_id"]: r for r in race["results"]}
    assert abs(by_boat[b_low]["corrected_seconds"] - 3420.0) < 0.5
    assert abs(by_boat[b_mid]["corrected_seconds"] - 3600.0) < 0.5
    assert abs(by_boat[b_high]["corrected_seconds"] - 3780.0) < 0.5
    assert by_boat[b_low]["position"] == 1
    assert by_boat[b_mid]["position"] == 2
    assert by_boat[b_high]["position"] == 3


# ---- Fleet regression: tap order == position, undo re-sequences -------------
def test_fleet_tap_order_and_undo(admin_token, officer_token):
    cid = _make_class(admin_token, "TEST_Fleet_Race", "fleet")
    b1 = _make_boat(admin_token, cid, "F1boat", "FL1", "H1")
    b2 = _make_boat(admin_token, cid, "F2boat", "FL2", "H2")
    b3 = _make_boat(admin_token, cid, "F3boat", "FL3", "H3")
    sid = _make_series(admin_token, cid, "TEST_Fleet_Series")
    rid = _make_race(officer_token, cid, sid, date="2026-05-04", start_time="10:00")

    requests.post(f"{BASE}/races/{rid}/select-boats", headers=h(officer_token),
                  json={"boat_ids": [b1, b2, b3]})

    # Tap b2, b3, b1 - positions should be b2=1, b3=2, b1=3
    for i, bid in enumerate([b2, b3, b1]):
        requests.post(f"{BASE}/races/{rid}/finish", headers=h(officer_token),
                      json={"boat_id": bid, "finish_time": f"2026-05-04T10:{10 + i * 5:02d}:00+00:00"})

    race = requests.get(f"{BASE}/races/{rid}").json()
    by_boat = {r["boat_id"]: r for r in race["results"]}
    assert by_boat[b2]["position"] == 1
    assert by_boat[b3]["position"] == 2
    assert by_boat[b1]["position"] == 3
    # Fleet class should NOT have elapsed/corrected fields populated
    assert by_boat[b2].get("elapsed_seconds") in (None,)
    assert by_boat[b2].get("corrected_seconds") in (None,)

    # Undo b3 -> b2=1, b1=2 (re-sequenced by finish time)
    requests.post(f"{BASE}/races/{rid}/undo-finish", headers=h(officer_token),
                  json={"boat_id": b3})
    race = requests.get(f"{BASE}/races/{rid}").json()
    by_boat = {r["boat_id"]: r for r in race["results"]}
    assert by_boat[b2]["position"] == 1
    assert by_boat[b1]["position"] == 2
    assert by_boat[b3]["position"] is None
    assert by_boat[b3]["code"] == "DNS"
