const API_BASE_URL = '/api'

function readToggle(key: 'VITE_USE_MOCK' | 'VITE_FALLBACK_TO_MOCK_ON_429'): string {
  const env: any = (import.meta as any)?.env || {}
  const envVal = env[key]
  if (typeof envVal === 'string' && envVal.trim()) return envVal.trim()

  try {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search)
      const qpName = key === 'VITE_USE_MOCK' ? 'mock' : 'fallback_mock_429'
      const qp = sp.get(qpName)
      if (typeof qp === 'string' && qp.trim()) return qp.trim()

      const lsKey = key === 'VITE_USE_MOCK' ? 'use_mock' : 'fallback_mock_429'
      const lsVal = window.localStorage?.getItem(lsKey)
      if (typeof lsVal === 'string' && lsVal.trim()) return lsVal.trim()
    }
  } catch {
    // ignore
  }

  return ''
}

function isTruthy(v: string): boolean {
  const s = (v || '').trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

function isMockEnabled(): boolean {
  return isTruthy(readToggle('VITE_USE_MOCK'))
}

function isFallbackToMockOn429Enabled(): boolean {
  return isTruthy(readToggle('VITE_FALLBACK_TO_MOCK_ON_429'))
}

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
  error_code?: string
  message?: string
  retry_after?: number
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

export interface AuthUser {
  id: number
  username: string
  email: string
}

export interface MeResponse {
  user: AuthUser | null
}

export interface HistoryItem {
  mkt: string
  created_at: string
}

export const api = {
  auth: {
    me: async (): Promise<MeResponse> => {
      const response = await fetch(`${API_BASE_URL}/me`, { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to fetch user')
      return response.json()
    },
    signup: async (username: string, email: string, password: string): Promise<AuthUser> => {
      console.log('[API DEBUG] Signup request starting')
      console.log('[API DEBUG] URL:', `${API_BASE_URL}/auth/signup`)
      console.log('[API DEBUG] Username:', username)
      console.log('[API DEBUG] Email:', email)
      
      const response = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      })
      
      console.log('[API DEBUG] Response status:', response.status)
      console.log('[API DEBUG] Response headers:', Object.fromEntries(response.headers.entries()))
      console.log('[API DEBUG] Response ok:', response.ok)
      
      let payload: any = null
      let responseText = ''
      const contentType = response.headers.get('content-type') || 'unknown'
      
      try {
        responseText = await response.text()
        console.log('[API DEBUG] Response text:', responseText)
        console.log('[API DEBUG] Response text length:', responseText.length)
        console.log('[API DEBUG] Content-Type:', contentType)
        console.log('[API DEBUG] Full response details:', {
          status: response.status,
          statusText: response.statusText,
          contentType,
          body: responseText,
          bodyLength: responseText.length,
          headers: Object.fromEntries(response.headers.entries())
        })
        
        if (!responseText.trim()) {
          console.error('[API DEBUG] Empty response body!')
          console.error('[API DEBUG] Response status:', response.status)
          console.error('[API DEBUG] Content-Type:', contentType)
          throw new Error(`Signup failed (${response.status}): Server returned empty response. Content-Type: ${contentType}`)
        }
        
        payload = JSON.parse(responseText)
        console.log('[API DEBUG] Parsed payload:', payload)
      } catch (parseError) {
        console.error('[API DEBUG] ========== JSON PARSE ERROR ==========')
        console.error('[API DEBUG] Parse error:', parseError)
        console.error('[API DEBUG] Response status:', response.status)
        console.error('[API DEBUG] Content-Type:', contentType)
        console.error('[API DEBUG] Response text (raw):', responseText)
        console.error('[API DEBUG] Response text (length):', responseText.length)
        console.error('[API DEBUG] Response text (first 500 chars):', responseText.substring(0, 500))
        console.error('[API DEBUG] ======================================')
        
        // Always show the actual response, even if empty
        const errorMsg = responseText.trim() 
          ? `Signup failed (${response.status}): Server returned non-JSON response. Content-Type: ${contentType}, Body: ${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}`
          : `Signup failed (${response.status}): Server returned empty response. Content-Type: ${contentType}`
        throw new Error(errorMsg)
      }
      
      if (!response.ok) {
        console.error('[API DEBUG] Response not OK')
        console.error('[API DEBUG] Payload error:', payload?.error)
        const errorMsg = payload?.error || `Signup failed with status ${response.status}`
        throw new Error(errorMsg)
      }
      
      if (!payload?.user) {
        console.error('[API DEBUG] Missing user in payload')
        console.error('[API DEBUG] Full payload:', payload)
        throw new Error('Signup succeeded but no user data returned')
      }
      
      console.log('[API DEBUG] Signup success, user:', payload.user)
      return payload.user as AuthUser
    },
    login: async (username: string, password: string): Promise<AuthUser> => {
      console.log('[API DEBUG] Login request starting')
      console.log('[API DEBUG] URL:', `${API_BASE_URL}/auth/login`)
      console.log('[API DEBUG] Username:', username)
      
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      
      console.log('[API DEBUG] Response status:', response.status)
      console.log('[API DEBUG] Response headers:', Object.fromEntries(response.headers.entries()))
      console.log('[API DEBUG] Response ok:', response.ok)
      
      let payload: any = null
      let responseText = ''
      const contentType = response.headers.get('content-type') || 'unknown'
      
      try {
        responseText = await response.text()
        console.log('[API DEBUG] Response text:', responseText)
        console.log('[API DEBUG] Response text length:', responseText.length)
        console.log('[API DEBUG] Content-Type:', contentType)
        console.log('[API DEBUG] Full response details:', {
          status: response.status,
          statusText: response.statusText,
          contentType,
          body: responseText,
          bodyLength: responseText.length,
          headers: Object.fromEntries(response.headers.entries())
        })
        
        if (!responseText.trim()) {
          console.error('[API DEBUG] Empty response body!')
          console.error('[API DEBUG] Response status:', response.status)
          console.error('[API DEBUG] Content-Type:', contentType)
          throw new Error(`Login failed (${response.status}): Server returned empty response. Content-Type: ${contentType}`)
        }
        
        payload = JSON.parse(responseText)
        console.log('[API DEBUG] Parsed payload:', payload)
      } catch (parseError) {
        console.error('[API DEBUG] ========== JSON PARSE ERROR ==========')
        console.error('[API DEBUG] Parse error:', parseError)
        console.error('[API DEBUG] Response status:', response.status)
        console.error('[API DEBUG] Content-Type:', contentType)
        console.error('[API DEBUG] Response text (raw):', responseText)
        console.error('[API DEBUG] Response text (length):', responseText.length)
        console.error('[API DEBUG] Response text (first 500 chars):', responseText.substring(0, 500))
        console.error('[API DEBUG] ======================================')
        
        // Always show the actual response, even if empty
        const errorMsg = responseText.trim() 
          ? `Login failed (${response.status}): Server returned non-JSON response. Content-Type: ${contentType}, Body: ${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}`
          : `Login failed (${response.status}): Server returned empty response. Content-Type: ${contentType}`
        throw new Error(errorMsg)
      }
      
      if (!response.ok) {
        console.error('[API DEBUG] Response not OK')
        console.error('[API DEBUG] Payload error:', payload?.error)
        const errorMsg = payload?.error || `Login failed with status ${response.status}`
        throw new Error(errorMsg)
      }
      
      if (!payload?.user) {
        console.error('[API DEBUG] Missing user in payload')
        console.error('[API DEBUG] Full payload:', payload)
        throw new Error('Invalid response: missing user data')
      }
      
      console.log('[API DEBUG] Login success, user:', payload.user)
      return payload.user as AuthUser
    },
    logout: async (): Promise<void> => {
      const response = await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error('Failed to log out')
    },
    history: async (): Promise<HistoryItem[]> => {
      const response = await fetch(`${API_BASE_URL}/me/history`, { credentials: 'include' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to fetch history')
      return (payload.items || []) as HistoryItem[]
    },
    recordHistory: async (productId: string): Promise<void> => {
      const response = await fetch(`${API_BASE_URL}/me/history`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to record history')
    },
    forgotPassword: async (email: string): Promise<void> => {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to send reset code')
    },
    resetPassword: async (email: string, code: string, newPassword: string): Promise<void> => {
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, new_password: newPassword }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Failed to reset password')
    },
  },
  countries: {
    list: async (): Promise<Country[]> => {
      if (isMockEnabled()) {
        const { MOCK_COUNTRIES } = await import('./mockData')
        return MOCK_COUNTRIES
      }
      const response = await fetch(`${API_BASE_URL}/countries`, { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to fetch countries')
      return response.json()
    }
  },

  sites: {
    list: async (): Promise<Site[]> => {
      if (isMockEnabled()) {
        const { MOCK_SITES } = await import('./mockData')
        return MOCK_SITES
      }
      const response = await fetch(`${API_BASE_URL}/sites`, { credentials: 'include' })
      if (!response.ok) throw new Error('Failed to fetch sites')
      return response.json()
    }
  },

  fx: {
    get: async (base: string = 'USD', symbols: string[] = ['USD', 'EUR', 'ILS']): Promise<FxResponse> => {
      if (isMockEnabled()) {
        const { getMockFx } = await import('./mockData')
        const payload = getMockFx(base)
        const want = new Set(
          (Array.isArray(symbols) ? symbols : [])
            .filter((s) => typeof s === 'string' && s.trim())
            .map((s) => s.trim().toUpperCase())
        )
        if (want.size > 0) {
          const filtered: Record<string, number> = {}
          for (const [k, v] of Object.entries(payload.rates || {})) {
            if (want.has(k)) filtered[k] = v
          }
          return { ...payload, rates: filtered }
        }
        return payload
      }
      const b = (base || 'USD').trim().toUpperCase()
      const syms = (Array.isArray(symbols) ? symbols : ['USD', 'EUR', 'ILS'])
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => s.trim().toUpperCase())
      const params = new URLSearchParams()
      params.set('base', b)
      params.set('symbols', syms.join(','))

      const response = await fetch(`${API_BASE_URL}/fx?${params.toString()}`, { credentials: 'include' })
      if (!response.ok) {
        if (response.status === 429 && isFallbackToMockOn429Enabled()) {
          const { getMockFx } = await import('./mockData')
          const payload = getMockFx(b)
          const want = new Set(syms)
          const filtered: Record<string, number> = {}
          for (const [k, v] of Object.entries(payload.rates || {})) {
            if (want.has(k)) filtered[k] = v
          }
          return { ...payload, rates: filtered }
        }
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
      countryCodeOrCodes?: string | string[],
      productUrlHint?: string
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

      if (isMockEnabled()) {
        const { buildMockPricesResponse } = await import('./mockData')
        const list = country_codes || (country_code ? [country_code] : undefined)
        return buildMockPricesResponse({ productId, brand, siteKey, countryCodes: list })
      }

      const response = await fetch(`${API_BASE_URL}/prices`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          brand,
          site_key: siteKey,
          ...(typeof productUrlHint === 'string' && productUrlHint.trim()
            ? { product_url_hint: productUrlHint.trim() }
            : {}),
          ...(country_codes ? { country_codes } : {}),
          ...(country_code ? { country_code } : {})
        })
      })
      if (!response.ok) {
        if (response.status === 429 && isFallbackToMockOn429Enabled()) {
          const { buildMockPricesResponse } = await import('./mockData')
          const list = country_codes || (country_code ? [country_code] : undefined)
          return buildMockPricesResponse({ productId, brand, siteKey, countryCodes: list })
        }
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

