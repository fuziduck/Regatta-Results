"""Unit tests for private self-service club registration and approval."""
import asyncio
import hashlib
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "club_applications_test")
os.environ.setdefault("JWT_SECRET", "test-secret-that-is-long-enough-for-club-applications")

BACKEND_DIR = str(Path(__file__).resolve().parent.parent)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

import server


class Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *args, **kwargs):
        self.rows.sort(key=lambda row: (row.get("submitted_at") or "", row.get("club_name") or ""), reverse=True)
        return self

    async def to_list(self, limit):
        return self.rows[:limit]


class Collection:
    def __init__(self, rows=()):
        self.rows = [dict(row) for row in rows]

    def find(self, query=None, projection=None):
        query = query or {}
        return Cursor(row for row in self.rows if matches(row, query))

    async def find_one(self, query, projection=None):
        return next((dict(row) for row in self.rows if matches(row, query)), None)

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, query, update, **kwargs):
        for row in self.rows:
            if matches(row, query):
                changed = False
                for key, value in update.get("$set", {}).items():
                    changed = changed or row.get(key) != value
                    row[key] = value
                for key in update.get("$unset", {}):
                    changed = changed or key in row
                    row.pop(key, None)
                return SimpleNamespace(matched_count=1, modified_count=int(changed))
        if kwargs.get("upsert"):
            new_doc = dict(query)
            new_doc.update(update.get("$set", {}))
            self.rows.append(new_doc)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=new_doc.get("id"))
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, query):
        for index, row in enumerate(self.rows):
            if matches(row, query):
                self.rows.pop(index)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


def matches(row, query):
    for key, expected in query.items():
        if key == "$or":
            if not any(matches(row, clause) for clause in expected):
                return False
            continue
        value = row.get(key)
        if isinstance(expected, dict):
            if "$exists" in expected and (key in row) != expected["$exists"]:
                return False
            if "$gt" in expected and not (value and value > expected["$gt"]):
                return False
            if "$in" in expected and value not in expected["$in"]:
                return False
        elif value != expected:
            return False
    return True


class Request:
    def __init__(self):
        self.client = SimpleNamespace(host="127.0.0.1")
        self.headers = {}
        self.cookies = {}
        self.method = "POST"
        self.query_params = {}


@pytest.fixture(autouse=True)
def reset_state(monkeypatch):
    monkeypatch.setattr(server, "_login_attempts", __import__("collections").defaultdict(__import__("collections").deque))
    monkeypatch.setattr(server, "_log_audit", async_noop)
    monkeypatch.setattr(server, "APP_ENV", "development")
    monkeypatch.setattr(server, "CLUB_APPLICATION_VERIFY_MINUTES", 1440)


async def async_noop(*args, **kwargs):
    return None


async def async_result(value):
    return value


def application_db(*, apps=(), clubs=(), users=(), classes=(), series=(), boats=(), races=(),
                   regattas=(), boards=(), subscriptions=(), deliveries=()):
    return SimpleNamespace(
        club_applications=Collection(apps), clubs=Collection(clubs), users=Collection(users),
        classes=Collection(classes), series=Collection(series), boats=Collection(boats),
        races=Collection(races), regattas=Collection(regattas), notice_boards=Collection(boards),
        subscriptions=Collection(subscriptions), subscription_deliveries=Collection(deliveries),
        settings=Collection(), audit_logs=Collection(),
    )


def test_registration_submission_persists_hash_only_before_account_creation(monkeypatch):
    server.db = application_db()
    monkeypatch.setattr(server, "_get_email_settings", lambda: async_result({"configured": False, "smtp_host": ""}))
    monkeypatch.setattr(server, "_send_club_application_verification", lambda *args: async_result(False))
    monkeypatch.setattr(server, "_new_club_application_slug", lambda name: async_result("harbour-club"))
    payload = server.ClubApplicationInput(club_name="Harbour Sailing Club", applicant_name="Alex Sailor", email="Alex@club.org")

    result = asyncio.run(server.submit_club_application(payload, Request()))

    assert result["dev_verification_token"]
    application = server.db.club_applications.rows[0]
    assert application["email"] == "alex@club.org"
    assert application["verification_token_hash"] == hashlib.sha256(result["dev_verification_token"].encode()).hexdigest()
    assert "dev_verification_token" not in application
    assert server.db.clubs.rows == []
    assert server.db.users.rows == []


def test_email_verification_creates_private_owner_and_queue_projection_hides_token(monkeypatch):
    token = "verified-registration-token-value-32"
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    app = {"id": "app-1", "club_name": "Harbour Sailing Club", "club_slug": "harbour-club",
           "applicant_name": "Alex Sailor", "email": "alex@club.org", "status": server.CLUB_APPLICATION_PENDING_VERIFICATION,
           "verification_token_hash": token_hash, "verification_expires_at": expires,
           "submitted_at": "2026-09-01T00:00:00+00:00"}
    server.db = application_db(apps=[app])
    ids = iter(("new-club-id", "new-owner-id"))
    monkeypatch.setattr(server, "new_id", lambda: next(ids))
    monkeypatch.setattr(server, "hash_passcode", lambda passcode: f"hashed:{passcode}")
    monkeypatch.setattr(server, "_notify_webmaster_club_application", lambda application: async_result(False))

    result = asyncio.run(server.verify_club_application(
        server.ClubApplicationVerifyInput(token=token, passcode="secure1!"), Request()))

    assert result.body
    assert len(server.db.clubs.rows) == 1
    club = server.db.clubs.rows[0]
    assert club["approval_status"] == "pending"
    assert club["application_owner_id"] == "new-owner-id"
    assert server.db.users.rows[0]["role"] == "admin"
    assert server.db.users.rows[0]["active"] is True
    assert "club_application" in result.body.decode()
    assert "verification_token_hash" not in str(server._club_application_public(app))
    assert "email" in server._club_application_public(app)
    assert "verification_token_hash" not in server._club_application_public(app)


def test_expired_email_verification_can_be_resent(monkeypatch):
    application = {
        "id": "expired-app", "club_name": "Harbour Sailing Club",
        "club_slug": "harbour-club", "applicant_name": "Alex Sailor",
        "email": "alex@club.org", "status": server.CLUB_APPLICATION_EXPIRED,
    }
    server.db = application_db(apps=[application])
    monkeypatch.setattr(server, "_get_email_settings", lambda: async_result({"configured": False, "smtp_host": ""}))
    monkeypatch.setattr(server, "_send_club_application_verification", lambda *args: async_result(False))
    payload = server.ClubApplicationResendInput(club_name="Harbour Sailing Club", email="alex@club.org")

    result = asyncio.run(server.resend_club_application_verification(payload, Request()))

    assert result["dev_verification_token"]
    updated = server.db.club_applications.rows[0]
    assert updated["status"] == server.CLUB_APPLICATION_PENDING_VERIFICATION
    assert updated["verification_token_hash"] == hashlib.sha256(result["dev_verification_token"].encode()).hexdigest()


def test_webmaster_can_reject_and_later_reapprove_without_removing_owner():
    server.db = application_db(
        apps=[{"id": "app-1", "club_id": "club-1", "club_name": "Harbour Sailing Club",
               "email": "alex@club.org", "owner_user_id": "owner-1", "status": server.APPROVAL_PENDING}],
        clubs=[{"id": "club-1", "name": "Harbour Sailing Club", "slug": "harbour-club",
                "approval_status": server.APPROVAL_PENDING, "application_owner_id": "owner-1"}],
        users=[{"id": "owner-1", "club_id": "club-1", "role": "admin", "active": True}],
    )
    webmaster = {"role": "webmaster", "username": "webmaster"}

    rejected = asyncio.run(server.review_club_application(
        "app-1", server.ClubApplicationReviewInput(status="rejected"), Request(), user=webmaster))
    assert rejected["status"] == server.APPROVAL_REJECTED
    assert server.db.clubs.rows[0]["approval_status"] == server.APPROVAL_REJECTED
    assert server.db.users.rows[0]["active"] is True

    approved = asyncio.run(server.review_club_application(
        "app-1", server.ClubApplicationReviewInput(status="approved"), Request(), user=webmaster))
    assert approved["status"] == server.APPROVAL_PUBLIC
    assert server.db.clubs.rows[0]["approval_status"] == server.APPROVAL_PUBLIC
    assert server.db.users.rows[0]["id"] == "owner-1"


def test_public_subscription_targets_reject_private_clubs_and_allow_legacy(monkeypatch):
    server.db = application_db(
        clubs=[{"id": "private", "name": "Private Club", "slug": "private", "approval_status": "pending"},
               {"id": "legacy", "name": "Legacy Club", "slug": "legacy"}],
        classes=[{"id": "private-class", "club_id": "private", "name": "Secret Fleet"},
                 {"id": "legacy-class", "club_id": "legacy", "name": "Sonata"}],
        series=[{"id": "private-series", "class_id": "private-class", "name": "Secret Series"}],
        boats=[{"id": "private-boat", "class_id": "private-class", "name": "Secret Boat"}],
        regattas=[{"id": "private-regatta", "club_id": "private", "name": "Secret Regatta"}],
        boards=[{"id": "private-board", "club_id": "private", "competition_id": "private-regatta", "status": "active", "board_type": "competition", "title": "Secret Board"}],
    )

    for subscription_type, target_id in (
        ("class", "private-class"),
        ("series", "private-series"),
        ("boat", "private-boat"),
        ("notice", "private"),
        ("notice_board", "private-board"),
    ):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(server._subscription_target(subscription_type, target_id))
        assert exc.value.status_code == 404

    visible = asyncio.run(server._subscription_target("class", "legacy-class"))
    assert visible["club_name"] == "Legacy Club"


def test_notification_delivery_skips_private_club_subscribers(monkeypatch):
    server.db = application_db(
        clubs=[{"id": "private", "name": "Private Club", "approval_status": "rejected"}],
        classes=[{"id": "class-1", "club_id": "private"}],
        series=[{"id": "series-1", "class_id": "class-1"}],
        subscriptions=[{"id": "sub-1", "club_id": "private", "target_id": "series-1", "subscription_type": "series", "active": True, "verified": True}],
    )
    result = asyncio.run(server._notify_published_results({"id": "race-1", "class_id": "class-1", "series_id": "series-1", "results": []}))
    assert result == {"matched": 0, "sent": 0, "skipped": 0}
    assert server.db.subscription_deliveries.rows == []


def test_registration_owner_must_still_be_attached_to_the_private_club(monkeypatch):
    server.db = application_db(
        clubs=[{"id": "c1", "name": "Private Club", "approval_status": "rejected",
                "application_owner_id": "owner-1"}],
        users=[{"id": "owner-2", "club_id": "c1", "role": "admin", "username": "owner@example.org",
               "active": True, "club_registration_owner": True, "passcode_hash": "unused"}],
    )
    request = Request()
    payload = server.LoginInput(role="admin", username="owner@example.org", passcode="Valid123!")
    monkeypatch.setattr(server, "_login_ip_limited", lambda ip: False)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.login(payload, request))

    assert exc.value.status_code == 401
    assert "club_id" not in request.__dict__


def test_owner_visibility_does_not_make_private_club_public():
    server.db = application_db(clubs=[{"id": "c1", "approval_status": "rejected", "application_owner_id": "u1"}])
    owner = {"role": "admin", "club_id": "c1", "user_id": "u1"}
    other = {"role": "admin", "club_id": "c1", "user_id": "u2"}
    assert asyncio.run(server._club_visible_to_user("c1", owner)) is True
    assert asyncio.run(server._club_visible_to_user("c1", other)) is False
    assert server._club_is_approved({"id": "legacy"}) is True
    assert server._club_is_public_query() == {"$or": [{"approval_status": "approved"}, {"approval_status": {"$exists": False}}]}
