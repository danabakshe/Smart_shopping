import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, AuthUser, Country, FxResponse, HistoryItem, PriceResult, Site } from '../services/api'
import './PriceSearch.css'

type PriceRow = {
  site: string
  countryCode: string
  countryLabel: string
  mkt: string
  description: string
  priceWithCurrency: string
  price: number | null
  currencyRaw: string | null
  productUrl: string | null
  found: boolean
}

type FxCurrency = 'USD' | 'EUR' | 'ILS'

function extractDescriptionFromEvidence(evidence: string | null): string {
  if (!evidence) return ''
  // Try to extract a quoted product name first (covers: '...', "...", “...”, ‘...’)
  const m =
    evidence.match(/[“‘'"](.*?)[”’'"]/)?.[1]?.trim() ||
    evidence.match(/The\s+[“‘'"](.*?)[”’'"]\s+with\s+reference/i)?.[1]?.trim()
  return (m || evidence).trim()
}

function formatPriceWithCurrency(result: PriceResult): string {
  if (!result.found || result.price == null || !result.currency) return ''
  return `${result.price} ${result.currency}`
}

function normalizeCurrency(raw: string | null): FxCurrency | null {
  if (!raw || typeof raw !== 'string') return null
  const s = raw.trim().toUpperCase()
  if (!s) return null

  // Common symbols / synonyms from LLM output
  if (s.includes('$') || s === 'USD' || s.includes('USD') || s.includes('US$')) return 'USD'
  if (s.includes('€') || s === 'EUR' || s.includes('EUR') || s.includes('EURO')) return 'EUR'
  if (s.includes('₪') || s === 'ILS' || s.includes('ILS') || s.includes('NIS') || s.includes('SHEKEL')) return 'ILS'

  if (s === 'EU') return 'EUR'
  return null
}

function parseEnvNumber(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function getUsdPerUnitRatesFallback(): Record<FxCurrency, number> {
  // Fallback FX (demo) - 1 unit of currency = X USD
  const env: any = (import.meta as any)?.env || {}
  const usdPerEur = parseEnvNumber(env.VITE_USD_PER_EUR) ?? 1.09
  const usdPerIls = parseEnvNumber(env.VITE_USD_PER_ILS) ?? 0.27
  return { USD: 1, EUR: usdPerEur, ILS: usdPerIls }
}

function convertCurrency(amount: number, from: FxCurrency, to: FxCurrency, usdPerUnit: Record<FxCurrency, number>): number {
  return (amount * usdPerUnit[from]) / usdPerUnit[to]
}

function formatCurrency(amount: number, currency: FxCurrency): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function PriceSearch({ user }: { user: AuthUser | null }) {
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteKey, setSelectedSiteKey] = useState<string>('')
  const [loadingSites, setLoadingSites] = useState(true)
  const [countries, setCountries] = useState<Country[]>([])
  const [selectedCountries, setSelectedCountries] = useState<string[]>([])
  const [mkt, setMkt] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [loadingCountries, setLoadingCountries] = useState(true)
  const [results, setResults] = useState<PriceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([])
  const [historyError, setHistoryError] = useState<string | null>(null)

  const refreshHistory = async () => {
    if (!user) {
      setHistoryItems([])
      setHistoryError('Please log in to see your search history.')
      return
    }
    setHistoryError(null)
    setHistoryLoading(true)
    try {
      const items = await api.auth.history()
      setHistoryItems(items)
    } catch (err) {
      setHistoryItems([])
      setHistoryError(err instanceof Error ? err.message : 'Failed to load history')
    } finally {
      setHistoryLoading(false)
    }
  }

  // Reset to default screen when user logs in or logs out
  useEffect(() => {
    // Clear history state
    setHistoryOpen(false)
    setHistoryLoading(false)
    setHistoryItems([])
    setHistoryError(null)
    // Clear search results and reset search state
    setResults(null)
    setSelectedSiteKey('')
    setSelectedCountries([])
    setMkt('')
    setError(null)
    setAdvancedOpen(false)
    setHasSearchedWithAdvanced(false)
  }, [user])

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [selectedFxCurrency, setSelectedFxCurrency] = useState<FxCurrency>('USD')
  const [usdPerUnit, setUsdPerUnit] = useState<Record<FxCurrency, number>>(() => getUsdPerUnitRatesFallback())
  const [hasSearchedWithAdvanced, setHasSearchedWithAdvanced] = useState(false)

  const mockEnabled = useMemo(() => {
    const env: any = (import.meta as any)?.env || {}
    const v = env.VITE_USE_MOCK
    if (typeof v === 'string' && ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())) return true
    try {
      if (typeof window !== 'undefined') {
        const sp = new URLSearchParams(window.location.search)
        const qp = (sp.get('mock') || '').trim().toLowerCase()
        if (['1', 'true', 'yes', 'on'].includes(qp)) return true
        const ls = (window.localStorage?.getItem('use_mock') || '').trim().toLowerCase()
        if (['1', 'true', 'yes', 'on'].includes(ls)) return true
      }
    } catch {
      // ignore
    }
    return false
  }, [])

  const toggleMockMode = () => {
    try {
      if (typeof window === 'undefined') return
      window.localStorage?.setItem('use_mock', mockEnabled ? 'false' : 'true')
      const url = new URL(window.location.href)
      url.searchParams.delete('mock')
      window.location.href = url.toString()
    } catch {
      // ignore
    }
  }

  const showSwitchToMock =
    !mockEnabled &&
    typeof error === 'string' &&
    (error.toLowerCase().includes('daily quota') ||
      error.toLowerCase().includes('quota') ||
      error.toLowerCase().includes('resource_exhausted') ||
      error.toLowerCase().includes('rate limit') ||
      error.toLowerCase().includes('temporarily unavailable') ||
      error.toLowerCase().includes('try again later'))

  const [siteOpen, setSiteOpen] = useState(false)
  const [siteHighlightedIdx, setSiteHighlightedIdx] = useState<number>(-1)
  const siteSelectRef = useRef<HTMLDivElement | null>(null)

  const [countryOpen, setCountryOpen] = useState(false)
  const [highlightedIdx, setHighlightedIdx] = useState<number>(-1)
  const countrySelectRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const fetchSites = async () => {
      try {
        const data = await api.sites.list()
        // Ensure data is an array
        const sitesArray = Array.isArray(data) ? data : []
        console.log('Loaded sites:', sitesArray)
        setSites(sitesArray)
        // Don't auto-select - let user choose
        if (sitesArray.length === 0 && !mockEnabled) {
          // Don't set as error, just log - empty database is a setup issue, not a runtime error
          console.warn('No sites found in database. Run: cd Server/server && python seed.py')
        }
      } catch (err) {
        console.error('Failed to load sites:', err)
        setSites([]) // Ensure sites is set to empty array on error
        const errorMessage = err instanceof Error ? err.message : 'Failed to load sites'
        setError(errorMessage)
      } finally {
        setLoadingSites(false)
      }
    }
    fetchSites()
  }, [mockEnabled])

  useEffect(() => {
    const fetchCountries = async () => {
      try {
        const data = await api.countries.list()
        setCountries(data)
        // Don't auto-select - let user choose
      } catch (err) {
        setError('Failed to load countries')
      } finally {
        setLoadingCountries(false)
      }
    }
    fetchCountries()
  }, [mockEnabled])

  // Default to one country so a first search is a single Gemini call (free tier friendly).
  // `user` is included so after login reset clears the selection, we repopulate when countries are already loaded.
  useEffect(() => {
    if (countries.length === 0) return
    setSelectedCountries((prev) => (prev.length > 0 ? prev : [countries[0].code]))
  }, [countries, user])

  useEffect(() => {
    if (!advancedOpen) return

    let cancelled = false
    const run = async () => {
      try {
        const data: FxResponse = await api.fx.get('USD', ['USD', 'EUR', 'ILS'])
        const eurPerUsd = Number((data.rates || ({} as any)).EUR)
        const ilsPerUsd = Number((data.rates || ({} as any)).ILS)

        if (!Number.isFinite(eurPerUsd) || eurPerUsd <= 0 || !Number.isFinite(ilsPerUsd) || ilsPerUsd <= 0) {
          throw new Error('Invalid FX rates payload')
        }

        const next: Record<FxCurrency, number> = {
          USD: 1,
          EUR: 1 / eurPerUsd,
          ILS: 1 / ilsPerUsd,
        }

        if (cancelled) return
        setUsdPerUnit(next)
      } catch {
        if (cancelled) return
        setUsdPerUnit(getUsdPerUnitRatesFallback())
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [advancedOpen])

  const selectedSiteLabel = useMemo(() => {
    const s = sites.find((x) => x.key === selectedSiteKey)
    return s ? s.name : 'Select Site'
  }, [sites, selectedSiteKey])

  const selectedCountryLabel = useMemo(() => {
    if (!selectedCountries.length) return 'Select Country'
    if (countries.length > 0 && selectedCountries.length === countries.length) return 'All countries'
    if (selectedCountries.length === 1) {
      const code = selectedCountries[0]
      const c = countries.find((x) => x.code === code)
      return c ? `${c.name} (${c.code})` : `${code}`
    }
    const labels = selectedCountries.map((code) => {
      const c = countries.find((x) => x.code === code)
      return c ? c.name : code
    })
    return labels.join(', ')
  }, [countries, selectedCountries])

  const allCountryCodes = useMemo(() => countries.map((c) => c.code), [countries])
  const isAllCountriesSelected = useMemo(() => {
    if (!countries.length) return false
    return selectedCountries.length === countries.length
  }, [countries.length, selectedCountries.length])

  const toggleCountry = (code: string) => {
    const c = code.trim()
    if (!c) return
    setSelectedCountries((prev) => {
      const exists = prev.includes(c)
      if (exists) {
        const next = prev.filter((x) => x !== c)
        return next
      }
      return [...prev, c]
    })
  }

  const toggleAllCountries = () => {
    setSelectedCountries((prev) => {
      if (countries.length === 0) return prev
      const allSelected = prev.length === countries.length
      return allSelected ? [] : allCountryCodes
    })
  }

  // Keep selection in sync with DB list (e.g., if countries change)
  // Only filter out invalid selections, don't auto-select
  useEffect(() => {
    if (!countries.length) return
    setSelectedCountries((prev) => {
      const allowed = new Set(allCountryCodes)
      const next = prev.filter((c) => allowed.has(c))
      // Don't auto-select - return empty array if no valid selections
      return next
    })
  }, [allCountryCodes, countries.length])

  useEffect(() => {
    if (!siteOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const root = siteSelectRef.current
      if (!root) return
      if (e.target instanceof Node && !root.contains(e.target)) {
        setSiteOpen(false)
        setSiteHighlightedIdx(-1)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [siteOpen])

  useEffect(() => {
    if (!countryOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const root = countrySelectRef.current
      if (!root) return
      if (e.target instanceof Node && !root.contains(e.target)) {
        setCountryOpen(false)
        setHighlightedIdx(-1)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [countryOpen])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mkt.trim() || selectedCountries.length === 0 || !selectedSiteKey) return

    setError(null)
    setResults(null)
    setLoading(true)

    try {
      const data = await api.prices.get(mkt.trim(), selectedSiteKey, 'ZARA', selectedCountries)
      
      const rows: PriceRow[] = Object.entries(data.prices || {}).map(([countryCode, r]) => {
        const country = countries.find((c) => c.code === countryCode)
        const countryLabel = country ? `${country.name} (${country.code})` : countryCode
        const siteName = selectedSiteLabel || data.brand || ''
        const description = extractDescriptionFromEvidence(r.evidence)
        const priceWithCurrency = formatPriceWithCurrency(r)
        const productUrl = r.product_url || null

        const fallbackDescParts = [description]
        if (!r.found) {
          fallbackDescParts.push('Price not found')
          // Extract cleaner error message
          let detail = r.message || r.error || ''
          if (detail) {
            // Try to extract just the message from dict-like error strings
            const msgMatch = detail.match(/'message':\s*['"]([^'"]+)['"]/)
            if (msgMatch) {
              detail = msgMatch[1]
            } else if (detail.includes('Daily quota exceeded') || detail.includes('quota exceeded') || r.error_code === 'daily_quota') {
              // Handle daily quota errors - show helpful message
              if (detail.includes('Daily quota exceeded')) {
                // Already formatted by backend
                detail = detail
              } else {
                detail = 'Daily quota exceeded (20 requests/day limit). Please try again tomorrow or upgrade your API plan.'
              }
            } else if (detail.includes('503') || detail.includes('UNAVAILABLE')) {
              // Handle 503/overloaded errors with user-friendly message
              if (detail.toLowerCase().includes('overloaded')) {
                detail = 'Service temporarily overloaded. Please try again in a moment.'
              } else {
                detail = 'Service temporarily unavailable. Please try again later.'
              }
            } else if (detail.includes('Failed to parse JSON')) {
              detail = 'Unable to parse response. The service may be experiencing issues.'
            }
            if (detail) fallbackDescParts.push(detail)
          }
        }

        return {
          site: siteName,
          countryCode,
          countryLabel,
          mkt: data.product_id,
          description: fallbackDescParts.filter(Boolean).join(' — '),
          priceWithCurrency,
          price: r.price ?? null,
          currencyRaw: r.currency ?? null,
          productUrl,
          found: Boolean(r.found),
        }
      })

      if (rows.length === 0) {
        setError('No price data found')
        return
      }

      setResults(rows)
      setHasSearchedWithAdvanced(advancedOpen)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch price')
    } finally {
      setLoading(false)
      if (user) {
        // Refresh history best-effort (server records on /prices)
        try {
          const items = await api.auth.history()
          setHistoryItems(items)
        } catch {
          // ignore
        }
      }
    }
  }

  const showConvertedColumn = results !== null && hasSearchedWithAdvanced && Boolean(selectedFxCurrency)

  const bestRowKeys = useMemo(() => {
    if (!results || results.length === 0) return new Set<string>()

    const comparable: Array<{ key: string; value: number }> = []
    for (const row of results) {
      if (!row.found || row.price == null) continue
      const from = normalizeCurrency(row.currencyRaw)
      if (!from) continue
      const v = convertCurrency(row.price, from, selectedFxCurrency, usdPerUnit)
      if (!Number.isFinite(v)) continue
      comparable.push({ key: `${row.site}|${row.countryCode}|${row.mkt}`, value: v })
    }

    if (comparable.length === 0) return new Set<string>()
    const min = comparable.reduce((acc, x) => Math.min(acc, x.value), Number.POSITIVE_INFINITY)
    const eps = 1e-6
    return new Set(comparable.filter((x) => Math.abs(x.value - min) <= eps).map((x) => x.key))
  }, [results, selectedFxCurrency, usdPerUnit])

  return (
    <div className="price-search">
      {mockEnabled ? (
        <div className="error-message" role="status" aria-live="polite">
          <strong>Mock mode:</strong> enabled{' '}
          <button type="button" className="advanced-toggle" onClick={toggleMockMode}>
            Disable
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button type="button" className="advanced-toggle" onClick={toggleMockMode}>
            Use Mock Data
          </button>
        </div>
      )}
      <form onSubmit={handleSearch} className="search-form">
        <div className="form-group">
          <label htmlFor="site-trigger">Select Site:</label>
          <div className="custom-select" ref={siteSelectRef}>
            <button
              id="site-trigger"
              type="button"
              className="custom-select-trigger"
              disabled={loadingSites || loading}
              aria-haspopup="listbox"
              aria-expanded={siteOpen}
              onClick={() => {
                if (loadingSites || loading) return
                setSiteOpen((v) => !v)
                setSiteHighlightedIdx(-1)
              }}
              onKeyDown={(e) => {
                if (loadingSites || loading) return

                if (!siteOpen && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  setSiteOpen(true)
                  setSiteHighlightedIdx(Math.max(0, sites.findIndex((s) => s.key === selectedSiteKey)))
                  return
                }

                if (!siteOpen) return

                if (e.key === 'Escape') {
                  e.preventDefault()
                  setSiteOpen(false)
                  setSiteHighlightedIdx(-1)
                  return
                }

                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSiteHighlightedIdx((idx) => Math.min(sites.length - 1, (idx === -1 ? 0 : idx + 1)))
                  return
                }

                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSiteHighlightedIdx((idx) => Math.max(0, (idx === -1 ? 0 : idx - 1)))
                  return
                }

                if (e.key === 'Enter') {
                  e.preventDefault()
                  const picked = sites[siteHighlightedIdx]
                  if (picked) {
                    setSelectedSiteKey(picked.key)
                    setSiteOpen(false)
                    setSiteHighlightedIdx(-1)
                  }
                }
              }}
            >
              <span className="custom-select-value">
                {loadingSites ? 'Loading sites...' : selectedSiteLabel}
              </span>
              <span className="custom-select-caret" aria-hidden="true">▾</span>
            </button>

            {siteOpen && !loadingSites && (
              <ul className="custom-select-menu" role="listbox" aria-label="Select Site">
                {sites.length === 0 ? (
                  <li 
                    className="custom-select-option" 
                    role="option" 
                    aria-disabled="true" 
                    style={{ opacity: 0.6, cursor: 'not-allowed', padding: '8px 12px' }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {error && error.includes('Failed to load') 
                      ? 'Error loading sites. Check console for details.'
                      : 'No sites in database. Run: cd Server/server && python seed.py'}
                  </li>
                ) : (
                  sites.map((site, idx) => {
                    const isSelected = site.key === selectedSiteKey
                    const isHighlighted = idx === siteHighlightedIdx
                    return (
                      <li
                        key={site.key}
                        role="option"
                        aria-selected={isSelected}
                        className={`custom-select-option${isSelected ? ' is-selected' : ''}${
                          isHighlighted ? ' is-highlighted' : ''
                        }`}
                        onMouseEnter={() => setSiteHighlightedIdx(idx)}
                        onMouseDown={(e) => {
                          // Prevent blur/click-outside from closing before selection
                          e.preventDefault()
                        }}
                        onClick={() => {
                          setSelectedSiteKey(site.key)
                          setSiteOpen(false)
                          setSiteHighlightedIdx(-1)
                        }}
                      >
                        {site.name}
                      </li>
                    )
                  })
                )}
              </ul>
            )}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="country-trigger">Select Country:</label>
          <div className="custom-select" ref={countrySelectRef}>
            <button
              id="country-trigger"
              type="button"
              className="custom-select-trigger"
              disabled={loadingCountries || loading}
              aria-haspopup="listbox"
              aria-expanded={countryOpen}
              onClick={() => {
                if (loadingCountries || loading) return
                setCountryOpen((v) => !v)
                setHighlightedIdx(-1)
              }}
              onKeyDown={(e) => {
                if (loadingCountries || loading) return

                if (!countryOpen && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  setCountryOpen(true)
                  setHighlightedIdx(
                    Math.max(
                      0,
                      isAllCountriesSelected
                        ? 0
                        : Math.max(
                            1,
                            countries.findIndex((c) => c.code === (selectedCountries[0] || '')) + 1
                          )
                    )
                  )
                  return
                }

                if (!countryOpen) return

                if (e.key === 'Escape') {
                  e.preventDefault()
                  setCountryOpen(false)
                  setHighlightedIdx(-1)
                  return
                }

                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setHighlightedIdx((idx) => Math.min(countries.length, (idx === -1 ? 0 : idx + 1)))
                  return
                }

                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHighlightedIdx((idx) => Math.max(0, (idx === -1 ? 0 : idx - 1)))
                  return
                }

                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (highlightedIdx === 0) {
                    toggleAllCountries()
                    return
                  }
                  const picked = countries[highlightedIdx - 1]
                  if (picked) {
                    toggleCountry(picked.code)
                  }
                }
              }}
            >
              <span className="custom-select-value">
                {loadingCountries ? 'Loading countries...' : selectedCountryLabel}
              </span>
              <span className="custom-select-caret" aria-hidden="true">▾</span>
            </button>

            {countryOpen && !loadingCountries && (
              <ul
                className="custom-select-menu"
                role="listbox"
                aria-label="Select Country"
                aria-multiselectable="true"
              >
                <li
                  key="__all__"
                  role="option"
                  aria-selected={isAllCountriesSelected}
                  className={`custom-select-option is-multi is-select-all${
                    isAllCountriesSelected ? ' is-selected' : ''
                  }${highlightedIdx === 0 ? ' is-highlighted' : ''}`}
                  onMouseEnter={() => setHighlightedIdx(0)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                  }}
                  onClick={() => {
                    toggleAllCountries()
                  }}
                >
                  <span
                    className={`option-check${isAllCountriesSelected ? ' is-checked' : ''}`}
                    aria-hidden="true"
                  >
                    {isAllCountriesSelected ? '✓' : ''}
                  </span>
                  <span className="option-label">Select all countries</span>
                </li>
                {countries.map((country, idx) => {
                  const isSelected = selectedCountries.includes(country.code)
                  const isHighlighted = idx + 1 === highlightedIdx
                  return (
                    <li
                      key={country.code}
                      role="option"
                      aria-selected={isSelected}
                      className={`custom-select-option is-multi${isSelected ? ' is-selected' : ''}${
                        isHighlighted ? ' is-highlighted' : ''
                      }`}
                      onMouseEnter={() => setHighlightedIdx(idx + 1)}
                      onMouseDown={(e) => {
                        // Prevent blur/click-outside from closing before selection
                        e.preventDefault()
                      }}
                      onClick={() => {
                        toggleCountry(country.code)
                      }}
                    >
                      <span className={`option-check${isSelected ? ' is-checked' : ''}`} aria-hidden="true">
                        {isSelected ? '✓' : ''}
                      </span>
                      <span className="option-label">
                        {country.name} ({country.code})
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="mkt">MKT (Product ID):</label>
          <input
            id="mkt"
            type="text"
            value={mkt}
            onChange={(e) => setMkt(e.target.value)}
            placeholder="Enter MKT number"
            disabled={loading}
            required
          />
        </div>

        {advancedOpen && (
          <div className="form-group advanced-currency">
            <label>Choose currency:</label>
            <div className="currency-picker" role="radiogroup" aria-label="Select currency for conversion">
              <button
                type="button"
                className={`currency-option${selectedFxCurrency === 'USD' ? ' is-selected' : ''}`}
                role="radio"
                aria-checked={selectedFxCurrency === 'USD'}
                onClick={() => setSelectedFxCurrency('USD')}
              >
                <span className="option-check" aria-hidden="true">
                  {selectedFxCurrency === 'USD' ? '✓' : ''}
                </span>
                <span className="currency-label">USD ($)</span>
              </button>
              <button
                type="button"
                className={`currency-option${selectedFxCurrency === 'EUR' ? ' is-selected' : ''}`}
                role="radio"
                aria-checked={selectedFxCurrency === 'EUR'}
                onClick={() => setSelectedFxCurrency('EUR')}
              >
                <span className="option-check" aria-hidden="true">
                  {selectedFxCurrency === 'EUR' ? '✓' : ''}
                </span>
                <span className="currency-label">EUR (€)</span>
              </button>
              <button
                type="button"
                className={`currency-option${selectedFxCurrency === 'ILS' ? ' is-selected' : ''}`}
                role="radio"
                aria-checked={selectedFxCurrency === 'ILS'}
                onClick={() => setSelectedFxCurrency('ILS')}
              >
                <span className="option-check" aria-hidden="true">
                  {selectedFxCurrency === 'ILS' ? '✓' : ''}
                </span>
                <span className="currency-label">ILS (₪)</span>
              </button>
            </div>
          </div>
        )}

        <div className="form-actions">
          <button
            type="submit"
            className="search-submit"
            disabled={
              loading ||
              loadingCountries ||
              loadingSites ||
              !mkt.trim() ||
              !selectedSiteKey ||
              selectedCountries.length === 0
            }
          >
            {loading ? 'Searching...' : 'Search Price'}
          </button>

          <button
            type="button"
            className="advanced-toggle"
            disabled={loading}
            aria-expanded={advancedOpen}
            onClick={() => {
              if (!advancedOpen) {
                setHasSearchedWithAdvanced(false)
              }
              setAdvancedOpen((v) => !v)
            }}
          >
            {advancedOpen ? 'Hide Advanced' : 'Advanced Search'}
          </button>

          {user && (
            <button
              type="button"
              className="advanced-toggle"
              disabled={loading}
              aria-expanded={historyOpen}
              onClick={async () => {
                const next = !historyOpen
                setHistoryOpen(next)
                if (next) await refreshHistory()
              }}
            >
              Search history
            </button>
          )}
        </div>
      </form>

      {user && historyOpen && (
        <div className="history-panel" role="region" aria-label="Search history">
          <div className="history-panel-header">
            <strong>Recent searches (last 3)</strong>
            <button type="button" className="advanced-toggle" onClick={() => setHistoryOpen(false)}>
              Close
            </button>
          </div>

          {historyError && (
            <div className="error-message" role="status" aria-live="polite" style={{ marginTop: 10 }}>
              <strong>Info:</strong> {historyError}
            </div>
          )}

          {!historyError && historyLoading && <div style={{ marginTop: 10, opacity: 0.8 }}>Loading...</div>}

          {!historyError && !historyLoading && (
            <>
              {historyItems.length === 0 ? (
                <div style={{ marginTop: 10, opacity: 0.8 }}>No recent searches yet.</div>
              ) : (
                <ul className="history-list">
                  {historyItems.map((it) => (
                    <li key={`${it.mkt}|${it.created_at}`} className="history-item">
                      <button
                        type="button"
                        className="history-item-btn"
                        onClick={() => {
                          setMkt(it.mkt)
                          setHistoryOpen(false)
                        }}
                      >
                        <span className="mono">{it.mkt}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
          {showSwitchToMock && (
            <div style={{ marginTop: 10 }}>
              <button type="button" className="advanced-toggle" onClick={toggleMockMode}>
                Switch to Mock (no Gemini)
              </button>
            </div>
          )}
        </div>
      )}

      {results && (
        <div className="result-card">
          <h2>Price Result</h2>
          <div className="results-table-wrapper" role="region" aria-label="Price results table">
            <table className="results-table">
              <thead>
                <tr>
                  <th scope="col" className="col-site">Site</th>
                  <th scope="col" className="col-country">Country</th>
                  <th scope="col" className="col-mkt">MKT</th>
                  <th scope="col" className="col-desc">Item Description</th>
                  <th scope="col" className="col-price">Price</th>
                  {showConvertedColumn && (
                    <th scope="col" className="col-converted">
                      {selectedFxCurrency === 'USD'
                        ? 'Price (USD $)'
                        : selectedFxCurrency === 'EUR'
                          ? 'Price (EUR €)'
                          : 'Price (ILS ₪)'}
                    </th>
                  )}
                  <th scope="col" className="col-link">Website Link</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => {
                  const rowKey = `${row.site}|${row.countryCode}|${row.mkt}`
                  const isBest = bestRowKeys.has(rowKey)
                  return (
                  <tr key={rowKey} className={isBest ? 'is-best' : ''}>
                    <td className="col-site site-cell">
                      <span className="site-cell-value">{row.site}</span>
                      {isBest && (
                        <span className="best-badge best-badge--between" aria-label="Best price">
                          Best
                        </span>
                      )}
                    </td>
                    <td className="col-country">{row.countryLabel}</td>
                    <td className="mono col-mkt">{row.mkt}</td>
                    <td className="desc col-desc">{row.description || (row.found ? '' : 'Price not found')}</td>
                    <td className={`price col-price ${row.found ? 'is-found' : 'is-missing'}${isBest ? ' is-best' : ''}`}>
                      <span className="price-value">{row.priceWithCurrency || (row.found ? '' : '—')}</span>
                    </td>
                    {showConvertedColumn && (
                      <td className={`price converted col-converted ${row.found ? 'is-found' : 'is-missing'}${isBest ? ' is-best' : ''}`}>
                        {(() => {
                          if (!row.found || row.price == null) return '—'
                          const from = normalizeCurrency(row.currencyRaw)
                          if (!from) return '—'
                          const converted = convertCurrency(row.price, from, selectedFxCurrency, usdPerUnit)
                          return formatCurrency(converted, selectedFxCurrency)
                        })()}
                      </td>
                    )}
                    <td className="col-link">
                      {row.productUrl ? (
                        <a
                          href={row.productUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="product-link"
                        >
                          View Product →
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default PriceSearch

