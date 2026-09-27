"""Race report upload and public class archive endpoint coverage."""
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


def test_race_report_upload_rejects_non_document(report_series, club_admin_token):
    response = requests.post(
        f"{API}/race-reports/upload",
        data={"series_id": report_series["id"], "title": "Invalid file"},
        files={"file": ("report.html", b"<script>alert(1)</script>", "text/html")},
        headers=h(club_admin_token),
    )
    assert response.status_code == 400
    assert "PDF, PNG, JPEG or WebP" in response.json()["detail"]
