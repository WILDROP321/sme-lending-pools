"""Small, persistent SQLite store. Each developer has their own database."""

import sqlite3

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
    with current_app.open_resource("schema.sql") as schema:
        get_db().executescript(schema.read().decode("utf-8"))


@click.command("init-db")
@with_appcontext
def init_db_command():
    """Create missing tables without deleting existing data."""
    init_db()
    click.echo("Database ready.")


@click.command("seed-demo")
@with_appcontext
def seed_demo_command():
    """Add one example pool, once. No ledger transactions are submitted."""
    init_db()
    connection = get_db()
    if connection.execute("SELECT id FROM pools LIMIT 1").fetchone() is None:
        connection.execute(
            "INSERT INTO pools (name, description) VALUES (?, ?)",
            ("SME Working Capital", "Demo pool for advances against future payments."),
        )
        connection.commit()
    click.echo("Demo pool ready (local database only).")


def init_app(app):
    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)
    app.cli.add_command(seed_demo_command)
