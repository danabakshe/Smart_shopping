# Server/server/services/price_service.py
from __future__ import annotations

import json
import os
import re
import time
import random
from urllib.parse import urlparse
from typing import Optional, Dict, List, Any

from google import genai
from google.genai import types


_PRICE_CACHE: Dict[str, Dict[str, object]] = {}

# Bump this when changing prompt logic to avoid serving stale cached "not found" results.
_PRICE_PROMPT_VERSION = "4"


def _sku_variants(product_id: str) -> List[str]:
    """
    Zara SKUs are commonly written with slashes, but search/snippets may use spaces or hyphens.
    Provide a few safe variants to improve recall in search-grounded lookups.
    """
    pid = (product_id or "").strip()
    if not pid:
        return []

    variants: List[str] = []
    seen: set[str] = set()

    def _add(v: str) -> None:
        vv = (v or "").strip()
        if not vv or vv in seen:
            return
        seen.add(vv)
        variants.append(vv)

    _add(pid)
    _add(pid.replace("/", " "))
    _add(pid.replace("/", "-"))
    _add(re.sub(r"\s+", " ", pid.replace("/", " ")).strip())
    return variants


def _site_query_hints(hint_base_url: str | None, product_id: str) -> str:
    """
    Build a 'start query' suggestion that uses the site: operator correctly (domain only),
    plus an inurl filter for an optional country-path prefix (e.g. /hu/).
    """
    if not isinstance(hint_base_url, str) or not hint_base_url.strip():
        return ""
    try:
        u = urlparse(hint_base_url.strip())
    except Exception:
        return ""

    domain = (u.netloc or "").strip()
    path = (u.path or "").strip("/")
    first_seg = path.split("/")[0].strip() if path else ""

    if not domain:
        return ""

    inurl = f" inurl:/{first_seg}/" if first_seg else ""
    # Include SKU variants to avoid missing results where slashes are stripped.
    sv = _sku_variants(product_id)
    sku_part = " OR ".join([f'"{v}"' for v in sv[:3]]) if sv else f'"{product_id}"'
    return f"site:{domain}{inurl} {sku_part}"


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY (or GOOGLE_API_KEY). Check your .env loading.")
    return genai.Client(api_key=api_key)


def _model_name() -> str:
    return os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def _cache_ttl_seconds() -> int:
    try:
        v = int(os.getenv("PRICE_CACHE_TTL_SECONDS", "900"))
        return max(0, v)
    except Exception:
        return 900


def _cache_key(
    product_id: str,
    country_code: str,
    brand: str,
    site_base_url: str | None,
    product_url_hint: str | None,
) -> str:
    base = (site_base_url or "").strip().lower()
    url = (product_url_hint or "").strip()
    return f"{_model_name()}|v={_PRICE_PROMPT_VERSION}|{brand.strip()}|{product_id.strip()}|{country_code.strip().upper()}|{base}|url={url}"


def _hint_country_site_base_url(brand: str, site_base_url: str | None, country_code: str) -> str | None:
    """
    Soft hint only (non-blocking): try to point the LLM at the *country-specific* official path.
    Important: we DO NOT reject results if the URL doesn't match — otherwise users may get no price/link.
    """
    if not isinstance(site_base_url, str) or not site_base_url.strip():
        return None

    base = site_base_url.strip().rstrip("/")
    cc = (country_code or "").strip().upper()
    if not cc:
        return base

    base_l = base.lower()
    if "zara.com" in base_l:
        # Zara commonly uses: https://www.zara.com/<cc-lower>/
        zara_cc = {
            "GB": "uk",
            "UK": "uk",
            "US": "us",
        }.get(cc, cc.lower())
        return f"https://www.zara.com/{zara_cc}/"

    return base


def _cache_get(key: str) -> Optional[dict]:
    ttl = _cache_ttl_seconds()
    if ttl <= 0:
        return None
    item = _PRICE_CACHE.get(key)
    if not isinstance(item, dict):
        return None
    expires_at = item.get("expires_at")
    if not isinstance(expires_at, (int, float)) or time.time() >= float(expires_at):
        _PRICE_CACHE.pop(key, None)
        return None
    value = item.get("value")
    return value if isinstance(value, dict) else None


def _cache_set(key: str, value: dict) -> None:
    ttl = _cache_ttl_seconds()
    if ttl <= 0:
        return
    _PRICE_CACHE[key] = {"expires_at": time.time() + ttl, "value": value}


def _looks_like_quota_error(exc: Exception) -> bool:
    msg = str(exc) or ""
    msg_u = msg.upper()
    return ("RESOURCE_EXHAUSTED" in msg_u) or ("QUOTA" in msg_u and "EXCEEDED" in msg_u) or ("429" in msg_u)


def _quota_kind(exc: Exception) -> str:
    """
    Best-effort classification of quota errors so the client can show a helpful message.
    Returns: "daily" | "rate" | "unknown"
    """
    msg = str(exc) or ""
    msg_u = msg.upper()

    # Seen in Gemini errors:
    # - "GenerateRequestsPerDayPerProjectPerModel-FreeTier"
    # - "...requests per day..."
    if ("PERDAY" in msg_u) or ("REQUESTS PER DAY" in msg_u) or ("PER-DAY" in msg_u):
        return "daily"

    # Seen in errors:
    # - "Please retry in Xs"
    # - "retryDelay': '1s'"
    if re.search(r"retry in\s+[0-9.]+s", msg, flags=re.IGNORECASE) or re.search(
        r"retryDelay[^0-9]*[0-9.]+s", msg, flags=re.IGNORECASE
    ):
        return "rate"

    return "unknown"


def _extract_retry_after_seconds(exc: Exception) -> Optional[float]:
    msg = str(exc) or ""
    # Example: "Please retry in 1.320173555s."
    m = re.search(r"retry in\s+([0-9.]+)s", msg, flags=re.IGNORECASE)
    if m:
        try:
            return float(m.group(1))
        except Exception:
            return None
    # Example in details: "retryDelay': '1s'"
    m2 = re.search(r"retryDelay[^0-9]*([0-9.]+)s", msg, flags=re.IGNORECASE)
    if m2:
        try:
            return float(m2.group(1))
        except Exception:
            return None
    return None


def _extract_json_object(text: str) -> Optional[dict]:
    """
    Extract the first JSON object from a text response and parse it.
    We expect the model to return ONLY JSON, but this makes it robust.
    """
    if not isinstance(text, str) or not text.strip():
        return None

    # Try direct parse first
    try:
        return json.loads(text)
    except Exception:
        pass

    # Fallback: find first {...} block
    m = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def _lookup_product_url_for_country(
    product_id: str,
    country_code: str,
    brand: str = "ZARA",
    site_base_url: str | None = None,
    product_url_hint: str | None = None,
) -> Dict[str, Any]:
    """
    Best-effort lookup for an official product page URL, even if price is unavailable.
    Returns:
      { "product_url": str|None, "evidence": str|None, "confidence": 0..1 }
    """
    hint_base_url = _hint_country_site_base_url(brand, site_base_url, country_code)
    ck = _cache_key(product_id, country_code, f"{brand.strip()}|url_only", hint_base_url, product_url_hint)
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    client = _get_client()
    tool = types.Tool(google_search=types.GoogleSearch())
    config = types.GenerateContentConfig(tools=[tool], temperature=0.2)

    hb = ""
    if isinstance(hint_base_url, str) and hint_base_url.strip():
        hb = hint_base_url.strip().rstrip("/") + "/"

    prefer_line = f'- Prefer URLs under: "{hb}"\n' if hb else ""
    start_query = _site_query_hints(hb, product_id)
    start_query_line = f'- Start with search query: {start_query}\n' if start_query else ""

    url_hint = ""
    if isinstance(product_url_hint, str) and product_url_hint.strip():
        url_hint = f'- The user provided this URL; prefer it if it looks official: "{product_url_hint.strip()}"\n'

    sku_lines = "\n".join([f'- SKU variant: "{v}"' for v in _sku_variants(product_id)[:4]])
    sku_block = f"{sku_lines}\n" if sku_lines else ""

    prompt = f"""
You are a product page lookup assistant.

Task:
Find the official {brand} product page URL for product_id "{product_id}" for shoppers in country "{country_code}".

Rules:
- Use Google Search grounding.
- Prefer official domains for that country/region.
{prefer_line}{start_query_line}{sku_block}{url_hint}
- Return ONLY a JSON object with exactly these keys:
{{
  "product_url": string or null,
  "evidence": string or null,
  "confidence": number between 0 and 1
}}
"""

    resp = client.models.generate_content(model=_model_name(), contents=prompt, config=config)
    raw_text = getattr(resp, "text", None) or ""
    data = _extract_json_object(raw_text)

    if not isinstance(data, dict):
        out = {"product_url": None, "evidence": "Failed to find official product page URL", "confidence": 0.0}
        _cache_set(ck, out)
        return out

    out = {
        "product_url": data.get("product_url") if isinstance(data.get("product_url"), str) else None,
        "evidence": data.get("evidence") if isinstance(data.get("evidence"), str) else None,
        "confidence": float(data.get("confidence")) if isinstance(data.get("confidence"), (int, float)) else 0.0,
    }
    _cache_set(ck, out)
    return out


def _lookup_price_for_country(
    product_id: str,
    country_code: str,
    brand: str = "ZARA",
    site_base_url: str | None = None,
    product_url_hint: str | None = None,
    *,
    allow_url_hint_retry: bool = True,
    _did_url_hint_retry: bool = False,
) -> Dict[str, Any]:
    """
    Uses Gemini + Google Search grounding to find a current price.
    IMPORTANT: tools + response_mime_type="application/json" is unsupported,
    so we request JSON as plain text and parse it ourselves.
    """
    hint_base_url = _hint_country_site_base_url(brand, site_base_url, country_code)
    ck = _cache_key(product_id, country_code, brand, hint_base_url, product_url_hint)
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    client = _get_client()

    tool = types.Tool(google_search=types.GoogleSearch())

    config = types.GenerateContentConfig(
        tools=[tool],
        temperature=0.2,
    )

    site_hint = ""
    if isinstance(hint_base_url, str) and hint_base_url.strip():
        hb = hint_base_url.strip().rstrip("/") + "/"
        # Strong hint but still non-blocking.
        start_query = _site_query_hints(hb, product_id)
        site_hint = (
            f'- Strongly prefer the OFFICIAL {brand} site for this country: "{hb}".\n'
            + (f"- Start with search query: {start_query}\n" if start_query else "")
        )

    sku_lines = "\n".join([f'- SKU variant: "{v}"' for v in _sku_variants(product_id)[:4]])
    sku_block = f"{sku_lines}\n" if sku_lines else ""

    url_hint = ""
    if isinstance(product_url_hint, str) and product_url_hint.strip():
        u = product_url_hint.strip()
        url_hint = (
            f'\nImportant:\n'
            f'- The user provided an official product URL for this country: "{u}"\n'
            f'- Use Google Search grounding to locate THIS exact page and extract the current price from it.\n'
            f'- If multiple variants exist, prefer the price shown on this URL.\n'
        )

    prompt = f"""
You are a price lookup assistant.

Task:
Find the CURRENT retail price for the product with SKU/MKT/product_id "{product_id}" from {brand},
for shoppers in country "{country_code}".

Rules:
- Use Google Search grounding to find an official {brand} product page (preferred) or a very reliable source for that country.
- Prefer official {brand} domains for that country/region if possible.
{sku_block}
{site_hint}- If you find a price, extract numeric price and currency, and include a direct product page URL.
- If you cannot find a reliable current price, set found=false and leave price/currency/product_url as null.
- Keep evidence very short (1 sentence max).
{url_hint}

Return ONLY a JSON object (no markdown, no extra text) with exactly these keys:
{{
  "country_code": "{country_code}",
  "found": true/false,
  "price": number or null,
  "currency": string or null,
  "product_url": string or null,
  "evidence": string or null,
  "confidence": number between 0 and 1
}}
"""

    # Basic retry for transient quota/rate-limit errors. Keep it conservative.
    resp = None
    last_exc: Exception | None = None
    for i in range(3):
        try:
            resp = client.models.generate_content(
                model=_model_name(),
                contents=prompt,
                config=config,
            )
            last_exc = None
            break
        except Exception as e:
            last_exc = e
            if not _looks_like_quota_error(e) or i >= 2:
                raise
            retry_after = _extract_retry_after_seconds(e)
            sleep_s = min(
                3.0,
                (retry_after if isinstance(retry_after, (int, float)) else (0.8 * (2 ** i))) + (random.random() * 0.2),
            )
            time.sleep(max(0.2, sleep_s))

    if resp is None:
        raise RuntimeError(str(last_exc) if last_exc else "Unknown error generating content")

    # google-genai typically returns text in resp.text
    raw_text = getattr(resp, "text", None) or ""
    data = _extract_json_object(raw_text)

    if not isinstance(data, dict):
        # If parsing fails, return a structured error-like result
        parsed_fail = {
            "country_code": country_code,
            "found": False,
            "price": None,
            "currency": None,
            "product_url": None,
            "evidence": "Failed to parse JSON from model output",
            "confidence": 0.0,
            "raw": raw_text[:500],
        }
        _cache_set(ck, parsed_fail)
        return parsed_fail

    # Normalize / guard
    data["country_code"] = country_code
    data.setdefault("found", False)
    data.setdefault("price", None)
    data.setdefault("currency", None)
    data.setdefault("product_url", None)
    data.setdefault("evidence", None)
    data.setdefault("confidence", 0.0)

    # If we did not find a price but we DO have a product URL (or can find one),
    # do a single retry where we explicitly anchor the model to that exact URL.
    #
    # Why: some sites (notably Zara) render prices dynamically or are hard to locate by SKU alone.
    # The model may still succeed when it is pointed at the canonical product page URL.
    if (
        allow_url_hint_retry
        and (not _did_url_hint_retry)
        and (not product_url_hint)
        and (not data.get("found"))
    ):
        try:
            candidate_url: str | None = None
            u0 = data.get("product_url")
            if isinstance(u0, str) and u0.strip():
                candidate_url = u0.strip()
            else:
                url_only = _lookup_product_url_for_country(
                    product_id,
                    country_code,
                    brand=brand,
                    site_base_url=site_base_url,
                    product_url_hint=None,
                )
                u1 = url_only.get("product_url") if isinstance(url_only, dict) else None
                if isinstance(u1, str) and u1.strip():
                    candidate_url = u1.strip()

            if candidate_url:
                retry = _lookup_price_for_country(
                    product_id,
                    country_code,
                    brand=brand,
                    site_base_url=site_base_url,
                    product_url_hint=candidate_url,
                    allow_url_hint_retry=False,
                    _did_url_hint_retry=True,
                )
                if isinstance(retry, dict):
                    # Cache the retried result under the original key too, so subsequent calls
                    # without an explicit URL hint don't repeat the extra work.
                    _cache_set(ck, retry)
                    return retry
        except Exception:
            # Non-fatal: we'll fall back to the current best-effort result below.
            pass

    # If the model didn't provide evidence and it didn't find a price, provide a helpful default reason.
    if not data.get("found") and not (isinstance(data.get("evidence"), str) and data.get("evidence").strip()):
        data["evidence"] = "No reliable current price found for this country."

    # Even when price isn't found, try to at least return an official product page URL for better UX.
    if (not data.get("found")) and not (isinstance(data.get("product_url"), str) and data.get("product_url").strip()):
        try:
            url_only = _lookup_product_url_for_country(
                product_id,
                country_code,
                brand=brand,
                site_base_url=site_base_url,
                product_url_hint=product_url_hint,
            )
            u = url_only.get("product_url") if isinstance(url_only, dict) else None
            if isinstance(u, str) and u.strip():
                data["product_url"] = u.strip()
                # Only fill evidence if we don't already have one.
                if not (isinstance(data.get("evidence"), str) and data.get("evidence").strip()):
                    ev = url_only.get("evidence")
                    if isinstance(ev, str) and ev.strip():
                        data["evidence"] = ev.strip()
        except Exception:
            # Non-fatal.
            pass

    _cache_set(ck, data)
    return data


def get_prices_for_countries(
    product_id: str,
    country_codes: List[str],
    brand: str = "ZARA",
    site_base_url: str | None = None,
    product_url_hint: str | None = None,
) -> Dict[str, object]:
    """
    Returns a dict keyed by country code.
    Each value includes: found, price, currency, product_url, evidence, confidence
    or an error object if something failed.
    """
    product_id = (product_id or "").strip()
    if not product_id:
        raise ValueError("product_id must be a non-empty string")

    results: Dict[str, object] = {}
    # Retrying with a URL hint can double model calls; only do it for single-country lookups.
    allow_url_hint_retry = len(country_codes) == 1

    for raw in country_codes:
        code = (raw or "").strip().upper()
        if not code:
            continue

        try:
            r = _lookup_price_for_country(
                product_id,
                code,
                brand=brand,
                site_base_url=site_base_url,
                product_url_hint=product_url_hint,
                allow_url_hint_retry=allow_url_hint_retry,
            )
            results[code] = r
        except Exception as e:
            if _looks_like_quota_error(e):
                results[code] = {
                    "country_code": code,
                    "found": False,
                    "error": "RESOURCE_EXHAUSTED",
                    "error_code": "daily_quota"
                    if _quota_kind(e) == "daily"
                    else "rate_limited"
                    if _quota_kind(e) == "rate"
                    else "quota_exceeded",
                    "message": str(e),
                    "retry_after": _extract_retry_after_seconds(e),
                }
                continue
            results[code] = {
                "country_code": code,
                "found": False,
                "error": type(e).__name__,
                "message": str(e),
            }

    return results
