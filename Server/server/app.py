from flask import Flask
from server.routes import api
from server.db import db


def create_app(config: dict | None = None) -> Flask:
    app = Flask(__name__)

    # Default config (local development)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///app.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    # Allow overriding config (e.g., tests)
    if config:
        app.config.update(config)

    db.init_app(app)

    # Create tables if they do not exist
    with app.app_context():
        db.create_all()

    app.register_blueprint(api)
    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=8000, debug=True)
