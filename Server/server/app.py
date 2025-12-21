from __future__ import annotations
import os
from pathlib import Path

from flask import Flask
from dotenv import load_dotenv

from server.routes import api
from server.db import db


# --------------------------------------------------
# Load environment variables from project root (.env)
# app.py location: Smart_Shopping_Project/Server/server/app.py
# .env location:   Smart_Shopping_Project/.env
# --------------------------------------------------

# Load environment variables from project root (.env)
ROOT_DIR = Path(__file__).resolve().parents[2]
ENV_PATH = ROOT_DIR / ".env"
load_dotenv(ENV_PATH)

# Debug (temporary): show where we loaded from and if key exists
print(f"[dotenv] loaded from: {ENV_PATH} (exists={ENV_PATH.exists()})")
print(f"[dotenv] GEMINI_API_KEY set? {bool(os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY'))}")

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
