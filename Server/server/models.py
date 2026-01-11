from __future__ import annotations
from datetime import datetime
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


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    histories = db.relationship(
        "SearchHistory",
        backref="user",
        lazy=True,
        cascade="all, delete-orphan",
        order_by="desc(SearchHistory.created_at)",
    )

    def to_dict(self) -> dict:
        return {"id": self.id, "username": self.username, "email": self.email}


class SearchHistory(db.Model):
    __tablename__ = "search_history"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    mkt = db.Column(db.String(80), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)

    def to_dict(self) -> dict:
        return {"mkt": self.mkt, "created_at": self.created_at.isoformat() + "Z"}


class PasswordResetToken(db.Model):
    __tablename__ = "password_reset_tokens"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    code = db.Column(db.String(6), nullable=False, index=True)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    used = db.Column(db.Boolean, nullable=False, default=False)

    user = db.relationship("User", backref="reset_tokens")
