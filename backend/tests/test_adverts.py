"""Live-API tests for webmaster-managed adverts shown on public pages.

Adverts are platform-level (not club-scoped): the webmaster creates them and
they appear interleaved on the home page and public results pages. Only the
webmaster may manage them; the public endpoint returns active adverts only.
"""

import io as _io
import uuid

import requests

from conftest import API, h

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _advert_file():
    return _io.BytesIO(PNG)


def _create_advert(token, name, active="true", link_url=""):
    r = requests.post(f"{API}/adverts",
                      files={"file": ("ad.png", _advert_file(), "image/png")},
                      data={"name": name, "link_url": link_url, "active": active},
                      headers=h(token))
    assert r.status_code == 200, r.text
    return r.json()


class TestAdvertsCrud:
    def test_webmaster_create_manage_delete(self, webmaster_token):
        name = f"Test Ad {uuid.uuid4().hex[:6]}"
        ad = _create_advert(webmaster_token, name, active="true", link_url="https://example.com")
        try:
            assert ad["name"] == name
            assert ad["link_url"] == "https://example.com"
            assert ad["active"] is True
            assert ad["image"].startswith("data:image/png;base64,")
            assert "order" in ad

            manage = requests.get(f"{API}/adverts/manage", headers=h(webmaster_token)).json()
            assert any(a["id"] == ad["id"] for a in manage)

            # Deactivate -> hidden from the public feed.
            r = requests.put(f"{API}/adverts/{ad['id']}", json={"active": False},
                             headers=h(webmaster_token))
            assert r.status_code == 200
            pub = requests.get(f"{API}/adverts").json()
            assert all(a["id"] != ad["id"] for a in pub)

            # Reactivate + rename.
            r = requests.put(f"{API}/adverts/{ad['id']}", json={"active": True, "name": name + " v2"},
                             headers=h(webmaster_token))
            assert r.status_code == 200 and r.json()["name"] == name + " v2"
        finally:
            requests.delete(f"{API}/adverts/{ad['id']}", headers=h(webmaster_token))

    def test_public_feed_active_only(self, webmaster_token):
        name = f"Active Ad {uuid.uuid4().hex[:6]}"
        ad = _create_advert(webmaster_token, name)
        try:
            pub = requests.get(f"{API}/adverts").json()
            hit = next((a for a in pub if a["id"] == ad["id"]), None)
            assert hit is not None
            # Public payload never leaks internal fields.
            for key in ("active", "order", "created_at"):
                assert key not in hit
        finally:
            requests.delete(f"{API}/adverts/{ad['id']}", headers=h(webmaster_token))

    def test_admin_and_officer_cannot_manage(self, club_admin_token, club_officer_token, webmaster_token):
        for token in (club_admin_token, club_officer_token):
            r = requests.post(f"{API}/adverts",
                              files={"file": ("ad.png", _advert_file(), "image/png")},
                              data={"name": "Nope", "active": "true"}, headers=h(token))
            assert r.status_code == 403, r.text
            r = requests.get(f"{API}/adverts/manage", headers=h(token))
            assert r.status_code == 403
        # Public feed needs no auth at all.
        assert requests.get(f"{API}/adverts").status_code == 200
