"""Races must carry a denormalized club_id.

New races get it stamped from the owning class at every creation path
(ad-hoc, scheduled-split, mini-series). Legacy races without it are stamped
by the startup backfill (_backfill_race_club_ids), so a direct
races.club_id query never silently returns nothing for old data.
"""
import requests

from conftest import API, h


def _race_via_api(club_admin_token, club_officer_token):
    r = requests.post(f"{API}/classes", json={
        "name": "Club Id Class", "default_start_time": "10:30"},
        headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    cls = r.json()
    r = requests.post(f"{API}/series", json={
        "name": "Club Id Series", "class_id": cls["id"], "year": 2099,
        "discards": 0, "included_in_overall": True, "order": 1},
        headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    series = r.json()
    r = requests.post(f"{API}/boats", json={
        "name": "Club Id Boat", "sail_no": "CI1", "class_id": cls["id"],
        "helm": "C", "year": 2099, "active": True},
        headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    boat = r.json()
    r = requests.post(f"{API}/races", json={
        "date": "2099-06-01", "class_id": cls["id"], "series_id": series["id"],
        "race_number": 1}, headers=h(club_officer_token))
    assert r.status_code == 200, r.text
    return cls, series, boat, r.json()


def test_created_race_stamps_club_id(club_admin_token, club_officer_token, test_club):
    club_id = test_club["id"]
    _, _, _, race = _race_via_api(club_admin_token, club_officer_token)
    fetched = requests.get(f"{API}/races/{race['id']}").json()
    assert fetched.get("club_id") == club_id, (
        f"race missing club_id stamp: {fetched.get('club_id')!r} != {club_id!r}")


def test_club_scoped_race_list_finds_the_race(club_admin_token, club_officer_token, test_club):
    club_id = test_club["id"]
    cls, series, boat, race = _race_via_api(club_admin_token, club_officer_token)
    requests.post(f"{API}/races/{race['id']}/select-boats",
                  json={"boat_ids": [boat["id"]]}, headers=h(club_officer_token))
    requests.post(f"{API}/races/{race['id']}/status/published",
                  headers=h(club_officer_token))
    items = requests.get(f"{API}/races", params={"club_id": club_id}).json()
    ids = {r["id"] for r in items}
    assert race["id"] in ids, "club-scoped race list missed the club's own race"
