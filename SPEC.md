# Smart Shopping — Specification (Draft)

## Purpose
This document is a **first-pass spec (Draft)** for the “Smart Shopping” system as implemented in the current codebase. It captures requirements, API contracts, data model, UI flows, configuration, and open questions to drive the next iterations.

## Summary (What the system does)
A price comparison tool across countries for a product identified by `product_id` (also referred to as MKT/SKU).

- **Frontend (React + Vite)**: a single search screen that lets the user pick a **Site/brand**, pick **one or more countries**, enter a `product_id`, and view results in a table.
- **Backend (Flask + SQLAlchemy + SQLite)**: provides CRUD for `countries` and `sites`, plus a `POST /prices` endpoint that looks up current prices per country using **Gemini + Google Search grounding** and returns a map keyed by country code.

## MVP Scope
- **In scope**
  - Manage `countries` and `sites` via API.
  - Price lookup by `product_id` for selected country/countries.
  - Per-country structured result: `found`, `price`, `currency`, `product_url`, `evidence`, `confidence` (and on failures: `error`, `message`).
  - Gemini quota / rate-limit handling (including `429` for single-country calls).
  - In-memory server-side caching (TTL).
- **Out of scope (for now)**
  - Users/auth/roles.
  - Historical price storage.
  - Admin UI for CRUD operations.
  - Deterministic non-LLM pricing engine / dedicated scraping.

## Personas
- End user who wants to check a product price on the official site across multiple countries.
- Developer/QA who needs stable API contracts validated by tests.

## Glossary
- **Country**: a record with `code` and `name`.
- **Site**: a record with `key`, `name`, optional `base_url`. Used as the “site/brand” selector for lookups.
- **product_id / MKT**: the identifier the user enters and sends to `POST /prices`.
- **Gemini**: the LLM provider used to perform grounded search and return a JSON price payload.

## High-level Architecture
1. The client (Vite) calls the API via the `/api` prefix and proxies to the local backend.
2. The backend (Flask) manages a SQLite DB, exposes endpoints, and calls a lookup service (`price_service`) that:
   - Builds a prompt
   - Calls Gemini with Google Search tool grounding
   - Parses/normalizes JSON into a structured result
   - Caches results in memory with TTL
   - Best-effort handles quota/rate-limit errors

## System Components
### Backend
- `Server/server/app.py`
  - Loads `.env` from repo root (if present).
  - Creates the Flask app, initializes DB, runs `create_all`, registers the API blueprint.
  - Local dev server at `http://localhost:8000`.
- `Server/server/routes.py`
  - Blueprint `api` with endpoints: `GET /health`, CRUD for `/countries`, CRUD for `/sites`, and `POST /prices`.
- `Server/server/models.py`
  - Models: `Country`, `Site` + `to_dict()`.
- `Server/server/services/price_service.py`
  - Gemini-based price lookup per country (with caching, retries, quota classification).
- Database
  - Default: `sqlite:///app.db` (file-based).
  - Tests: `sqlite:///:memory:`.

### Frontend
- `Client/src/services/api.ts`
  - API wrapper (`countries.list`, `sites.list`, `prices.get`) using base `'/api'`.
  - Special-case handling for `429` to show user-friendly messaging.
- `Client/src/components/PriceSearch.tsx`
  - UI: site dropdown, multi-country selector (+ select-all), MKT input, API call and table rendering.
- `Client/vite.config.js`
  - Proxy: `'/api' -> http://localhost:8000` with rewrite removing `/api`.

## Data Model
### Country
- **Fields**
  - `id` (PK, int)
  - `code` (string up to 8, unique, required)
  - `name` (string up to 120, required)
- **Normalization**
  - `code` is stored uppercase.

### Site
- **Fields**
  - `id` (PK, int)
  - `key` (string up to 40, unique, required)
  - `name` (string up to 120, required)
  - `base_url` (string up to 500, nullable)
- **Normalization**
  - `key` is stored lowercase.

## API Contracts (Backend)
Local base URL: `http://localhost:8000`  
Via Vite dev proxy: `http://localhost:3000/api/*`

### Health
#### `GET /health`
- **200**
  - Body: `{"status":"ok"}`

### Countries
#### `GET /countries`
- **200**: array of countries ordered by `code` ascending
  - `[{ "code": "GR", "name": "Greece" }, ...]`

#### `GET /countries/<code>`
- **200**: one country
- **404**: `{"error":"country '<CODE>' not found"}`

#### `POST /countries`
- **Request JSON**
  - `code` (string, required, non-empty)
  - `name` (string, required, non-empty)
- **201**: `{ "code": "FR", "name": "France" }`
- **400**: validation errors (missing/empty `code`/`name`)
- **409**: duplicate `code` (effectively case-insensitive)

#### `PUT /countries/<code>`
- **Request JSON**
  - `name` (string, required, non-empty)
- **200**: updated country
- **400**: validation errors
- **404**: not found

#### `DELETE /countries/<code>`
- **200**: `{"deleted": true, "code": "<CODE>"}`
- **404**: not found

### Sites
#### `GET /sites`
- **200**: array of sites ordered by `key` ascending

#### `GET /sites/<key>`
- **200**: one site
- **404**: `{"error":"site '<key>' not found"}`

#### `POST /sites`
- **Request JSON**
  - `key` (string, required, non-empty)
  - `name` (string, required, non-empty)
  - `base_url` (string | null, optional; if string it must be non-empty)
- **201**: `{"key":"zara","name":"Zara","base_url":"https://www.zara.com"}`
- **400**: validation errors
- **409**: duplicate `key`

#### `PUT /sites/<key>`
- **Request JSON**
  - Provide at least one of: `name`, `base_url`
- **200**: updated site
- **400**: validation errors / no update fields
- **404**: not found

#### `DELETE /sites/<key>`
- **200**: `{"deleted": true, "key": "<key>"}`
- **404**: not found

### Prices
#### `POST /prices`
Returns prices per country for a given `product_id`.

- **Request JSON**
  - `product_id` (string, required, non-empty)
  - `brand` (string, optional; default `"ZARA"`)
  - `site_key` (string | null, optional)
  - Choose at most one:
    - `country_code` (string | null, optional)
    - `country_codes` (string[] | null, optional)

- **Key behaviors**
  - If `site_key` is provided: backend loads the Site from DB, sets `brand = site.name`, and passes `site_base_url = site.base_url` to the lookup layer.
  - If `country_code` is provided: lookup runs for a single country.
  - If `country_codes` is provided: lookup runs for that list (after normalization/de-duplication).
  - If neither is provided: backend uses all countries from DB.
  - Special normalization: `UK -> GB` (ISO-style; works better with Zara). Some compatibility exists if DB stores `UK`.

- **200 (Success)**
  - Body:
    - `product_id`: string
    - `brand`: string
    - `countries_count`: number
    - `prices`: `Record<string, PriceResult>`

- **429 (Quota / Rate Limit)**
  - Returned **only when the request targets a single country** (UX optimization).
  - Body:
    - `error`: string
    - `error_code`: `"daily_quota" | "rate_limited" | "quota_exceeded"`
    - `retry_after`: number | null

- **404**
  - `site_key` not found: `{"error":"site '<key>' not found"}`
  - Country not found: `{"error":"country '<CODE>' not found"}`

- **400**
  - Validation for `product_id`, `site_key`, `country_code`, `country_codes`, `brand`
  - Conflict: `{"error":"provide only one of: country_code, country_codes"}`
  - No countries in DB: `{"error":"no countries in database"}`

#### PriceResult (values inside `prices`)
For each country code:
- `country_code`: string
- `found`: boolean
- `price`: number | null
- `currency`: string | null
- `product_url`: string | null
- `evidence`: string | null
- `confidence`: number (0..1)
- Optional on errors:
  - `error`: string
  - `error_code`: string
  - `message`: string
  - `retry_after`: number | null

## UX / User Flows (Frontend)
### Price Search Screen
1. Initial load:
   - `GET /sites`, auto-select first site.
   - `GET /countries`, auto-select first country.
2. User selects:
   - Site (dropdown)
   - Countries (multi-select + select-all)
   - `MKT` (i.e., `product_id`)
3. Submit:
   - Calls `POST /prices` with `product_id`, `site_key`, `brand='ZARA'` (client default), and `country_codes` based on selection.
4. Results:
   - Table: Site / Country / MKT / Item Description / Price / Website Link
   - Description is extracted from `evidence` (best-effort); failures append `message`/`error`.
5. Errors:
   - Error banner; for `429` the client shows a more specific message (rate-limit vs daily quota).

## Configuration / Environment
### `.env` at repo root
Example file: `env.example` (copy to `.env`)

- `GEMINI_API_KEY` (preferred) or `GOOGLE_API_KEY`
- `GEMINI_MODEL` (default: `gemini-2.5-flash`)
- `PRICE_CACHE_TTL_SECONDS` (default: `900`)
- `DEBUG_DOTENV` (default: `0`)

## Local Development Workflow
### Backend
- Path: `Server/server`
- Run: `python app.py` (binds `0.0.0.0:8000`)
- Seed: `python seed.py` (adds sample countries + `zara` site)

### Frontend
- Path: `Client`
- `npm run dev` (binds `localhost:3000`)
- API proxy: all `/api/*` requests proxy to `localhost:8000/*`.

## Tests
Server tests validate:
- Countries/Sites CRUD (validation, 404, 409).
- `POST /prices`:
  - Single-country selection (`country_code`) vs list (`country_codes`).
  - Conflict between `country_code` and `country_codes`.
  - 404 for unknown country/site.
  - `429` when quota/rate limit occurs on single-country calls.
  - `site_key` forces `brand` and `site_base_url` passed to the lookup layer.

## Non-Functional Requirements (NFR)
- **Reliability**: if lookup fails (Gemini/parsing), the API returns a structured `found=false` result with error details.
- **Performance**: in-memory TTL cache reduces latency and cost.
- **Cost/Quota**: multi-country lookups can produce many calls; product favors single-country requests to avoid quota blowups.
- **Security**: API keys are not committed; loaded via `.env`.

## Open Questions
1. **What is the precise definition of `product_id`** across brands? Is it always Zara MKT? Are multiple formats expected?
2. **How should we support additional Sites** beyond Zara (e.g., H&M/ASOS)?
   - Is `base_url` always the official domain? Do we need an allowlist of domains per site?
3. **Quota policy**
   - Should the UI default to **single-country only** to reduce quota risk, or keep multi-select enabled by default (with batching/rate limiting)?
4. **Data quality**
   - Do we need currency normalization/conversion (e.g., normalize to ILS)?
5. **Persistence**
   - Should we store lookup results (history) in DB with timestamps?

## Proposed Backlog (Next Steps)
- Add API documentation (OpenAPI/Swagger).
- Add admin UI for managing Countries/Sites.
- Add server-side rate limiting to protect API keys and stabilize UX.
- Persist results in DB + add history view.
- Add observability (structured logging + correlation IDs).


