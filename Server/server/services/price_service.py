# Server/server/services/price_service.py
from __future__ import annotations

import json
import os
import re
from typing import Optional, Dict, List, Any

from google import genai
from google.genai import types


def _get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("Missing GEMINI_API_KEY (or GOOGLE_API_KEY). Check your .env loading.")
    return genai.Client(api_key=api_key)


def _model_name() -> str:
    return os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


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


def _lookup_price_for_country(product_id: str, country_code: str, brand: str = "ZARA") -> Dict[str, Any]:
    """
    Uses Gemini + Google Search grounding to find a current price.
    IMPORTANT: tools + response_mime_type="application/json" is unsupported,
    so we request JSON as plain text and parse it ourselves.
    """
    client = _get_client()

    tool = types.Tool(google_search=types.GoogleSearch())

    config = types.GenerateContentConfig(
        tools=[tool],
        temperature=0.2,
    )

    prompt = f"""
You are a price lookup assistant.

Task:
Find the CURRENT retail price for the product with SKU/MKT/product_id "{product_id}" from {brand},
for shoppers in country "{country_code}".

Rules:
- Use Google Search grounding to find an official {brand} product page (preferred) or a very reliable source for that country.
- Prefer official {brand} domains for that country/region if possible.
- If you find a price, extract numeric price and currency, and include a direct product page URL.
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

    resp = client.models.generate_content(
        model=_model_name(),
        contents=prompt,
        config=config,
    )

    # google-genai typically returns text in resp.text
    raw_text = getattr(resp, "text", None) or ""
    data = _extract_json_object(raw_text)

    if not isinstance(data, dict):
        # If parsing fails, return a structured error-like result
        return {
            "country_code": country_code,
            "found": False,
            "price": None,
            "currency": None,
            "product_url": None,
            "evidence": "Failed to parse JSON from model output",
            "confidence": 0.0,
            "raw": raw_text[:500],
        }

    # Normalize / guard
    data["country_code"] = country_code
    data.setdefault("found", False)
    data.setdefault("price", None)
    data.setdefault("currency", None)
    data.setdefault("product_url", None)
    data.setdefault("evidence", None)
    data.setdefault("confidence", 0.0)

    return data


def get_prices_for_countries(product_id: str, country_codes: List[str], brand: str = "ZARA") -> Dict[str, object]:
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
            r = _lookup_price_for_country(product_id, code, brand=brand)
            results[code] = r
        except Exception as e:
            results[code] = {
                "country_code": code,
                "found": False,
                "error": type(e).__name__,
                "message": str(e),
            }

    return results
