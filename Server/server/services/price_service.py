from __future__ import annotations


def get_prices_for_countries(
    product_id: str,
    countries: list[str]
) -> dict[str, float]:
    """
    Temporary mock implementation.

    This function simulates price retrieval per country.
    It will later be replaced with LLM or external API calls.
    """

    base_price = 100 + (sum(ord(ch) for ch in product_id) % 150)

    country_factor = {
        "IL": 1.00,
        "GR": 0.95,
        "HU": 0.90,
        "US": 1.10,
        "UK": 1.05,
    }

    prices: dict[str, float] = {}
    for country in countries:
        factor = country_factor.get(country, 1.00)
        prices[country] = round(base_price * factor, 2)

    return prices
