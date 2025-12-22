def test_prices_with_country_code_only_calls_selected_country(client, monkeypatch):
    import server.routes as routes

    seen = {}

    def fake_get_prices_for_countries(product_id, country_codes, brand="ZARA", site_base_url=None):
        seen["product_id"] = product_id
        seen["country_codes"] = country_codes
        return {
            country_codes[0]: {
                "country_code": country_codes[0],
                "found": False,
                "price": None,
                "currency": None,
                "product_url": None,
                "evidence": None,
                "confidence": 0.0,
            }
        }

    monkeypatch.setattr(routes, "get_prices_for_countries", fake_get_prices_for_countries)

    client.post("/countries", json={"code": "IL", "name": "Israel"})
    client.post("/countries", json={"code": "FR", "name": "France"})

    resp = client.post("/prices", json={"product_id": "12345", "country_code": "FR"})
    assert resp.status_code == 200
    assert seen["product_id"] == "12345"
    assert seen["country_codes"] == ["FR"]


def test_prices_with_country_code_unknown_returns_404(client):
    client.post("/countries", json={"code": "IL", "name": "Israel"})
    resp = client.post("/prices", json={"product_id": "12345", "country_code": "XX"})
    assert resp.status_code == 404
    assert resp.get_json() == {"error": "country 'XX' not found"}


def test_prices_with_country_codes_only_calls_selected_countries(client, monkeypatch):
    import server.routes as routes

    seen = {}

    def fake_get_prices_for_countries(product_id, country_codes, brand="ZARA", site_base_url=None):
        seen["product_id"] = product_id
        seen["country_codes"] = country_codes
        # Return stub results for all requested codes
        return {
            code: {
                "country_code": code,
                "found": False,
                "price": None,
                "currency": None,
                "product_url": None,
                "evidence": None,
                "confidence": 0.0,
            }
            for code in country_codes
        }

    monkeypatch.setattr(routes, "get_prices_for_countries", fake_get_prices_for_countries)

    client.post("/countries", json={"code": "IL", "name": "Israel"})
    client.post("/countries", json={"code": "FR", "name": "France"})
    client.post("/countries", json={"code": "US", "name": "United States"})

    resp = client.post("/prices", json={"product_id": "12345", "country_codes": ["FR", "IL"]})
    assert resp.status_code == 200
    assert seen["product_id"] == "12345"
    assert seen["country_codes"] == ["FR", "IL"]


def test_prices_with_country_codes_unknown_returns_404(client):
    client.post("/countries", json={"code": "IL", "name": "Israel"})
    resp = client.post("/prices", json={"product_id": "12345", "country_codes": ["IL", "XX"]})
    assert resp.status_code == 404
    assert resp.get_json() == {"error": "country 'XX' not found"}


def test_prices_country_code_and_country_codes_conflict_returns_400(client):
    client.post("/countries", json={"code": "IL", "name": "Israel"})
    resp = client.post("/prices", json={"product_id": "12345", "country_code": "IL", "country_codes": ["IL"]})
    assert resp.status_code == 400
    assert resp.get_json() == {"error": "provide only one of: country_code, country_codes"}


def test_prices_single_country_quota_returns_429(client, monkeypatch):
    import server.routes as routes

    def fake_get_prices_for_countries(product_id, country_codes, brand="ZARA", site_base_url=None):
        return {
            country_codes[0]: {
                "country_code": country_codes[0],
                "found": False,
                "error": "RESOURCE_EXHAUSTED",
                "error_code": "rate_limited",
                "message": "Quota exceeded. Please retry in 1.2s.",
                "retry_after": 1.2,
            }
        }

    monkeypatch.setattr(routes, "get_prices_for_countries", fake_get_prices_for_countries)

    client.post("/countries", json={"code": "IL", "name": "Israel"})
    resp = client.post("/prices", json={"product_id": "12345", "country_code": "IL"})
    assert resp.status_code == 429
    assert resp.get_json()["error_code"] == "rate_limited"
    assert "retry_after" in resp.get_json()


