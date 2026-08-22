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


def _create_advert(token, name, active="true", link_url="", format="auto"):
    r = requests.post(f"{API}/adverts",
                      files={"file": ("ad.png", _advert_file(), "image/png")},
                      data={"name": name, "link_url": link_url, "active": active, "format": format},
                      headers=h(token))
    assert r.status_code == 200, r.text
    return r.json()


def _create_advert_shaped(token, name, shapes=("landscape", "portrait", "square"), **kw):
    files = {f"file_{s}": (f"{s}.png", _advert_file(), "image/png") for s in shapes}
    r = requests.post(f"{API}/adverts",
                      files=files,
                      data={"name": name, **kw},
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
            assert ad["format"] == "auto"

            manage = requests.get(f"{API}/adverts/manage", headers=h(webmaster_token)).json()
            assert any(a["id"] == ad["id"] for a in manage)

            # Deactivate -> hidden from the public feed.
            r = requests.put(f"{API}/adverts/{ad['id']}", json={"active": False},
                             headers=h(webmaster_token))
            assert r.status_code == 200
            pub = requests.get(f"{API}/adverts").json()
            assert all(a["id"] != ad["id"] for a in pub)

            # Reactivate + rename + change shape.
            r = requests.put(f"{API}/adverts/{ad['id']}",
                             json={"active": True, "name": name + " v2", "format": "landscape"},
                             headers=h(webmaster_token))
            assert r.status_code == 200
            assert r.json()["name"] == name + " v2"
            assert r.json()["format"] == "landscape"

            # Public feed carries the shape through.
            pub = requests.get(f"{API}/adverts").json()
            hit = next((a for a in pub if a["id"] == ad["id"]), None)
            assert hit and hit["format"] == "landscape"

            # Invalid shape is rejected.
            r = requests.put(f"{API}/adverts/{ad['id']}", json={"format": "circle"},
                             headers=h(webmaster_token))
            assert r.status_code == 400
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


    def test_named_shapes_round_trip(self, webmaster_token):
        for shape in ("landscape", "portrait", "square"):
            name = f"Shape {shape} {uuid.uuid4().hex[:4]}"
            ad = _create_advert(webmaster_token, name, format=shape)
            try:
                assert ad["format"] == shape
                pub = requests.get(f"{API}/adverts").json()
                hit = next((a for a in pub if a["id"] == ad["id"]), None)
                assert hit and hit["format"] == shape
            finally:
                requests.delete(f"{API}/adverts/{ad['id']}", headers=h(webmaster_token))

    def test_multiple_images_per_shape(self, webmaster_token):
        """An advert can carry three images — landscape, portrait, square —
        each uploaded separately and all exposed on the public feed."""
        name = f"Multi Ad {uuid.uuid4().hex[:6]}"
        ad = _create_advert_shaped(webmaster_token, name)
        try:
            assert set(ad["images"]) == {"landscape", "portrait", "square"}
            for s in ("landscape", "portrait", "square"):
                assert ad["images"][s].startswith("data:image/png;base64,")
            pub = requests.get(f"{API}/adverts").json()
            hit = next((a for a in pub if a["id"] == ad["id"]), None)
            assert hit and set(hit["images"]) == {"landscape", "portrait", "square"}
        finally:
            requests.delete(f"{API}/adverts/{ad['id']}", headers=h(webmaster_token))

    def test_replace_single_shape_image(self, webmaster_token):
        """PUT /adverts/{id}/images replaces only the supplied shape; other
        shapes keep their existing image."""
        name = f"Replace Ad {uuid.uuid4().hex[:6]}"
        ad = _create_advert_shaped(webmaster_token, name, shapes=("landscape", "square"))
        try:
            r = requests.put(f"{API}/adverts/{ad['id']}/images",
                             files={"file_portrait": ("p.png", _advert_file(), "image/png")},
                             headers=h(webmaster_token))
            assert r.status_code == 200, r.text
            assert set(r.json()["images"]) == {"landscape", "portrait", "square"}
            # the pre-existing landscape image is untouched
            assert r.json()["images"]["landscape"] == ad["images"]["landscape"]
        finally:
            requests.delete(f"{API}/adverts/{ad['id']}", headers=h(webmaster_token))

    def test_legacy_single_image_still_works(self, webmaster_token):
        """The original single-file upload path keeps working and is mirrored
        into the landscape image so new cards can display it."""
        name = f"Legacy Ad {uuid.uuid4().hex[:6]}"
        ad = _create_advert(webmaster_token, name)
        try:
            assert ad["image"].startswith("data:image/png;base64,")
            assert ad["images"]["landscape"].startswith("data:image/png;base64,")
            pub = requests.get(f"{API}/adverts").json()
            hit = next((a for a in pub if a["id"] == ad["id"]), None)
            assert hit and hit["image"].startswith("data:image/png;base64,")
        finally:
            requests.delete(f"{API}/adverts/{ad['id']}", headers=h(webmaster_token))
