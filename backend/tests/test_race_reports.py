"""Race report publishing (uploaded documents and website links) and public
class archive endpoint coverage."""
import base64

import pytest
import requests

from conftest import API, h

MINIMAL_PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<<>>\n%%EOF"


@pytest.fixture(scope="session")
def report_series(test_class, club_admin_token):
    response = requests.post(f"{API}/series", json={
        "name": "Race Report Test Series",
        "class_id": test_class["id"],
        "year": 2026,
    }, headers=h(club_admin_token))
    assert response.status_code == 200, response.text
    return response.json()


def test_race_report_admin_upload_and_public_class_archive(
        report_series, test_class, club_admin_token, club_officer_token):
    # Uploading is a race-admin capability; officers cannot create reports.
    denied = requests.post(
        f"{API}/race-reports/upload",
        data={"series_id": report_series["id"], "title": "Officer upload"},
        files={"file": ("report.pdf", MINIMAL_PDF, "application/pdf")},
        headers=h(club_officer_token),
    )
    assert denied.status_code == 403

    uploaded = requests.post(
        f"{API}/race-reports/upload",
        data={"series_id": report_series["id"], "title": "Spring race report"},
        files={"file": ("spring-report.pdf", MINIMAL_PDF, "application/pdf")},
        headers=h(club_admin_token),
    )
    assert uploaded.status_code == 200, uploaded.text
    report = uploaded.json()
    assert report["series_id"] == report_series["id"]
    assert report["class_id"] == test_class["id"]
    assert report["title"] == "Spring race report"
    assert "file_data_url" not in report

    public_list = requests.get(
        f"{API}/classes/{test_class['id']}/race-reports").json()
    assert any(item["id"] == report["id"] for item in public_list)

    document = requests.get(f"{API}/race-reports/{report['id']}")
    assert document.status_code == 200
    assert base64.b64decode(document.json()["file_data_url"].split(",", 1)[1]) == MINIMAL_PDF

    removed = requests.delete(
        f"{API}/race-reports/{report['id']}", headers=h(club_admin_token))
    assert removed.status_code == 200
    assert all(item["id"] != report["id"] for item in requests.get(
        f"{API}/classes/{test_class['id']}/race-reports").json())


def test_race_report_can_point_at_a_website(report_series, test_class,
                                           club_admin_token, club_officer_token):
    payload = {"series_id": report_series["id"], "title": "Club website report",
               "url": "https://medwayyc.org/reports/summer-2026"}

    # Publishing a report is a race-admin capability whichever kind it is.
    denied = requests.post(f"{API}/race-reports/link", json=payload,
                           headers=h(club_officer_token))
    assert denied.status_code == 403

    created = requests.post(f"{API}/race-reports/link", json=payload,
                            headers=h(club_admin_token))
    assert created.status_code == 200, created.text
    report = created.json()
    assert report["link_url"] == payload["url"]
    assert report["series_id"] == report_series["id"]
    assert report["class_id"] == test_class["id"]
    # A website report stores no document of ours at all.
    assert report["file_size"] is None and report["file_type"] is None
    assert "file_data_url" not in report

    listed = next(item for item in requests.get(
        f"{API}/classes/{test_class['id']}/race-reports").json()
        if item["id"] == report["id"])
    assert listed["link_url"] == payload["url"]

    # Fetching it returns the link rather than any bytes, so the public page
    # can hand the visitor straight to the host.
    served = requests.get(f"{API}/race-reports/{report['id']}").json()
    assert served["link_url"] == payload["url"]
    assert served["file_data_url"] is None

    removed = requests.delete(
        f"{API}/race-reports/{report['id']}", headers=h(club_admin_token))
    assert removed.status_code == 200


def test_race_report_link_rejects_non_web_addresses(report_series, club_admin_token):
    for url in ("javascript:alert(1)", "file:///etc/passwd", "club.org/reports", ""):
        response = requests.post(f"{API}/race-reports/link", json={
            "series_id": report_series["id"], "title": "Bad link", "url": url},
            headers=h(club_admin_token))
        assert response.status_code == 400, response.text
        assert "http:// or https://" in response.json()["detail"]

    untitled = requests.post(f"{API}/race-reports/link", json={
        "series_id": report_series["id"], "title": "   ",
        "url": "https://example.org/report"}, headers=h(club_admin_token))
    assert untitled.status_code == 400
    assert untitled.json()["detail"] == "Report title is required"


def test_race_report_upload_rejects_non_document(report_series, club_admin_token):
    response = requests.post(
        f"{API}/race-reports/upload",
        data={"series_id": report_series["id"], "title": "Invalid file"},
        files={"file": ("report.html", b"<script>alert(1)</script>", "text/html")},
        headers=h(club_admin_token),
    )
    assert response.status_code == 400
    assert "PDF, PNG, JPEG or WebP" in response.json()["detail"]
