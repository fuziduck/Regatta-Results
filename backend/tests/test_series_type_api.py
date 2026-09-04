"""Observable contract for series classification.

The test uses a disposable API-test club and checks that type metadata can be
changed independently of scoring, including the locked-season exception and
optimistic concurrency guard.
"""
import requests
from datetime import datetime, timezone

from conftest import API, h

YEAR = datetime.now(timezone.utc).year


def test_series_type_create_reallocate_and_stale_guard(club_admin_token):
    headers = h(club_admin_token)
    cls = requests.post(f"{API}/classes", json={"name": "Type Contract Class"}, headers=headers).json()
    sid = requests.post(f"{API}/series", json={
        "name": "Type Contract Series", "class_id": cls["id"], "year": YEAR,
        "series_type": "regatta", "discards": 0, "included_in_overall": True,
    }, headers=headers).json()
    try:
        assert sid["series_type"] == "regatta"
        r = requests.put(f"{API}/series/{sid['id']}/type",
                         json={"series_type": "club_championship", "expected_version": sid["version"]},
                         headers=headers)
        assert r.status_code == 200, r.text
        changed = r.json()
        assert changed["series_type"] == "club_championship"
        assert changed["version"] == sid["version"] + 1
        assert changed["discards"] == sid["discards"]

        # Repeating the same classification is harmless and does not create a
        # needless version or audit mutation.
        r = requests.put(f"{API}/series/{sid['id']}/type",
                         json={"series_type": "club_championship", "expected_version": changed["version"]},
                         headers=headers)
        assert r.status_code == 200 and r.json()["version"] == changed["version"]

        r = requests.put(f"{API}/series/{sid['id']}/type",
                         json={"series_type": "championship", "expected_version": sid["version"]},
                         headers=headers)
        assert r.status_code == 409

        r = requests.post(f"{API}/series/{sid['id']}/lock",
                          json={"confirm": True, "reason": "type contract"}, headers=headers)
        assert r.status_code == 200, r.text
        locked = requests.get(f"{API}/series", params={"class_id": cls["id"]}, headers=headers).json()[0]
        r = requests.put(f"{API}/series/{sid['id']}/type",
                         json={"series_type": "regatta", "expected_version": locked["version"]},
                         headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["series_type"] == "regatta"
    finally:
        requests.post(f"{API}/series/{sid['id']}/unlock",
                      json={"confirm": True, "reason": "test cleanup"}, headers=headers)
        requests.delete(f"{API}/series/{sid['id']}", headers=headers)
        requests.delete(f"{API}/classes/{cls['id']}", headers=headers)
