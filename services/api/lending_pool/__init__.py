"""Application factory shared by the development server and tests."""

import os
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
        MAX_CONTENT_LENGTH=64 * 1024,
    )
    if test_config:
        app.config.update(test_config)
    Path(app.instance_path).mkdir(parents=True, exist_ok=True)
    db.init_app(app)

    from .routes import api

    app.register_blueprint(api)

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error={"code": error.code, "message": error.description}), error.code

    return app
