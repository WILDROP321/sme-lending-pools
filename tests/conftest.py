import pytest

from lending_pool import create_app
from lending_pool.db import init_db


@pytest.fixture
def app(tmp_path):
    application = create_app({"TESTING": True, "DATABASE": str(tmp_path / "test.sqlite")})
    with application.app_context():
        init_db()
    return application


@pytest.fixture
def client(app):
    return app.test_client()
