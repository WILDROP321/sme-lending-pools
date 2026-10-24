"""Small, persistent SQLite store. Each developer has their own database."""

import sqlite3
from pathlib import Path

import click
from flask import current_app, g
from flask.cli import with_appcontext


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_error=None):
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def init_db():
    """Apply ordered migrations atomically, including on the original unversioned DB."""
    connection = get_db()
    migration_files = sorted((Path(current_app.root_path) / "migrations").glob("*.sql"))
    # The lock covers version inspection and application, so two CLI processes
    # cannot both apply the same migration. No executescript: it commits implicitly.
    with connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        applied = {
            row["version"]: row["name"]
            for row in connection.execute("SELECT version, name FROM schema_migrations")
        }
        available = {int(path.name.split("_", 1)[0]): path.name for path in migration_files}
        if any(available.get(version) != name for version, name in applied.items()):
            raise RuntimeError("Database migration history does not match this checkout.")
        for path in migration_files:
            version = int(path.name.split("_", 1)[0])
            if version in applied:
                continue
            statement = ""
            for character in path.read_text():
                statement += character
                if character == ";" and sqlite3.complete_statement(statement):
                    connection.execute(statement)
                    statement = ""
            if statement.strip():
                connection.execute(statement)
            connection.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
                (version, path.name),
            )


@click.command("init-db")
@with_appcontext
def init_db_command():
    """Initialize or migrate the database without deleting existing records."""
    init_db()
    click.echo("Database ready.")


@click.command("migrate-db")
@with_appcontext
def migrate_db_command():
    """Apply pending schema migrations. Back up your database before upgrading."""
    init_db()
    click.echo("Database migrations applied.")


@click.command("seed-demo")
@with_appcontext
def seed_demo_command():
    """Add example pool/investor records once. No ledger transactions are submitted."""
    init_db()
    connection = get_db()
    if connection.execute("SELECT id FROM pools LIMIT 1").fetchone() is None:
        connection.execute(
            "INSERT INTO pools (name, description) VALUES (?, ?)",
            ("SME Working Capital", "Demo pool for advances against future payments."),
        )
    if connection.execute("SELECT id FROM investors LIMIT 1").fetchone() is None:
        connection.execute("INSERT INTO investors (name) VALUES (?)", ("Demo Investor",))
    connection.commit()
    click.echo("Demo pool and investor ready (local database only).")


def init_app(app):
    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)
    app.cli.add_command(migrate_db_command)
    app.cli.add_command(seed_demo_command)
