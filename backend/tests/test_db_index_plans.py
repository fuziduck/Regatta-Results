"""Database integrity: the index definitions the app applies at startup.

Regression guard for the races index, which was declared as a partial index on
``{"mini_group_id": {"$exists": False}}``. MongoDB compiles that to ``$not``
and refuses it inside a partialFilterExpression, so ``create_index`` raised,
the failure was only logged as a warning, and the "one race per (series,
race_number)" guard did not exist at all. The definitions are pure data, so
they can be checked here without a database.
"""

import json
import os
import sys
from importlib import import_module
from pathlib import Path

import pytest

BACKEND_DIR = str(Path(__file__).resolve().parent.parent)


@pytest.fixture(scope="module")
def srv():
    """Import the application with a stubbed environment (motor connects
    lazily, so no database is needed)."""
    keys = ("MONGO_URL", "DB_NAME", "JWT_SECRET", "ENV", "TRUSTED_PROXY_IPS")
    saved = {key: os.environ.get(key) for key in keys}
    os.environ["MONGO_URL"] = "mongodb://localhost:27017/regatta_test"
    os.environ["DB_NAME"] = "regatta_test"
    os.environ["JWT_SECRET"] = "unit-test-secret-that-is-long-enough-0123456789"
    os.environ["ENV"] = "development"
    os.environ["TRUSTED_PROXY_IPS"] = ""
    try:
        for name in list(sys.modules):
            if name == "server" or name.startswith("server."):
                del sys.modules[name]
        sys.path.insert(0, BACKEND_DIR)
        yield import_module("server")
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def _unsupported_expression(expr):
    """True when a filter uses an operator MongoDB refuses in a partial index.

    MongoDB only accepts a restricted set there; $exists: false is rewritten to
    $not, which is rejected (and was the silent failure this test guards).
    """
    if isinstance(expr, dict):
        for operator, value in expr.items():
            if operator in ("$not", "$nor", "$where", "$expr"):
                return True
            if operator == "$exists" and value is False:
                return True
            if _unsupported_expression(value):
                return True
        return False
    if isinstance(expr, list):
        return any(_unsupported_expression(item) for item in expr)
    return False


def test_partial_filters_use_only_expressions_mongodb_accepts(srv):
    checked = 0
    for name, indexes in srv._db_index_plans().items():
        for keys, kwargs in indexes:
            expr = kwargs.get("partialFilterExpression")
            if expr is None:
                continue
            checked += 1
            assert not _unsupported_expression(expr), (name, keys, json.dumps(expr))
    assert checked, "expected at least one partial index definition"


def test_races_are_unique_per_series_race_number_and_mini_group(srv):
    """A series cannot gain a second race with the same number, while the
    sub-races of a mini series may share one (they differ by mini_group_id,
    which is null — indexed as null — for a normal race)."""
    by_keys = {tuple(field for field, _ in keys): kwargs
               for keys, kwargs in srv._db_index_plans()["races"]}
    assert by_keys[("series_id", "race_number", "mini_group_id")] == {"unique": True}
    # The definition MongoDB refused is removed, not merely supplemented.
    assert ("series_id", "race_number") not in by_keys
