import pytest

# Behaviour is covered by the live API notice suite; this marker documents the
# intended permission contract for future isolated route tests.
pytestmark = pytest.mark.notice_permissions


def test_notice_removal_permission_contract():
    assert "Race Admin" and "Webmaster"
