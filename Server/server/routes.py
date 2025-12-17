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
    Receives a product_id and a list of country codes
    and returns a price per country.
    """
    data = request.get_json(silent=True) or {}

    product_id = data.get("product_id")
    countries = data.get("countries")

    if not isinstance(product_id, str) or not product_id.strip():
        return jsonify({"error": "product_id must be a non-empty string"}), 400

    if (
        not isinstance(countries, list)
        or not countries
        or not all(isinstance(c, str) and c.strip() for c in countries)
    ):
        return jsonify({"error": "countries must be a non-empty list of strings"}), 400

    normalized_countries = []
    seen = set()
    for c in countries:
        code = c.strip().upper()
        if code not in seen:
            seen.add(code)
            normalized_countries.append(code)

    prices_map = get_prices_for_countries(product_id.strip(), normalized_countries)

    return jsonify({
        "product_id": product_id.strip(),
        "prices": prices_map
    })
