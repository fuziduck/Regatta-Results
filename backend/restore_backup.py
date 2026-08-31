#!/usr/bin/env python3
"""Terminal restore for SailScore backups — run inside the backend container.

Use this to resurrect a server from the terminal, e.g. after a rebuild or
when the webmaster console cannot be reached. It performs the same restore
as the webmaster UI (for ZIP backups) or a raw mongorestore (for the
byte-exact full-image archive), then guarantees the webmaster account exists
with a usable passcode so the server is never locked out of its own console.

Usage:
    python restore_backup.py /path/to/backup.zip [--passphrase '...']
    python restore_backup.py --full-image /path/to/archive.gz [--passphrase '...']

ZIP backups: the archive records its own scope (all-clubs or one club) and
is restored accordingly. Encrypted backups (made with a passphrase) carry
users' passcode/2FA/email credentials, so everyone's sign-in survives; a
plaintext backup cannot carry credential material, so the webmaster falls
back to the WEBMASTER_PASSCODE env value (club users then need a passcode
reset, as with any plaintext restore).

Full images: a gzip mongodump --archive downloaded from the webmaster
console. mongorestore wipes and replaces the whole database, credentials
included — nothing is stripped.

Examples (from the Docker host):
    docker cp sailscore-backup.zip sailscore-backend:/tmp/backup.zip
    docker exec sailscore-backend python /app/restore_backup.py /tmp/backup.zip \
        --passphrase 'the phrase used when downloading'

    docker cp sailscore-full-image-2026-09-01.archive.gz sailscore-backend:/tmp/full.archive.gz
    docker exec sailscore-backend python /app/restore_backup.py \
        --full-image /tmp/full.archive.gz

Exit code 0 on success, 1 on any failure. The script never touches
MongoDB volumes or container configuration — it only writes through
mongorestore / the app's own restore logic.
"""
import argparse
import asyncio
import os
import pathlib
import sys

# The app module sets up the DB connection from the container's env vars and
# exposes the shared restore core + the webmaster guarantee.
import app.main as app


def _fail(msg: str) -> "NoReturn":
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


async def _restore_zip(path: pathlib.Path, passphrase: str) -> None:
    raw = path.read_bytes()
    if not raw:
        _fail(f"{path} is empty")
    result = await app._restore_zip_core(raw, passphrase)
    print(f"Scope: {result['scope']} "
          f"({result['club_id'] or 'all clubs'}) "
          f"exported {result.get('backup_exported_at') or '?'}")
    print(f"Collections restored: {', '.join(result['restored']) or '(none)'}")
    if result["errors"]:
        print("Skipped / notes:")
        for e in result["errors"]:
            print(f"  - {e}")
    if result["scope"] == "all-clubs":
        await app._ensure_restored_webmaster(result["encrypted"])
        wm = await app.db.users.find_one(
            {"role": "webmaster", "club_id": None}, {"_id": 0, "passcode_hash": 1})
        if wm and wm.get("passcode_hash"):
            print("Webmaster account: ready (passcode "
                  + ("preserved from the encrypted backup" if result["encrypted"]
                     else "reset from WEBMASTER_PASSCODE") + ")")
        else:
            _fail("No usable webmaster passcode — set WEBMASTER_PASSCODE and re-run")
    if result["errors"] and not result["restored"]:
        _fail("Nothing was restored")
    print("Restore complete.")


async def _restore_full_image(path: pathlib.Path, passphrase: str) -> None:
    if passphrase:
        _fail("A full-image archive is not passphrase-encrypted — "
              "it is already a raw mongodump (keep it safe); no --passphrase needed")
    if not shutil_which("mongorestore"):
        _fail("mongorestore is not available in this build (rebuild the backend image)")
    cmd = ["mongorestore", "--uri", app.mongo_url, "--archive",
           "--gzip", "--drop"]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    out, err = await proc.communicate(path.read_bytes())
    if proc.returncode != 0:
        _fail(f"mongorestore failed ({proc.returncode}): "
              + err.decode(errors="replace")[-800:])
    await app._ensure_restored_webmaster(True)
    wm = await app.db.users.find_one(
        {"role": "webmaster", "club_id": None}, {"_id": 0, "passcode_hash": 1})
    if wm and wm.get("passcode_hash"):
        print("Webmaster account: ready (credentials preserved verbatim by mongorestore)")
    else:
        _fail("No usable webmaster passcode after restore — set WEBMASTER_PASSCODE and re-run")
    print("Full-image restore complete.")


def shutil_which(name: str) -> bool:
    import shutil
    return shutil.which(name) is not None


def main() -> None:
    p = argparse.ArgumentParser(description="SailScore terminal backup restore")
    p.add_argument("zip_path", nargs="?", help="path to a SailScore backup .zip")
    p.add_argument("--full-image", metavar="ARCHIVE", help="path to a gzip mongodump archive")
    p.add_argument("--passphrase", default="", help="passphrase for an encrypted backup")
    args = p.parse_args()

    if bool(args.zip_path) == bool(args.full_image):
        _fail("Provide exactly one of: a backup ZIP path, or --full-image ARCHIVE")

    try:
        if args.full_image:
            asyncio.run(_restore_full_image(pathlib.Path(args.full_image), args.passphrase))
        else:
            asyncio.run(_restore_zip(pathlib.Path(args.zip_path), args.passphrase))
    except app.HTTPException as exc:
        _fail(f"restore rejected: {exc.detail}")
    except FileNotFoundError:
        _fail("backup file not found")


if __name__ == "__main__":
    main()
