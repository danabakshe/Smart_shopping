# Database layer

## What it is

The app uses **SQLAlchemy** via **Flask-SQLAlchemy**. The shared instance lives in `Server/server/db.py` as `db`. Tables are created at startup with `db.create_all()` inside `create_app()` in `Server/server/app.py`.

## Where data lives

- **Default:** SQLite file `Server/server/instance/app.db` (directory is created if missing).
- **Override:** set `DATABASE_URL` in the project root `.env` (PostgreSQL supported; `postgres://` is normalized to `postgresql://`).

## Models (`Server/server/models.py`)

| Model | Table | Role |
|--------|--------|------|
| `Country` | `countries` | ISO-style country `code` (unique) and `name`. Used to decide which markets appear in price lookups. |
| `Site` | `sites` | Retailer `key` (unique), `name`, optional `base_url`. When the API receives `site_key`, the site’s **name** becomes the brand passed to price lookup and `base_url` improves search hints. |
| `User` | `users` | `username`, `email` (both unique), `password_hash`, `created_at`. Linked to search history and reset tokens. |
| `SearchHistory` | `search_history` | Per-user rows: `user_id`, `mkt` (product/SKU string), `created_at`. The API keeps **at most three** recent rows per user (older rows deleted after each new insert). |
| `PasswordResetToken` | `password_reset_tokens` | `user_id`, 6-digit `code`, `expires_at`, `used`. Supports forgot-password flow. |

### Helper methods

- `Country.to_dict()`, `Site.to_dict()`, `User.to_dict()`, `SearchHistory.to_dict()` — serialize for JSON responses (history timestamps are ISO + `Z`).

### Relationships

- `User.histories` → `SearchHistory` (ordered newest first, cascade delete).
- `PasswordResetToken.user` → `User`.

## Scripts (not runtime ORM, but DB lifecycle)

- **`Server/server/seed.py`** — In an app context, upserts default `Country` and `Site` rows (e.g. Zara), then commits.
- **`Server/recreate_db.py`** — Drops all tables and runs `create_all()` (destructive; use for local reset).

## How the API uses the DB

- Auth: create/read `User`, session stores `user_id`.
- Password reset: create/mark `PasswordResetToken`.
- `/prices`: reads `Country` / `Site`; optionally appends `SearchHistory` for the logged-in user.
- CRUD endpoints for countries and sites read/write `Country` and `Site`.
