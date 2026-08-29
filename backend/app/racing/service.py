"""Business services for race lifecycle operations.

Routes can progressively delegate here as the application is decomposed.
The callable is intentionally dependency-light so it can be unit tested with
an application context or a fake database.
"""

from typing import Any, Awaitable, Callable, Dict, Optional


async def publish_race(
    *,
    race_id: str,
    user: Dict[str, Any],
    load_race: Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]],
    ensure_unlocked: Callable[[Optional[str]], Awaitable[None]],
    expected_version: Optional[int],
    update_race: Callable[[str, Optional[int]], Awaitable[Dict[str, Any]]],
    audit: Callable[..., Awaitable[None]],
    validate: Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]],
) -> Dict[str, Any]:
    """Publish a race through injected persistence and policy callbacks.

    Injection keeps club scoping, concurrency, audit persistence, and scoring
    validation owned by the application while making the orchestration itself
    independently testable.
    """
    race = await load_race(race_id, user)
    await ensure_unlocked(race.get("series_id"))
    result = await update_race(race_id, expected_version)
    await audit(
        request=None,
        user=user,
        action="RESULTS_PUBLISHED",
        description=f"Race {race.get('race_number')} status -> published",
        resource_type="race",
        resource_id=race_id,
        club_id=race.get("club_id"),
    )
    return await validate(result)
