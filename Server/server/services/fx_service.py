from __future__ import annotations

import json
import random
import re
import time
from typing import Any, Dict, List, Optional

# Reuse the same Gemini client + helpers used by the price lookup service.
from server.services.price_service import (
    GenAIUnavailableError,
    _require_genai,
    _extract_retry_after_seconds,
    _get_client,
    _looks_like_quota_error,
    _model_name,
    _quota_kind,
    types,
)


_FX_CACHE: Dict[str, Dict[str, object]] = {}


def _fx_cache_ttl_seconds() -> int:
    # Keep short-ish to feel "fresh", but avoid burning quota.
    # Override with FX_CACHE_TTL_SECONDS if needed.
    # Default: 30 minutes.
    import os

    try:
        v = int(os.getenv("FX_CACHE_TTL_SECONDS", "1800"))
        return max(0, v)
    except Exception:
        return 1800


def _fx_cache_key(base: str, symbols: List[str]) -> str:
    syms = ",".join(sorted({s.strip().upper() for s in symbols if isinstance(s, str)}))
    return f"{_model_name()}|{base.strip().upper()}|{syms}"


def _cache_get(key: str) -> Optional[dict]:
    ttl = _fx_cache_ttl_seconds()
    if ttl <= 0:
        return None
    item = _FX_CACHE.get(key)
    if not isinstance(item, dict):
        return None
    expires_at = item.get("expires_at")
    if not isinstance(expires_at, (int, float)) or time.time() >= float(expires_at):
        _FX_CACHE.pop(key, None)
        return None
    value = item.get("value")
    return value if isinstance(value, dict) else None


def _cache_set(key: str, value: dict) -> None:
    ttl = _fx_cache_ttl_seconds()
    if ttl <= 0:
        return
    _FX_CACHE[key] = {"expires_at": time.time() + ttl, "value": value}


def _extract_json_object(text: str) -> Optional[dict]:
    if not isinstance(text, str) or not text.strip():
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def get_fx_rates(base: str = "USD", symbols: List[str] | None = None) -> Dict[str, Any]:
    """
    Returns FX rates using Gemini + Google Search grounding.

    Output schema:
      {
        "base": "USD",
        "as_of_utc": "2025-12-25T12:34:56Z",
        "rates": { "USD": 1.0, "EUR": 0.91, "ILS": 3.65 }
      }

    Rates are: 1 BASE = X SYMBOL
    """
    _require_genai()
    base = (base or "").strip().upper()
    if base not in {"USD", "EUR", "ILS"}:
        raise ValueError("base must be one of: USD, EUR, ILS")

    symbols = symbols or ["USD", "EUR", "ILS"]
    norm_symbols: List[str] = []
    for s in symbols:
        if isinstance(s, str) and s.strip():
            u = s.strip().upper()
            if u in {"USD", "EUR", "ILS"}:
                norm_symbols.append(u)
    if not norm_symbols:
        norm_symbols = ["USD", "EUR", "ILS"]

    ck = _fx_cache_key(base, norm_symbols)
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    client = _get_client()
    tool = types.Tool(google_search=types.GoogleSearch())
    config = types.GenerateContentConfig(
        tools=[tool],
        temperature=0.1,
    )

    prompt = f"""
You are an FX rates assistant.

Task:
Using Google Search grounding, find the most recent mid-market exchange rates for:
Base currency: {base}
Target currencies: USD, EUR, ILS

Return ONLY a JSON object (no markdown, no extra text) with EXACTLY this shape:
{{
  "base": "{base}",
  "as_of_utc": "YYYY-MM-DDTHH:MM:SSZ",
  "rates": {{
    "USD": number,
    "EUR": number,
    "ILS": number
  }}
}}

Rules:
- rates are: 1 {base} = X currency
- base rate must be exactly 1.0
- Use numeric values (not strings). Prefer up to 6 decimal places.
"""

    resp = None
    last_exc: Exception | None = None
    for i in range(3):
        try:
            resp = client.models.generate_content(model=_model_name(), contents=prompt, config=config)
            last_exc = None
            break
        except Exception as e:
            last_exc = e
            if not _looks_like_quota_error(e) or i >= 2:
                raise
            retry_after = _extract_retry_after_seconds(e)
            sleep_s = min(
                3.0,
                (retry_after if isinstance(retry_after, (int, float)) else (0.8 * (2**i))) + (random.random() * 0.2),
            )
            time.sleep(max(0.2, sleep_s))

    if resp is None:
        raise RuntimeError(str(last_exc) if last_exc else "Unknown error generating content")

    raw_text = getattr(resp, "text", None) or ""
    data = _extract_json_object(raw_text)
    if not isinstance(data, dict):
        raise RuntimeError("Failed to parse FX JSON from model output")

    rates = data.get("rates")
    if not isinstance(rates, dict):
        raise RuntimeError("Invalid FX payload: missing rates")

    out_rates: Dict[str, float] = {}
    for cur in ("USD", "EUR", "ILS"):
        v = rates.get(cur)
        try:
            out_rates[cur] = float(v)
        except Exception:
            out_rates[cur] = 0.0

    out_rates[base] = 1.0

    payload = {
        "base": base,
        "as_of_utc": data.get("as_of_utc"),
        "rates": out_rates,
    }
    _cache_set(ck, payload)
    return payload


def quota_error_payload(exc: Exception) -> Dict[str, object]:
    return {
        "error": str(exc) or "Quota exceeded",
        "error_code": "daily_quota"
        if _quota_kind(exc) == "daily"
        else "rate_limited"
        if _quota_kind(exc) == "rate"
        else "quota_exceeded",
        "retry_after": _extract_retry_after_seconds(exc),
    }


