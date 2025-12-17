def test_create_site_success(client):
    resp = client.post("/sites", json={"key": "zara", "name": "Zara", "base_url": "https://www.zara.com"})
    assert resp.status_code == 201
    assert resp.get_json() == {"key": "zara", "name": "Zara", "base_url": "https://www.zara.com"}


def test_create_site_validation(client):
    resp = client.post("/sites", json={"key": "", "name": "Zara"})
    assert resp.status_code == 400

    resp = client.post("/sites", json={"key": "zara", "name": ""})
    assert resp.status_code == 400

    resp = client.post("/sites", json={"key": "zara", "name": "Zara", "base_url": ""})
    assert resp.status_code == 400

    resp = client.post("/sites", json={})
    assert resp.status_code == 400


def test_create_site_conflict(client):
    resp1 = client.post("/sites", json={"key": "zara", "name": "Zara"})
    assert resp1.status_code == 201

    resp2 = client.post("/sites", json={"key": "ZARA", "name": "Zara Again"})
    assert resp2.status_code == 409


def test_list_sites(client):
    client.post("/sites", json={"key": "zara", "name": "Zara"})
    client.post("/sites", json={"key": "hm", "name": "H&M", "base_url": "https://www2.hm.com"})

    resp = client.get("/sites")
    assert resp.status_code == 200

    data = resp.get_json()
    # Order is by key asc
    assert data == [
        {"key": "hm", "name": "H&M", "base_url": "https://www2.hm.com"},
        {"key": "zara", "name": "Zara", "base_url": None},
    ]


def test_get_site_success(client):
    client.post("/sites", json={"key": "zara", "name": "Zara"})
    resp = client.get("/sites/ZARA")
    assert resp.status_code == 200
    assert resp.get_json() == {"key": "zara", "name": "Zara", "base_url": None}


def test_get_site_not_found(client):
    resp = client.get("/sites/nope")
    assert resp.status_code == 404


def test_update_site_success_name_only(client):
    client.post("/sites", json={"key": "zara", "name": "Zara"})

    resp = client.put("/sites/ZARA", json={"name": "ZARA Official"})
    assert resp.status_code == 200
    assert resp.get_json() == {"key": "zara", "name": "ZARA Official", "base_url": None}


def test_update_site_success_base_url_only(client):
    client.post("/sites", json={"key": "zara", "name": "Zara"})

    resp = client.put("/sites/zara", json={"base_url": "https://www.zara.com"})
    assert resp.status_code == 200
    assert resp.get_json() == {"key": "zara", "name": "Zara", "base_url": "https://www.zara.com"}


def test_update_site_validation(client):
    client.post("/sites", json={"key": "zara", "name": "Zara"})

    resp = client.put("/sites/zara", json={})
    assert resp.status_code == 400

    resp2 = client.put("/sites/zara", json={"name": ""})
    assert resp2.status_code == 400

    resp3 = client.put("/sites/zara", json={"base_url": ""})
    assert resp3.status_code == 400


def test_update_site_not_found(client):
    resp = client.put("/sites/nope", json={"name": "X"})
    assert resp.status_code == 404


def test_delete_site_success(client):
    client.post("/sites", json={"key": "asos", "name": "ASOS"})

    resp = client.delete("/sites/ASOS")
    assert resp.status_code == 200
    assert resp.get_json() == {"deleted": True, "key": "asos"}

    resp2 = client.get("/sites/asos")
    assert resp2.status_code == 404


def test_delete_site_not_found(client):
    resp = client.delete("/sites/nope")
    assert resp.status_code == 404
