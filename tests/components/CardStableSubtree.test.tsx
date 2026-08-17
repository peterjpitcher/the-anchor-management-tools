import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Card, CardBody, SearchInput } from '@/ds'

/**
 * Regression cover for the /customers search box losing focus after one character.
 *
 * Card decides whether to wrap its children in a padding div by inspecting whether any
 * child is a CardBody. Pages that swap a table for a <CardBody><PageLoading/></CardBody>
 * while loading therefore flipped Card between "wrapped" and "unwrapped", which changed
 * the shape of the tree and made React rebuild the entire subtree. Any input rendered
 * above the swap was destroyed mid-typing, so the search box dropped focus and every
 * character after the first went into a detached element.
 *
 * These tests assert on DOM node identity, because that is what actually breaks: the
 * markup looks correct either way, it is the remount that is the bug.
 */
describe('Card keeps its subtree mounted when children flip to a CardBody', () => {
  function LoadingSwapCard({ loading }: { loading: boolean }) {
    return (
      <Card>
        <div>
          <input placeholder="Search customers" defaultValue="" />
        </div>
        {loading ? <CardBody>Loading…</CardBody> : <table><tbody><tr><td>A row</td></tr></tbody></table>}
      </Card>
    )
  }

  it('preserves the input element across a loading swap', () => {
    const { rerender } = render(<LoadingSwapCard loading={false} />)
    const before = screen.getByPlaceholderText('Search customers')

    rerender(<LoadingSwapCard loading />)
    const during = screen.getByPlaceholderText('Search customers')

    rerender(<LoadingSwapCard loading={false} />)
    const after = screen.getByPlaceholderText('Search customers')

    expect(during).toBe(before)
    expect(after).toBe(before)
  })

  it('keeps focus on the search box while the card swaps in its loading state', () => {
    const { rerender } = render(<LoadingSwapCard loading={false} />)
    const input = screen.getByPlaceholderText('Search customers')
    input.focus()
    expect(document.activeElement).toBe(input)

    rerender(<LoadingSwapCard loading />)

    expect(document.contains(input)).toBe(true)
    expect(document.activeElement).toBe(input)
  })

  it('does not drop characters typed while a debounced search is committing', async () => {
    // Mirrors CustomersClient: committing a search term flips the card into its
    // loading state, which is exactly when the remount used to happen.
    function CustomersLikeCard() {
      const [term, setTerm] = useState('')
      const [loading, setLoading] = useState(false)
      return (
        <Card>
          <div>
            <SearchInput
              value={term}
              onChange={(next) => {
                setTerm(next)
                setLoading(true)
              }}
              debounceDelay={1}
              placeholder="Search customers"
            />
          </div>
          {loading ? (
            <CardBody>Loading…</CardBody>
          ) : (
            <table><tbody><tr><td>A row</td></tr></tbody></table>
          )}
        </Card>
      )
    }

    render(<CustomersLikeCard />)
    const input = screen.getByPlaceholderText<HTMLInputElement>('Search customers')
    input.focus()

    // Type the first character and let the debounce commit, flipping the card to loading.
    await act(async () => {
      fireChange(input, 'j')
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    // The element being typed into must still be the live one, or the rest of the
    // word goes into a node that is no longer attached to the page.
    expect(document.contains(input)).toBe(true)
    expect(document.activeElement).toBe(input)

    await act(async () => {
      fireChange(input, 'joan')
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(screen.getByPlaceholderText<HTMLInputElement>('Search customers').value).toBe('joan')
  })
})

function fireChange(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
