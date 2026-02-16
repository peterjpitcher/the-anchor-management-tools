import { describe, expect, it, vi } from 'vitest'

import { RetryableSupabase } from '@/lib/supabase-retry'

describe('RetryableSupabase mutation guards', () => {
  it('returns null data for no-row update results instead of throwing no-row errors', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

    const query = {
      eq: vi.fn(),
      select: vi.fn().mockReturnValue({ maybeSingle }),
    }
    query.eq.mockImplementation(() => query)

    const supabase = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue(query),
      }),
    }

    const retryable = new RetryableSupabase(supabase as any)
    const result = await retryable.updateWithRetry('customers', { first_name: 'Pat' }, {
      id: 'customer-1',
      site_id: 'site-1',
    })

    expect(result).toEqual({ data: null, error: null })
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'customer-1')
    expect(query.eq).toHaveBeenNthCalledWith(2, 'site_id', 'site-1')
    expect(query.select).toHaveBeenCalledOnce()
  })
})
