const API_BASE_URL = '/api'

export interface Country {
  code: string
  name: string
}

export interface Site {
  key: string
  name: string
  base_url: string | null
}

export interface PriceResult {
  country_code: string
  found: boolean
  price: number | null
  currency: string | null
  product_url: string | null
  evidence: string | null
  confidence: number
  error?: string
  message?: string
}

export interface PricesResponse {
  product_id: string
  brand: string
  countries_count: number
  prices: Record<string, PriceResult>
}

export interface FxResponse {
  base: string
  as_of_utc?: string | null
  rates: Record<string, number>
}

export const api = {
  countries: {
    list: async (): Promise<Country[]> => {
      const response = await fetch(`${API_BASE_URL}/countries`)
      if (!response.ok) throw new Error('Failed to fetch countries')
      return response.json()
    }
  },

  sites: {
    list: async (): Promise<Site[]> => {
      const response = await fetch(`${API_BASE_URL}/sites`)
      if (!response.ok) throw new Error('Failed to fetch sites')
      return response.json()
    }
  },

  fx: {
    get: async (base: string = 'USD', symbols: string[] = ['USD', 'EUR', 'ILS']): Promise<FxResponse> => {
      const b = (base || 'USD').trim().toUpperCase()
      const syms = (Array.isArray(symbols) ? symbols : ['USD', 'EUR', 'ILS'])
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => s.trim().toUpperCase())
      const params = new URLSearchParams()
      params.set('base', b)
      params.set('symbols', syms.join(','))

      const response = await fetch(`${API_BASE_URL}/fx?${params.toString()}`)
      if (!response.ok) {
        let payload: any = null
        try {
          payload = await response.json()
        } catch {
          payload = null
        }
        if (response.status === 429) {
          const retryAfter = payload?.retry_after
          const seconds =
            typeof retryAfter === 'number' && Number.isFinite(retryAfter)
              ? Math.max(1, Math.ceil(retryAfter))
              : null
          const msg = seconds != null ? `FX rate limit exceeded. Please retry in ${seconds}s.` : 'FX rate limit exceeded.'
          throw new Error(msg)
        }
        throw new Error(payload?.error || 'Failed to fetch FX rates')
      }
      return response.json()
    }
  },

  prices: {
    get: async (
      productId: string,
      siteKey?: string,
      brand: string = 'ZARA',
      countryCodeOrCodes?: string | string[]
    ): Promise<PricesResponse> => {
      const country_code =
        typeof countryCodeOrCodes === 'string' && countryCodeOrCodes.trim()
          ? countryCodeOrCodes.trim()
          : undefined

      const country_codes =
        Array.isArray(countryCodeOrCodes) && countryCodeOrCodes.length > 0
          ? countryCodeOrCodes
              .filter((c) => typeof c === 'string' && c.trim())
              .map((c) => c.trim())
          : undefined

      const response = await fetch(`${API_BASE_URL}/prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          brand,
          site_key: siteKey,
          ...(country_codes ? { country_codes } : {}),
          ...(country_code ? { country_code } : {})
        })
      })
      if (!response.ok) {
        let payload: any = null
        try {
          payload = await response.json()
        } catch {
          payload = null
        }

        if (response.status === 429) {
          const errorCode = payload?.error_code
          const retryAfter = payload?.retry_after
          const seconds =
            typeof retryAfter === 'number' && Number.isFinite(retryAfter)
              ? Math.max(1, Math.ceil(retryAfter))
              : null
          const msg =
            errorCode === 'daily_quota'
              ? 'You reached the daily quota for the Gemini (free tier) lookup service. Try again tomorrow or enable billing/upgrade your plan.'
              : seconds != null
                ? `Gemini rate limit exceeded. Please retry in ${seconds} seconds.`
                : 'Gemini rate limit exceeded. Please retry shortly.'
          throw new Error(msg)
        }

        throw new Error(payload?.error || 'Failed to fetch prices')
      }
      return response.json()
    }
  }
}

