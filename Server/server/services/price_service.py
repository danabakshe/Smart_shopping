# Server/server/services/price_service.py
from __future__ import annotations

import json
import os
import re
import time
import random
from typing import Optional, Dict, List, Any

from google import genai
from google.genai import types


_PRICE_CACHE: Dict[str, Dict[str, object]] = {}


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


def _cache_key(product_id: str, country_code: str, brand: str, site_base_url: str | None) -> str:
    base = (site_base_url or "").strip().lower()
    return f"{_model_name()}|{brand.strip()}|{product_id.strip()}|{country_code.strip().upper()}|{base}"


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


def _lookup_price_for_country(
    product_id: str,
    country_code: str,
    brand: str = "ZARA",
    site_base_url: str | None = None,
) -> Dict[str, Any]:
    """
    Uses Gemini + Google Search grounding to find a current price.
    IMPORTANT: tools + response_mime_type="application/json" is unsupported,
    so we request JSON as plain text and parse it ourselves.
    """
    ck = _cache_key(product_id, country_code, brand, site_base_url)
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
    if isinstance(site_base_url, str) and site_base_url.strip():
        site_hint = f'- Prefer sources from the official site domain: "{site_base_url.strip()}" when possible.\n'

    prompt = f"""
You are a price lookup assistant.

Task:
Find the CURRENT retail price for the product with SKU/MKT/product_id "{product_id}" from {brand},
for shoppers in country "{country_code}".

Rules:
- Use Google Search grounding to find an official {brand} product page (preferred) or a very reliable source for that country.
- Prefer official {brand} domains for that country/region if possible.
{site_hint}- If you find a price, extract numeric price and currency, and include a direct product page URL.
- If you cannot find a reliable current price, set found=false and leave price/currency/product_url as null.
- Keep evidence very short (1 sentence max).

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

    _cache_set(ck, data)
    return data


def get_prices_for_countries(
    product_id: str,
    country_codes: List[str],
    brand: str = "ZARA",
    site_base_url: str | None = None,
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

    for raw in country_codes:
        code = (raw or "").strip().upper()
        if not code:
            continue

        try:
            r = _lookup_price_for_country(product_id, code, brand=brand, site_base_url=site_base_url)
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
