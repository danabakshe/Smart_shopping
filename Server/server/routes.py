# server/routes.py
from flask import Blueprint, jsonify, request, session
from werkzeug.security import check_password_hash, generate_password_hash
from datetime import datetime, timedelta
import secrets

from server.models import Country, Site, User, SearchHistory, PasswordResetToken
from server.db import db
from server.services.price_service import GenAIUnavailableError, get_prices_for_countries
from server.services.fx_service import get_fx_rates, quota_error_payload
from server.services.price_service import _looks_like_quota_error
from server.services.email_service import is_valid_email, send_password_reset_email

api = Blueprint("api", __name__)


@api.get("/")
def root():
    """API root endpoint - lists available endpoints."""
    return jsonify({
        "message": "Smart Shopping API",
        "version": "1.0.0",
        "endpoints": {
            "health": "GET /health",
            "fx": "GET /fx?base=USD&symbols=USD,EUR,ILS",
            "countries": "GET /countries",
            "sites": "GET /sites",
            "prices": "POST /prices",
            "auth": {
                "signup": "POST /auth/signup",
                "login": "POST /auth/login",
                "logout": "POST /auth/logout",
                "forgot_password": "POST /auth/forgot-password",
                "reset_password": "POST /auth/reset-password",
                "me": "GET /me",
                "history": "GET /me/history"
            }
        },
        "frontend": "http://localhost:3000"
    })


def _current_user() -> User | None:
    uid = session.get("user_id")
    if not isinstance(uid, int):
        return None
    return db.session.get(User, uid)


def _record_search_history(user_id: int, mkt: str) -> None:
    mkt = (mkt or "").strip()
    if not mkt:
        return

    db.session.add(SearchHistory(user_id=user_id, mkt=mkt))
    db.session.flush()

    # Keep only last 3 searches per user
    rows = (
        SearchHistory.query.filter_by(user_id=user_id)
        .order_by(SearchHistory.created_at.desc(), SearchHistory.id.desc())
        .all()
    )
    if len(rows) > 3:
        for r in rows[3:]:
            db.session.delete(r)


def _validate_username_password(data: dict) -> tuple[str | None, str | None, str | None]:
    username = data.get("username")
    password = data.get("password")

    if not isinstance(username, str) or not username.strip():
        return None, None, "username must be a non-empty string"
    if not isinstance(password, str) or not password.strip():
        return None, None, "password must be a non-empty string"

    username = username.strip()
    password = password.strip()

    if len(username) < 3:
        return None, None, "username must be at least 3 characters"
    if len(password) < 6:
        return None, None, "password must be at least 6 characters"
    return username, password, None


def _validate_email(email: str | None) -> tuple[str | None, str | None]:
    """Validate email format. Returns (email, error)."""
    if not isinstance(email, str) or not email.strip():
        return None, "email must be a non-empty string"
    
    email = email.strip().lower()
    
    if not is_valid_email(email):
        return None, "email must be a valid email address"
    
    return email, None


@api.get("/health")
def health():
    """Health check endpoint."""
    return jsonify({"status": "ok"})


@api.get("/fx")
def fx():
    """
    Returns FX rates for a given base currency.
    rates are: 1 BASE = X currency
    """
    base = (request.args.get("base") or "USD").strip().upper()
    symbols_arg = request.args.get("symbols") or "USD,EUR,ILS"
    symbols = [s.strip().upper() for s in symbols_arg.split(",") if isinstance(s, str) and s.strip()]

    try:
        data = get_fx_rates(base=base, symbols=symbols)
        return jsonify(data)
    except GenAIUnavailableError as e:
        return jsonify({"error": str(e)}), 503
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        if _looks_like_quota_error(e):
            return jsonify(quota_error_payload(e)), 429
        return jsonify({"error": str(e) or "Failed to fetch FX rates"}), 500


# -----------------------
# Auth
# -----------------------

@api.post("/auth/signup")
def signup():
    import logging
    import traceback
    try:
        logging.info("=== SIGNUP REQUEST START ===")
        data = request.get_json(silent=True) or {}
        logging.info(f"Received data: {data}")
        logging.info(f"Data type: {type(data)}")
        
        username, password, err = _validate_username_password(data)
        if err:
            logging.warning(f"Validation error: {err}")
            return jsonify({"error": err}), 400

        email, email_err = _validate_email(data.get("email"))
        if email_err:
            logging.warning(f"Email validation error: {email_err}")
            return jsonify({"error": email_err}), 400

        logging.info(f"Checking for existing username: {username}")
        existing_username = User.query.filter_by(username=username).first()
        if existing_username is not None:
            logging.warning(f"Username already exists: {username}")
            return jsonify({"error": "username already exists"}), 409

        logging.info(f"Checking for existing email: {email}")
        existing_email = User.query.filter_by(email=email).first()
        if existing_email is not None:
            logging.warning(f"Email already exists: {email}")
            return jsonify({"error": "email already exists"}), 409

        logging.info("Creating new user")
        user = User(
            username=username,
            email=email,
            password_hash=generate_password_hash(password)
        )
        db.session.add(user)
        logging.info("Committing to database")
        db.session.commit()
        logging.info(f"User created with ID: {user.id}")

        logging.info(f"Setting session user_id: {user.id}")
        session["user_id"] = user.id
        logging.info("Session set successfully")
        
        user_dict = user.to_dict()
        logging.info(f"Returning user data: {user_dict}")
        logging.info("=== SIGNUP REQUEST SUCCESS ===")
        return jsonify({"user": user_dict}), 201
    except Exception as e:
        logging.error("=== SIGNUP REQUEST ERROR ===")
        logging.error(f"Exception type: {type(e).__name__}")
        logging.error(f"Exception message: {str(e)}")
        logging.error(f"Full traceback:\n{traceback.format_exc()}")
        # Ensure we always return valid JSON
        try:
            error_msg = str(e) if str(e) else "Internal server error"
            logging.error(f"Returning error response: {error_msg}")
            response = jsonify({"error": f"Signup failed: {error_msg}"})
            response.headers['Content-Type'] = 'application/json'
            return response, 500
        except Exception as json_err:
            logging.error(f"Failed to jsonify error response: {json_err}")
            logging.error(f"JSON error traceback:\n{traceback.format_exc()}")
            # Return raw JSON string with explicit headers
            return '{"error": "Signup failed: Internal server error"}', 500, {'Content-Type': 'application/json', 'Content-Length': str(len('{"error": "Signup failed: Internal server error"}'))}


@api.post("/auth/login")
def login():
    import logging
    import traceback
    try:
        logging.info("=== LOGIN REQUEST START ===")
        data = request.get_json(silent=True) or {}
        logging.info(f"Received data: {data}")
        logging.info(f"Data type: {type(data)}")
        
        username, password, err = _validate_username_password(data)
        if err:
            logging.warning(f"Validation error: {err}")
            return jsonify({"error": err}), 400

        logging.info(f"Looking up user: {username}")
        user = User.query.filter_by(username=username).first()
        logging.info(f"User found: {user is not None}")
        
        if user is None:
            logging.warning(f"User not found: {username}")
            return jsonify({"error": "invalid username or password"}), 401
            
        logging.info("Checking password hash")
        password_valid = check_password_hash(user.password_hash, password)
        logging.info(f"Password valid: {password_valid}")
        
        if not password_valid:
            logging.warning(f"Invalid password for user: {username}")
            return jsonify({"error": "invalid username or password"}), 401

        logging.info(f"Setting session user_id: {user.id}")
        session["user_id"] = user.id
        logging.info("Session set successfully")
        
        user_dict = user.to_dict()
        logging.info(f"Returning user data: {user_dict}")
        logging.info("=== LOGIN REQUEST SUCCESS ===")
        return jsonify({"user": user_dict})
    except Exception as e:
        logging.error("=== LOGIN REQUEST ERROR ===")
        logging.error(f"Exception type: {type(e).__name__}")
        logging.error(f"Exception message: {str(e)}")
        logging.error(f"Full traceback:\n{traceback.format_exc()}")
        # Ensure we always return valid JSON
        try:
            error_msg = str(e) if str(e) else "Internal server error"
            logging.error(f"Returning error response: {error_msg}")
            response = jsonify({"error": f"Login failed: {error_msg}"})
            response.headers['Content-Type'] = 'application/json'
            return response, 500
        except Exception as json_err:
            logging.error(f"Failed to jsonify error response: {json_err}")
            logging.error(f"JSON error traceback:\n{traceback.format_exc()}")
            # Return raw JSON string with explicit headers
            return '{"error": "Login failed: Internal server error"}', 500, {'Content-Type': 'application/json', 'Content-Length': str(len('{"error": "Login failed: Internal server error"}'))}


@api.post("/auth/logout")
def logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


@api.post("/auth/forgot-password")
def forgot_password():
    """Request password reset - sends code to user's email."""
    data = request.get_json(silent=True) or {}
    email = data.get("email")
    
    email, email_err = _validate_email(email)
    if email_err:
        return jsonify({"error": email_err}), 400

    user = User.query.filter_by(email=email).first()
    # Don't reveal if email exists (security best practice)
    if user is None:
        # Still return success to prevent email enumeration
        return jsonify({"ok": True, "message": "If the email exists, a reset code has been sent"})

    # Generate 6-digit code
    code = f"{secrets.randbelow(1000000):06d}"
    
    # Expires in 10 minutes
    expires_at = datetime.utcnow() + timedelta(minutes=10)
    
    # Invalidate any existing unused tokens for this user
    PasswordResetToken.query.filter_by(user_id=user.id, used=False).update({"used": True})
    
    # Create new token
    token = PasswordResetToken(
        user_id=user.id,
        code=code,
        expires_at=expires_at
    )
    db.session.add(token)
    db.session.commit()
    
    # Send email
    send_password_reset_email(user.email, code)
    
    return jsonify({"ok": True, "message": "If the email exists, a reset code has been sent"})


@api.post("/auth/reset-password")
def reset_password():
    """Reset password using code from email."""
    data = request.get_json(silent=True) or {}
    email = data.get("email")
    code = data.get("code")
    new_password = data.get("new_password")
    
    email, email_err = _validate_email(email)
    if email_err:
        return jsonify({"error": email_err}), 400
    
    if not isinstance(code, str) or not code.strip():
        return jsonify({"error": "code must be a non-empty string"}), 400
    
    if not isinstance(new_password, str) or not new_password.strip():
        return jsonify({"error": "new_password must be a non-empty string"}), 400
    
    code = code.strip()
    new_password = new_password.strip()
    
    if len(code) != 6 or not code.isdigit():
        return jsonify({"error": "code must be a 6-digit number"}), 400
    
    if len(new_password) < 6:
        return jsonify({"error": "password must be at least 6 characters"}), 400
    
    # Find user
    user = User.query.filter_by(email=email).first()
    if user is None:
        return jsonify({"error": "invalid email or code"}), 400
    
    # Find valid token
    token = PasswordResetToken.query.filter_by(
        user_id=user.id,
        code=code,
        used=False
    ).first()
    
    if token is None or token.expires_at < datetime.utcnow():
        return jsonify({"error": "invalid or expired code"}), 400
    
    # Update password
    user.password_hash = generate_password_hash(new_password)
    
    # Mark token as used
    token.used = True
    
    db.session.commit()
    
    return jsonify({"ok": True, "message": "Password reset successfully"})


@api.get("/me")
def me():
    user = _current_user()
    return jsonify({"user": user.to_dict() if user else None})


@api.get("/me/history")
def my_history():
    user = _current_user()
    if user is None:
        return jsonify({"error": "not authenticated"}), 401

    try:
        rows = (
            SearchHistory.query.filter_by(user_id=user.id)
            .order_by(SearchHistory.created_at.desc(), SearchHistory.id.desc())
            .limit(3)
            .all()
        )
        return jsonify({"items": [r.to_dict() for r in rows]})
    except Exception as e:
        import logging
        logging.error(f"Error fetching history: {e}", exc_info=True)
        return jsonify({"error": "Failed to fetch history", "details": str(e)}), 500

@api.post("/me/history")
def record_history():
    """Record a search in history (used even when in mock mode)."""
    user = _current_user()
    if user is None:
        return jsonify({"error": "not authenticated"}), 401
    
    data = request.get_json(silent=True) or {}
    product_id = data.get("product_id") or data.get("mkt")
    
    if not isinstance(product_id, str) or not product_id.strip():
        return jsonify({"error": "product_id must be a non-empty string"}), 400
    
    try:
        _record_search_history(user.id, product_id.strip())
        db.session.commit()
        return jsonify({"ok": True})
    except Exception as e:
        import logging
        logging.warning(f"Failed to record search history: {e}", exc_info=True)
        try:
            db.session.rollback()
        except Exception:
            pass
        return jsonify({"error": "Failed to record history"}), 500


# -----------------------
# Countries CRUD
# -----------------------

@api.get("/countries")
def list_countries():
    """Return all countries."""
    countries = Country.query.order_by(Country.code.asc()).all()
    return jsonify([c.to_dict() for c in countries])


@api.get("/countries/<string:code>")
def get_country(code: str):
    """Return a single country by code."""
    code = code.strip().upper()
    country = Country.query.filter_by(code=code).first()
    if country is None:
        return jsonify({"error": f"country '{code}' not found"}), 404
    return jsonify(country.to_dict())


@api.post("/countries")
def create_country():
    """Create a new country."""
    data = request.get_json(silent=True) or {}

    code = data.get("code")
    name = data.get("name")

    if not isinstance(code, str) or not code.strip():
        return jsonify({"error": "code must be a non-empty string"}), 400
    if not isinstance(name, str) or not name.strip():
        return jsonify({"error": "name must be a non-empty string"}), 400

    code = code.strip().upper()
    name = name.strip()

    existing = Country.query.filter_by(code=code).first()
    if existing is not None:
        return jsonify({"error": f"country '{code}' already exists"}), 409

    country = Country(code=code, name=name)
    db.session.add(country)
    db.session.commit()

    return jsonify(country.to_dict()), 201


@api.put("/countries/<string:code>")
def update_country(code: str):
    """Update an existing country (name only)."""
    code = code.strip().upper()
    country = Country.query.filter_by(code=code).first()
    if country is None:
        return jsonify({"error": f"country '{code}' not found"}), 404

    data = request.get_json(silent=True) or {}
    name = data.get("name")

    if not isinstance(name, str) or not name.strip():
        return jsonify({"error": "name must be a non-empty string"}), 400

    country.name = name.strip()
    db.session.commit()

    return jsonify(country.to_dict())


@api.delete("/countries/<string:code>")
def delete_country(code: str):
    """Delete a country by code."""
    code = code.strip().upper()
    country = Country.query.filter_by(code=code).first()
    if country is None:
        return jsonify({"error": f"country '{code}' not found"}), 404

    db.session.delete(country)
    db.session.commit()

    return jsonify({"deleted": True, "code": code})


# -----------------------
# Sites CRUD
# -----------------------

@api.get("/sites")
def list_sites():
    """Return all sites."""
    sites = Site.query.order_by(Site.key.asc()).all()
    return jsonify([s.to_dict() for s in sites])


@api.get("/sites/<string:key>")
def get_site(key: str):
    """Return a single site by key."""
    key = key.strip().lower()
    site = Site.query.filter_by(key=key).first()
    if site is None:
        return jsonify({"error": f"site '{key}' not found"}), 404
    return jsonify(site.to_dict())


@api.post("/sites")
def create_site():
    """Create a new site."""
    data = request.get_json(silent=True) or {}

    key = data.get("key")
    name = data.get("name")
    base_url = data.get("base_url")

    if not isinstance(key, str) or not key.strip():
        return jsonify({"error": "key must be a non-empty string"}), 400
    if not isinstance(name, str) or not name.strip():
        return jsonify({"error": "name must be a non-empty string"}), 400

    if base_url is not None and (not isinstance(base_url, str) or not base_url.strip()):
        return jsonify({"error": "base_url must be a non-empty string or null"}), 400

    key = key.strip().lower()
    name = name.strip()
    base_url = base_url.strip() if isinstance(base_url, str) else None

    existing = Site.query.filter_by(key=key).first()
    if existing is not None:
        return jsonify({"error": f"site '{key}' already exists"}), 409

    site = Site(key=key, name=name, base_url=base_url)
    db.session.add(site)
    db.session.commit()

    return jsonify(site.to_dict()), 201


@api.put("/sites/<string:key>")
def update_site(key: str):
    """Update an existing site (name/base_url)."""
    key = key.strip().lower()
    site = Site.query.filter_by(key=key).first()
    if site is None:
        return jsonify({"error": f"site '{key}' not found"}), 404

    data = request.get_json(silent=True) or {}
    name = data.get("name")
    base_url = data.get("base_url")

    if name is None and base_url is None:
        return jsonify({"error": "provide at least one of: name, base_url"}), 400

    if name is not None:
        if not isinstance(name, str) or not name.strip():
            return jsonify({"error": "name must be a non-empty string"}), 400
        site.name = name.strip()

    if base_url is not None:
        if base_url is not None and (not isinstance(base_url, str) or not base_url.strip()):
            return jsonify({"error": "base_url must be a non-empty string or null"}), 400
        site.base_url = base_url.strip() if isinstance(base_url, str) else None

    db.session.commit()
    return jsonify(site.to_dict())


@api.delete("/sites/<string:key>")
def delete_site(key: str):
    """Delete a site by key."""
    key = key.strip().lower()
    site = Site.query.filter_by(key=key).first()
    if site is None:
        return jsonify({"error": f"site '{key}' not found"}), 404

    db.session.delete(site)
    db.session.commit()

    return jsonify({"deleted": True, "key": key})


# -----------------------
# Prices
# -----------------------

@api.post("/prices")
def prices():
    """
    Receives a product_id (SKU/MKT) and returns a price per country,
    for all countries currently stored in the DB.
    """
    data = request.get_json(silent=True) or {}

    product_id = data.get("product_id")
    brand = data.get("brand", "ZARA")
    site_key = data.get("site_key")
    product_url_hint = data.get("product_url_hint")
    country_code = data.get("country_code")
    country_codes = data.get("country_codes")

    if not isinstance(product_id, str) or not product_id.strip():
        return jsonify({"error": "product_id must be a non-empty string"}), 400

    if site_key is not None and (not isinstance(site_key, str) or not site_key.strip()):
        return jsonify({"error": "site_key must be a non-empty string or null"}), 400

    if country_code is not None and (not isinstance(country_code, str) or not country_code.strip()):
        return jsonify({"error": "country_code must be a non-empty string or null"}), 400

    if country_codes is not None and not isinstance(country_codes, list):
        return jsonify({"error": "country_codes must be a list of strings or null"}), 400

    if country_code is not None and country_codes is not None:
        return jsonify({"error": "provide only one of: country_code, country_codes"}), 400

    if brand is not None and (not isinstance(brand, str) or not brand.strip()):
        return jsonify({"error": "brand must be a non-empty string"}), 400

    if product_url_hint is not None and (not isinstance(product_url_hint, str) or not product_url_hint.strip()):
        return jsonify({"error": "product_url_hint must be a non-empty string or null"}), 400

    product_id = product_id.strip()
    brand = brand.strip()
    product_url_hint = product_url_hint.strip() if isinstance(product_url_hint, str) else None
    site_base_url = None

    # If site_key was provided, map it to a Site and use its name as the brand.
    # This keeps the response consistent and allows clients to choose a site.
    if isinstance(site_key, str) and site_key.strip():
        key = site_key.strip().lower()
        site = Site.query.filter_by(key=key).first()
        if site is None:
            return jsonify({"error": f"site '{key}' not found"}), 404
        brand = site.name
        site_base_url = site.base_url

    # Determine which countries to price (single selected country is strongly preferred to avoid API quota blowups)
    if isinstance(country_codes, list):
        requested_raw = [c for c in country_codes if isinstance(c, str) and c.strip()]
        requested = [(c.strip().upper()) for c in requested_raw]
        if not requested:
            return jsonify({"error": "country_codes must contain at least one non-empty string"}), 400

        # De-duplicate but preserve order
        seen = set()
        requested = [c for c in requested if not (c in seen or seen.add(c))]

        # Normalize UK -> GB (ISO standard, works better with Zara)
        requested_norm = ["GB" if c == "UK" else c for c in requested]

        existing = {c.code.strip().upper() for c in Country.query.with_entities(Country.code).all()}
        missing = [c for c in requested if c not in existing and ("GB" if c == "UK" else c) not in existing]
        if missing:
            # Keep error format consistent with single-country behavior
            if len(missing) == 1:
                return jsonify({"error": f"country '{missing[0]}' not found"}), 404
            return jsonify({"error": f"countries not found: {', '.join(missing)}"}), 404

        country_codes = requested_norm
    elif isinstance(country_code, str) and country_code.strip():
        requested = country_code.strip().upper()
        requested_norm = "GB" if requested == "UK" else requested

        country = Country.query.filter_by(code=requested).first()
        if country is None and requested != requested_norm:
            # If user provided UK, allow matching stored UK code too
            country = Country.query.filter_by(code=requested_norm).first()

        if country is None:
            return jsonify({"error": f"country '{requested}' not found"}), 404

        country_codes = [requested_norm]
    else:
        # Pull countries from DB
        countries = Country.query.order_by(Country.code.asc()).all()
        country_codes = [c.code.strip().upper() for c in countries if isinstance(c.code, str) and c.code.strip()]
        # Normalize UK -> GB (ISO standard, works better with Zara)
        country_codes = ["GB" if c == "UK" else c for c in country_codes]

    if not country_codes:
        return jsonify({"error": "no countries in database"}), 400

    # If logged-in, record search history (best-effort; does not block the request).
    try:
        uid = session.get("user_id")
        if isinstance(uid, int):
            _record_search_history(uid, product_id)
            db.session.commit()
        else:
            # Log when user_id is not found in session (for debugging)
            import logging
            logging.debug(f"History not recorded: user_id not in session (got {type(uid).__name__})")
    except Exception as e:
        # Log the error but don't block the request
        import logging
        logging.warning(f"Failed to record search history: {e}", exc_info=True)
        try:
            db.session.rollback()
        except Exception:
            pass

    extra_kwargs = {"product_url_hint": product_url_hint} if product_url_hint else {}
    try:
        prices_map = get_prices_for_countries(
            product_id,
            country_codes,
            brand=brand,
            site_base_url=site_base_url,
            **extra_kwargs,
        )
    except GenAIUnavailableError as e:
        return jsonify({"error": str(e)}), 503

    # If the caller requested a single country and we hit quota exhaustion, surface it as 429 for the client UX.
    if len(country_codes) == 1:
        only_code = country_codes[0]
        only = prices_map.get(only_code) if isinstance(prices_map, dict) else None
        if isinstance(only, dict) and (only.get("error") in {"RESOURCE_EXHAUSTED", "quota_exceeded"}):
            payload = {
                "error": only.get("message") or "Quota exceeded",
                "error_code": only.get("error_code") or "quota_exceeded",
                "retry_after": only.get("retry_after"),
            }
            return jsonify(payload), 429

    return jsonify({
        "product_id": product_id,
        "brand": brand,
        "countries_count": len(country_codes),
        "prices": prices_map
    })
