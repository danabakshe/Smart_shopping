# server/routes.py
from flask import Blueprint, jsonify, request
from server.models import Country, Site
from server.db import db
from server.services.price_service import get_prices_for_countries

api = Blueprint("api", __name__)


@api.get("/health")
def health():
    """Health check endpoint."""
    return jsonify({"status": "ok"})


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
    country_code = data.get("country_code")

    if not isinstance(product_id, str) or not product_id.strip():
        return jsonify({"error": "product_id must be a non-empty string"}), 400

    if site_key is not None and (not isinstance(site_key, str) or not site_key.strip()):
        return jsonify({"error": "site_key must be a non-empty string or null"}), 400

    if country_code is not None and (not isinstance(country_code, str) or not country_code.strip()):
        return jsonify({"error": "country_code must be a non-empty string or null"}), 400

    if brand is not None and (not isinstance(brand, str) or not brand.strip()):
        return jsonify({"error": "brand must be a non-empty string"}), 400

    product_id = product_id.strip()
    brand = brand.strip()
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
    if isinstance(country_code, str) and country_code.strip():
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

    prices_map = get_prices_for_countries(product_id, country_codes, brand=brand, site_base_url=site_base_url)

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
