# Client (React + Vite)

## Bootstrapping

- **`Client/src/main.tsx`** — Mounts `<App />` under React 18 `createRoot` with `StrictMode`.
- **`Client/src/App.tsx`** — Top-level layout:
  - On load, calls **`api.auth.me()`** with credentials to restore session; shows loading, then user chip + logout or login/signup buttons.
  - Renders **`PriceSearch`** with the current `user`.
  - **`AuthModal`** for login/signup (and flows triggered from there).
  - Decorative **`BackgroundTiles`** behind the main white page area.

## API layer (`Client/src/services/api.ts`)

### Configuration

- **`API_BASE_URL`** — From `import.meta.env.REACT_APP_API_URL` or defaults to **`/api`** (Vite proxy typically forwards to the Flask server).

### Feature toggles (mock / quota fallback)

Read order: Vite env → URL query (`mock`, `fallback_mock_429`) → `localStorage` (`use_mock`, `fallback_mock_429`).

- **`readToggle`**, **`isTruthy`** — Parse toggle strings.
- **`isMockEnabled()`** — If true, countries/sites/prices/FX use **`mockData`** instead of the network.
- **`isFallbackToMockOn429Enabled()`** — On HTTP 429 from FX or prices, optionally return mock data instead of throwing.

### Types

`Country`, `Site`, `PriceResult`, `PricesResponse`, `FxResponse`, `AuthUser`, `MeResponse`, `HistoryItem` — mirror server JSON shapes.

### `api` object

| Namespace | Method | Behavior |
|-----------|--------|----------|
| **auth** | `me()` | `GET .../me`, credentials included |
| | `signup` / `login` | `POST` with JSON; verbose client-side logging on errors |
| | `logout()` | `POST .../auth/logout` |
| | `history()` | `GET .../me/history` → `items` |
| | `recordHistory(productId)` | `POST .../me/history` with `product_id` |
| | `forgotPassword` / `resetPassword` | Password reset endpoints |
| **countries** | `list()` | Mock or `GET .../countries` |
| **sites** | `list()` | Mock or `GET .../sites` |
| **fx** | `get(base, symbols)` | Mock, or `GET .../fx?base=&symbols=`; optional 429 → mock |
| **prices** | `get(productId, siteKey?, brand?, countryCodeOrCodes?, productUrlHint?)` | Builds POST body (`product_id`, `brand`, `site_key`, optional country filters and URL hint); mock or live; optional 429 → mock |

## Main UI: price comparison (`Client/src/components/PriceSearch.tsx`)

Responsible for the core product experience:

- Loads **sites** and **countries** from the API (or mock).
- Lets the user pick **site**, **countries** (multi-select), and enter a **product / MKT (SKU)**.
- Calls **`api.prices.get`** and **`api.fx.get`** to show prices and convert/display amounts in **USD / EUR / ILS** using returned rates (with env-based **fallback rates** if needed).
- **History** (when logged in): fetches `api.auth.history()`, can re-run a past search; may call **`api.auth.recordHistory`** when using mock paths so the server still stores history.
- Local helpers: parse evidence text for descriptions, normalize currency strings, format money, merge per-site/per-country rows for the results table.

## Auth UI (`Client/src/components/AuthModal.tsx`)

- Modal dialog: **login**, **signup**, and **forgot password** (email step → code + new password step).
- Uses **`api.auth.*`**; on success calls **`onSuccess(user)`** so `App` updates state.
- Escape closes; focus management on open; clears fields when closed/opened.

## Other components

- **`BackgroundTiles.tsx`** — Visual background only.
- **`InspirationBoard.tsx`** — Present in the repo; not wired in `App.tsx` in the reviewed flow (optional/experimental UI).

## Mock data (`Client/src/services/mockData.ts`)

Static countries/sites, fake FX and price payloads for offline or quota-bypass demos when toggles are on.
