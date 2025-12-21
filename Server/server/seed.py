from server.app import create_app
from server.db import db
from server.models import Country, Site


def upsert_country(code: str, name: str) -> None:
    code = code.strip().upper()
    existing = Country.query.filter_by(code=code).first()
    if existing:
        existing.name = name
    else:
        db.session.add(Country(code=code, name=name))


def upsert_site(key: str, name: str, base_url: str | None) -> None:
    key = key.strip().lower()
    existing = Site.query.filter_by(key=key).first()
    if existing:
        existing.name = name
        existing.base_url = base_url
    else:
        db.session.add(Site(key=key, name=name, base_url=base_url))


def main() -> None:
    app = create_app()
    with app.app_context():
        upsert_country("IL", "Israel")
        upsert_country("GR", "Greece")
        upsert_country("HU", "Hungary")
        upsert_country("US", "United States")
        upsert_country("UK", "United Kingdom")

        upsert_site("zara", "Zara", "https://www.zara.com")

        db.session.commit()
        print("Seed completed successfully.")


if __name__ == "__main__":
    main()
