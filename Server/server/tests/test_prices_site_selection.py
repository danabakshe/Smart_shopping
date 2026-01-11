def test_prices_site_key_not_found_returns_404(client):
    # Countries are required by /prices; create one so we don't fail earlier.
    client.post("/countries", json={"code": "IL", "name": "Israel"})

    resp = client.post("/prices", json={"product_id": "12345", "site_key": "nope"})
    assert resp.status_code == 404
    assert resp.get_json() == {"error": "site 'nope' not found"}


def test_prices_site_key_sets_brand_from_site(client, monkeypatch):
    # Avoid external price lookup; just return an empty map.
    import server.routes as routes

    def fake_get_prices_for_countries(product_id, country_codes, brand="ZARA", site_base_url=None):
        assert product_id == "12345"
        assert country_codes == ["IL"]
        assert brand == "Zara"
        assert site_base_url == "https://www.zara.com"
        return {"IL": {"country_code": "IL", "found": False, "price": None, "currency": None, "product_url": None, "evidence": None, "confidence": 0.0}}

    monkeypatch.setattr(routes, "get_prices_for_countries", fake_get_prices_for_countries)

    client.post("/countries", json={"code": "IL", "name": "Israel"})
    client.post("/sites", json={"key": "zara", "name": "Zara", "base_url": "https://www.zara.com"})

    resp = client.post("/prices", json={"product_id": "12345", "site_key": "zara"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["brand"] == "Zara"
    assert data["product_id"] == "12345"
    assert data["countries_count"] == 1
    assert "prices" in data and "IL" in data["prices"]


