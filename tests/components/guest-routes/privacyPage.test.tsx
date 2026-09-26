import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PrivacyPolicy from '@/app/privacy/page'
import { GUEST_CONTACT } from '@/lib/guest-contact'

describe('privacy policy page', () => {
  it('renders the hero inside the guest shell with a single main landmark', () => {
    const { container } = render(<PrivacyPolicy />)

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy Policy')
    expect(screen.getByText('The Anchor')).toBeInTheDocument()
    expect(screen.getByText('Last updated: 21 December 2024')).toBeInTheDocument()
    expect(container.querySelector('[class*="public__"]')).toBeNull()
  })

  it("reads in the wide guest column with the shell's own padding, like every guest page", () => {
    render(<PrivacyPolicy />)

    // The policy is long prose, so it takes the one wide option. It no longer
    // overrides the shell's width or padding with a full-bleed hero.
    const main = screen.getByRole('main')
    expect(main.className).toContain('max-w-guest-wide')
    expect(main.className).toContain('px-guest-lg')
    expect(main.className).toContain('sm:px-6')
    expect(main.className).not.toContain('max-w-none')
    expect(main.className).not.toContain('px-0')
  })

  it('keeps all fifteen numbered sections, in order', () => {
    render(<PrivacyPolicy />)

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)

    expect(headings).toEqual([
      '1. Introduction',
      '2. Information We Collect',
      '3. Legal Basis for Processing',
      '4. How We Use Your Information',
      '5. Data Sharing',
      '6. Data Retention',
      '7. Your Rights',
      '8. Data Security',
      '9. Cookies',
      "10. Children's Privacy",
      '11. International Transfers',
      '12. Marketing Communications',
      '13. Complaints',
      '14. Changes to This Policy',
      '15. Contact Us',
    ])
  })

  it('keeps the legal facts verbatim', () => {
    render(<PrivacyPolicy />)

    // The owner corrected the controller identity and postal address on 2026-08-05
    // (previously The Anchor at Staines-upon-Thames TW19 6BJ, which was wrong). These
    // are legal facts on a published notice, so they are pinned here to stop a future
    // restyle drifting them. They now agree with COMPANY_DETAILS and the guest footer.
    const controller = screen.getByText('Data Controller:').closest('p')
    expect(controller).toHaveTextContent('Orange Jelly Limited')
    expect(controller).toHaveTextContent('Stanwell Moor Village')
    expect(controller).toHaveTextContent('Surrey TW19 6AQ')
    expect(controller).not.toHaveTextContent('Staines-upon-Thames')
    expect(controller).not.toHaveTextContent('TW19 6BJ')
    expect(controller).toHaveTextContent('Phone: 01753 682 707')

    // Changed 2026-08-06: privacy@theanchorpub.co.uk is not a mailbox the pub uses, so every
    // contact point on the policy is the single GUEST_CONTACT address.
    expect(screen.queryByText(/theanchorpub\.co\.uk/)).toBeNull()

    // Four, not three: the policy body has three contact points (controller, your rights,
    // contact us) and the shared guest footer adds a fourth. They were three before, when the
    // policy used a different address from the footer.
    const mailboxLinks = screen.getAllByRole('link', { name: GUEST_CONTACT.email })
    expect(mailboxLinks).toHaveLength(4)
    for (const link of mailboxLinks) {
      expect(link).toHaveAttribute('href', GUEST_CONTACT.emailHref)
    }

    expect(screen.getByRole('link', { name: 'ico.org.uk' })).toHaveAttribute(
      'href',
      'https://ico.org.uk'
    )
    expect(screen.getByText(/Cheshire SK9 5AF/)).toBeInTheDocument()
    expect(screen.getByText('We never sell your personal data.')).toBeInTheDocument()
  })
})
