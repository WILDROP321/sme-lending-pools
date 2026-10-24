"""Flask CLI entry point. Run commands from the repository root."""

from lending_pool import create_app

app = create_app()
