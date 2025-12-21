from __future__ import annotations
from server.db import db


class Country(db.Model):
    __tablename__ = "countries"

    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(8), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)

    def to_dict(self) -> dict:
        return {"code": self.code, "name": self.name}


class Site(db.Model):
    __tablename__ = "sites"

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(40), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120), nullable=False)
    base_url = db.Column(db.String(500), nullable=True)

    def to_dict(self) -> dict:
        return {"key": self.key, "name": self.name, "base_url": self.base_url}
