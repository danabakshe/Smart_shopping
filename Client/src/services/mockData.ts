import type { Country, FxResponse, PricesResponse, Site } from './api'

export const MOCK_COUNTRIES: Country[] = [
  { code: 'IL', name: 'Israel' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
]

export const MOCK_SITES: Site[] = [
  { key: 'zara', name: 'ZARA', base_url: 'https://www.zara.com' },
  { key: 'hm', name: 'H&M', base_url: 'https://www2.hm.com' },
  { key: 'asos', name: 'ASOS', base_url: 'https://www.asos.com' },
]

export function getMockFx(base: string = 'USD'): FxResponse {
  const b = (base || 'USD').trim().toUpperCase()
  // Demo rates: "units per 1 base"
  if (b === 'USD') return { base: 'USD', as_of_utc: null, rates: { USD: 1, EUR: 0.92, ILS: 3.7 } }
  if (b === 'EUR') return { base: 'EUR', as_of_utc: null, rates: { EUR: 1, USD: 1.09, ILS: 4.02 } }
  if (b === 'ILS') return { base: 'ILS', as_of_utc: null, rates: { ILS: 1, USD: 0.27, EUR: 0.25 } }
  return { base: b, as_of_utc: null, rates: { [b]: 1 } }
}

function pickAllOrFilter<T extends { country_code: string }>(all: Record<string, T>, wanted: string[] | undefined): Record<string, T> {
  if (!wanted || wanted.length === 0) return all
  const wantedSet = new Set(wanted.map((c) => c.trim()).filter(Boolean))
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(all)) {
    if (wantedSet.has(k)) out[k] = v
  }
  return out
}

export function buildMockPricesResponse(args: {
  productId: string
  brand?: string
  siteKey?: string
  countryCodes?: string[]
}): PricesResponse {
  const productId = args.productId
  const brand = (args.brand || 'ZARA').trim() || 'ZARA'
  const siteKey = (args.siteKey || 'zara').trim() || 'zara'

  const siteBase =
    MOCK_SITES.find((s) => s.key === siteKey)?.base_url ||
    MOCK_SITES.find((s) => s.key === 'zara')?.base_url ||
    'https://example.com'

  // Small deterministic variance per productId
  const digits = (productId.match(/\d+/g) || []).join('')
  const seed = digits ? Number(digits.slice(-6)) : productId.length * 123
  const basePriceUsd = 19.99 + ((seed % 3500) / 100) // 19.99 .. 54.99

  const allPrices: PricesResponse['prices'] = {
    IL: {
      country_code: 'IL',
      found: true,
      price: Math.round(basePriceUsd * 3.7 * 10) / 10,
      currency: 'ILS',
      product_url: `${siteBase}/il/en/product/${encodeURIComponent(productId)}`,
      evidence: `Mock: "${brand} item ${productId}" found on ${siteKey.toUpperCase()} IL`,
      confidence: 0.93,
    },
    US: {
      country_code: 'US',
      found: true,
      price: Math.round(basePriceUsd * 100) / 100,
      currency: 'USD',
      product_url: `${siteBase}/us/en/product/${encodeURIComponent(productId)}`,
      evidence: `Mock: "${brand} item ${productId}" found on ${siteKey.toUpperCase()} US`,
      confidence: 0.91,
    },
    GB: {
      country_code: 'GB',
      found: true,
      // Keep currencies within USD/EUR/ILS so the "Advanced" conversion always works
      price: Math.round(basePriceUsd * 0.95 * 100) / 100,
      currency: 'EUR',
      product_url: `${siteBase}/gb/en/product/${encodeURIComponent(productId)}`,
      evidence: `Mock: "${brand} item ${productId}" found on ${siteKey.toUpperCase()} GB`,
      confidence: 0.9,
    },
    DE: {
      country_code: 'DE',
      found: true,
      price: Math.round(basePriceUsd * 0.92 * 100) / 100,
      currency: 'EUR',
      product_url: `${siteBase}/de/en/product/${encodeURIComponent(productId)}`,
      evidence: `Mock: "${brand} item ${productId}" found on ${siteKey.toUpperCase()} DE`,
      confidence: 0.9,
    },
    FR: {
      country_code: 'FR',
      found: false,
      price: null,
      currency: null,
      product_url: null,
      evidence: `Mock: No reliable match for "${brand} item ${productId}" in FR`,
      confidence: 0.34,
      message: 'Price not found (mock)',
    },
    ES: {
      country_code: 'ES',
      found: true,
      price: Math.round(basePriceUsd * 0.89 * 100) / 100,
      currency: 'EUR',
      product_url: `${siteBase}/es/en/product/${encodeURIComponent(productId)}`,
      evidence: `Mock: "${brand} item ${productId}" found on ${siteKey.toUpperCase()} ES`,
      confidence: 0.88,
    },
  }

  const prices = pickAllOrFilter(allPrices, args.countryCodes)
  return {
    product_id: productId,
    brand,
    countries_count: Object.keys(prices).length,
    prices,
  }
}



