"""Business services for Official Notice Board workflows."""

from typing import Any, Awaitable, Callable, Dict, Optional


async def publish_notice(
    *,
    notice_id: str,
    user: Dict[str, Any],
    load_notice: Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]],
    update_notice: Callable[[str, Dict[str, Any], Optional[int]], Awaitable[Dict[str, Any]]],
    expected_version: Optional[int],
    pdf_data_url: Optional[str],
    validate_pdf: Callable[[Optional[str]], Optional[bytes]],
    history_entry: Callable[[Dict[str, Any], str, Optional[str]], Dict[str, Any]],
    audit: Callable[..., Awaitable[None]],
) -> Dict[str, Any]:
    """Orchestrate publication of a notice after route-level authentication.

    Validation and persistence remain injected so the service can be tested
    without coupling it to FastAPI or MongoDB.
    """
    notice = await load_notice(notice_id, user)
    if notice.get("status") != "draft":
        raise ValueError("Only draft notices can be published")
    pdf_raw = validate_pdf(pdf_data_url) if pdf_data_url else None
    if pdf_data_url and pdf_raw is None:
        raise ValueError("pdf_data_url must be a valid PDF")
    updates = {"status": "published", "published_by": user.get("username"),
               "history": (notice.get("history") or []) + [history_entry(user, "published", None)]}
    if pdf_data_url:
        updates.update({"pdf_data_url": pdf_data_url, "has_pdf": True})
    published = await update_notice(notice_id, updates, expected_version)
    await audit(request=None, user=user, action="NOTICE_PUBLISHED",
                description=f"Published notice '{notice.get('title')}'",
                resource_type="notice", resource_id=notice_id,
                club_id=notice.get("club_id"))
    return published
