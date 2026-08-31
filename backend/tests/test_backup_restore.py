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
        self.deleted = []

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
        self.docs = []

    async def insert_many(self, docs, ordered=False):
        self.inserted.extend(docs)
        self.docs.extend(list(docs))

    async def find_one(self, q, proj=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                if proj is not None:
                    # Only "_id"-style exclusions are used in the restore
                    # path — honour them by returning the doc sans _id.
                    return {k: v for k, v in d.items() if k != "_id"}
                return d
        return None

    async def delete_many(self, q):
        self.deleted.append(q)
        self.docs = [d for d in self.docs if not all(
            (d.get(k) in v["$in"]) if isinstance(v, dict) and "$in" in v
            else d.get(k) == v for k, v in q.items())]
        return types.SimpleNamespace(deletedCount=0)

    async def update_one(self, q, update):
        n = 0
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                if "$set" in update:
                    d.update(update["$set"])
                n += 1
        return types.SimpleNamespace(matched_count=n, modified_count=n)

    async def insert_one(self, doc):
        self.inserted.append(doc)
        self.docs.append(doc)
        return types.SimpleNamespace(inserted_id=None)


class _DB:
    """Stub DB supporting both attribute (db.clubs) and item (db[name])
    access, matching how the restore endpoint touches collections."""
    def __init__(self):
        self.cols = {n: _Coll() for n in
                     ("clubs", "users", "classes", "boats", "series",
                      "races", "season_snapshots", "notices",
                      "notice_boards", "notice_sections", "subscriptions",
                      "subscription_deliveries", "adverts", "audit_logs",
                      "settings")}

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
        "season_snapshots": [], "notices": [], "notice_boards": [],
        "notice_sections": [], "subscriptions": [],
        "subscription_deliveries": [], "adverts": [], "audit_logs": [],
        "settings": [],
    }
    # webmaster is bootstrapped from env after a full restore — tests that
    # assert on users must account for it (or set WEBMASTER_PASSCODE empty).
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
                                        "series", "races", "season_snapshots",
                                        "notices", "notice_boards",
                                        "notice_sections", "subscriptions",
                                        "subscription_deliveries", "adverts",
                                        "audit_logs", "settings"}
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
                                        "series", "races", "season_snapshots",
                                        "notices", "notice_boards",
                                        "notice_sections", "subscriptions",
                                        "subscription_deliveries", "adverts",
                                        "audit_logs", "settings"}
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
            # (A full restore also re-ensures the webmaster account.)
            assert dict(self.USER) in server.db.users.inserted
            assert any(u.get("role") == "webmaster" for u in server.db.users.inserted)
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
        assert dict(self.USER) in server.db.users.inserted

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
        stripped = {k: v for k, v in self.USER.items() if k != "passcode_hash"}
        assert stripped in server.db.users.inserted
        assert not any(u.get("passcode_hash") for u in server.db.users.inserted
                       if u.get("role") != "webmaster")

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


class TestClubRestoreReplacesRacingData:
    """A club-scoped restore must REPLACE the club's racing data, not append
    to it. Series and races are scoped by class_id (only classes carry
    club_id), so the delete must be keyed on the backup's class ids — a
    club_id filter would match nothing, silently leaving the old series/races
    in place while the insert hits the unique (series_id, race_number) index.
    """

    def _club_zip(self):
        meta = {"app": "SailScore", "exported_at": "2026-08-29T00:00:00+00:00",
                "scope": "club", "club_id": "c1"}
        docs = {
            "clubs": [{"id": "c1", "name": "Medway YC", "slug": "medway-yacht-club"}],
            "users": [],
            "classes": [{"id": "cl-a", "club_id": "c1", "name": "Sonata"}],
            "boats": [],
            "series": [{"id": "s-new", "class_id": "cl-a", "year": 2025,
                         "name": "Early Spring"}],
            "races": [{"id": "r-new", "series_id": "s-new", "class_id": "cl-a",
                        "race_number": 1, "status": "published",
                        "results": [{"boat_id": "b1", "code": "FINISHED",
                                      "position": 1, "penalty_points": 0}]}],
            "season_snapshots": [{"id": "sn-new", "series_id": "s-new",
                                   "version": 1, "status": "locked"}],
            "notices": [{"id": "n-new", "club_id": "c1", "title": "Club notice",
                          "pdf_data_url": "data:application/pdf;base64,AAAA"}],
            "notice_boards": [{"id": "b-new", "club_id": "c1", "title": "ONB"}],
            "notice_sections": [{"id": "sec-new", "board_id": "b-new",
                                  "title": "General"}],
            "subscriptions": [{"id": "sub-new", "club_id": "c1",
                                "email_enc": "gAAAA...", "active": True}],
            "subscription_deliveries": [{"id": "d-new",
                                          "subscription_id": "sub-new"}],
            "adverts": [], "audit_logs": [],
        }
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("metadata.json", json.dumps(meta))
            for name, payload in docs.items():
                zf.writestr(f"{name}.json", json.dumps(payload))
        return buf.getvalue()

    def test_club_restore_deletes_existing_series_and_races_by_class_id(self):
        db = _stub_db()
        # Live already holds the same class ids but an OLDER generation of
        # series/races under them (exactly the pre-import state on the live
        # server): the restore must delete those before inserting the backup's.
        # Note: the restore loop reads collections by item access (db[name]).
        db.cols["clubs"].docs = [{"id": "c1", "name": "Medway YC",
                                   "slug": "medway-yacht-club"}]
        db.cols["classes"].docs = [{"id": "cl-a", "club_id": "c1", "name": "Sonata"}]
        db.cols["series"].docs = [{"id": "s-old", "class_id": "cl-a",
                                    "year": 2025, "name": "Early Spring"}]
        db.cols["races"].docs = [{"id": "r-old", "series_id": "s-old",
                                   "class_id": "cl-a", "race_number": 1}]
        db.cols["season_snapshots"].docs = [{"id": "sn-old", "series_id": "s-old",
                                              "version": 1, "status": "locked"}]
        db.cols["notices"].docs = [{"id": "n-old", "club_id": "c1",
                                     "title": "Old notice"}]
        db.cols["notice_boards"].docs = [{"id": "b-old", "club_id": "c1",
                                           "title": "Old ONB"}]
        db.cols["notice_sections"].docs = [{"id": "sec-old", "board_id": "b-old",
                                             "title": "Old"}]
        db.cols["subscriptions"].docs = [{"id": "sub-old", "club_id": "c1",
                                           "active": True}]
        db.cols["subscription_deliveries"].docs = [{"id": "d-old",
                                                     "subscription_id": "sub-old"}]
        server.db = db
        server._log_audit = _noop_audit

        out = asyncio.run(server.restore_backup(
            _Req(), _Upload("club.zip", self._club_zip()),
            user={"role": "webmaster", "username": "webmaster"}))

        # Global collections are silently skipped for club restores.
        assert out["errors"] == []
        assert "adverts" not in out["restored"]
        assert "settings" not in out["restored"]
        # Deletes for series/races are keyed on the backup's class ids (a
        # club_id filter would have matched nothing on these collections).
        assert db.cols["series"].deleted == [{"class_id": {"$in": ["cl-a"]}}]
        assert db.cols["races"].deleted == [{"class_id": {"$in": ["cl-a"]}}]
        # Frozen snapshots are scoped by the backup's series ids.
        assert db.cols["season_snapshots"].deleted == [{"series_id": {"$in": ["s-new"]}}]
        # ONB + subscriptions are scoped by club_id / board_id / sub id.
        assert db.cols["notices"].deleted == [{"club_id": "c1"}]
        assert db.cols["notice_boards"].deleted == [{"club_id": "c1"}]
        assert db.cols["notice_sections"].deleted == [{"board_id": {"$in": ["b-new"]}}]
        assert db.cols["subscriptions"].deleted == [{"club_id": "c1"}]
        assert db.cols["subscription_deliveries"].deleted == [{"subscription_id": {"$in": ["sub-new"]}}]
        # Old data is gone; the backup's documents took its place.
        assert [s["id"] for s in db.cols["series"].inserted] == ["s-new"]
        assert [r["id"] for r in db.cols["races"].inserted] == ["r-new"]
        assert [n["id"] for n in db.cols["notices"].inserted] == ["n-new"]
        assert [n["pdf_data_url"] for n in db.cols["notices"].inserted] \
            == ["data:application/pdf;base64,AAAA"]
        assert [b["id"] for b in db.cols["notice_boards"].inserted] == ["b-new"]
        assert [s["id"] for s in db.cols["notice_sections"].inserted] == ["sec-new"]
        assert [s["id"] for s in db.cols["subscriptions"].inserted] == ["sub-new"]
        assert [d["id"] for d in db.cols["subscription_deliveries"].inserted] == ["d-new"]
        assert db.cols["series"].docs == [d for d in db.cols["series"].docs
                                           if d["id"] != "s-old"]
        assert db.cols["races"].docs == [d for d in db.cols["races"].docs
                                          if d["id"] != "r-old"]
        assert db.cols["notices"].docs == [d for d in db.cols["notices"].docs
                                            if d["id"] != "n-old"]
        # The webmaster is never touched by a club restore.
        assert not any(d.get("role") == "webmaster" for d in db.cols["users"].inserted)

    def test_club_restore_rejects_missing_club(self):
        db = _stub_db()
        server.db = db
        server._log_audit = _noop_audit
        with pytest.raises(server.HTTPException) as exc:
            asyncio.run(server.restore_backup(
                _Req(), _Upload("club.zip", self._club_zip()),
                user={"role": "webmaster", "username": "webmaster"}))
        assert exc.value.status_code == 400
        assert "no longer exists" in exc.value.detail


class TestBuildBackupIncludesEverything:
    """_build_backup must export the ONB (notices incl. embedded documents,
    boards, sections), subscriptions, frozen snapshots and — for full-system
    backups only — global adverts and settings."""

    @staticmethod
    def _rich_db():
        db = _stub_db()
        db.cols["clubs"].docs = [{"id": "c1", "name": "Medway YC",
                                   "slug": "medway-yacht-club"},
                                  {"id": "c2", "name": "Other YC",
                                   "slug": "other-yacht-club"}]
        db.cols["classes"].docs = [{"id": "cl-a", "club_id": "c1", "name": "Sonata"},
                                    {"id": "cl-b", "club_id": "c2", "name": "Dinghy"}]
        db.cols["series"].docs = [{"id": "s-1", "class_id": "cl-a"},
                                   {"id": "s-2", "class_id": "cl-b"}]
        db.cols["races"].docs = [{"id": "r-1", "class_id": "cl-a", "series_id": "s-1"}]
        db.cols["season_snapshots"].docs = [{"id": "sn-1", "series_id": "s-1", "version": 1},
                                             {"id": "sn-2", "series_id": "s-2", "version": 1}]
        db.cols["notices"].docs = [{"id": "n-1", "club_id": "c1",
                                     "title": "Club notice",
                                     "pdf_data_url": "data:application/pdf;base64,QUJD"},
                                    {"id": "n-2", "club_id": "c2", "title": "Other"}]
        db.cols["notice_boards"].docs = [{"id": "b-1", "club_id": "c1", "title": "ONB"},
                                          {"id": "b-2", "club_id": "c2", "title": "Other"}]
        db.cols["notice_sections"].docs = [{"id": "sec-1", "board_id": "b-1"},
                                            {"id": "sec-2", "board_id": "b-2"}]
        db.cols["subscriptions"].docs = [{"id": "sub-1", "club_id": "c1", "active": True},
                                          {"id": "sub-2", "club_id": "c2", "active": True}]
        db.cols["subscription_deliveries"].docs = [{"id": "d-1", "subscription_id": "sub-1"},
                                                    {"id": "d-2", "subscription_id": "sub-2"}]
        db.cols["adverts"].docs = [{"id": "adv-1"}]
        db.cols["settings"].docs = [{"key": "email", "smtp_host": "x"}]
        return db

    @staticmethod
    def _read_zip(resp):
        zf = zipfile.ZipFile(io.BytesIO(resp.body))
        return {n: json.loads(zf.read(n)) for n in zf.namelist()}

    def test_club_backup_is_club_scoped_and_includes_onb(self):
        server.db = self._rich_db()
        server._log_audit = _noop_audit
        resp = asyncio.run(server._build_backup(
            _Req(), {"role": "webmaster", "username": "webmaster"}, "c1"))
        data = self._read_zip(resp)
        assert [n["id"] for n in data["notices.json"]] == ["n-1"]
        assert data["notices.json"][0]["pdf_data_url"].startswith("data:application/pdf")
        assert [b["id"] for b in data["notice_boards.json"]] == ["b-1"]
        assert [s["id"] for s in data["notice_sections.json"]] == ["sec-1"]
        assert [s["id"] for s in data["subscriptions.json"]] == ["sub-1"]
        assert [d["id"] for d in data["subscription_deliveries.json"]] == ["d-1"]
        assert [s["id"] for s in data["season_snapshots.json"]] == ["sn-1"]
        # Global collections never leak into a club backup.
        assert data["adverts.json"] == []
        assert data["settings.json"] == []

    def test_full_backup_includes_everything(self):
        server.db = self._rich_db()
        server._log_audit = _noop_audit
        resp = asyncio.run(server._build_backup(
            _Req(), {"role": "webmaster", "username": "webmaster"}, None))
        data = self._read_zip(resp)
        assert {n["id"] for n in data["notices.json"]} == {"n-1", "n-2"}
        assert {n["id"] for n in data["notice_boards.json"]} == {"b-1", "b-2"}
        assert {s["id"] for s in data["notice_sections.json"]} == {"sec-1", "sec-2"}
        assert {s["id"] for s in data["subscriptions.json"]} == {"sub-1", "sub-2"}
        assert {d["id"] for d in data["subscription_deliveries.json"]} == {"d-1", "d-2"}
        assert {s["id"] for s in data["season_snapshots.json"]} == {"sn-1", "sn-2"}
        assert [a["id"] for a in data["adverts.json"]] == ["adv-1"]
        assert data["settings.json"][0]["key"] == "email"


class TestWebmasterRedundancy:
    """A full-system restore must never leave the server without a usable
    webmaster account: encrypted backups preserve the passcode (+2FA/email),
    plaintext backups fall back to WEBMASTER_PASSCODE."""

    USER = {"id": "u1", "club_id": "c1", "username": "officer@club.org",
            "role": "officer", "passcode_hash": "$2b$12$abcdefghijklmnopqrstuv",
            "totp_secret_enc": "enc-totp", "totp_enabled": True,
            "email": "officer@club.org"}
    WM = {"id": "wm1", "club_id": None, "username": "webmaster",
          "role": "webmaster", "passcode_hash": "$2b$12$zzz",
          "totp_secret_enc": "enc-totp-wm", "totp_enabled": True,
          "email": "webmaster@example.org"}

    def test_encrypted_backup_keeps_2fa_and_email(self):
        server.BACKUP_PASSPHRASE = "test-secret-123"
        try:
            db = _stub_db()
            db.cols["users"].docs = [dict(self.USER)]
            server.db = db
            server._log_audit = _noop_audit
            resp = asyncio.run(server._build_backup(
                _Req(), {"role": "webmaster", "username": "webmaster"}, None))
            zf = zipfile.ZipFile(io.BytesIO(resp.body))
            meta = json.loads(zf.read("metadata.json"))
            key = server._derive_backup_key(
                "test-secret-123", bytes.fromhex(meta["kdf"]["salt"]))
            users = json.loads(server._aes_decrypt(key, zf.read("users.json")))
            assert users[0]["passcode_hash"] == self.USER["passcode_hash"]
            assert users[0]["totp_secret_enc"] == "enc-totp"
            assert users[0]["totp_enabled"] is True
            assert users[0]["email"] == "officer@club.org"
        finally:
            server.BACKUP_PASSPHRASE = None

    def test_plaintext_backup_strips_2fa_and_email(self):
        server.BACKUP_PASSPHRASE = None
        db = _stub_db()
        db.cols["users"].docs = [dict(self.USER)]
        server.db = db
        server._log_audit = _noop_audit
        resp = asyncio.run(server._build_backup(
            _Req(), {"role": "webmaster", "username": "webmaster"}, None))
        zf = zipfile.ZipFile(io.BytesIO(resp.body))
        users = json.loads(zf.read("users.json"))
        assert "passcode_hash" not in users[0]
        assert "totp_secret_enc" not in users[0]
        assert "email" not in users[0]

    def test_plaintext_full_restore_sets_webmaster_passcode_from_env(self):
        old = server.WEBMASTER_PASSCODE
        server.WEBMASTER_PASSCODE = "env-passcode"
        try:
            meta = {"app": "SailScore", "exported_at": "2026-08-29T00:00:00+00:00",
                    "scope": "all-clubs", "club_id": None}
            docs = {
                "clubs": [{"id": "c1", "name": "Medway YC", "slug": "medway-yacht-club"}],
                "users": [{"id": "wm1", "club_id": None, "username": "webmaster",
                            "role": "webmaster", "active": True}],
                "classes": [], "boats": [], "series": [], "races": [],
                "season_snapshots": [], "notices": [], "notice_boards": [],
                "notice_sections": [], "subscriptions": [],
                "subscription_deliveries": [], "adverts": [], "audit_logs": [],
                "settings": [],
            }
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w") as zf:
                zf.writestr("metadata.json", json.dumps(meta))
                for name, payload in docs.items():
                    zf.writestr(f"{name}.json", json.dumps(payload))
            server.db = _stub_db()
            server._log_audit = _noop_audit
            out = asyncio.run(server.restore_backup(
                _Req(), _Upload("backup.zip", buf.getvalue()),
                user={"role": "webmaster", "username": "webmaster"}))
            assert out["errors"] == []
            # The restored webmaster (passcode stripped by plaintext) got a
            # fresh hash from WEBMASTER_PASSCODE so the server is not locked out.
            wm = [u for u in server.db.users.docs
                  if u.get("role") == "webmaster" and u.get("club_id") is None]
            assert wm and wm[0].get("passcode_hash")
            assert server.verify_passcode("env-passcode", wm[0]["passcode_hash"])
        finally:
            server.WEBMASTER_PASSCODE = old
