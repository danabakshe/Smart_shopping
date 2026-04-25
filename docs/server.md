# Server (Flask API)

## Entry and app factory

**`Server/server/app.py`**

- Loads `.env` from the **project root** (two levels above `app.py`), with a safe fallback if the file is unreadable.
- **`create_app(config=None)`** — Builds the Flask app:
  - Enables **CORS** with credentials.
  - Sets **`SQLALCHEMY_DATABASE_URI`** (SQLite default or `DATABASE_URL`).
  - Sets **session** cookie options and `SECRET_KEY` (from env or dev default).
  - Calls **`db.init_app(app)`** and **`db.create_all()`** inside an app context.
  - Registers the **`api`** blueprint at prefix **`/api`**.
  - Registers JSON-oriented **404 / 500 / generic** error handlers and hooks that normalize **`/api/*`**, **`/auth/*`**, **`/me`** responses to JSON.
- **`__main__`** — Runs the dev server on `0.0.0.0:8000` with `load_dotenv=False` (env already loaded above).

## HTTP API (`Server/server/routes.py`)

Blueprint `api` is registered with **`url_prefix='/api'`**, so every route below is served under **`/api/...`**.

### Discovery and health

- **`GET /api/`** — `root()`: API metadata and endpoint list.
- **`GET /api/health`** — `health()`: `{ "status": "ok" }`.

### Auth (cookie session)

- **`POST /api/auth/signup`** — `signup()`: validates username/password/email, hashes password, creates user, sets `session["user_id"]`, returns `user`.
- **`POST /api/auth/login`** — `login()`: validates credentials, sets session, returns `user`.
- **`POST /api/auth/logout`** — `logout()`: clears `user_id` from session.
- **`POST /api/auth/forgot-password`** — `forgot_password()`: validates email; if user exists, invalidates old tokens, creates 6-digit code + expiry, emails (or logs) via `email_service`.
- **`POST /api/auth/reset-password`** — `reset_password()`: email + code + `new_password`; updates hash, marks token used.

### Current user and history

- **`GET /api/me`** — `me()`: `{ "user": ... | null }` from session.
- **`GET /api/me/history`** — `my_history()`: last 3 `SearchHistory` items (401 if not logged in).
- **`POST /api/me/history`** — `record_history()`: body `product_id` or `mkt`; appends history and trims to 3 (for mock mode / explicit recording).

### Countries CRUD

- **`GET /api/countries`** — `list_countries()`
- **`GET /api/countries/<code>`** — `get_country()`
- **`POST /api/countries`** — `create_country()` — body: `code`, `name`
- **`PUT /api/countries/<code>`** — `update_country()` — body: `name`
- **`DELETE /api/countries/<code>`** — `delete_country()`

### Sites CRUD

- **`GET /api/sites`** — `list_sites()`
- **`GET /api/sites/<key>`** — `get_site()`
- **`POST /api/sites`** — `create_site()` — `key`, `name`, optional `base_url`
- **`PUT /api/sites/<key>`** — `update_site()` — `name` and/or `base_url`
- **`DELETE /api/sites/<key>`** — `delete_site()`

### FX

- **`GET /api/fx`** — `fx()`: query `base` (default USD), `symbols` (comma-separated). Delegates to `fx_service.get_fx_rates`. Returns 503 if Gemini unavailable, 400 on bad input, 429 on quota-like errors when applicable.

### Prices

- **`POST /api/prices`** — `prices()`: JSON body:
  - **`product_id`** (required)
  - **`brand`** (default `ZARA`)
  - **`site_key`** (optional): resolves `Site`; uses site **name** as brand and **base_url** for hints
  - **`country_code`** OR **`country_codes`** (optional; mutual exclusion): restrict markets; otherwise all DB countries
  - **`product_url_hint`** (optional)
  - Normalizes `UK` → `GB` for lookups.
  - Records search history for logged-in users (non-blocking on failure).
  - Calls **`get_prices_for_countries`** from `price_service`; single-country quota errors may return **429** with retry metadata.

### Internal helpers in `routes.py`

- **`_current_user()`** — Load `User` from `session["user_id"]`.
- **`_record_search_history(user_id, mkt)`** — Insert row, then delete older rows so only 3 remain.
- **`_validate_username_password`**, **`_validate_email`** — Input validation for auth.

## Services

### `Server/server/services/price_service.py`

Gemini-backed, search-grounded product price lookup per country.

- **`GenAIUnavailableError`** — Raised if `google-genai` is missing or not configured.
- **`get_prices_for_countries(product_id, country_codes, brand=..., site_base_url=..., product_url_hint=...)`** — Main entry: loops countries with configurable delay (`GEMINI_RATE_LIMIT_DELAY_SECONDS`), returns a dict keyed by country code with price fields or structured errors (quota, etc.).
- Internal helpers include: API client/key/model selection, **in-memory price cache** (`PRICE_CACHE_TTL_SECONDS`, prompt version), SKU string variants, site-specific Google query hints, **`_lookup_price_for_country`** (and URL lookup), quota/retry parsing.

Env highlights: `GEMINI_API_KEY` or `GOOGLE_API_KEY`, `GEMINI_MODEL`, cache and rate-limit vars.

### `Server/server/services/fx_service.py`

- **`get_fx_rates(base, symbols)`** — Uses same Gemini client; Google Search tool; returns `{ base, as_of_utc, rates }` for USD/EUR/ILS subset; **in-memory FX cache** (`FX_CACHE_TTL_SECONDS`).
- **`quota_error_payload(exc)`** — Normalized error dict for 429 responses.

### `Server/server/services/email_service.py`

- **`is_valid_email(email)`** — Regex validation.
- **`send_password_reset_email(email, code)`** — SMTP if `SMTP_*` env vars set; otherwise prints code to console for development.

## Tests and utilities

- **`Server/server/tests/`** — Pytest tests for auth/history, prices filtering, sites/countries CRUD; **`conftest.py`** supplies test app/DB.
- **`Server/check_setup.py`** — Optional environment sanity checks (not part of request path).
