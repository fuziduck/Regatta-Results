"""Backfill: link existing boats' free-text home clubs to registered clubs.

Run inside the backend container (it reads MONGO_URL / DB_NAME from the
environment):

    docker compose -f docker-compose.dev.yml exec backend python backfill_home_clubs.py

For every boat with a non-empty ``home_club``, the label is matched against
the club directory (full name, initials like "MYC", suffix abbreviations
like "Medway YC", explicit club abbreviations, leading-word prefix). When it
unambiguously resolves — or the club the boat races at breaks the tie — the
boat's ``home_club`` is set to the canonical club name and ``home_club_id``
to the club's id. Idempotent: re-running only touches boats whose label
still doesn't match its stored link.
"""
import asyncio
import os

from motor.motor_asyncio import AsyncIOMotorClient

from app.uk_club_names import match_club


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "regatta")]
    clubs = await db.clubs.find({}, {"_id": 0, "id": 1, "name": 1, "slug": 1, "abbr": 1}).to_list(2000)
    classes = {c["id"]: c for c in await db.classes.find({}, {"_id": 0, "id": 1, "club_id": 1}).to_list(5000)}
    boats = await db.boats.find({"home_club": {"$exists": True, "$ne": ""}},
                                {"_id": 0, "id": 1, "home_club": 1, "home_club_id": 1, "class_id": 1}).to_list(10000)
    changed = 0
    skipped = 0
    for b in boats:
        label = (b.get("home_club") or "").strip()
        if not label:
            continue
        ctx = classes.get(b.get("class_id"), {}).get("club_id")
        m = match_club(label, clubs, context_club_id=ctx)
        if not m:
            skipped += 1
            continue
        set_ = {"home_club": m["name"], "home_club_id": m["id"]}
        if b.get("home_club_id") == m["id"] and b.get("home_club") == m["name"]:
            continue
        await db.boats.update_one({"id": b["id"]}, {"$set": set_})
        changed += 1
        print(f"{b['id']}: {label!r} -> {m['name']} ({m['matched_by']})")
    print(f"updated {changed}; unmatched/left as-is {skipped}; clubs registered {len(clubs)}")


if __name__ == "__main__":
    asyncio.run(main())
