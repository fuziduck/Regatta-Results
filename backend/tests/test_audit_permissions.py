import os
import asyncio

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "sailscore_test")
os.environ.setdefault("JWT_SECRET", "test-secret-for-audit-permissions-123456789")

import pytest
from fastapi import HTTPException
import server


def test_audit_requires_webmaster(monkeypatch):
    async def user(request):
        return {"role": "admin", "club_id": "club-1"}
    monkeypatch.setattr(server, "get_current_user", user)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.require_webmaster(object()))
    assert exc.value.status_code == 403


def test_audit_allows_webmaster(monkeypatch):
    async def user(request):
        return {"role": "webmaster", "club_id": None}
    monkeypatch.setattr(server, "get_current_user", user)
    assert asyncio.run(server.require_webmaster(object()))["role"] == "webmaster"
