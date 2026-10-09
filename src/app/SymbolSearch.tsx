import { useEffect, useMemo, useRef, useState } from 'react'
import type { CryptoMarket } from '../chart/markets'
import { CloseIcon, SearchIcon } from './Icons'

const CATEGORIES = ['All', 'Crypto', 'Indices'] as const

interface SymbolSearchProps {
  markets: readonly CryptoMarket[]
  current: CryptoMarket
  onSelect(market: CryptoMarket): void
  onClose(): void
}

function matchRank(item: CryptoMarket, needle: string): number {
  const symbol = item.symbol.toLowerCase()
  const base = item.baseAsset.toLowerCase()
  const name = item.name.toLowerCase().replace(/[\s/]+/g, '')
  if (symbol === needle) return 0
  if (base === needle) return 1
  if (symbol.startsWith(needle)) return 2
  if (base.startsWith(needle)) return 3
  if (name.startsWith(needle)) return 4
  if (symbol.includes(needle) || name.includes(needle)) return 5
  return -1
}

export function matchMarkets(query: string, markets: readonly CryptoMarket[]): CryptoMarket[] {
  const needle = query.trim().toLowerCase().replace(/[\s/]+/g, '')
  if (!needle) return [...markets]
  return markets
    .map((item, index) => ({ item, index, rank: matchRank(item, needle) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item)
}

function badgeColor(item: CryptoMarket): string {
  if (item.baseAsset === 'BTC') return '#f7931a'
  let hash = 0
  for (const char of item.baseAsset) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return `hsl(${hash} 55% 42%)`
}

export function SymbolSearch({ markets, current, onSelect, onClose }: SymbolSearchProps) {
  const [query, setQuery] = useState(current.symbol)
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('All')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => matchMarkets(query, markets).filter((item) => (
    category === 'All' || (category === 'Crypto' ? item.kind !== 'dominance' : item.kind === 'dominance')
  )), [query, markets, category])
  const activeIndex = Math.min(highlight, Math.max(0, results.length - 1))

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    document.querySelector('.symbol-row.highlighted')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight(Math.min(activeIndex + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight(Math.max(activeIndex - 1, 0))
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault()
      onSelect(results[activeIndex])
    }
  }

  return (
    <div className="superchart-backdrop symbol-search-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="symbol-search"
        role="dialog"
        aria-modal="true"
        aria-labelledby="symbol-search-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header>
          <h2 id="symbol-search-title">Symbol search</h2>
          <button type="button" aria-label="Close symbol search" onClick={onClose}><CloseIcon /></button>
        </header>

        <div className="symbol-search-input">
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search"
            spellCheck={false}
            autoComplete="off"
            aria-label="Search symbols"
            onChange={(event) => { setQuery(event.target.value); setHighlight(0) }}
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus() }}>
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="symbol-search-pills" role="tablist" aria-label="Symbol category">
          {CATEGORIES.map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={category === item}
              className={category === item ? 'active' : ''}
              key={item}
              onClick={() => {
                setCategory(item)
                setHighlight(0)
                // The box opens pre-filled with the current symbol; do not let that hide a whole category.
                if (query === current.symbol) setQuery('')
              }}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="symbol-search-list" role="listbox" aria-label="Symbols">
          {results.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={item.symbol === current.symbol}
              className={index === activeIndex ? 'symbol-row highlighted' : 'symbol-row'}
              key={item.symbol}
              onMouseMove={() => setHighlight(index)}
              onClick={() => onSelect(item)}
            >
              <span className="symbol-row-badge" style={{ background: badgeColor(item) }}>{item.mark}</span>
              <strong>{item.symbol}</strong>
              <span className="symbol-row-name">{item.kind === 'spot' ? `${item.name} / ${item.quoteAsset === 'BTC' ? 'Bitcoin' : 'TetherUS'}` : item.name}</span>
              <small>{item.kind === 'spot' ? `${item.venue.toLowerCase()} spot` : item.kind === 'futures' ? 'perpetual · futures' : 'index · estimated'}</small>
            </button>
          ))}
          {results.length === 0 && (
            <div className="symbol-search-empty">
              <strong>No symbols match “{query.trim()}”</strong>
              <span>Try a ticker like BTC, a name like Ethereum, or an index like BTC.D.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
