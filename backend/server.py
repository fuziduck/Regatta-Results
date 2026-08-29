"""Compatibility entrypoint for the legacy `uvicorn server:app` command.

The complete implementation is currently hosted in ``app.main``. The
wildcard export keeps the long-standing test and tooling API compatible while
allowing deployments to migrate imports incrementally.
"""
from app import main as _main

# Keep this module object-compatible with the historical `import server`
# contract: tests and scripts monkeypatch globals such as `db` and expect the
# application functions to resolve those patched values.
import sys
sys.modules[__name__] = _main
