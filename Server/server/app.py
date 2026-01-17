from __future__ import annotations
import os
import json
from pathlib import Path

from flask import Flask, jsonify, request
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
try:
    # In some restricted environments (CI/sandbox), .env may be unreadable; that's OK if vars are set another way.
    if ENV_PATH.exists():
        load_dotenv(ENV_PATH)
except PermissionError:
    # Avoid crashing import-time in tests/CI.
    pass

if os.getenv("DEBUG_DOTENV") == "1":
    print(f"[dotenv] loaded from: {ENV_PATH} (exists={ENV_PATH.exists()})")
    print(f"[dotenv] GEMINI_API_KEY set? {bool(os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY'))}")

def create_app(config: dict | None = None) -> Flask:
    import logging
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    app = Flask(__name__)

    # Default config (local development)
    # Use absolute path relative to this file to ensure consistent database location
    # This ensures the database is always in Server/server/instance/app.db
    db_dir = Path(__file__).parent / "instance"
    db_dir.mkdir(exist_ok=True)
    db_path = db_dir / "app.db"
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    # Session cookies (used for login state)
    app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY") or os.getenv("SECRET_KEY") or "dev-insecure-change-me"
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_HTTPONLY"] = True

    # Allow overriding config (e.g., tests)
    if config:
        app.config.update(config)

    db.init_app(app)

    # Create tables if they do not exist
    with app.app_context():
        logging.info("Creating database tables...")
        try:
            db.create_all()
            # Verify User table exists
            from server.models import User
            user_count = User.query.count()
            logging.info(f"Database tables created/verified. Users in database: {user_count}")
        except Exception as e:
            logging.error(f"Error creating database tables: {e}")
            import traceback
            logging.error(traceback.format_exc())
            raise

    app.register_blueprint(api)
    
    # Ensure all errors return JSON (not HTML)
    @app.errorhandler(404)
    def not_found(error):
        response = jsonify({"error": "Not found"})
        response.headers['Content-Type'] = 'application/json'
        return response, 404
    
    @app.errorhandler(500)
    def internal_error(error):
        import traceback
        logging.error(f"Unhandled 500 error: {error}", exc_info=True)
        logging.error(f"Traceback: {traceback.format_exc()}")
        response = jsonify({"error": "Internal server error"})
        response.headers['Content-Type'] = 'application/json'
        return response, 500
    
    @app.errorhandler(Exception)
    def handle_exception(e):
        import traceback
        logging.error(f"Unhandled exception: {e}", exc_info=True)
        logging.error(f"Traceback: {traceback.format_exc()}")
        try:
            response = jsonify({"error": "Internal server error", "details": str(e)})
            response.headers['Content-Type'] = 'application/json'
            return response, 500
        except Exception as json_err:
            logging.error(f"Failed to create JSON error response: {json_err}")
            # Return raw JSON string with explicit headers
            return '{"error": "Internal server error"}', 500, {'Content-Type': 'application/json'}
    
    # Ensure API routes always return JSON
    @app.before_request
    def before_request():
        # Log incoming requests for debugging
        if request.path.startswith('/auth/'):
            logging.info(f"Incoming {request.method} request to {request.path}")
            if request.is_json:
                logging.info(f"Request JSON: {request.get_json(silent=True)}")
    
    # Ensure all API responses have correct Content-Type
    @app.after_request
    def after_request(response):
        # Force JSON Content-Type for API routes
        if request.path.startswith('/api/') or request.path.startswith('/auth/') or request.path.startswith('/me'):
            if response.content_type and 'application/json' not in response.content_type:
                # If response is not JSON, try to ensure it is
                try:
                    # If we can parse it as JSON, set the header
                    if response.data:
                        json.loads(response.data)
                        response.headers['Content-Type'] = 'application/json'
                except:
                    # If not JSON, wrap it in a JSON error response
                    logging.warning(f"Non-JSON response detected for {request.path}, wrapping in JSON")
                    error_data = json.dumps({"error": "Internal server error", "message": response.data.decode('utf-8', errors='ignore')[:200]})
                    response.data = error_data.encode('utf-8')
                    response.headers['Content-Type'] = 'application/json'
            else:
                response.headers['Content-Type'] = 'application/json'
        return response
    
    # Catch any exceptions during teardown
    @app.teardown_request
    def teardown_request(exception):
        if exception:
            import traceback
            logging.error(f"Exception during request teardown: {exception}", exc_info=True)
            logging.error(f"Traceback: {traceback.format_exc()}")
    
    logging.info("Flask app initialized, blueprint registered")
    return app


if __name__ == "__main__":
    app = create_app()
    # Important for sandbox/CI environments: Flask's default run() calls cli.load_dotenv(),
    # which attempts to read ".env" from the working directory and can raise PermissionError.
    # We already load dotenv explicitly above (best-effort), so skip Flask's implicit loading.
    # Bind to 0.0.0.0 to make the server accessible from all network interfaces.
    app.run(host="0.0.0.0", port=8000, debug=True, load_dotenv=False)
