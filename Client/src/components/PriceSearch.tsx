import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, Country, PriceResult, Site } from '../services/api'
import './PriceSearch.css'

function PriceSearch() {
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSiteKey, setSelectedSiteKey] = useState<string>('')
  const [loadingSites, setLoadingSites] = useState(true)
  const [countries, setCountries] = useState<Country[]>([])
  const [selectedCountry, setSelectedCountry] = useState<string>('')
  const [mkt, setMkt] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [loadingCountries, setLoadingCountries] = useState(true)
  const [result, setResult] = useState<PriceResult | null>(null)
  const [error, setError] = useState<string | null>(null)

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
          setSelectedCountry(data[0].code)
        }
      } catch (err) {
        setError('Failed to load countries')
      } finally {
        setLoadingCountries(false)
      }
    }
    fetchCountries()
  }, [])

  const selectedSiteLabel = useMemo(() => {
    const s = sites.find((x) => x.key === selectedSiteKey)
    return s ? s.name : 'Select Site'
  }, [sites, selectedSiteKey])

  const selectedCountryLabel = useMemo(() => {
    const c = countries.find((x) => x.code === selectedCountry)
    return c ? `${c.name} (${c.code})` : 'Select Country'
  }, [countries, selectedCountry])

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
    if (!mkt.trim() || !selectedCountry || !selectedSiteKey) return

    setError(null)
    setResult(null)
    setLoading(true)

    try {
      const data = await api.prices.get(mkt.trim(), selectedSiteKey, 'ZARA', selectedCountry)
      // Normalize UK -> GB (same as server does)
      const countryKey = selectedCountry === 'UK' ? 'GB' : selectedCountry
      const countryResult = data.prices[countryKey]
      
      if (countryResult) {
        setResult(countryResult)
      } else {
        setError(`No price data found for country ${selectedCountry}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch price')
    } finally {
      setLoading(false)
    }
  }

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
                  setHighlightedIdx(Math.max(0, countries.findIndex((c) => c.code === selectedCountry)))
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
                  setHighlightedIdx((idx) => Math.min(countries.length - 1, (idx === -1 ? 0 : idx + 1)))
                  return
                }

                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setHighlightedIdx((idx) => Math.max(0, (idx === -1 ? 0 : idx - 1)))
                  return
                }

                if (e.key === 'Enter') {
                  e.preventDefault()
                  const picked = countries[highlightedIdx]
                  if (picked) {
                    setSelectedCountry(picked.code)
                    setCountryOpen(false)
                    setHighlightedIdx(-1)
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
              <ul className="custom-select-menu" role="listbox" aria-label="Select Country">
                {countries.map((country, idx) => {
                  const isSelected = country.code === selectedCountry
                  const isHighlighted = idx === highlightedIdx
                  return (
                    <li
                      key={country.code}
                      role="option"
                      aria-selected={isSelected}
                      className={`custom-select-option${isSelected ? ' is-selected' : ''}${
                        isHighlighted ? ' is-highlighted' : ''
                      }`}
                      onMouseEnter={() => setHighlightedIdx(idx)}
                      onMouseDown={(e) => {
                        // Prevent blur/click-outside from closing before selection
                        e.preventDefault()
                      }}
                      onClick={() => {
                        setSelectedCountry(country.code)
                        setCountryOpen(false)
                        setHighlightedIdx(-1)
                      }}
                    >
                      {country.name} ({country.code})
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

        <button
          type="submit"
          className="search-submit"
          disabled={loading || loadingCountries || loadingSites || !mkt.trim() || !selectedSiteKey}
        >
          {loading ? 'Searching...' : 'Search Price'}
        </button>
      </form>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div className="result-card">
          <h2>Price Result</h2>
          <div className="result-content">
            {result.found ? (
              <>
                <div className="price-display">
                  <span className="price-amount">
                    {result.price} {result.currency}
                  </span>
                </div>
                {result.product_url && (
                  <a
                    href={result.product_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="product-link"
                  >
                    View Product →
                  </a>
                )}
                {result.evidence && (
                  <p className="evidence">{result.evidence}</p>
                )}
                <div className="confidence">
                  Confidence: {(result.confidence * 100).toFixed(0)}%
                </div>
              </>
            ) : (
              <div className="not-found">
                <p>Price not found for this product</p>
                {result.error && <p className="error-detail">{result.error}</p>}
                {result.message && <p className="error-detail">{result.message}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default PriceSearch

