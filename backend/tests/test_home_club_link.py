"""Boat home-club linking.

Entering a boat with a club abbreviation (e.g. "MYC") or a trimmed name
resolves it to the registered club: the boat's home_club is stored as the
canonical club name with a home_club_id link. Unregistered labels stay free
text.
"""
import uuid

import requests

from conftest import API, h


def test_boat_home_club_resolves_to_registered_club(webmaster_token):
    name = f"Riverside YC {uuid.uuid4().hex[:4]}"
    abbr = f"RY{uuid.uuid4().hex[:2].upper()}"
    r = requests.post(f"{API}/clubs", json={"name": name, "color": "#123456", "abbr": abbr},
                      headers=h(webmaster_token))
    assert r.status_code == 200, r.text
    club = r.json()
    cls = requests.post(f"{API}/classes", json={"name": "Test Fleet", "club_id": club["id"]},
                        headers=h(webmaster_token))
    assert cls.status_code == 200, cls.text
    cls = cls.json()
    try:
        # Entered with the club's configured abbreviation -> canonical + link.
        boat = requests.post(f"{API}/boats", json={
            "name": "Starburst", "sail_no": "GBR 7", "class_id": cls["id"],
            "helm": "A N Other", "year": 2026, "home_club": abbr,
        }, headers=h(webmaster_token))
        assert boat.status_code == 200, boat.text
        boat = boat.json()
        assert boat["home_club"] == club["name"]
        assert boat["home_club_id"] == club["id"]
        # Entered with initials of the registered name -> canonical + link.
        boat2 = requests.post(f"{API}/boats", json={
            "name": "Starburst II", "sail_no": "GBR 9", "class_id": cls["id"],
            "helm": "A N Other", "year": 2026, "home_club": "".join(w[0] for w in name.split() if w[0].isalnum()),
        }, headers=h(webmaster_token))
        assert boat2.status_code == 200, boat2.text
        boat2 = boat2.json()
        assert boat2["home_club"] == club["name"]
        assert boat2["home_club_id"] == club["id"]
        # A club that isn't registered stays free text (no link).
        boat3 = requests.post(f"{API}/boats", json={
            "name": "Comet", "sail_no": "GBR 8", "class_id": cls["id"],
            "helm": "B N Other", "year": 2026, "home_club": "Some Far Harbour SC",
        }, headers=h(webmaster_token))
        assert boat3.status_code == 200, boat3.text
        boat3 = boat3.json()
        assert boat3["home_club"] == "Some Far Harbour SC"
        assert "home_club_id" not in boat3
    finally:
        for b in requests.get(f"{API}/boats", params={"class_id": cls["id"]},
                               headers=h(webmaster_token)).json():
            requests.delete(f"{API}/boats/{b['id']}", headers=h(webmaster_token))
        requests.delete(f"{API}/classes/{cls['id']}", headers=h(webmaster_token))
        requests.delete(f"{API}/clubs/{club['id']}", headers=h(webmaster_token))
