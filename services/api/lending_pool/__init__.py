"""Application factory shared by the development server and tests."""

import os
import secrets
from pathlib import Path

from flask import Flask, jsonify, render_template
from werkzeug.exceptions import HTTPException

from . import db


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        DATABASE=str(Path(app.instance_path) / "lending.sqlite"),
        XRPL_JSON_RPC_URL=os.getenv(
            "XRPL_JSON_RPC_URL", "https://s.devnet.rippletest.net:51234/"
        ),
        MAX_CONTENT_LENGTH=6 * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SECRET_KEY=os.getenv("FLASK_SECRET_KEY"),
    )
    if test_config:
        app.config.update(test_config)
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    if not app.config["SECRET_KEY"]:
        if app.testing:
            app.config["SECRET_KEY"] = "isolated-test-secret"
        else:
            secret_path = Path(app.instance_path) / "session-secret"
            try:
                with secret_path.open("x") as secret_file:
                    os.chmod(secret_path, 0o600)
                    secret_file.write(secrets.token_hex(32))
            except FileExistsError:
                pass
            app.config["SECRET_KEY"] = secret_path.read_text()
    db.init_app(app)

    from .routes import api

    app.register_blueprint(api)
    from .market import market
    app.register_blueprint(market)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error={"code": error.code, "message": error.description}), error.code

    return app
