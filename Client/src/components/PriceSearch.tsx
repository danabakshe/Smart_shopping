import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, Country, FxResponse, PriceResult, Site } from '../services/api'
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

function PriceSearch() {
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

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [selectedFxCurrency, setSelectedFxCurrency] = useState<FxCurrency>('USD')
  const [usdPerUnit, setUsdPerUnit] = useState<Record<FxCurrency, number>>(() => getUsdPerUnitRatesFallback())

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
        setSites(data)
        if (data.length > 0) {
          setSelectedSiteKey(data[0].key)
        }
      } catch (err) {
        setError('Failed to load sites')
      } finally {
        setLoadingSites(false)
      }
    }
    fetchSites()
  }, [])

  useEffect(() => {
    const fetchCountries = async () => {
      try {
        const data = await api.countries.list()
        setCountries(data)
        if (data.length > 0) {
          setSelectedCountries([data[0].code])
        }
      } catch (err) {
        setError('Failed to load countries')
      } finally {
        setLoadingCountries(false)
      }
    }
    fetchCountries()
  }, [])

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
  useEffect(() => {
    if (!countries.length) return
    setSelectedCountries((prev) => {
      const allowed = new Set(allCountryCodes)
      const next = prev.filter((c) => allowed.has(c))
      return next.length ? next : [allCountryCodes[0]]
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
          const detail = r.message || r.error || ''
          if (detail) fallbackDescParts.push(detail)
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch price')
    } finally {
      setLoading(false)
    }
  }

  const showConvertedColumn = advancedOpen && Boolean(selectedFxCurrency)

  return (
    <div className="price-search">
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
                {sites.map((site, idx) => {
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
                })}
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
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {advancedOpen ? 'Hide Advanced' : 'Advanced Search'}
          </button>
        </div>
      </form>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}

      {results && (
        <div className="result-card">
          <h2>Price Result</h2>
          <div className="results-table-wrapper" role="region" aria-label="Price results table">
            <table className="results-table">
              <thead>
                <tr>
                  <th scope="col">Site</th>
                  <th scope="col">Country</th>
                  <th scope="col">MKT</th>
                  <th scope="col">Item Description</th>
                  <th scope="col">Price</th>
                  {showConvertedColumn && (
                    <th scope="col">
                      {selectedFxCurrency === 'USD'
                        ? 'Price (USD $)'
                        : selectedFxCurrency === 'EUR'
                          ? 'Price (EUR €)'
                          : 'Price (ILS ₪)'}
                    </th>
                  )}
                  <th scope="col">Website Link</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={`${row.site}|${row.countryCode}|${row.mkt}`}>
                    <td>{row.site}</td>
                    <td>{row.countryLabel}</td>
                    <td className="mono">{row.mkt}</td>
                    <td className="desc">{row.description || (row.found ? '' : 'Price not found')}</td>
                    <td className={`price ${row.found ? 'is-found' : 'is-missing'}`}>
                      {row.priceWithCurrency || (row.found ? '' : '—')}
                    </td>
                    {showConvertedColumn && (
                      <td className={`price converted ${row.found ? 'is-found' : 'is-missing'}`}>
                        {(() => {
                          if (!row.found || row.price == null) return '—'
                          const from = normalizeCurrency(row.currencyRaw)
                          if (!from) return '—'
                          const converted = convertCurrency(row.price, from, selectedFxCurrency, usdPerUnit)
                          return formatCurrency(converted, selectedFxCurrency)
                        })()}
                      </td>
                    )}
                    <td>
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default PriceSearch

