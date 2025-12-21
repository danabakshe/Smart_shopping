def test_create_country_success(client):
    resp = client.post("/countries", json={"code": "FR", "name": "France"})
    assert resp.status_code == 201
    assert resp.get_json() == {"code": "FR", "name": "France"}


def test_create_country_validation(client):
    resp = client.post("/countries", json={"code": "", "name": "France"})
    assert resp.status_code == 400

    resp = client.post("/countries", json={"code": "FR", "name": ""})
    assert resp.status_code == 400

    resp = client.post("/countries", json={})
    assert resp.status_code == 400


def test_create_country_conflict(client):
    resp1 = client.post("/countries", json={"code": "FR", "name": "France"})
    assert resp1.status_code == 201

    resp2 = client.post("/countries", json={"code": "fr", "name": "France Again"})
    assert resp2.status_code == 409


def test_list_countries(client):
    client.post("/countries", json={"code": "IL", "name": "Israel"})
    client.post("/countries", json={"code": "GR", "name": "Greece"})

    resp = client.get("/countries")
    assert resp.status_code == 200
    assert resp.get_json() == [
        {"code": "GR", "name": "Greece"},
        {"code": "IL", "name": "Israel"},
    ]


def test_get_country_success(client):
    client.post("/countries", json={"code": "HU", "name": "Hungary"})
    resp = client.get("/countries/HU")
    assert resp.status_code == 200
    assert resp.get_json() == {"code": "HU", "name": "Hungary"}


def test_get_country_not_found(client):
    resp = client.get("/countries/XX")
    assert resp.status_code == 404


def test_update_country_success(client):
    client.post("/countries", json={"code": "UK", "name": "United Kingdom"})

    resp = client.put("/countries/UK", json={"name": "Great Britain"})
    assert resp.status_code == 200
    assert resp.get_json() == {"code": "UK", "name": "Great Britain"}

    resp2 = client.get("/countries/UK")
    assert resp2.status_code == 200
    assert resp2.get_json()["name"] == "Great Britain"


def test_update_country_validation(client):
    client.post("/countries", json={"code": "US", "name": "United States"})

    resp = client.put("/countries/US", json={"name": ""})
    assert resp.status_code == 400

    resp2 = client.put("/countries/US", json={})
    assert resp2.status_code == 400


def test_update_country_not_found(client):
    resp = client.put("/countries/NOPE", json={"name": "X"})
    assert resp.status_code == 404


def test_delete_country_success(client):
    client.post("/countries", json={"code": "ES", "name": "Spain"})

    resp = client.delete("/countries/ES")
    assert resp.status_code == 200
    assert resp.get_json() == {"deleted": True, "code": "ES"}

    resp2 = client.get("/countries/ES")
    assert resp2.status_code == 404


def test_delete_country_not_found(client):
    resp = client.delete("/countries/ZZ")
    assert resp.status_code == 404
