import sqlite3
from pathlib import Path

import pytest

from lending_pool import create_app
from lending_pool.db import get_db, init_db

BASELINE = Path(__file__).parents[1] / "services/api/lending_pool/migrations/001_initial.sql"


def old_database(tmp_path, status="submitted"):
    path = tmp_path / "legacy.sqlite"
    with sqlite3.connect(path) as connection:
        connection.executescript(BASELINE.read_text())
        connection.execute("INSERT INTO pools (id, name) VALUES (7, 'Existing Pool')")
        connection.execute(
            """INSERT INTO funding_requests
            (id, pool_id, business_name, amount_drops, expected_payment_date, status, created_at)
            VALUES (12, 7, 'Existing SME', 1234567, '2099-12-01', ?, '2026-01-01 00:00:00')""",
            (status,),
        )
    return path


def test_upgrade_preserves_unversioned_records_and_is_repeatable(tmp_path):
    application = create_app({"TESTING": True, "ENABLE_SIMULATION": True, "DATABASE": str(old_database(tmp_path))})
    runner = application.test_cli_runner()
    for command in ["migrate-db", "migrate-db", "init-db", "seed-demo", "seed-demo"]:
        result = runner.invoke(args=[command])
        assert result.exit_code == 0, result.output
    client = application.test_client()
    record = client.get("/api/funding-requests/12").json["funding_request"]
    assert record["business_name"] == "Existing SME"
    assert record["pool_id"] == 7
    assert record["amount_drops"] == 1234567
    assert record["created_at"] == "2026-01-01 00:00:00"
    assert len(client.get("/api/pools").json["pools"]) == 1
    assert len(client.get("/api/investors").json["investors"]) == 1
    next_request = client.post("/api/funding-requests", json={
        "pool_id": 7, "business_name": "New SME", "amount_drops": 100,
        "expected_payment_date": "2099-12-01",
    })
    assert next_request.json["funding_request"]["id"] == 13
    with application.app_context():
        assert get_db().execute("PRAGMA foreign_key_check").fetchall() == []
        assert [row["version"] for row in get_db().execute("SELECT version FROM schema_migrations ORDER BY version")] == [1, 2, 3, 4, 5, 6]


def test_failed_upgrade_rolls_back_without_deleting_old_data(tmp_path):
    path = old_database(tmp_path, status="unexpected")
    application = create_app({"TESTING": True, "ENABLE_SIMULATION": True, "DATABASE": str(path)})
    with application.app_context():
        with pytest.raises(sqlite3.IntegrityError):
            init_db()
        assert get_db().execute("SELECT status FROM funding_requests WHERE id = 12").fetchone()[0] == "unexpected"
        assert get_db().execute("SELECT name FROM pools WHERE id = 7").fetchone()[0] == "Existing Pool"
        assert get_db().execute("SELECT name FROM sqlite_master WHERE name IN ('investors', 'schema_migrations', 'funding_requests_v2')").fetchall() == []


def test_unknown_migration_version_is_not_silently_ignored(app):
    with app.app_context():
        connection = get_db()
        connection.execute("INSERT INTO schema_migrations (version, name) VALUES (999, 'future.sql')")
        connection.commit()
        with pytest.raises(RuntimeError, match="does not match"):
            init_db()
        assert connection.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0] == 7
