def test_signup_login_me_and_history_last3(client, monkeypatch):
    import server.routes as routes

    def fake_get_prices_for_countries(product_id, country_codes, brand="ZARA", site_base_url=None, product_url_hint=None):
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

    # /prices requires at least one country in DB
    client.post("/countries", json={"code": "IL", "name": "Israel"})

    # Sign up auto-logs-in
    resp = client.post("/auth/signup", json={"username": "alom", "password": "secret12"})
    assert resp.status_code == 201
    assert resp.get_json()["user"]["username"] == "alom"

    resp = client.get("/me")
    assert resp.status_code == 200
    assert resp.get_json()["user"]["username"] == "alom"

    # Record searches (server stores only last 3)
    for pid in ["111", "222", "333", "444"]:
        r = client.post("/prices", json={"product_id": pid, "country_code": "IL"})
        assert r.status_code == 200

    resp = client.get("/me/history")
    assert resp.status_code == 200
    items = resp.get_json()["items"]
    assert [x["mkt"] for x in items] == ["444", "333", "222"]

    # Logout blocks history
    client.post("/auth/logout")
    resp = client.get("/me/history")
    assert resp.status_code == 401


def test_login_invalid_password_returns_401(client):
    client.post("/auth/signup", json={"username": "user1", "password": "secret12"})
    client.post("/auth/logout")

    resp = client.post("/auth/login", json={"username": "user1", "password": "wrongpass"})
    assert resp.status_code == 401
    assert resp.get_json() == {"error": "invalid username or password"}



