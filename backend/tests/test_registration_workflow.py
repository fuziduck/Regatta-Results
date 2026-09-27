"""Pure unit tests for public club status and safe application projections."""
import ast
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
MAIN_SOURCE = (BACKEND_DIR / "app" / "main.py").read_text()
MAIN_TREE = ast.parse(MAIN_SOURCE)


def _function(name):
    return next(node for node in MAIN_TREE.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name)


def _load_helpers():
    names = {"_club_is_approved", "_club_app_owner_can_preview", "_club_application_public"}
    module = ast.Module(body=[node for node in MAIN_TREE.body if isinstance(node, ast.FunctionDef) and node.name in names], type_ignores=[])
    scope = {
        "Optional": __import__("typing").Optional,
        "APPROVAL_PUBLIC": "approved",
    }
    exec(compile(module, str(BACKEND_DIR / "app" / "main.py"), "exec"), scope)
    return scope


def test_legacy_clubs_remain_public_but_pending_and_rejected_are_private():
    helpers = _load_helpers()
    assert helpers["_club_is_approved"]({"id": "legacy"})
    assert helpers["_club_is_approved"]({"id": "approved", "approval_status": "approved"})
    assert not helpers["_club_is_approved"]({"id": "pending", "approval_status": "pending"})
    assert not helpers["_club_is_approved"]({"id": "rejected", "approval_status": "rejected"})


def test_only_verified_owner_can_preview_private_club():
    preview = _load_helpers()["_club_app_owner_can_preview"]
    club = {"id": "private", "application_owner_id": "owner-1", "approval_status": "rejected"}
    owner = {"user_id": "owner-1", "club_id": "private", "role": "admin"}
    other = {"user_id": "staff-2", "club_id": "private", "role": "admin"}
    webmaster = {"user_id": "wm-1", "club_id": None, "role": "webmaster"}

    assert preview(club, owner)
    assert not preview(club, other)
    assert not preview(club, webmaster)


def test_webmaster_queue_projection_never_includes_verification_material():
    public_projection = _load_helpers()["_club_application_public"]
    application = {
        "id": "app-1", "club_id": "club-1", "club_name": "Harbour Club",
        "club_slug": "harbour-club", "applicant_name": "Alex Sailor",
        "email": "alex@club.org", "status": "pending", "submitted_at": "2026-09-01",
        "verification_token_hash": "sensitive-hash", "verification_expires_at": "secret-expiry",
        "owner_user_id": "sensitive-owner", "reviewed_by": "webmaster",
    }
    public = public_projection(application)
    assert public["email"] == "alex@club.org"
    assert public["reviewed_by"] == "webmaster"
    assert "verification_token_hash" not in public
    assert "verification_expires_at" not in public
    assert "owner_user_id" not in public
