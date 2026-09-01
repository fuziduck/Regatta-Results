"""Club rename behaviour.

Renaming a club re-derives its URL handle (slug) from the new name and
propagates the rename to the stored references that carry the club's name as
free text (regatta host-club labels, boat home clubs). Everything else
references the club by id and resolves the name/slug at read time.
"""
import re
import uuid

import pytest
import requests

from conftest import API, h


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "club"


def _make_club(token, name):
    r = requests.post(f"{API}/clubs", json={"name": name, "color": "#123456"}, headers=h(token))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def rename_club(webmaster_token):
    """A dedicated club with a class, a boat and a regatta that reference the
    club by name (boat.home_club / regatta.host_club), torn down afterwards."""
    name = f"Harbour Lights YC {uuid.uuid4().hex[:4]}"
    club = _make_club(webmaster_token, name)
    cls = requests.post(f"{API}/classes", json={"name": "Test Fleet", "club_id": club["id"]},
                        headers=h(webmaster_token))
    assert cls.status_code == 200, cls.text
    cls = cls.json()
    boat = requests.post(f"{API}/boats", json={
        "name": "Starburst", "sail_no": "GBR 1", "class_id": cls["id"],
        "helm": "A N Other", "year": 2026, "home_club": name,
    }, headers=h(webmaster_token))
    assert boat.status_code == 200, boat.text
    boat = boat.json()
    reg = requests.post(f"{API}/regattas", json={
        "name": "Summer Regatta", "year": 2026, "club_id": club["id"], "host_club": name,
    }, headers=h(webmaster_token))
    assert reg.status_code == 200, reg.text
    reg = reg.json()
    yield club, name, boat, reg
    requests.delete(f"{API}/regattas/{reg['id']}", headers=h(webmaster_token))
    requests.delete(f"{API}/boats/{boat['id']}", headers=h(webmaster_token))
    requests.delete(f"{API}/classes/{cls['id']}", headers=h(webmaster_token))
    requests.delete(f"{API}/clubs/{club['id']}", headers=h(webmaster_token))


def test_rename_reslugs_and_propagates(webmaster_token, rename_club):
    club, old_name, boat, reg = rename_club
    new_name = f"Seafarers SC {uuid.uuid4().hex[:4]}"
    r = requests.put(f"{API}/clubs/{club['id']}", json={"name": new_name, "color": "#123456"},
                     headers=h(webmaster_token))
    assert r.status_code == 200, r.text
    body = r.json()
    # The handle follows the new name...
    assert body["slug"] == slugify(new_name)
    # ...and the stored name references follow it too.
    regattas = requests.get(f"{API}/regattas", params={"club_id": club["id"]},
                            headers=h(webmaster_token)).json()
    assert any(x["id"] == reg["id"] and x["host_club"] == new_name for x in regattas)
    boats = requests.get(f"{API}/boats", params={"class_id": boat["class_id"]},
                         headers=h(webmaster_token)).json()
    assert any(x["id"] == boat["id"] and x["home_club"] == new_name for x in boats)


def test_rename_keeps_slug_unique(webmaster_token):
    """Renaming onto another club's slug gets a unique suffix — the other
    club's slug is never clobbered."""
    a = _make_club(webmaster_token, f"Rename Collide A {uuid.uuid4().hex[:4]}")
    b = _make_club(webmaster_token, f"Rename Collide B {uuid.uuid4().hex[:4]}")
    try:
        r = requests.put(f"{API}/clubs/{a['id']}", json={"name": b["name"], "color": "#123456"},
                         headers=h(webmaster_token))
        assert r.status_code == 200, r.text
        slug_a = r.json()["slug"]
        assert slug_a != b["slug"]
        assert slug_a.startswith(slugify(b["name"]) + "-")
        # Club B is untouched.
        assert b["slug"] == slugify(b["name"])
    finally:
        requests.delete(f"{API}/clubs/{a['id']}", headers=h(webmaster_token))
        requests.delete(f"{API}/clubs/{b['id']}", headers=h(webmaster_token))


def test_rename_same_name_keeps_slug(webmaster_token, rename_club):
    club, old_name, boat, reg = rename_club
    r = requests.put(f"{API}/clubs/{club['id']}", json={"name": old_name, "color": "#123456"},
                     headers=h(webmaster_token))
    assert r.status_code == 200, r.text
    assert r.json()["slug"] == club["slug"]
