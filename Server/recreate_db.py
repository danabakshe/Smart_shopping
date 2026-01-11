#!/usr/bin/env python3
"""Recreate database tables with current schema."""
from server.app import create_app
from server.db import db
from server.models import Country, Site, User, SearchHistory, PasswordResetToken

app = create_app()

with app.app_context():
    print("Dropping all tables...")
    db.drop_all()
    print("Creating all tables...")
    db.create_all()
    print("Database recreated successfully!")
