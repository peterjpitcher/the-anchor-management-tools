'use client'

import { useCallback, useState } from 'react'
import { lookupVouchers, type FohVoucherLookupItem } from '../lib'
import { LOOKUP_MIN_CHARS } from '@/lib/vouchers/constants'

// Shared lookup state for the Redeem and Hand out panels: one text query,
// one result list, one status message (surfaced via aria-live in the panels).
export function useVoucherLookup() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FohVoucherLookupItem[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  const search = useCallback(
    async (overrideQuery?: string): Promise<FohVoucherLookupItem[] | null> => {
      const term = (overrideQuery ?? query).trim()
      if (term.length < LOOKUP_MIN_CHARS) {
        setResults(null)
        setMessage(`Type at least ${LOOKUP_MIN_CHARS} characters of the voucher number`)
        return null
      }

      setSearching(true)
      setMessage(null)
      const outcome = await lookupVouchers(term)
      setSearching(false)

      if (!outcome.items) {
        setResults(null)
        setMessage(outcome.message)
        return null
      }

      setResults(outcome.items)
      if (outcome.items.length === 0) {
        setMessage('No vouchers match that number')
      }
      return outcome.items
    },
    [query]
  )

  const reset = useCallback(() => {
    setQuery('')
    setResults(null)
    setMessage(null)
    setSearching(false)
  }, [])

  return { query, setQuery, results, setResults, message, setMessage, searching, search, reset }
}
