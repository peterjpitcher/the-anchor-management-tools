import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a data-next-link="true" href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { LinkButton } from './LinkButton'

describe('LinkButton download', () => {
  it('renders a plain anchor with download for a download link', () => {
    render(
      <LinkButton href="/api/rota/export" download>
        Download CSV
      </LinkButton>,
    )

    const link = screen.getByRole('link', { name: 'Download CSV' })
    expect(link).not.toHaveAttribute('data-next-link')
    expect(link).toHaveAttribute('download', '')
    expect(link).toHaveAttribute('href', '/api/rota/export')
  })

  it('names the downloaded file when download is a string', () => {
    render(
      <LinkButton href="/api/receipts/export" download="receipts.csv">
        Export
      </LinkButton>,
    )

    expect(screen.getByRole('link', { name: 'Export' })).toHaveAttribute('download', 'receipts.csv')
  })

  it('treats download={false} as an ordinary internal link', () => {
    render(
      <LinkButton href="/rota" download={false}>
        Rota
      </LinkButton>,
    )

    const link = screen.getByRole('link', { name: 'Rota' })
    expect(link).toHaveAttribute('data-next-link', 'true')
    expect(link).not.toHaveAttribute('download')
  })

  it('keeps internal links on next/link and external ones on a plain anchor', () => {
    render(
      <>
        <LinkButton href="/invoices">Invoices</LinkButton>
        <LinkButton href="https://example.com" target="_blank">
          Help
        </LinkButton>
      </>,
    )

    expect(screen.getByRole('link', { name: 'Invoices' })).toHaveAttribute('data-next-link', 'true')
    const external = screen.getByRole('link', { name: 'Help' })
    expect(external).not.toHaveAttribute('data-next-link')
    expect(external).not.toHaveAttribute('download')
    expect(external).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
