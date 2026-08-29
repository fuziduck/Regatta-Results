"""Unit tests for the backup-restore ZIP layout handling.

The endpoint is invoked directly with a stubbed DB (like test_site_search.py)
so no live server or destructive restore is needed. It must accept both the
app's flat archive (JSON files at the zip root) and the nested layout produced
by re-compressing an extracted backup folder (e.g. macOS Finder "Compress"),
while ignoring macOS __MACOSX metadata entries.
"""
import asyncio
import io
import json
import types
import zipfile

import pytest

import server


class _Upload:
    def __init__(self, filename, data):
        self.filename = filename
        self._data = data

    async def read(self):
        return self._data


class _Req:
    client = types.SimpleNamespace(host="127.0.0.1")
    headers = {}


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    async def to_list(self, n):
        return list(self.docs)


class _Coll:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.dropped = 0
        self.inserted = []

    def find(self, q, proj=None):
        def matches(doc):
            for k, v in q.items():
                if isinstance(v, dict) and "$in" in v:
                    if doc.get(k) not in v["$in"]:
                        return False
                elif doc.get(k) != v:
                    return False
            return True
        return _Cursor([d for d in self.docs if matches(d)])

    async def drop(self):
        self.dropped += 1

    async def insert_many(self, docs, ordered=False):
        self.inserted.extend(docs)

    async def find_one(self, q, proj=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                if proj:
                    return {k: d[k] for k in proj if k in d and k != "_id"}
                return d
        return None

    async def delete_many(self, q):
        return types.SimpleNamespace(deletedCount=0)

    async def update_one(self, q, update):
        return types.SimpleNamespace(matched_count=0)

    async def insert_one(self, doc):
        return None


class _DB:
    """Stub DB supporting both attribute (db.clubs) and item (db[name])
    access, matching how the restore endpoint touches collections."""
    def __init__(self):
        self.cols = {n: _Coll() for n in
                     ("clubs", "users", "classes", "boats", "series",
                      "races", "adverts", "audit_logs")}

    def __getitem__(self, name):
        return self.cols[name]

    def __getattr__(self, name):
        if name in self.cols:
            return self.cols[name]
        raise AttributeError(name)


def _stub_db():
    return _DB()


async def _noop_audit(*args, **kwargs):
    return None


@pytest.fixture(autouse=True)
def _restore_log_audit():
    """Restore the real audit logger after each test so the stub never
    leaks into other test modules (2FA / auth suites rely on it)."""
    original = server._log_audit
    yield
    server._log_audit = original


def _zip_bytes(prefix, macos_junk=True):
    meta = {"app": "SailScore", "exported_at": "2026-08-29T00:00:00+00:00",
            "scope": "all-clubs", "club_id": None}
    docs = {
        "clubs": [{"id": "c1", "name": "Medway YC", "slug": "medway-yacht-club"}],
        "users": [], "classes": [], "boats": [], "series": [], "races": [],
        "adverts": [],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(f"{prefix}metadata.json", json.dumps(meta))
        for name, payload in docs.items():
            zf.writestr(f"{prefix}{name}.json", json.dumps(payload))
        if macos_junk:
            zf.writestr("__MACOSX/._metadata.json", "junk")
    return buf.getvalue()


class TestRestoreBackupLayout:
    def test_flat_backup_restores(self):
        server.db = _stub_db()
        server._log_audit = _noop_audit
        out = asyncio.run(server.restore_backup(
            _Req(), _Upload("backup.zip", _zip_bytes("")),
            user={"role": "webmaster", "username": "webmaster"}))
        assert out["scope"] == "all-clubs"
        assert set(out["restored"]) == {"clubs", "users", "classes", "boats",
                                        "series", "races", "adverts"}
        assert out["errors"] == []
        assert server.db.clubs.dropped == 1
        assert [c["id"] for c in server.db.clubs.inserted] == ["c1"]

    def test_nested_backup_folder_restores(self):
        # A backup re-zipped from its extracted folder (single top-level
        # directory) used to fail with "missing metadata.json" — it must now
        # restore exactly like the flat archive.
        server.db = _stub_db()
        server._log_audit = _noop_audit
        out = asyncio.run(server.restore_backup(
            _Req(), _Upload("sailscore-backup.zip",
                            _zip_bytes("sailscore-backup-2026-08-29/")),
            user={"role": "webmaster", "username": "webmaster"}))
        assert out["scope"] == "all-clubs"
        assert set(out["restored"]) == {"clubs", "users", "classes", "boats",
                                        "series", "races", "adverts"}
        assert out["errors"] == []
        assert [c["id"] for c in server.db.clubs.inserted] == ["c1"]

    def test_zip_without_metadata_is_rejected(self):
        server.db = _stub_db()
        server._log_audit = _noop_audit
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("clubs.json", json.dumps([]))
        with pytest.raises(server.HTTPException) as exc:
            asyncio.run(server.restore_backup(
                _Req(), _Upload("backup.zip", buf.getvalue()),
                user={"role": "webmaster", "username": "webmaster"}))
        assert exc.value.status_code == 400
        assert "metadata.json" in exc.value.detail


class TestEncryptedBackups:
    USER = {"id": "u1", "club_id": "c1", "username": "officer@club.org",
            "role": "officer", "passcode_hash": "$2b$12$abcdefghijklmnopqrstuv"}

    @staticmethod
    def _backup_db():
        db = _stub_db()
        db.clubs = _Coll([{"id": "c1", "name": "Medway YC", "slug": "medway-yacht-club"}])
        db.users = _Coll([dict(TestEncryptedBackups.USER)])
        return db

    def _build(self, passphrase=None):
        return asyncio.run(server._build_backup(
            _Req(), {"role": "webmaster", "username": "webmaster"}, None, passphrase))

    def test_encrypted_backup_round_trips_passcode_hash(self):
        server.BACKUP_PASSPHRASE = "test-secret"
        try:
            server.db = self._backup_db()
            server._log_audit = _noop_audit
            resp = self._build()
            raw = resp.body
            # The archive itself is a valid zip; entries (except metadata) are encrypted.
            zf = zipfile.ZipFile(io.BytesIO(raw))
            meta = json.loads(zf.read("metadata.json"))
            assert meta["encrypted"] is True
            assert "kdf" in meta
            assert zf.read("users.json")[:12] != json.dumps([]).encode()[:12]  # not plaintext JSON

            server.db = _stub_db()
            out = asyncio.run(server.restore_backup(
                _Req(), _Upload("backup.zip", raw),
                user={"role": "webmaster", "username": "webmaster"}))
            assert out["errors"] == []
            # The passcode hash survives the round trip — no manual resets needed.
            assert server.db.users.inserted == [dict(self.USER)]
        finally:
            server.BACKUP_PASSPHRASE = None

    def test_request_passphrase_round_trips_without_env(self):
        """A passphrase supplied with the download request (no env key set)
        encrypts the archive, and the same passphrase on restore decrypts it
        and carries the passcode hash across."""
        server.BACKUP_PASSPHRASE = None
        server.db = self._backup_db()
        server._log_audit = _noop_audit
        raw = self._build(passphrase="super secret phrase 123").body

        zf = zipfile.ZipFile(io.BytesIO(raw))
        meta = json.loads(zf.read("metadata.json"))
        assert meta["encrypted"] is True

        server.db = _stub_db()
        out = asyncio.run(server.restore_backup(
            _Req(), _Upload("backup.zip", raw),
            passphrase="super secret phrase 123",
            user={"role": "webmaster", "username": "webmaster"}))
        assert out["errors"] == []
        assert server.db.users.inserted == [dict(self.USER)]

    def test_restore_requires_request_passphrase_when_env_unset(self):
        server.BACKUP_PASSPHRASE = None
        server.db = self._backup_db()
        server._log_audit = _noop_audit
        raw = self._build(passphrase="super secret phrase 123").body

        server.db = _stub_db()
        with pytest.raises(server.HTTPException) as exc:
            asyncio.run(server.restore_backup(
                _Req(), _Upload("backup.zip", raw),
                passphrase="",
                user={"role": "webmaster", "username": "webmaster"}))
        assert exc.value.status_code == 400
        assert "enter the backup passphrase" in exc.value.detail

    def test_restore_rejects_wrong_request_passphrase(self):
        server.BACKUP_PASSPHRASE = None
        server.db = self._backup_db()
        server._log_audit = _noop_audit
        raw = self._build(passphrase="super secret phrase 123").body

        server.db = _stub_db()
        with pytest.raises(server.HTTPException) as exc:
            asyncio.run(server.restore_backup(
                _Req(), _Upload("backup.zip", raw),
                passphrase="totally wrong passphrase",
                user={"role": "webmaster", "username": "webmaster"}))
        assert exc.value.status_code == 400
        assert "does not match" in exc.value.detail

    def test_plaintext_backup_strips_passcode_hash(self):
        server.BACKUP_PASSPHRASE = None
        server.db = self._backup_db()
        server._log_audit = _noop_audit
        resp = self._build()
        zf = zipfile.ZipFile(io.BytesIO(resp.body))
        users = json.loads(zf.read("users.json"))
        assert "passcode_hash" not in users[0]

        server.db = _stub_db()
        asyncio.run(server.restore_backup(
            _Req(), _Upload("backup.zip", resp.body),
            user={"role": "webmaster", "username": "webmaster"}))
        assert server.db.users.inserted == [{k: v for k, v in self.USER.items()
                                             if k != "passcode_hash"}]

    def test_encrypted_backup_restore_requires_key(self):
        server.BACKUP_PASSPHRASE = "test-secret"
        try:
            server.db = self._backup_db()
            server._log_audit = _noop_audit
            raw = self._build().body
            server.BACKUP_PASSPHRASE = None
            server.db = _stub_db()
            with pytest.raises(server.HTTPException) as exc:
                asyncio.run(server.restore_backup(
                    _Req(), _Upload("backup.zip", raw),
                    passphrase="",
                    user={"role": "webmaster", "username": "webmaster"}))
            assert exc.value.status_code == 400
            assert "enter the backup passphrase" in exc.value.detail
        finally:
            server.BACKUP_PASSPHRASE = None

    def test_encrypted_backup_restore_rejects_wrong_key(self):
        server.BACKUP_PASSPHRASE = "secret-a"
        try:
            server.db = self._backup_db()
            server._log_audit = _noop_audit
            raw = self._build().body
            server.BACKUP_PASSPHRASE = "secret-b"
            server.db = _stub_db()
            with pytest.raises(server.HTTPException) as exc:
                asyncio.run(server.restore_backup(
                    _Req(), _Upload("backup.zip", raw),
                    passphrase="",
                    user={"role": "webmaster", "username": "webmaster"}))
            assert exc.value.status_code == 400
            assert "does not match" in exc.value.detail
        finally:
            server.BACKUP_PASSPHRASE = None
