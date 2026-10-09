import { useEffect, useMemo, useState } from 'react'
import type { CryptoMarket } from '../chart/markets'
import { CloseIcon, PlusIcon, StarIcon, TrashIcon } from './Icons'
import { fetchExchangeQuotes, fetchIndexQuotes } from './quotes'
import {
  activeList,
  createList,
  cycleFlag,
  deleteList,
  removeSymbol,
  renameList,
  setActiveList,
  sortItems,
  type SortDirection,
  type SortKey,
  type WatchQuote,
  type WatchlistState,
} from './watchlists'

const EXCHANGE_REFRESH_MS = 5_000
const INDEX_REFRESH_MS = 60_000

interface WatchlistProps {
  state: WatchlistState
  /** Resolves a symbol to its market, or undefined when the symbol is unknown to this app. */
  findMarket(symbol: string): CryptoMarket | undefined
  currentSymbol: string
  onState(next: WatchlistState): void
  onOpen(market: CryptoMarket): void
  onAdd(): void
  onClose(): void
}

function formatPrice(value: number, market: CryptoMarket | undefined): string {
  const digits = market?.pricePrecision ?? 2
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function Watchlist({ state, findMarket, currentSymbol, onState, onOpen, onAdd, onClose }: WatchlistProps) {
  const list = activeList(state)
  const [quotes, setQuotes] = useState<Record<string, WatchQuote>>({})
  const [sortKey, setSortKey] = useState<SortKey>('manual')
  const [direction, setDirection] = useState<SortDirection>('desc')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [newName, setNewName] = useState<string>()

  const markets = useMemo(
    () => list.items.map((item) => findMarket(item.symbol)).filter((market): market is CryptoMarket => market !== undefined),
    [list.items, findMarket],
  )
  const marketKey = markets.map((market) => market.symbol).join(',')

  useEffect(() => {
    let live = true
    const controller = new AbortController()
    const run = () => {
      void fetchExchangeQuotes(markets, controller.signal)
        .then((next) => { if (live) setQuotes((current) => ({ ...current, ...next })) })
        .catch(() => { /* keep the last quotes; the next tick retries */ })
    }
    run()
    const timer = setInterval(run, EXCHANGE_REFRESH_MS)
    return () => { live = false; controller.abort(); clearInterval(timer) }
    // markets is derived from marketKey; the key keeps the timer from restarting on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketKey])

  useEffect(() => {
    let live = true
    const run = () => {
      void fetchIndexQuotes(markets)
        .then((next) => { if (live) setQuotes((current) => ({ ...current, ...next })) })
        .catch(() => { /* CoinGecko may be rate limited; try again next minute */ })
    }
    run()
    const timer = setInterval(run, INDEX_REFRESH_MS)
    return () => { live = false; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketKey])

  const rows = useMemo(() => sortItems(list.items, quotes, sortKey, direction), [list.items, quotes, sortKey, direction])

  const sortBy = (key: SortKey) => {
    if (sortKey === key) {
      if (direction === 'desc') setDirection('asc')
      else { setSortKey('manual'); setDirection('desc') }
    } else {
      setSortKey(key)
      setDirection(key === 'symbol' ? 'asc' : 'desc')
    }
  }
  const arrow = (key: SortKey) => (sortKey === key ? (direction === 'asc' ? ' ↑' : ' ↓') : '')

  const commitRename = () => {
    onState(renameList(state, list.id, renameValue))
    setRenaming(false)
  }

  return (
    <aside className="watchlist-panel" aria-label="Watchlist">
      <header>
        <div><StarIcon /><strong>Watchlist</strong></div>
        <button type="button" onClick={onAdd} aria-label="Add symbol" title="Add symbol"><PlusIcon /></button>
        <button type="button" onClick={onClose} aria-label="Close watchlist"><CloseIcon /></button>
      </header>

      <div className="watchlist-lists">
        {renaming ? (
          <input
            autoFocus
            aria-label="List name"
            value={renameValue}
            maxLength={40}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <select
            aria-label="Watchlist"
            value={list.id}
            onChange={(event) => onState(setActiveList(state, event.target.value))}
          >
            {state.lists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        )}
        <button type="button" title="Rename list" aria-label="Rename list" onClick={() => { setRenameValue(list.name); setRenaming(true) }}>Rename</button>
        <button type="button" title="New list" aria-label="New list" onClick={() => setNewName('')}>New</button>
        <button
          type="button"
          className="delete"
          title="Delete list"
          aria-label="Delete list"
          disabled={state.lists.length <= 1}
          onClick={() => onState(deleteList(state, list.id))}
        >
          <TrashIcon />
        </button>
      </div>

      {newName !== undefined && (
        <form
          className="watchlist-new"
          onSubmit={(event) => {
            event.preventDefault()
            onState(createList(state, newName))
            setNewName(undefined)
          }}
        >
          <input autoFocus value={newName} maxLength={40} placeholder="List name" aria-label="New list name" onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => event.stopPropagation()} />
          <button type="submit">Create</button>
          <button type="button" onClick={() => setNewName(undefined)}>Cancel</button>
        </form>
      )}

      <div className="watchlist-columns" role="row">
        <span />
        <button type="button" onClick={() => sortBy('symbol')}>Symbol{arrow('symbol')}</button>
        <button type="button" className="num" onClick={() => sortBy('last')}>Last{arrow('last')}</button>
        <button type="button" className="num" onClick={() => sortBy('changePercent')}>Chg%{arrow('changePercent')}</button>
        <span />
      </div>

      <div className="watchlist-rows">
        {rows.map((item) => {
          const market = findMarket(item.symbol)
          const quote = quotes[item.symbol]
          const up = (quote?.change ?? 0) >= 0
          return (
            <div
              key={item.symbol}
              className={item.symbol === currentSymbol ? 'watchlist-row active' : 'watchlist-row'}
              onClick={() => market && onOpen(market)}
              title={market ? `${market.name} · ${market.venue}` : 'Symbol not available'}
            >
              <button
                type="button"
                className={item.flag ? `watchlist-flag flag-${item.flag}` : 'watchlist-flag'}
                aria-label={`Flag ${item.symbol}`}
                title="Color flag"
                onClick={(event) => { event.stopPropagation(); onState(cycleFlag(state, item.symbol)) }}
              />
              <span className="watchlist-symbol">
                <strong>{market?.pair ?? item.symbol}</strong>
                <small>{market?.name ?? 'Unavailable'}</small>
              </span>
              <span className="watchlist-last num">{quote ? formatPrice(quote.last, market) : '—'}</span>
              <span className={quote ? (up ? 'watchlist-change num price-up' : 'watchlist-change num price-down') : 'watchlist-change num'}>
                {quote ? `${up ? '+' : ''}${quote.changePercent.toFixed(2)}%` : '—'}
              </span>
              <button
                type="button"
                className="watchlist-remove"
                aria-label={`Remove ${item.symbol}`}
                title="Remove from list"
                onClick={(event) => { event.stopPropagation(); onState(removeSymbol(state, item.symbol)) }}
              >
                <CloseIcon />
              </button>
            </div>
          )
        })}
        {rows.length === 0 && (
          <div className="watchlist-empty">
            <strong>This list is empty</strong>
            <span>Press + to add symbols and watch them update live.</span>
          </div>
        )}
      </div>
    </aside>
  )
}
