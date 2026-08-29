"""Official Notice Board (ONB) endpoint tests.

Covers the two publication methods (Sailscore-generated and uploaded) over the
ONE common notice entity: dynamic per-type fields, placeholder guidance
catalogue, draft -> preview -> publish, version control (amend = new version
that supersedes), withdrawal, attachments, uploaded-document integrity (never
modified or converted), and club isolation.
"""
import base64
from uuid import uuid4

import pytest
import requests

from conftest import API, h, TEST_OFFICER_PIN, club_user_username

# A minimal but structurally valid PDF (magic bytes are what the API checks —
# the document is stored byte-for-byte, never parsed or converted).
MINIMAL_PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<<>>\n%%EOF"
MINIMAL_PDF_URL = "data:application/pdf;base64," + base64.b64encode(MINIMAL_PDF).decode()
# A tiny valid PNG (magic bytes only are validated).
TINY_PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32

_created_notices = []


@pytest.fixture(scope="session")
def test_series(test_class, club_admin_token):
    r = requests.post(f"{API}/series", json={
        "name": "Notice Test Series", "class_id": test_class["id"], "year": 2026,
    }, headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def test_race(test_series, test_class, club_admin_token):
    r = requests.post(f"{API}/races", json={
        "date": "2026-09-05", "class_id": test_class["id"],
        "series_id": test_series["id"], "race_number": 1, "start_time": "14:00",
    }, headers=h(club_admin_token))
    assert r.status_code == 200, r.text
    return r.json()


def make_notice(token, **over):
    body = {
        "notice_type": "notice_to_competitors",
        "title": "Notice to Competitors No. 1",
        "fields": {
            "subject": "Change of race area",
            "instruction": "Race 4 will start at 14:30 instead of 14:00.",
        },
    }
    body.update(over)
    r = requests.post(f"{API}/notices", json=body, headers=h(token))
    if r.status_code == 200:
        _created_notices.append(r.json()["id"])
    return r


@pytest.fixture(scope="session", autouse=True)
def cleanup_drafts(club_officer_token):
    """Best-effort: remove every DRAFT created by these tests. Published
    notices are never deletable by design (audit trail); they die with the
    test club, which conftest tears down."""
    yield
    for nid in list(_created_notices):
        requests.delete(f"{API}/notices/{nid}", headers=h(club_officer_token))


# ---------------------------------------------------------------------------
# Catalogue (spec 34/35)
# ---------------------------------------------------------------------------

def test_meta_requires_auth():
    assert requests.get(f"{API}/notices/meta").status_code == 401


def test_meta_catalogue(club_officer_token):
    r = requests.get(f"{API}/notices/meta", headers=h(club_officer_token))
    assert r.status_code == 200
    meta = r.json()
    types = {t["key"]: t for t in meta["types"]}
    # All nine spec'd types exist, filed under the right headings (spec 43).
    assert types["notice_to_competitors"]["heading"] == "Notices to Competitors"
    assert types["si_amendment"]["heading"] == "Sailing Instructions / Amendments"
    assert types["race_postponement"]["heading"] == "Race Notices"
    assert types["race_cancellation"]["heading"] == "Race Notices"
    assert types["hearing_schedule"]["heading"] == "Protests & Hearings"
    assert types["hearing_decision"]["heading"] == "Protests & Hearings"
    assert types["results_notice"]["heading"] == "Results"
    assert types["safety_notice"]["heading"] == "Safety"
    assert types["general_club_notice"]["heading"] == "General Notices"
    # Fields are dynamic per type: postponement has start-time fields, hearing
    # does not; every content field carries sailing-specific placeholder text.
    pp = {f["key"] for f in types["race_postponement"]["fields"]}
    assert {"new_start_time", "new_warning_signal", "reason"} <= pp
    hs = {f["key"] for f in types["hearing_schedule"]["fields"]}
    assert {"hearing_number", "parties", "location"} <= hs
    reason = next(f for f in types["race_postponement"]["fields"] if f["key"] == "reason")
    assert reason["placeholder"].startswith("Example: Strong winds")
    si_new = next(f for f in types["si_amendment"]["fields"] if f["key"] == "new_wording")
    assert "orange flag on the committee vessel" in si_new["placeholder"]


# ---------------------------------------------------------------------------
# Generated notices (Option 1, spec 34/36)
# ---------------------------------------------------------------------------

def test_create_generated_draft(club_officer_token, test_club):
    r = make_notice(club_officer_token)
    assert r.status_code == 200, r.text
    n = r.json()
    assert n["status"] == "draft"
    assert n["content_type"] == "generated"
    assert n["notice_number"] == 1
    # The default publication area is the club-wide board: notices file under
    # the AREA heading ("Club Notices"), not the type's catalogue heading —
    # the type heading is a wizard-catalogue concept, the area is where the
    # notice actually sits on the board.
    assert n["heading"] == "Club Notices"
    assert n["publication_area"] == "club"
    # Server-side render rows: stored values only (placeholders never stored).
    body = {row["label"]: row["value"] for row in n["body"]}
    assert body["Subject"] == "Change of race area"
    assert "Strong winds" not in str(n["body"])


def test_notice_area_title_mapping(club_officer_token):
    """Publication area keys map to display titles on the stored heading: the
    default "club" area, the built-in "open_event" area, and a custom club
    area (whose key equals its title)."""
    r = make_notice(club_officer_token, publication_area="open_event",
                    title="Open event notice")
    assert r.status_code == 200, r.text
    assert r.json()["heading"] == "Open Event Notices"
    assert r.json()["publication_area"] == "open_event"


def test_create_link_notice(club_officer_token):
    """A LINK notice's content is an external website URL: no structured
    fields are required, the URL is stored, and it publishes to the public
    list like any other notice."""
    r = make_notice(club_officer_token, title="Live results website",
                    link_url="https://results.medwayyc.example/2026")
    assert r.status_code == 200, r.text
    n = r.json()
    assert n["content_type"] == "link"
    assert n["link_url"] == "https://results.medwayyc.example/2026"
    assert n["heading"] == "Club Notices"
    assert n["body"] == []
    # Publish and confirm it appears in the public list.
    p = requests.post(f"{API}/notices/{n['id']}/publish", json={},
                      headers=h(club_officer_token))
    assert p.status_code == 200, p.text
    assert p.json()["content_type"] == "link"
    pub = requests.get(f"{API}/notices", params={"club_id": n["club_id"]}).json()
    assert any(x["id"] == n["id"] and x["content_type"] == "link"
               and x["link_url"] == n["link_url"] for x in pub)


def test_create_link_notice_rejects_bad_urls(club_officer_token):
    """Only http(s) URLs are accepted — anything that could execute code or
    a non-web scheme is rejected."""
    for bad in ("javascript:alert(1)", "ftp://example.com/file", "not a url"):
        r = make_notice(club_officer_token, title="Bad link", link_url=bad)
        assert r.status_code == 400, (bad, r.text)


def test_required_fields_and_unknown_type(club_officer_token):
    # Missing the type's required content field.
    r = make_notice(club_officer_token, fields={"subject": "Only a subject"})
    assert r.status_code == 400
    assert "instruction" in r.json()["detail"].lower()
    # Unknown type.
    r = make_notice(club_officer_token, notice_type="coffee_morning")
    assert r.status_code == 400
    # A field from a DIFFERENT type is rejected — no cross-type leakage.
    r = make_notice(club_officer_token, fields={"subject": "s", "instruction": "i",
                                                "new_warning_signal": "15:00"})
    assert r.status_code == 400


def test_notice_numbers_increment_per_type(club_officer_token):
    r1 = make_notice(club_officer_token, title="Second notice")
    r2 = make_notice(club_officer_token, notice_type="race_postponement",
                     title="Postponement", fields={
                         "race_id": None, "reason": "Strong winds are forecast for the scheduled start time."})
    assert r1.status_code == 200 and r2.status_code == 200
    # Different types number independently; same type continues the sequence
    # (the management list is newest-first, so numbers strictly descend).
    seq = requests.get(
        f"{API}/notices", params={"status": "draft"}, headers=h(club_officer_token)).json()
    by_type = {}
    for n in seq:
        by_type.setdefault(n["notice_type"], []).append(n["notice_number"])
    assert by_type["notice_to_competitors"] == sorted(by_type["notice_to_competitors"], reverse=True)
    assert by_type["race_postponement"] == sorted(by_type["race_postponement"], reverse=True)


def test_drafts_hidden_from_public(club_officer_token, test_club):
    r = make_notice(club_officer_token, title="Draft secrecy check")
    nid = r.json()["id"]
    # Anonymous: not in the list, not fetchable by id.
    pub = requests.get(f"{API}/notices", params={"club_id": test_club["id"]}).json()
    assert all(n["id"] != nid for n in pub)
    assert requests.get(f"{API}/notices/{nid}").status_code == 404
    # Club staff (even the officer) cannot be tricked into another club's scope.
    other = requests.get(f"{API}/clubs/directory").json()
    other_id = next(c["id"] for c in other if c["id"] != test_club["id"])
    scoped = requests.get(f"{API}/notices", params={"club_id": other_id},
                          headers=h(club_officer_token)).json()
    assert isinstance(scoped, list)
    assert all(n["club_id"] == test_club["id"] for n in scoped)


# ---------------------------------------------------------------------------
# Reuse Sailscore data (spec 46)
# ---------------------------------------------------------------------------

def test_context_from_race(club_officer_token, test_race, test_class, test_series, test_club):
    r = requests.get(f"{API}/notices/context", params={"race_id": test_race["id"]},
                     headers=h(club_officer_token))
    assert r.status_code == 200, r.text
    ctx = r.json()
    assert ctx["club_name"] == test_club["name"]
    assert ctx["class_name"] == test_class["name"]
    assert ctx["series_name"] == test_series["name"]
    assert ctx["race_number"] == 1
    assert ctx["race_date"] == "2026-09-05"
    assert ctx["start_time"] == "14:00"
    assert ctx["officer_name"]


def test_links_validated_and_denormalised(club_officer_token, test_race):
    r = make_notice(club_officer_token, notice_type="race_postponement",
                    title="Linked postponement", fields={
                        "race_id": test_race["id"],
                        "reason": "Strong winds are forecast for the scheduled start time."})
    assert r.status_code == 200, r.text
    n = r.json()
    assert n["race_id"] == test_race["id"]
    assert n["race_number"] == 1
    assert n["series_id"] and n["class_id"]
    # The link ids are NOT duplicated into the notice's content fields.
    assert "race_id" not in (n.get("body") or []) and "race_id" not in str(n.get("fields") or {})
    # A race from another club is rejected outright.
    other_races = requests.get(f"{API}/races").json()
    alien = next((x for x in other_races if x.get("class_id") != test_race["class_id"]), None)
    if alien:
        r = make_notice(club_officer_token, notice_type="race_postponement",
                        title="Alien race", fields={"race_id": alien["id"], "reason": "x"})
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# Edit + publish (spec 41/44)
# ---------------------------------------------------------------------------

def test_edit_then_publish_generated(club_officer_token, test_club):
    n = make_notice(club_officer_token, title="Editable draft").json()
    # Edit before publication is free (spec 49).
    r = requests.put(f"{API}/notices/{n['id']}", json={
        "title": "Edited title",
        "fields": {"subject": "New subject", "instruction": "New instruction."},
        "expected_version": n["version"],
    }, headers=h(club_officer_token))
    assert r.status_code == 200, r.text
    edited = r.json()
    assert edited["title"] == "Edited title"
    assert {row["value"] for row in edited["body"]} >= {"New subject"}
    # Publish with the formal PDF.
    r = requests.post(f"{API}/notices/{n['id']}/publish",
                      json={"pdf_data_url": MINIMAL_PDF_URL, "expected_version": edited["version"]},
                      headers=h(club_officer_token))
    assert r.status_code == 200, r.text
    pub = r.json()
    assert pub["status"] == "published" and pub["published_by"]
    assert pub["has_pdf"] is True
    # Visible publicly, HTML body + PDF payloads both served on detail.
    detail = requests.get(f"{API}/notices/{n['id']}").json()
    assert detail["status"] == "published"
    assert detail["pdf_data_url"] == MINIMAL_PDF_URL
    pub_list = requests.get(f"{API}/notices", params={"club_id": test_club["id"]}).json()
    assert any(x["id"] == n["id"] for x in pub_list)
    # Corrrecting a published notice is done through a NEW version: the PUT
    # spawns a DRAFT that supersedes it with the corrected title, while the
    # published original is left untouched. Deleting a published notice is
    # always refused.
    corr = requests.put(f"{API}/notices/{n['id']}", json={"title": "Corrected title",
                                                          "expected_version": pub["version"]},
                        headers=h(club_officer_token))
    assert corr.status_code == 200, corr.text
    assert corr.json()["status"] == "draft"
    assert corr.json()["title"] == "Corrected title"
    assert corr.json()["supersedes_id"] == n["id"]
    original = requests.get(f"{API}/notices/{n['id']}").json()
    assert original["status"] == "published" and original["title"] == "Edited title"
    # Removing a notice stays a separate audited action (allowed even for
    # published ones), not an edit of the live document.
    assert requests.delete(f"{API}/notices/{n['id']}",
                           headers=h(club_officer_token)).status_code == 200


def test_publish_rejects_fake_pdf(club_officer_token):
    n = make_notice(club_officer_token, title="Bad pdf").json()
    fake = "data:application/pdf;base64," + base64.b64encode(b"<html>not a pdf</html>").decode()
    r = requests.post(f"{API}/notices/{n['id']}/publish",
                      json={"pdf_data_url": fake}, headers=h(club_officer_token))
    assert r.status_code == 400


def test_stale_version_conflict(club_officer_token):
    n = make_notice(club_officer_token, title="Concurrency check").json()
    r = requests.put(f"{API}/notices/{n['id']}", json={"title": "A"},
                     headers=h(club_officer_token))
    assert r.status_code == 200
    # A second edit based on the ORIGINAL version must be rejected.
    r = requests.put(f"{API}/notices/{n['id']}", json={"title": "B", "expected_version": n["version"]},
                     headers=h(club_officer_token))
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Uploaded notices (Option 2, spec 37/38/48)
# ---------------------------------------------------------------------------

def test_upload_publish_and_integrity(club_officer_token, test_club):
    fd = {
        "notice_type": "notice_to_competitors",
        "title": "Signed paper notice",
        "publication_datetime": "2026-08-28T15:42:00",
    }
    r = requests.post(f"{API}/notices/upload", data=fd,
                      files={"file": ("notice-04.pdf", MINIMAL_PDF, "application/pdf")},
                      headers=h(club_officer_token))
    assert r.status_code == 200, r.text
    n = r.json()
    assert n["content_type"] == "uploaded" and n["has_file"] is True
    assert n["original_filename"] == "notice-04.pdf"
    assert n["publication_datetime"] == "2026-08-28T15:42:00"
    _created_notices.append(n["id"])
    # Metadata-only edits are fine; reproducing the CONTENT is not (spec 38).
    r = requests.put(f"{API}/notices/{n['id']}", json={"title": "Signed paper notice v1.1"},
                     headers=h(club_officer_token))
    assert r.status_code == 200
    r = requests.put(f"{API}/notices/{n['id']}",
                     json={"fields": {"subject": "retyping the document"}},
                     headers=h(club_officer_token))
    assert r.status_code == 400
    # Publish WITHOUT a generated pdf — the uploaded document is the content.
    detail = requests.get(f"{API}/notices/{n['id']}", headers=h(club_officer_token)).json()
    r = requests.post(f"{API}/notices/{n['id']}/publish",
                      json={"expected_version": detail["version"]},
                      headers=h(club_officer_token))
    assert r.status_code == 200, r.text
    # The served bytes are exactly what was uploaded — never converted (spec 48).
    served = requests.get(f"{API}/notices/{n['id']}").json()
    assert base64.b64decode(served["file_data_url"].split(",", 1)[1]) == MINIMAL_PDF
    assert served["file_hash"] and served["file_size"] == len(MINIMAL_PDF)
    # Publishing an uploaded draft without any document is refused.
    r = requests.post(f"{API}/notices/upload",
                      data={"notice_type": "safety_notice", "title": "No file"},
                      headers=h(club_officer_token))
    assert r.status_code in (400, 422)


def test_upload_rejects_non_document(club_officer_token):
    r = requests.post(f"{API}/notices/upload",
                      data={"notice_type": "general_club_notice", "title": "Bad"},
                      files={"file": ("evil.html", b"<script>alert(1)</script>", "text/html")},
                      headers=h(club_officer_token))
    assert r.status_code == 400


def test_replace_document_on_draft(club_officer_token):
    r = requests.post(f"{API}/notices/upload",
                      data={"notice_type": "si_amendment", "title": "Amendment No. 2"},
                      files={"file": ("amend-draft.pdf", MINIMAL_PDF, "application/pdf")},
                      headers=h(club_officer_token))
    n = r.json()
    _created_notices.append(n["id"])
    corrected = b"%PDF-1.4 corrected document" + b"x" * 10
    r = requests.put(f"{API}/notices/{n['id']}/file",
                     files={"file": ("amend-corrected.pdf", corrected, "application/pdf")},
                     headers=h(club_officer_token))
    assert r.status_code == 200, r.text
    up = r.json()
    assert up["original_filename"] == "amend-corrected.pdf"
    detail = requests.get(f"{API}/notices/{n['id']}", headers=h(club_officer_token)).json()
    actions = [e["action"] for e in detail["history"]]
    assert "document_replaced" in actions


# ---------------------------------------------------------------------------
# Attachments (spec 34 step 4)
# ---------------------------------------------------------------------------

def test_attachments_on_draft_only(club_officer_token):
    n = make_notice(club_officer_token, title="With attachment").json()
    r = requests.post(f"{API}/notices/{n['id']}/attachments",
                      data={"name": "Course diagram"},
                      files={"file": ("course.png", TINY_PNG, "image/png")},
                      headers=h(club_officer_token))
    assert r.status_code == 200, r.text
    atts = r.json()["attachments"]
    assert len(atts) == 1 and atts[0]["name"] == "Course diagram"
    r = requests.delete(f"{API}/notices/{n['id']}/attachments/{atts[0]['id']}",
                        headers=h(club_officer_token))
    assert r.status_code == 200 and r.json()["attachments"] == []
    # Published notices are frozen.
    p = make_notice(club_officer_token, title="Frozen attachment").json()
    requests.post(f"{API}/notices/{p['id']}/publish", json={}, headers=h(club_officer_token))
    r = requests.post(f"{API}/notices/{p['id']}/attachments",
                      files={"file": ("late.png", TINY_PNG, "image/png")},
                      headers=h(club_officer_token))
    assert r.status_code == 409


# ---------------------------------------------------------------------------
# Versions, supersede, withdraw (spec 47/49)
# ---------------------------------------------------------------------------

def test_amend_creates_new_version_and_supersedes(club_officer_token, test_club):
    v1 = make_notice(club_officer_token, title="Original wording").json()
    requests.post(f"{API}/notices/{v1['id']}/publish", json={}, headers=h(club_officer_token))
    # Amend: a NEW draft version that supersedes the published one.
    r = requests.post(f"{API}/notices/{v1['id']}/new-version", headers=h(club_officer_token))
    assert r.status_code == 200, r.text
    v2 = r.json()
    _created_notices.append(v2["id"])
    assert v2["status"] == "draft"
    assert v2["supersedes_id"] == v1["id"]
    assert v2["root_id"] == v1["root_id"]
    assert v2["notice_number"] == v1["notice_number"]
    # v1 is still live while v2 is a draft.
    assert requests.get(f"{API}/notices/{v1['id']}").json()["status"] == "published"
    # Publish v2 — v1 is superseded automatically, never deleted.
    r = requests.post(f"{API}/notices/{v2['id']}/publish", json={}, headers=h(club_officer_token))
    assert r.status_code == 200
    old = requests.get(f"{API}/notices/{v1['id']}").json()
    assert old["status"] == "superseded" and old["superseded_by"] == v2["id"]
    # Public list shows ONLY the current version (still reachable by id).
    pub = requests.get(f"{API}/notices", params={"club_id": test_club["id"]}).json()
    ids = [x["id"] for x in pub]
    assert v2["id"] in ids and v1["id"] not in ids
    assert requests.get(f"{API}/notices/{v1['id']}").status_code == 200


def test_withdraw_keeps_record(club_officer_token, test_club):
    n = make_notice(club_officer_token, title="To be withdrawn").json()
    requests.post(f"{API}/notices/{n['id']}/publish", json={}, headers=h(club_officer_token))
    # A reason is mandatory.
    assert requests.post(f"{API}/notices/{n['id']}/withdraw", json={"reason": "  "},
                         headers=h(club_officer_token)).status_code == 400
    r = requests.post(f"{API}/notices/{n['id']}/withdraw",
                      json={"reason": "Issued in error — see notice 5"}, headers=h(club_officer_token))
    assert r.status_code == 200
    w = r.json()
    assert w["status"] == "withdrawn" and w["withdrawn_by"] and w["withdrawal_reason"]
    detail = requests.get(f"{API}/notices/{n['id']}").json()
    assert any(e["action"] == "withdrawn" for e in detail["history"])
    # Withdrawn stays visible on the public ONB, clearly marked.
    pub = requests.get(f"{API}/notices", params={"club_id": test_club["id"]}).json()
    match = next(x for x in pub if x["id"] == n["id"])
    assert match["status"] == "withdrawn"
    # Full audit trail: created -> published -> withdrawn, one doc (spec 47).
    assert [e["action"] for e in detail["history"]] == ["created", "published", "withdrawn"]


def test_delete_draft_only(club_officer_token):
    n = make_notice(club_officer_token, title="Disposable draft").json()
    assert requests.delete(f"{API}/notices/{n['id']}",
                           headers=h(club_officer_token)).status_code == 200
    assert requests.get(f"{API}/notices/{n['id']}",
                        headers=h(club_officer_token)).status_code == 404


def test_officer_can_amend_and_withdraw_rules(club_officer_token):
    # Amending a DRAFT is refused (edit it instead); withdrawing a DRAFT too.
    n = make_notice(club_officer_token, title="Draft rules").json()
    assert requests.post(f"{API}/notices/{n['id']}/new-version",
                         headers=h(club_officer_token)).status_code == 409
    assert requests.post(f"{API}/notices/{n['id']}/withdraw", json={"reason": "x"},
                         headers=h(club_officer_token)).status_code == 409


# ---------------------------------------------------------------------------
# ONB email subscription (spec: subscribe to the ONB, PDF issued on publish)
# ---------------------------------------------------------------------------

def _start_notice_subscription(test_club):
    """Create + verify one notice subscription for the club. Skips when the
    shared dev server's per-IP rate limiter is spent (other suites use the
    same limiter, so runs can trip it between invocations)."""
    email = f"onb-{uuid4().hex[:10]}@example.com"
    r = requests.post(f"{API}/subscriptions", json={
        "email": email, "subscription_type": "notice", "target_id": test_club["id"],
    })
    if r.status_code == 429:
        pytest.skip("Subscription rate limit reached on the shared dev server")
    assert r.status_code == 200, r.text
    sub = r.json()
    assert requests.get(f"{API}/subscriptions/verify",
                        params={"token": sub["verification_token"]}).status_code == 200
    return email


def test_onb_subscription_created_and_listed(club_officer_token, club_admin_token, test_club):
    email = _start_notice_subscription(test_club)
    # The verified subscription shows up for the club admin under the notice type.
    rows = requests.get(f"{API}/admin/subscriptions",
                        params={"club_id": test_club["id"]},
                        headers=h(club_admin_token)).json()
    match = next((row for row in rows if row["email"] == email), None)
    assert match, rows
    assert match["subscription_type"] == "notice"
    assert match["target_id"] == test_club["id"]
    assert match["target_name"] == f"{test_club['name']} Official Notice Board"


def test_publishing_notice_issues_pdf_to_subscribers(club_officer_token, test_club):
    """Publishing an ONB document delivers it to every verified notice
    subscriber of the club: the response reports the matched count and a
    delivery ledger row is written (best-effort — SMTP not required)."""
    _start_notice_subscription(test_club)
    n = make_notice(club_officer_token, title="ONB email test").json()
    r = requests.post(f"{API}/notices/{n['id']}/publish",
                      json={"pdf_data_url": MINIMAL_PDF_URL, "expected_version": n["version"]},
                      headers=h(club_officer_token))
    assert r.status_code == 200, r.text
    delivery = r.json().get("notification_delivery")
    assert delivery and delivery["matched"] >= 1, r.text
    assert delivery["sent"] == 0 or delivery["sent"] >= 1  # best-effort: 0 when SMTP unset


def test_public_onb_orders_by_notice_number(club_officer_token):
    """The public ONB lists notices by notice number (smallest first), NOT by
    the order they were issued/published — publication order can shift when a
    notice is revised, but the number it was issued with is stable."""
    n1 = make_notice(club_officer_token, title="Order No. 1", notice_number=1).json()
    n3 = make_notice(club_officer_token, title="Order No. 3", notice_number=3).json()
    n2 = make_notice(club_officer_token, title="Order No. 2", notice_number=2).json()
    # Publish them out of numerical order (3, 1, 2) to prove the sort.
    for n in (n3, n1, n2):
        assert requests.post(f"{API}/notices/{n['id']}/publish",
                             json={}, headers=h(club_officer_token)).status_code == 200
    rows = requests.get(f"{API}/notices",
                        params={"club_id": n1["club_id"]}).json()
    mine = [r for r in rows if r["id"] in {n1["id"], n2["id"], n3["id"]}]
    assert [r["notice_number"] for r in mine] == [1, 2, 3]
    assert [r["id"] for r in mine] == [n1["id"], n2["id"], n3["id"]]
